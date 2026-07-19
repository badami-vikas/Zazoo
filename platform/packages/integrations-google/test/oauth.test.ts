import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { OAuthTokenRecord } from "@bridge/local";
import { GOOGLE_SCOPES } from "../src/contracts.js";

class test_fixture_FakeOAuth2 {
  static instances: test_fixture_FakeOAuth2[] = [];
  static tokensByCode = new Map<string, Record<string, unknown>>();

  credentials: unknown;
  readonly constructorArgs: string[];

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.constructorArgs = [clientId, clientSecret, redirectUri];
    test_fixture_FakeOAuth2.instances.push(this);
  }

  generateAuthUrl(args: unknown): string {
    this.credentials = args;
    return `https://accounts.example.test/auth?state=${encodeURIComponent((args as { state: string }).state)}`;
  }

  async getToken(input: {
    code: string;
    codeVerifier: string;
  }): Promise<{ tokens: Record<string, unknown> }> {
    this.credentials = input;
    return {
      tokens: test_fixture_FakeOAuth2.tokensByCode.get(input.code) ?? {},
    };
  }

  setCredentials(credentials: unknown): void {
    this.credentials = credentials;
  }
}

mock.module("googleapis", {
  namedExports: { google: { auth: { OAuth2: test_fixture_FakeOAuth2 } } },
});

const oauth = await import("../src/oauth.js");

const cfg = {
  clientId: "test_fixture_client_id",
  clientSecret: "test_fixture_client_secret",
  redirectUri: "http://localhost/test_fixture_callback",
};

test("oauthConfigFromEnv returns null unless client id and secret are configured, and defaults redirect uri", () => {
  const oldClientId = process.env.GOOGLE_CLIENT_ID;
  const oldClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const oldRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    assert.equal(oauth.oauthConfigFromEnv(), null);

    process.env.GOOGLE_CLIENT_ID = "test_fixture_env_client";
    process.env.GOOGLE_CLIENT_SECRET = "test_fixture_env_secret";
    assert.deepEqual(oauth.oauthConfigFromEnv(), {
      clientId: "test_fixture_env_client",
      clientSecret: "test_fixture_env_secret",
      redirectUri: "http://localhost:4000/integrations/google/callback",
    });

    process.env.GOOGLE_REDIRECT_URI = "http://localhost/test_fixture_env_callback";
    assert.deepEqual(oauth.oauthConfigFromEnv(), {
      clientId: "test_fixture_env_client",
      clientSecret: "test_fixture_env_secret",
      redirectUri: "http://localhost/test_fixture_env_callback",
    });
  } finally {
    if (oldClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = oldClientId;
    if (oldClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = oldClientSecret;
    if (oldRedirectUri === undefined) delete process.env.GOOGLE_REDIRECT_URI;
    else process.env.GOOGLE_REDIRECT_URI = oldRedirectUri;
  }
});

test("authUrl asks Google for offline consent bound with PKCE S256", () => {
  test_fixture_FakeOAuth2.instances = [];
  const url = oauth.authUrl(
    cfg,
    "test_fixture_state",
    "test_fixture_code_challenge",
  );
  const client = test_fixture_FakeOAuth2.instances[0]!;

  assert.equal(url, "https://accounts.example.test/auth?state=test_fixture_state");
  assert.deepEqual(client.constructorArgs, [cfg.clientId, cfg.clientSecret, cfg.redirectUri]);
  assert.deepEqual(client.credentials, {
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state: "test_fixture_state",
    code_challenge: "test_fixture_code_challenge",
    code_challenge_method: "S256",
  });
});

test("exchangeCode normalizes optional token fields and rejects malformed token responses", async () => {
  test_fixture_FakeOAuth2.instances = [];
  test_fixture_FakeOAuth2.tokensByCode = new Map<string, Record<string, unknown>>([
    [
      "test_fixture_good_code",
      {
        access_token: "test_fixture_access_token",
        refresh_token: "test_fixture_refresh_token",
        scope: "test_fixture_scope_a test_fixture_scope_b",
        token_type: "Bearer",
        expiry_date: 1_800_000,
      },
    ],
    ["test_fixture_minimal_code", { access_token: "test_fixture_minimal_access" }],
    ["test_fixture_bad_code", { refresh_token: "test_fixture_refresh_without_access" }],
  ]);

  assert.deepEqual(
    await oauth.exchangeCode(
      cfg,
      "test_fixture_good_code",
      "test_fixture_code_verifier",
    ),
    {
    accessToken: "test_fixture_access_token",
    refreshToken: "test_fixture_refresh_token",
    scope: "test_fixture_scope_a test_fixture_scope_b",
    tokenType: "Bearer",
    expiryDate: 1_800_000,
    },
  );
  assert.deepEqual(
    test_fixture_FakeOAuth2.instances[0]?.credentials,
    {
      code: "test_fixture_good_code",
      codeVerifier: "test_fixture_code_verifier",
    },
  );
  assert.deepEqual(
    await oauth.exchangeCode(
      cfg,
      "test_fixture_minimal_code",
      "test_fixture_code_verifier",
    ),
    {
      accessToken: "test_fixture_minimal_access",
      scope: GOOGLE_SCOPES.join(" "),
      tokenType: "Bearer",
    },
  );
  await assert.rejects(
    () =>
      oauth.exchangeCode(
        cfg,
        "test_fixture_bad_code",
        "test_fixture_code_verifier",
      ),
    /no access_token/,
  );
});

test("clientFromToken and tokenRecordFrom preserve optional fields without inventing absent values", () => {
  test_fixture_FakeOAuth2.instances = [];
  const stored: OAuthTokenRecord = {
    integrationId: "test_fixture_integration",
    organizationId: "test_fixture_organization",
    provider: "google",
    accessToken: "test_fixture_access",
    refreshToken: "test_fixture_refresh",
    scope: "test_fixture_scope",
    tokenType: "Bearer",
    expiryDate: 2_400_000,
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
  oauth.clientFromToken(cfg, stored);
  assert.deepEqual(test_fixture_FakeOAuth2.instances[0]?.credentials, {
    access_token: "test_fixture_access",
    refresh_token: "test_fixture_refresh",
    expiry_date: 2_400_000,
    token_type: "Bearer",
    scope: "test_fixture_scope",
  });

  assert.deepEqual(
    oauth.tokenRecordFrom(
      "test_fixture_integration",
      "test_fixture_organization",
      { accessToken: "test_fixture_access", scope: "test_fixture_scope", tokenType: "Bearer" },
      "2026-07-14T00:00:00.000Z",
    ),
    {
      integrationId: "test_fixture_integration",
      organizationId: "test_fixture_organization",
      provider: "google",
      accessToken: "test_fixture_access",
      scope: "test_fixture_scope",
      tokenType: "Bearer",
      updatedAt: "2026-07-14T00:00:00.000Z",
    },
  );
});
