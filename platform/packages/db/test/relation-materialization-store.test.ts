import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  createLocalDb,
  DrizzleLedgerStore,
  DrizzleRelationMaterializationStore,
  schema,
} from "../src/index.js";

test("Relation materialization effects survive restart and remain owner-scoped", async () => {
  const dataDir = await mkdtemp(
    join(tmpdir(), "test_fixture_bridge-relation-effects-"),
  );
  let close: (() => Promise<void>) | undefined;
  try {
    const first = await createLocalDb({ dataDir });
    close = first.close;
    const [workspace] = await first.db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_relation_effect_workspace" })
      .returning({ id: schema.workspaces.id });
    const users = await first.db
      .insert(schema.users)
      .values([
        { email: "test_fixture_relation_effect_owner@example.com" },
        { email: "test_fixture_relation_effect_other@example.com" },
      ])
      .returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.equal(users.length, 2);
    const ownerUserId = users[0]!.id;
    const otherUserId = users[1]!.id;
    const input = {
      workspaceId: workspace.id,
      ownerUserId,
      proposalLedgerId: "10000000-0000-4000-8000-000000000001",
      decisionLedgerId: "10000000-0000-4000-8000-000000000002",
    };
    const firstStore = new DrizzleRelationMaterializationStore(first.db);
    const [ensured, repeatedEnsure] = await Promise.all([
      firstStore.ensure(input),
      firstStore.ensure(input),
    ]);
    assert.equal(ensured.id, repeatedEnsure.id);
    const firstAttempt = await firstStore.beginAttempt(
      input,
      new Date("2026-07-16T10:00:00.000Z"),
    );
    assert.equal(firstAttempt.started, true);
    assert.equal(firstAttempt.effect.status, "pending");
    assert.equal(firstAttempt.effect.attemptCount, 1);
    assert.ok(firstAttempt.effect.leaseToken);
    await first.close();
    close = undefined;

    const reopened = await createLocalDb({ dataDir });
    close = reopened.close;
    const restartedStore = new DrizzleRelationMaterializationStore(reopened.db);
    const afterRestart = await restartedStore.getByProposal(
      workspace.id,
      ownerUserId,
      input.proposalLedgerId,
    );
    assert.equal(afterRestart?.status, "pending");
    assert.equal(
      await restartedStore.getByProposal(
        workspace.id,
        otherUserId,
        input.proposalLedgerId,
      ),
      null,
    );
    assert.equal(
      (
        await restartedStore.listOutstanding(workspace.id, ownerUserId, {
          limit: 10,
        })
      ).length,
      1,
    );

    const failed = await restartedStore.markFailed(
      afterRestart!.id,
      workspace.id,
      ownerUserId,
      firstAttempt.effect.leaseToken!,
      "test_fixture_transient_failure",
      new Date("2026-07-16T10:01:00.000Z"),
      new Date("2026-07-16T10:02:00.000Z"),
    );
    assert.equal(failed.status, "failed");
    assert.equal(
      (
        await restartedStore.listRetryable(workspace.id, ownerUserId, {
          limit: 10,
          now: new Date("2026-07-16T10:01:30.000Z"),
        })
      ).length,
      0,
    );
    assert.equal(
      (
        await restartedStore.listRetryable(workspace.id, ownerUserId, {
          limit: 10,
          now: new Date("2026-07-16T10:02:00.000Z"),
        })
      ).length,
      1,
    );

    const retry = await restartedStore.beginAttempt(
      input,
      new Date("2026-07-16T10:02:00.000Z"),
    );
    assert.equal(retry.effect.attemptCount, 2);
    assert.ok(retry.effect.leaseToken);
    const applied = await restartedStore.markApplied(
      retry.effect.id,
      workspace.id,
      ownerUserId,
      retry.effect.leaseToken!,
      3,
      new Date("2026-07-16T10:02:01.000Z"),
    );
    assert.equal(applied.status, "applied");
    assert.equal(applied.relationCount, 3);
    assert.deepEqual(
      await restartedStore.listOutstanding(workspace.id, ownerUserId, {
        limit: 10,
      }),
      [],
    );
    const repeatedApplied = await restartedStore.beginAttempt(
      input,
      new Date("2026-07-16T10:03:00.000Z"),
    );
    assert.equal(repeatedApplied.started, false);
    assert.equal(repeatedApplied.effect.attemptCount, 2);
  } finally {
    if (close) await close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Relation materialization leases serialize callers and recover an interrupted final attempt", async () => {
  const local = await createLocalDb();
  try {
    const [workspace] = await local.db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_relation_effect_lease_workspace" })
      .returning({ id: schema.workspaces.id });
    const [owner] = await local.db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_effect_lease_owner@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.ok(owner);
    const input = {
      workspaceId: workspace.id,
      ownerUserId: owner.id,
      proposalLedgerId: "11000000-0000-4000-8000-000000000001",
      decisionLedgerId: "11000000-0000-4000-8000-000000000002",
    };
    const firstStore = new DrizzleRelationMaterializationStore(local.db);
    const secondStore = new DrizzleRelationMaterializationStore(local.db);
    const startedAt = new Date("2026-07-16T12:00:00.000Z");
    const claims = await Promise.all([
      firstStore.beginAttempt(input, startedAt),
      secondStore.beginAttempt(input, startedAt),
    ]);
    assert.equal(claims.filter((claim) => claim.started).length, 1);
    assert.equal(claims.filter((claim) => !claim.started).length, 1);
    let active = claims.find((claim) => claim.started);
    assert.ok(active?.effect.leaseToken);
    assert.equal(active.effect.attemptCount, 1);

    for (let attempt = 1; attempt < active.effect.maxAttempts; attempt += 1) {
      const failureAt = new Date(startedAt.getTime() + attempt * 1_000);
      await firstStore.markFailed(
        active.effect.id,
        workspace.id,
        owner.id,
        active.effect.leaseToken,
        `test_fixture_interrupted_attempt_${attempt}`,
        failureAt,
        failureAt,
      );
      active = await firstStore.beginAttempt(input, failureAt);
      assert.equal(active.started, true);
      assert.ok(active.effect.leaseToken);
      assert.equal(active.effect.attemptCount, attempt + 1);
    }

    const interruptedLeaseToken = active.effect.leaseToken;
    const activeLease = await secondStore.beginAttempt(
      input,
      new Date(active.effect.lastAttemptedAt!.getTime() + 1_000),
    );
    assert.equal(activeLease.started, false);
    assert.equal(activeLease.effect.attemptCount, active.effect.maxAttempts);

    const recovered = await secondStore.beginAttempt(
      input,
      new Date(active.effect.leaseExpiresAt!.getTime() + 1),
    );
    assert.equal(recovered.started, true);
    assert.equal(recovered.effect.attemptCount, active.effect.maxAttempts);
    assert.equal(recovered.effect.leaseRecoveryCount, 1);
    assert.ok(recovered.effect.leaseToken);
    assert.notEqual(recovered.effect.leaseToken, interruptedLeaseToken);
    await assert.rejects(
      () =>
        firstStore.markApplied(
          active!.effect.id,
          workspace.id,
          owner.id,
          interruptedLeaseToken!,
          2,
          new Date("2026-07-16T12:06:00.000Z"),
        ),
      /could not be applied/i,
    );
    let finalRecovery = recovered;
    for (
        let recoveryCount = 2;
        recoveryCount <= recovered.effect.maxLeaseRecoveries;
        recoveryCount += 1
    ) {
        finalRecovery = await secondStore.beginAttempt(
          input,
          new Date(finalRecovery.effect.leaseExpiresAt!.getTime() + 1),
        );
        assert.equal(finalRecovery.started, true);
        assert.equal(finalRecovery.effect.attemptCount, active.effect.maxAttempts);
        assert.equal(
          finalRecovery.effect.leaseRecoveryCount,
          recoveryCount,
        );
        assert.ok(finalRecovery.effect.leaseToken);
    }
    const recoveryBudgetExhaustedAt = new Date(
        finalRecovery.effect.leaseExpiresAt!.getTime() + 1,
    );
    assert.deepEqual(
        await firstStore.listRetryable(workspace.id, owner.id, {
          limit: 10,
          now: recoveryBudgetExhaustedAt,
        }),
        [],
    );
    const automaticExhausted = await firstStore.beginAttempt(
        input,
        recoveryBudgetExhaustedAt,
    );
    assert.equal(automaticExhausted.started, false);
    const ownerRetry = await secondStore.beginAttempt(
        input,
        recoveryBudgetExhaustedAt,
        { allowExhausted: true },
    );
    assert.equal(ownerRetry.started, true);
    assert.equal(ownerRetry.effect.attemptCount, 6);
    assert.equal(ownerRetry.effect.maxAttempts, 6);
    assert.equal(ownerRetry.effect.leaseRecoveryCount, 0);
    assert.ok(ownerRetry.effect.leaseToken);
    const ownerFailureAt = new Date(
        recoveryBudgetExhaustedAt.getTime() + 1,
    );
    await secondStore.markFailed(
        ownerRetry.effect.id,
        workspace.id,
        owner.id,
        ownerRetry.effect.leaseToken,
        "test_fixture_owner_retry_failure",
        ownerFailureAt,
        null,
    );
    const exhaustedAfterOwnerFailure = await firstStore.beginAttempt(
        input,
        new Date(ownerFailureAt.getTime() + 1),
    );
    assert.equal(exhaustedAfterOwnerFailure.started, false);
    const secondOwnerRetry = await secondStore.beginAttempt(
        input,
        new Date(ownerFailureAt.getTime() + 1),
        { allowExhausted: true },
    );
    assert.equal(secondOwnerRetry.started, true);
    assert.equal(secondOwnerRetry.effect.attemptCount, 7);
    assert.equal(secondOwnerRetry.effect.maxAttempts, 7);
    assert.ok(secondOwnerRetry.effect.leaseToken);
    const applied = await secondStore.markApplied(
        secondOwnerRetry.effect.id,
        workspace.id,
        owner.id,
        secondOwnerRetry.effect.leaseToken,
        2,
        new Date(ownerFailureAt.getTime() + 2),
    );
    assert.equal(applied.status, "applied");
  } finally {
    await local.close();
  }
});

test("approved Relation discovery is oldest-first and outstanding retries paginate completely", async () => {
  const local = await createLocalDb();
  try {
    const [workspace] = await local.db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_relation_discovery_workspace" })
      .returning({ id: schema.workspaces.id });
    const [owner] = await local.db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_discovery_owner@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.ok(owner);
    const relationRows: (typeof schema.ledger.$inferInsert)[] = [];
    for (let index = 1; index <= 101; index += 1) {
      const suffix = String(index).padStart(12, "0");
      const proposalId = `12000000-0000-4000-8000-${suffix}`;
      const decisionId = `13000000-0000-4000-8000-${suffix}`;
      const inputs = { kind: "relationship_signal_evidence" };
      relationRows.push(
        {
          id: proposalId,
          appendSequence: index * 2 - 1,
          workspaceId: workspace.id,
          actorType: "user",
          actorId: owner.id,
          action: "write",
          resourceType: "relation",
          inputs,
          policyResults: [],
          dataScope: "private",
          createdAt: new Date(
            Date.parse("2026-07-15T00:00:00.000Z") + index * 2,
          ),
        },
        {
          id: decisionId,
          appendSequence: index * 2,
          workspaceId: workspace.id,
          actorType: "user",
          actorId: owner.id,
          action: "write",
          resourceType: "relation",
          inputs,
          proposedOutput: inputs,
          userDecision: "approve",
          refLedgerId: proposalId,
          policyResults: [],
          dataScope: "private",
          createdAt: new Date(
            Date.parse("2026-07-15T00:00:00.000Z") + index * 2 + 1,
          ),
        },
      );
    }
    const newerRows: (typeof schema.ledger.$inferInsert)[] = Array.from(
      { length: 125 },
      (_, index) => ({
        id: `14000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        appendSequence: 1_000 + index,
        workspaceId: workspace.id,
        actorType: "user",
        actorId: owner.id,
        action: "read",
        resourceType: "signal",
        inputs: {},
        policyResults: [],
        createdAt: new Date(
          Date.parse("2026-07-16T00:00:00.000Z") + index,
        ),
      }),
    );
    await local.db.insert(schema.ledger).values([...relationRows, ...newerRows]);

    const effectStore = new DrizzleRelationMaterializationStore(local.db);
    assert.equal(
      await effectStore.discoverApproved(workspace.id, owner.id, { limit: 1 }),
      1,
    );
    assert.equal(
      (
        await effectStore.listOutstanding(workspace.id, owner.id, {
          limit: 1,
        })
      )[0]?.proposalLedgerId,
      "12000000-0000-4000-8000-000000000001",
      "the oldest approval must be discovered before newer bounded pages",
    );
    let discovered = 1;
    for (;;) {
      const count = await effectStore.discoverApproved(workspace.id, owner.id, {
        limit: 20,
      });
      discovered += count;
      if (count === 0) break;
    }
    assert.equal(discovered, 101);
    const firstPage = await effectStore.listOutstandingPage(
      workspace.id,
      owner.id,
      { limit: 100 },
    );
    assert.equal(firstPage.items.length, 100);
    assert.ok(firstPage.nextCursor);
    const secondPage = await effectStore.listOutstandingPage(
      workspace.id,
      owner.id,
      { limit: 100, cursor: firstPage.nextCursor },
    );
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.equal(
      new Set(
        [...firstPage.items, ...secondPage.items].map(
          (effect) => effect.proposalLedgerId,
        ),
      ).size,
      101,
      "cursor pagination must not skip or duplicate outstanding effects",
    );

    const ledgerStore = new DrizzleLedgerStore(local.db, {
      defaultWorkspaceId: workspace.id,
    });

    assert.equal(
      (await ledgerStore.get("12000000-0000-4000-8000-000000000001"))
        ?.workspaceId,
      workspace.id,
    );
  } finally {
    await local.close();
  }
});

test("Drizzle ledger and Relation discovery establish tenant context under forced RLS", async () => {
  const local = await createLocalDb();
  let roleActive = false;
  try {
    const [workspace] = await local.db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_relation_rls_workspace" })
      .returning({ id: schema.workspaces.id });
    const owners = await local.db
      .insert(schema.users)
      .values([
        { email: "test_fixture_relation_rls_owner@example.com" },
        { email: "test_fixture_relation_rls_other_owner@example.com" },
      ])
      .returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.equal(owners.length, 2);
    const owner = owners[0]!;
    const otherOwner = owners[1]!;
    await local.db.execute(sql`CREATE ROLE test_fixture_relation_app`);
    await local.db.execute(sql`
      GRANT USAGE ON SCHEMA public, app_private TO test_fixture_relation_app
    `);
    await local.db.execute(sql`
      GRANT SELECT, INSERT, UPDATE ON TABLE
        ledger,
        relation_materialization_effects
      TO test_fixture_relation_app
    `);
    await local.db.execute(sql`
      GRANT USAGE, SELECT, UPDATE ON SEQUENCE ledger_append_sequence_seq
      TO test_fixture_relation_app
    `);
    await local.db.execute(sql`SET ROLE test_fixture_relation_app`);
    roleActive = true;

    const ledgerStore = new DrizzleLedgerStore(local.db, {
      defaultWorkspaceId: workspace.id,
    });
    const proposal = await ledgerStore.append({
      id: "15000000-0000-4000-8000-000000000001",
      workspaceId: workspace.id,
      actorType: "user",
      actorId: owner.id,
      action: "write",
      resourceType: "relation",
      inputs: { kind: "relationship_signal_evidence" },
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-16T15:00:00.000Z",
    });
    const decision = await ledgerStore.append({
      id: "15000000-0000-4000-8000-000000000002",
      workspaceId: workspace.id,
      actorType: "user",
      actorId: owner.id,
      action: proposal.action,
      resourceType: "relation",
      inputs: proposal.inputs,
      proposedOutput: proposal.inputs,
      userDecision: "approve",
      policyResults: [],
      refLedgerId: proposal.id,
      createdAt: "2026-07-16T15:00:01.000Z",
    });
    const otherProposal = await ledgerStore.append({
      id: "15000000-0000-4000-8000-000000000003",
      workspaceId: workspace.id,
      actorType: "user",
      actorId: otherOwner.id,
      action: "write",
      resourceType: "relation",
      inputs: { kind: "relationship_signal_evidence" },
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-16T15:00:02.000Z",
    });
    await ledgerStore.append({
      id: "15000000-0000-4000-8000-000000000004",
      workspaceId: workspace.id,
      actorType: "user",
      actorId: otherOwner.id,
      action: otherProposal.action,
      resourceType: "relation",
      inputs: otherProposal.inputs,
      proposedOutput: otherProposal.inputs,
      userDecision: "approve",
      policyResults: [],
      refLedgerId: otherProposal.id,
      createdAt: "2026-07-16T15:00:03.000Z",
    });
    assert.equal((await ledgerStore.get(proposal.id))?.id, proposal.id);
    assert.equal(
      (await ledgerStore.decisionFor(proposal.id))?.id,
      decision.id,
    );
    assert.deepEqual(await local.db.select().from(schema.ledger), []);

    const effectStore = new DrizzleRelationMaterializationStore(local.db);
    const firstOwnerPage = await effectStore.listApprovedOwners(workspace.id, {
      limit: 1,
    });
    assert.ok(firstOwnerPage.nextCursor);
    const secondOwnerPage = await effectStore.listApprovedOwners(workspace.id, {
      limit: 1,
      afterOwnerUserId: firstOwnerPage.nextCursor,
    });
    assert.deepEqual(
      new Set([
        ...firstOwnerPage.ownerUserIds,
        ...secondOwnerPage.ownerUserIds,
      ]),
      new Set([owner.id, otherOwner.id]),
    );
    assert.equal(secondOwnerPage.nextCursor, null);
    assert.equal(
      await effectStore.discoverApproved(workspace.id, owner.id, { limit: 10 }),
      1,
    );
    assert.equal(
      (
        await effectStore.listOutstanding(workspace.id, owner.id, {
          limit: 10,
        })
      )[0]?.decisionLedgerId,
      decision.id,
    );
  } finally {
    if (roleActive) await local.db.execute(sql`RESET ROLE`);
    await local.close();
  }
});
