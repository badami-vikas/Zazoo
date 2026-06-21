import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FixedClock, SeededRng, UuidGen,
  UniversalActionPipeline,
  InMemoryRoleStore, InMemoryAgentStore, InMemoryEphemeralStore,
  InMemoryPolicyStore, InMemoryLedger, InMemoryEventBus,
  InMemorySkillRegistry, RecordingVarianceAdjuster,
  stageCapture,
  type RunCtx, type ActionRequest,
} from "../src/index.js";

const WS = "ws-1";
const USER = "u1";

function harness() {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const policies = new InMemoryPolicyStore([]);
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(stageCapture);
  const variance = new RecordingVarianceAdjuster();
  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" }, policies, skills, ledger, events, variance,
  });
  // The signed-in user may write touchpoints + signals on the private tier.
  roles.direct.set(`user:${USER}`, [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
  ]);
  return { roles, agents, ledger, events, pipeline };
}
function ctx(): RunCtx {
  const c = new FixedClock("2026-06-20T00:00:00.000Z");
  const r = new SeededRng(7);
  return { clock: c, rng: r, ids: new UuidGen(c, r) };
}
function captureReq(partial: Partial<ActionRequest> = {}): ActionRequest {
  return {
    workspaceId: WS,
    actor: { type: "user", id: USER, plane: "local" },
    action: "write",
    resourceType: "touchpoint",
    dataScope: "private",
    skill: "stageCapture",
    inputs: { local_media_id: "m1", kind: "photo", caption: "dummy_whiteboard", ocrText: "dummy_roadmap Q3" },
    ...partial,
  };
}

test("stageCapture proposes a Touchpoint referencing the local media id (no blob)", async () => {
  const h = harness();
  const c = ctx();
  // A human with an allow grant + no policy auto-applies; assert the proposed Touchpoint shape.
  const p = await h.pipeline.propose(captureReq(), c);
  assert.equal(p.status, "applied");
  const out = p.output?.proposedOutput as Record<string, unknown>;
  assert.equal(out.type, "touchpoint");
  assert.equal(out.local_media_id, "m1");
  assert.match(String(out.text), /Captured a photo/);
  // The blob is never in the output/ledger — only a local reference.
  assert.equal(JSON.stringify(p.output).includes("blob"), false);
});

test("agent capture drafts for review, approve appends a ledger decision row", async () => {
  const h = harness();
  h.agents.assumed.set("cam-agent", "role-cam");
  h.agents.scope.set("cam-agent", ["touchpoint:write"]);
  h.agents.tiers.set("cam-agent", "private");
  h.roles.roleGrants.set("role-cam", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
  ]);
  const c = ctx();
  const p = await h.pipeline.propose(
    captureReq({ actor: { type: "agent", id: "cam-agent", plane: "local" } }), c,
  );
  assert.equal(p.status, "pending_review");
  const decided = await h.pipeline.decide(p.id, "approve", c);
  assert.equal(decided.status, "applied");
  assert.equal(h.ledger.entries.length, 2); // proposal + decision (append-only)
  assert.equal(h.ledger.entries[1]!.userDecision, "approve");
});

test("local plane may not egress: external:fetch is denied (private cannot cross the gate)", async () => {
  const h = harness();
  const c = ctx();
  const p = await h.pipeline.propose(
    captureReq({ resourceType: "external:fetch", action: "execute", skill: "stageCapture" }), c,
  );
  assert.equal(p.status, "rejected");
  assert.match(p.rejectionReason ?? "", /local-first gate|local plane may not reach/);
});

test("uncertain person link is filed as a Signal, never an auto person-link", async () => {
  const h = harness();
  const c = ctx();
  // A possible_link Signal is a separate governed proposal (resourceType signal).
  const p = await h.pipeline.propose(
    captureReq({
      resourceType: "signal",
      skill: "stageCapture",
      inputs: { local_media_id: "m1", kind: "photo", signal: "possible_link", candidate: "dummy_Asha Rao" },
    }),
    c,
  );
  assert.equal(p.status, "applied");
  const out = p.output?.proposedOutput as Record<string, unknown>;
  assert.equal(out.type, "signal");
  assert.equal(out.signal, "possible_link");
});
