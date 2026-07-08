/**
 * Universal Commons — client port + wire types (ADR: local-first Commons,
 * docs/raw/decisions-log.md). The Commons is the CLOUD REGISTRY OF
 * GENERALIZED CAPABILITY KNOWLEDGE ONLY — never user data (CLAUDE.md). v1
 * runs as a local service (services/commons) exposing the PERMANENT contract;
 * "Bridge Cloud" later serves the same contract from a hosted deployment, so
 * swapping local → cloud is config-only (COMMONS_URL).
 *
 * This module is the port side of the ModelProvider/PackageStore seam
 * pattern: zero runtime deps, types + interface only. The fetch adapter
 * (HttpCommonsClient) lives at the apps/api boundary, the Fastify server in
 * services/commons — both bind against these shapes.
 */
import type { PackageKind, PackageManifest } from "./types.js";

/** One published (name, version) entry as the registry stores/serves it.
 * `tags` are publisher-supplied generalized keywords (discovery only) — they
 * live in the registry envelope, NOT inside the manifest, so the manifest
 * format stays untouched. */
export interface CommonsPackageEntry {
  name: string;
  version: string;
  kind: PackageKind;
  summary: string;
  tags: string[];
  manifest: PackageManifest;
  publishedAt: string;
}

/** List-item projection — everything a registry browser needs without
 * shipping full manifests. */
export interface CommonsPackageSummary {
  name: string;
  latestVersion: string;
  kind: PackageKind;
  summary: string;
  tags: string[];
  versionCount: number;
  publishedAt: string;
}

export interface CommonsListQuery {
  kind?: PackageKind;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface CommonsListResult {
  items: CommonsPackageSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /v1/packages/:name — latest entry + the full version history. */
export interface CommonsPackageDetail {
  name: string;
  latest: CommonsPackageEntry;
  versions: { version: string; publishedAt: string }[];
}

/**
 * The Commons client port — what Bridge (Learning Agent, package install
 * flow) consumes. Local service today, Bridge Cloud tomorrow; implementations
 * differ only in COMMONS_URL. Deliberately read-heavy: `publish` exists so
 * generalized knowledge can be contributed, and the SERVER-side privacy gate
 * (services/commons) rejects anything workspace-shaped — the client never
 * gets to decide that.
 */
export interface CommonsRegistry {
  /** Curated registry listing — filter by kind and/or tag, paginated. */
  listAvailable(query?: CommonsListQuery): Promise<CommonsListResult>;
  /** Latest + version history for one package; null when unknown. */
  get(name: string): Promise<CommonsPackageDetail | null>;
  /** One exact published version's full entry; null when unknown. */
  getVersion(name: string, version: string): Promise<CommonsPackageEntry | null>;
  /** Publish a GENERALIZED manifest. Throws CommonsPublishRejectedError when
   * the registry's privacy gate finds workspace-specific data. */
  publish(manifest: PackageManifest, tags?: string[]): Promise<{ name: string; version: string }>;
}

/** Publish refused — either invalid manifest shape or (the important case)
 * the knowledge-only gate found workspace/user data; `offendingPaths` lists
 * exactly where. */
export class CommonsPublishRejectedError extends Error {
  readonly offendingPaths: string[];
  constructor(reason: string, offendingPaths: string[] = []) {
    super(`commons publish rejected: ${reason}${offendingPaths.length > 0 ? ` (${offendingPaths.join(", ")})` : ""}`);
    this.name = "CommonsPublishRejectedError";
    this.offendingPaths = offendingPaths;
  }
}
