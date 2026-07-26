import assert from "node:assert/strict";
import test from "node:test";
import { createSessionActivationCoordinator } from "../src/app/auth/session-activation.ts";
import { buildApiAuthorizationHeaders } from "../src/app/lib/api-authorization.ts";

test("hosted wake completes before the Supabase bearer token is captured", async () => {
  const events = [];
  let accessToken = "test_fixture_stale_token";

  const headers = await buildApiAuthorizationHeaders({
    ensureReady: async () => {
      events.push("wake");
      accessToken = "test_fixture_refreshed_token";
    },
    readSession: async () => {
      events.push("session");
      return {
        data: { session: { access_token: accessToken } },
        error: null,
      };
    },
  });

  assert.deepEqual(events, ["wake", "session"]);
  assert.equal(
    headers.authorization,
    "Bearer test_fixture_refreshed_token",
  );
});

test("a failed wake never reads or sends an authenticated session", async () => {
  let sessionReads = 0;

  await assert.rejects(
    buildApiAuthorizationHeaders({
      ensureReady: async () => {
        throw new Error("test_fixture_api_unavailable");
      },
      readSession: async () => {
        sessionReads += 1;
        return {
          data: { session: { access_token: "test_fixture_token" } },
          error: null,
        };
      },
    }),
    /test_fixture_api_unavailable/,
  );

  assert.equal(sessionReads, 0);
});

test("initial and refreshed sessions share one Organization activation", async () => {
  const coordinator = createSessionActivationCoordinator();
  let activationCalls = 0;
  let releaseActivation;
  const activation = new Promise((resolve) => {
    releaseActivation = resolve;
  });
  const run = async () => {
    activationCalls += 1;
    await activation;
  };

  const initialSession = coordinator.activate("test_fixture_subject", run);
  const duplicateInitialEvent = coordinator.activate(
    "test_fixture_subject",
    run,
  );
  assert.equal(activationCalls, 1);

  releaseActivation();
  await Promise.all([initialSession, duplicateInitialEvent]);
  await coordinator.activate("test_fixture_subject", run);

  assert.equal(activationCalls, 1);
  assert.equal(coordinator.isActivated("test_fixture_subject"), true);
});

test("sign-out invalidates an in-flight activation", async () => {
  const coordinator = createSessionActivationCoordinator();
  let releaseActivation;
  const activation = new Promise((resolve) => {
    releaseActivation = resolve;
  });

  const pending = coordinator.activate(
    "test_fixture_subject",
    () => activation,
  );
  coordinator.reset();
  releaseActivation();
  await pending;

  assert.equal(coordinator.isActivated("test_fixture_subject"), false);
});
