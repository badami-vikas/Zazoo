import assert from "node:assert/strict";
import test from "node:test";
import {
  KeyringCredentialError,
  KeyringSourceCredentialVault,
  type KeyringEntryFactory,
} from "../src/keyring-credentials.js";

class FakeKeyring {
  readonly values = new Map<string, string>();

  factory: KeyringEntryFactory = (service, account) => {
    const key = JSON.stringify([service, account]);
    return {
      setPassword: async (password) => {
        this.values.set(key, password);
      },
      getPassword: async () => this.values.get(key),
      deleteCredential: async () => this.values.delete(key),
    };
  };
}

test("OS keyring references and projections never disclose credential values", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({
    service: "com.bridge.test",
    entryFactory: keyring.factory,
  });
  const scope = { organizationId: "organization-a", sourceId: "source-a" };
  const reference = await vault.put(
    scope,
    {
      userId: "operator@example.invalid",
      password: "high-value-secret",
    },
  );

  assert.match(reference, /^keyring:\/\/com\.bridge\.test\//);
  assert.equal(reference.includes("operator@example.invalid"), false);
  assert.equal(reference.includes("high-value-secret"), false);
  const projection = await vault.metadata(scope, reference);
  assert.equal(projection?.userId.state, "available");
  assert.notEqual(projection?.userId.masked, "operator@example.invalid");
  assert.equal(projection?.password.masked, "********");
  assert.equal(JSON.stringify(projection).includes("high-value-secret"), false);
  assert.equal(await vault.read(scope, reference, "password"), "high-value-secret");

  await vault.delete(scope, reference);
  assert.equal(await vault.metadata(scope, reference), null);
});

test("OS keyring scope creates distinct opaque entries per organization and Source", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({ entryFactory: keyring.factory });
  const first = await vault.put(
    { organizationId: "organization-a", sourceId: "source-a" },
    { password: "secret-a" },
  );
  const second = await vault.put(
    { organizationId: "organization-b", sourceId: "source-a" },
    { password: "secret-b" },
  );

  assert.notEqual(first, second);
  assert.equal(
    await vault.read({ organizationId: "organization-a", sourceId: "source-a" }, first, "password"),
    "secret-a",
  );
  assert.equal(
    await vault.read({ organizationId: "organization-b", sourceId: "source-a" }, second, "password"),
    "secret-b",
  );
});

test("concurrent writes for one Source own separate entries so compensation cannot delete the winner", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({ entryFactory: keyring.factory });
  const scope = { organizationId: "organization-a", sourceId: "source-a" };
  const losingReference = await vault.put(scope, { password: "losing-secret" });
  const winningReference = await vault.put(scope, { password: "winning-secret" });

  assert.notEqual(losingReference, winningReference);
  await vault.delete(scope, losingReference);
  assert.equal(await vault.read(scope, winningReference, "password"), "winning-secret");
});

test("OS keyring rejects foreign or malformed references and entries", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({
    service: "com.bridge.test",
    entryFactory: keyring.factory,
  });
  await assert.rejects(
    vault.read(
      { organizationId: "organization-a", sourceId: "source-a" },
      "https://com.bridge.test/account",
      "password",
    ),
    (error: unknown) => {
      assert.ok(error instanceof KeyringCredentialError);
      assert.equal(error.code, "invalid_reference");
      return true;
    },
  );
  await assert.rejects(
    vault.read(
      { organizationId: "organization-a", sourceId: "source-a" },
      "keyring://foreign.service/account",
      "password",
    ),
    KeyringCredentialError,
  );
  await assert.rejects(
    vault.read(
      { organizationId: "organization-a", sourceId: "source-a" },
      "keyring://com.bridge.test/not-a-bridge-account",
      "password",
    ),
    KeyringCredentialError,
  );

  const reference = await vault.put(
    { organizationId: "organization-a", sourceId: "source-a" },
    { password: "secret-a" },
  );
  const onlyKey = [...keyring.values.keys()][0]!;
  keyring.values.set(onlyKey, "{\"version\":2,\"password\":\"secret-a\"}");
  await assert.rejects(
    vault.metadata({ organizationId: "organization-a", sourceId: "source-a" }, reference),
    /unsupported format/,
  );
});

