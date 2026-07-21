/**
 * pglite LOCAL-plane adapters — the real, persisted private tier (embedded
 * Postgres, machine/VPC). Binds the same ports as the in-memory adapters.
 *
 * This is the residency fix the wiki flags ("local store ❌ — today all cloud
 * Supabase"): OAuth tokens + raw Gmail/Calendar bodies + derived entities persist
 * HERE, in a local Postgres, never in Supabase. A file path persists across
 * restarts; omit it for an ephemeral in-memory DB (still a real local plane).
 */
import { mkdir, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withLock } from "@ster5/global-mutex";
import { PGlite } from "@electric-sql/pglite";
import type {
  BodyStore,
  ExternalRecordRow,
  LocalEntityRecord,
  LocalGraphStore,
  LocalPerson,
  LocalPlane,
  LocalStateMutation,
  LocalStateStore,
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";
import { migrateOrganizationColumns } from "./organization-schema-migrations.js";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
  integration_id text PRIMARY KEY,
  organization_id text NOT NULL,
  provider text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  scope text NOT NULL DEFAULT '',
  token_type text NOT NULL DEFAULT 'Bearer',
  expiry_date bigint,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS message_bodies (
  organization_id text NOT NULL,
  source text NOT NULL,
  source_record_id text NOT NULL,
  data_scope text NOT NULL DEFAULT 'private',
  content jsonb NOT NULL,
  captured_at text NOT NULL,
  PRIMARY KEY (organization_id, source, source_record_id)
);
CREATE TABLE IF NOT EXISTS local_people (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  full_name text,
  emails jsonb NOT NULL DEFAULT '[]',
  canonical_person_id text
);
CREATE TABLE IF NOT EXISTS local_entities (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  kind text NOT NULL,
  person_id text,
  payload jsonb NOT NULL,
  source text,
  source_record_id text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS local_external_records (
  organization_id text NOT NULL,
  source text NOT NULL,
  source_record_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (organization_id, source, source_record_id)
);
CREATE TABLE IF NOT EXISTS sync_state (
  integration_id text NOT NULL,
  source text NOT NULL,
  last_cursor text,
  updated_at text NOT NULL,
  PRIMARY KEY (integration_id, source)
);
CREATE TABLE IF NOT EXISTS local_state (
  organization_id text NOT NULL,
  namespace text NOT NULL,
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_at text NOT NULL,
  PRIMARY KEY (organization_id, namespace)
);
`;

const LEGACY_EXTERNAL_RECORD_COLUMNS = new Map([
  ["organization_id", "text"],
  ["source", "text"],
  ["source_record_id", "text"],
  ["entity_type", "text"],
  ["entity_id", "text"],
  ["created_at", "text"],
]);

type ExternalRecordTableShape =
  | "missing"
  | "legacy"
  | "canonical"
  | "unsupported";

async function inspectExternalRecordTable(
  db: PGlite,
  tableName: string,
): Promise<ExternalRecordTableShape> {
  const result = await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  if (result.rows.length === 0) return "missing";
  const columns = new Map(
    result.rows.map((row) => [row.column_name, row.data_type]),
  );
  const isExactLegacyShape =
    columns.size === LEGACY_EXTERNAL_RECORD_COLUMNS.size &&
    [...LEGACY_EXTERNAL_RECORD_COLUMNS].every(
      ([name, dataType]) => columns.get(name) === dataType,
    );
  if (isExactLegacyShape) return "legacy";
  if (
    tableName === "external_records" &&
    columns.get("id") === "uuid" &&
    columns.get("organization_id") === "uuid" &&
    columns.get("source") === "text" &&
    columns.get("source_record_id") === "text" &&
    columns.get("entity_type") === "text" &&
    columns.get("entity_id") === "uuid" &&
    columns.get("created_at") === "timestamp with time zone"
  ) {
    return "canonical";
  }
  return "unsupported";
}

async function migrateLegacyExternalRecords(db: PGlite): Promise<void> {
  for (const tableName of [
    "local_external_records_legacy",
    "external_records",
  ]) {
    const shape = await inspectExternalRecordTable(db, tableName);
    if (shape === "missing" || shape === "canonical") continue;
    if (shape === "unsupported") {
      throw new Error(
        `${tableName} exists with an unsupported schema; refusing to migrate or drop it`,
      );
    }
    await db.exec(`
      INSERT INTO local_external_records
        (organization_id, source, source_record_id, entity_type, entity_id, created_at)
      SELECT organization_id, source, source_record_id, entity_type, entity_id, created_at
        FROM ${tableName}
      ON CONFLICT (organization_id, source, source_record_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        created_at = EXCLUDED.created_at
    `);
    const verification = await db.query<{ missing: string | number }>(`
      SELECT count(*) AS missing
        FROM ${tableName} legacy
        LEFT JOIN local_external_records current
          ON current.organization_id = legacy.organization_id
         AND current.source = legacy.source
         AND current.source_record_id = legacy.source_record_id
       WHERE current.organization_id IS NULL
          OR current.entity_type IS DISTINCT FROM legacy.entity_type
          OR current.entity_id IS DISTINCT FROM legacy.entity_id
          OR current.created_at IS DISTINCT FROM legacy.created_at
    `);
    if (Number(verification.rows[0]?.missing ?? 0) !== 0) {
      throw new Error(
        `Legacy Local Plane external-record copy from ${tableName} did not verify`,
      );
    }
    await db.exec(`DROP TABLE ${tableName}`);
  }
}

class PgliteSecretStore implements SecretStore {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(private readonly db: PGlite) {}

  async putToken(rec: OAuthTokenRecord): Promise<void> {
    await this.#exclusive(rec.integrationId, () => this.#putToken(rec));
  }

  async #putToken(rec: OAuthTokenRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_tokens
         (integration_id, organization_id, provider, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (integration_id) DO UPDATE SET
         organization_id=$2, provider=$3, access_token=$4,
         refresh_token=COALESCE($5, oauth_tokens.refresh_token),
         scope=$6, token_type=$7, expiry_date=$8, updated_at=$9`,
      [
        rec.integrationId,
        rec.organizationId,
        rec.provider,
        rec.accessToken,
        rec.refreshToken ?? null,
        rec.scope,
        rec.tokenType,
        rec.expiryDate ?? null,
        rec.updatedAt,
      ],
    );
  }

  async getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    return this.#exclusive(integrationId, () =>
      this.#getToken(integrationId),
    );
  }

  async #getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    const res = await this.db.query<{
      integration_id: string;
      organization_id: string;
      provider: string;
      access_token: string;
      refresh_token: string | null;
      scope: string;
      token_type: string;
      expiry_date: string | number | null;
      updated_at: string;
    }>(`SELECT * FROM oauth_tokens WHERE integration_id = $1`, [integrationId]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      integrationId: r.integration_id,
      organizationId: r.organization_id,
      provider: r.provider,
      accessToken: r.access_token,
      ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}),
      scope: r.scope,
      tokenType: r.token_type,
      ...(r.expiry_date != null ? { expiryDate: Number(r.expiry_date) } : {}),
      updatedAt: r.updated_at,
    };
  }

  async deleteToken(integrationId: string): Promise<void> {
    await this.#exclusive(integrationId, async () => {
      await this.db.query(
        `DELETE FROM oauth_tokens WHERE integration_id = $1`,
        [integrationId],
      );
    });
  }

  async compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): Promise<boolean> {
    return this.#exclusive(integrationId, () =>
      this.#compareAndSwapToken(integrationId, expected, replacement),
    );
  }

  async finalizeToken(
    replacement: OAuthTokenRecord,
    stillAuthorized: () => Promise<boolean>,
  ): Promise<boolean> {
    return this.#exclusive(replacement.integrationId, async () => {
      if (!(await stillAuthorized())) return false;
      const previous = await this.#getToken(replacement.integrationId);
      const candidate: OAuthTokenRecord = {
        ...replacement,
        ...(replacement.refreshToken
          ? {}
          : previous?.refreshToken
            ? { refreshToken: previous.refreshToken }
            : {}),
      };
      if (
        !(await this.#compareAndSwapToken(
          replacement.integrationId,
          previous,
          candidate,
        ))
      ) {
        throw new Error(
          "OAuth token changed inside its exclusive finalization boundary",
        );
      }
      try {
        if (await stillAuthorized()) return true;
      } catch (error) {
        await this.#restoreFinalizedToken(candidate, previous);
        throw error;
      }
      await this.#restoreFinalizedToken(candidate, previous);
      return false;
    });
  }

  async #restoreFinalizedToken(
    candidate: OAuthTokenRecord,
    previous: OAuthTokenRecord | null,
  ): Promise<void> {
    if (
      !(await this.#compareAndSwapToken(
        candidate.integrationId,
        candidate,
        previous,
      ))
    ) {
      throw new Error(
        "Could not restore the prior OAuth token inside its exclusive finalization boundary",
      );
    }
  }

  async #compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): Promise<boolean> {
    if (
      (expected && expected.integrationId !== integrationId) ||
      (replacement && replacement.integrationId !== integrationId)
    ) {
      throw new Error("OAuth token compare-and-swap records must match the Integration");
    }
    if (!expected) {
      if (!replacement) {
        return (await this.#getToken(integrationId)) === null;
      }
      const inserted = await this.db.query<{ integration_id: string }>(
        `INSERT INTO oauth_tokens
           (integration_id, organization_id, provider, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (integration_id) DO NOTHING
         RETURNING integration_id`,
        tokenValues(replacement),
      );
      return inserted.rows.length === 1;
    }
    const expectedValues = tokenValues(expected);
    if (!replacement) {
      const deleted = await this.db.query<{ integration_id: string }>(
        `DELETE FROM oauth_tokens
          WHERE integration_id = $1
            AND organization_id = $2
            AND provider = $3
            AND access_token = $4
            AND refresh_token IS NOT DISTINCT FROM $5
            AND scope = $6
            AND token_type = $7
            AND expiry_date IS NOT DISTINCT FROM $8
            AND updated_at = $9
        RETURNING integration_id`,
        expectedValues,
      );
      return deleted.rows.length === 1;
    }
    const updated = await this.db.query<{ integration_id: string }>(
      `UPDATE oauth_tokens
          SET organization_id = $2,
              provider = $3,
              access_token = $4,
              refresh_token = $5,
              scope = $6,
              token_type = $7,
              expiry_date = $8,
              updated_at = $9
        WHERE integration_id = $1
          AND organization_id = $10
          AND provider = $11
          AND access_token = $12
          AND refresh_token IS NOT DISTINCT FROM $13
          AND scope = $14
          AND token_type = $15
          AND expiry_date IS NOT DISTINCT FROM $16
          AND updated_at = $17
      RETURNING integration_id`,
      [
        ...tokenValues(replacement),
        ...expectedValues.slice(1),
      ],
    );
    return updated.rows.length === 1;
  }

  async #exclusive<T>(
    integrationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#tails.get(integrationId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(integrationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(integrationId) === tail) {
        this.#tails.delete(integrationId);
      }
    }
  }
}

