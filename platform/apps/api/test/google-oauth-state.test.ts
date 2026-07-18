import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { appRouter } from "../src/router.js";
import { GoogleOAuthStateStore } from "../src/google-oauth-state.js";
import { registerGoogleOAuthRoutes } from "../src/google-oauth-routes.js";
import {
  buildWiring,
  PILOT_USER,
  PILOT_WORKSPACE,
} from "../src/wiring.js";
import { SeededRng, SystemClock, UuidGen } from "@bridge/core";

class TestStatePort {
  readonly rows = new Map<string, unknown>();

  async update<T>(
    workspaceId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T> {
    const key = JSON.stringify([workspaceId, namespace]);
    const current = structuredClone(this.rows.get(key) ?? initialState);
    const mutation = reduce(current);
    this.rows.set(key, structuredClone(mutation.state));
    return mutation.result;
  }
}

test("OAuth states are hashed at rest, single-use, bound, and expiring", async () => {
  let now = Date.parse("2026-07-18T00:00:00.000Z");
  const statePort = new TestStatePort();
  const states = new GoogleOAuthStateStore(statePort, () => now, 1_000);
  const issued = await states.issue(
    PILOT_WORKSPACE,
    `${PILOT_WORKSPACE}:google`,
    PILOT_USER,
  );
  const raw = issued.state;

  assert.match(raw, /^oauth_[0-9a-f]{64}$/);
  assert.match(issued.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify([...statePort.rows.values()]).includes(raw), false);
  const consumed = await states.consume(PILOT_WORKSPACE, raw);
  assert.equal(consumed?.integrationId, `${PILOT_WORKSPACE}:google`);
  assert.equal(consumed?.actorId, PILOT_USER);
  assert.equal(consumed?.expiresAt, "2026-07-18T00:00:01.000Z");
  assert.match(consumed?.codeVerifier ?? "", /^[0-9a-f]{64}$/);
  assert.equal(
    createHash("sha256")
      .update(consumed?.codeVerifier ?? "")
      .digest("base64url"),
    issued.codeChallenge,
  );
  assert.equal(await states.consume(PILOT_WORKSPACE, raw), null);

  const expired = await states.issue(
    PILOT_WORKSPACE,
    `${PILOT_WORKSPACE}:google`,
    PILOT_USER,
  );
  now += 1_001;
  assert.equal(await states.consume(PILOT_WORKSPACE, expired.state), null);
});

test("Google connect issues an unpredictable state and callback rejects legacy predictable state", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const clock = new SystemClock();
    const rng = new SeededRng(91);
    const caller = appRouter.createCaller({
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const result = await caller.google.connectUrl();
    assert.ok(result.url);
    const state = new URL(result.url).searchParams.get("state");
    const codeChallenge = new URL(result.url).searchParams.get(
      "code_challenge",
    );
    assert.match(state ?? "", /^oauth_[0-9a-f]{64}$/);
    assert.match(codeChallenge ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      new URL(result.url).searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.notEqual(state, wiring.google.integrationId);

    const rejected = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=attacker-code&state=${encodeURIComponent(wiring.google.integrationId)}`,
    });
    assert.equal(rejected.statusCode, 302);
    assert.match(rejected.headers.location ?? "", /error=invalid_oauth_state/);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("desktop OAuth callbacks render a local completion page instead of redirecting to Vite", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  const priorDesktop = process.env.BRIDGE_OAUTH_DESKTOP;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  process.env.BRIDGE_OAUTH_DESKTOP = "1";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const response = await app.inject({
      method: "GET",
      url: "/integrations/google/callback",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.headers.location, undefined);
    assert.match(
      response.headers["content-type"] ?? "",
      /^text\/html; charset=utf-8/,
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /Return to Bridge and try again/);
    assert.doesNotMatch(response.body, /localhost:5173/);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
    if (priorDesktop === undefined) delete process.env.BRIDGE_OAUTH_DESKTOP;
    else process.env.BRIDGE_OAUTH_DESKTOP = priorDesktop;
  }
});

test("OAuth callback rejects an actor whose workspace membership was revoked after issuance", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const { state } = await wiring.googleOAuthStates.issue(
      PILOT_WORKSPACE,
      wiring.google.integrationId,
      PILOT_USER,
    );
    wiring.workspaceStore.isMember = async () => false;

    const response = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=unexchanged-code&state=${encodeURIComponent(state)}`,
    });

    assert.equal(response.statusCode, 302);
    assert.match(
      response.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.equal(
      await wiring.googleOAuthStates.consume(PILOT_WORKSPACE, state),
      null,
    );
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth callback rechecks membership after code exchange and before token storage", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  let membershipChecks = 0;
  let exchanged = false;
  let exchangedCodeVerifier = "";
  try {
    await registerGoogleOAuthRoutes(app, wiring, async (
      _config,
      _code,
      codeVerifier,
    ) => {
      exchanged = true;
      exchangedCodeVerifier = codeVerifier;
      return {
        accessToken: "test_fixture_access_token",
        refreshToken: "test_fixture_refresh_token",
        scope: "test_fixture_scope",
        tokenType: "Bearer",
      };
    });
    const { state } = await wiring.googleOAuthStates.issue(
      PILOT_WORKSPACE,
      wiring.google.integrationId,
      PILOT_USER,
    );
    wiring.workspaceStore.isMember = async () => {
      membershipChecks += 1;
      return membershipChecks === 1;
    };

    const response = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=exchangeable-code&state=${encodeURIComponent(state)}`,
    });

    assert.equal(exchanged, true);
    assert.match(exchangedCodeVerifier, /^[0-9a-f]{64}$/);
    assert.equal(membershipChecks, 2);
    assert.equal(response.statusCode, 302);
    assert.match(
      response.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.equal((await wiring.google.connectionInfo()).connected, false);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth callback restores the exact prior token when membership is revoked during persistence", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  const integrationId = wiring.google.integrationId;
  const priorToken = {
    integrationId,
    workspaceId: PILOT_WORKSPACE,
    provider: "google",
    accessToken: "test_fixture_prior_access",
    refreshToken: "test_fixture_prior_refresh",
    scope: "test_fixture_prior_scope",
    tokenType: "Bearer",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  let membershipChecks = 0;
  let releasePostWrite = (): void => {};
  let markPostWriteReached = (): void => {};
  const postWriteReached = new Promise<void>((resolve) => {
    markPostWriteReached = resolve;
  });
  const continuePostWrite = new Promise<void>((resolve) => {
    releasePostWrite = resolve;
  });
  try {
    await wiring.localPlane.secrets.putToken(priorToken);
    wiring.workspaceStore.isMember = async () => {
      membershipChecks += 1;
      if (membershipChecks === 3) {
        markPostWriteReached();
        await continuePostWrite;
        return false;
      }
      return true;
    };
    await registerGoogleOAuthRoutes(app, wiring, async () => ({
      accessToken: "test_fixture_replacement_access",
      refreshToken: "test_fixture_replacement_refresh",
      scope: "test_fixture_replacement_scope",
      tokenType: "Bearer",
    }));
    const { state } = await wiring.googleOAuthStates.issue(
      PILOT_WORKSPACE,
      integrationId,
      PILOT_USER,
    );

    const pendingResponse = app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=exchangeable-code&state=${encodeURIComponent(state)}`,
    });
    await postWriteReached;
    let readSettled = false;
    const concurrentRead = wiring.localPlane.secrets
      .getToken(integrationId)
      .then((token) => {
        readSettled = true;
        return token;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      readSettled,
      false,
      "token readers must not observe a provisional replacement",
    );
    releasePostWrite();
    const response = await pendingResponse;

    assert.equal(response.statusCode, 302);
    assert.match(
      response.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.deepEqual(await concurrentRead, priorToken);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("concurrent OAuth callbacks serialize provisional token finalization", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  const integrationId = wiring.google.integrationId;
  let member = true;
  let exchanges = 0;
  let releaseExchanges = (): void => {};
  const bothExchanged = new Promise<void>((resolve) => {
    releaseExchanges = resolve;
  });
  let finalizationChecks = 0;
  let activeFinalizationChecks = 0;
  let maxActiveFinalizationChecks = 0;
  try {
    wiring.workspaceStore.isMember = async () => {
      if (exchanges < 2) return member;
      activeFinalizationChecks += 1;
      maxActiveFinalizationChecks = Math.max(
        maxActiveFinalizationChecks,
        activeFinalizationChecks,
      );
      finalizationChecks += 1;
      const check = finalizationChecks;
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (check === 2) member = false;
        return member;
      } finally {
        activeFinalizationChecks -= 1;
      }
    };
    await registerGoogleOAuthRoutes(app, wiring, async (_config, code) => {
      exchanges += 1;
      if (exchanges === 2) releaseExchanges();
      await bothExchanged;
      return {
        accessToken:
          code === "code-a"
            ? "test_fixture_access_a"
            : "test_fixture_access_b",
        refreshToken: "test_fixture_refresh",
        scope: "test_fixture_scope",
        tokenType: "Bearer",
      };
    });
    const [issuedA, issuedB] = await Promise.all([
      wiring.googleOAuthStates.issue(
        PILOT_WORKSPACE,
        integrationId,
        PILOT_USER,
      ),
      wiring.googleOAuthStates.issue(
        PILOT_WORKSPACE,
        integrationId,
        PILOT_USER,
      ),
    ]);
    const stateA = issuedA.state;
    const stateB = issuedB.state;

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/integrations/google/callback?code=code-a&state=${encodeURIComponent(stateA)}`,
      }),
      app.inject({
        method: "GET",
        url: `/integrations/google/callback?code=code-b&state=${encodeURIComponent(stateB)}`,
      }),
    ]);

    assert.equal(maxActiveFinalizationChecks, 1);
    assert.match(
      responseA.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.match(
      responseB.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.equal(
      await wiring.localPlane.secrets.getToken(integrationId),
      null,
    );
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});
