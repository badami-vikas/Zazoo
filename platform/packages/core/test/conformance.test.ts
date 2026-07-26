/**
 * Governance Conformance Suite (backlog #22).
 *
 * Asserts the platform INVARIANTS from docs/wiki/architecture.md as a labeled,
 * runnable set. Each test maps to one stated invariant. This is the guardrail
 * that fails loudly if a refactor weakens the spine. (The home-organization
 * invariant requires the live DB and is covered by the live-DB conformance run.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  SeededRng,
  UuidGen,
  UniversalActionPipeline,
  InProcessAutomationExecutor,
  InMemoryAutomationRegistry,
  InMemoryRoleStore,
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryPolicyStore,
  InMemoryLedger,
  InMemoryEventBus,
  InMemorySkillRegistry,
  RecordingVarianceAdjuster,
  agentFloorDeny,
  planeGate,
  hashTaintValue,
  labelAtSource,
  type RunCtx,
  type Skill,
} from "../src/index.js";

const WS = "ws-1";
const echo: Skill = { name: "echo", async run(i) { return { proposedOutput: i }; } };

function build() {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const variance = new RecordingVarianceAdjuster();
  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies: new InMemoryPolicyStore([]),
    skills: new InMemorySkillRegistry().register(echo),
    ledger,
    events,
    variance,
  });
  return { roles, agents, ephemeral, ledger, events, variance, pipeline };
}
/**
 * Mirrors context.ts's `makeContextFactory`, which attaches a `human_input`-derived
 * taintLabel to `ctx.run` for every authenticated request. This conformance harness
 * builds the RunCtx directly (bypassing that factory), so it must reproduce the SAME
 * label a genuine authenticated request always carries — otherwise ADR-142's
 * fail-closed unknown-taint-axis quarantine (taint.ts's `evaluateTaintSink`)
 * misclassifies a real authenticated turn as unlabeled/untrusted and blocks the
 * `skill_execution` sink for the `echo` skill (which does not set
 * `executionClass: "pure_data"`).
 */
function ctx(): RunCtx {
  const clock = new FixedClock("2026-06-01T00:00:00.000Z");
  const rng = new SeededRng(7);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelAtSource("human_input", {
      ref: "test-fixture:authenticated-caller",
      valueHash: hashTaintValue("test-fixture-authenticated-caller"),
      sensitivity: "organization",
      instructionRisk: "none",
    }),
  };
}
function grantWrite(roles: InMemoryRoleStore, actorKey: string) {
  roles.direct.set(actorKey, [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
}
const baseReq = {
  organizationId: WS,
  actor: { type: "user" as const, id: "u1" },
  action: "write" as const,
  resourceType: "person" as const,
  inputs: { full_name_override: "Ada" },
  skill: "echo",
};

test("INVARIANT deny-default: no grant ⇒ rejected", async () => {
  const h = build();
  const p = await h.pipeline.propose(baseReq, ctx());
  assert.equal(p.status, "rejected");
});

test("INVARIANT all-mutation-via-pipeline: a committed action ALWAYS leaves a ledger row", async () => {
  const h = build();
  grantWrite(h.roles, "user:u1");
  await h.pipeline.propose(baseReq, ctx());
  assert.equal(h.ledger.entries.length, 1);
  assert.equal(h.ledger.entries[0]!.userDecision, "auto");
});

test("INVARIANT ledger append-only: the proposal row is never mutated by a decision", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["person:write"]);
  h.roles.roleGrants.set("r1", [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
  const c = ctx();
  const p = await h.pipeline.propose({ ...baseReq, actor: { type: "agent", id: "a1" } }, c);
  await h.pipeline.decide(p.id, "approve", { type: "user", id: "u1" }, c);
  assert.equal(h.ledger.entries.length, 2); // proposal + decision, both appended
  assert.equal(h.ledger.entries[0]!.userDecision, null); // original untouched
});

test("INVARIANT agent-floor is non-removable: deny stands even with a type-wide allow", async () => {
  const h = build();
  h.agents.assumed.set("a1", "admin");
  h.agents.scope.set("a1", ["*"]);
  h.roles.roleGrants.set("admin", [{ resourceType: "role", resourceId: null, action: "write", effect: "allow" }]);
  const p = await h.pipeline.propose(
    { ...baseReq, actor: { type: "agent", id: "a1" }, resourceType: "role" },
    ctx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /agent-floor/);
  // unit-level: the floor function itself denies independent of grants
  assert.ok(agentFloorDeny({ type: "agent", id: "a1" }, "write", "ledger"));
  assert.equal(agentFloorDeny({ type: "user", id: "u1" }, "write", "ledger"), null);
});

test("INVARIANT governed agentic: agents draft, humans approve (no agent auto-commit)", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["person:write"]);
  h.roles.roleGrants.set("r1", [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
  const p = await h.pipeline.propose({ ...baseReq, actor: { type: "agent", id: "a1" } }, ctx());
  assert.equal(p.status, "pending_review");
  assert.equal(h.events.events.length, 0);
});

test("INVARIANT approvals are human-only: an agent may NEVER resolve a proposal", async () => {
  const h = build();
  h.agents.assumed.set("a1", "admin");
  h.agents.scope.set("a1", ["*"]); // even a maximally-scoped agent
  h.roles.roleGrants.set("admin", [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
  const c = ctx();
  const p = await h.pipeline.propose({ ...baseReq, actor: { type: "agent", id: "a1" } }, c);
  assert.equal(p.status, "pending_review");
  // The Approvals decision is agent-floor-protected: an agent decider is denied.
  await assert.rejects(
    () => h.pipeline.decide(p.id, "approve", { type: "agent", id: "a1" }, c),
    /agent-floor/,
  );
  assert.equal(h.events.events.length, 0); // nothing committed
  // Unit-level: the floor denies an agent the `approve` action on the ledger.
  assert.ok(agentFloorDeny({ type: "agent", id: "a1" }, "approve", "ledger"));
  assert.equal(agentFloorDeny({ type: "user", id: "u1" }, "approve", "ledger"), null);
});

test("INVARIANT veto tunes params not code: a veto reaches the Variance Adjuster, commits nothing", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["person:write"]);
  h.roles.roleGrants.set("r1", [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
  const c = ctx();
  const p = await h.pipeline.propose({ ...baseReq, actor: { type: "agent", id: "a1" } }, c);
  await h.pipeline.decide(p.id, "veto", { type: "user", id: "u1" }, c);
  assert.equal(h.variance.observed.at(-1)?.userDecision, "veto");
  assert.equal(h.events.events.length, 0);
});

test("INVARIANT determinism: same seed + clock ⇒ identical ledger ids (replayable)", async () => {
  async function run() {
    const h = build();
    grantWrite(h.roles, "user:u1");
    await h.pipeline.propose(baseReq, ctx());
    return h.ledger.entries[0]!.id;
  }
  assert.equal(await run(), await run());
});

test("INVARIANT data-scope: requesting a tier you weren't granted is denied", async () => {
  const h = build();
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow", dataScope: "public" },
  ]);
  const p = await h.pipeline.propose({ ...baseReq, dataScope: "private" }, ctx());
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /data-scope conflict/);
});

test("INVARIANT local-first gate: a LOCAL agent may not reach the internet (must request)", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["*"]);
  h.roles.roleGrants.set("r1", [{ resourceType: "external:fetch", resourceId: null, action: "execute", effect: "allow" }]);
  // Default plane = local; even with a wide allow, egress is structurally denied.
  const p = await h.pipeline.propose(
    { ...baseReq, actor: { type: "agent", id: "a1" }, action: "execute", resourceType: "external:fetch" },
    ctx(),
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /local-first gate/);
  // Unit: the gate denies local→egress and permits cloud→egress, independent of grants.
  assert.ok(planeGate({ type: "agent", id: "a1" }, "external:fetch")); // local (default) denied
  assert.equal(planeGate({ type: "agent", id: "a1", plane: "cloud" }, "external:fetch"), null); // cloud sources
});

