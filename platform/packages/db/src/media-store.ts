/**
 * PgliteMediaStore — the LOCAL-plane media adapter binding the core `LocalMediaStore`
 * port. PGlite = Postgres-in-process (WASM); the blob is a `bytea` column in a LOCAL
 * pglite database (in-memory for tests, a data dir in prod via `dataDir`). This store
 * is the customer-controlled local tier: blobs NEVER reach Supabase/cloud. Append-only
 * (PRIMARY KEY blocks duplicate ids); no hard delete (`archive()` sets archived_at).
 */
import { PGlite } from "@electric-sql/pglite";
import type { LocalMediaStore, MediaCaptureRecord, MediaKind, MediaStatus } from "@bridge/core";
import { MEDIA_SCHEMA_MIGRATIONS_SQL } from "./media-schema-migrations.js";

const DDL = `
CREATE TABLE IF NOT EXISTS media_captures (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  kind text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  duration_seconds double precision,
  caption text,
  ocr_text text,
  thumbnail_data_url text,
  status text NOT NULL,
  ledger_id text,
  linked_entity jsonb,
  provenance jsonb NOT NULL,
  captured_at text NOT NULL,
  archived_at text,
  blob bytea NOT NULL
);
${MEDIA_SCHEMA_MIGRATIONS_SQL}
`;

interface Row {
  id: string; organization_id: string; kind: string; mime_type: string; byte_size: number;
  width: number | null; height: number | null; duration_seconds: number | null;
  caption: string | null; ocr_text: string | null; thumbnail_data_url: string | null;
  status: string; ledger_id: string | null; linked_entity: unknown; provenance: unknown;
  captured_at: string; archived_at: string | null;
}

function toRecord(r: Row): MediaCaptureRecord {
  return {
    id: r.id, organizationId: r.organization_id, kind: r.kind as MediaKind, mimeType: r.mime_type,
    byteSize: r.byte_size,
    ...(r.width != null ? { width: r.width } : {}),
    ...(r.height != null ? { height: r.height } : {}),
    ...(r.duration_seconds != null ? { durationSeconds: r.duration_seconds } : {}),
    ...(r.caption != null ? { caption: r.caption } : {}),
    ...(r.ocr_text != null ? { ocrText: r.ocr_text } : {}),
    ...(r.thumbnail_data_url != null ? { thumbnailDataUrl: r.thumbnail_data_url } : {}),
    status: r.status as MediaStatus,
    ...(r.ledger_id != null ? { ledgerId: r.ledger_id } : {}),
    linkedEntity: (r.linked_entity as MediaCaptureRecord["linkedEntity"]) ?? null,
    provenance: r.provenance as MediaCaptureRecord["provenance"],
    capturedAt: r.captured_at,
    ...(r.archived_at != null ? { archivedAt: r.archived_at } : {}),
  };
}

export class PgliteMediaStore implements LocalMediaStore {
  #pg: PGlite;
  private constructor(pg: PGlite) { this.#pg = pg; }

  /** Create + migrate. `dataDir` undefined => in-memory (tests). */
  static async create(dataDir?: string): Promise<PgliteMediaStore> {
    const pg = dataDir ? new PGlite(dataDir) : new PGlite();
    await pg.exec(DDL);
    return new PgliteMediaStore(pg);
  }
  async close(): Promise<void> { await this.#pg.close(); }

  async put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord> {
    try {
      await this.#pg.query(
        `INSERT INTO media_captures
          (id, organization_id, kind, mime_type, byte_size, width, height, duration_seconds,
           caption, ocr_text, thumbnail_data_url, status, ledger_id, linked_entity,
           provenance, captured_at, archived_at, blob)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          rec.id, rec.organizationId, rec.kind, rec.mimeType, rec.byteSize,
          rec.width ?? null, rec.height ?? null, rec.durationSeconds ?? null,
          rec.caption ?? null, rec.ocrText ?? null, rec.thumbnailDataUrl ?? null,
          rec.status, rec.ledgerId ?? null,
          rec.linkedEntity ? JSON.stringify(rec.linkedEntity) : null,
          JSON.stringify(rec.provenance), rec.capturedAt, rec.archivedAt ?? null, blob,
        ],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate key|unique/i.test(msg)) {
        throw new Error(`media: duplicate id ${rec.id} (append-only violation)`);
      }
      throw e;
    }
    return { ...rec };
  }

  async get(id: string): Promise<MediaCaptureRecord | null> {
    const res = await this.#pg.query<Row>(`SELECT * FROM media_captures WHERE id = $1`, [id]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    const res = await this.#pg.query<{ blob: Uint8Array }>(
      `SELECT blob FROM media_captures WHERE id = $1`, [id],
    );
    return res.rows[0] ? new Uint8Array(res.rows[0].blob) : null;
  }

  async list(filter?: { status?: MediaStatus; kind?: MediaKind; organizationId?: string }): Promise<MediaCaptureRecord[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter?.status) { args.push(filter.status); where.push(`status = $${args.length}`); }
    if (filter?.kind) { args.push(filter.kind); where.push(`kind = $${args.length}`); }
    if (filter?.organizationId) { args.push(filter.organizationId); where.push(`organization_id = $${args.length}`); }
    const sql = `SELECT * FROM media_captures${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY captured_at DESC`;
    const res = await this.#pg.query<Row>(sql, args);
    return res.rows.map(toRecord);
  }

  async update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`media: no record ${id}`);
    // Identity + blob fields are immutable.
    const next: MediaCaptureRecord = {
      ...current, ...patch,
      id: current.id, organizationId: current.organizationId, kind: current.kind,
      mimeType: current.mimeType, byteSize: current.byteSize,
    };
    await this.#pg.query(
      `UPDATE media_captures SET caption=$2, ocr_text=$3, thumbnail_data_url=$4, status=$5,
        ledger_id=$6, linked_entity=$7, archived_at=$8 WHERE id=$1`,
      [
        id, next.caption ?? null, next.ocrText ?? null, next.thumbnailDataUrl ?? null,
        next.status, next.ledgerId ?? null,
        next.linkedEntity ? JSON.stringify(next.linkedEntity) : null, next.archivedAt ?? null,
      ],
    );
    return next;
  }

  async archive(id: string): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new Error(`media: no record ${id}`);
    await this.#pg.query(
      `UPDATE media_captures SET status='archived', archived_at=$2 WHERE id=$1`,
      [id, new Date(0).toISOString()],
    );
  }
}

/** Factory: a LOCAL pglite media store. `dataDir` undefined => in-memory. */
export async function createLocalMediaStore(dataDir?: string): Promise<PgliteMediaStore> {
  return PgliteMediaStore.create(dataDir);
}
