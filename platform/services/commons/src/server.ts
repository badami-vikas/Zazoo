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
import {
  parsePackageManifest,
  PackageManifestValidationError,
  toSignedEnvelope,
  verifyManifestSignature,
  type CommonsListResult,
  type CommonsPackageDetail,
  type CommonsPackageSummary,
  type ManifestSignature,
  type PackageKind,
} from "@bridge/core";
import { findWorkspaceDataPaths } from "./privacy-gate.js";
import { ed25519ManifestVerifier, resolveCommonsSigningKeyPair, signManifest, type CommonsSigningKeyPair } from "./signing.js";
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

function latestOf<T extends { publishedAt: string }>(versions: T[]): T {
  // listVersions is oldest-first by publishedAt.
  return versions[versions.length - 1] as T;
}

export function buildCommonsServer(store: CommonsStore, options: { keyPair?: CommonsSigningKeyPair } = {}): FastifyInstance {
  const keyPair = options.keyPair ?? resolveCommonsSigningKeyPair();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/health", async () => {
    const all = await store.listAll();
    return { ok: true, service: "commons", packages: new Set(all.map((e) => e.name)).size };
  });

  app.get("/v1/signing-key", async () => {
    return { publicKey: keyPair.publicKeyPem, algorithm: "ed25519" };
  });

  app.get<{ Querystring: { kind?: string; tag?: string; limit?: string; offset?: string } }>(
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
    return entry;
  });

  app.post<{ Body: { manifest?: unknown; tags?: unknown; signature?: unknown } }>("/v1/packages", async (req, reply) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || body.manifest === undefined) {
      return reply.status(400).send({ error: "invalid_manifest", message: "body must be { manifest, tags? }" });
    }

    // Knowledge-only gate FIRST, on the raw payload — workspace/user data is
    // rejected even when it hides in fields the manifest parser would drop.
    const offendingPaths = findWorkspaceDataPaths(body.manifest);
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

    const suppliedSignature = manifestSignatureFromUnknown(body.signature);
    if (suppliedSignature) {
      const suppliedCheck = verifyManifestSignature(toSignedEnvelope(manifest, suppliedSignature), ed25519ManifestVerifier);
      if (!suppliedCheck.valid) {
        return reply.status(400).send({ error: "invalid_signature", message: "supplied manifest signature does not verify" });
      }
    }

    const signature = signManifest(manifest, keyPair);
    const check = verifyManifestSignature(toSignedEnvelope(manifest, signature), ed25519ManifestVerifier, {
      trustedPublicKeys: [keyPair.publicKeyPem],
    });
    if (!check.valid) {
      return reply.status(500).send({ error: "signing_failed", message: check.reason });
    }

    try {
      await store.put({
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        summary: manifest.summary,
        tags: [...new Set(tagsRaw as string[])],
        manifest,
        signature,
        publishedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof DuplicateVersionError) {
        return reply.status(409).send({ error: "duplicate_version", message: err.message });
      }
      throw err;
    }

    return reply.status(201).send({ name: manifest.name, version: manifest.version });
  });

  return app;
}

function manifestSignatureFromUnknown(value: unknown): ManifestSignature | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.signature !== "string" || typeof candidate.publicKey !== "string") return undefined;
  return candidate as unknown as ManifestSignature;
}
