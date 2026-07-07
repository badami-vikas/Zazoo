/**
 * Slice C/D + E/F — social provider framework + read/write pipeline wiring.
 *
 * Tests the orchestration against the GovernedGate contract with a recording gate,
 * the unconfigured-provider seam (no live client/creds — real-data-only policy,
 * 2026-07-06: this seam sources nothing rather than fabricating content), and an
 * in-memory local quarantine. Proves:
 *  - read: with no live provider wired, sourcing is an honest no-op (zero items,
 *    zero proposals) — never invented posts/DMs;
 *  - write: the draft step never publishes; egress (external:send) fires only after
 *    a gate approval, and without a live client publish() honestly reports failure.
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

test("read: with no live provider wired, sourcing is an honest no-op (no fabricated items)", async () => {
  const gate = new RecordingGate();
  const quarantine = new MemQuarantine();
  const provider = resolveProvider("x", {}); // no creds => unconfigured seam
  assert.equal(provider.mode, "fixture");

  const results = await sourceToProposals({
    gate,
    provider,
    quarantine,
    workspaceId: "test_fixture_ws",
    actor,
    run,
  });

  // No live provider is wired, so there is nothing real to source — zero items,
  // zero proposals, zero quarantine entries. Never invented posts/DMs.
  assert.equal(results.length, 0);
  assert.equal(gate.proposals.length, 0);
  assert.equal(quarantine.entries.length, 0);
});

test("sourceToProposals: an unconfigured provider never populates the quarantine or gate", async () => {
  const gate = new RecordingGate();
  const quarantine = new MemQuarantine();
  const provider = resolveProvider("x", {}); // no creds => unconfigured seam
  assert.equal(provider.mode, "fixture");

  const results = await sourceToProposals({
    gate,
    provider,
    quarantine,
    workspaceId: "test_fixture_ws",
    actor,
    run,
  });

  assert.deepEqual(results, []);
});

test("resolveProvider: warns when falling back to the unconfigured seam (no live factory registered)", () => {
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

test("write: draft never publishes; egress fires only after gate approval; unconfigured publish reports failure honestly", async () => {
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
    workspaceId: "test_fixture_ws",
    actor,
    run,
  });

  // Proposed as external:send / share, drafted — and NOTHING published yet.
  assert.equal(gate.proposals.length, 1);
  assert.equal(gate.proposals[0]?.resourceType, "external:send");
  assert.equal(gate.proposals[0]?.action, "share");
  assert.equal(draft.status, "pending_review");
  assert.equal(publishCount, 0);

  // Approve → publish fires exactly once. No live client is wired for "x" in this
  // test, so the honest result is a reported failure (never a fabricated success).
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
  assert.equal(res.ok, false);
});

test("fixture provider: two drafts created before any publish get distinct draftIds", async () => {
  const provider = makeFixtureProvider("x", []);
  const first = await provider.draftAction({ kind: "post", text: "test_fixture_first" });
  const second = await provider.draftAction({ kind: "post", text: "test_fixture_second" });
  // Regression: draftId was previously derived from `published.length + 1`, which only
  // publish() mutates — two drafts before any publish shared the same draftId.
  assert.notEqual(first.draftId, second.draftId);
  assert.equal(first.draftId, "unconfigured_x_draft_1");
  assert.equal(second.draftId, "unconfigured_x_draft_2");
});
