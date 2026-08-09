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
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type {
  BodyStore,
  ExternalRecordRow,
  LocalEntityRecord,
  LocalGraphStore,
  LocalMessage,
  LocalMessageAck,
  LocalMessageAttachment,
  LocalMessageDirection,
  LocalMessageSearchCapabilities,
  LocalMessageSearchHit,
  LocalMessageSearchQuery,
  LocalMessageSenderKind,
  LocalPerson,
  LocalPersonList,
  LocalPlane,
  LocalStateMutation,
  LocalStateStore,
  LocalThreadActivity,
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";
import { assertMessageShape } from "../messages.js";
import {
  migrateLocalMessageColumns,
  migrateLocalPeopleIdentityColumns,
  migrateOrganizationColumns,
} from "./organization-schema-migrations.js";
import { migrateOAuthTokenEncryption } from "./oauth-token-encryption-migration.js";
import {
  decodeTokenField,
  decryptTokenField,
  encodeTokenField,
  encryptTokenField,
  ephemeralTokenVaultKeys,
  type TokenVaultKeys,
} from "./oauth-token-crypto.js";

/**
 * Extensions the Local Plane needs registered on its PGlite client.
 *
 * VERIFIED 2026-08-02, and it contradicts the convenient assumption: pglite
 * 0.2.17 SHIPS `pg_trgm` in the npm package, but a bare `new PGlite()` does NOT
 * make it available — `pg_available_extensions` lists only `plpgsql`, and
 * `CREATE EXTENSION pg_trgm` fails with "extension is not available". It works
 * only when the module is registered at client construction, as here.
 *
 * This matters to anyone passing their own `client` into
 * `createPgliteLocalPlane`: register these, or trigram search degrades. Worse,
 * a database that ALREADY has a trigram index, reopened by a client without the
 * extension, fails every query touching that table with an opaque
 * `could not access file "$libdir/pg_trgm"` — which is why initialization
 * detects that state and reports it plainly instead of letting it surface later.
 */
export const LOCAL_PLANE_PGLITE_EXTENSIONS = { pg_trgm } as const;

/**
 * Text-search configuration for message bodies.
 *
 * `simple` rather than `english`: a real WhatsApp address book is multilingual
 * (the live account measured on 2026-08-01 is largely Indian numbers), and the
 * `english` configuration would apply English stemming and drop English
 * stopwords from every language's text. `simple` lowercases and tokenizes
 * without stemming, which is the language-neutral behaviour wanted here. The
 * cost is no stem-matching in English; `fuzzy` mode covers that case.
 */
const MESSAGE_TEXT_CONFIG = "simple";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
  integration_id text PRIMARY KEY,
  organization_id text NOT NULL,
  provider text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
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
-- Third-party message BODIES. LOCAL PLANE ONLY (ADR-158 / AP-091) — a body has
-- no promote path to cloud canonical, in the same sense as local_people.phones
-- and for stronger reasons: this is someone else's personal correspondence.
CREATE TABLE IF NOT EXISTS local_messages (
  organization_id text NOT NULL,
  source text NOT NULL,
  message_id text NOT NULL,
  chat_id text NOT NULL,
  -- Source-scoped sender identity, same key space as local_people.dedupe_key.
  -- 'whatsapp:+E164' and 'whatsapp-lid:<id>' are DISJOINT spaces; sender_kind
  -- records which one this is, and the two are checked against each other before
  -- any row is written (src/messages.ts).
  sender_key text,
  sender_kind text NOT NULL DEFAULT 'unknown',
  direction text NOT NULL DEFAULT 'inbound',
  sent_at text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  -- A descriptor, not the bytes. Media stays on disk.
  attachment jsonb,
  ack text NOT NULL DEFAULT 'unknown',
  captured_at text NOT NULL DEFAULT '',
  PRIMARY KEY (organization_id, source, message_id)
);
CREATE INDEX IF NOT EXISTS local_messages_thread_idx
  ON local_messages (organization_id, source, chat_id, sent_at);
CREATE INDEX IF NOT EXISTS local_messages_sender_idx
  ON local_messages (organization_id, sender_key);
CREATE TABLE IF NOT EXISTS local_people (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  full_name text,
  emails jsonb NOT NULL DEFAULT '[]',
  -- LOCAL ONLY. Phone numbers never cross to cloud canonical without an
  -- explicit promote, unlike emails.
  phones jsonb NOT NULL DEFAULT '[]',
  -- Source-scoped identity (e.g. whatsapp:+9198..., whatsapp-lid:123@lid) for
  -- sources whose people have no email.
  dedupe_key text,
  canonical_person_id text
);
CREATE INDEX IF NOT EXISTS local_people_dedupe_idx ON local_people (organization_id, dedupe_key);
-- Local-plane lists: the roster surface for bulk imports, deliberately kept out
-- of the relationship graph.
CREATE TABLE IF NOT EXISTS local_person_lists (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS local_person_lists_name_idx
  ON local_person_lists (organization_id, name);
CREATE TABLE IF NOT EXISTS local_person_list_members (
  list_id text NOT NULL,
  person_id text NOT NULL,
  PRIMARY KEY (list_id, person_id)
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

const FTS_INDEX = "local_messages_body_fts_idx";
const TRGM_INDEX = "local_messages_body_trgm_idx";

async function hasIndex(db: PGlite, indexName: string): Promise<boolean> {
  const result = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [indexName],
  );
  return result.rows.length > 0;
}

/**
 * Is `pg_trgm` actually usable right now?
 *
 * Checked by CALLING it, not by looking at `pg_extension`. On a persisted
 * database the catalog row survives the client that installed it, so
 * `CREATE EXTENSION IF NOT EXISTS` succeeds as a no-op and the catalog claims
 * the extension is present, while the shared library is not loaded at all. Only
 * evaluating a function proves the library resolved.
 */
async function trigramIsUsable(db: PGlite): Promise<boolean> {
  try {
    await db.exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  } catch {
    return false;
  }
  try {
    await db.query(`SELECT similarity('bridge', 'bridges') AS probe`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Full-text and trigram indexes for message bodies. Runs AFTER `INIT_SQL`,
 * because it needs the table to exist and it is conditional in a way plain SQL
 * cannot express.
 *
 * Full text is core Postgres and is created unconditionally — search must not
 * be a capability that quietly might not be there. The trigram index is created
 * only when `pg_trgm` really loaded; otherwise fuzzy search degrades to a
 * substring scan, which is slower but honest.
 */
async function ensureMessageSearchIndexes(
  db: PGlite,
): Promise<LocalMessageSearchCapabilities> {
  await db.exec(
    `CREATE INDEX IF NOT EXISTS ${FTS_INDEX}
       ON local_messages USING gin (to_tsvector('${MESSAGE_TEXT_CONFIG}', body))`,
  );

  const trigram = await trigramIsUsable(db);
  if (!trigram) {
    // The dangerous state: a trigram index built by a client that registered
    // the extension, reopened by one that did not. Every query touching
    // local_messages would fail with `could not access file "$libdir/pg_trgm"`,
    // far from the cause. Name the cause here instead.
    if (await hasIndex(db, TRGM_INDEX)) {
      throw new Error(
        `Local Plane database has the ${TRGM_INDEX} trigram index but pg_trgm is not loaded, ` +
          `so every query against local_messages would fail. The PGlite client must be ` +
          `constructed with LOCAL_PLANE_PGLITE_EXTENSIONS (exported from @bridge/local).`,
      );
    }
    return { fullText: true, trigram: false };
  }

  await db.exec(
    `CREATE INDEX IF NOT EXISTS ${TRGM_INDEX}
       ON local_messages USING gin (body gin_trgm_ops)`,
  );
  return { fullText: true, trigram: true };
}

/**
 * Compare two decrypted token records field-by-field. Ciphertext for the same
 * plaintext differs on every encryption (fresh random IV per write), so
 * compare-and-swap equality is checked here, against the decrypted record,
 * rather than as a SQL `WHERE` column match against ciphertext — safe because
 * every mutation on a given `integrationId` is already serialized through
 * `#exclusive` inside a Local Plane owned by exactly one process at a time
 * (see `acquirePgliteDirectoryOwnership`).
 */
function tokenRecordsEqual(
  a: OAuthTokenRecord | null,
  b: OAuthTokenRecord | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.integrationId === b.integrationId &&
    a.organizationId === b.organizationId &&
    a.provider === b.provider &&
    a.accessToken === b.accessToken &&
    (a.refreshToken ?? null) === (b.refreshToken ?? null) &&
    a.scope === b.scope &&
    a.tokenType === b.tokenType &&
    (a.expiryDate ?? null) === (b.expiryDate ?? null) &&
    a.updatedAt === b.updatedAt
  );
}

class PgliteSecretStore implements SecretStore {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(
    private readonly db: PGlite,
    private readonly keys: TokenVaultKeys,
  ) {}

  async putToken(rec: OAuthTokenRecord): Promise<void> {
    await this.#exclusive(rec.integrationId, () => this.#putToken(rec));
  }

  async #putToken(rec: OAuthTokenRecord): Promise<void> {
    const accessTokenEncrypted = encodeTokenField(
      encryptTokenField(this.keys, `${rec.integrationId}:access_token`, rec.accessToken),
    );
    const refreshTokenEncrypted = rec.refreshToken
      ? encodeTokenField(
          encryptTokenField(this.keys, `${rec.integrationId}:refresh_token`, rec.refreshToken),
        )
      : null;
    await this.db.query(
      `INSERT INTO oauth_tokens
         (integration_id, organization_id, provider, access_token_encrypted, refresh_token_encrypted, scope, token_type, expiry_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (integration_id) DO UPDATE SET
         organization_id=$2, provider=$3, access_token_encrypted=$4,
         refresh_token_encrypted=COALESCE($5, oauth_tokens.refresh_token_encrypted),
         scope=$6, token_type=$7, expiry_date=$8, updated_at=$9`,
      [
        rec.integrationId,
        rec.organizationId,
        rec.provider,
        accessTokenEncrypted,
        refreshTokenEncrypted,
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
      access_token_encrypted: string;
      refresh_token_encrypted: string | null;
      scope: string;
      token_type: string;
      expiry_date: string | number | null;
      updated_at: string;
    }>(`SELECT * FROM oauth_tokens WHERE integration_id = $1`, [integrationId]);
    const r = res.rows[0];
    if (!r) return null;
    const accessToken = decryptTokenField(
      this.keys,
      `${r.integration_id}:access_token`,
      decodeTokenField(r.access_token_encrypted),
    );
    const refreshToken = r.refresh_token_encrypted
      ? decryptTokenField(
          this.keys,
          `${r.integration_id}:refresh_token`,
          decodeTokenField(r.refresh_token_encrypted),
        )
      : undefined;
    return {
      integrationId: r.integration_id,
      organizationId: r.organization_id,
      provider: r.provider,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
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
    const current = await this.#getToken(integrationId);
    if (!tokenRecordsEqual(current, expected)) return false;
    if (!replacement) {
      if (current) {
        await this.db.query(`DELETE FROM oauth_tokens WHERE integration_id = $1`, [
          integrationId,
        ]);
      }
      return true;
    }
    await this.#putToken(replacement);
    return true;
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
  phones: string[] | null;
  dedupe_key: string | null;
  canonical_person_id: string | null;
}

interface ListRow {
  id: string;
  organization_id: string;
  name: string;
  source: string;
  created_at: string;
}

function rowToPerson(r: PersonRow): LocalPerson {
  return {
    id: r.id,
    organizationId: r.organization_id,
    ...(r.full_name ? { fullName: r.full_name } : {}),
    emails: Array.isArray(r.emails) ? r.emails : [],
    ...(Array.isArray(r.phones) && r.phones.length ? { phones: r.phones } : {}),
    ...(r.dedupe_key ? { dedupeKey: r.dedupe_key } : {}),
    ...(r.canonical_person_id ? { canonicalPersonId: r.canonical_person_id } : {}),
  };
}

function rowToList(r: ListRow): LocalPersonList {
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    source: r.source,
    createdAt: r.created_at,
  };
}

interface MessageRow {
  organization_id: string;
  source: string;
  message_id: string;
  chat_id: string;
  sender_key: string | null;
  sender_kind: string;
  direction: string;
  sent_at: string;
  body: string;
  attachment: unknown;
  ack: string;
  captured_at: string;
}

function rowToMessage(r: MessageRow): LocalMessage {
  return {
    organizationId: r.organization_id,
    source: r.source,
    messageId: r.message_id,
    chatId: r.chat_id,
    ...(r.sender_key ? { senderKey: r.sender_key } : {}),
    senderKind: r.sender_kind as LocalMessageSenderKind,
    direction: r.direction as LocalMessageDirection,
    sentAt: r.sent_at,
    body: r.body,
    ...(r.attachment ? { attachment: r.attachment as LocalMessageAttachment } : {}),
    ack: r.ack as LocalMessageAck,
    capturedAt: r.captured_at,
  };
}

/** Make a user string safe as a LIKE pattern operand. */
function escapeLike(text: string): string {
  return text.replace(/([\\%_])/g, "\\$1");
}

class PgliteLocalGraphStore implements LocalGraphStore {
  constructor(
    private readonly db: PGlite,
    private readonly capabilities: LocalMessageSearchCapabilities,
  ) {}
  async findPeopleByEmail(organizationId: string, email: string): Promise<LocalPerson[]> {
    // Small local tier (<100 high-interaction) — load the organization's people and
    // match in JS so email comparison stays case-insensitive and adapter-agnostic.
    const all = await this.listPeople(organizationId);
    const needle = email.trim().toLowerCase();
    return all.filter((p) => p.emails.some((e) => e.trim().toLowerCase() === needle));
  }
  async upsertPerson(person: LocalPerson): Promise<void> {
    await this.db.query(
      `INSERT INTO local_people (id, organization_id, full_name, emails, phones, dedupe_key, canonical_person_id)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         organization_id=$2, full_name=$3, emails=$4::jsonb, phones=$5::jsonb,
         dedupe_key=$6, canonical_person_id=$7`,
      [
        person.id,
        person.organizationId,
        person.fullName ?? null,
        JSON.stringify(person.emails),
        JSON.stringify(person.phones ?? []),
        person.dedupeKey ?? null,
        person.canonicalPersonId ?? null,
      ],
    );
  }
  async listPeople(organizationId: string): Promise<LocalPerson[]> {
    const res = await this.db.query<PersonRow>(`SELECT * FROM local_people WHERE organization_id=$1`, [organizationId]);
    return res.rows.map(rowToPerson);
  }
  async findPeopleByDedupeKey(organizationId: string, dedupeKey: string): Promise<LocalPerson[]> {
    const res = await this.db.query<PersonRow>(
      `SELECT * FROM local_people WHERE organization_id=$1 AND dedupe_key=$2`,
      [organizationId, dedupeKey],
    );
    return res.rows.map(rowToPerson);
  }
  async ensurePersonList(list: LocalPersonList): Promise<LocalPersonList> {
    // Name is unique per organization, so a re-import reuses the same list
    // rather than creating "WhatsApp (2)".
    await this.db.query(
      `INSERT INTO local_person_lists (id, organization_id, name, source, created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, name) DO NOTHING`,
      [list.id, list.organizationId, list.name, list.source, list.createdAt],
    );
    const res = await this.db.query<ListRow>(
      `SELECT * FROM local_person_lists WHERE organization_id=$1 AND name=$2`,
      [list.organizationId, list.name],
    );
    const row = res.rows[0];
    return row ? rowToList(row) : list;
  }
  async listPersonLists(organizationId: string): Promise<LocalPersonList[]> {
    const res = await this.db.query<ListRow>(
      `SELECT * FROM local_person_lists WHERE organization_id=$1 ORDER BY name`,
      [organizationId],
    );
    return res.rows.map(rowToList);
  }
  async addPeopleToList(listId: string, personIds: readonly string[]): Promise<void> {
    for (const personId of personIds) {
      await this.db.query(
        `INSERT INTO local_person_list_members (list_id, person_id) VALUES ($1,$2)
         ON CONFLICT (list_id, person_id) DO NOTHING`,
        [listId, personId],
      );
    }
  }
  async listPeopleInList(listId: string): Promise<LocalPerson[]> {
    const res = await this.db.query<PersonRow>(
      `SELECT p.* FROM local_people p
       JOIN local_person_list_members m ON m.person_id = p.id
       WHERE m.list_id = $1`,
      [listId],
    );
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

  // ── Messages ───────────────────────────────────────────────────────────────

  async putMessages(messages: readonly LocalMessage[]): Promise<void> {
    // Validate the whole batch BEFORE writing any of it. A batch that contains
    // one identity-inconsistent message must not leave half of itself behind.
    for (const message of messages) assertMessageShape(message);
    for (const message of messages) {
      await this.db.query(
        `INSERT INTO local_messages
           (organization_id, source, message_id, chat_id, sender_key, sender_kind,
            direction, sent_at, body, attachment, ack, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
         ON CONFLICT (organization_id, source, message_id) DO UPDATE SET
           chat_id=$4, sender_key=$5, sender_kind=$6, direction=$7, sent_at=$8,
           body=$9, attachment=$10::jsonb, ack=$11, captured_at=$12`,
        [
          message.organizationId,
          message.source,
          message.messageId,
          message.chatId,
          message.senderKey ?? null,
          message.senderKind,
          message.direction,
          message.sentAt,
          message.body,
          message.attachment ? JSON.stringify(message.attachment) : null,
          message.ack,
          message.capturedAt,
        ],
      );
    }
  }

  async listMessages(
    organizationId: string,
    source: string,
    chatId: string,
    limit?: number,
  ): Promise<LocalMessage[]> {
    // Select DESC so the limit keeps the newest rows, then reverse to honour
    // the port's oldest-first contract. Ascending + LIMIT silently returned
    // the oldest N, so a thread longer than the limit could never show a
    // recent message (BUGS 2026-08-03). The tiebreak reverses with the sort
    // key so equal `sent_at` rows keep a stable, total order.
    const res = await this.db.query<MessageRow>(
      `SELECT * FROM local_messages
        WHERE organization_id=$1 AND source=$2 AND chat_id=$3
        ORDER BY sent_at DESC, message_id DESC
        LIMIT $4`,
      [organizationId, source, chatId, limit ?? 500],
    );
    return res.rows.map(rowToMessage).reverse();
  }

  async searchMessages(
    query: LocalMessageSearchQuery,
  ): Promise<LocalMessageSearchHit[]> {
    const text = query.text.trim();
    if (text.length === 0) return [];
    const limit = query.limit ?? 50;
    const scopes: string[] = ["organization_id = $1"];
    const params: unknown[] = [query.organizationId];
    if (query.source) {
      params.push(query.source);
      scopes.push(`source = $${params.length}`);
    }
    if (query.chatId) {
      params.push(query.chatId);
      scopes.push(`chat_id = $${params.length}`);
    }
    if (query.senderKey) {
      params.push(query.senderKey);
      scopes.push(`sender_key = $${params.length}`);
    }
    const where = scopes.join(" AND ");

    if ((query.mode ?? "fulltext") === "fulltext") {
      params.push(text);
      const textParam = `$${params.length}`;
      params.push(limit);
      // websearch_to_tsquery rather than to_tsquery: it accepts arbitrary user
      // input (quotes, OR, -negation) and never raises a syntax error, so a
      // stray character in the search box cannot become an exception.
      const res = await this.db.query<MessageRow & { rank: number }>(
        `SELECT *, ts_rank(to_tsvector('${MESSAGE_TEXT_CONFIG}', body),
                           websearch_to_tsquery('${MESSAGE_TEXT_CONFIG}', ${textParam})) AS rank
           FROM local_messages
          WHERE ${where}
            AND to_tsvector('${MESSAGE_TEXT_CONFIG}', body)
                @@ websearch_to_tsquery('${MESSAGE_TEXT_CONFIG}', ${textParam})
          ORDER BY rank DESC, sent_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return res.rows.map((r) => ({ ...rowToMessage(r), rank: Number(r.rank) }));
    }

    if (this.capabilities.trigram) {
      params.push(text);
      const textParam = `$${params.length}`;
      params.push(limit);
      // word_similarity, not similarity: `similarity` compares the query against
      // the WHOLE body, so a short query inside a long message scores near zero.
      // word_similarity scores the best-matching span, which is what a search
      // box means.
      return (
        await this.db.query<MessageRow & { rank: number }>(
          `SELECT *, word_similarity(${textParam}, body) AS rank
             FROM local_messages
            WHERE ${where} AND ${textParam} <% body
            ORDER BY rank DESC, sent_at DESC
            LIMIT $${params.length}`,
          params,
        )
      ).rows.map((r) => ({ ...rowToMessage(r), rank: Number(r.rank) }));
    }

    // No pg_trgm on this client: a plain substring scan. Slower and it will not
    // forgive a typo, but it returns real rows rather than silently none.
    params.push(`%${escapeLike(text)}%`);
    const likeParam = `$${params.length}`;
    params.push(limit);
    const res = await this.db.query<MessageRow>(
      `SELECT * FROM local_messages
        WHERE ${where} AND body ILIKE ${likeParam} ESCAPE '\\'
        ORDER BY sent_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((r) => ({ ...rowToMessage(r), rank: 0 }));
  }

  async getThreadActivity(
    organizationId: string,
    source: string,
    chatId: string,
  ): Promise<LocalThreadActivity> {
    const res = await this.db.query<{
      inbound_count: string | number;
      outbound_count: string | number;
      first_inbound_at: string | null;
      last_inbound_at: string | null;
      last_outbound_at: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE direction='inbound')  AS inbound_count,
         count(*) FILTER (WHERE direction='outbound') AS outbound_count,
         min(sent_at) FILTER (WHERE direction='inbound')  AS first_inbound_at,
         max(sent_at) FILTER (WHERE direction='inbound')  AS last_inbound_at,
         max(sent_at) FILTER (WHERE direction='outbound') AS last_outbound_at
       FROM local_messages
       WHERE organization_id=$1 AND source=$2 AND chat_id=$3`,
      [organizationId, source, chatId],
    );
    const r = res.rows[0];
    return {
      chatId,
      inboundCount: Number(r?.inbound_count ?? 0),
      outboundCount: Number(r?.outbound_count ?? 0),
      ...(r?.first_inbound_at ? { firstInboundAt: r.first_inbound_at } : {}),
      ...(r?.last_inbound_at ? { lastInboundAt: r.last_inbound_at } : {}),
      ...(r?.last_outbound_at ? { lastOutboundAt: r.last_outbound_at } : {}),
    };
  }

  async messageSearchCapabilities(): Promise<LocalMessageSearchCapabilities> {
    return { ...this.capabilities };
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
  /**
   * OAuth-token encryption-at-rest key(s). Omit for an ephemeral, process-local
   * key (fine for in-memory/test Local Planes — nothing survives restart
   * anyway). A durable, disk-backed Local Plane holding real OAuth tokens
   * MUST be given an explicit key by its caller (apps/api/src/wiring.ts
   * enforces this whenever both a durable `BRIDGE_LOCAL_DIR` and real Google
   * OAuth are configured) or every token becomes unrecoverable on restart.
   */
  secretVaultKeys?: TokenVaultKeys;
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
  // A client we construct always registers the Local Plane's extensions; a
  // caller-supplied one is their responsibility (see LOCAL_PLANE_PGLITE_EXTENSIONS).
  const db =
    config.client ??
    (ownership
      ? new PGlite(ownership.dataDir, { extensions: LOCAL_PLANE_PGLITE_EXTENSIONS })
      : new PGlite({ extensions: LOCAL_PLANE_PGLITE_EXTENSIONS }));
  let capabilities: LocalMessageSearchCapabilities = {
    fullText: true,
    trigram: false,
  };
  const secretVaultKeys = config.secretVaultKeys ?? ephemeralTokenVaultKeys();
  try {
    await migrateOrganizationColumns(db);
    // Additive columns must land BEFORE INIT_SQL's indexes, which reference
    // them on an already-installed table.
    await migrateLocalPeopleIdentityColumns(db);
    await migrateLocalMessageColumns(db);
    await migrateOAuthTokenEncryption(db, secretVaultKeys);
    await db.exec(INIT_SQL);
    await migrateLegacyExternalRecords(db);
    // After INIT_SQL: needs local_messages to exist, and is conditional on an
    // extension in a way plain SQL cannot express.
    capabilities = await ensureMessageSearchIndexes(db);
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
    secrets: new PgliteSecretStore(db, secretVaultKeys),
    bodies: new PgliteBodyStore(db),
    graph: new PgliteLocalGraphStore(db, capabilities),
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
