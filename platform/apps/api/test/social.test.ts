/**
 * Slice C/D + E/F — social provider framework + read/write pipeline wiring.
 *
 * Tests the orchestration against the GovernedGate contract with a recording gate,
 * the fixture provider seam, and an in-memory local quarantine. Proves:
 *  - read: capture → local quarantine → pending Event proposals, with the
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
import { makeFixtureProvider } from "../src/social/fixtures.js";
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
const actor: Actor = { type: "agent", id: "test_fixture_integration_agent", plane: "cloud" };

test("read: an unconfigured (no live provider) seam sources nothing — an honest empty result, never fabricated items", async () => {
  const gate = new RecordingGate();
  const quarantine = new MemQuarantine();
  const provider = resolveProvider("x", {}); // no creds => unconfigured seam
  assert.equal(provider.mode, "fixture");

  const results = await sourceToProposals({
    gate,
    provider,
    quarantine,
    organizationId: "test_fixture_ws",
    actor,
    run,
  });

  // No live credentials => no real data to source => zero proposals, zero
  // quarantine entries. Per the real-data-only policy this must be an honest
  // empty result, not synthesized posts/DMs standing in for real content.
  assert.equal(results.length, 0);
  assert.equal(gate.proposals.length, 0);
  assert.equal(quarantine.entries.length, 0);
});

test("sourceToProposals: with a real sourced item, proposal inputs.mode reflects the provider mode", async () => {
  const gate = new RecordingGate();
  const quarantine = new MemQuarantine();
  const item: SourcedItem = {
    sourceId: "live_item_1",
    kind: "post",
    occurredAt: "2026-06-01T12:00:00Z",
    text: "a real sourced post body (private, local-only)",
    counterparty: { handle: "handle1", name: "Real Person" },
    raw: {},
  };
  const provider: SocialProvider = {
    id: "x",
    mode: "live",
    oauthScopes: [],
    async sourceItems() {
      return [item];
    },
    async draftAction(action) {
      return { ...action, provider: "x", draftId: "live_draft_1" };
    },
    async publish(action) {
      return { ok: true, externalId: `live_published_${action.draftId}` };
    },
  };

  const results = await sourceToProposals({
    gate,
    provider,
    quarantine,
    organizationId: "test_fixture_ws",
    actor,
    run,
  });

  // Every proposal's inputs record the provider mode, so the audit trail can
  // always answer "was this fixture or live data?" without reading code.
  for (const req of gate.proposals) {
    assert.equal((req.inputs as { mode?: string }).mode, "live");
    // Residency: the raw private body must NEVER ride the proposal.
    assert.ok(!JSON.stringify(req.inputs).includes("a real sourced post body"));
  }
  for (const r of results) {
    assert.equal(r.mode, "live");
  }
  // The body IS captured locally in quarantine.
  assert.equal(quarantine.entries.length, 1);
  assert.ok(quarantine.entries.some((e) => e.item.text.includes("a real sourced post body")));
});

test("resolveProvider: warns when falling back to the fixture seam (no live factory registered)", () => {
  const warnCalls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    const provider = resolveProvider("facebook", {}); // no live factory registered for "facebook" in this test module
    assert.equal(provider.mode, "fixture");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnCalls.length, 1);
  const [message] = warnCalls[0]!;
  assert.match(String(message), /"facebook".*no live provider registered/);
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
    action: { kind: "post", text: "test_fixture_outbound post" },
    organizationId: "test_fixture_ws",
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

test("unconfigured-seam provider: two drafts created before any publish get distinct draftIds", async () => {
  const provider = makeFixtureProvider("x", []);
  const first = await provider.draftAction({ kind: "post", text: "test_fixture_first" });
  const second = await provider.draftAction({ kind: "post", text: "test_fixture_second" });
  // Regression: draftId was previously derived from `published.length + 1`, which only
  // publish() mutates — two drafts before any publish shared "unconfigured_x_draft_1".
  assert.notEqual(first.draftId, second.draftId);
  assert.equal(first.draftId, "unconfigured_x_draft_1");
  assert.equal(second.draftId, "unconfigured_x_draft_2");
});
