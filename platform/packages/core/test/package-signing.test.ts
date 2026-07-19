import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeManifest,
  canonicalizeCommonsSignedPayload,
  commonsPackageContent,
  computeCommonsContentHash,
  normalizeCommonsTags,
  verifyCommonsEntry,
  verifyManifestSignature,
  assertCommonsUrlTls,
  CommonsInsecureTransportError,
  isUntrustedOrigin,
  trustGrantsForOrigin,
  type SignatureVerifier,
  type SignedManifestEnvelope,
  type PackageManifest,
  type TrustGrantView,
  type CommonsPackageEntry,
} from "../src/index.js";

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: "test-fixture-pkg",
    version: "1.0.0",
    kind: "module",
    summary: "s",
    description: "d",
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
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    ...overrides,
  };
}

// A stand-in for the node:crypto ed25519 check: "valid" iff the signature is
// exactly the canonical data with a fixed key suffix — lets us exercise the
// verification POLICY (missing/invalid/untrusted/valid) with no real crypto.
function fakeVerifier(expectedKey: string): SignatureVerifier {
  return (data, signatureB64, publicKey) => publicKey === expectedKey && signatureB64 === `sig(${data})`;
}

function envelope(over: Partial<SignedManifestEnvelope> = {}): SignedManifestEnvelope {
  const m = over.manifest ?? manifest();
  return {
    manifest: m,
    signature: `sig(${canonicalizeManifest(m)})`,
    publicKey: "publisher-key-1",
    algorithm: "ed25519",
    signedAt: "2026-07-14T00:00:00.000Z",
    ...over,
  };
}

test("canonicalizeManifest: key order does not change the canonical bytes", () => {
  const a = manifest();
  // Build a structurally-equal manifest with keys inserted in a different order.
  const b: PackageManifest = {
    workspaceVocab: { domainTerms: {}, alignsToBridgeTheme: true },
    contextProviders: [],
    capabilities: a.capabilities,
    dependencies: [],
    lineageManifestId: null,
    description: "d",
    summary: "s",
    kind: "module",
    version: "1.0.0",
    name: "test-fixture-pkg",
  };
  assert.equal(canonicalizeManifest(a), canonicalizeManifest(b));
});

function commonsEntry(): CommonsPackageEntry {
  const content = {
    name: "test-fixture-pkg",
    version: "1.0.0",
    kind: "module" as const,
    summary: "s",
    tags: ["test"],
    manifest: manifest(),
    provenance: {
      sourceRepository: "https://github.com/example/repo",
      sourceRef: "capability",
      inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
      repositoryLicense: "MIT",
      artifactLicense: "MIT",
      licenseVerified: true,
    },
    securityScan: {
      scanner: "bridge-commons-manifest" as const,
      scannerVersion: "1.0.0" as const,
      policyVersion: "CM1-2026-07" as const,
      status: "passed" as const,
      riskBand: "informational" as const,
      lethalTrifecta: false,
      checks: [],
    },
  };
  const integrity = computeCommonsContentHash(content, (value) => `hash(${value})`);
  const publishedAt = "2026-07-16T00:00:00.000Z";
  return {
    ...content,
    integrity,
    publishedAt,
    signature: {
      signature: `sig(${canonicalizeCommonsSignedPayload(content, integrity, publishedAt)})`,
      publicKey: "publisher-key-1",
      algorithm: "ed25519",
      signedAt: "2026-07-16T00:00:00.000Z",
    },
  };
}

test("Commons hash excludes its own integrity/signature/publish fields and verifies the signed pin", () => {
  const entry = commonsEntry();
  assert.equal(
    computeCommonsContentHash(commonsPackageContent(entry), (value) => `hash(${value})`).value,
    entry.integrity.value,
  );
  assert.deepEqual(
    verifyCommonsEntry(entry, (value) => `hash(${value})`, fakeVerifier("publisher-key-1")),
    { valid: true },
  );
});

test("Commons tag normalization uses locale-independent code-point order", () => {
  assert.deepEqual(normalizeCommonsTags(["ä", "a", "z", "ä"]), ["a", "z", "ä"]);
});

