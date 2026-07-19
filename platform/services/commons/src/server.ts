/**
 * Universal Commons HTTP surface — the PERMANENT registry contract
 * (docs/wiki/commons.md). Local-first Fastify service today; Bridge Cloud
 * serves the SAME routes later, so consumers swap deployments via
 * COMMONS_URL only.
 *
 * Contract (v1 — curated package registry, generalized knowledge only):
 *   GET  /health                      → { ok, service, packages }
 *   GET  /v1/packages                 → list; ?kind= &tag= &limit= &offset=
 *   GET  /v1/packages/:name           → latest entry + version history
 *   GET  /v1/packages/:name/:version  → one full published entry
 *   POST /v1/packages                 → publish { manifest, tags? }
 *        400 invalid_manifest  · 409 duplicate_version
 *        422 workspace_data_rejected { offendingPaths } ← knowledge-only gate
 */
import Fastify, { type FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  computeCommonsContentHash,
  normalizeCommonsTags,
  parsePackageManifest,
  PackageManifestValidationError,
  verifyCommonsEntry,
  type CommonsListResult,
  type CommonsPackageDetail,
  type CommonsPackageEntry,
  type CommonsPackageSummary,
  type CommonsProvenance,
  type PackageKind,
} from "@bridge/core";
import { findWorkspaceDataPaths } from "./privacy-gate.js";
import { scanCommonsPackage } from "./security-scan.js";
import { ed25519ManifestVerifier, resolveCommonsSigningKeyPair, signCommonsEntry, type CommonsSigningKeyPair } from "./signing.js";
import { DuplicateVersionError, type CommonsStore } from "./store.js";

const PACKAGE_KINDS: readonly string[] = [
  "skill",
  "workflow",
  "agent",
  "tool",
  "view",
  "integration_bundle",
  "workspace_definition",
];

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function provenanceFromUnknown(value: unknown): CommonsProvenance | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "sourceRepository",
    "sourceRef",
    "inspectedCommit",
    "repositoryLicense",
    "artifactLicense",
    "licenseVerified",
  ]);
  if (
    Object.keys(candidate).some((key) => !allowedKeys.has(key)) ||
    typeof candidate.sourceRepository !== "string" ||
    candidate.sourceRepository.trim() === "" ||
    typeof candidate.sourceRef !== "string" ||
    candidate.sourceRef.trim() === "" ||
    typeof candidate.inspectedCommit !== "string" ||
    candidate.inspectedCommit.trim() === "" ||
    typeof candidate.repositoryLicense !== "string" ||
    candidate.repositoryLicense.trim() === "" ||
    typeof candidate.artifactLicense !== "string" ||
    candidate.artifactLicense.trim() === "" ||
    typeof candidate.licenseVerified !== "boolean"
  ) {
    return null;
  }
  return {
    sourceRepository: candidate.sourceRepository.trim(),
    sourceRef: candidate.sourceRef.trim(),
    inspectedCommit: candidate.inspectedCommit.trim(),
    repositoryLicense: candidate.repositoryLicense.trim(),
    artifactLicense: candidate.artifactLicense.trim(),
    licenseVerified: candidate.licenseVerified,
  };
}

function assertStoredEntryTrusted(entry: CommonsPackageEntry, publicKey: string): void {
  const result = verifyCommonsEntry(entry, sha256, ed25519ManifestVerifier, { trustedPublicKeys: [publicKey] });
  if (!result.valid) throw new Error(`commons stored entry failed trust verification: ${result.reason}`);
}

function latestOf<T extends { publishedAt: string }>(versions: T[]): T {
  // listVersions is oldest-first by publishedAt.
  return versions[versions.length - 1] as T;
}