function tokenValues(record: OAuthTokenRecord): [
  string,
  string,
  string,
  string,
  string | null,
  string,
  string,
  number | null,
  string,
] {
  return [
    record.integrationId,
    record.organizationId,
    record.provider,
    record.accessToken,
    record.refreshToken ?? null,
    record.scope,
    record.tokenType,
    record.expiryDate ?? null,
    record.updatedAt,
  ];
}

class PgliteBodyStore implements BodyStore {
  constructor(private readonly db: PGlite) {}
  async put(body: StoredBody): Promise<void> {
    await this.db.query(
      `INSERT INTO message_bodies (organization_id, source, source_record_id, data_scope, content, captured_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (organization_id, source, source_record_id) DO UPDATE SET
         data_scope=$4, content=$5::jsonb, captured_at=$6`,
      [body.organizationId, body.source, body.sourceRecordId, body.dataScope, JSON.stringify(body.content), body.capturedAt],
    );
  }
  async get(organizationId: string, source: string, sourceRecordId: string): Promise<StoredBody | null> {
    const res = await this.db.query<{
      organization_id: string;
      source: string;
      source_record_id: string;
      data_scope: string;
      content: unknown;
      captured_at: string;
    }>(
      `SELECT * FROM message_bodies WHERE organization_id=$1 AND source=$2 AND source_record_id=$3`,
      [organizationId, source, sourceRecordId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      organizationId: r.organization_id,
      source: r.source,
      sourceRecordId: r.source_record_id,
      dataScope: "private",
      content: r.content,
      capturedAt: r.captured_at,
    };
  }
  async list(organizationId: string, source: string): Promise<StoredBody[]> {
    const res = await this.db.query<{
      organization_id: string;
      source: string;
      source_record_id: string;
      content: unknown;
      captured_at: string;
    }>(`SELECT * FROM message_bodies WHERE organization_id=$1 AND source=$2`, [organizationId, source]);
    return res.rows.map((r) => ({
      organizationId: r.organization_id,
      source: r.source,
      sourceRecordId: r.source_record_id,
      dataScope: "private" as const,
      content: r.content,
      capturedAt: r.captured_at,
    }));
  }
}

interface PersonRow {
  id: string;
  organization_id: string;
  full_name: string | null;
  emails: string[];
  canonical_person_id: string | null;
}

function rowToPerson(r: PersonRow): LocalPerson {
  return {
    id: r.id,
    organizationId: r.organization_id,
    ...(r.full_name ? { fullName: r.full_name } : {}),
    emails: Array.isArray(r.emails) ? r.emails : [],
    ...(r.canonical_person_id ? { canonicalPersonId: r.canonical_person_id } : {}),
  };
}

class PgliteLocalGraphStore implements LocalGraphStore {
  constructor(private readonly db: PGlite) {}
  async findPeopleByEmail(organizationId: string, email: string): Promise<LocalPerson[]> {
    // Small local tier (<100 high-interaction) — load the organization's people and
    // match in JS so email comparison stays case-insensitive and adapter-agnostic.
    const all = await this.listPeople(organizationId);
    const needle = email.trim().toLowerCase();
    return all.filter((p) => p.emails.some((e) => e.trim().toLowerCase() === needle));
  }
  async upsertPerson(person: LocalPerson): Promise<void> {
    await this.db.query(
      `INSERT INTO local_people (id, organization_id, full_name, emails, canonical_person_id)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (id) DO UPDATE SET
         organization_id=$2, full_name=$3, emails=$4::jsonb, canonical_person_id=$5`,
      [
        person.id,
        person.organizationId,
        person.fullName ?? null,
        JSON.stringify(person.emails),
        person.canonicalPersonId ?? null,
      ],
    );
  }
  async listPeople(organizationId: string): Promise<LocalPerson[]> {
    const res = await this.db.query<PersonRow>(`SELECT * FROM local_people WHERE organization_id=$1`, [organizationId]);
    return res.rows.map(rowToPerson);
  }
  async commitEntity(entry: LocalEntityRecord): Promise<void> {
    // Idempotent: a retry after a partial dual-write failure re-commits the same
    // deterministic id — that must be a silent no-op, not a PK violation.
    await this.db.query(
      `INSERT INTO local_entities (id, organization_id, kind, person_id, payload, source, source_record_id, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.organizationId,
        entry.kind,
        entry.personId ?? null,
        JSON.stringify(entry.payload),
        entry.source ?? null,
        entry.sourceRecordId ?? null,
        entry.createdAt,
      ],
    );
  }
  async listEntities(organizationId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]> {
    const res = await this.db.query<{
      id: string;
      organization_id: string;
      kind: LocalEntityRecord["kind"];
      person_id: string | null;
      payload: unknown;
      source: string | null;
      source_record_id: string | null;
      created_at: string;
    }>(
      kind
        ? `SELECT * FROM local_entities WHERE organization_id=$1 AND kind=$2 ORDER BY created_at`
        : `SELECT * FROM local_entities WHERE organization_id=$1 ORDER BY created_at`,
      kind ? [organizationId, kind] : [organizationId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      kind: r.kind,
      ...(r.person_id ? { personId: r.person_id } : {}),
      payload: r.payload,
      ...(r.source ? { source: r.source } : {}),
      ...(r.source_record_id ? { sourceRecordId: r.source_record_id } : {}),
      createdAt: r.created_at,
    }));
  }
  async recordExternal(row: ExternalRecordRow): Promise<void> {
    await this.db.query(
      `INSERT INTO local_external_records (organization_id, source, source_record_id, entity_type, entity_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, source, source_record_id) DO NOTHING`,
      [row.organizationId, row.source, row.sourceRecordId, row.entityType, row.entityId, row.createdAt],
    );
  }
  async hasExternal(organizationId: string, source: string, sourceRecordId: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM local_external_records WHERE organization_id=$1 AND source=$2 AND source_record_id=$3`,
      [organizationId, source, sourceRecordId],
    );
    return res.rows.length > 0;
  }
  async getSyncCursor(integrationId: string, source: string): Promise<string | null> {
    const res = await this.db.query<{ last_cursor: string | null }>(
      `SELECT last_cursor FROM sync_state WHERE integration_id=$1 AND source=$2`,
      [integrationId, source],
    );
    return res.rows[0]?.last_cursor ?? null;
  }
  async setSyncCursor(integrationId: string, source: string, cursor: string): Promise<void> {
    await this.db.query(
      `INSERT INTO sync_state (integration_id, source, last_cursor, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (integration_id, source) DO UPDATE SET last_cursor=$3, updated_at=$4`,
      [integrationId, source, cursor, new Date(0).toISOString()],
    );
  }
}

class PgliteLocalStateStore implements LocalStateStore {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(private readonly db: PGlite) {}

