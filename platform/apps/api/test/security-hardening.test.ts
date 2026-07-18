/**
 * SEC-7 — verification-method proof + log redaction.
 *
 *  - `verificationMethod` no longer accepts `linkedin`: there is no real LinkedIn
 *    OAuth proof, so a client must not be able to assert a linkedin verification and
 *    have it persisted as a trust signal. The enum now rejects it at the edge.
 *  - the dummy phone-OTP flow labels its result `verificationSource:"dummy"` so a
 *    caller can never mistake it for a real verification.
 *  - the Fastify/pino logger redacts phone / OTP code / Authorization so those never
 *    land in a log line even if a body or header is ever serialized.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import Fastify from "fastify";
import { decodeJwt } from "jose";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";
import { loggerOptions } from "../src/server.js";
import { makeContextFactory, verifiedReauthenticationAt } from "../src/context.js";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity: Actor) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

test("credential re-auth accepts only a verified password AMR timestamp", () => {
  const encoded = (payload: object) =>
    `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  const oauthOnly = decodeJwt(
    encoded({ auth_time: 1_752_796_800, amr: [{ method: "oauth", timestamp: 1_752_796_800 }] }),
  );
  const password = decodeJwt(
    encoded({
      auth_time: 1_752_796_700,
      amr: [{ method: "password", timestamp: 1_752_796_800 }],
    }),
  );

  assert.equal(verifiedReauthenticationAt(oauthOnly), undefined);
  assert.equal(verifiedReauthenticationAt(password), 1_752_796_800_000);
});

test("sidecar capability authenticates the server-owned pilot without granting re-authentication", async () => {
  const token = "c".repeat(64);
  const prior = process.env.BRIDGE_SIDECAR_TOKEN;
  const priorJwtSecret = process.env.SUPABASE_JWT_SECRET;
  process.env.BRIDGE_SIDECAR_TOKEN = token;
  const wiring = await buildWiring();
  try {
    const context = await makeContextFactory(wiring)({
      req: { headers: { "x-bridge-sidecar-token": token } },
    });
    assert.equal(context.authenticated, true);
    assert.equal(context.identity.id, PILOT_USER);
    assert.equal(context.reauthenticatedAt, undefined);

    process.env.SUPABASE_JWT_SECRET = "test_fixture_verified_identity_secret";
    const verifierContext = await makeContextFactory(wiring)({
      req: { headers: { "x-bridge-sidecar-token": token } },
    });
    assert.equal(verifierContext.verifying, true);
    assert.equal(verifierContext.authenticated, false);
    await assert.rejects(
      appRouter
        .createCaller(verifierContext)
        .dealpilot.module({ workspaceId: PILOT_WORKSPACE }),
      /authentication required for DealPilot/,
    );
  } finally {
    await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_SIDECAR_TOKEN;
    else process.env.BRIDGE_SIDECAR_TOKEN = prior;
    if (priorJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = priorJwtSecret;
  }
});

test("onboarding.saveProfile: a client-asserted verificationMethod:'linkedin' is rejected at the edge (no OAuth proof exists)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await assert.rejects(
      () =>
        caller.onboarding.saveProfile({
          workspaceId: PILOT_WORKSPACE,
          animal: "otter",
          // Deliberately spoof a trust signal the server can't actually prove.
          verificationMethod: "linkedin" as unknown as "phone",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
  } finally {
    await wiring.close();
  }
});

test("onboarding.saveProfile: the honest paths (null / phone) are still accepted", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const viaNull = await caller.onboarding.saveProfile({
      workspaceId: PILOT_WORKSPACE,
      animal: "otter",
      verificationMethod: null,
    });

    assert.equal(viaNull.profile.verificationMethod, null);

    const viaPhone = await caller.onboarding.saveProfile({
      workspaceId: PILOT_WORKSPACE,
      animal: "otter",
      verificationMethod: "phone",
    });
    assert.equal(viaPhone.profile.verificationMethod, "phone");
    assert.equal(viaPhone.profile.phoneVerified, true);
  } finally {
    await wiring.close();
  }
});

test("onboarding role-model learning is cited, approval-gated, controllable, and forgettable", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedRedirect: string | undefined;
      globalThis.fetch = async (input, init) => {
        requestedUrl = String(input);
        requestedRedirect = init?.redirect;
        return (
        new Response(JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "Test Fixture Leader",
                extract: "Test Fixture Leader is documented for public work. This is source context.",
                fullurl: "https://en.wikipedia.org/wiki/Test_Fixture_Leader",
              },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } })
        );
      };
      const wiring = await buildWiring();
      try {
        const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
        await caller.onboarding.saveProfile({
          workspaceId: PILOT_WORKSPACE,
          animal: "owl",
          answers: { role_model: "Test Fixture Leader", role_model_why: "clear preparation" },
          verificationMethod: null,
          connectedSourceIds: [],
        });
        const result = await caller.onboarding.recommendFromRoleModel({
          workspaceId: PILOT_WORKSPACE,
          figure: "Test Fixture Leader",
          admiredFor: "clear preparation",
        });
        assert.equal(result.recommendation.citation.url, "https://en.wikipedia.org/wiki/Test_Fixture_Leader");
        assert.equal(new URL(requestedUrl).origin, "https://en.wikipedia.org");
        assert.equal(new URL(requestedUrl).pathname, "/w/api.php");
        assert.equal(requestedRedirect, "error");
        assert.equal(result.proposal.status, "pending_review", JSON.stringify(result.proposal));
        assert.ok(result.proposal.policyResults.some((policy) => policy.effect === "require_approval"));
        const approved = await caller.action.decide({
          proposalId: result.proposal.id,
          decision: "approve",
        });
        assert.equal(approved.status, "applied");

        let state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        const preference = state.memories.find((item) => item.value.kind === "onboarding_preference");
        const reflection = state.memories.find((item) => item.value.kind === "reflection_schedule");
        assert.ok(preference);
        assert.ok(reflection);

        await caller.onboarding.correctMemory({
          workspaceId: PILOT_WORKSPACE,
          memoryId: preference.row.id,
          content: "careful preparation",
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        const corrected = state.memories.find((item) => item.value.kind === "onboarding_preference");
        assert.ok(corrected?.value.kind === "onboarding_preference");
        assert.equal(corrected.value.admiredFor, "careful preparation");

        await caller.onboarding.setReflection({
          workspaceId: PILOT_WORKSPACE,
          memoryId: reflection.row.id,
          action: "pause",
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        assert.ok(state.memories.some((item) => item.value.kind === "reflection_schedule" && item.value.status === "paused"));

        const pausedReflection = state.memories.find((item) => item.value.kind === "reflection_schedule");
        assert.ok(pausedReflection);
        await caller.onboarding.setReflection({
          workspaceId: PILOT_WORKSPACE,
          memoryId: pausedReflection.row.id,
          action: "resume",
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        const resumedReflection = state.memories.find((item) => item.value.kind === "reflection_schedule");
        assert.ok(resumedReflection?.value.kind === "reflection_schedule");
        assert.equal(resumedReflection.value.status, "scheduled");

        await caller.onboarding.setReflection({
          workspaceId: PILOT_WORKSPACE,
          memoryId: resumedReflection.row.id,
          action: "snooze",
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        const snoozedReflection = state.memories.find((item) => item.value.kind === "reflection_schedule");
        assert.ok(snoozedReflection?.value.kind === "reflection_schedule");
        assert.equal(snoozedReflection.value.status, "snoozed");

        await caller.onboarding.setReflection({
          workspaceId: PILOT_WORKSPACE,
          memoryId: snoozedReflection.row.id,
          action: "skip",
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        assert.ok(state.memories.some((item) => item.value.kind === "reflection_schedule" && item.value.status === "skipped"));

        await caller.onboarding.forgetMemory({
          workspaceId: PILOT_WORKSPACE,
          memoryId: corrected.row.id,
        });
        state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
        assert.equal(state.memories.some((item) => item.value.kind === "onboarding_preference"), false);
      } finally {
        globalThis.fetch = originalFetch;
        await wiring.close();
      }
});

test("onboarding trust check persists one inspectable, tainted Local Plane Memory", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const result = await caller.onboarding.recordTrustCapture({
      workspaceId: PILOT_WORKSPACE,
      appName: "Test Fixture Editor",
      bundleId: "com.example.test-fixture-editor",
      capturedAt: "2026-07-16T10:00:00.000Z",
    });
    assert.equal(result.memory.type, "episodic");
    assert.equal(result.memory.scope, "private");
    assert.equal(result.memory.plane, "local");
    assert.equal(result.memory.trustOrigin, "untrusted_external");

    const state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
    const capture = state.memories.find((item) => item.value.kind === "trust_capture");
    assert.ok(capture?.value.kind === "trust_capture");
    assert.equal(capture.value.appName, "Test Fixture Editor");

    await caller.onboarding.forgetMemory({
      workspaceId: PILOT_WORKSPACE,
      memoryId: capture.row.id,
    });
    const afterDelete = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
    assert.equal(afterDelete.memories.some((item) => item.value.kind === "trust_capture"), false);
  } finally {
    await wiring.close();
  }
});

test("onboarding.learningState / onboarding.forgetMemory (review round-5 item 1): unauthenticated and non-member callers are rejected", async () => {
  const wiring = await buildWiring();
  try {
    const unauth = appRouter.createCaller({ wiring, run: makeRun(), identity: { type: "user", id: PILOT_USER }, authenticated: false, verifying: true });
    await assert.rejects(() => unauth.onboarding.learningState({ workspaceId: PILOT_WORKSPACE }));
    await assert.rejects(() => unauth.onboarding.forgetMemory({ workspaceId: PILOT_WORKSPACE, memoryId: "00000000-0000-4000-8000-000000000001" }));

    const nonMember = makeCaller(wiring, { type: "user", id: "22222222-2222-4222-8222-222222222222" });
    await assert.rejects(
      () => nonMember.onboarding.learningState({ workspaceId: PILOT_WORKSPACE }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMember.onboarding.forgetMemory({ workspaceId: PILOT_WORKSPACE, memoryId: "00000000-0000-4000-8000-000000000001" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("onboarding.learningState (review round-5 item 1): never returns red_flag/preference_adjustment content, even when such Memories exist for the SAME owner", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await wiring.memoryStore.write({
      id: "33333333-0000-4000-8000-000000000001",
      workspaceId: PILOT_WORKSPACE,
      type: "semantic",
      scope: "private",
      content: JSON.stringify({ kind: "red_flag", anchor: { kind: "cell", moduleId: "jobpilot", databaseId: "jobpilot.jobs", recordId: "44444444-0000-4000-8000-000000000001", fieldId: "x" }, renderedValue: "v", status: "open", learningStatus: "none" }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    await wiring.memoryStore.write({
      id: "33333333-0000-4000-8000-000000000002",
      workspaceId: PILOT_WORKSPACE,
      type: "preference",
      scope: "private",
      content: JSON.stringify({ kind: "preference_adjustment", scope: "test", target: "test", proposedChange: "test", rationale: "test", flagMemoryId: "33333333-0000-4000-8000-000000000001", applied: false }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    const state = await caller.onboarding.learningState({ workspaceId: PILOT_WORKSPACE });
    assert.equal(state.memories.some((item) => (item.value as { kind: string }).kind === "red_flag"), false, "learningState must never surface a red_flag Memory");
    assert.equal(state.memories.some((item) => (item.value as { kind: string }).kind === "preference_adjustment"), false, "learningState must never surface a preference_adjustment Memory");
  } finally {
    await wiring.close();
  }
});

test("onboarding.forgetMemory (review round-5 item 1): rejects red_flag/preference_adjustment ids instead of deleting them — all correction deletion must go through redFlag.forget", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const redFlagMemory = await wiring.memoryStore.write({
      id: "55555555-0000-4000-8000-000000000001",
      workspaceId: PILOT_WORKSPACE,
      type: "semantic",
      scope: "private",
      content: JSON.stringify({ kind: "red_flag", anchor: { kind: "cell", moduleId: "jobpilot", databaseId: "jobpilot.jobs", recordId: "66666666-0000-4000-8000-000000000001", fieldId: "x" }, renderedValue: "v", status: "open", learningStatus: "none" }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    await assert.rejects(
      () => caller.onboarding.forgetMemory({ workspaceId: PILOT_WORKSPACE, memoryId: redFlagMemory.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    const stillThere = await wiring.memoryStore.get(redFlagMemory.id, { workspaceId: PILOT_WORKSPACE, userId: PILOT_USER });
    assert.ok(stillThere, "onboarding.forgetMemory must never delete a red_flag Memory");

    const adjustmentMemory = await wiring.memoryStore.write({
      id: "55555555-0000-4000-8000-000000000002",
      workspaceId: PILOT_WORKSPACE,
      type: "preference",
      scope: "private",
      content: JSON.stringify({ kind: "preference_adjustment", scope: "test", target: "test", proposedChange: "test", rationale: "test", flagMemoryId: redFlagMemory.id, applied: false }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    await assert.rejects(
      () => caller.onboarding.forgetMemory({ workspaceId: PILOT_WORKSPACE, memoryId: adjustmentMemory.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("onboarding.verifyPhoneOtp: a passing code is labeled verificationSource:'dummy', never a real verification", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const res = await caller.onboarding.verifyPhoneOtp({ phone: "+15555550123", code: "123456" });
    assert.equal(res.verified, true);
    assert.equal(res.dummy, true);
    assert.equal(res.verificationSource, "dummy");
  } finally {
    await wiring.close();
  }
});

test("server logger: credentials, phone, OTP code, and Authorization are redacted", async () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });

  const app = Fastify({ logger: { ...loggerOptions, level: "info", stream } });
  // Log under bare `body`/`headers` keys: Fastify only special-cases `req`/`res`/`err`
  // with its own serializers (which strip body/headers before redaction can run), so
  // these top-level keys are what actually exercises the pino redact config.
  app.log.info(
    {
      body: {
        phone: "+15555550123",
        code: "654321",
        password: "test_fixture_source_password",
        userId: "test_fixture_private_user",
        json: {
          password: "test_fixture_nested_password",
          userId: "test_fixture_nested_user",
        },
      },
      headers: {
        authorization: "Bearer super-secret-token",
        "x-bridge-sidecar-token": "test_fixture_sidecar_capability",
      },
    },
    "inbound request",
  );
  await app.close();

  const out = chunks.join("");
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /super-secret-token/);
  assert.doesNotMatch(out, /654321/);
  assert.doesNotMatch(out, /\+15555550123/);
  assert.doesNotMatch(out, /test_fixture_source_password/);
  assert.doesNotMatch(out, /test_fixture_private_user/);
  assert.doesNotMatch(out, /test_fixture_nested_password/);
  assert.doesNotMatch(out, /test_fixture_nested_user/);
  assert.doesNotMatch(out, /test_fixture_sidecar_capability/);
});
