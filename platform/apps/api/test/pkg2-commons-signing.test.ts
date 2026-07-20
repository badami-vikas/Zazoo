/**
 * PKG-2 (Month-6) — HttpCommonsClient supply-chain trust at the transport seam:
 * TLS-by-default + verify-on-install. The client is tested against a mocked
 * fetch returning entries signed with node:crypto using the EXACT conventions
 * the Commons signer uses (services/commons/src/signing.ts): PEM keys, base64
 * raw signature over the UTF-8 bytes of @bridge/core's canonicalizeManifest.
 * (apps/api does not depend on @bridge/commons; both sides share core's
 * canonicalization + crypto conventions, so this fully exercises the contract.)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  CommonsInsecureTransportError,
  type ModuleManifest,
} from "@bridge/core";
import { CommonsResponseMismatchError, HttpCommonsClient, CommonsSignatureError } from "../src/commons-client.js";
import {
  makeUnsignedCommonsEntry,
  signCommonsEntryForTest,
  TEST_COMMONS_PROVENANCE,
} from "./commons-fixtures.js";

function makeKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function fixtureManifest(): ModuleManifest {
  return {
    name: "test-fixture-signed-pkg",
    version: "1.0.0",
    kind: "module",
    summary: "test fixture signed module",
    description: "test fixture signed module",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: "cap",
        name: "cap",
        version: "1.0.0",
        capabilityType: "skill",
        origin: "community",
        audience: "private",
        permissions: [],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("HttpCommonsClient: TLS-by-default — rejects a remote plaintext COMMONS_URL, allows https and loopback", () => {
  assert.throws(() => new HttpCommonsClient("http://commons.bridge.example"), CommonsInsecureTransportError);
  assert.ok(new HttpCommonsClient("https://commons.bridge.example"));
  assert.ok(new HttpCommonsClient("http://localhost:4780"));
  assert.ok(new HttpCommonsClient("http://127.0.0.1:4780"));
});

test("HttpCommonsClient.getVersion: accepts a validly-signed entry (verify-on-install)", async (t) => {
  const keyPair = makeKeyPair();
  const manifest = fixtureManifest();
  const entry = signCommonsEntryForTest(manifest, keyPair);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  const fetched = await client.getVersion("test-fixture-signed-pkg", "1.0.0");
  assert.equal(fetched?.name, "test-fixture-signed-pkg");
});

test("HttpCommonsClient rejects substitution of another validly signed module", async (t) => {
  const keyPair = makeKeyPair();
  const substitutedManifest = { ...fixtureManifest(), name: "test-fixture-other-pkg" };
  const entry = signCommonsEntryForTest(substitutedManifest, keyPair);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  await assert.rejects(
    () => client.getVersion("test-fixture-signed-pkg", "1.0.0"),
    CommonsResponseMismatchError,
  );
});

test("HttpCommonsClient.get rejects substitution in module detail responses", async (t) => {
  const keyPair = makeKeyPair();
  const substitutedManifest = { ...fixtureManifest(), name: "test-fixture-other-pkg" };
  const latest = signCommonsEntryForTest(substitutedManifest, keyPair);
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ name: "test-fixture-other-pkg", latest, versions: [] })
  );

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  await assert.rejects(() => client.get("test-fixture-signed-pkg"), CommonsResponseMismatchError);
});

test("HttpCommonsClient.getVersion: rejects an ALTERED manifest with a hash mismatch", async (t) => {
  const keyPair = makeKeyPair();
  const manifest = fixtureManifest();
  const tampered = { ...manifest, summary: "tampered after signing" };
  const entry = {
    ...signCommonsEntryForTest(manifest, keyPair),
    summary: tampered.summary,
    manifest: tampered,
  };
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "hash_mismatch");
    return true;
  });
});

test("HttpCommonsClient.getVersion: rejects a recomputed hash when the signed envelope was altered", async (t) => {
  const keyPair = makeKeyPair();
  const manifest = fixtureManifest();
  const original = signCommonsEntryForTest(manifest, keyPair);
  const tampered = { ...manifest, summary: "tampered and rehashed" };
  const entry = { ...makeUnsignedCommonsEntry(tampered), signature: original.signature };
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "invalid_signature");
    return true;
  });
});

test("HttpCommonsClient.getVersion: rejects an UNSIGNED entry (missing_signature)", async (t) => {
  const manifest = fixtureManifest();
  const entry = makeUnsignedCommonsEntry(manifest);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780");
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "missing_signature");
    return true;
  });
});

test("HttpCommonsClient.getVersion: rejects a valid signature from an UNTRUSTED key when an allowlist is set", async (t) => {
  const publisher = makeKeyPair();
  const otherKey = makeKeyPair();
  const manifest = fixtureManifest();
  const entry = signCommonsEntryForTest(manifest, publisher);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [otherKey.publicKeyPem] });
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "untrusted_key");
    return true;
  });
});

test("HttpCommonsClient.getVersion: rejects a valid signature when no trust root is configured", async (t) => {
  const publisher = makeKeyPair();
  const entry = signCommonsEntryForTest(fixtureManifest(), publisher);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780");
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "untrusted_key");
    return true;
  });
});

test("HttpCommonsClient: verifySignatures:false disables the gate (controlled legacy case)", async (t) => {
  const manifest = fixtureManifest();
  const entry = makeUnsignedCommonsEntry(manifest);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { verifySignatures: false });
  const fetched = await client.getVersion("test-fixture-signed-pkg", "1.0.0");
  assert.equal(fetched?.name, "test-fixture-signed-pkg");
});

test("HttpCommonsClient.getVersion: returns null on 404 without touching verification", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ error: "not_found" }, 404));
  const client = new HttpCommonsClient("http://localhost:4780");
  assert.equal(await client.getVersion("nope", "1.0.0"), null);
});

test("HttpCommonsClient.getVersion: rejects an entry whose deterministic scan did not pass", async (t) => {
  const keyPair = makeKeyPair();
  const entry = signCommonsEntryForTest(
    fixtureManifest(),
    keyPair,
    [],
    {
      scanner: "bridge-commons-manifest",
      scannerVersion: "1.0.0",
      policyVersion: "CM1-2026-07",
      status: "failed",
      riskBand: "informational",
      lethalTrifecta: false,
      checks: [{ id: "content-license", status: "fail", detail: "license absent" }],
    },
  );
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "scan_failed");
    return true;
  });
});

test("HttpCommonsClient sends generalized publish metadata and no organization or personal identifiers", async (t) => {
  let requestBody = "";
  let authorization = "";
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body ?? "");
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return jsonResponse({ name: "test-fixture-signed-pkg", version: "1.0.0", contentHash: "sha256:abc" }, 201);
  });

  const client = new HttpCommonsClient("http://localhost:4780", {
    publishToken: "test-commons-publisher-token-00000001",
  });
  await client.publish(fixtureManifest(), { provenance: TEST_COMMONS_PROVENANCE, tags: ["generalized"] });

  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(authorization, "Bearer test-commons-publisher-token-00000001");
  assert.equal("organizationId" in body, false);
  assert.equal("userId" in body, false);
  assert.equal("email" in body, false);
  assert.equal(requestBody.includes("b0000000-0000-4000-a000-000000000001"), false);
});
