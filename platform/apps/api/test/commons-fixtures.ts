import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import {
  canonicalizeCommonsSignedPayload,
  commonsPackageContent,
  computeCommonsContentHash,
  normalizeCommonsTags,
  type CommonsPackageEntry,
  type CommonsProvenance,
  type CommonsSecurityScan,
  type ManifestSignature,
  type PackageManifest,
} from "@bridge/core";

export const TEST_COMMONS_PROVENANCE: CommonsProvenance = {
  sourceRepository: "https://github.com/example/generalized-capability",
  sourceRef: "capability",
  inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
  repositoryLicense: "MIT",
  artifactLicense: "MIT",
  licenseVerified: true,
};

export const TEST_COMMONS_SCAN: CommonsSecurityScan = {
  scanner: "bridge-commons-manifest",
  scannerVersion: "1.0.0",
  policyVersion: "CM1-2026-07",
  status: "passed",
  riskBand: "informational",
  lethalTrifecta: false,
  checks: [],
};

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export function makeUnsignedCommonsEntry(
  manifest: PackageManifest,
  tags: string[] = [],
  securityScan: CommonsSecurityScan = TEST_COMMONS_SCAN,
): Omit<CommonsPackageEntry, "signature"> {
  const content = {
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    summary: manifest.summary,
    tags: normalizeCommonsTags(tags),
    manifest,
    provenance: TEST_COMMONS_PROVENANCE,
    securityScan,
  };
  return {
    ...content,
    integrity: computeCommonsContentHash(content, sha256),
    publishedAt: "2026-07-14T00:00:00.000Z",
  };
}

export function signCommonsEntryForTest(
  manifest: PackageManifest,
  keyPair: { privateKeyPem: string; publicKeyPem: string },
  tags: string[] = [],
  securityScan: CommonsSecurityScan = TEST_COMMONS_SCAN,
): CommonsPackageEntry {
  const unsigned = makeUnsignedCommonsEntry(manifest, tags, securityScan);
  const signature: ManifestSignature = {
    signature: cryptoSign(
      null,
      Buffer.from(
        canonicalizeCommonsSignedPayload(commonsPackageContent(unsigned), unsigned.integrity, unsigned.publishedAt),
        "utf8",
      ),
      createPrivateKey(keyPair.privateKeyPem),
    ).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: "2026-07-14T00:00:00.000Z",
  };
  return { ...unsigned, signature };
}
