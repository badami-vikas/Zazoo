import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  parseModuleManifest,
  canonicalizeJson,
  verifyCommonsEntry,
  toSignedEnvelope,
  verifyManifestSignature,
  type CommonsModuleEntry,
  type ManifestSignature,
  type ModuleManifest,
} from "@bridge/core";
import { buildCommonsServer } from "../src/server.js";
import { ed25519ManifestVerifier, resolveCommonsSigningKeyPair, signManifest, type CommonsSigningKeyPair } from "../src/signing.js";
import { FsCommonsStore } from "../src/store.js";

const provenance = {
  sourceRepository: "https://github.com/example/generalized-capability",
  sourceRef: "capability",
  inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
  repositoryLicense: "MIT",
  contentLicense: "MIT",
  licenseVerified: true,
};
const TEST_PUBLISH_TOKEN = "test-commons-publisher-token-00000001";
const AUTH_HEADERS = { authorization: `Bearer ${TEST_PUBLISH_TOKEN}` };

async function publish(app: ReturnType<typeof buildCommonsServer>, payload: Record<string, unknown>) {
  return await app.inject({ method: "POST", url: "/v1/modules", headers: AUTH_HEADERS, payload });
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function generalizedManifest(name = "test-fixture-signed", version = "1.0.0"): ModuleManifest {
  return parseModuleManifest({
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

  const entry = (await app.inject({ url: "/v1/modules/test-fixture-signed/1.0.0" })).json() as CommonsModuleEntry;
  assert.ok(entry.signature);
  assert.equal(entry.signature.algorithm, "ed25519");
  assert.ok(entry.signature.signature.length > 0);
  assert.ok(entry.signature.publicKey.length > 0);
});

test("served signature verifies against the signing-key route", async (t) => {
  const { app } = await createApp(t);
  const manifest = generalizedManifest("test-fixture-verifies");

  assert.equal((await publish(app, { manifest, provenance })).statusCode, 201);
  const entry = (await app.inject({ url: "/v1/modules/test-fixture-verifies/1.0.0" })).json() as CommonsModuleEntry;
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
  const entry = (await app.inject({ url: "/v1/modules/test-fixture-tamper/1.0.0" })).json() as CommonsModuleEntry;
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
    assert.equal((await secondApp.inject({ url: "/v1/modules/test-fixture-restart/1.0.0" })).statusCode, 200);
    await secondApp.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("signed pre-VOCAB3 entries remain verified, pinned, visible, and canonically adapted", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-vocab3-test-"));
  const keyPair = resolveCommonsSigningKeyPair({ NODE_ENV: "test" });
  const name = "legacy-organization-blueprint";
  const version = "1.0.0";
  const manifest = {
    name,
    version,
    kind: "workspace_definition",
    summary: "A signed generalized organization blueprint.",
    description: "A signed generalized organization blueprint.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [],
    contextProviders: [],
    workspaceVocab: {
      alignsToBridgeTheme: true,
      domainTerms: {
        Workspace: "Firm",
        Package: "Capability",
        Initiative: "Deal",
      },
    },
    blueprint: {
      schemaVersion: 2,
      vocabulary: { Initiative: "Deal" },
      entities: [{
        nodeType: "initiative",
        label: "Deals",
        fields: [{
          id: "related",
          label: "Related deal",
          kind: "relation",
          relationTarget: "initiative",
        }],
      }],
      views: [{ entity: "initiative", kind: "table" }],
      capabilities: [],
    },
  };
  const {
    contentLicense: legacyContentLicense,
    ...legacyProvenance
  } = provenance;
  const content = {
    name,
    version,
    kind: manifest.kind,
    summary: manifest.summary,
    tags: ["blueprint"],
    manifest,
    provenance: {
      ...legacyProvenance,
      artifactLicense: legacyContentLicense,
    },
    securityScan: {
      scanner: "bridge-commons-manifest",
      scannerVersion: "1.0.0",
      policyVersion: "CM1-2026-07",
      status: "passed",
      riskBand: "informational",
      lethalTrifecta: false,
      checks: [],
    },
  };
  const integrity = {
    algorithm: "sha256",
    value: `sha256:${sha256(canonicalizeJson(content))}`,
  };
  const publishedAt = "2026-07-18T00:00:00.000Z";
  const signature = {
    signature: cryptoSign(
      null,
      Buffer.from(canonicalizeJson({ content, integrity, publishedAt }), "utf8"),
      keyPair.privateKeyPem,
    ).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: publishedAt,
  };
  const priorDir = join(dataDir, "packages", name);
  await mkdir(priorDir, { recursive: true });
  await writeFile(
    join(priorDir, `${version}.json`),
    JSON.stringify({ ...content, integrity, publishedAt, signature }),
    "utf8",
  );

  const store = new FsCommonsStore(dataDir);
  const app = buildCommonsServer(store, { keyPair, publishToken: TEST_PUBLISH_TOKEN });
  try {
    const list = (await app.inject({ url: "/v1/modules" })).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].name, name);

    const response = await app.inject({ url: `/v1/modules/${name}/${version}` });
    assert.equal(response.statusCode, 200);
    const entry = response.json() as CommonsModuleEntry;
    assert.equal(entry.kind, "organization_definition");
    assert.deepEqual(entry.manifest.organizationVocab.domainTerms, {
      Organization: "Firm",
      Module: "Capability",
      Record: "Deal",
    });
    assert.equal(entry.manifest.blueprint?.entities[0]?.nodeType, "record");
    assert.equal(entry.manifest.blueprint?.entities[0]?.fields[0]?.relationTarget, "record");
    assert.equal(entry.manifest.blueprint?.views[0]?.entity, "record");
    assert.equal(entry.provenance.contentLicense, "MIT");
    assert.equal(entry.integrity.value, integrity.value);
    assert.equal(entry.signedSource?.vocabularyVersion, 2);
    assert.deepEqual(
      verifyCommonsEntry(entry, sha256, ed25519ManifestVerifier, {
        trustedPublicKeys: [keyPair.publicKeyPem],
      }),
      { valid: true },
    );

    const tampered = {
      ...entry,
      manifest: { ...entry.manifest, summary: "tampered canonical projection" },
    };
    assert.deepEqual(
      verifyCommonsEntry(tampered, sha256, ed25519ManifestVerifier, {
        trustedPublicKeys: [keyPair.publicKeyPem],
      }),
      { valid: false, reason: "metadata_mismatch" },
    );
    await assert.rejects(() => store.put(entry), /already published/);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
