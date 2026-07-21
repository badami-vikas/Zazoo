import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InMemoryRoleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  hashTaintValue,
  labelAtSource,
  type RunCtx,
} from "@bridge/core";
import {
  buildWiring,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";

function runCtx(seed: number): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelAtSource("human_input", {
      ref: `restart-test:${seed}`,
      valueHash: hashTaintValue(seed),
      sensitivity: "organization",
      instructionRisk: "none",
    }),
  };
}

function grantShare(wiring: Wiring): void {
  assert.ok(wiring.roles instanceof InMemoryRoleStore);
  wiring.roles.direct.set(`user:${PILOT_USER}`, [
    {
      resourceType: "event",
      resourceId: null,
      action: "share",
      effect: "allow",
    },
  ]);
}

test("runtime taint and sink trace survive a file-backed two-process restart", async () => {
  const localDir = mkdtempSync(join(tmpdir(), "bridge-task015-restart-"));
  let first: Wiring | null = null;
  let second: Wiring | null = null;
  try {
    first = await buildWiring({ localDir });
    grantShare(first);
    const sourceLabel = labelAtSource("web_search", {
      ref: "https://example.com/evidence",
      valueHash: hashTaintValue("bounded public evidence"),
      sensitivity: "public",
      instructionRisk: "data",
    });
    const proposed = await first.pipeline.propose(
      {
        organizationId: PILOT_ORGANIZATION,
        actor: { type: "user", id: PILOT_USER, plane: "local" },
        action: "share",
        resourceType: "event",
        inputs: { summary: "bounded typed evidence" },
        taintLabel: sourceLabel,
        skill: "stageMutation",
      },
      runCtx(1),
    );
    assert.equal(proposed.status, "pending_review");
    const proposalId = proposed.id;
    const firstTrace = await first.taintAudit.listSinkTraces(
      PILOT_ORGANIZATION,
      proposalId,
    );
    assert.equal(firstTrace.length, 1);
    assert.equal(firstTrace[0]?.policy, "require_human");
    const firstPersisted = await first.ledger.get(proposalId);
    const persistedHash = firstPersisted?.taintLabel?.provenanceHash;
    assert.ok(persistedHash);
    await first.close();
    first = null;

    second = await buildWiring({ localDir });
    grantShare(second);
    const persisted = await second.ledger.get(proposalId);
    assert.ok(persisted);
    assert.equal(persisted.taintLabel?.trust, "untrusted");
    assert.equal(
      persisted.taintLabel?.provenanceHash,
      persistedHash,
    );
    const secondTrace = await second.taintAudit.listSinkTraces(
      PILOT_ORGANIZATION,
      proposalId,
    );
    assert.equal(secondTrace.length, 1);
    assert.equal(secondTrace[0]?.traceHash, firstTrace[0]?.traceHash);
    assert.equal(
      JSON.stringify(secondTrace).includes("bounded typed evidence"),
      false,
    );
  } finally {
    await first?.close();
    await second?.close();
    rmSync(localDir, { recursive: true, force: true });
  }
});
