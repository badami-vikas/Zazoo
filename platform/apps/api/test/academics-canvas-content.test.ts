import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, modelRequestTaint, type ModelProvider, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(97);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** Fake `openrouter`-id provider — the summarize Skill's model preference
 * (`ACADEMICS_SUMMARIZE_MODEL_BINDING`) resolves this by id, proving Ox Alpha
 * is the one actually invoked without a real OpenRouter API key. */
function fakeOpenRouterProvider(summaryText: string): ModelProvider {
  return {
    id: "openrouter",
    plane: "cloud",
    tiers: ["cheap", "default"],
    models: { cheap: "stealth/ox-alpha", default: "stealth/ox-alpha" },
    routingHealth: () => "healthy",
    async complete(req) {
      return {
        text: summaryText,
        model: "stealth/ox-alpha",
        tier: req.tier,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider",
        },
        taintLabel: modelRequestTaint(req),
      };
    },
  };
}

test("academics.canvas.summarize fills in a synced Page's summary via the openrouter (Ox Alpha) provider", async () => {
  const wiring = await buildWiring({ modelProviders: [fakeOpenRouterProvider("Office hours are Tuesdays 2-4pm.")] });
  try {
    const caller = makeCaller(wiring);
    const subject = await caller.academics.createSubject({
      organizationId: PILOT_ORGANIZATION,
      title: "Test Course",
    });
    const { row: document } = await wiring.academicsStore.upsertDocumentFromSource({
      organizationId: PILOT_ORGANIZATION,
      subjectId: subject.id,
      source: "canvas",
      sourceId: "syllabus",
      kind: "page",
      title: "Syllabus",
      content: "Office hours: Tue 2-4pm in room 204.",
    });
    assert.equal(document.summary, null, "unsummarized on creation");

    const output = (await caller.academics.canvas.summarize({ organizationId: PILOT_ORGANIZATION })) as {
      documentsConsidered: number;
      summarized: number;
      skipped: number;
      modelConfigured: boolean;
      modelId?: string;
    };
    assert.equal(output.documentsConsidered, 1);
    assert.equal(output.summarized, 1);
    assert.equal(output.skipped, 0);
    assert.equal(output.modelConfigured, true);
    assert.equal(output.modelId, "openrouter");

    const { items } = await caller.academics.listDocuments({ organizationId: PILOT_ORGANIZATION, limit: 10, offset: 0 });
    const updated = items.find((row) => row.id === document.id);
    assert.equal(updated?.summary, "Office hours are Tuesdays 2-4pm.");
    assert.ok(updated?.summarizedAt);

    // Idempotent-ish: a document with a File kind (no content) is never sent
    // to the model, and re-running finds nothing left to summarize.
    const rerun = (await caller.academics.canvas.summarize({ organizationId: PILOT_ORGANIZATION })) as {
      documentsConsidered: number;
    };
    assert.equal(rerun.documentsConsidered, 0);
  } finally {
    await wiring.close();
  }
});

test("academics.canvas.summarize is honest when no model is configured", async () => {
  const wiring = await buildWiring({ modelProviders: [] });
  try {
    const caller = makeCaller(wiring);
    const subject = await caller.academics.createSubject({
      organizationId: PILOT_ORGANIZATION,
      title: "Test Course 2",
    });
    await wiring.academicsStore.upsertDocumentFromSource({
      organizationId: PILOT_ORGANIZATION,
      subjectId: subject.id,
      source: "canvas",
      sourceId: "reading-1",
      kind: "page",
      title: "Week 1 Reading",
      content: "Read chapters 1-3.",
    });

    const output = (await caller.academics.canvas.summarize({ organizationId: PILOT_ORGANIZATION })) as {
      documentsConsidered: number;
      summarized: number;
      skipped: number;
      modelConfigured: boolean;
    };
    assert.equal(output.documentsConsidered, 1);
    assert.equal(output.summarized, 0);
    assert.equal(output.skipped, 1);
    assert.equal(output.modelConfigured, false);
  } finally {
    await wiring.close();
  }
});
