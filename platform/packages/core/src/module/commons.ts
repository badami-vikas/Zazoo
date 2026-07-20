/**
 * Universal Commons — client port + wire types (ADR: local-first Commons,
 * docs/raw/decisions-log.md). The Commons is the CLOUD REGISTRY OF
 * GENERALIZED CAPABILITY KNOWLEDGE ONLY — never user data (CLAUDE.md). v1
 * runs as a local service (services/commons) exposing the PERMANENT contract;
 * "Bridge Cloud" later serves the same contract from a hosted deployment, so
 * swapping local → cloud is config-only (COMMONS_URL).
 *
 * This module is the port side of the ModelProvider/ModuleStore seam
 * pattern: zero runtime deps, types + interface only. The fetch adapter
 * (HttpCommonsClient) lives at the apps/api boundary, the Fastify server in
 * services/commons — both bind against these shapes.
 */
import type { ModuleKind, ModuleManifest } from "./types.js";
import type { ManifestSignature } from "./signing.js";

export interface CommonsProvenance {
  sourceRepository: string;
  sourceRef: string;
  inspectedCommit: string;
  repositoryLicense: string;
  artifactLicense: string;
  licenseVerified: boolean;
}

export interface CommonsSecurityCheck {
  id: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface CommonsDependencyPin {
  name: string;
  version: string;
  contentHash: string;
}

export interface CommonsSecurityScan {
  scanner: "bridge-commons-manifest";
  scannerVersion: "1.0.0";
  policyVersion: "CM1-2026-07";
  status: "passed" | "failed";
  riskBand: "informational" | "advisory" | "transformational" | "operational" | "external";
  lethalTrifecta: boolean;
  /** Exact verified closure identities. Required when module dependencies exist. */
  dependencyPins?: CommonsDependencyPin[];
  checks: CommonsSecurityCheck[];
}

export interface CommonsContentHash {
  algorithm: "sha256";
  value: string;
}

export interface CommonsSignedSource {
  vocabularyVersion: 2;
  canonicalContent: string;
}

/** One published (name, version) entry as the registry stores/serves it.
 * `tags` are publisher-supplied generalized keywords (discovery only) — they
 * live in the registry envelope, NOT inside the manifest, so the manifest
 * format stays untouched. */
export interface CommonsModuleEntry {
  name: string;
  version: string;
  kind: ModuleKind;
  summary: string;
  tags: string[];
  manifest: ModuleManifest;
  provenance: CommonsProvenance;
  securityScan: CommonsSecurityScan;
  integrity: CommonsContentHash;
  publishedAt: string;
  /** Original immutable content for a deterministically adapted pre-VOCAB3
   * entry. Its hash and signature remain authoritative. */
  signedSource?: CommonsSignedSource;
  /** Detached publisher signature over immutable content + integrity. Optional on the
   * type for backward compatibility with pre-signing entries, but the server
   * signs every publish and the install path REJECTS an entry without a valid
   * signature — so in practice a served entry always carries one. */
  signature?: ManifestSignature;
}

/** List-item projection — everything a registry browser needs without
 * shipping full manifests. */
export interface CommonsModuleSummary {
  name: string;
  latestVersion: string;
  kind: ModuleKind;
  summary: string;
  tags: string[];
  versionCount: number;
  publishedAt: string;
}

export interface CommonsListQuery {
  kind?: ModuleKind;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CommonsListResult {
  items: CommonsModuleSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /v1/modules/:name — latest entry + the full version history. */
export interface CommonsModuleDetail {
  name: string;
  latest: CommonsModuleEntry;
  versions: { version: string; publishedAt: string }[];
}

/**
 * The Commons client port — what Bridge (Learning Agent, module install
 * flow) consumes. Local service today, Bridge Cloud tomorrow; implementations
 * differ only in COMMONS_URL. Deliberately read-heavy: `publish` exists so
 * generalized knowledge can be contributed, and the SERVER-side privacy gate
 * (services/commons) rejects anything organization-shaped — the client never
 * gets to decide that.
 */
export interface CommonsRegistry {
  /** Curated registry listing — filter by kind and/or tag, paginated. */
  listAvailable(query?: CommonsListQuery): Promise<CommonsListResult>;
  /** Latest + version history for one module; null when unknown. */
  get(name: string): Promise<CommonsModuleDetail | null>;
  /** One exact published version's full entry; null when unknown. */
  getVersion(name: string, version: string): Promise<CommonsModuleEntry | null>;
  /** Publish a GENERALIZED manifest. Throws CommonsPublishRejectedError when
   * the registry's privacy gate finds organization-specific data. */
  publish(
    manifest: ModuleManifest,
    options: {
      tags?: string[];
      provenance: CommonsProvenance;
      expectedContentHash?: string;
    },
  ): Promise<{ name: string; version: string; contentHash: string }>;
}

/** Publish refused — either invalid manifest shape or (the important case)
 * the knowledge-only gate found organization/user data; `offendingPaths` lists
 * exactly where. */
export class CommonsPublishRejectedError extends Error {
  readonly offendingPaths: string[];
  constructor(reason: string, offendingPaths: string[] = []) {
    super(`commons publish rejected: ${reason}${offendingPaths.length > 0 ? ` (${offendingPaths.join(", ")})` : ""}`);
    this.name = "CommonsPublishRejectedError";
    this.offendingPaths = offendingPaths;
  }
}