test("OS keyring rejects a reference outside the requested Organization or Source", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({
    service: "com.bridge.test",
    entryFactory: keyring.factory,
  });
  const reference = await vault.put(
    { organizationId: "organization-a", sourceId: "source-a" },
    { password: "high-value-secret" },
  );

  await assert.rejects(
    vault.read(
      { organizationId: "organization-b", sourceId: "source-a" },
      reference,
      "password",
    ),
    (error: unknown) => {
      assert.ok(error instanceof KeyringCredentialError);
      assert.equal(error.code, "scope_mismatch");
      return true;
    },
  );
});

test("OS keyring adapter propagates provider failures without an in-memory fallback", async () => {
  const providerError = new Error("credential provider unavailable");
  const vault = new KeyringSourceCredentialVault({
    entryFactory: () => ({
      setPassword: async () => {
        throw providerError;
      },
      getPassword: async () => {
        throw providerError;
      },
      deleteCredential: async () => {
        throw providerError;
      },
    }),
  });

  await assert.rejects(
    vault.put(
      { organizationId: "organization-a", sourceId: "source-a" },
      { password: "secret-a" },
    ),
    providerError,
  );
});

test("OS keyring treats a provider NoEntry as an idempotent missing credential", async () => {
  const missing = new Error("No matching entry found in secure storage");
  missing.name = "NoEntry";
  const vault = new KeyringSourceCredentialVault({
    service: "com.bridge.test",
    entryFactory: () => ({
      setPassword: async () => {},
      getPassword: async () => {
        throw missing;
      },
      deleteCredential: async () => {
        throw missing;
      },
    }),
  });
  const scope = { organizationId: "organization-a", sourceId: "source-a" };
  const reference = await new KeyringSourceCredentialVault({
    service: "com.bridge.test",
    entryFactory: new FakeKeyring().factory,
  }).put(scope, { password: "test_fixture_secret" });

  assert.equal(await vault.metadata(scope, reference), null);
  await assert.doesNotReject(vault.delete(scope, reference));
});

test("a credential written under the OLD service name is still readable after the rename (BUGS 2026-09-06)", async () => {
  const keyring = new FakeKeyring();
  const scope = { organizationId: "organization-a", sourceId: "source-a" };

  // Written by the build that named the service after DealPilot.
  const legacy = new KeyringSourceCredentialVault({
    service: "com.bridge.dealpilot",
    entryFactory: keyring.factory,
  });
  const reference = await legacy.put(scope, { password: "claude-sign-in-token" });
  assert.match(reference, /^keyring:\/\/com\.bridge\.dealpilot\//);

  // The renamed vault reads and deletes it where it actually lives, and writes
  // everything new under its own name.
  const renamed = new KeyringSourceCredentialVault({
    service: "Bridge",
    legacyServices: ["com.bridge.dealpilot"],
    entryFactory: keyring.factory,
  });
  assert.equal(await renamed.read(scope, reference, "password"), "claude-sign-in-token");
  assert.equal((await renamed.metadata(scope, reference))?.password.state, "available");
  assert.match(renamed.reserve(scope), /^keyring:\/\/Bridge\//);

  await renamed.delete(scope, reference);
  assert.equal(await renamed.read(scope, reference, "password"), null);
  assert.equal(keyring.values.size, 0, "the legacy entry is gone from the legacy service, not orphaned");
});

test("a reference naming a service this vault does not own is still refused", async () => {
  const keyring = new FakeKeyring();
  const vault = new KeyringSourceCredentialVault({
    service: "Bridge",
    legacyServices: ["com.bridge.dealpilot"],
    entryFactory: keyring.factory,
  });
  const scope = { organizationId: "organization-a", sourceId: "source-a" };
  const foreign = (await new KeyringSourceCredentialVault({
    service: "com.example.other",
    entryFactory: keyring.factory,
  }).put(scope, { password: "not-ours" }));
  await assert.rejects(
    () => vault.read(scope, foreign, "password"),
    (error: unknown) =>
      error instanceof KeyringCredentialError && error.code === "invalid_reference",
  );
});