  async read(organizationId: string, namespace: string): Promise<unknown | null> {
    const result = await this.db.query<{ state: unknown }>(
      `SELECT state FROM local_state WHERE organization_id=$1 AND namespace=$2`,
      [organizationId, namespace],
    );
    const state = result.rows[0]?.state;
    return state === undefined ? null : structuredClone(state);
  }

  async update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => LocalStateMutation<T>,
  ): Promise<T> {
    const key = `${organizationId}::${namespace}`;
    return this.#exclusive(key, async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const current = await this.db.query<{ state: unknown; revision: string | number }>(
          `SELECT state, revision FROM local_state WHERE organization_id=$1 AND namespace=$2`,
          [organizationId, namespace],
        );
        const row = current.rows[0];
        const mutation = reduce(structuredClone(row?.state ?? initialState));
        const updatedAt = new Date().toISOString();
        if (!row) {
          const inserted = await this.db.query<{ revision: string | number }>(
            `INSERT INTO local_state (organization_id, namespace, state, revision, updated_at)
             VALUES ($1,$2,$3::jsonb,1,$4)
             ON CONFLICT (organization_id, namespace) DO NOTHING
             RETURNING revision`,
            [organizationId, namespace, JSON.stringify(mutation.state), updatedAt],
          );
          if (inserted.rows.length > 0) return mutation.result;
          continue;
        }
        const updated = await this.db.query<{ revision: string | number }>(
          `UPDATE local_state
           SET state=$3::jsonb, revision=revision + 1, updated_at=$4
           WHERE organization_id=$1 AND namespace=$2 AND revision=$5
           RETURNING revision`,
          [
            organizationId,
            namespace,
            JSON.stringify(mutation.state),
            updatedAt,
            row.revision,
          ],
        );
        if (updated.rows.length > 0) return mutation.result;
      }
      throw new Error(
        `Local state update for organization "${organizationId}" namespace "${namespace}" exceeded its contention retry limit`,
      );
    });
  }

  async #exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

