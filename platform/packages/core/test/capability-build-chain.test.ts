/**
 * The governed capability-build chain (ADR-181).
 *
 * What these tests defend is not "the happy path works" — it is that each of
 * the four roles is CONFINED to its own junction. The failure this chain exists
 * to prevent is the quiet one: a capability that reached a human (or worse,
 * reached Active) without a stated reason, without a computed risk band, or
 * carrying a provenance it did not earn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BuildChainError,
  EVIDENCE_REQUIRED_BLOCKER,
  describeChain,
  draftCapability,
  readyForHumanApproval,
  recommendBuild,
  reviewDraft,
  type CapabilityManifest,
  type RecommendedState,
} from "../src/index.js";

const noDependencies = () => undefined;

function manifest(over: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    id: "cap-1",
    name: "Weekly network digest",
    version: "1.0.0",
    capabilityType: "automation",
    origin: "ai_generated",
    audience: "private",
    permissions: [{ resourceType: "signal", action: "write", dataScope: "private", egress: false }],
    connectors: [],
    dependencies: [],
    ...over,
  };
}

function recommended(over: Partial<Parameters<typeof recommendBuild>[0]> = {}): RecommendedState {
  return recommendBuild({
    actor: "internal_strategist",
    id: "rec-1",
    origin: "proactive",
    capabilityType: "automation",
    title: "Weekly network digest",
    rationale: "The user re-derives the same summary by hand every Monday.",
    ...over,
  });
}

function drafted(manifestOver: Partial<CapabilityManifest> = {}, state = recommended()) {
  return draftCapability({
    actor: "capability_builder",
    state,
    manifest: manifest(manifestOver),
    source: "model",
  });
}

test("the full chain: recommend, draft, review — and it ends at a human, not at Active", () => {
  const reviewed = reviewDraft({
    actor: "governance",
    state: drafted(),
    resolveDependency: noDependencies,
  });

  assert.equal(reviewed.phase, "reviewed");
  assert.ok(readyForHumanApproval(reviewed));
  assert.equal(reviewed.verdict.humanApprovalRequired, true);
  assert.deepEqual(reviewed.verdict.blockers, []);
  // The audit spine: the draft names the recommendation it answers.
  assert.equal(reviewed.draft.recommendationId, reviewed.recommendation.id);
});

test("no phase in the chain means 'approved' — the terminal machine state is a question", () => {
  // The structural claim, asserted rather than trusted to the doc comment: walk
  // the chain to its end and confirm the strongest thing you can hold is a
  // reviewed state. If an `approved`/`active` phase were ever added, this test
  // is where the intent gets re-litigated.
  const reviewed = reviewDraft({ actor: "governance", state: drafted(), resolveDependency: noDependencies });
  const phases = new Set([recommended().phase, drafted().phase, reviewed.phase]);
  assert.deepEqual([...phases].sort(), ["drafted", "recommended", "reviewed"]);
  assert.ok(!("approved" in reviewed));
});

test("each junction refuses an agent that is not its own", () => {
  // Governance cannot draft, the Builder cannot self-review, the Strategist
  // cannot build. Without this, "Governance intervenes at the right junction"
  // is a naming convention.
  assert.throws(
    () => recommendBuild({ actor: "capability_builder", id: "r", origin: "proactive", capabilityType: "skill", title: "t", rationale: "" }),
    BuildChainError,
  );
  assert.throws(
    () => draftCapability({ actor: "governance", state: recommended(), manifest: manifest(), source: "model" }),
    /only capability_builder may draft/,
  );
  assert.throws(
    () => reviewDraft({ actor: "capability_builder", state: drafted(), resolveDependency: noDependencies }),
    /only governance may review/,
  );
});

test("the Builder cannot self-review its way past a blocker", () => {
  // The specific escalation the actor check exists to stop: an agent that can
  // both produce a draft and clear it needs no approver at all.
  assert.throws(
    () => reviewDraft({ actor: "capability_builder", state: drafted({ origin: "built_in" }), resolveDependency: noDependencies }),
    BuildChainError,
  );
});

test("a draft of a different Capability type than was recommended is blocked", () => {
  // Substituting the type silently answers a question nobody asked. An Agent is
  // not a Database, and approving one is not approving the other.
  const result = reviewDraft({
    actor: "governance",
    state: drafted({ capabilityType: "agent" }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.phase, "blocked");
  assert.ok(!readyForHumanApproval(result));
  assert.match(result.verdict.blockers.join("\n"), /asked for a automation/);
});

test("an agent-written manifest claiming a higher-trust origin is blocked", () => {
  // approvals.ts ranks origins by trust tier, so `built_in` on a generated
  // manifest is a real privilege escalation, not a cosmetic mislabel.
  for (const origin of ["built_in", "template", "community", "user_code"] as const) {
    const result = reviewDraft({
      actor: "governance",
      state: drafted({ origin }),
      resolveDependency: noDependencies,
    });
    assert.equal(result.phase, "blocked", origin);
    assert.match(result.verdict.blockers.join("\n"), /misattributes provenance/);
  }
});

test("the verdict is computed, never supplied — an egress permission escalates on its own", () => {
  // Nothing in ReviewDraftArgs can lower this. The band comes from computeRisk
  // over the manifest the Builder actually wrote.
  const result = reviewDraft({
    actor: "governance",
    state: drafted({
      permissions: [{ resourceType: "record", action: "send", dataScope: "private", egress: true }],
    }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.verdict.compositeRisk, "external");
  assert.equal(result.verdict.approvalRequirement, "explicit_human");
});

test("a lethal trifecta in one capability escalates to external regardless of the composite band", () => {
  // All three legs can live in a single manifest; the union check is the same
  // one module/risk.ts uses, so there is one definition of the trifecta.
  const result = reviewDraft({
    actor: "governance",
    state: drafted({
      permissions: [
        { resourceType: "record", action: "read", dataScope: "private", egress: false },
        { resourceType: "external:fetch", action: "read", dataScope: "public", egress: false },
      ],
      connectors: [{ id: "smtp", externalSend: true }],
    }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.verdict.trifectaEscalated, true);
  assert.equal(result.verdict.effectiveRisk, "external");
  assert.equal(result.verdict.approvalRequirement, "explicit_human");
});

test("an executable draft that cannot be contained never reaches a human", () => {
  const result = reviewDraft({
    actor: "governance",
    state: drafted({
      execution: { executable: true, isolation: "none", sandbox: { network: false, filesystem: [], env: [] } },
    }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.phase, "blocked");
  assert.match(result.verdict.blockers.join("\n"), /sandbox floor not satisfied/);
});

test("a declared shell:execute primitive with no execution spec is blocked", () => {
  // The Builder saying "I'll shell out" while declaring a declarative
  // capability is the exact shape of an ungoverned code-execution surface.
  const state = draftCapability({
    actor: "capability_builder",
    state: recommended(),
    manifest: manifest(),
    primitivesUsed: ["shell:execute"],
    source: "model",
  });
  const result = reviewDraft({ actor: "governance", state, resolveDependency: noDependencies });
  assert.equal(result.phase, "blocked");
  assert.match(result.verdict.blockers.join("\n"), /sandbox-mandatory/);

  // Negative control: the same draft using only file primitives is not blocked
  // on this rule, so the blocker tracks the primitive rather than the presence
  // of any primitive at all.
  const fileOnly = draftCapability({
    actor: "capability_builder",
    state: recommended(),
    manifest: manifest(),
    primitivesUsed: ["file:read", "file:write"],
    source: "model",
  });
  assert.equal(reviewDraft({ actor: "governance", state: fileOnly, resolveDependency: noDependencies }).phase, "reviewed");
});

test("a retrospective recommendation with no citations is blocked; a proactive one is not", () => {
  // The Strategist's standing boundary — "missing evidence stays explicit,
  // never invented" — enforced at the junction rather than asked for in a
  // prompt. A proactive recommendation is openly a hypothesis and stays legal.
  const retro = reviewDraft({
    actor: "governance",
    state: drafted({}, recommended({ origin: "retrospective" })),
    resolveDependency: noDependencies,
  });
  assert.equal(retro.phase, "blocked");
  assert.ok(retro.verdict.blockers.includes(EVIDENCE_REQUIRED_BLOCKER));

  const cited = reviewDraft({
    actor: "governance",
    state: drafted({}, recommended({ origin: "retrospective", evidence: ["run 4f2 failed 3x on 2026-08-02"] })),
    resolveDependency: noDependencies,
  });
  assert.equal(cited.phase, "reviewed");

  const proactive = reviewDraft({ actor: "governance", state: drafted(), resolveDependency: noDependencies });
  assert.equal(proactive.phase, "reviewed");
});

test("an unresolvable dependency is treated as risky, not as absent", () => {
  const result = reviewDraft({
    actor: "governance",
    state: drafted({ dependencies: [{ manifestId: "not-installed", versionRange: "1.x" }] }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.verdict.compositeRisk, "operational");
});

test("a trust grant cannot lower the floor for an external draft", () => {
  const result = reviewDraft({
    actor: "governance",
    state: drafted({ permissions: [{ resourceType: "record", action: "send", dataScope: "all", egress: true }] }),
    resolveDependency: noDependencies,
    trustGrants: [{ capabilityClass: "automation", riskBand: "external", autoActivate: true, revokedAt: null }],
  });
  assert.equal(result.verdict.approvalRequirement, "explicit_human");
});

test("a blocked draft keeps its recommendation and reasons rather than being discarded", () => {
  // So the Builder can be asked to fix a named list instead of regenerating
  // blind — and so a refusal is auditable.
  const result = reviewDraft({
    actor: "governance",
    state: drafted({ capabilityType: "agent", origin: "template" }),
    resolveDependency: noDependencies,
  });
  assert.equal(result.phase, "blocked");
  assert.equal(result.recommendation.id, "rec-1");
  assert.equal(result.draft.manifest.id, "cap-1");
  assert.equal(result.verdict.blockers.length, 2);
});

test("describeChain names every actor and never claims activation", () => {
  const reviewed = reviewDraft({ actor: "governance", state: drafted(), resolveDependency: noDependencies });
  const line = describeChain(reviewed);
  for (const actor of ["Internal Strategist", "Capability Builder", "Governance", "Human"]) {
    assert.match(line, new RegExp(actor));
  }
  assert.match(line, /no capability is active until a person approves it/);

  const blocked = describeChain(
    reviewDraft({ actor: "governance", state: drafted({ origin: "built_in" }), resolveDependency: noDependencies }),
  );
  assert.match(blocked, /not sent to a human/);
});

test("the offline skeleton is labelled as such, not passed off as generated", () => {
  const state = draftCapability({
    actor: "capability_builder",
    state: recommended(),
    manifest: manifest(),
    source: "offline_skeleton",
  });
  assert.equal(state.draft.source, "offline_skeleton");
  const reviewed = reviewDraft({ actor: "governance", state, resolveDependency: noDependencies });
  assert.equal(reviewed.draft.source, "offline_skeleton");
});

test("a recommendation must be named", () => {
  assert.throws(() => recommended({ title: "   " }), /needs a title/);
});