test("INVARIANT local-first gate: a CLOUD agent SOURCES internet data (egress allowed under grants)", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["external:fetch:execute"]);
  h.roles.roleGrants.set("r1", [{ resourceType: "external:fetch", resourceId: null, action: "execute", effect: "allow" }]);
  const p = await h.pipeline.propose(
    { ...baseReq, actor: { type: "agent", id: "a1", plane: "cloud" }, action: "execute", resourceType: "external:fetch" },
    ctx(),
  );
  assert.equal(p.status, "pending_review"); // governed draft, not rejected
});

test("INVARIANT local-first gate: a CLOUD agent may NOT read the private/local tier (clamped to public)", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["person:read"]);
  h.roles.roleGrants.set("r1", [
    { resourceType: "person", resourceId: null, action: "read", effect: "allow", dataScope: "private" },
  ]);
  const p = await h.pipeline.propose(
    { ...baseReq, actor: { type: "agent", id: "a1", plane: "cloud" }, action: "read", resourceType: "person", dataScope: "private" },
    ctx(),
  );
  assert.equal(p.status, "rejected"); // cloud ceiling = public; private is unreachable from egress
  assert.match(p.rejectionReason ?? "", /data-scope/);
});

test("INVARIANT every Automation step is governed (a denied step halts the Run)", async () => {
  const h = build();
  h.agents.assumed.set("a1", "r1");
  h.agents.scope.set("a1", ["person:write"]); // not community
  h.roles.roleGrants.set("r1", [{ resourceType: "person", resourceId: null, action: "write", effect: "allow" }]);
  const registry = new InMemoryAutomationRegistry().register({
    id: "automation-1",
    name: "Governed Automation",
    organizationId: WS,
    agentId: "a1",
    agentPlane: "local",
    steps: [{ skill: "echo", action: "write", resourceType: "community", inputs: {} }],
  });
  const exec = new InProcessAutomationExecutor(h.pipeline, { registry });
  const res = await exec.runById(
    {
      organizationId: WS,
      automationId: "automation-1",
    },
    ctx(),
  );
  assert.equal(res.status, "halted");
});