export interface PgliteLocalPlaneConfig {
  /** Filesystem dir for persistence (e.g. "./.bridge-local"). Omit = in-memory. */
  dataDir?: string;
  /** Existing client shared with another approved Local Plane adapter. */
  client?: PGlite;
}

export interface PgliteDirectoryOwnership {
  /** Canonical directory used for both the lock and PGlite. */
  dataDir: string;
  release(): Promise<void>;
}

export async function acquirePgliteDirectoryOwnership(
  dataDir: string,
): Promise<PgliteDirectoryOwnership> {
  const absoluteDataDir = resolve(dataDir);
  await mkdir(absoluteDataDir, { recursive: true });
  const canonicalDataDir = await realpath(absoluteDataDir);
  const ownerFile = `${canonicalDataDir}.bridge-owner`;
  await mkdir(dirname(ownerFile), { recursive: true });
  let acquiredResolve: (() => void) | undefined;
  let acquiredReject: ((error: unknown) => void) | undefined;
  const acquired = new Promise<void>((resolve, reject) => {
    acquiredResolve = resolve;
    acquiredReject = reject;
  });
  let releaseHold: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const lifetime = withLock(
    {
      fileToLock: ownerFile,
      stale: 3_000,
      retries: { retries: 3, minTimeout: 1_000, maxTimeout: 1_000, randomize: false },
      onCompromised(error) {
        throw new Error(`Exclusive Local Plane ownership for "${canonicalDataDir}" was compromised`, {
          cause: error,
        });
      },
    },
    async () => {
      acquiredResolve?.();
      await hold;
    },
  );
  void lifetime.catch((error: unknown) => acquiredReject?.(error));
  try {
    await acquired;
  } catch (error) {
    throw new Error(
      `Refusing to open Local Plane directory "${canonicalDataDir}" while another process owns it`,
      { cause: error },
    );
  }

  let released = false;
  return {
    dataDir: canonicalDataDir,
    async release() {
      if (released) return;
      released = true;
      releaseHold?.();
      await lifetime;
    },
  };
}

