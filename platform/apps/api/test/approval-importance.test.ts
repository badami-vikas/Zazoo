/**
 * Home's approval ranking (TASK-097): the rule is data on the brief, computed
 * from the proposal itself — external side effect > write > read, untrusted
 * content above trusted inside a tier, older above newer inside that.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { UNKNOWN_LABEL, createTaintLabel, type Proposal } from "@bridge/core";

import { compareApprovalImportance, rankPendingProposal } from "../src/routers/approval-importance.js";

const UNTRUSTED = createTaintLabel({
  trust: "untrusted", source: "web", sensitivity: "public", instructionRisk: "data",
  origin: { source: "web", ref: "test_fixture", hash: "0", transform: "none" },
});

function proposal(
  action: Proposal["request"]["action"],
  resourceType: Proposal["request"]["resourceType"],
  opts: { createdAt?: string; untrusted?: boolean } = {},
) {
  return {
    request: {
      organizationId: "org", actor: { type: "agent" as const, id: "a" }, action, resourceType,
      inputs: {}, skill: "s",
    },
    output: { proposedOutput: null, taintLabel: opts.untrusted ? UNTRUSTED : UNKNOWN_LABEL },
    createdAt: opts.createdAt ?? "2026-09-04T00:00:00.000Z",
  };
}

test("rankPendingProposal: the four tiers", () => {
  assert.equal(rankPendingProposal(proposal("read", "external:fetch")).tier, "external");
  assert.equal(rankPendingProposal(proposal("share", "event")).tier, "external");
  assert.equal(rankPendingProposal(proposal("write", "signal")).tier, "write");
  assert.equal(rankPendingProposal(proposal("read", "person")).tier, "read");
  assert.equal(rankPendingProposal(proposal("write", "signal", { untrusted: true })).untrusted, true);
  assert.equal(rankPendingProposal(proposal("write", "signal")).untrusted, false);
});

test("compareApprovalImportance: external > write > read, untrusted first, older first", () => {
  const rank = (p: ReturnType<typeof proposal>) => ({ ...p, importance: rankPendingProposal(p) });
  const newerRead = rank(proposal("read", "person", { createdAt: "2026-09-04T02:00:00.000Z" }));
  const olderRead = rank(proposal("read", "person", { createdAt: "2026-09-04T01:00:00.000Z" }));
  const trustedWrite = rank(proposal("write", "signal"));
  const untrustedWrite = rank(proposal("write", "signal", { untrusted: true }));
  const egress = rank(proposal("read", "external:fetch", { createdAt: "2026-09-04T09:00:00.000Z" }));
  const sorted = [newerRead, trustedWrite, olderRead, untrustedWrite, egress].sort(compareApprovalImportance);
  assert.deepEqual(sorted, [egress, untrustedWrite, trustedWrite, olderRead, newerRead]);
});
