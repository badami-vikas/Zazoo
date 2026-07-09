/**
 * package.yaml parse+validate — pure, zero-deps (no yaml/zod dependency in
 * @bridge/core; callers hand in an already-parsed plain object, e.g. from
 * `yaml.parse()` at the apps/api boundary, same "validated at the seam"
 * discipline `packages/db`'s jsonb schemas already follow for
 * workspace_definitions/capability_manifests). This module is the shape
 * guard: it throws a typed `PackageManifestValidationError` loudly on a
 * malformed manifest rather than silently defaulting fields, so a corrupt
 * package.yaml never installs as if it were empty.
 */
import type { PackageDependency, PackageKind, PackageManifest, PackageWorkspaceVocab } from "./types.js";
import type { CapabilityManifest } from "../capability/types.js";

const PACKAGE_KINDS: readonly PackageKind[] = [
  "skill",
  "workflow",
  "agent",
  "tool",
  "view",
  "integration_bundle",
  "workspace_definition",
];

/** Strict semver — MAJOR.MINOR.PATCH, no ranges/prerelease-only shorthand. */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/;

export class PackageManifestValidationError extends Error {
  constructor(reason: string) {
    super(`package manifest invalid: ${reason}`);
    this.name = "PackageManifestValidationError";
  }
}

function fail(reason: string): never {
  throw new PackageManifestValidationError(reason);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertSemver(version: unknown, field: string): string {
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    fail(`${field} must be exact semver (MAJOR.MINOR.PATCH), got ${JSON.stringify(version)}`);
  }
  return version as string;
}

function parseDependency(raw: unknown, index: number): PackageDependency {
  if (!isPlainObject(raw)) fail(`dependencies[${index}] must be an object`);
  const manifestId = raw.manifestId;
  if (typeof manifestId !== "string" || manifestId.length === 0) {
    fail(`dependencies[${index}].manifestId must be a non-empty string`);
  }
  const version = assertSemver(raw.version, `dependencies[${index}].version`);
  return { manifestId: manifestId as string, version };
}

/** A capability entry inside package.yaml's `capabilities[]` — the full
 * `CapabilityManifest` shape (types.ts), minus fields the package format
 * supplies structurally (id/name/version come from the entry itself). */
function parseCapability(raw: unknown, index: number): CapabilityManifest {
  if (!isPlainObject(raw)) fail(`capabilities[${index}] must be an object`);
  const id = raw.id;
  if (typeof id !== "string" || id.length === 0) fail(`capabilities[${index}].id must be a non-empty string`);
  const capabilityType = raw.capabilityType ?? raw.capability_type;
  if (typeof capabilityType !== "string" || capabilityType.length === 0) {
    fail(`capabilities[${index}].capability_type must be a non-empty string`);
  }
  const permissionsRaw = raw.permissions;
  if (!Array.isArray(permissionsRaw)) fail(`capabilities[${index}].permissions must be an array`);
  const permissions = permissionsRaw.map((p, i) => {
    if (!isPlainObject(p)) fail(`capabilities[${index}].permissions[${i}] must be an object`);
    const resourceType = p.resourceType ?? p.resource_type;
    const action = p.action;
    const dataScope = p.dataScope ?? p.data_scope;
    const egress = p.egress;
    if (typeof resourceType !== "string" || resourceType.length === 0) {
      fail(`capabilities[${index}].permissions[${i}].resource_type must be a non-empty string`);
    }
    if (action !== "read" && action !== "write" && action !== "send") {
      fail(`capabilities[${index}].permissions[${i}].action must be read|write|send`);
    }
    if (dataScope !== "public" && dataScope !== "private" && dataScope !== "all") {
      fail(`capabilities[${index}].permissions[${i}].data_scope must be public|private|all`);
    }
    if (typeof egress !== "boolean") {
      fail(`capabilities[${index}].permissions[${i}].egress must be a boolean`);
    }
    return {
      resourceType: resourceType as string,
      action: action as "read" | "write" | "send",
      dataScope: dataScope as "public" | "private" | "all",
      egress: egress as boolean,
    };
  });

  const connectorsRaw = raw.connectors ?? [];
  if (!Array.isArray(connectorsRaw)) fail(`capabilities[${index}].connectors must be an array`);
  const connectors = connectorsRaw.map((c, i) => {
    if (!isPlainObject(c)) fail(`capabilities[${index}].connectors[${i}] must be an object`);
    const cid = c.id;
    if (typeof cid !== "string" || cid.length === 0) fail(`capabilities[${index}].connectors[${i}].id must be a non-empty string`);
    const externalSend = c.externalSend ?? c.external_send ?? false;
    if (typeof externalSend !== "boolean") fail(`capabilities[${index}].connectors[${i}].external_send must be a boolean`);
    return { id: cid, externalSend };
  });

  const dependenciesRaw = raw.dependencies ?? [];
  if (!Array.isArray(dependenciesRaw)) fail(`capabilities[${index}].dependencies must be an array`);
  const dependencies = dependenciesRaw.map((d, i) => {
    if (!isPlainObject(d)) fail(`capabilities[${index}].dependencies[${i}] must be an object`);
    const manifestId = d.manifestId ?? d.manifest_id;
    const versionRange = d.versionRange ?? d.version_range ?? d.version;
    if (typeof manifestId !== "string" || manifestId.length === 0) {
      fail(`capabilities[${index}].dependencies[${i}].manifest_id must be a non-empty string`);
    }
    if (typeof versionRange !== "string" || versionRange.length === 0) {
      fail(`capabilities[${index}].dependencies[${i}].version must be a non-empty string`);
    }
    return { manifestId, versionRange };
  });

  return {
    id,
    name: (typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id) as string,
    version: (typeof raw.version === "string" && raw.version.length > 0 ? raw.version : "1.0.0") as string,
    capabilityType: capabilityType as CapabilityManifest["capabilityType"],
    origin: (raw.origin as CapabilityManifest["origin"]) ?? "user_code",
    audience: (raw.audience as CapabilityManifest["audience"]) ?? "private",
    permissions,
    connectors,
    dependencies,
  };
}

