import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  parsePackageManifest,
  verifyCommonsEntry,
  toSignedEnvelope,
  verifyManifestSignature,
  type CommonsPackageEntry,
  type ManifestSignature,
  type PackageManifest,
} from "@bridge/core";
import { buildCommonsServer } from "../src/server.js";
import { ed25519ManifestVerifier, resolveCommonsSigningKeyPair, signManifest, type CommonsSigningKeyPair } from "../src/signing.js";
import { FsCommonsStore } from "../src/store.js";

const provenance = {
  sourceRepository: "https://github.com/example/generalized-capability",
  sourceRef: "capability",
  inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
  repositoryLicense: "MIT",
  artifactLicense: "MIT",
  licenseVerified: true,
};
const TEST_PUBLISH_TOKEN = "test-commons-publisher-token-00000001";
const AUTH_HEADERS = { authorization: `Bearer ${TEST_PUBLISH_TOKEN}` };

async function publish(app: ReturnType<typeof buildCommonsServer>, payload: Record<string, unknown>) {
  return await app.inject({ method: "POST", url: "/v1/packages", headers: AUTH_HEADERS, payload });
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

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
  // Uses the OS tmpdir (never `process.cwd()`) — a killed/interrupted test
  // run must never leave debris inside the repo working tree (a real,
  // discovered instance of exactly that litter is what prompted this fix).
  const dataDir = await mkdtemp(join(tmpdir(), "commons-signing-test-"));
  const app = buildCommonsServer(new FsCommonsStore(dataDir), { keyPair, publishToken: TEST_PUBLISH_TOKEN });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, keyPair };
}

test("publishing a valid manifest stores a server signature", async (t) => {
  const { app } = await createApp(t);

  const published = await publish(app, { manifest: generalizedManifest(), tags: ["signed"], provenance });
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

  assert.equal((await publish(app, { manifest, provenance })).statusCode, 201);
  const entry = (await app.inject({ url: "/v1/packages/test-fixture-verifies/1.0.0" })).json() as CommonsPackageEntry;
  assert.ok(entry.signature);
  const signingKey = (await app.inject({ url: "/v1/signing-key" })).json() as { publicKey: string; algorithm: "ed25519" };

  assert.equal(signingKey.algorithm, "ed25519");
  assert.deepEqual(
    verifyCommonsEntry(entry, sha256, ed25519ManifestVerifier, {
      trustedPublicKeys: [signingKey.publicKey],
    }),
    { valid: true },
  );
});

test("altering a signed manifest invalidates the served signature", async (t) => {
  const { app } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-tamper");

  assert.equal((await publish(app, { manifest, provenance })).statusCode, 201);
  const entry = (await app.inject({ url: "/v1/packages/test-fixture-tamper/1.0.0" })).json() as CommonsPackageEntry;
  assert.ok(entry.signature);

  const mutated = {
    ...entry,
    summary: "An altered signed manifest.",
    manifest: { ...entry.manifest, summary: "An altered signed manifest." },
  };
  assert.deepEqual(verifyCommonsEntry(mutated, sha256, ed25519ManifestVerifier), {
    valid: false,
    reason: "hash_mismatch",
  });
});

test("publishing without required provenance is rejected", async (t) => {
  const { app } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-no-provenance");

  const res = await publish(app, { manifest });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_provenance");
});

test("publishing provenance with unknown fields is rejected instead of persisted", async (t) => {
  const { app } = await createApp(t);
  const res = await publish(app, {
    manifest: generalizedManifest("test-fixture-extra-provenance"),
    provenance: { ...provenance, records: ["Alice Example"] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_provenance");
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

test("Commons rejects non-Ed25519 signing and verification keys", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaPair = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  assert.throws(
    () =>
      resolveCommonsSigningKeyPair({
        COMMONS_SIGNING_PRIVATE_KEY_PEM: rsaPair.privateKeyPem,
        COMMONS_SIGNING_PUBLIC_KEY_PEM: rsaPair.publicKeyPem,
      }),
    /Ed25519/,
  );
  assert.equal(ed25519ManifestVerifier("payload", "not-a-signature", rsaPair.publicKeyPem), false);
});

test("persisted signing keys keep stored entries readable across service restarts", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-restart-test-"));
  const keyFile = join(dataDir, "signing-key.json");
  try {
    const firstKeyPair = resolveCommonsSigningKeyPair({ NODE_ENV: "test" }, keyFile);
    const firstApp = buildCommonsServer(new FsCommonsStore(dataDir), {
      keyPair: firstKeyPair,
      publishToken: TEST_PUBLISH_TOKEN,
    });
    const manifest = generalizedManifest("test-fixture-restart");
    assert.equal((await publish(firstApp, { manifest, provenance })).statusCode, 201);
    await firstApp.close();

    const secondKeyPair = resolveCommonsSigningKeyPair({ NODE_ENV: "test" }, keyFile);
    assert.equal(secondKeyPair.publicKeyPem, firstKeyPair.publicKeyPem);
    const secondApp = buildCommonsServer(new FsCommonsStore(dataDir), {
      keyPair: secondKeyPair,
      publishToken: TEST_PUBLISH_TOKEN,
    });
    assert.equal((await secondApp.inject({ url: "/v1/packages/test-fixture-restart/1.0.0" })).statusCode, 200);
    await secondApp.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