function publisherAuthorized(authorization: string | undefined, publishToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(publishToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function verifiedDependencyResolver(
  store: CommonsStore,
  manifest: ReturnType<typeof parsePackageManifest>,
  publicKey: string,
): Promise<
  (
    manifestId: string,
    version: string,
  ) => { manifest: ReturnType<typeof parsePackageManifest>; contentHash: string } | undefined
> {
  const resolved = new Map<string, { manifest: ReturnType<typeof parsePackageManifest>; contentHash: string }>();
  const visited = new Set<string>();

  async function visit(current: ReturnType<typeof parsePackageManifest>): Promise<void> {
    for (const dependency of current.dependencies) {
      const key = `${dependency.manifestId}@${dependency.version}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const entry = await store.get(dependency.manifestId, dependency.version);
      if (!entry) continue;
      assertStoredEntryTrusted(entry, publicKey);
      resolved.set(key, { manifest: entry.manifest, contentHash: entry.integrity.value });
      await visit(entry.manifest);
    }
  }

  await visit(manifest);
  return (manifestId, version) => resolved.get(`${manifestId}@${version}`);
}

export function buildCommonsServer(
  store: CommonsStore,
  options: { keyPair?: CommonsSigningKeyPair; publishToken: string },
): FastifyInstance {
  if (options.publishToken.length < 32) {
    throw new Error("COMMONS_PUBLISH_TOKEN must contain at least 32 characters");
  }
  const keyPair = options.keyPair ?? resolveCommonsSigningKeyPair();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/health", async () => {
    const all = await store.listAll();
    return { ok: true, service: "commons", packages: new Set(all.map((e) => e.name)).size };
  });

  app.get("/v1/signing-key", async () => {
    return { publicKey: keyPair.publicKeyPem, algorithm: "ed25519" };
  });

  app.get<{ Querystring: { kind?: string; tag?: string; search?: string; limit?: string; offset?: string } }>(
    "/v1/packages",
    async (req, reply) => {
      const { kind, tag } = req.query;
      if (kind !== undefined && !PACKAGE_KINDS.includes(kind)) {
        return reply.status(400).send({ error: "invalid_kind", message: `kind must be one of ${PACKAGE_KINDS.join(", ")}` });
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

      const byName = new Map<string, Awaited<ReturnType<CommonsStore["listVersions"]>>>();
      for (const entry of await store.listAll()) {
        assertStoredEntryTrusted(entry, keyPair.publicKeyPem);
        const versions = byName.get(entry.name) ?? [];
        versions.push(entry);
        byName.set(entry.name, versions);
      }

      let summaries: CommonsPackageSummary[] = [...byName.values()].map((versions) => {
        const latest = latestOf(versions);
        return {
          name: latest.name,
          latestVersion: latest.version,
          kind: latest.kind,
          summary: latest.summary,
          tags: latest.tags,
          versionCount: versions.length,
          publishedAt: latest.publishedAt,
        };
      });
      if (kind !== undefined) summaries = summaries.filter((s) => s.kind === (kind as PackageKind));
      if (tag !== undefined) summaries = summaries.filter((s) => s.tags.includes(tag));
      const search = req.query.search?.trim().toLocaleLowerCase();
      if (search) {
        summaries = summaries.filter((summary) =>
          [summary.name, summary.summary, ...summary.tags].some((value) => value.toLocaleLowerCase().includes(search)),
        );
      }
      summaries.sort((a, b) => a.name.localeCompare(b.name));

      const result: CommonsListResult = {
        items: summaries.slice(offset, offset + limit),
        total: summaries.length,
        limit,
        offset,
      };
      return result;
    },
  );

  app.get<{ Params: { name: string } }>("/v1/packages/:name", async (req, reply) => {
    const versions = await store.listVersions(req.params.name);
    if (versions.length === 0) {
      return reply.status(404).send({ error: "not_found", message: `no package named ${req.params.name}` });
    }
    for (const entry of versions) assertStoredEntryTrusted(entry, keyPair.publicKeyPem);
    const detail: CommonsPackageDetail = {
      name: req.params.name,
      latest: latestOf(versions),
      versions: versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
    };
    return detail;
  });

  app.get<{ Params: { name: string; version: string } }>("/v1/packages/:name/:version", async (req, reply) => {
    const entry = await store.get(req.params.name, req.params.version);
    if (entry === null) {
      return reply.status(404).send({ error: "not_found", message: `no ${req.params.name}@${req.params.version}` });
    }
    assertStoredEntryTrusted(entry, keyPair.publicKeyPem);
    return entry;
  });

  app.post<{
    Body: { manifest?: unknown; tags?: unknown; provenance?: unknown; expectedContentHash?: unknown };
  }>("/v1/packages", async (req, reply) => {
    if (!publisherAuthorized(req.headers.authorization, options.publishToken)) {
      return reply.status(401).send({
        error: "publisher_unauthorized",
        message: "a valid Commons publisher bearer token is required",
      });
    }
    const body = req.body;
    if (typeof body !== "object" || body === null || body.manifest === undefined) {
      return reply.status(400).send({ error: "invalid_manifest", message: "body must be { manifest, tags? }" });
    }

    // Knowledge-only gate FIRST, on the raw payload — workspace/user data is
    // rejected even when it hides in fields the manifest parser would drop.
    const offendingPaths = findWorkspaceDataPaths({
      manifest: body.manifest,
      provenance: body.provenance,
      tags: body.tags,
    });
    if (offendingPaths.length > 0) {
      return reply.status(422).send({
        error: "workspace_data_rejected",
        message:
          "Universal Commons stores generalized capability knowledge only — never workspace or user data. Remove the offending fields and generalize the manifest.",
        offendingPaths,
      });
    }

    let manifest;
    try {
      manifest = parsePackageManifest(body.manifest);
    } catch (err) {
      if (err instanceof PackageManifestValidationError) {
        return reply.status(400).send({ error: "invalid_manifest", message: err.message });
      }
      throw err;
    }

    const tagsRaw = body.tags ?? [];
    if (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== "string" || t.length === 0)) {
      return reply.status(400).send({ error: "invalid_manifest", message: "tags must be an array of non-empty strings" });
    }
    const tags = normalizeCommonsTags(tagsRaw as string[]);

    const provenance = provenanceFromUnknown(body.provenance);
    if (!provenance) {
      return reply.status(400).send({
        error: "invalid_provenance",
        message:
          "provenance must declare sourceRepository, sourceRef, inspectedCommit, repositoryLicense, artifactLicense, and licenseVerified",
      });
    }

    const resolveDependency = await verifiedDependencyResolver(store, manifest, keyPair.publicKeyPem);
    const securityScan = scanCommonsPackage(manifest, provenance, offendingPaths, resolveDependency);
    if (securityScan.status !== "passed") {
      return reply.status(422).send({
        error: "security_scan_failed",
        message: "deterministic Commons security scan rejected the capability",
        securityScan,
      });
    }

    const content = {
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      summary: manifest.summary,
      tags,
      manifest,
      provenance,
      securityScan,
    };
    const integrity = computeCommonsContentHash(content, sha256);
    if (body.expectedContentHash !== undefined && body.expectedContentHash !== integrity.value) {
      return reply.status(409).send({
        error: "content_hash_mismatch",
        message: `publisher expected ${String(body.expectedContentHash)}, computed ${integrity.value}`,
        computedContentHash: integrity.value,
      });
    }
    const unsignedEntry: Omit<CommonsPackageEntry, "signature"> = {
      ...content,
      integrity,
      publishedAt: new Date().toISOString(),
    };
    const entry: CommonsPackageEntry = { ...unsignedEntry, signature: signCommonsEntry(unsignedEntry, keyPair) };
    const check = verifyCommonsEntry(entry, sha256, ed25519ManifestVerifier, { trustedPublicKeys: [keyPair.publicKeyPem] });
    if (!check.valid) {
      return reply.status(500).send({ error: "signing_failed", message: check.reason });
    }

    try {
      await store.put(entry);
    } catch (err) {
      if (err instanceof DuplicateVersionError) {
        return reply.status(409).send({ error: "duplicate_version", message: err.message });
      }
      throw err;
    }

    return reply.status(201).send({ name: manifest.name, version: manifest.version, contentHash: integrity.value });
  });

  return app;
}