function parseWorkspaceVocab(raw: unknown): PackageWorkspaceVocab {
  if (raw === undefined) return { alignsToBridgeTheme: true, domainTerms: {} };
  if (!isPlainObject(raw)) fail("workspace_vocab must be an object");
  const alignsRaw = raw.alignsToBridgeTheme ?? raw.aligns_to_bridge_theme ?? true;
  if (typeof alignsRaw !== "boolean") fail("workspace_vocab.aligns_to_bridge_theme must be a boolean");
  const termsRaw = raw.domainTerms ?? raw.domain_terms ?? {};
  if (!isPlainObject(termsRaw)) fail("workspace_vocab.domain_terms must be an object");
  const domainTerms: Record<string, string> = {};
  for (const [k, v] of Object.entries(termsRaw)) {
    if (typeof v !== "string") fail(`workspace_vocab.domain_terms.${k} must be a string`);
    domainTerms[k] = v;
  }
  return { alignsToBridgeTheme: alignsRaw, domainTerms };
}

/**
 * Parse+validate an already-parsed `package.yaml` object (or the equivalent
 * plain-object shape from a tRPC input) into a `PackageManifest`. Accepts
 * both camelCase and the YAML-conventional snake_case keys shown in the
 * format doc's examples, so a raw `yaml.parse()` result needs no
 * pre-transformation by the caller.
 */
export function parsePackageManifest(raw: unknown): PackageManifest {
  if (!isPlainObject(raw)) fail("root must be an object");
  const pkg = isPlainObject(raw.package) ? raw.package : raw;

  const name = pkg.name;
  if (typeof name !== "string" || name.length === 0) fail("package.name must be a non-empty string");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail("package.name must be kebab-case");

  const version = assertSemver(pkg.version, "package.version");

  const kind = pkg.kind;
  if (typeof kind !== "string" || !PACKAGE_KINDS.includes(kind as PackageKind)) {
    fail(`package.kind must be one of ${PACKAGE_KINDS.join(", ")}`);
  }

  const summary = pkg.summary;
  if (typeof summary !== "string" || summary.length === 0) fail("package.summary must be a non-empty string");

  const description = pkg.description ?? summary;
  if (typeof description !== "string" || description.length === 0) fail("package.description must be a non-empty string");
  if (description.length > 1024) fail("package.description must be <=1024 chars (agentskills.io L1 convention)");

  const lineageRaw = pkg.lineageManifestId ?? pkg.lineage_manifest_id ?? null;
  if (lineageRaw !== null && typeof lineageRaw !== "string") fail("package.lineage_manifest_id must be a string or null");

  const dependenciesRaw = pkg.dependencies ?? [];
  if (!Array.isArray(dependenciesRaw)) fail("package.dependencies must be an array");
  const dependencies = dependenciesRaw.map(parseDependency);

  const capabilitiesRaw = pkg.capabilities;
  if (!Array.isArray(capabilitiesRaw) || capabilitiesRaw.length === 0) {
    fail("package.capabilities must be a non-empty array — a package must bundle at least one capability");
  }
  const capabilities = capabilitiesRaw.map(parseCapability);
  const seenIds = new Set<string>();
  for (const c of capabilities) {
    if (seenIds.has(c.id)) fail(`package.capabilities has a duplicate id: ${c.id}`);
    seenIds.add(c.id);
  }

  const contextProvidersRaw = pkg.contextProviders ?? pkg.context_providers ?? [];
  if (!Array.isArray(contextProvidersRaw)) fail("package.context_providers must be an array");
  const contextProviders = contextProvidersRaw.map((c, i) => {
    if (!isPlainObject(c)) fail(`context_providers[${i}] must be an object`);
    const providerKind = c.kind;
    if (typeof providerKind !== "string" || providerKind.length === 0) fail(`context_providers[${i}].kind must be a non-empty string`);
    const required = c.required ?? false;
    if (typeof required !== "boolean") fail(`context_providers[${i}].required must be a boolean`);
    return { kind: providerKind, required };
  });

  const workspaceVocab = parseWorkspaceVocab(pkg.workspaceVocab ?? pkg.workspace_vocab);

  return {
    name,
    version,
    kind: kind as PackageKind,
    summary,
    description,
    lineageManifestId: (lineageRaw as string | null) ?? null,
    dependencies,
    capabilities,
    contextProviders,
    workspaceVocab,
  };
}
