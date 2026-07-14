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
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: "test_fixture_chief_of_staff_user" },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

test("chiefOfStaff.converse: a message matching a registered capability's keywords routes to it and creates a governed proposal, not a direct execution", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      workspaceId: PILOT_WORKSPACE,
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

test("chiefOfStaff.converse: an unmatched message clarifies instead of guessing a route", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.chiefOfStaff.converse({
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
      message: "@nobody can you check my job applications",
      chainDepth: 0,
    });
    assert.notEqual(result.agent, undefined);
    assert.equal(result.agent, "chief_of_staff");
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: a non-pilot workspaceId is rejected with FORBIDDEN (single-tenant guard applies here too)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(() =>
      caller.chiefOfStaff.converse({
        workspaceId: "d0000000-0000-4000-a000-00000000dead",
        message: "anything",
        chainDepth: 0,
      }),
    );
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: the CoS persona is resolved server-side from the stored onboarding profile (two profiles → two persona cards)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await wiring.onboardingProfileStore.save({
      workspaceId: PILOT_WORKSPACE,
      animal: "owl",
      answers: { role: "investor" },
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const owl = await caller.chiefOfStaff.converse({ workspaceId: PILOT_WORKSPACE, message: "tell me about the weather today", chainDepth: 0 });
    assert.equal(owl.persona.id, "chief_of_staff");
    assert.ok(owl.persona.tone && /wise and calm/.test(owl.persona.tone), "owl profile should yield the owl tone");

    await wiring.onboardingProfileStore.save({
      workspaceId: PILOT_WORKSPACE,
      animal: "fox",
      answers: { role: "recruiter" },
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const fox = await caller.chiefOfStaff.converse({ workspaceId: PILOT_WORKSPACE, message: "tell me about the weather today", chainDepth: 0 });
    assert.ok(fox.persona.tone && /clever and playful/.test(fox.persona.tone), "fox profile should yield the fox tone");
    assert.notEqual(owl.persona.tone, fox.persona.tone, "two profiles must produce two distinct persona cards");
  } finally {
    await wiring.close();
  }
});

test("chiefOfStaff.converse: a stored profile's animal overrides the client-supplied input.animal (server-side wins)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await wiring.onboardingProfileStore.save({
      workspaceId: PILOT_WORKSPACE,
      animal: "owl",
      answers: {},
      phoneVerified: false,
      verificationMethod: null,
      connectedSourceIds: [],
      updatedAtISO: new Date().toISOString(),
    });
    const result = await caller.chiefOfStaff.converse({
      workspaceId: PILOT_WORKSPACE,
      message: "tell me about the weather today",
      chainDepth: 0,
      animal: "fox",
    });
    assert.ok(result.persona.tone && /wise and calm/.test(result.persona.tone), "stored owl must win over client-supplied fox");
  } finally {
    await wiring.close();
  }
});