test("Commons verification rejects changed provenance even when the manifest is unchanged", () => {
  const entry = commonsEntry();
  const tampered = {
    ...entry,
    provenance: { ...entry.provenance, inspectedCommit: "ffffffffffffffffffffffffffffffffffffffff" },
  };
  assert.deepEqual(
    verifyCommonsEntry(tampered, (value) => `hash(${value})`, fakeVerifier("publisher-key-1")),
    { valid: false, reason: "hash_mismatch" },
  );
});

test("Commons verification rejects a changed publication time", () => {
  const entry = commonsEntry();
  const tampered = { ...entry, publishedAt: "2099-01-01T00:00:00.000Z" };
  assert.deepEqual(
    verifyCommonsEntry(tampered, (value) => `hash(${value})`, fakeVerifier("publisher-key-1")),
    { valid: false, reason: "invalid_signature" },
  );
});

test("verifyManifestSignature: a valid signature verifies", () => {
  const result = verifyManifestSignature(envelope(), fakeVerifier("publisher-key-1"));
  assert.equal(result.valid, true);
});

test("verifyManifestSignature: a missing/empty signature is rejected", () => {
  const missing = verifyManifestSignature(null, fakeVerifier("publisher-key-1"));
  assert.equal(missing.valid, false);
  if (missing.valid) return;
  assert.equal(missing.reason, "missing_signature");

  const empty = verifyManifestSignature(envelope({ signature: "" }), fakeVerifier("publisher-key-1"));
  assert.equal(empty.valid, false);
});

test("verifyManifestSignature: an ALTERED manifest fails (signature no longer matches the bytes)", () => {
  const good = envelope();
  // Tamper with the manifest AFTER signing — the signature was over the old bytes.
  const tampered: SignedManifestEnvelope = { ...good, manifest: manifest({ version: "9.9.9" }) };
  const result = verifyManifestSignature(tampered, fakeVerifier("publisher-key-1"));
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.reason, "invalid_signature");
});

test("verifyManifestSignature: a valid signature from an UNTRUSTED key is rejected when an allowlist is given", () => {
  const result = verifyManifestSignature(envelope(), fakeVerifier("publisher-key-1"), {
    trustedPublicKeys: ["some-other-key"],
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.reason, "untrusted_key");
});

test("verifyManifestSignature: fails closed when the injected verifier throws", () => {
  const throwing: SignatureVerifier = () => {
    throw new Error("crypto boom");
  };
  const result = verifyManifestSignature(envelope(), throwing);
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.reason, "invalid_signature");
});

test("verifyManifestSignature: an unsupported algorithm is rejected", () => {
  const result = verifyManifestSignature(
    { ...envelope(), algorithm: "rsa" as unknown as "ed25519" },
    fakeVerifier("publisher-key-1"),
  );
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.reason, "unsupported_algorithm");
});

// --- TLS-by-default ---

test("assertCommonsUrlTls: https passes, remote http is refused, localhost http is allowed", () => {
  assert.ok(assertCommonsUrlTls("https://commons.bridge.example"));
  assert.ok(assertCommonsUrlTls("http://localhost:4780"));
  assert.ok(assertCommonsUrlTls("http://127.0.0.1:4780"));
  assert.throws(() => assertCommonsUrlTls("http://commons.bridge.example"), CommonsInsecureTransportError);
  assert.throws(() => assertCommonsUrlTls("not a url"), CommonsInsecureTransportError);
});

// --- Community-origin trust floor ---

test("isUntrustedOrigin: community is pinned to the same untrusted tier as user_code", () => {
  assert.equal(isUntrustedOrigin("community"), true);
  assert.equal(isUntrustedOrigin("user_code"), true);
  assert.equal(isUntrustedOrigin("built_in"), false);
  assert.equal(isUntrustedOrigin("template"), false);
  assert.equal(isUntrustedOrigin("ai_generated"), false);
});

test("trustGrantsForOrigin: strips auto-activation grants for a community manifest, keeps them for built_in", () => {
  const grants: TrustGrantView[] = [{ capabilityClass: "skill", riskBand: "operational", autoActivate: true }];
  assert.deepEqual(trustGrantsForOrigin("community", grants), []);
  assert.deepEqual(trustGrantsForOrigin("user_code", grants), []);
  assert.deepEqual(trustGrantsForOrigin("built_in", grants), grants);
});
