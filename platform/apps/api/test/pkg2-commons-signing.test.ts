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
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  canonicalizeManifest,
  CommonsInsecureTransportError,
  type CommonsPackageEntry,
  type ManifestSignature,
  type PackageManifest,
} from "@bridge/core";
import { HttpCommonsClient, CommonsSignatureError } from "../src/commons-client.js";

function makeKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function signManifest(manifest: PackageManifest, keyPair: { privateKeyPem: string; publicKeyPem: string }): ManifestSignature {
  const data = canonicalizeManifest(manifest);
  return {
    signature: cryptoSign(null, Buffer.from(data, "utf8"), createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: "2026-07-14T00:00:00.000Z",
  };
}

function fixtureManifest(): PackageManifest {
  return {
    name: "test-fixture-signed-pkg",
    version: "1.0.0",
    kind: "tool",
    summary: "test fixture signed package",
    description: "test fixture signed package",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: "cap",
        name: "cap",
        version: "1.0.0",
        capabilityType: "tool",
        origin: "community",
        audience: "private",
        permissions: [],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
}

function entryOf(manifest: PackageManifest, signature?: ManifestSignature): CommonsPackageEntry {
  return {
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    summary: manifest.summary,
    tags: [],
    manifest,
    publishedAt: "2026-07-14T00:00:00.000Z",
    ...(signature ? { signature } : {}),
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
  const entry = entryOf(manifest, signManifest(manifest, keyPair));
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  const fetched = await client.getVersion("test-fixture-signed-pkg", "1.0.0");
  assert.equal(fetched?.name, "test-fixture-signed-pkg");
});

test("HttpCommonsClient.getVersion: rejects an ALTERED manifest (signature no longer matches the bytes)", async (t) => {
  const keyPair = makeKeyPair();
  const manifest = fixtureManifest();
  const signature = signManifest(manifest, keyPair); // signed over the ORIGINAL bytes
  const tampered = { ...manifest, summary: "tampered after signing" };
  const entry = entryOf(tampered, signature);
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
  const entry = entryOf(manifest); // no signature
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
  const entry = entryOf(manifest, signManifest(manifest, publisher));
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [otherKey.publicKeyPem] });
  await assert.rejects(() => client.getVersion("test-fixture-signed-pkg", "1.0.0"), (err: unknown) => {
    assert.ok(err instanceof CommonsSignatureError);
    assert.equal(err.reason, "untrusted_key");
    return true;
  });
});

test("HttpCommonsClient: verifySignatures:false disables the gate (controlled legacy case)", async (t) => {
  const manifest = fixtureManifest();
  const entry = entryOf(manifest); // unsigned
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
