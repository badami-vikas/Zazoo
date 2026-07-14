import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  parsePackageManifest,
  toSignedEnvelope,
  verifyManifestSignature,
  type CommonsPackageEntry,
  type ManifestSignature,
  type PackageManifest,
} from "@bridge/core";
import { buildCommonsServer } from "../src/server.js";
import { ed25519ManifestVerifier, resolveCommonsSigningKeyPair, signManifest, type CommonsSigningKeyPair } from "../src/signing.js";
import { FsCommonsStore } from "../src/store.js";

function generalizedManifest(name = "test-fixture-signed", version = "1.0.0"): PackageManifest {
  return parsePackageManifest({
    name,
    version,
    kind: "view",
    summary: "A generalized signed example view capability.",
    description: "Signing fixture — generalized knowledge only.",
    capabilities: [
      {
        id: `${name}.surface`,
        capability_type: "view",
        permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      },
    ],
  });
}

async function createApp(t: TestContext, keyPair: CommonsSigningKeyPair = resolveCommonsSigningKeyPair({ NODE_ENV: "test" })) {
  const dataDir = await mkdtemp(join(process.cwd(), ".commons-signing-test-"));
  const app = buildCommonsServer(new FsCommonsStore(dataDir), { keyPair });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, keyPair };
}

test("publishing a valid manifest stores a server signature", async (t) => {
  const { app } = await createApp(t);

  const published = await app.inject({
    method: "POST",
    url: "/v1/packages",
    payload: { manifest: generalizedManifest(), tags: ["signed"] },
  });
  assert.equal(published.statusCode, 201);

  const entry = (await app.inject({ url: "/v1/packages/test-fixture-signed/1.0.0" })).json() as CommonsPackageEntry;
  assert.ok(entry.signature);
  assert.equal(entry.signature.algorithm, "ed25519");
  assert.ok(entry.signature.signature.length > 0);
  assert.ok(entry.signature.publicKey.length > 0);
});

test("served signature verifies against the signing-key route", async (t) => {
  const { app } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-verifies");

  assert.equal((await app.inject({ method: "POST", url: "/v1/packages", payload: { manifest } })).statusCode, 201);
  const entry = (await app.inject({ url: "/v1/packages/test-fixture-verifies/1.0.0" })).json() as CommonsPackageEntry;
  assert.ok(entry.signature);
  const signingKey = (await app.inject({ url: "/v1/signing-key" })).json() as { publicKey: string; algorithm: "ed25519" };

  assert.equal(signingKey.algorithm, "ed25519");
  assert.deepEqual(
    verifyManifestSignature(toSignedEnvelope(entry.manifest, entry.signature), ed25519ManifestVerifier, {
      trustedPublicKeys: [signingKey.publicKey],
    }),
    { valid: true },
  );
});

test("altering a signed manifest invalidates the served signature", async (t) => {
  const { app } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-tamper");

  assert.equal((await app.inject({ method: "POST", url: "/v1/packages", payload: { manifest } })).statusCode, 201);
  const entry = (await app.inject({ url: "/v1/packages/test-fixture-tamper/1.0.0" })).json() as CommonsPackageEntry;
  assert.ok(entry.signature);

  const mutatedManifest = { ...entry.manifest, summary: "An altered signed manifest." };
  assert.deepEqual(verifyManifestSignature(toSignedEnvelope(mutatedManifest, entry.signature), ed25519ManifestVerifier), {
    valid: false,
    reason: "invalid_signature",
  });
});

test("publishing with a bogus client-supplied signature is rejected", async (t) => {
  const { app, keyPair } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-bogus");

  const res = await app.inject({
    method: "POST",
    url: "/v1/packages",
    payload: {
      manifest,
      signature: {
        signature: "AAAA",
        publicKey: keyPair.publicKeyPem,
        algorithm: "ed25519",
        signedAt: "2026-07-14T00:00:00.000Z",
      },
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_signature");
});

test("resolving signing keys uses env PEMs or generates a usable pair", () => {
  const envPair = resolveCommonsSigningKeyPair({ NODE_ENV: "test" });
  const resolved = resolveCommonsSigningKeyPair({
    COMMONS_SIGNING_PRIVATE_KEY_PEM: envPair.privateKeyPem,
    COMMONS_SIGNING_PUBLIC_KEY_PEM: envPair.publicKeyPem,
  });
  assert.equal(resolved.privateKeyPem, envPair.privateKeyPem);
  assert.equal(resolved.publicKeyPem, envPair.publicKeyPem);

  const generated = resolveCommonsSigningKeyPair({ NODE_ENV: "test" });
  const manifest = generalizedManifest("test-fixture-generated-key");
  const signature: ManifestSignature = signManifest(manifest, generated);
  assert.deepEqual(verifyManifestSignature(toSignedEnvelope(manifest, signature), ed25519ManifestVerifier), { valid: true });
});
