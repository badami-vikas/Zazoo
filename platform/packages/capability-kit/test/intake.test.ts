import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunCtx } from "@bridge/core";
import {
  createInMemoryCaptureStore,
  createModuleSourceSkill,
  ModuleIntakeMaterializer,
} from "../src/intake.js";

let counter = 0;
const ctx: RunCtx = {
  clock: { nowISO: () => "2026-07-04T00:00:00Z", nowMs: () => 0 },
  rng: { next: () => 0.5 },
  ids: { next: () => `id_${counter++}` },
};

test("createModuleSourceSkill fetches via the connector and quarantines a light manifest", async () => {
  const captures = createInMemoryCaptureStore();
  const skill = createModuleSourceSkill({
    moduleId: "dealpilot",
    captures,
    connector: {
      id: "test",
      tier: "free",
      estimateCost: () => 1,
      fetch: async () => [
        { sourceConnectorId: "test", tier: "free", query: { kind: "company", hints: {} }, payload: { name: "Acme" }, confidence: 0.8, costUnits: 1, capturedAt: "t" },
      ],
    },
  });

  const output = await skill.run({ kind: "company", hints: {} }, ctx);
  const manifest = output.proposedOutput as { moduleId: string; count: number; captureIds: string[] };

  assert.equal(manifest.moduleId, "dealpilot");
  assert.equal(manifest.count, 1);
  assert.equal(manifest.captureIds.length, 1);
  assert.equal((await captures.list("dealpilot")).length, 1);
});

test("ModuleIntakeMaterializer commits a quarantined capture and ignores an unknown id", async () => {
  const captures = createInMemoryCaptureStore();
  await captures.put({
    captureId: "cap_1", moduleId: "dealpilot", sourceConnectorId: "test", tier: "free",
    query: { kind: "company", hints: {} }, payload: { name: "Acme" }, confidence: 0.8, costUnits: 1, capturedAt: "t",
  });
  const committed: string[] = [];
  const materializer = new ModuleIntakeMaterializer({ captures, commit: async (capture) => { committed.push(capture.captureId); } });

  const result = await materializer.add("cap_1");
  const missing = await materializer.add("cap_missing");

  assert.deepEqual(result, { committed: true });
  assert.deepEqual(missing, { committed: false });
  assert.deepEqual(committed, ["cap_1"]);
});
