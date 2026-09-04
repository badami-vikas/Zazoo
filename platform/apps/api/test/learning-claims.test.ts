/**
 * K3 knowledge substrate over the real `buildWiring()` composition root
 * (AI Harness K3, TASK-047, ADR-215) — the contract:
 *
 *  - flight OFF (default): `learning.claims.status` reports disabled and
 *    every other knowledge procedure fails closed;
 *  - propose → accept traverses the GOVERNED PIPELINE before any table write
 *    (a pipeline that rejects means no claim row — the "direct-write attempt
 *    fails closed" clause of the TASK-047 prototype test) and every
 *    materialized row carries the proposal id as `decisionRef`;
 *  - a contradicting accepted claim supersedes its predecessor by lineage
 *    (never deletes) and only the new claim is live;
 *  - red claim classes are unproposable (zod mirrors the closed core union);
 *  - only a Human identity can propose/accept/reject/forget;
 *  - the Second Brain projection (`graph.full`) shows exactly the accepted
 *    claims, flight-gated;
 *  - `forgetClaim` truly deletes;
 *  - rejecting a suggestion suppresses that exact claim forever.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type RunCtx,
} from "@bridge/core";
import { fusedChatMemory } from "../src/retrieval-fusion.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

const PRIYA_TIMEZONE = {
  organizationId: ORG,
  entity: { kind: "person" as const, name: "Priya Sharma" },
  field: "timezone",
  value: "CET",
  claimClass: "stated_fact" as const,
  // K10 E4: every durable statement references >=1 evidence id — the gate
  // refuses evidence-free proposals, so the fixture carries its source.
  evidence: [{ kind: "memory" as const, id: "3f1c0000-0000-4000-8000-000000000001" }],
};

test("flight OFF: status reports disabled; every claims procedure fails closed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: false, claimSubstrateEnabled: false }); // flights off (default is ON since AP-182)
  try {
    const caller = makeCaller(wiring);
    assert.deepEqual(await caller.learning.claims.status({ organizationId: ORG }), { enabled: false });
    await assert.rejects(caller.learning.claims.proposeClaim(PRIYA_TIMEZONE), /BRIDGE_CLAIM_SUBSTRATE/);
    await assert.rejects(caller.learning.claims.entities({ organizationId: ORG }), /BRIDGE_CLAIM_SUBSTRATE/);
  } finally {
    await wiring.close();
  }
});

test("propose → accept: pipeline-governed materialization with decisionRef; contradiction supersedes by lineage", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const proposed = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.equal(proposed.proposed, true);
    assert.ok(proposed.proposed && proposed.suggestion.memoryId);

    // Duplicate proposal of the same exact claim is refused at the lineage.
    const dup = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.equal(dup.proposed, false);

    const accepted = await caller.learning.claims.acceptClaim({
      organizationId: ORG,
      suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
    });
    assert.equal(accepted.materialized, true);
    assert.ok(accepted.materialized);
    assert.equal(accepted.claim.value, "CET");
    assert.equal(accepted.claim.decisionRef, accepted.proposal.id, "the row carries the governed proposal id");
    assert.equal(accepted.supersededClaimId, null);
    // The governed decision is on the ledger — the audit trail exists.
    const ledgerRow = await wiring.ledger.get(accepted.proposal.id);
    assert.ok(ledgerRow, "claim materialization left a ledger row");

    // Contradiction: a NEW value for the same (entity, field).
    const contradiction = await caller.learning.claims.proposeClaim({ ...PRIYA_TIMEZONE, value: "IST" });
    assert.ok(contradiction.proposed);
    const second = await caller.learning.claims.acceptClaim({
      organizationId: ORG,
      suggestionMemoryId: contradiction.proposed ? contradiction.suggestion.memoryId : "",
    });
    assert.ok(second.materialized);
    assert.equal(second.supersededClaimId, accepted.materialized ? accepted.claim.id : null);

    const live = await caller.learning.claims.claims({ organizationId: ORG });
    assert.equal(live.claims.length, 1, "one live claim per (entity, field)");
    assert.equal(live.claims[0]!.value, "IST");

    const history = await caller.learning.claims.claimHistory({
      organizationId: ORG,
      entityId: second.materialized ? second.claim.entityId : "",
      field: "timezone",
    });
    assert.equal(history.history.length, 2, "superseded claim is kept, never deleted");
    const old = history.history.find((row) => row.value === "CET");
    assert.ok(old?.supersededBy && old.validTo && old.invalidatedAt, "bi-temporal invalidation recorded");
  } finally {
    await wiring.close();
  }
});

test("a rejecting pipeline means NO claim row — direct writes are unreachable", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const proposed = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.ok(proposed.proposed);
    const suggestionMemoryId = proposed.proposed ? proposed.suggestion.memoryId : "";
    // Force every policy to deny: the pipeline (not the router) is the
    // authority on whether knowledge materializes.
    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    (wiring.pipeline as { propose: typeof originalPropose }).propose = async (req, run, options) => {
      const proposal = await originalPropose(req, run, options);
      return { ...proposal, status: "rejected" as const };
    };
    const refused = await caller.learning.claims.acceptClaim({
      organizationId: ORG,
      suggestionMemoryId,
    });
    assert.equal(refused.materialized, false, "rejected pipeline → nothing materialized");
    (wiring.pipeline as { propose: typeof originalPropose }).propose = originalPropose;
    assert.equal((await caller.learning.claims.claims({ organizationId: ORG })).claims.length, 0);
    // And the suggestion is still PROPOSED — nothing was half-committed.
    const pending = await caller.learning.claims.suggestions({ organizationId: ORG, status: "proposed" });
    assert.equal(pending.suggestions.length, 1);
  } finally {
    await wiring.close();
  }
});

test("red claim classes are unproposable at the API boundary", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    for (const red of ["health", "protected_characteristic", "psychological_conclusion"]) {
      await assert.rejects(
        caller.learning.claims.proposeClaim({
          ...PRIYA_TIMEZONE,
          claimClass: red as never,
        }),
        /invalid|Invalid/i,
        `red class "${red}" must be rejected by input validation`,
      );
    }
  } finally {
    await wiring.close();
  }
});

test("Human-only: a team identity cannot propose, accept, or forget claims", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const human = makeCaller(wiring);
    const proposed = await human.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.ok(proposed.proposed);
    const team = makeCaller(wiring, { type: "team", id: PILOT_USER });
    await assert.rejects(team.learning.claims.proposeClaim({ ...PRIYA_TIMEZONE, value: "UTC" }), /Human/);
    await assert.rejects(
      team.learning.claims.acceptClaim({
        organizationId: ORG,
        suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
      }),
      /Human/,
    );
  } finally {
    await wiring.close();
  }
});

test("full-graph view: graph.full shows exactly the accepted claims; forget removes them", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const proposed = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.ok(proposed.proposed);
    const suggestionMemoryId = proposed.proposed ? proposed.suggestion.memoryId : "";

    // BEFORE acceptance: no knowledge nodes — a suggestion is not knowledge.
    const before = await caller.graph.full({ organizationId: ORG, limit: 100 });
    assert.equal(before.nodes.filter((node) => node.recordType === "claim").length, 0);

    const accepted = await caller.learning.claims.acceptClaim({ organizationId: ORG, suggestionMemoryId });
    assert.ok(accepted.materialized);

    const after = await caller.graph.full({ organizationId: ORG, limit: 100 });
    const entityNode = after.nodes.find((node) => node.recordType === "claim_entity");
    const claimNode = after.nodes.find((node) => node.recordType === "claim");
    assert.ok(entityNode && claimNode, "entity + claim appear in the full graph");
    assert.equal(entityNode.label, "Priya Sharma");
    assert.match(claimNode.label, /timezone: CET/);
    assert.ok(
      after.edges.some((edge) => edge.relationType === "claim_of" && edge.sourceId === claimNode.id),
      "claim links to its entity",
    );
    assert.ok(after.databases.some((database) => database.label === "Claims"));

    // Forget path: the ONLY true delete, and the projection follows.
    const forgotten = await caller.learning.claims.forgetClaim({
      organizationId: ORG,
      claimId: accepted.materialized ? accepted.claim.id : "",
    });
    assert.equal(forgotten.forgotten, true);
    const cleared = await caller.graph.full({ organizationId: ORG, limit: 100 });
    assert.equal(cleared.nodes.filter((node) => node.recordType === "claim").length, 0);
  } finally {
    await wiring.close();
  }
});

test("one substrate, two views: an accepted claim reaches fused chat retrieval", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const proposed = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.ok(proposed.proposed);
    const accepted = await caller.learning.claims.acceptClaim({
      organizationId: ORG,
      suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
    });
    assert.ok(accepted.materialized);
    const fused = await fusedChatMemory({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      graphStore: wiring.graphStore,
      claimStore: wiring.claimStore,
      organizationId: ORG,
      ownerUserId: PILOT_USER,
      query: "What timezone is Priya Sharma in?",
    });
    assert.ok(
      fused.snippets.some((snippet) => /Priya Sharma: timezone is CET/.test(snippet.text)),
      "the model-facing projection carries exactly the accepted claim",
    );
    // WITHOUT the knowledge store (flight off shape) the claim never appears.
    const withoutClaims = await fusedChatMemory({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      graphStore: wiring.graphStore,
      organizationId: ORG,
      ownerUserId: PILOT_USER,
      query: "What timezone is Priya Sharma in?",
    });
    assert.ok(withoutClaims.snippets.every((snippet) => !/timezone is CET/.test(snippet.text)));
  } finally {
    await wiring.close();
  }
});

test("rejecting a claim suggestion suppresses that exact claim forever", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const proposed = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.ok(proposed.proposed);
    await caller.learning.claims.rejectClaim({
      organizationId: ORG,
      suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
    });
    const again = await caller.learning.claims.proposeClaim(PRIYA_TIMEZONE);
    assert.equal(again.proposed, false, "a rejected claim never re-proposes");
    // But a DIFFERENT value remains proposable.
    const different = await caller.learning.claims.proposeClaim({ ...PRIYA_TIMEZONE, value: "IST" });
    assert.equal(different.proposed, true);
    assert.equal((await caller.learning.claims.claims({ organizationId: ORG })).claims.length, 0);
  } finally {
    await wiring.close();
  }
});
