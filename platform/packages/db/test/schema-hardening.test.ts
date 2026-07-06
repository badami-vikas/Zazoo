/**
 * Schema-hardening pass (docs/raw/All fixes.md §4/§5, Phase 3 item 12) — proves
 * each DDL change in migrations/0004_schema_hardening.sql actually exists and
 * behaves correctly against a real pglite-backed Postgres, not just that the
 * migration file parses.
 *
 *   (1) hnsw index on embeddings.embedding — index exists AND a similarity query
 *       actually plans through it (EXPLAIN mentions the index name).
 *   (2) UUIDv7 PK defaults on ledger/events/timeline_entries — ids minted via
 *       Drizzle's $defaultFn are RFC 9562 version-7 (time-prefixed, sortable),
 *       not version-4 (random).
 *   (3) timeline_entries(workspace_id, occurred_at) composite index exists.
 *   (4) people_canonical.emails GIN index exists.
 *   (5) dedup_key partial-unique: many NULLs allowed, duplicate non-NULLs rejected.
 *   (6) CHECK constraints reject an invalid enum value on visibility/effect/
 *       user_decision/actor_type.
 *   (7) role_permissions has exactly ONE uniqueness constraint (the coalesce-NULL
 *       index), not two.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { createLocalDb, schema } from "../src/index.js";

test("schema hardening: hnsw index exists on embeddings.embedding and is used by a similarity query", async () => {
  const { db, close } = await createLocalDb();
  try {
    const indexRows = (await db.execute(
      sql`select indexname, indexdef from pg_indexes where tablename = 'embeddings' and indexname = 'embeddings_embedding_hnsw_idx'`,
    )) as unknown as { rows: Array<{ indexname: string; indexdef: string }> };
    assert.equal(indexRows.rows.length, 1, "embeddings_embedding_hnsw_idx must exist");
    assert.match(indexRows.rows[0]!.indexdef, /USING hnsw/i);
    assert.match(indexRows.rows[0]!.indexdef, /vector_cosine_ops/i);

    // Seed one row so the planner has something to scan, then confirm the
    // similarity query plans through the hnsw index (not a seq scan).
    await db.execute(sql`
      insert into embeddings (entity_type, entity_id, embedding)
      values ('dummy_entity', gen_random_uuid(), (select array_fill(0.1, array[768])::vector))
    `);
    const explainRows = (await db.execute(sql`
      explain select id from embeddings
      order by embedding <=> (select array_fill(0.1, array[768])::vector)
      limit 5
    `)) as unknown as { rows: Array<Record<string, string>> };
    const planText = explainRows.rows.map((r) => Object.values(r).join(" ")).join("\n");
    assert.match(planText, /embeddings_embedding_hnsw_idx/i, `expected hnsw index in plan, got:\n${planText}`);
  } finally {
    await close();
  }
});

test("schema hardening: ledger/events/timeline_entries ids are UUIDv7 (time-prefixed), not v4", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "dummy_ws_uuidv7" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);

    const [ledgerRow] = await db
      .insert(schema.ledger)
      .values({
        workspaceId: ws.id,
        actorType: "user",
        actorId: "00000000-0000-0000-0000-00000000dead",
        action: "write",
        resourceType: "person",
        inputs: { note: "dummy_input" },
      })
      .returning({ id: schema.ledger.id });
    const [eventRow] = await db
      .insert(schema.events)
      .values({
        workspaceId: ws.id,
        type: "dummy_event",
        entityType: "person",
        entityId: "00000000-0000-0000-0000-00000000dead",
      })
      .returning({ id: schema.events.id });
    const [timelineRow] = await db
      .insert(schema.timelineEntries)
      .values({
        workspaceId: ws.id,
        occurredAt: new Date(),
        type: "dummy_note",
        createdBy: "dummy_user",
      })
      .returning({ id: schema.timelineEntries.id });

    for (const [label, row] of [
      ["ledger", ledgerRow],
      ["events", eventRow],
      ["timeline_entries", timelineRow],
    ] as const) {
      assert.ok(row, `${label} row inserted`);
      const versionNibble = row!.id[14];
      assert.equal(versionNibble, "7", `${label}.id must be UUIDv7 (version nibble '7'), got ${row!.id}`);
    }

    // Time-sortability: ids minted later should sort after ids minted earlier
    // when compared lexicographically (the point of UUIDv7 over v4).
    const [firstId] = await db
      .insert(schema.events)
      .values({ workspaceId: ws.id, type: "dummy_first", entityType: "person", entityId: "00000000-0000-0000-0000-00000000dead" })
      .returning({ id: schema.events.id });
    await new Promise((r) => setTimeout(r, 5));
    const [secondId] = await db
      .insert(schema.events)
      .values({ workspaceId: ws.id, type: "dummy_second", entityType: "person", entityId: "00000000-0000-0000-0000-00000000dead" })
      .returning({ id: schema.events.id });
    assert.ok(firstId!.id < secondId!.id, "later-minted UUIDv7 id must sort after an earlier one");
  } finally {
    await close();
  }
});

test("schema hardening: timeline_entries(workspace_id, occurred_at) composite index exists", async () => {
  const { db, close } = await createLocalDb();
  try {
    const rows = (await db.execute(
      sql`select indexname from pg_indexes where tablename = 'timeline_entries' and indexname = 'timeline_entries_ws_occurred_idx'`,
    )) as unknown as { rows: Array<{ indexname: string }> };
    assert.equal(rows.rows.length, 1, "timeline_entries_ws_occurred_idx must exist");
  } finally {
    await close();
  }
});

test("schema hardening: people_canonical.emails has a GIN index", async () => {
  const { db, close } = await createLocalDb();
  try {
    const rows = (await db.execute(
      sql`select indexdef from pg_indexes where tablename = 'people_canonical' and indexname = 'people_canonical_emails_idx'`,
    )) as unknown as { rows: Array<{ indexdef: string }> };
    assert.equal(rows.rows.length, 1, "people_canonical_emails_idx must exist");
    assert.match(rows.rows[0]!.indexdef, /USING gin/i);
  } finally {
    await close();
  }
});

test("schema hardening: people_canonical.dedup_key partial-unique allows many NULLs, rejects duplicate non-NULLs", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Many NULL dedup_key rows must be allowed (not deduped-against-each-other).
    await db.insert(schema.peopleCanonical).values({ fullName: "dummy_Null_One" });
    await db.insert(schema.peopleCanonical).values({ fullName: "dummy_Null_Two" });

    await db.insert(schema.peopleCanonical).values({ fullName: "dummy_Keyed_One", dedupKey: "dummy_dedupe_key_1" });
    await assert.rejects(
      () => db.insert(schema.peopleCanonical).values({ fullName: "dummy_Keyed_Two", dedupKey: "dummy_dedupe_key_1" }),
      /duplicate key|unique/i,
      "a second row with the same non-null dedup_key must be rejected",
    );
  } finally {
    await close();
  }
});

test("schema hardening: communities_canonical.dedup_key partial-unique allows many NULLs, rejects duplicate non-NULLs", async () => {
  const { db, close } = await createLocalDb();
  try {
    await db.insert(schema.communitiesCanonical).values({ name: "dummy_Community_Null_One" });
    await db.insert(schema.communitiesCanonical).values({ name: "dummy_Community_Null_Two" });

    await db.insert(schema.communitiesCanonical).values({ name: "dummy_Community_Keyed", dedupKey: "dummy_community_key_1" });
    await assert.rejects(
      () => db.insert(schema.communitiesCanonical).values({ name: "dummy_Community_Keyed_2", dedupKey: "dummy_community_key_1" }),
      /duplicate key|unique/i,
    );
  } finally {
    await close();
  }
});

test("schema hardening: CHECK constraints reject invalid enum values", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "dummy_ws_check_constraints" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);

    // visibility (people)
    const [checkUser] = await db
      .insert(schema.users)
      .values({ email: "dummy_check@example.com" })
      .returning({ id: schema.users.id });
    await assert.rejects(
      () =>
        db.insert(schema.people).values({
          workspaceId: ws!.id,
          userId: checkUser!.id,
          visibility: "dummy_bogus_visibility",
        }),
      /violates check constraint/i,
    );

    // effect (permissions)
    await assert.rejects(
      () =>
        db.insert(schema.permissions).values({
          workspaceId: ws!.id,
          actorType: "user",
          actorId: "00000000-0000-0000-0000-00000000dead",
          resourceType: "person",
          action: "read",
          effect: "dummy_bogus_effect",
        }),
      /violates check constraint/i,
    );

    // effect (policies) — allow | block | require_approval only
    await assert.rejects(
      () =>
        db.insert(schema.policies).values({
          workspaceId: ws!.id,
          scopeType: "workspace",
          name: "dummy_policy",
          rule: {},
          effect: "dummy_bogus_effect",
        }),
      /violates check constraint/i,
    );

    // user_decision (ledger) — approve | veto | edit | null only
    await assert.rejects(
      () =>
        db.insert(schema.ledger).values({
          workspaceId: ws!.id,
          actorType: "user",
          actorId: "00000000-0000-0000-0000-00000000dead",
          action: "write",
          resourceType: "person",
          userDecision: "dummy_bogus_decision",
        }),
      /violates check constraint/i,
    );

    // actor_type (ledger) — user | team | agent only
    await assert.rejects(
      () =>
        db.insert(schema.ledger).values({
          workspaceId: ws!.id,
          actorType: "dummy_bogus_actor",
          actorId: "00000000-0000-0000-0000-00000000dead",
          action: "write",
          resourceType: "person",
        }),
      /violates check constraint/i,
    );

    // actor_type (permissions) — user | team | agent | integration; still
    // rejects anything outside that widened list.
    await assert.rejects(
      () =>
        db.insert(schema.permissions).values({
          workspaceId: ws!.id,
          actorType: "dummy_bogus_actor",
          actorId: "00000000-0000-0000-0000-00000000dead",
          resourceType: "person",
          action: "read",
        }),
      /violates check constraint/i,
    );

    // Sanity: the legitimate 'integration' actor_type on permissions is NOT
    // rejected (this is the value integration-store.ts's INTEGRATION_ACTOR_TYPE
    // writes — proves the widened CHECK list didn't just move the bug).
    await db.insert(schema.permissions).values({
      workspaceId: ws!.id,
      actorType: "integration",
      actorId: "00000000-0000-0000-0000-00000000dead",
      resourceType: "integration",
      action: "read",
      effect: "allow",
    });
  } finally {
    await close();
  }
});

test("schema hardening: role_permissions has exactly one uniqueness constraint (coalesce-NULL index)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const rows = (await db.execute(sql`
      select indexname, indexdef from pg_indexes
      where tablename = 'role_permissions'
        and indexdef ilike '%unique%'
        and indexname != 'role_permissions_pkey'
    `)) as unknown as { rows: Array<{ indexname: string; indexdef: string }> };
    assert.equal(
      rows.rows.length,
      1,
      `expected exactly one non-PK unique index on role_permissions, found: ${JSON.stringify(rows.rows)}`,
    );
    assert.equal(rows.rows[0]!.indexname, "role_permissions_uq");
    assert.match(rows.rows[0]!.indexdef, /coalesce/i);

    // Behavioral proof: two NULL-resource_id grants for the same role/type/action
    // collide (coalesced to the sentinel), but a non-NULL resource_id grant for
    // the same role/type/action does NOT collide with the type-wide NULL grant.
    const [role] = await db
      .insert(schema.roles)
      .values({
        workspaceId: (
          await db.insert(schema.workspaces).values({ name: "dummy_ws_role_perms" }).returning({ id: schema.workspaces.id })
        )[0]!.id,
        name: "dummy_role",
      })
      .returning({ id: schema.roles.id, workspaceId: schema.roles.workspaceId });
    assert.ok(role);

    await db.insert(schema.rolePermissions).values({
      roleId: role!.id,
      resourceType: "person",
      action: "read",
      effect: "allow",
    });
    await assert.rejects(
      () =>
        db.insert(schema.rolePermissions).values({
          roleId: role!.id,
          resourceType: "person",
          action: "read",
          effect: "allow",
        }),
      /duplicate key|unique/i,
      "a second type-wide (NULL resource_id) grant for the same role/type/action must collide",
    );

    // A scoped (non-null resource_id) grant for the same role/type/action is a
    // DIFFERENT coalesce key and must be allowed alongside the type-wide grant.
    await db.insert(schema.rolePermissions).values({
      roleId: role!.id,
      resourceType: "person",
      action: "read",
      effect: "allow",
      resourceId: "10000000-0000-4000-8000-000000000099",
    });
  } finally {
    await close();
  }
});
