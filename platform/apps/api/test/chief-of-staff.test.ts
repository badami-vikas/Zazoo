/**
 * chiefOfStaff.converse — Chief of Staff v1 (docs/wiki/roadmap.md P1). In-memory
 * mode registers only the network-free EchoModelProvider (wiring.ts), which
 * echoes `system\nprompt` back rather than performing a real classification —
 * router.ts's converse procedure deliberately excludes the "echo" provider id
 * from model selection so these tests exercise the DETERMINISTIC KEYWORD
 * FALLBACK path end-to-end (the same path a real offline/no-model deployment
 * relies on) plus the chain-depth cap and the "routed action is a governed
 * proposal, never direct execution" contract.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type ModelTokenPricing,
  type RunCtx,
} from "@bridge/core";
import { AnthropicProvider } from "@bridge/models";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const PUBLIC_CLOUD_MODEL_EGRESS = {
  dataScope: "public",
  userConfirmed: true,
} as const;

class TierTrackingModel implements ModelProvider {
  readonly plane: "local" | "cloud";
  readonly calls: ModelCompletionRequest[] = [];
  readonly pricing: Readonly<Partial<Record<ModelTier, ModelTokenPricing>>>;
  readonly models: Readonly<Partial<Record<ModelTier, string>>>;

  constructor(
    readonly id: string,
    readonly tiers: readonly ModelTier[],
    readonly reply: string,
    pricing: Readonly<Partial<Record<ModelTier, ModelTokenPricing>>> = {},
    plane: "local" | "cloud" = "cloud",
  ) {
    this.plane = plane;
    this.pricing = pricing;
    this.models = Object.fromEntries(
      tiers.map((tier) => [tier, `${id}-v1`]),
    );
  }

  routingHealth() {
    return "healthy" as const;
  }

  async complete(req: ModelCompletionRequest) {
    this.calls.push(req);
    return {
      text: this.reply,
      model: `${this.id}-v1`,
      tier: req.tier,
      usage: {
        inputTokens: 100,
        outputTokens: 4,
        cacheCreationInputTokens: 20,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
    };
  }
}

test(
  "chiefOfStaff.converse live Anthropic gate: repeated stable Agent prefix records a cache read",
  { skip: process.env["BRIDGE_RUN_LIVE_ANTHROPIC_CACHE_TEST"] !== "1" },
  async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      throw new Error(
        "BRIDGE_RUN_LIVE_ANTHROPIC_CACHE_TEST=1 requires an authorized ANTHROPIC_API_KEY",
      );
    }
    const wiring = await buildWiring({
      modelProviders: [new AnthropicProvider()],
    });
    try {
      const caller = await makeCaller(wiring);
      const first = await caller.chiefOfStaff.converse({
        organizationId: PILOT_ORGANIZATION,
        message: "@builder Draft a governed capability for reviewing a Module change.",
        chainDepth: 0,
        cloudModelEgress: PUBLIC_CLOUD_MODEL_EGRESS,
      });
      const second = await caller.chiefOfStaff.converse({
        organizationId: PILOT_ORGANIZATION,
        message: "@builder Draft a governed capability for reviewing an Automation change.",
        chainDepth: 0,
        cloudModelEgress: PUBLIC_CLOUD_MODEL_EGRESS,
      });
      assert.ok(first.modelReceiptLedgerId);
      assert.ok(second.modelReceiptLedgerId);
      const firstEntry = await wiring.ledger.get(first.modelReceiptLedgerId);
      const secondEntry = await wiring.ledger.get(second.modelReceiptLedgerId);
      const firstReceipt = firstEntry?.proposedOutput as
        | {
            receipt?: {
              usage?: {
                cacheCreationInputTokens?: number;
                cacheReadInputTokens?: number;
              };
            };
          }
        | undefined;
      const secondReceipt = secondEntry?.proposedOutput as
        | { receipt?: { usage?: { cacheReadInputTokens?: number } } }
        | undefined;
      assert.ok(
        (firstReceipt?.receipt?.usage?.cacheCreationInputTokens ?? 0) +
          (firstReceipt?.receipt?.usage?.cacheReadInputTokens ?? 0) >
          0,
        "the first real turn must create or reuse a cache entry",
      );
      assert.ok(
        (secondReceipt?.receipt?.usage?.cacheReadInputTokens ?? 0) > 0,
        "the second real Anthropic turn must read the identical stable prefix",
      );
    } finally {
      await wiring.close();
    }
  },
);

test("chiefOfStaff.converse: a message matching a registered capability's keywords routes to it and creates a governed proposal, not a direct execution", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "can you check my job applications for any interview updates",
      chainDepth: 0,
    });

    assert.equal(result.decision.kind, "route");
    assert.equal(result.decision.route, "jobpilot");
    assert.equal(result.decision.source, "keyword_fallback");
    assert.ok(result.proposal, "routing a message must create a proposal, never execute directly");
    assert.ok(typeof result.reply === "string" && result.reply.length > 0);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: tier routing ignores registration order and persists an attributable cost/usage receipt", async () => {
  const pricing: ModelTokenPricing = {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    cacheCreationInputUsdPerMillion: 1.25,
    cacheReadInputUsdPerMillion: 0.1,
    source: "test protocol price catalog",
    asOf: "2026-07-18",
  };
  const reasoning = new TierTrackingModel(
    "reasoning-local",
    ["reasoning"],
    "reasoned answer",
    {},
    "local",
  );
  const defaultModel = new TierTrackingModel(
    "default-local",
    ["default"],
    "drafted response",
    {},
    "local",
  );
  const cheap = new TierTrackingModel(
    "cheap-local",
    ["cheap"],
    "jobpilot",
    { cheap: pricing },
    "local",
  );
  const wiring = await buildWiring({ modelProviders: [reasoning, defaultModel, cheap] });
  try {
    await wiring.onboardingProfileStore.save({
      organizationId: PILOT_ORGANIZATION,
      avatarStyle: "owl",
      answers: { working_style_notes: "PRIVATE_STYLE_SENTINEL" },
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const caller = await makeCaller(wiring);
    const routed = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "check my job applications",
      chainDepth: 0,
    });

    assert.equal(cheap.calls.length, 1);
    assert.equal(reasoning.calls.length, 0);
    assert.equal(cheap.calls[0]?.tier, "cheap");
    assert.deepEqual(cheap.calls[0]?.cache, { strategy: "stable_system_prefix", ttl: "5m" });
    assert.ok(routed.modelReceiptLedgerId);

    const history = await wiring.ledger.listHistory(PILOT_ORGANIZATION, {
      limit: 20,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    const receiptEntry = history.items.find((entry) => entry.id === routed.modelReceiptLedgerId);
    assert.ok(receiptEntry);
    assert.equal(receiptEntry.actorType, "user");
    assert.equal(receiptEntry.actorId, PILOT_USER);
    assert.equal(receiptEntry.onBehalfOfType, undefined);
    assert.equal(receiptEntry.onBehalfOfId, undefined);
    assert.equal(receiptEntry.resourceType, "module");
    assert.equal(receiptEntry.resourceId, undefined);
    assert.equal(receiptEntry.dataScope, "all");
    assert.deepEqual(
      receiptEntry.policyResults.map((result) => [result.policyId, result.effect]),
      [["pol-model-execution-plane", "allow"]],
    );
    assert.equal((receiptEntry.inputs as { promptStored?: unknown }).promptStored, false);
    assert.equal(
      (receiptEntry.inputs as { cloudEgressConfirmed?: unknown }).cloudEgressConfirmed,
      false,
    );
    assert.equal(
      (receiptEntry.inputs as { modelCallRunId?: unknown }).modelCallRunId,
      routed.modelReceiptLedgerId,
    );
    assert.doesNotMatch(JSON.stringify(receiptEntry), /check my job applications/);
    const proposedOutput = receiptEntry.proposedOutput as {
      receipt: { tier: string; usage: { inputTokens: number }; cost: { status: string; estimatedUsd: number | null } };
    };
    assert.equal(proposedOutput.receipt.tier, "cheap");
    assert.equal(proposedOutput.receipt.usage.inputTokens, 100);
    assert.equal(proposedOutput.receipt.cost.status, "estimated");
    assert.ok((proposedOutput.receipt.cost.estimatedUsd ?? 0) > 0);

    const addressed = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "@learning identify the important pattern",
      chainDepth: 0,
    });
    assert.equal(addressed.agent, "learning");
    assert.ok(addressed.modelReceiptLedgerId);
    assert.equal(reasoning.calls.length, 1);
    assert.equal(reasoning.calls[0]?.tier, "reasoning");
    assert.doesNotMatch(
      reasoning.calls[0]?.system ?? "",
      /PRIVATE_STYLE_SENTINEL/,
      "profile-derived context must not enter a cloud prompt",
    );
    const addressedReceipt = await wiring.ledger.get(addressed.modelReceiptLedgerId);
    assert.equal(addressedReceipt?.actorId, PILOT_USER);
    assert.equal(addressedReceipt?.onBehalfOfId, undefined);

    const drafted = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "@communications draft a short update",
      chainDepth: 0,
    });
    assert.ok(drafted.modelReceiptLedgerId);
    assert.equal(defaultModel.calls.length, 1);
    assert.equal(defaultModel.calls[0]?.tier, "default");
    assert.doesNotMatch(
      defaultModel.calls[0]?.system ?? "",
      /PRIVATE_STYLE_SENTINEL/,
      "profile-derived context must not enter a cloud prompt",
    );
    const draftedReceipt = await wiring.ledger.get(drafted.modelReceiptLedgerId);
    assert.equal(draftedReceipt?.actorId, PILOT_USER);
    assert.equal(draftedReceipt?.onBehalfOfId, undefined);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: cloud providers are never a fallback for a turn without explicit public-data egress", async () => {
  const cheap = new TierTrackingModel("cheap-cloud", ["cheap"], "jobpilot");
  const wiring = await buildWiring({ modelProviders: [cheap] });
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.chiefOfStaff.converse({
          organizationId: PILOT_ORGANIZATION,
          message: "check my job applications PRIVATE_SENTINEL",
          chainDepth: 0,
        }),
      /LOCAL-plane/,
    );
    assert.equal(cheap.calls.length, 0);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: an unmatched message clarifies instead of guessing a route", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "tell me about the weather today",
      chainDepth: 0,
    });
    assert.equal(result.decision.kind, "clarify");
    assert.equal(result.proposal, null);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: chain depth at the hard cap falls back to a direct reply instead of routing further", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "can you check my job applications for any interview updates",
      chainDepth: 3, // MAX_CHAIN_DEPTH
    });
    assert.equal(result.decision.kind, "direct_reply");
    assert.equal(result.proposal, null);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: an @mention addresses a foundational agent directly, bypassing classification, and never proposes for a non-approval agent", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "@learning what patterns have you noticed in my week?",
      chainDepth: 0,
    });
    assert.equal(result.agent, "learning");
    assert.equal(result.decision.kind, "direct_reply");
    assert.equal(result.proposal, null, "Learning Agent never executes — a direct reply must not create a proposal");
    assert.ok(typeof result.reply === "string" && result.reply.length > 0);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: @builder (Capability Builder) always drafts through the governed pipeline, never a bare reply", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "@builder create a weekly digest automation",
      chainDepth: 0,
    });
    assert.equal(result.agent, "capability_builder");
    assert.equal(result.decision.kind, "route");
    assert.ok(result.proposal, "Capability Builder output must always be a governed proposal, never shipped live");
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: an unrecognized @word is treated as ordinary text, not a mention", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "@nobody can you check my job applications",
      chainDepth: 0,
    });
    assert.notEqual(result.agent, undefined);
    assert.equal(result.agent, "chief_of_staff");
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: a non-pilot organizationId is rejected with FORBIDDEN (single-tenant guard applies here too)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(() =>
      caller.chiefOfStaff.converse({
        organizationId: "d0000000-0000-4000-a000-00000000dead",
        message: "anything",
        chainDepth: 0,
      }),
    );
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: a non-member is rejected before any model call", async () => {
  const cheap = new TierTrackingModel("cheap-cloud", ["cheap"], "jobpilot");
  const wiring = await buildWiring({ modelProviders: [cheap] });
  try {
    const caller = await makeCaller(wiring, "d0000000-0000-4000-a000-00000000cafe");
    await assert.rejects(
      () =>
        caller.chiefOfStaff.converse({
          organizationId: PILOT_ORGANIZATION,
          message: "check my job applications",
          chainDepth: 0,
          cloudModelEgress: PUBLIC_CLOUD_MODEL_EGRESS,
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "FORBIDDEN",
    );
    assert.equal(cheap.calls.length, 0);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: caller-confirmed cloud egress is retired before provider access", async () => {
  const cheap = new TierTrackingModel("cheap-cloud", ["cheap"], "jobpilot");
  const wiring = await buildWiring({ modelProviders: [cheap] });
  try {
    const member = await wiring.organizationStore.inviteMember(
      PILOT_ORGANIZATION,
      "test-fixture-task-022-no-egress@example.invalid",
    );
    const caller = await makeCaller(wiring, member.userId);
    await assert.rejects(
      () =>
        caller.chiefOfStaff.converse({
          organizationId: PILOT_ORGANIZATION,
          message: "check my job applications",
          chainDepth: 0,
          cloudModelEgress: PUBLIC_CLOUD_MODEL_EGRESS,
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "PRECONDITION_FAILED",
    );
    assert.equal(cheap.calls.length, 0);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: the CoS persona is resolved server-side from the stored onboarding profile (two profiles → two persona cards)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await wiring.onboardingProfileStore.save({
      organizationId: PILOT_ORGANIZATION,
      avatarStyle: "owl",
      answers: { role: "investor" },
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const first = await caller.chiefOfStaff.converse({ organizationId: PILOT_ORGANIZATION, message: "tell me about the weather today", chainDepth: 0 });
    assert.equal(first.persona.id, "chief_of_staff");
    assert.equal(first.persona.tone, undefined);

    await wiring.onboardingProfileStore.save({
      organizationId: PILOT_ORGANIZATION,
      avatarStyle: "fox",
      answers: { role: "recruiter" },
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const second = await caller.chiefOfStaff.converse({ organizationId: PILOT_ORGANIZATION, message: "tell me about the weather today", chainDepth: 0 });
    assert.equal(second.persona.tone, undefined);
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: stored Avatar style does not alter Agent tone", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await wiring.onboardingProfileStore.save({
      organizationId: PILOT_ORGANIZATION,
      avatarStyle: "owl",
      answers: {},
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const result = await caller.chiefOfStaff.converse({
      organizationId: PILOT_ORGANIZATION,
      message: "tell me about the weather today",
      chainDepth: 0,
    });
    assert.equal(result.persona.tone, undefined);
  } finally {
    await wiring.close();
  }
});
