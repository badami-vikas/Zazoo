/**
 * Universal Commons HTTP surface — the PERMANENT registry contract
 * (docs/wiki/commons.md). Local-first Fastify service today; Bridge Cloud
 * serves the SAME routes later, so consumers swap deployments via
 * COMMONS_URL only.
 *
 * Contract (v1 — curated Module registry, generalized capability content only):
 *   GET  /health                      → { ok, service, modules }
 *   GET  /v1/modules                 → list; ?kind= &tag= &limit= &offset=
 *   GET  /v1/modules/:name           → latest entry + version history
 *   GET  /v1/modules/:name/:version  → one full published entry
 *   POST /v1/modules                 → publish { manifest, tags? }
 *        400 invalid_manifest  · 409 duplicate_version
 *        422 organization_data_rejected { offendingPaths } ← generalized-content gate
 */
import Fastify, { type FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  archetypeName,
  commonsArchetypeContent,
  computeCommonsArchetypeHash,
  computeCommonsContentHash,
  maxSupportBand,
  normalizeCommonsTags,
  parseCapabilityArchetype,
  parseModuleManifest,
  ModuleManifestValidationError,
  verifyCommonsArchetypeEntry,
  verifyCommonsEntry,
  type CapabilityArchetype,
  type CommonsArchetypeEntry,
  type CommonsListResult,
  type CommonsModuleDetail,
  type CommonsModuleEntry,
  type CommonsModuleSummary,
  type CommonsProvenance,
  type ModuleKind,
} from "@bridge/core";
import { findOrganizationDataPaths } from "./privacy-gate.js";
import { scanCommonsModule } from "./security-scan.js";
import {
  ed25519ManifestVerifier,
  resolveCommonsSigningKeyPair,
  signCommonsArchetypeEntry,
  signCommonsEntry,
  type CommonsSigningKeyPair,
} from "./signing.js";
import { DuplicateVersionError, type CommonsStore } from "./store.js";

const MODULE_KINDS: readonly string[] = [
  "skill",
  "automation",
  "agent",
  "view",
  "integration_bundle",
  "organization_definition",
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
    "contentLicense",
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
    typeof candidate.contentLicense !== "string" ||
    candidate.contentLicense.trim() === "" ||
    typeof candidate.licenseVerified !== "boolean"
  ) {
    return null;
  }
  return {
    sourceRepository: candidate.sourceRepository.trim(),
    sourceRef: candidate.sourceRef.trim(),
    inspectedCommit: candidate.inspectedCommit.trim(),
    repositoryLicense: candidate.repositoryLicense.trim(),
    contentLicense: candidate.contentLicense.trim(),
    licenseVerified: candidate.licenseVerified,
  };
}

function assertStoredEntryTrusted(entry: CommonsModuleEntry, publicKey: string): void {
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
  manifest: ReturnType<typeof parseModuleManifest>,
  publicKey: string,
): Promise<
  (
    manifestId: string,
    version: string,
  ) => { manifest: ReturnType<typeof parseModuleManifest>; contentHash: string } | undefined
