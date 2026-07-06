import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  SeededRng,
  UuidGen,
  UniversalActionPipeline,
  InProcessRitualExecutor,
  InMemoryRoleStore,
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryPolicyStore,
  InMemoryLedger,
  InMemoryEventBus,
  InMemorySkillRegistry,
  InMemoryRitualRegistry,
  InMemoryRitualRunRecorder,
  InMemoryToolRegistry,
  RecordingVarianceAdjuster,
  intersectDataScope,
  AlreadyResolvedError,
  type PolicyFn,
  type RunCtx,
  type ActionRequest,
  type Skill,
} from "../src/index.js";

const WS = "ws-1";

/** A trivial skill that echoes its inputs as the proposed output. */
const echoSkill: Skill = {
  name: "echo",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

function harness(opts?: { policies?: PolicyFn[] }) {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const policies = new InMemoryPolicyStore(opts?.policies ?? []);
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(echoSkill);
  const variance = new RecordingVarianceAdjuster();

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies,
    skills,
    ledger,
    events,
    variance,
  });

  return { roles, agents, ephemeral, policies, ledger, events, skills, variance, pipeline };
}

function freshCtx(startISO = "2026-06-01T00:00:00.000Z", seed = 42): RunCtx {
  const clock = new FixedClock(startISO);
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function req(partial: Partial<ActionRequest>): ActionRequest {
  return {
    workspaceId: WS,
    actor: { type: "user", id: "u1" },
    action: "write",
    resourceType: "person",
    inputs: { full_name_override: "Ada" },
    skill: "echo",
    ...partial,
  };
}

test("deny-by-default: human with no grant is rejected", async () => {
  const h = harness();
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /deny-by-default/);
  // Rejection is still audited (append-only).
  assert.equal(h.ledger.entries.length, 1);
  assert.equal(h.ledger.entries[0]!.userDecision, null);
});

test("human with allow grant + no policy auto-applies and emits an event", async () => {
  const h = harness();
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "applied");
  assert.equal(h.events.events.length, 1);
  assert.equal(h.events.events[0]!.type, "person.write");
  // One ledger row, auto-decided.
  assert.equal(h.ledger.entries.length, 1);
  assert.equal(h.ledger.entries[0]!.userDecision, "auto");
});

test("agents always draft-then-approve even when authorized", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" } }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
  assert.equal(h.events.events.length, 0); // nothing committed yet
  assert.equal(h.ledger.entries[0]!.userDecision, null);
});

test("agent-floor DENY wins over an explicit allow grant", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-admin");
  h.agents.scope.set("agent-1", ["*"]);
  // Even a type-wide allow on ledger:write must not let an agent through.
  h.roles.roleGrants.set("role-admin", [
    { resourceType: "ledger", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" }, resourceType: "ledger" }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /agent-floor/);
});

test("capability_scope is a ceiling: role grant outside scope is denied", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["community:write"]); // scope does NOT include person
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" } }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /capability_scope/);
});

test("ephemeral grant authorizes an agent step, then drafts for review", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-empty");
  h.agents.scope.set("agent-1", ["*"]); // ceiling permits; role has no grant
  h.roles.roleGrants.set("role-empty", []);
  h.ephemeral.mint(
    { type: "agent", id: "agent-1" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
    "2026-06-01T01:00:00.000Z",
    "init-9",
  );
  const p = await h.pipeline.propose(
    req({
      actor: { type: "agent", id: "agent-1" },
      context: { type: "initiative", id: "init-9" },
    }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
  assert.equal(p.authority.basis, "ephemeral");
});

test("expired ephemeral grant does not authorize", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-empty");
  h.agents.scope.set("agent-1", ["*"]);
  h.roles.roleGrants.set("role-empty", []);
  h.ephemeral.mint(
    { type: "agent", id: "agent-1" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
    "2026-06-01T00:00:00.000Z", // expires exactly at clock start => not active
    "init-9",
  );
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" }, context: { type: "initiative", id: "init-9" } }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
});

test("policy require_approval forces a human draft even on auto path", async () => {
  const needsApproval: PolicyFn = (i) =>
    i.phase === "pre"
      ? { policyId: "pol-1", phase: "pre", effect: "require_approval", reason: "external comms" }
      : null;
  const h = harness({ policies: [needsApproval] });
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "pending_review");
});

test("policy block rejects before the skill runs", async () => {
  const blocker: PolicyFn = (i) =>
    i.phase === "pre"
      ? { policyId: "pol-block", phase: "pre", effect: "block", reason: "frozen workspace" }
      : null;
  const h = harness({ policies: [blocker] });
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(req({}), freshCtx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /policy\(pre\)/);
});

test("approve a pending proposal: appends a decision row, commits, emits", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" } }), ctx);
  assert.equal(p.status, "pending_review");

  const decided = await h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, ctx);
  assert.equal(decided.status, "applied");
  // Append-only: original proposal row + new decision row = 2 entries.
  assert.equal(h.ledger.entries.length, 2);
  assert.equal(h.ledger.entries[1]!.userDecision, "approve");
  assert.equal(h.ledger.entries[1]!.refLedgerId, p.id);
  // Original proposal row was NOT mutated.
  assert.equal(h.ledger.entries[0]!.userDecision, null);
  assert.equal(h.events.events.length, 1);
});

