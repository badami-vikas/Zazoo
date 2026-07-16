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
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";
import { loggerOptions } from "../src/server.js";

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
      globalThis.fetch = async () =>
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
        }), { status: 200, headers: { "content-type": "application/json" } });
      const wiring = await buildWiring();
      try {
        const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
        const result = await caller.onboarding.recommendFromRoleModel({
          workspaceId: PILOT_WORKSPACE,
          figure: "Test Fixture Leader",
          admiredFor: "clear preparation",
        });
        assert.equal(result.recommendation.citation.url, "https://en.wikipedia.org/wiki/Test_Fixture_Leader");
        assert.equal(result.proposal.status, "pending_review", JSON.stringify(result.proposal));
        assert.ok(result.proposal.policyResults.some((policy) => policy.effect === "require_approval"));

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

test("server logger: phone, OTP code, and Authorization are redacted, never written in the clear", async () => {
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
      body: { phone: "+15555550123", code: "654321" },
      headers: { authorization: "Bearer super-secret-token" },
    },
    "inbound request",
  );
  await app.close();

  const out = chunks.join("");
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /super-secret-token/);
  assert.doesNotMatch(out, /654321/);
  assert.doesNotMatch(out, /\+15555550123/);
});
