/**
 * pglite LOCAL-plane adapters — the real, persisted private tier (embedded
 * Postgres, machine/VPC). Binds the same ports as the in-memory adapters.
 *
 * This is the residency fix the wiki flags ("local store ❌ — today all cloud
 * Supabase"): OAuth tokens + raw Gmail/Calendar bodies + derived entities persist
 * HERE, in a local Postgres, never in Supabase. A file path persists across
 * restarts; omit it for an ephemeral in-memory DB (still a real local plane).
 */
import { PGlite } from "@electric-sql/pglite";
import type {
  BodyStore,
  ExternalRecordRow,
  LocalEntityRecord,
  LocalGraphStore,
  LocalPerson,
  LocalPlane,
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
  integration_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  provider text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  scope text NOT NULL DEFAULT '',
  token_type text NOT NULL DEFAULT 'Bearer',
  expiry_date bigint,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS message_bodies (
  workspace_id text NOT NULL,
  source text NOT NULL,
  source_record_id text NOT NULL,
  data_scope text NOT NULL DEFAULT 'private',
  content jsonb NOT NULL,
  captured_at text NOT NULL,
  PRIMARY KEY (workspace_id, source, source_record_id)
);
CREATE TABLE IF NOT EXISTS local_people (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  full_name text,
  emails jsonb NOT NULL DEFAULT '[]',
  canonical_person_id text
);
CREATE TABLE IF NOT EXISTS local_entities (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  kind text NOT NULL,
  person_id text,
  payload jsonb NOT NULL,
  source text,
  source_record_id text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS local_external_records (
  workspace_id text NOT NULL,
  source text NOT NULL,
  source_record_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (workspace_id, source, source_record_id)
);
CREATE TABLE IF NOT EXISTS sync_state (
  integration_id text NOT NULL,
  source text NOT NULL,
  last_cursor text,
  updated_at text NOT NULL,
  PRIMARY KEY (integration_id, source)
);
`;

async function migrateLegacyExternalRecords(db: PGlite): Promise<void> {
  const legacy = await db.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'external_records'`,
  );
  if (legacy.rows.length === 0 || legacy.rows.some((column) => column.column_name === "id")) {
    return;
  }

  const expected = new Set([
    "workspace_id",
    "source",
    "source_record_id",
    "entity_type",
    "entity_id",
    "created_at",
  ]);
  if (!legacy.rows.every((column) => expected.has(column.column_name)) || legacy.rows.length !== expected.size) {
    throw new Error("local plane cannot migrate an unrecognized legacy external_records table");
  }

  const target = await db.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'local_external_records'`,
  );
  if (target.rows.length > 0) {
    throw new Error("local plane found both legacy external_records and local_external_records tables");
  }
  await db.exec("ALTER TABLE external_records RENAME TO local_external_records;");
}

class PgliteSecretStore implements SecretStore {
  constructor(private readonly db: PGlite) {}
  async putToken(rec: OAuthTokenRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_tokens
         (integration_id, workspace_id, provider, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (integration_id) DO UPDATE SET
         workspace_id=$2, provider=$3, access_token=$4,
         refresh_token=COALESCE($5, oauth_tokens.refresh_token),
         scope=$6, token_type=$7, expiry_date=$8, updated_at=$9`,
      [
        rec.integrationId,
        rec.workspaceId,
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
    const res = await this.db.query<{
      integration_id: string;
      workspace_id: string;
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
      workspaceId: r.workspace_id,
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
    await this.db.query(`DELETE FROM oauth_tokens WHERE integration_id = $1`, [integrationId]);
  }
}

class PgliteBodyStore implements BodyStore {
  constructor(private readonly db: PGlite) {}
  async put(body: StoredBody): Promise<void> {
    await this.db.query(
      `INSERT INTO message_bodies (workspace_id, source, source_record_id, data_scope, content, captured_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (workspace_id, source, source_record_id) DO UPDATE SET
         data_scope=$4, content=$5::jsonb, captured_at=$6`,
      [body.workspaceId, body.source, body.sourceRecordId, body.dataScope, JSON.stringify(body.content), body.capturedAt],
    );
  }
  async get(workspaceId: string, source: string, sourceRecordId: string): Promise<StoredBody | null> {
    const res = await this.db.query<{
      workspace_id: string;
      source: string;
      source_record_id: string;
      data_scope: string;
      content: unknown;
      captured_at: string;
    }>(
      `SELECT * FROM message_bodies WHERE workspace_id=$1 AND source=$2 AND source_record_id=$3`,
      [workspaceId, source, sourceRecordId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      workspaceId: r.workspace_id,
      source: r.source,
      sourceRecordId: r.source_record_id,
      dataScope: "private",
      content: r.content,
      capturedAt: r.captured_at,
    };
  }
  async list(workspaceId: string, source: string): Promise<StoredBody[]> {
    const res = await this.db.query<{
      workspace_id: string;
      source: string;
      source_record_id: string;
      content: unknown;
      captured_at: string;
    }>(`SELECT * FROM message_bodies WHERE workspace_id=$1 AND source=$2`, [workspaceId, source]);
    return res.rows.map((r) => ({
      workspaceId: r.workspace_id,
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
  workspace_id: string;
  full_name: string | null;
  emails: string[];
  canonical_person_id: string | null;
}

function rowToPerson(r: PersonRow): LocalPerson {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ...(r.full_name ? { fullName: r.full_name } : {}),
    emails: Array.isArray(r.emails) ? r.emails : [],
    ...(r.canonical_person_id ? { canonicalPersonId: r.canonical_person_id } : {}),
  };
}

class PgliteLocalGraphStore implements LocalGraphStore {
  constructor(private readonly db: PGlite) {}
  async findPeopleByEmail(workspaceId: string, email: string): Promise<LocalPerson[]> {
    // Small local tier (<100 high-interaction) — load the workspace's people and
    // match in JS so email comparison stays case-insensitive and adapter-agnostic.
    const all = await this.listPeople(workspaceId);
    const needle = email.trim().toLowerCase();
    return all.filter((p) => p.emails.some((e) => e.trim().toLowerCase() === needle));
  }
  async upsertPerson(person: LocalPerson): Promise<void> {
    await this.db.query(
      `INSERT INTO local_people (id, workspace_id, full_name, emails, canonical_person_id)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id=$2, full_name=$3, emails=$4::jsonb, canonical_person_id=$5`,
      [
        person.id,
        person.workspaceId,
        person.fullName ?? null,
        JSON.stringify(person.emails),
        person.canonicalPersonId ?? null,
      ],
    );
  }
  async listPeople(workspaceId: string): Promise<LocalPerson[]> {
    const res = await this.db.query<PersonRow>(`SELECT * FROM local_people WHERE workspace_id=$1`, [workspaceId]);
    return res.rows.map(rowToPerson);
  }
  async commitEntity(entry: LocalEntityRecord): Promise<void> {
    // Idempotent: a retry after a partial dual-write failure re-commits the same
    // deterministic id — that must be a silent no-op, not a PK violation.
    await this.db.query(
      `INSERT INTO local_entities (id, workspace_id, kind, person_id, payload, source, source_record_id, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.workspaceId,
        entry.kind,
        entry.personId ?? null,
        JSON.stringify(entry.payload),
        entry.source ?? null,
        entry.sourceRecordId ?? null,
        entry.createdAt,
      ],
    );
  }
  async listEntities(workspaceId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]> {
    const res = await this.db.query<{
      id: string;
      workspace_id: string;
      kind: LocalEntityRecord["kind"];
      person_id: string | null;
      payload: unknown;
      source: string | null;
      source_record_id: string | null;
      created_at: string;
    }>(
      kind
        ? `SELECT * FROM local_entities WHERE workspace_id=$1 AND kind=$2 ORDER BY created_at`
        : `SELECT * FROM local_entities WHERE workspace_id=$1 ORDER BY created_at`,
      kind ? [workspaceId, kind] : [workspaceId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
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
      `INSERT INTO local_external_records (workspace_id, source, source_record_id, entity_type, entity_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (workspace_id, source, source_record_id) DO NOTHING`,
      [row.workspaceId, row.source, row.sourceRecordId, row.entityType, row.entityId, row.createdAt],
    );
  }
  async hasExternal(workspaceId: string, source: string, sourceRecordId: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM local_external_records WHERE workspace_id=$1 AND source=$2 AND source_record_id=$3`,
      [workspaceId, source, sourceRecordId],
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

export interface PgliteLocalPlaneConfig {
  /** Filesystem dir for persistence (e.g. "./.bridge-local"). Omit = in-memory. */
  dataDir?: string;
}

/** Assemble a pglite-backed LocalPlane (the real persisted local tier). */
export async function createPgliteLocalPlane(config: PgliteLocalPlaneConfig = {}): Promise<LocalPlane> {
  const db = config.dataDir ? new PGlite(config.dataDir) : new PGlite();
  await migrateLegacyExternalRecords(db);
  await db.exec(INIT_SQL);
  return {
    secrets: new PgliteSecretStore(db),
    bodies: new PgliteBodyStore(db),
    graph: new PgliteLocalGraphStore(db),
    close: () => db.close(),
  };
}
