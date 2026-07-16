import type {
  CommonsContentHash,
  CommonsPackageEntry,
  CommonsProvenance,
  CommonsSecurityScan,
} from "./commons.js";
import {
  canonicalizeJson,
  type ManifestSignature,
  type ManifestVerificationFailure,
  type SignatureVerifier,
  type VerifyManifestOptions,
} from "./signing.js";
import type { PackageKind, PackageManifest } from "./types.js";

export type ContentHasher = (canonicalContent: string) => string;

export interface CommonsPackageContent {
  name: string;
  version: string;
  kind: PackageKind;
  summary: string;
  tags: string[];
  manifest: PackageManifest;
  provenance: CommonsProvenance;
  securityScan: CommonsSecurityScan;
}

export type CommonsEntryVerificationFailure =
  | ManifestVerificationFailure
  | "missing_integrity"
  | "hash_mismatch"
  | "metadata_mismatch"
  | "missing_provenance"
  | "scan_failed";

export type CommonsEntryVerificationResult =
  | { valid: true }
  | { valid: false; reason: CommonsEntryVerificationFailure };

export function normalizeCommonsTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function commonsPackageContent(
  entry: Pick<
    CommonsPackageEntry,
    "name" | "version" | "kind" | "summary" | "tags" | "manifest" | "provenance" | "securityScan"
  >,
): CommonsPackageContent {
  return {
    name: entry.name,
    version: entry.version,
    kind: entry.kind,
    summary: entry.summary,
    tags: normalizeCommonsTags(entry.tags),
    manifest: entry.manifest,
    provenance: entry.provenance,
    securityScan: entry.securityScan,
  };
}

/**
 * Canonical immutable artifact bytes. Integrity, signature, and publish time are
 * excluded by construction, so the content hash can never recursively hash itself.
 */
export function canonicalizeCommonsContent(content: CommonsPackageContent): string {
  return canonicalizeJson(content);
}

export function computeCommonsContentHash(content: CommonsPackageContent, hash: ContentHasher): CommonsContentHash {
  return { algorithm: "sha256", value: `sha256:${hash(canonicalizeCommonsContent(content))}` };
}

/** Signature bytes bind immutable content, its explicit hash pin, and registry ordering time. */
export function canonicalizeCommonsSignedPayload(
  content: CommonsPackageContent,
  integrity: CommonsContentHash,
  publishedAt: string,
): string {
  return canonicalizeJson({ content, integrity, publishedAt });
}

function provenancePresent(provenance: CommonsProvenance | undefined): boolean {
  return Boolean(
    provenance &&
      provenance.sourceRepository &&
      provenance.sourceRef &&
      /^[0-9a-f]{40}$/i.test(provenance.inspectedCommit) &&
      provenance.repositoryLicense &&
      provenance.artifactLicense,
  );
}

export function verifyCommonsEntryContent(
  entry: CommonsPackageEntry,
  hash: ContentHasher,
): CommonsEntryVerificationResult {
  if (
    entry.name !== entry.manifest.name ||
    entry.version !== entry.manifest.version ||
    entry.kind !== entry.manifest.kind ||
    entry.summary !== entry.manifest.summary
  ) {
    return { valid: false, reason: "metadata_mismatch" };
  }
  if (!provenancePresent(entry.provenance)) return { valid: false, reason: "missing_provenance" };
  if (entry.securityScan?.status !== "passed") return { valid: false, reason: "scan_failed" };
  const dependencyPins = entry.securityScan.dependencyPins ?? [];
  if (
    entry.manifest.dependencies.some(
      (dependency) =>
        !dependencyPins.some(
          (pin) =>
            pin.name === dependency.manifestId &&
            pin.version === dependency.version &&
            /^sha256:[0-9a-f]{64}$/.test(pin.contentHash),
        ),
    )
  ) {
    return { valid: false, reason: "scan_failed" };
  }
  if (entry.integrity?.algorithm !== "sha256" || !entry.integrity.value) {
    return { valid: false, reason: "missing_integrity" };
  }
  const expected = computeCommonsContentHash(commonsPackageContent(entry), hash);
  if (expected.value !== entry.integrity.value) return { valid: false, reason: "hash_mismatch" };
  return { valid: true };
}

export function verifyCommonsEntry(
  entry: CommonsPackageEntry,
  hash: ContentHasher,
  verify: SignatureVerifier,
  options: VerifyManifestOptions = {},
): CommonsEntryVerificationResult {
  const contentCheck = verifyCommonsEntryContent(entry, hash);
  if (!contentCheck.valid) return contentCheck;
  const signature: ManifestSignature | undefined = entry.signature;
  if (!signature?.signature) return { valid: false, reason: "missing_signature" };
  if (signature.algorithm !== "ed25519") return { valid: false, reason: "unsupported_algorithm" };
  let validSignature = false;
  try {
    validSignature = verify(
      canonicalizeCommonsSignedPayload(commonsPackageContent(entry), entry.integrity, entry.publishedAt),
      signature.signature,
      signature.publicKey,
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) return { valid: false, reason: "invalid_signature" };
  if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(signature.publicKey)) {
    return { valid: false, reason: "untrusted_key" };
  }
  return { valid: true };
}
