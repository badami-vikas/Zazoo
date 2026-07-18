import { EventEmitter } from "node:events";
import { setImmediate as waitImmediate } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OAuthTokenRecord, SecretStore } from "@bridge/local";
import type { GoogleApiGatewayFactory as GoogleApiGatewayFactoryType } from "../src/gateway-google.js";

class RejectingSecretStore implements SecretStore {
  readonly tokens = new Map<string, OAuthTokenRecord>();

  async putToken(): Promise<void> {
    throw new Error("test_fixture_put_token_rejected");
  }

  async getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    return this.tokens.get(integrationId) ?? null;
  }

  async deleteToken(integrationId: string): Promise<void> {
    this.tokens.delete(integrationId);
  }

  async compareAndSwapToken(): Promise<boolean> {
    throw new Error("test_fixture_compare_and_swap_rejected");
  }

  async finalizeToken(): Promise<boolean> {
    throw new Error("test_fixture_finalize_token_rejected");
  }
}

function testFixtureToken(integrationId: string): OAuthTokenRecord {
  return {
    integrationId,
    workspaceId: "test_fixture_ws_1",
    provider: "google",
    accessToken: "test_fixture_access_token",
    refreshToken: "test_fixture_refresh_token",
    scope: "test_fixture_scope",
    tokenType: "Bearer",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function freshGatewayModule(): Promise<{ GoogleApiGatewayFactory: typeof GoogleApiGatewayFactoryType }> {
  return import(`../src/gateway-google.js?t=${Date.now()}-${Math.random()}`) as Promise<{
    GoogleApiGatewayFactory: typeof GoogleApiGatewayFactoryType;
  }>;
}

const cfg = {
  clientId: "test_fixture_client_id",
  clientSecret: "test_fixture_client_secret",
  redirectUri: "http://localhost/test_fixture_callback",
};

test("token refresh persist failures are logged and do not become unhandled rejections", async (t) => {
  const fakeClient = new EventEmitter();
  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => ({ users: { threads: { list: async () => ({ data: {} }), get: async () => ({ data: {} }) } } }),
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });
  const oauthMock = t.mock.module("../src/oauth.js", {
    namedExports: {
      clientFromToken: () => fakeClient,
    },
  });
  let sawUnhandledRejection = false;
  const onUnhandledRejection = (): void => {
    sawUnhandledRejection = true;
  };
  process.once("unhandledRejection", onUnhandledRejection);

  const { GoogleApiGatewayFactory } = await freshGatewayModule();
  await waitImmediate();
  const errSpy = t.mock.method(console, "error", () => {});

  try {
    const secrets = new RejectingSecretStore();
    secrets.tokens.set("test_fixture_integration_1", testFixtureToken("test_fixture_integration_1"));
    const factory = new GoogleApiGatewayFactory(cfg, secrets);

    await factory.forIntegration("test_fixture_integration_1");
    fakeClient.emit("tokens", {
      access_token: "test_fixture_new_access_token",
      expiry_date: Date.now() + 3_600_000,
    });
    await waitImmediate();

    assert.equal(errSpy.mock.callCount(), 1);
    assert.match(String(errSpy.mock.calls[0]?.arguments[0]), /failed to persist refreshed token/);
    assert.match(
      String(errSpy.mock.calls[0]?.arguments[1]),
      /test_fixture_compare_and_swap_rejected/,
    );
    assert.equal(sawUnhandledRejection, false);
  } finally {
    process.removeListener("unhandledRejection", onUnhandledRejection);
    errSpy.mock.restore();
    oauthMock.restore();
    googleapisMock.restore();
  }
});
