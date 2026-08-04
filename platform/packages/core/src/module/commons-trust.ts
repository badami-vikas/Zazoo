import type {
  CommonsArchetypeEntry,
  CommonsContentHash,
  CommonsModuleEntry,
  CommonsProvenance,
  CommonsSecurityScan,
} from "./commons.js";
import { archetypeName, parseCapabilityArchetype } from "../learning/archetype.js";
import { findOrganizationDataPaths } from "./privacy.js";
import {
  canonicalizeJson,
  type ManifestSignature,
  type ManifestVerificationFailure,
  type SignatureVerifier,
  type VerifyManifestOptions,
} from "./signing.js";
import type { ModuleKind, ModuleManifest } from "./types.js";
import { readLegacySignedContent } from "./signed-legacy-entry.js";

export type ContentHasher = (canonicalContent: string) => string;

export interface CommonsModuleContent {
  name: string;
  version: string;
  kind: ModuleKind;
  summary: string;
  tags: string[];
  manifest: ModuleManifest;
  provenance: CommonsProvenance;
  securityScan: CommonsSecurityScan;
}

export type CommonsEntryVerificationFailure =
  | ManifestVerificationFailure
  | "missing_integrity"
  | "hash_mismatch"
  | "metadata_mismatch"
  | "missing_provenance"
  | "scan_failed"
  | "invalid_signed_source"
  | "invalid_archetype"
  | "organization_data";

export type CommonsEntryVerificationResult =
  | { valid: true }
  | { valid: false; reason: CommonsEntryVerificationFailure };

export function normalizeCommonsTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function commonsModuleContent(
  entry: Pick<
    CommonsModuleEntry,
    "name" | "version" | "kind" | "summary" | "tags" | "manifest" | "provenance" | "securityScan"
  >,
): CommonsModuleContent {
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
 * Canonical immutable Module content. Integrity, signature, and publish time are
 * excluded by construction, so the content hash can never recursively hash itself.
 */
export function canonicalizeCommonsContent(content: CommonsModuleContent): string {
  return canonicalizeJson(content);
}

export function computeCommonsContentHash(content: CommonsModuleContent, hash: ContentHasher): CommonsContentHash {
  return { algorithm: "sha256", value: `sha256:${hash(canonicalizeCommonsContent(content))}` };
}

/** Signature bytes bind immutable content, its explicit hash pin, and registry ordering time. */
export function canonicalizeCommonsSignedPayload(
  content: CommonsModuleContent,
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
      provenance.contentLicense,
  );
}

export function verifyCommonsEntryContent(
  entry: CommonsModuleEntry,
  hash: ContentHasher,
): CommonsEntryVerificationResult {
  let hashContent = canonicalizeCommonsContent(commonsModuleContent(entry));
  if (entry.signedSource) {
    try {
      const source = readLegacySignedContent(entry.signedSource);
      if (
        canonicalizeCommonsContent(commonsModuleContent(entry)) !==
        canonicalizeCommonsContent(source.adapted)
      ) {
        return { valid: false, reason: "metadata_mismatch" };
      }
      hashContent = entry.signedSource.canonicalContent;
    } catch {
      return { valid: false, reason: "invalid_signed_source" };
    }
  }
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
  const expected: CommonsContentHash = { algorithm: "sha256", value: `sha256:${hash(hashContent)}` };
  if (expected.value !== entry.integrity.value) return { valid: false, reason: "hash_mismatch" };
  return { valid: true };
}

/** Canonical immutable archetype content — integrity/signature/publish time
 * excluded by construction, mirroring `commonsModuleContent`. */
export interface CommonsArchetypeContent {
  archetype: CommonsArchetypeEntry["archetype"];
  tags: string[];
}

export function commonsArchetypeContent(
  entry: Pick<CommonsArchetypeEntry, "archetype" | "tags">,
): CommonsArchetypeContent {
  return { archetype: entry.archetype, tags: normalizeCommonsTags(entry.tags) };
}

export function computeCommonsArchetypeHash(
  content: CommonsArchetypeContent,
  hash: ContentHasher,
): CommonsContentHash {
  return { algorithm: "sha256", value: `sha256:${hash(canonicalizeJson(content))}` };
}

export function canonicalizeCommonsArchetypeSignedPayload(
  content: CommonsArchetypeContent,
  integrity: CommonsContentHash,
  publishedAt: string,
): string {
  return canonicalizeJson({ content, integrity, publishedAt });
}

/** Full archetype-entry verification — shape, generalized-content gate,
 * integrity hash, and (when a signature is present or a trusted key is
 * pinned) the registry signature. Same fail-closed posture as module
 * entries. */
export function verifyCommonsArchetypeEntry(
  entry: CommonsArchetypeEntry,
  hash: ContentHasher,
  verify: SignatureVerifier,
  options: VerifyManifestOptions = {},
): CommonsEntryVerificationResult {
  let archetype;
  try {
    archetype = parseCapabilityArchetype(entry.archetype);
  } catch {
    return { valid: false, reason: "invalid_archetype" };
  }
  if (archetype.name !== archetypeName(archetype.domain, archetype)) {
    return { valid: false, reason: "metadata_mismatch" };
  }
  const content = commonsArchetypeContent(entry);
  if (findOrganizationDataPaths(content).length > 0) {
    return { valid: false, reason: "organization_data" };
  }
  if (entry.integrity?.algorithm !== "sha256" || !entry.integrity.value) {
    return { valid: false, reason: "missing_integrity" };
  }
  if (computeCommonsArchetypeHash(content, hash).value !== entry.integrity.value) {
    return { valid: false, reason: "hash_mismatch" };
  }
  const signature = entry.signature;
  if (!signature?.signature) return { valid: false, reason: "missing_signature" };
  if (signature.algorithm !== "ed25519") return { valid: false, reason: "unsupported_algorithm" };
  let validSignature = false;
  try {
    validSignature = verify(
      canonicalizeCommonsArchetypeSignedPayload(content, entry.integrity, entry.publishedAt),
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

export function verifyCommonsEntry(
  entry: CommonsModuleEntry,
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
    const signedContent = entry.signedSource
      ? readLegacySignedContent(entry.signedSource).original
      : commonsModuleContent(entry);
    validSignature = verify(
      canonicalizeJson({ content: signedContent, integrity: entry.integrity, publishedAt: entry.publishedAt }),
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
