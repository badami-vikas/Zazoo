/**
 * Slice C/D + E/F — social provider framework + read/write pipeline wiring.
 *
 * Tests the orchestration against the GovernedGate contract with a recording gate,
 * the fixture provider seam, and an in-memory local quarantine. Proves:
 *  - read: capture → local quarantine → pending Touchpoint proposals, with the
 *    private body kept OUT of the proposal (residency);
 *  - write: the draft step never publishes; egress (external:send) fires only after
 *    a gate approval.
 * The gate's own authority + agent-floor enforcement is covered by @bridge/core.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Actor, ActionRequest, Decision, Proposal, RunCtx } from "@bridge/core";
import type { GovernedGate } from "../src/social/gate.js";
import type { SocialProvider, SourcedItem } from "../src/social/provider.js";
import { resolveProvider } from "../src/social/registry.js";
import { sourceToProposals, type QuarantineStore } from "../src/social/read-pipeline.js";
import { approveAndPublish, draftOutbound } from "../src/social/write-pipeline.js";

class RecordingGate implements GovernedGate {
  readonly proposals: ActionRequest[] = [];
  readonly decisions: { proposalId: string; decision: Decision }[] = [];
  async propose(request: ActionRequest, _run: RunCtx): Promise<Proposal> {
    this.proposals.push(request);
    const id = `prop_${this.proposals.length}`;
    // draft-then-approve: nothing auto-commits.
    return {
      id,
      status: "pending_review",
      request,
      authority: { allowed: true, reason: "fake", basis: "principal", dataScope: "private" },
      policyResults: [],
    } as Proposal;
  }
  async decide(proposalId: string, decision: Decision, _run: RunCtx): Promise<unknown> {
    this.decisions.push({ proposalId, decision });
    return { ok: true };
  }
}

class MemQuarantine implements QuarantineStore {
  readonly entries: { provider: string; item: SourcedItem }[] = [];
  async put(entry: { provider: string; item: SourcedItem }): Promise<string> {
    this.entries.push(entry);
    return `local_${this.entries.length}`;
  }
}

const run = {} as RunCtx; // the gate contract ignores run in these tests
const actor: Actor = { type: "agent", id: "dummy_integration_agent", plane: "cloud" };

test("read: source → local quarantine → pending Touchpoint proposals; private body stays local", async () => {
  const gate = new RecordingGate();
  const quarantine = new MemQuarantine();
  const provider = resolveProvider("x", {}); // no creds => fixture seam
  assert.equal(provider.mode, "fixture");

  const results = await sourceToProposals({
    gate,
    provider,
    quarantine,
    workspaceId: "dummy_ws",
    actor,
    run,
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.proposal.status === "pending_review"));
  for (const req of gate.proposals) {
    assert.equal(req.resourceType, "touchpoint");
    assert.equal(req.action, "write");
    assert.equal(req.dataScope, "private");
    // Residency: the raw private body must NEVER ride the proposal.
    assert.ok(!JSON.stringify(req.inputs).includes("direct message body"));
  }
  // The body IS captured locally in quarantine.
  assert.equal(quarantine.entries.length, 2);
  assert.ok(quarantine.entries.some((e) => e.item.text.includes("direct message body")));
});

test("write: draft never publishes; egress fires only after gate approval", async () => {
  const gate = new RecordingGate();
  const base = resolveProvider("x", {});
  let publishCount = 0;
  const provider: SocialProvider = {
    ...base,
    publish: async (a) => {
      publishCount += 1;
      return base.publish(a);
    },
  };

  const draft = await draftOutbound({
    gate,
    provider,
    action: { kind: "post", text: "dummy_outbound post" },
    workspaceId: "dummy_ws",
    actor,
    run,
  });

  // Proposed as external:send / share, drafted — and NOTHING published yet.
  assert.equal(gate.proposals.length, 1);
  assert.equal(gate.proposals[0]?.resourceType, "external:send");
  assert.equal(gate.proposals[0]?.action, "share");
  assert.equal(draft.status, "pending_review");
  assert.equal(publishCount, 0);

  // Approve → publish fires exactly once.
  const res = await approveAndPublish({
    gate,
    provider,
    proposalId: draft.proposalId,
    drafted: draft.drafted,
    run,
  });
  assert.equal(gate.decisions.length, 1);
  assert.equal(gate.decisions[0]?.decision, "approve");
  assert.equal(publishCount, 1);
  assert.equal(res.ok, true);
});
