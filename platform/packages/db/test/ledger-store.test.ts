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
import { eq, sql } from "drizzle-orm";
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
    await store.append({
      id: "30000000-0000-4000-8000-000000000004",
      workspaceId: ws.id,
      actorType: "agent",
      actorId: NIL_ACTOR,
      action: "write",
      resourceType: "person",
      inputs: {},
      userDecision: null,
      diff: { rejected: "authority denied" },
      policyResults: [],
      createdAt: "2026-07-05T00:00:02.000Z",
    });
    const pendingBeforeDecision = await store.listPending(ws.id, { limit: 50, offset: 0 });
    assert.equal(pendingBeforeDecision.total, 1);
    assert.deepEqual(pendingBeforeDecision.items.map((entry) => entry.id), [proposal.id]);

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
    assert.deepEqual(await store.listPending(ws.id, { limit: 50, offset: 0 }), {
      items: [],
      total: 0,
    });
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

    test("ledger: pending Relation projection is owner-scoped without hiding shared proposal types", async () => {
      const { db, close } = await createLocalDb();
      try {
        const [ws] = await db
          .insert(schema.workspaces)
          .values({ name: "test_fixture_relation_pending_owner_scope" })
          .returning({ id: schema.workspaces.id });
        assert.ok(ws);
        const ownerId = "50000000-0000-4000-8000-000000000001";
        const otherId = "50000000-0000-4000-8000-000000000002";
        const store = new DrizzleLedgerStore(db);
        await store.append({
          id: "51000000-0000-4000-8000-000000000001",
          workspaceId: ws.id,
          actorType: "user",
          actorId: ownerId,
          action: "write",
          resourceType: "relation",
          inputs: { kind: "relationship_signal_evidence" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-17T00:00:02.000Z",
        });
        await store.append({
          id: "51000000-0000-4000-8000-000000000002",
          workspaceId: ws.id,
          actorType: "agent",
          actorId: NIL_ACTOR,
          onBehalfOfType: "user",
          onBehalfOfId: ownerId,
          action: "write",
          resourceType: "relation",
          inputs: { kind: "relationship_signal_evidence" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-17T00:00:01.000Z",
        });
        await store.append({
          id: "51000000-0000-4000-8000-000000000003",
          workspaceId: ws.id,
          actorType: "agent",
          actorId: NIL_ACTOR,
          action: "write",
          resourceType: "signal",
          inputs: {},
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-17T00:00:00.000Z",
        });

        const owner = await store.listPending(ws.id, {
          limit: 10,
          offset: 0,
          privateOwnerUserId: ownerId,
        });
        assert.equal(owner.total, 3);
        const other = await store.listPending(ws.id, {
          limit: 10,
          offset: 0,
          privateOwnerUserId: otherId,
        });
        assert.equal(other.total, 1);
        assert.deepEqual(other.items.map((entry) => entry.resourceType), ["signal"]);

        const ownerHistory = await store.listHistory(ws.id, {
          limit: 10,
          offset: 0,
          privateOwnerUserId: ownerId,
        });
        assert.equal(ownerHistory.total, 3);
        assert.equal(ownerHistory.items[0]?.resourceType, "signal");
        const otherHistory = await store.listHistory(ws.id, {
          limit: 10,
          offset: 0,
          privateOwnerUserId: otherId,
        });
        assert.equal(otherHistory.total, 1);
        assert.deepEqual(
          otherHistory.items.map((entry) => entry.resourceType),
          ["signal"],
        );
      } finally {
        await close();
      }
    });

    test("ledger: TASK-010 review round-6 — a red-flag correction proposal (resourceType 'signal', inputs.visibility 'private') is owner-scoped the SAME way a Relation proposal is, and neither type's privacy leaks into the other's", async () => {
      const { db, close } = await createLocalDb();
      try {
        const [ws] = await db
          .insert(schema.workspaces)
          .values({ name: "test_fixture_mixed_private_types" })
          .returning({ id: schema.workspaces.id });
        assert.ok(ws);
        const redFlagOwner = "52000000-0000-4000-8000-000000000001";
        const relationOwner = "52000000-0000-4000-8000-000000000002";
        const otherMember = "52000000-0000-4000-8000-000000000003";
        const store = new DrizzleLedgerStore(db);
        // A red-flag correction proposal — TASK-010's own private marker, never "relation".
        await store.append({
          id: "53000000-0000-4000-8000-000000000001",
          workspaceId: ws.id,
          actorType: "agent",
          actorId: NIL_ACTOR,
          onBehalfOfType: "user",
          onBehalfOfId: redFlagOwner,
          action: "write",
          resourceType: "signal",
          inputs: { kind: "red_flag_correction_proposal", visibility: "private", governed: true, applied: false, summary: "x" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-18T00:00:02.000Z",
        });
        // A Relation proposal — RM4's own private marker, unrelated to inputs.visibility.
        await store.append({
          id: "53000000-0000-4000-8000-000000000002",
          workspaceId: ws.id,
          actorType: "user",
          actorId: relationOwner,
          action: "write",
          resourceType: "relation",
          inputs: { kind: "relationship_signal_evidence" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-18T00:00:01.000Z",
        });
        // A genuinely public/shared proposal — neither type, no visibility marker at all.
        await store.append({
          id: "53000000-0000-4000-8000-000000000003",
          workspaceId: ws.id,
          actorType: "agent",
          actorId: NIL_ACTOR,
          action: "write",
          resourceType: "touchpoint",
          inputs: {},
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-18T00:00:00.000Z",
        });

        const redFlagOwnerView = await store.listPending(ws.id, { limit: 10, offset: 0, privateOwnerUserId: redFlagOwner });
        assert.deepEqual(
          redFlagOwnerView.items.map((e) => e.id).sort(),
          ["53000000-0000-4000-8000-000000000001", "53000000-0000-4000-8000-000000000003"],
          "the red-flag owner sees their OWN red-flag proposal plus the shared one — never the relation proposal",
        );

        const relationOwnerView = await store.listPending(ws.id, { limit: 10, offset: 0, privateOwnerUserId: relationOwner });
        assert.deepEqual(
          relationOwnerView.items.map((e) => e.id).sort(),
          ["53000000-0000-4000-8000-000000000002", "53000000-0000-4000-8000-000000000003"],
          "the relation owner sees their OWN relation proposal plus the shared one — never the red-flag proposal",
        );

        const otherView = await store.listPending(ws.id, { limit: 10, offset: 0, privateOwnerUserId: otherMember });
        assert.deepEqual(
          otherView.items.map((e) => e.id),
          ["53000000-0000-4000-8000-000000000003"],
          "a THIRD member sees only the genuinely shared proposal — neither private type",
        );
      } finally {
        await close();
      }
    });

    test("ledger: JSON proposal ids cannot resolve or hide another proposal", async () => {
      const { db, close } = await createLocalDb();
      try {
        const [ws] = await db
          .insert(schema.workspaces)
          .values({ name: "test_fixture_ledger_reference_spoofing" })
          .returning({ id: schema.workspaces.id });
        assert.ok(ws);
        const store = new DrizzleLedgerStore(db);
        const victim = await store.append({
          id: "6a000000-0000-4000-8000-0000000000a1",
          workspaceId: ws.id,
          actorType: "user",
          actorId: "50000000-0000-4000-8000-000000000001",
          action: "write",
          resourceType: "relation",
          inputs: { kind: "relationship_signal_evidence" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-05T00:00:00.000Z",
        });
        const attackerProposal = await store.append({
          id: "6b000000-0000-4000-8000-0000000000b2",
          workspaceId: ws.id,
          actorType: "user",
          actorId: "50000000-0000-4000-8000-000000000002",
          action: "write",
          resourceType: "relation",
          inputs: { kind: "relationship_signal_evidence" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-05T00:00:01.000Z",
        });
        const attackerDecision = await store.append(
          decisionRow({
            id: "62000000-0000-4000-8000-000000000001",
            workspaceId: ws.id,
            actorId: "50000000-0000-4000-8000-000000000002",
            refLedgerId: attackerProposal.id,
            resourceType: "relation",
            inputs: { proposalId: victim.id },
            createdAt: "2026-07-05T00:00:02.000Z",
          }),
        );

        assert.equal(await store.decisionFor(victim.id), null);
        assert.equal(
          (await store.decisionFor(attackerProposal.id))?.id,
          attackerDecision.id,
        );
        assert.deepEqual(
          (await store.listPending(ws.id, { limit: 50, offset: 0 })).items.map(
            (entry) => entry.id,
          ),
          [victim.id],
        );
        await assert.rejects(
          () =>
            store.append({
              id: "62000000-0000-4000-8000-000000000002",
              workspaceId: ws.id,
              actorType: "user",
              actorId: NIL_ACTOR,
              action: "approve",
              resourceType: "relation",
              inputs: {},
              userDecision: "approve",
              policyResults: [],
              createdAt: "2026-07-05T00:00:03.000Z",
            }),
          /require refLedgerId/,
        );
      } finally {
        await close();
      }
    });

    test("ledger: domain proposalId input does not turn a root proposal into a decision row", async () => {
      const { db, close } = await createLocalDb();
      try {
        const [ws] = await db
          .insert(schema.workspaces)
          .values({ name: "test_fixture_domain_proposal_id" })
          .returning({ id: schema.workspaces.id });
        assert.ok(ws);
        const store = new DrizzleLedgerStore(db);
        const root = await store.append({
          id: "64000000-0000-4000-8000-000000000001",
          workspaceId: ws.id,
          actorType: "user",
          actorId: NIL_ACTOR,
          action: "write",
          resourceType: "signal",
          inputs: { proposalId: "65000000-0000-4000-8000-000000000001" },
          userDecision: null,
          policyResults: [],
          createdAt: "2026-07-05T00:00:00.000Z",
        });

        assert.equal(root.refLedgerId, undefined);
        assert.equal((await store.get(root.id))?.refLedgerId, undefined);
        assert.deepEqual(
          (await store.listPending(ws.id, { limit: 50, offset: 0 })).items.map(
            (entry) => entry.id,
          ),
          [root.id],
        );
      } finally {
        await close();
      }
    });

    const read = await store.get(written.id);
    assert.ok(read);
    assert.ok((written.appendSequence ?? 0) > 0);
    assert.equal(read!.appendSequence, written.appendSequence);
    assert.equal(read!.seed, "test_fixture_seed-1");
    assert.equal(read!.dataScope, "private");
    assert.deepEqual(read!.context, context);
  } finally {
    await close();
  }
});
