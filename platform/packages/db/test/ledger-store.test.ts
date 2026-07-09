/**
 * DrizzleLedgerStore — double-approve TOCTOU (Phase 1 item 4) + audit-completeness
 * (Phase 1 item 5) coverage against a real pglite-backed Postgres.
 *
 * Proves the partial unique index in migrations/0003_ledger_ref_column.sql
 * (`ledger_ref_ledger_id_resolved_uq`: at most one row with a given ref_ledger_id
 * may carry a non-null user_decision) actually enforces atomicity at the database
 * — two "concurrent" appends racing to resolve the SAME proposal must result in
 * exactly one success and one typed AlreadyResolvedError, never both succeeding
 * (which in production would mean an approved action's side effects, e.g. an
 * outbound email, firing twice).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AlreadyResolvedError, type LedgerEntry } from "@bridge/core";
import { createLocalDb, DrizzleLedgerStore, schema } from "../src/index.js";

const NIL_ACTOR = "00000000-0000-0000-0000-00000000dead"; // test_fixture_ actor id, no FK on ledger.actor_id

function decisionRow(overrides: Partial<LedgerEntry> & { id: string; refLedgerId: string }): LedgerEntry {
  return {
    workspaceId: overrides.workspaceId!,
    actorType: "user",
    actorId: NIL_ACTOR,
    action: "approve",
    resourceType: "person",
    inputs: { note: "test_fixture_input" },
    userDecision: "approve",
    policyResults: [],
    createdAt: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

test("ledger: partial unique index rejects a second resolving decision row for the same ref_ledger_id (pglite)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_ledger_toctou" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws, "workspace seeded");

    const store = new DrizzleLedgerStore(db);

    // Seed a pending proposal row (userDecision null) that both decisions reference.
    const proposal = await store.append({
      id: "10000000-0000-4000-8000-000000000001",
      workspaceId: ws.id,
      actorType: "agent",
      actorId: NIL_ACTOR,
      action: "write",
      resourceType: "person",
      inputs: { full_name_override: "test_fixture_Ada" },
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    // Two "concurrent" resolving decision rows racing to reference the SAME
    // proposal. Fired together via Promise.allSettled so both inserts are
    // in flight against the same underlying pglite connection before either
    // resolves — the partial unique index, not JS-side sequencing, is what
    // must reject the second one.
    const results = await Promise.allSettled([
      store.append(
        decisionRow({
          id: "20000000-0000-4000-8000-000000000002",
          workspaceId: ws.id,
          refLedgerId: proposal.id,
          userDecision: "approve",
        }),
      ),
      store.append(
        decisionRow({
          id: "20000000-0000-4000-8000-000000000003",
          workspaceId: ws.id,
          refLedgerId: proposal.id,
          userDecision: "approve",
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one concurrent append() succeeds");
    assert.equal(rejected.length, 1, "exactly one concurrent append() is rejected");
    const rejection = rejected[0] as PromiseRejectedResult;
    assert.ok(
      rejection.reason instanceof AlreadyResolvedError,
      `rejection should be AlreadyResolvedError, got ${rejection.reason}`,
    );

    // decisionFor() confirms exactly one resolving row is visible.
    const resolved = await store.decisionFor(proposal.id);
    assert.ok(resolved);
    assert.equal(resolved!.userDecision, "approve");
  } finally {
    await close();
  }
});

test("ledger: a floor-denied (rejected, userDecision null) audit row does NOT block the real resolution", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_ledger_floor" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);

    const store = new DrizzleLedgerStore(db);
    const proposal = await store.append({
      id: "30000000-0000-4000-8000-000000000001",
      workspaceId: ws.id,
      actorType: "agent",
      actorId: NIL_ACTOR,
      action: "write",
      resourceType: "person",
      inputs: {},
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    // A blocked agent-approve attempt: audited (refLedgerId set) but userDecision
    // stays null — the partial index's predicate excludes it, so it must NOT
    // collide with (or block) the eventual real resolution.
    await store.append({
      id: "30000000-0000-4000-8000-000000000002",
      workspaceId: ws.id,
      actorType: "agent",
      actorId: NIL_ACTOR,
      action: "approve",
      resourceType: "ledger",
      resourceId: proposal.id,
      inputs: {},
      userDecision: null,
      diff: { rejected: "agent-floor: agents may not approve" },
      refLedgerId: proposal.id,
      policyResults: [],
      createdAt: "2026-07-05T00:00:01.000Z",
    });
    assert.equal(await store.decisionFor(proposal.id), null, "no RESOLVING decision yet");

    // The real human resolution now succeeds without hitting the unique index.
    const resolved = await store.append(
      decisionRow({
        id: "30000000-0000-4000-8000-000000000003",
        workspaceId: ws.id,
        refLedgerId: proposal.id,
        userDecision: "approve",
      }),
    );
    assert.equal(resolved.userDecision, "approve");
    const found = await store.decisionFor(proposal.id);
    assert.equal(found?.id, resolved.id);
  } finally {
    await close();
  }
});

test("ledger: seed, dataScope, and context round-trip through real columns (audit completeness)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_ledger_audit" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);

    const store = new DrizzleLedgerStore(db);
    const context = { type: "initiative" as const, id: "test_fixture_init-1", runId: "test_fixture_run-1" };
    const written = await store.append({
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId: ws.id,
      actorType: "user",
      actorId: NIL_ACTOR,
      action: "write",
      resourceType: "person",
      inputs: {},
      userDecision: null,
      policyResults: [],
      seed: "test_fixture_seed-1",
      dataScope: "private",
      context,
      createdAt: "2026-07-05T00:00:00.000Z",
    });

    const read = await store.get(written.id);
    assert.ok(read);
    assert.equal(read!.seed, "test_fixture_seed-1");
    assert.equal(read!.dataScope, "private");
    assert.deepEqual(read!.context, context);
  } finally {
    await close();
  }
});
