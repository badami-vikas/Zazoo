import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createLocalDb } from "../src/client-local.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const here = dirname(fileURLToPath(import.meta.url));

function realMigrationsFolder(): string {
  for (const relative of ["../migrations", "../../migrations"]) {
    const candidate = resolve(here, relative);
    try {
      readFileSync(join(candidate, "meta/_journal.json"), "utf8");
      return candidate;
    } catch {
      // Try the source-tree path after the compiled-test path.
    }
  }
  throw new Error("database migrations folder not found");
}

function migrationsThrough(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), `bridge-db-through-${lastIdx}-`));
  cpSync(realMigrationsFolder(), dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  for (const entry of journal.entries.filter(({ idx }) => idx > lastIdx)) {
    rmSync(join(dir, `${entry.tag}.sql`), { force: true });
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dir;
}

test("migration 0023 preserves occurrences in Events and removes parallel ledgers", async () => {
  const through0022 = migrationsThrough(22);
  const through0023 = migrationsThrough(23);
  const { db, client, close } = await createLocalDb({ migrationsFolder: through0022 });
  const organizationId = "10000000-0000-4000-8000-000000000023";
  const userId = "20000000-0000-4000-8000-000000000023";
  const personId = "30000000-0000-4000-8000-000000000023";
  const recordId = "40000000-0000-4000-8000-000000000023";
  const signalId = "50000000-0000-4000-8000-000000000023";
  const signalEventId = "60000000-0000-4000-8000-000000000023";
  const actionId = "70000000-0000-4000-8000-000000000023";
  const timelineId = "80000000-0000-4000-8000-000000000023";
  const recordEventId = "90000000-0000-4000-8000-000000000023";
  const memoryId = "a0000000-0000-4000-8000-000000000023";

  try {
    await client.exec(`
      INSERT INTO "users" ("id", "email")
      VALUES ('${userId}', 'vocab4@example.test');
      INSERT INTO "organizations" ("id", "name")
      VALUES ('${organizationId}', 'VOCAB4 fixture');
      INSERT INTO "organization_members" ("organization_id", "user_id")
      VALUES ('${organizationId}', '${userId}');
      INSERT INTO "people" (
        "id", "organization_id", "user_id", "visibility", "full_name_override"
      ) VALUES (
        '${personId}', '${organizationId}', '${userId}', 'organization', 'VOCAB4 Person'
      );
      INSERT INTO "records" ("id", "organization_id", "title")
      VALUES ('${recordId}', '${organizationId}', 'VOCAB4 Record');
      INSERT INTO "signals" (
        "id", "organization_id", "type", "subject_type", "subject_id",
        "payload", "recommended_action", "status"
      ) VALUES (
        '${signalId}', '${organizationId}', 'relationship_context', 'person',
        '${personId}', '{"reason":"A verified reason"}',
        '{"label":"Review safely"}', 'new'
      );
      INSERT INTO "events" (
        "id", "organization_id", "type", "entity_type", "entity_id", "payload"
      ) VALUES (
        '${signalEventId}', '${organizationId}', 'relationship.signal_detected',
        'signal', '${signalId}', '{"source":"verified"}'
      );
      INSERT INTO "signal_actions" (
        "id", "organization_id", "signal_id", "user_id", "verb"
      ) VALUES (
        '${actionId}', '${organizationId}', '${signalId}', '${userId}', 'save'
      );
      INSERT INTO "edges" (
        "organization_id", "src_type", "src_id", "dst_type", "dst_id",
        "edge_type", "owner_user_id", "visibility", "source", "source_module"
      ) VALUES
      (
        '${organizationId}', 'signal', '${signalId}', 'event', '${signalEventId}',
        'source_event', '${userId}', 'private', 'verified', 'relationship'
      ),
      (
        '${organizationId}', 'signal', '${signalId}', 'person', '${personId}',
        'participant', '${userId}', 'private', 'verified', 'relationship'
      );
      INSERT INTO "timeline_entries" (
        "id", "organization_id", "occurred_at", "type", "content", "created_by"
      ) VALUES (
        '${timelineId}', '${organizationId}', now(), 'relationship.note',
        'Preserved timeline note', '${userId}'
      );
      INSERT INTO "timeline_entry_refs" ("entry_id", "entity_type", "entity_id")
      VALUES ('${timelineId}', 'person', '${personId}');
      INSERT INTO "touchpoints" (
        "id", "organization_id", "record_id", "assignee_type", "assignee_id",
        "touchpoint_kind", "context"
      ) VALUES (
        '${recordEventId}', '${organizationId}', '${recordId}', 'user', '${userId}',
        'follow_up', 'Preserved record event'
      );
      INSERT INTO "memories" (
        "id", "organization_id", "type", "scope", "content", "confidence",
        "trust_origin", "plane", "created_by", "owner_user_id"
      ) VALUES (
        '${memoryId}', '${organizationId}', 'episodic', 'private',
        '{"kind":"culture_fetch_intent","artifact":{"content":"bounded"}}',
        1, 'operator', 'local', '${userId}', '${userId}'
      );
    `);

    await migrate(db, { migrationsFolder: through0023 });

    const relationRows = await client.query<{ relname: string; relkind: string }>(`
      SELECT "relname", "relkind"
      FROM "pg_class"
      WHERE "relname" IN (
        'signals', 'signal_actions', 'timeline_entries',
        'timeline_entry_refs', 'touchpoints'
      )
      ORDER BY "relname"
    `);
    assert.deepEqual(relationRows.rows, [{ relname: "signals", relkind: "v" }]);

    const signalRows = await client.query<{
      id: string;
      subject_id: string;
      reason: string;
      action: string;
    }>(`
      SELECT
        "id",
        "subject_id",
        "payload" ->> 'reason' AS "reason",
        "recommended_action" ->> 'label' AS "action"
      FROM "signals"
    `);
    assert.deepEqual(signalRows.rows, [{
      id: signalEventId,
      subject_id: personId,
      reason: "A verified reason",
      action: "Review safely",
    }]);

    const eventRows = await client.query<{ id: string; type: string; entity_type: string }>(`
      SELECT "id", "type", "entity_type"
      FROM "events"
      WHERE "id" IN ('${signalEventId}', '${actionId}', '${timelineId}', '${recordEventId}')
      ORDER BY "id"
    `);
    assert.equal(eventRows.rows.length, 4);
    assert.equal(
      eventRows.rows.find((row) => row.id === timelineId)?.entity_type,
      "interaction",
    );
    assert.ok(
      eventRows.rows
        .filter((row) => row.id !== timelineId)
        .every((row) => row.entity_type === "event"),
    );

    const participantRows = await client.query<{ src_id: string; dst_id: string }>(`
      SELECT "src_id", "dst_id"
      FROM "edges"
      WHERE "organization_id" = '${organizationId}'
        AND "edge_type" = 'participant'
        AND "dst_id" = '${personId}'
      ORDER BY "src_id"
    `);
    assert.deepEqual(
      participantRows.rows.map((row) => row.src_id),
      [signalEventId, timelineId].sort(),
    );
    assert.ok(participantRows.rows.every((row) => row.dst_id === personId));

    const recordRelation = await client.query<{ src_id: string; dst_id: string }>(`
      SELECT "src_id", "dst_id"
      FROM "edges"
      WHERE "src_id" = '${recordEventId}' AND "dst_id" = '${recordId}'
    `);
    assert.deepEqual(recordRelation.rows, [{ src_id: recordEventId, dst_id: recordId }]);

    const memoryRows = await client.query<{ content: string }>(`
      SELECT "content" FROM "memories" WHERE "id" = '${memoryId}'
    `);
    assert.deepEqual(
      JSON.parse(memoryRows.rows[0]?.content ?? "{}"),
      { kind: "culture_fetch_intent", result: { content: "bounded" } },
    );

    await migrate(db, { migrationsFolder: through0023 });
    const afterReplay = await client.query<{ count: string }>(`
      SELECT count(*)::text AS "count"
      FROM "events"
      WHERE "id" IN ('${signalEventId}', '${actionId}', '${timelineId}', '${recordEventId}')
    `);
    assert.equal(afterReplay.rows[0]?.count, "4");
  } finally {
    await close();
    rmSync(through0022, { recursive: true, force: true });
    rmSync(through0023, { recursive: true, force: true });
  }
});

test("migration 0023 applies to a fresh database with no schema drift", async () => {
  const through0023 = migrationsThrough(23);
  const { client, close } = await createLocalDb({ migrationsFolder: through0023 });
  try {
    const relations = await client.query<{ signals_kind: string; old_tables: string }>(`
      SELECT
        (SELECT "relkind"::text FROM "pg_class" WHERE "relname" = 'signals') AS "signals_kind",
        (
          SELECT count(*)::text
          FROM "pg_class"
          WHERE "relname" IN ('signal_actions', 'timeline_entries', 'timeline_entry_refs', 'touchpoints')
        ) AS "old_tables"
    `);
    assert.deepEqual(relations.rows, [{ signals_kind: "v", old_tables: "0" }]);
  } finally {
    await close();
    rmSync(through0023, { recursive: true, force: true });
  }
});
