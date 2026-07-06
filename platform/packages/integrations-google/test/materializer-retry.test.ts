/**
 * IntakeMaterializer.applyApproved dual-write retry — the idempotency-key-and-retry
 * fix. Since upsertPersonIdentity/upsertPerson (ON CONFLICT DO UPDATE), commitEntity
 * (now ON CONFLICT DO NOTHING / no-op-on-duplicate) and recordExternal (ON CONFLICT
 * DO NOTHING) are all idempotent, applyApproved retries the WHOLE method body on a
 * transient failure rather than doing fine-grained per-step retry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { FixedClock, SeededRng, UuidGen, type Proposal, type RunCtx } from "@bridge/core";
import { createMemoryLocalPlane, type LocalPlane } from "@bridge/local";
import { InMemoryCanonicalIdentityStore } from "@bridge/db";

import { IntakeMaterializer, type IntakeDirective } from "../src/intake.js";

function ctx(): RunCtx {
  const clock = new FixedClock("2026-07-05T00:00:00.000Z");
  const rng = new SeededRng(7);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function resolvedProposal(directive: IntakeDirective): Proposal {
  return {
    id: "proposal-1",
    status: "applied",
    request: {
      workspaceId: "ws-1",
      actor: { type: "agent", id: "agent-intake", plane: "local" },
      action: "write",
      resourceType: "touchpoint",
      skill: "google.intake.stage",
      inputs: { directive },
    },
    authority: { allowed: true, reason: "test", basis: "role", dataScope: "all" },
    policyResults: [],
    output: { proposedOutput: { directive } },
  };
}

test("applyApproved recovers from a transient commitEntity failure via bounded retry (idempotent end state)", async () => {
  const localPlane: LocalPlane = createMemoryLocalPlane();
  const canonical = new InMemoryCanonicalIdentityStore();

  let commitCalls = 0;
  const realCommitEntity = localPlane.graph.commitEntity.bind(localPlane.graph);
  localPlane.graph.commitEntity = async (entry) => {
    commitCalls += 1;
    if (commitCalls === 1) {
      throw new Error("dummy_ transient pglite hiccup");
    }
    return realCommitEntity(entry);
  };

  const materializer = new IntakeMaterializer({ graph: localPlane.graph, canonical });

  const directive: IntakeDirective = {
    person: {
      localPersonId: "local-person-1",
      canonicalIdIfNew: "canon-person-1",
      fullName: "dummy_ Priya",
      emails: ["dummy_priya@example.com"],
      dedupKey: "dummy_priya@example.com",
    },
    entities: [
      {
        localId: "entity-1",
        kind: "touchpoint",
        personId: "local-person-1",
        payload: { touchpointKind: "email" },
        source: "gmail",
        sourceRecordId: "thread-1",
      },
    ],
    external: [{ source: "gmail", sourceRecordId: "thread-1", entityType: "touchpoint" }],
  };

  const applied = await materializer.applyApproved(resolvedProposal(directive), ctx());
  assert.equal(applied, true);

  // The whole dual-write body ran twice (attempt 1 failed on commitEntity, attempt 2
  // succeeded end to end) — but the end state has exactly one entity, no duplicates.
  assert.equal(commitCalls, 2, "commitEntity was retried after the first transient failure");
  const entities = await localPlane.graph.listEntities("ws-1", "touchpoint");
  assert.equal(entities.length, 1, "no duplicate entity after retry");
  assert.equal(entities[0]?.id, "entity-1");

  const people = await localPlane.graph.listPeople("ws-1");
  assert.equal(people.length, 1, "person upsert is idempotent across the retried attempts");

  await localPlane.close();
});

test("applyApproved gives up after exhausting retries and surfaces the error", async () => {
  const localPlane: LocalPlane = createMemoryLocalPlane();
  const canonical = new InMemoryCanonicalIdentityStore();

  localPlane.graph.commitEntity = async () => {
    throw new Error("dummy_ persistent failure");
  };

  const materializer = new IntakeMaterializer({ graph: localPlane.graph, canonical });

  const directive: IntakeDirective = {
    entities: [
      {
        localId: "entity-2",
        kind: "touchpoint",
        payload: { touchpointKind: "meeting" },
        source: "calendar",
        sourceRecordId: "event-1",
      },
    ],
    external: [{ source: "calendar", sourceRecordId: "event-1", entityType: "touchpoint" }],
  };

  await assert.rejects(
    () => materializer.applyApproved(resolvedProposal(directive), ctx()),
    /dummy_ persistent failure/,
  );

  await localPlane.close();
});