test("veto: records decision, feeds Variance Adjuster, commits nothing", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" } }), ctx);
  const decided = await h.pipeline.decide(p.id, "veto", { type: "user", id: "u1" }, ctx);
  assert.equal(decided.status, "rejected");
  assert.equal(h.events.events.length, 0); // nothing committed
  assert.equal(h.variance.observed.length, 1); // adjuster saw the veto
  assert.equal(h.variance.observed[0]!.userDecision, "veto");
});

test("edit decision commits the edited output with a from/to diff", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" } }), ctx);
  const decided = await h.pipeline.decide(p.id, "edit", { type: "user", id: "u1" }, ctx, { full_name_override: "Ada Lovelace" });
  assert.equal(decided.status, "applied");
  const row = h.ledger.entries[1]!;
  assert.equal(row.userDecision, "edit");
  assert.deepEqual(row.proposedOutput, { full_name_override: "Ada Lovelace" });
  assert.deepEqual(row.diff, {
    from: { full_name_override: "Ada" },
    to: { full_name_override: "Ada Lovelace" },
  });
});

test("a resolved proposal cannot be decided twice (append-only integrity)", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" } }), ctx);
  await h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, ctx);
  await assert.rejects(() => h.pipeline.decide(p.id, "veto", { type: "user", id: "u1" }, ctx), /already resolved/);
});

test("double-approve TOCTOU: two concurrent decide() calls on the same proposal — exactly one succeeds, one gets a typed AlreadyResolvedError (in-memory ledger)", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" }, inputs: { full_name_override: "dummy_Ada" } }),
    ctx,
  );
  assert.equal(p.status, "pending_review");

  // "Concurrent": both calls race to decide() the SAME pending proposal. The
  // in-memory ledger's append() performs an atomic (no-await-in-between)
  // check-and-mark, so exactly one of these two promises resolves and the other
  // rejects with AlreadyResolvedError — never both resolving (which would have
  // meant onApproved-style side effects firing twice, e.g. a double-sent email).
  const results = await Promise.allSettled([
    h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, ctx),
    h.pipeline.decide(p.id, "approve", { type: "user", id: "u2" }, ctx),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one decide() call succeeds");
  assert.equal(rejected.length, 1, "exactly one decide() call is rejected");
  const rejection = rejected[0] as PromiseRejectedResult;
  assert.ok(rejection.reason instanceof AlreadyResolvedError, "rejection is the typed AlreadyResolvedError");

  // Only ONE commit happened: exactly one event emitted (not two — the whole
  // point of closing the TOCTOU is that onApproved-style side effects fire once).
  assert.equal(h.events.events.length, 1);
  // Ledger: original proposal + exactly one resolving decision row.
  const resolving = h.ledger.entries.filter((e) => e.refLedgerId === p.id && e.userDecision !== null);
  assert.equal(resolving.length, 1);
});

test("agents may not approve: an agent decider is floor-denied at the review gate", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const ctx = freshCtx();
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" } }), ctx);
  assert.equal(p.status, "pending_review");
  // An in-platform agent — even a powerful one — can never be the approver.
  await assert.rejects(
    () => h.pipeline.decide(p.id, "approve", { type: "agent", id: "agent-1" }, ctx),
    /agent-floor/,
  );
  // The proposal itself is untouched: still pending, no *resolving* decision row,
  // nothing committed — but the blocked attempt IS audited (append-only spine), so a
  // second ledger row now exists recording the denied attempt (userDecision stays null,
  // so decisionFor() still correctly reports the proposal as unresolved).
  assert.equal(h.ledger.entries.length, 2);
  assert.equal(h.ledger.entries[0]!.userDecision, null);
  const auditRow = h.ledger.entries[1]!;
  assert.equal(auditRow.userDecision, null);
  assert.equal(auditRow.actorId, "agent-1");
  assert.equal(auditRow.refLedgerId, p.id);
  assert.match(String((auditRow.diff as { rejected?: string })?.rejected), /agent-floor/);
  assert.equal(h.events.events.length, 0);
  // A human approver still resolves it.
  const ok = await h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, ctx);
  assert.equal(ok.status, "applied");
});

