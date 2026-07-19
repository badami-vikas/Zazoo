/**
 * Fresh-OAuth2-client-per-invocation fix (All fixes.md section 3, P2): before this,
 * `GoogleApiGatewayFactory.forIntegration` built a brand-new `OAuth2Client` (and
 * attached a brand-new `tokens` listener) on EVERY call, even for the same
 * integrationId — no cache. This proves:
 *
 *   1. Two calls for the SAME integrationId return the SAME GoogleGateway/client
 *      (reference equality), not two freshly-constructed ones.
 *   2. Two calls for DIFFERENT integrationIds get DIFFERENT gateways.
 *   3. After a disconnect (token deleted) + reconnect (new token written), the next
 *      call gets a FRESH gateway, not the stale cached one.
 *   4. Explicit `invalidate()` also forces a fresh gateway on next use.
 *
 * Constructing `google.auth.OAuth2` does no network I/O, so this drives the REAL
 * `GoogleApiGatewayFactory` with a fake in-memory `SecretStore` — no mocking needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SecretStore, OAuthTokenRecord } from "@bridge/local";
import { GoogleApiGatewayFactory } from "../src/gateway-google.js";

class FakeSecretStore implements SecretStore {
  readonly tokens = new Map<string, OAuthTokenRecord>();
  async putToken(rec: OAuthTokenRecord): Promise<void> {
    this.tokens.set(rec.integrationId, rec);
  }
  async getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    return this.tokens.get(integrationId) ?? null;
  }
  async deleteToken(integrationId: string): Promise<void> {
    this.tokens.delete(integrationId);
  }
  async compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): Promise<boolean> {
    const current = this.tokens.get(integrationId) ?? null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    if (replacement) this.tokens.set(integrationId, replacement);
    else this.tokens.delete(integrationId);
    return true;
  }
  async finalizeToken(
    replacement: OAuthTokenRecord,
    stillAuthorized: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!(await stillAuthorized()) || !(await stillAuthorized())) return false;
    this.tokens.set(replacement.integrationId, replacement);
    return true;
  }
}

function dummyToken(integrationId: string, updatedAt: string): OAuthTokenRecord {
  return {
    integrationId,
    organizationId: "test_fixture_ws_1",
    provider: "google",
    accessToken: "test_fixture_access_token",
    refreshToken: "test_fixture_refresh_token",
    scope: "test_fixture_scope",
    tokenType: "Bearer",
    updatedAt,
  };
}

const cfg = { clientId: "test_fixture_client_id", clientSecret: "test_fixture_client_secret", redirectUri: "http://localhost/test_fixture_callback" };

test("forIntegration reuses the same gateway/client across repeated calls for the same integrationId", async () => {
  const secrets = new FakeSecretStore();
  secrets.tokens.set("test_fixture_integration_1", dummyToken("test_fixture_integration_1", "2026-01-01T00:00:00.000Z"));
  const factory = new GoogleApiGatewayFactory(cfg, secrets);

  const gw1 = await factory.forIntegration("test_fixture_integration_1");
  const gw2 = await factory.forIntegration("test_fixture_integration_1");
  const gw3 = await factory.forIntegration("test_fixture_integration_1");

  assert.equal(gw1, gw2, "second call must reuse the same gateway instance");
  assert.equal(gw2, gw3, "third call must reuse the same gateway instance");
});

test("forIntegration returns distinct gateways for distinct integrationIds", async () => {
  const secrets = new FakeSecretStore();
  secrets.tokens.set("test_fixture_integration_1", dummyToken("test_fixture_integration_1", "2026-01-01T00:00:00.000Z"));
  secrets.tokens.set("test_fixture_integration_2", dummyToken("test_fixture_integration_2", "2026-01-01T00:00:00.000Z"));
  const factory = new GoogleApiGatewayFactory(cfg, secrets);

  const gw1 = await factory.forIntegration("test_fixture_integration_1");
  const gw2 = await factory.forIntegration("test_fixture_integration_2");

  assert.notEqual(gw1, gw2);
});

test("disconnect (token deleted) then reconnect (new token) yields a fresh gateway, not the stale cached one", async () => {
  const secrets = new FakeSecretStore();
  secrets.tokens.set("test_fixture_integration_1", dummyToken("test_fixture_integration_1", "2026-01-01T00:00:00.000Z"));
  const factory = new GoogleApiGatewayFactory(cfg, secrets);

  const gwBefore = await factory.forIntegration("test_fixture_integration_1");

  // Disconnect: token removed from the store.
  await secrets.deleteToken("test_fixture_integration_1");
  await assert.rejects(() => factory.forIntegration("test_fixture_integration_1"), /not connected/);

  // Reconnect: a fresh token (new updatedAt) is written.
  secrets.tokens.set("test_fixture_integration_1", dummyToken("test_fixture_integration_1", "2026-02-01T00:00:00.000Z"));
  const gwAfter = await factory.forIntegration("test_fixture_integration_1");

  assert.notEqual(gwBefore, gwAfter, "post-reconnect gateway must not be the stale cached one");
});

test("explicit invalidate() forces a fresh gateway on next use even without a token change", async () => {
  const secrets = new FakeSecretStore();
  secrets.tokens.set("test_fixture_integration_1", dummyToken("test_fixture_integration_1", "2026-01-01T00:00:00.000Z"));
  const factory = new GoogleApiGatewayFactory(cfg, secrets);

  const gwBefore = await factory.forIntegration("test_fixture_integration_1");
  factory.invalidate("test_fixture_integration_1");
  const gwAfter = await factory.forIntegration("test_fixture_integration_1");

  assert.notEqual(gwBefore, gwAfter);
});