> {
  const resolved = new Map<string, { manifest: ReturnType<typeof parseModuleManifest>; contentHash: string }>();
  const visited = new Set<string>();

  async function visit(current: ReturnType<typeof parseModuleManifest>): Promise<void> {
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
    return { ok: true, service: "commons", modules: new Set(all.map((e) => e.name)).size };
  });

  app.get("/v1/signing-key", async () => {
    return { publicKey: keyPair.publicKeyPem, algorithm: "ed25519" };
  });

  app.get<{ Querystring: { kind?: string; tag?: string; search?: string; limit?: string; offset?: string } }>(
    "/v1/modules",
    async (req, reply) => {
      const { kind, tag } = req.query;
      if (kind !== undefined && !MODULE_KINDS.includes(kind)) {
        return reply.status(400).send({ error: "invalid_kind", message: `kind must be one of ${MODULE_KINDS.join(", ")}` });
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

      let summaries: CommonsModuleSummary[] = [...byName.values()].map((versions) => {
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
      if (kind !== undefined) summaries = summaries.filter((s) => s.kind === (kind as ModuleKind));
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

  app.get<{ Params: { name: string } }>("/v1/modules/:name", async (req, reply) => {
    const versions = await store.listVersions(req.params.name);
    if (versions.length === 0) {
      return reply.status(404).send({ error: "not_found", message: `no module named ${req.params.name}` });
    }
    for (const entry of versions) assertStoredEntryTrusted(entry, keyPair.publicKeyPem);
    const detail: CommonsModuleDetail = {
      name: req.params.name,
      latest: latestOf(versions),
      versions: versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
    };
    return detail;
  });

  app.get<{ Params: { name: string; version: string } }>("/v1/modules/:name/:version", async (req, reply) => {
    const entry = await store.get(req.params.name, req.params.version);
    if (entry === null) {
      return reply.status(404).send({ error: "not_found", message: `no ${req.params.name}@${req.params.version}` });
    }
    assertStoredEntryTrusted(entry, keyPair.publicKeyPem);
    return entry;
  });

  app.post<{
    Body: { manifest?: unknown; tags?: unknown; provenance?: unknown; expectedContentHash?: unknown };
  }>("/v1/modules", async (req, reply) => {
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

    // Generalized-content gate FIRST, on the raw payload — Organization/user data is
    // rejected even when it hides in fields the manifest parser would drop.
    const offendingPaths = findOrganizationDataPaths({
      manifest: body.manifest,
      provenance: body.provenance,
      tags: body.tags,
    });
    if (offendingPaths.length > 0) {
      return reply.status(422).send({
        error: "organization_data_rejected",
        message:
          "Universal Commons stores generalized capability content only — never Organization or user data. Remove the offending fields and generalize the manifest.",
        offendingPaths,
      });
    }

    let manifest;
    try {
      manifest = parseModuleManifest(body.manifest);
    } catch (err) {
      if (err instanceof ModuleManifestValidationError) {
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
          "provenance must declare sourceRepository, sourceRef, inspectedCommit, repositoryLicense, contentLicense, and licenseVerified",
      });
    }

    const resolveDependency = await verifiedDependencyResolver(store, manifest, keyPair.publicKeyPem);
    const securityScan = scanCommonsModule(manifest, provenance, offendingPaths, resolveDependency);
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
    const unsignedEntry: Omit<CommonsModuleEntry, "signature"> = {
      ...content,
      integrity,
      publishedAt: new Date().toISOString(),
    };
    const entry: CommonsModuleEntry = { ...unsignedEntry, signature: signCommonsEntry(unsignedEntry, keyPair) };
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

  // Capability archetypes (roadmap-v2 Phase 4) — generalized preference
  // patterns only, same privacy gate and signing posture as modules.
  app.get<{ Querystring: { domain?: string; limit?: string; offset?: string } }>(
    "/v1/archetypes",
    async (req) => {
      const all = await store.listAllArchetypes();
      const domain = req.query.domain?.trim().toLowerCase();
      const filtered = domain ? all.filter((entry) => entry.archetype.domain === domain) : all;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
      return { archetypes: filtered.slice(offset, offset + limit), total: filtered.length };
    },
  );

  app.post<{ Body: { archetype?: unknown; tags?: unknown } }>("/v1/archetypes", async (req, reply) => {
    if (!publisherAuthorized(req.headers.authorization, options.publishToken)) {
      return reply.status(401).send({
        error: "publisher_unauthorized",
        message: "a valid Commons publisher bearer token is required",
      });
    }
    const body = req.body;
    if (typeof body !== "object" || body === null || body.archetype === undefined) {
      return reply.status(400).send({ error: "invalid_archetype", message: "body must be { archetype, tags? }" });
    }
    // Generalized-content gate FIRST, on the raw payload.
    const offendingPaths = findOrganizationDataPaths({ archetype: body.archetype, tags: body.tags });
    if (offendingPaths.length > 0) {
      return reply.status(422).send({
        error: "organization_data_rejected",
        message:
          "Universal Commons stores generalized capability content only — never Organization or user data. Generalize the archetype.",
        offendingPaths,
      });
    }
    let archetype;
    try {
      archetype = parseCapabilityArchetype(body.archetype);
    } catch (err) {
      return reply.status(400).send({ error: "invalid_archetype", message: (err as Error).message });
    }
    if (archetype.name !== archetypeName(archetype.domain, archetype)) {
      return reply.status(400).send({
        error: "invalid_archetype",
        message: "archetype name must be the deterministic slug of its own pattern",
      });
    }
    const tagsRaw = body.tags ?? [];
    if (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== "string" || t.length === 0)) {
      return reply.status(400).send({ error: "invalid_archetype", message: "tags must be an array of non-empty strings" });
    }
    const tags = normalizeCommonsTags(tagsRaw as string[]);

    // Many-workspaces aggregation: archetype names are deterministic per
    // pattern, so a re-publish of a known name is another workspace
    // corroborating the same pattern. The stored entry is superseded by a
    // freshly signed revision: contributions += 1, supportBand = max band
    // seen, tags union. Counting is anonymous — no contributor identity is
    // recorded (the privacy gate would reject one anyway); the publish
    // bearer token is the only replay control, so `contributions` is
    // corroboration signal from trusted publishers, not a hard census.
    const buildSignedEntry = (
      body: { archetype: CapabilityArchetype; tags: string[]; contributions: number },
    ): CommonsArchetypeEntry | null => {
      const content = commonsArchetypeContent(body);
      const integrity = computeCommonsArchetypeHash(content, sha256);
      const unsigned: Omit<CommonsArchetypeEntry, "signature"> = {
        ...body,
        integrity,
        publishedAt: new Date().toISOString(),
      };
      const entry: CommonsArchetypeEntry = { ...unsigned, signature: signCommonsArchetypeEntry(unsigned, keyPair) };
      const check = verifyCommonsArchetypeEntry(entry, sha256, ed25519ManifestVerifier, {
        trustedPublicKeys: [keyPair.publicKeyPem],
      });
      return check.valid ? entry : null;
    };

    const existing = await store.getArchetype(archetype.name);
    if (existing) {
      const aggregated = buildSignedEntry({
        archetype: { ...existing.archetype, supportBand: maxSupportBand(existing.archetype.supportBand, archetype.supportBand) },
        tags: normalizeCommonsTags([...existing.tags, ...tags]),
        contributions: (Number.isInteger(existing.contributions) ? existing.contributions : 1) + 1,
      });
      if (!aggregated) {
        return reply.status(500).send({ error: "signing_failed", message: "aggregated revision failed verification" });
      }
      await store.putArchetype(aggregated, { replace: true });
      return reply.status(200).send({
        name: aggregated.archetype.name,
        contentHash: aggregated.integrity.value,
        contributions: aggregated.contributions,
        supportBand: aggregated.archetype.supportBand,
        aggregated: true,
      });
    }

    const entry = buildSignedEntry({ archetype, tags, contributions: 1 });
    if (!entry) {
      return reply.status(500).send({ error: "signing_failed", message: "entry failed verification after signing" });
    }
    try {
      await store.putArchetype(entry);
    } catch {
      // Lost a first-publish race — re-read and aggregate on top instead.
      const raced = await store.getArchetype(archetype.name);
      if (!raced) throw new Error("commons: archetype publish failed without a stored entry");
      const aggregated = buildSignedEntry({
        archetype: { ...raced.archetype, supportBand: maxSupportBand(raced.archetype.supportBand, archetype.supportBand) },
        tags: normalizeCommonsTags([...raced.tags, ...tags]),
        contributions: (Number.isInteger(raced.contributions) ? raced.contributions : 1) + 1,
      });
      if (!aggregated) {
        return reply.status(500).send({ error: "signing_failed", message: "aggregated revision failed verification" });
      }
      await store.putArchetype(aggregated, { replace: true });
      return reply.status(200).send({
        name: aggregated.archetype.name,
        contentHash: aggregated.integrity.value,
        contributions: aggregated.contributions,
        supportBand: aggregated.archetype.supportBand,
        aggregated: true,
      });
    }
    return reply.status(201).send({ name: archetype.name, contentHash: entry.integrity.value, contributions: 1 });
  });

  return app;
}