test("decide() persists and replays the ORIGINAL dataScope + context, not '(replayed)'/dropped (audit completeness)", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.agents.tiers.set("agent-1", "all");
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow", dataScope: "all" },
  ]);
  const ctx = freshCtx();
  const originalContext = { type: "initiative" as const, id: "dummy_init-9", runId: "dummy_run-1" };
  const p = await h.pipeline.propose(
    req({
      actor: { type: "agent", id: "agent-1" },
      dataScope: "private",
      context: originalContext,
    }),
    ctx,
  );
  assert.equal(p.status, "pending_review");

  // The pending proposal's own ledger row already carries the original context/
  // dataScope (propose()'s #appendLedger threads it through) — not undefined.
  const proposalRow = h.ledger.entries[0]!;
  assert.deepEqual(proposalRow.dataScope, "private");
  assert.deepEqual(proposalRow.context, originalContext);

  const decided = await h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, ctx);
  assert.equal(decided.status, "applied");

  // The replayed ActionRequest decide() reconstructs (Proposal.request) carries the
  // SAME original context/dataScope — previously these were silently dropped.
  assert.deepEqual(decided.request.dataScope, "private");
  assert.deepEqual(decided.request.context, originalContext);
  // skill is still the literal "(replayed)" placeholder (decide() never re-invokes
  // a skill — the ledger never stored a skill name to replay in the first place),
  // but that placeholder no longer drags context/dataScope down with it.
  assert.equal(decided.request.skill, "(replayed)");

  // The decision ledger row itself also carries the original context/dataScope —
  // this is what makes the audit trail answer "what data tier did this touch?"
  // without reconstructing it from the request.
  const decisionRow = h.ledger.entries[1]!;
  assert.equal(decisionRow.userDecision, "approve");
  assert.deepEqual(decisionRow.dataScope, "private");
  assert.deepEqual(decisionRow.context, originalContext);
});

test("delegation: agent on-behalf-of a principal who lacks authority is denied", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  // principal u-principal has NO grants.
  const p = await h.pipeline.propose(
    req({
      actor: { type: "agent", id: "agent-1" },
      onBehalfOf: { type: "user", id: "u-principal", delegationId: "del-1" },
    }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /delegation/);
});

test("determinism: identical inputs + seed + clock produce identical ledger ids", async () => {
  async function run() {
    const h = harness();
    h.roles.direct.set("user:u1", [
      { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
    ]);
    await h.pipeline.propose(req({}), freshCtx());
    return h.ledger.entries.map((e) => e.id);
  }
  const a = await run();
  const b = await run();
  assert.deepEqual(a, b);
  // uuid-shaped (RFC-4122) — ids land in Postgres `uuid` columns (live-DB conformance).
  assert.match(a[0] ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("P2: runById loads a ritual config, merges params, runs it, records the run", async () => {
  const h = harness();
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const registry = new InMemoryRitualRegistry().register({
    id: "reconnect",
    name: "Reconnect Advisor",
    workspaceId: WS,
    steps: [
      { skill: "echo", action: "write", resourceType: "person", inputs: { note: "draft" } },
      { skill: "echo", action: "write", resourceType: "person" },
    ],
  });
  const recorder = new InMemoryRitualRunRecorder();
  const exec = new InProcessRitualExecutor(h.pipeline, { registry, recorder });

  const result = await exec.runById(
    { workspaceId: WS, ritualId: "reconnect", actor: { type: "user", id: "u1" }, params: { target: "p9" } },
    freshCtx(),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.proposals.length, 2);
  // params shallow-merged into each step's inputs.
  assert.deepEqual(result.proposals[0]!.output?.proposedOutput, { note: "draft", target: "p9" });
  assert.deepEqual(result.proposals[1]!.output?.proposedOutput, { target: "p9" });
  // run recorded as completed.
  const rec = recorder.runs.get(result.runId);
  assert.equal(rec?.status, "completed");
});

test("P2: runById throws for an unknown ritual id", async () => {
  const h = harness();
  const exec = new InProcessRitualExecutor(h.pipeline, { registry: new InMemoryRitualRegistry() });
  await assert.rejects(
    () => exec.runById({ workspaceId: WS, ritualId: "nope", actor: { type: "user", id: "u1" } }, freshCtx()),
    /not found/,
  );
});

test("skills allow-list: agent may not run a skill outside its non-empty allow-list", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  h.agents.skills.set("agent-1", ["draftIntro"]); // closed set, does NOT include 'echo'
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" }, skill: "echo" }), freshCtx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /not in agent allow-list/);
});

test("skills allow-list: empty list = unrestricted (agent still drafts)", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]);
  // no skills allow-list configured → unrestricted
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(req({ actor: { type: "agent", id: "agent-1" }, skill: "echo" }), freshCtx());
  assert.equal(p.status, "pending_review");
});