export interface PgliteLocalPlane extends LocalPlane {
  readonly client: PGlite;
}

export async function closePgliteResources(
  closeClient: (() => Promise<void>) | undefined,
  releaseOwnership: (() => Promise<void>) | undefined,
): Promise<void> {
  await closeClient?.();
  await releaseOwnership?.();
}

/** Assemble a pglite-backed LocalPlane (the real persisted local tier). */
export async function createPgliteLocalPlane(
  config: PgliteLocalPlaneConfig = {},
): Promise<PgliteLocalPlane> {
  if (config.dataDir && config.client) {
    throw new Error("PGlite Local Plane accepts either dataDir or client, not both");
  }
  const ownership = config.dataDir
    ? await acquirePgliteDirectoryOwnership(config.dataDir)
    : undefined;
  const ownsClient = config.client === undefined;
  const db =
    config.client ??
    (ownership ? new PGlite(ownership.dataDir) : new PGlite());
  try {
    await migrateOrganizationColumns(db);
    await db.exec(INIT_SQL);
    await migrateLegacyExternalRecords(db);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await closePgliteResources(
        ownsClient ? () => db.close() : undefined,
        ownership ? () => ownership.release() : undefined,
      );
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "PGlite Local Plane initialization and cleanup failed",
      );
    }
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    client: db,
    secrets: new PgliteSecretStore(db),
    bodies: new PgliteBodyStore(db),
    graph: new PgliteLocalGraphStore(db),
    state: new PgliteLocalStateStore(db),
    close: () => {
      closePromise ??= (async () => {
        await closePgliteResources(
          ownsClient ? () => db.close() : undefined,
          ownership ? () => ownership.release() : undefined,
        );
      })();
      return closePromise;
    },
  };
}
