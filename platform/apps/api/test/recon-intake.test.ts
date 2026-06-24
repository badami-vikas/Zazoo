// platform/apps/api/test/recon-intake.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { envelopeToProposeRequests, type ReconEnvelope } from "../src/intake/recon-envelope.js";

const IDS = {
  workspaceId: "b0000000-0000-4000-a000-000000000001",
  intakeAgentId: "b0000000-0000-4000-a000-0000000000e2",
  userId: "e0f0053b-fc44-476e-be27-1371e179e958",
};

function sampleEnvelope(): ReconEnvelope {
  return {
    contract: "recon.v1",
    dataScope: "public",
    payload: {
      person: { name: "Dana Lee", company: "Acme Capital", domain: "acme.vc", identifiers: { linkedin: "dana-lee" } },
      memories: [
        { text: "Title: Partner", source: "LinkedIn", url: "https://x", tier: "A" },
        { text: "Education: MIT", source: "LinkedIn", tier: "B" },
      ],
      signals: [{ text: "FINRA disclosure on record", source: "FINRA", url: "https://finra" }],
    },
  };
}

test("maps subject+memories to one person proposal and each signal to its own", () => {
  const reqs = envelopeToProposeRequests(sampleEnvelope(), IDS);
  assert.equal(reqs.length, 2); // 1 person + 1 signal

  const person = reqs.find((r) => r.resourceType === "person")!;
  assert.equal(person.action, "write");
  assert.equal(person.workspaceId, IDS.workspaceId);
  assert.equal(person.actor.type, "agent");
  assert.equal(person.actor.id, IDS.intakeAgentId);
  assert.deepEqual(person.onBehalfOf, { type: "user", id: IDS.userId });
  assert.equal(person.skill, "stageMutation");
  assert.equal(person.dataScope, "public");
  const pInputs = person.inputs as { person: { name: string }; memories: unknown[] };
  assert.equal(pInputs.person.name, "Dana Lee");
  assert.equal(pInputs.memories.length, 2);

  const signal = reqs.find((r) => r.resourceType === "signal")!;
  assert.equal(signal.action, "write");
  assert.equal(signal.actor.id, IDS.intakeAgentId);
  const sInputs = signal.inputs as { text: string; source: string };
  assert.equal(sInputs.text, "FINRA disclosure on record");
  assert.equal(sInputs.source, "FINRA");
});

test("zero signals yields a single person proposal", () => {
  const env = sampleEnvelope();
  env.payload.signals = [];
  const reqs = envelopeToProposeRequests(env, IDS);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]?.resourceType, "person");
});