test("data-scope: intersect law (all=identity, public∩private=none)", () => {
  assert.equal(intersectDataScope("all", "public"), "public");
  assert.equal(intersectDataScope("all", "private"), "private");
  assert.equal(intersectDataScope("public", "public"), "public");
  assert.equal(intersectDataScope("public", "private"), "none");
  assert.equal(intersectDataScope("private", "none"), "none");
});

test("data-scope: human granted 'public' may request public, but 'private' is denied", async () => {
  const h = harness();
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "read", effect: "allow", dataScope: "public" },
  ]);
  const ctx = freshCtx(); // one ctx → monotonic ids across both proposes
  // request public → allowed, effective public
  const ok = await h.pipeline.propose(req({ action: "read", dataScope: "public" }), ctx);
  assert.equal(ok.status, "applied");
  assert.equal(ok.authority.dataScope, "public");
  // request private → data-scope conflict → rejected
  const bad = await h.pipeline.propose(req({ action: "read", dataScope: "private" }), ctx);
  assert.equal(bad.status, "rejected");
  assert.match(bad.rejectionReason ?? "", /data-scope conflict/);
});

test("data-scope: agent ceiling 'public' narrows an 'all' grant to public", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-reader");
  h.agents.scope.set("agent-1", ["person:read"]);
  h.agents.tiers.set("agent-1", "public"); // the agent's data ceiling (dropdown on the agent)
  h.roles.roleGrants.set("role-reader", [
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" }, // grant = all
  ]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" }, action: "read", dataScope: "all" }),
    freshCtx(),
  );
  assert.equal(p.status, "pending_review");
  assert.equal(p.authority.dataScope, "public"); // ceiling clamped all → public
});

test("data-scope: agent ceiling 'public' + step requests 'private' → denied", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-reader");
  h.agents.scope.set("agent-1", ["person:read"]);
  h.agents.tiers.set("agent-1", "public");
  h.roles.roleGrants.set("role-reader", [
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
  ]);
  const p = await h.pipeline.propose(
    req({ actor: { type: "agent", id: "agent-1" }, action: "read", dataScope: "private" }),
    freshCtx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /data-scope conflict/);
});

test("data-scope: a ritual step's dataScope flows into the decision", async () => {
  const h = harness();
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "read", effect: "allow", dataScope: "all" },
  ]);
  const registry = new InMemoryRitualRegistry().register({
    id: "scan",
    name: "Scan",
    workspaceId: WS,
    steps: [{ skill: "echo", action: "read", resourceType: "person", dataScope: "public" }],
  });
  const exec = new InProcessRitualExecutor(h.pipeline, { registry });
  const result = await exec.runById(
    { workspaceId: WS, ritualId: "scan", actor: { type: "user", id: "u1" } },
    freshCtx(),
  );
  assert.equal(result.proposals[0]!.authority.dataScope, "public");
});

test("P2: runTool loads a tool composition and runs it through the pipeline", async () => {
  const h = harness();
  h.roles.direct.set("user:u1", [
    { resourceType: "community", resourceId: null, action: "read", effect: "allow", dataScope: "all" },
  ]);
  const toolRegistry = new InMemoryToolRegistry().register({
    id: "community-pulse",
    name: "Community Pulse",
    workspaceId: WS,
    steps: [{ skill: "echo", action: "read", resourceType: "community", dataScope: "public" }],
  });
  const exec = new InProcessRitualExecutor(h.pipeline, { toolRegistry });
  const result = await exec.runTool(
    { workspaceId: WS, ritualId: "community-pulse", actor: { type: "user", id: "u1" } },
    freshCtx(),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.proposals[0]!.authority.dataScope, "public");
});

test("RitualExecutor: runs steps in order and halts on a rejected step", async () => {
  const h = harness();
  h.agents.assumed.set("agent-1", "role-writer");
  h.agents.scope.set("agent-1", ["person:write"]); // can write person, NOT community
  h.roles.roleGrants.set("role-writer", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);
  const exec = new InProcessRitualExecutor(h.pipeline);
  const result = await exec.run(
    {
      workspaceId: WS,
      ritualId: "ritual-1",
      actor: { type: "agent", id: "agent-1" },
      steps: [
        { skill: "echo", action: "write", resourceType: "person", inputs: { a: 1 } },
        { skill: "echo", action: "write", resourceType: "community", inputs: { b: 2 } }, // out of scope
        { skill: "echo", action: "write", resourceType: "person", inputs: { c: 3 } },
      ],
    },
    freshCtx(),
  );
  assert.equal(result.status, "halted");
  assert.equal(result.haltedAtStep, 1);
  assert.equal(result.proposals.length, 2); // stopped before step 3
  assert.equal(result.proposals[0]!.status, "pending_review");
  assert.equal(result.proposals[1]!.status, "rejected");
});
