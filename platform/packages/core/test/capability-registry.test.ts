import assert from "node:assert/strict";
import test from "node:test";

import {
  cosineSimilarity,
  findOverlaps,
  structuralSimilarity,
  type OverlapCandidate,
} from "../src/capability/registry.js";
import type { CapabilityManifestRow } from "../src/capability/ports.js";
import type { ModelProvider } from "../src/ports.js";

test("detects a near duplicate structurally before creation without a model", async () => {
  const candidate: OverlapCandidate = {
    name: "Memory Automation Summarizer",
    kind: "skill",
    capabilityType: "skill",
    permissions: ["memory:read", "automation:write"],
    purpose: "Summarize Memory entries for recurring Automation review.",
  };
  const existing = row({
    id: "manifest-memory-automation-summarizer",
    name: "Memory Automation Summarizer",
    kind: "skill",
    capabilityType: "skill",
    manifest: {
      purpose: "Summarize Memory entries for recurring Automation review.",
      permissions: [
        { resourceType: "memory", action: "read" },
        { resourceType: "automation", action: "write" },
      ],
    },
  });

  const matches = await findOverlaps(candidate, [existing]);

  assert.equal(matches[0]?.manifestId, "manifest-memory-automation-summarizer");
  assert.equal(matches[0]?.tier, "structural");
  assert.equal(matches[0]?.nearDuplicate, true);
  assert.equal(matches[0]?.score, 1);
});

test("marks a clearly distinct candidate as not near duplicate", async () => {
  const candidate: OverlapCandidate = {
    name: "Community Signal Router",
    kind: "routing_rule",
    capabilityType: "automation",
    purpose: "Route inbound Community Signals to appropriate Automations.",
  };
  const existing = row({
    id: "manifest-memory-summary-skill",
    name: "Memory Summary Skill",
    kind: "skill",
    capabilityType: "skill",
    manifest: { purpose: "Summarize Memory entries." },
  });

  const matches = await findOverlaps(candidate, [existing]);

  assert.equal(matches[0]?.nearDuplicate, false);
  assert.equal(matches[0]?.tier, "structural");
  assert.equal(matches[0]?.score, 0);
});

test("falls back to capabilityType when an existing row has null kind", () => {
  const candidate: OverlapCandidate = {
    name: "Touchpoint Planner",
    capabilityType: "automation",
  };
  const existing = row({
    id: "manifest-touchpoint-planner",
    name: "Different Name",
    kind: null,
    capabilityType: "automation",
    manifest: {},
  });

  assert.equal(structuralSimilarity(candidate, existing), 0.5);
});

test("uses semantic tier for inconclusive structural matches when embeddings exist", async () => {
  const candidate: OverlapCandidate = {
    name: "Memory Pattern Builder",
    kind: "skill",
    capabilityType: "skill",
    purpose: "Identify repeated Memory themes and suggest an Automation.",
  };
  const existing = [
    row({
      id: "manifest-touchpoint-theme-detector",
      name: "Touchpoint Theme Detector",
      kind: "skill",
      capabilityType: "skill",
      manifest: { purpose: "Identify repeated Memory themes and suggest an Automation." },
    }),
    row({
      id: "manifest-community-map-view",
      name: "Community Map View",
      capabilityType: "view",
      manifest: { purpose: "Render Community membership as a workspace view." },
    }),
  ];
  const model = embeddingModel((texts) =>
    texts.map((text) =>
      text.includes("Identify repeated Memory themes") ? [1, 0.01] : [0, 1],
    ),
  );

  const matches = await findOverlaps(candidate, existing, { model });

  assert.equal(matches[0]?.manifestId, "manifest-touchpoint-theme-detector");
  assert.equal(matches[0]?.tier, "semantic");
  assert.equal(matches[0]?.nearDuplicate, true);
  assert.ok((matches[0]?.score ?? 0) > 0.99);
});

test("degrades gracefully when semantic comparison is inconclusive but embeddings are unavailable", async () => {
  const candidate: OverlapCandidate = {
    name: "Memory Pattern Builder",
    kind: "skill",
    capabilityType: "skill",
    purpose: "Identify repeated Memory themes and suggest an Automation.",
  };
  const existing = row({
    id: "manifest-touchpoint-theme-detector",
    name: "Touchpoint Theme Detector",
    kind: "skill",
    capabilityType: "skill",
    manifest: { purpose: "Identify repeated Memory themes and suggest an Automation." },
  });
  const modelWithoutEmbed: ModelProvider = {
    id: "fixture-no-embed",
    plane: "local",
    async complete() {
      return { text: "" };
    },
  };

  const matches = await findOverlaps(candidate, [existing], { model: modelWithoutEmbed });
  const matchesWithoutModel = await findOverlaps(candidate, [existing]);

  assert.equal(matches[0]?.tier, "structural");
  assert.equal(matches[0]?.nearDuplicate, false);
  assert.match(matches[0]?.reason ?? "", /semantic comparison skipped/i);
  assert.equal(matchesWithoutModel[0]?.tier, "structural");
  assert.match(matchesWithoutModel[0]?.reason ?? "", /semantic comparison skipped/i);
});

test("returns an empty list when there are no existing manifests", async () => {
  const matches = await findOverlaps({
    name: "Initiative Brief Writer",
    kind: "prompt",
    capabilityType: "skill",
  }, []);

  assert.deepEqual(matches, []);
});

test("degrades to structural matches when embedding execution fails", async () => {
  const candidate: OverlapCandidate = {
    name: "Memory Pattern Builder",
    kind: "skill",
    capabilityType: "skill",
    purpose: "Identify repeated Memory themes and suggest an Automation.",
  };
  const existing = row({
    id: "manifest-touchpoint-theme-detector",
    name: "Touchpoint Theme Detector",
    kind: "skill",
    capabilityType: "skill",
    manifest: { purpose: "Identify repeated Memory themes and suggest an Automation." },
  });
  const model = embeddingModel(() => {
    throw new Error("fixture embedding unavailable");
  });

  const matches = await findOverlaps(candidate, [existing], { model });

  assert.equal(matches[0]?.tier, "structural");
  assert.match(matches[0]?.reason ?? "", /embedding failed/i);
});

test("omits permission weighting when either side lacks permissions", () => {
  const candidate: OverlapCandidate = {
    name: "Signal Review Prompt",
    kind: "prompt",
    capabilityType: "skill",
    permissions: ["signal:read"],
  };
  const existing = row({
    id: "manifest-signal-review-prompt",
    name: "Signal Review Prompt",
    kind: "prompt",
    capabilityType: "skill",
    manifest: { purpose: "Review Signal context." },
  });

  assert.equal(structuralSimilarity(candidate, existing), 1);
});

test("cosineSimilarity handles identical, orthogonal, and zero vectors", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

function row(overrides: {
  id: string;
  name: string;
  kind?: CapabilityManifestRow["kind"];
  capabilityType: CapabilityManifestRow["capabilityType"];
  manifest: unknown;
}): CapabilityManifestRow {
  return {
    id: overrides.id,
    workspaceId: "workspace-test-fixture",
    capabilityType: overrides.capabilityType,
    ...(overrides.kind !== undefined ? { kind: overrides.kind } : {}),
    name: overrides.name,
    version: "1.0.0",
    origin: "ai_generated",
    audience: "private",
    manifest: overrides.manifest,
    computedRisk: "advisory",
    dependencies: [],
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function embeddingModel(embed: (texts: string[]) => number[][]): ModelProvider {
  return {
    id: "fixture-embed",
    plane: "local",
    async complete() {
      return { text: "" };
    },
    embed: async (texts) => embed(texts),
  };
}
