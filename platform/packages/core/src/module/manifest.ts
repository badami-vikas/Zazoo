/**
 * module.yaml parse+validate — pure, zero-deps (no yaml/zod dependency in
 * @bridge/core; callers hand in an already-parsed plain object, e.g. from
 * `yaml.parse()` at the apps/api boundary, same "validated at the seam"
 * discipline `packages/db`'s jsonb schemas already follow for
 * organization_definitions/capability_manifests). This module is the shape
 * guard: it throws a typed `ModuleManifestValidationError` loudly on a
 * malformed manifest rather than silently defaulting fields, so a corrupt
 * module.yaml never installs as if it were empty.
 */
import type {
  ModuleAgentBinding,
  ModuleAutomationBinding,
  ModuleCapabilityNeed,
  ModulePageBinding,
  ModuleSurfaceManifest,
  ModuleDependency,
  ModuleKind,
  ModuleManifest,
  ModuleOrganizationVocab,
} from "./types.js";
import type { CapabilityExecutionSpec, CapabilityManifest, SandboxIsolationLevel } from "../capability/types.js";
import { parseOrganizationBlueprint } from "../blueprint.js";

const MODULE_KINDS: readonly ModuleKind[] = [
  "skill",
  "automation",
  "agent",
  "module",
  "view",
  "integration_bundle",
  "organization_definition",
];

/** Strict semver — MAJOR.MINOR.PATCH, no ranges/prerelease-only shorthand. */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/;

const SANDBOX_ISOLATION_LEVELS: readonly SandboxIsolationLevel[] = ["none", "process", "container", "vm"];

export class ModuleManifestValidationError extends Error {
  constructor(reason: string) {
    super(`module manifest invalid: ${reason}`);
    this.name = "ModuleManifestValidationError";
  }
}

function fail(reason: string): never {
  throw new ModuleManifestValidationError(reason);
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

function parseDependency(raw: unknown, index: number): ModuleDependency {
  if (!isPlainObject(raw)) fail(`dependencies[${index}] must be an object`);
  const manifestId = raw.manifestId;
  if (typeof manifestId !== "string" || manifestId.length === 0) {
    fail(`dependencies[${index}].manifestId must be a non-empty string`);
  }
  const version = assertSemver(raw.version, `dependencies[${index}].version`);
  return { manifestId: manifestId as string, version };
}

function parseStringArray(raw: unknown, field: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`${field} must be an array of strings`);
  return raw.map((v, i) => {
    if (typeof v !== "string" || v.length === 0) fail(`${field}[${i}] must be a non-empty string`);
    return v as string;
  });
}

/** Parse an optional capability `execution` spec (PKG-1). Its PRESENCE marks
 * the capability executable, so it must be well-formed when present — a
 * half-declared executable (missing sandbox/isolation) fails loudly rather
 * than installing as if declarative and dodging the sandbox floor. */
function parseExecutionSpec(raw: unknown, index: number): CapabilityExecutionSpec | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) fail(`capabilities[${index}].execution must be an object when present`);
  if (raw.executable !== true) {
    fail(`capabilities[${index}].execution.executable must be the literal true (omit execution for a declarative capability)`);
  }
  const isolation = raw.isolation;
  if (typeof isolation !== "string" || !SANDBOX_ISOLATION_LEVELS.includes(isolation as SandboxIsolationLevel)) {
    fail(`capabilities[${index}].execution.isolation must be one of ${SANDBOX_ISOLATION_LEVELS.join(", ")}`);
  }
  const sandboxRaw = raw.sandbox;
  if (!isPlainObject(sandboxRaw)) fail(`capabilities[${index}].execution.sandbox must be an object`);
  const network = sandboxRaw.network ?? false;
  if (typeof network !== "boolean") fail(`capabilities[${index}].execution.sandbox.network must be a boolean`);
  return {
    executable: true,
    isolation: isolation as SandboxIsolationLevel,
    sandbox: {
      network,
      filesystem: parseStringArray(sandboxRaw.filesystem, `capabilities[${index}].execution.sandbox.filesystem`),
      env: parseStringArray(sandboxRaw.env, `capabilities[${index}].execution.sandbox.env`),
    },
  };
}

/** A capability entry inside module.yaml's `capabilities[]` — the full
 * `CapabilityManifest` shape (types.ts), minus fields the module format
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

  const execution = parseExecutionSpec(raw.execution, index);
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
    ...(execution ? { execution } : {}),
  };
}

function parseOrganizationVocab(raw: unknown): ModuleOrganizationVocab {
  if (raw === undefined) return { alignsToBridgeTheme: true, domainTerms: {} };
  if (!isPlainObject(raw)) fail("organization_vocab must be an object");
  const alignsRaw = raw.alignsToBridgeTheme ?? raw.aligns_to_bridge_theme ?? true;
  if (typeof alignsRaw !== "boolean") fail("organization_vocab.aligns_to_bridge_theme must be a boolean");
  const termsRaw = raw.domainTerms ?? raw.domain_terms ?? {};
  if (!isPlainObject(termsRaw)) fail("organization_vocab.domain_terms must be an object");
  const domainTerms: Record<string, string> = {};
  for (const [k, v] of Object.entries(termsRaw)) {
    if (typeof v !== "string") fail(`organization_vocab.domain_terms.${k} must be a string`);
    domainTerms[k] = v;
  }
  return { alignsToBridgeTheme: alignsRaw, domainTerms };
}

function requiredString(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.length === 0) fail(`${field} must be a non-empty string`);
  return raw;
}

function parseModuleSurface(raw: unknown, capabilities: CapabilityManifest[]): ModuleSurfaceManifest | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) fail("module.module must be an object");

  const displayName = requiredString(raw.displayName ?? raw.display_name, "module.module.display_name");
  if (displayName.trim() === "." || displayName.trim() === "..") {
    fail("module.module.display_name cannot be a relative path segment");
  }
  const route = requiredString(raw.route, "module.module.route");
  if (!route.startsWith("/")) fail("module.module.route must start with /");

  // Sub-module parent (ADR-178). Validated for SHAPE only: a manifest is parsed
  // in isolation, so "does this parent exist" and "is the parent itself a
  // sub-module" are nav-build-time questions (buildModuleNavTree), not parse-time
  // ones. Rejecting an unknown name here would make install order significant.
  const parentRaw = raw.parentModule ?? raw.parent_module;
  const parentModule =
    parentRaw === undefined ? undefined : requiredString(parentRaw, "module.module.parent_module");
  if (parentModule !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parentModule)) {
    fail("module.module.parent_module must be a kebab-case module name");
  }

  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));

  const pagesRaw = raw.pages ?? [];
  if (!Array.isArray(pagesRaw)) fail("module.module.pages must be an array");
  const pages: ModulePageBinding[] = pagesRaw.map((page, index) => {
    if (!isPlainObject(page)) fail(`module.module.pages[${index}] must be an object`);
    const binding = {
      id: requiredString(page.id, `module.module.pages[${index}].id`),
      name: requiredString(page.name, `module.module.pages[${index}].name`),
      route: requiredString(page.route, `module.module.pages[${index}].route`),
      databaseId: requiredString(page.databaseId ?? page.database_id, `module.module.pages[${index}].database_id`),
      capabilityId: requiredString(page.capabilityId ?? page.capability_id, `module.module.pages[${index}].capability_id`),
    };
    if (!binding.route.startsWith("/")) fail(`module.module.pages[${index}].route must start with /`);
    if (capabilityById.get(binding.capabilityId)?.capabilityType !== "view") {
      fail(`module.module.pages[${index}].capability_id must reference a view capability`);
    }
    return binding;
  });

  const agentsRaw = raw.agents ?? [];
  if (!Array.isArray(agentsRaw)) fail("module.module.agents must be an array");
  const agents: ModuleAgentBinding[] = agentsRaw.map((agent, index) => {
    if (!isPlainObject(agent)) fail(`module.module.agents[${index}] must be an object`);
    const plane = agent.plane;
    if (plane !== undefined && plane !== "local" && plane !== "cloud") {
      fail(`module.module.agents[${index}].plane must be local or cloud`);
    }
    const binding: ModuleAgentBinding = {
      id: requiredString(agent.id, `module.module.agents[${index}].id`),
      name: requiredString(agent.name, `module.module.agents[${index}].name`),
      capabilityId: requiredString(agent.capabilityId ?? agent.capability_id, `module.module.agents[${index}].capability_id`),
      skillIds: parseStringArray(agent.skillIds ?? agent.skill_ids, `module.module.agents[${index}].skill_ids`),
      ...(plane ? { plane } : {}),
    };
    if (capabilityById.get(binding.capabilityId)?.capabilityType !== "agent") {
      fail(`module.module.agents[${index}].capability_id must reference an agent capability`);
    }
    for (const skillId of binding.skillIds) {
      if (capabilityById.get(skillId)?.capabilityType !== "skill") {
        fail(`module.module.agents[${index}].skill_ids must reference skill capabilities`);
      }
    }
    return binding;
  });
  const agentIds = new Set(agents.map((agent) => agent.id));

  const automationsRaw = raw.automations ?? [];
  if (!Array.isArray(automationsRaw)) fail("module.module.automations must be an array");
  const automations: ModuleAutomationBinding[] = automationsRaw.map((automation, index) => {
    if (!isPlainObject(automation)) fail(`module.module.automations[${index}] must be an object`);
    const automationId = automation.automationId ?? automation.automation_id;
    const runRoute = automation.runRoute ?? automation.run_route;
    const binding: ModuleAutomationBinding = {
      id: requiredString(automation.id, `module.module.automations[${index}].id`),
      name: requiredString(automation.name, `module.module.automations[${index}].name`),
      capabilityId: requiredString(
        automation.capabilityId ?? automation.capability_id,
        `module.module.automations[${index}].capability_id`,
      ),
      agentId: requiredString(automation.agentId ?? automation.agent_id, `module.module.automations[${index}].agent_id`),
      trigger: requiredString(automation.trigger, `module.module.automations[${index}].trigger`),
      procedure: requiredString(automation.procedure, `module.module.automations[${index}].procedure`),
      ...(automationId !== undefined
        ? { automationId: requiredString(automationId, `module.module.automations[${index}].automation_id`) }
        : {}),
      ...(runRoute !== undefined
        ? { runRoute: requiredString(runRoute, `module.module.automations[${index}].run_route`) }
        : {}),
    };
    if (capabilityById.get(binding.capabilityId)?.capabilityType !== "automation") {
      fail(`module.module.automations[${index}].capability_id must reference an Automation capability`);
    }
    if (!agentIds.has(binding.agentId)) {
      fail(`module.module.automations[${index}].agent_id must reference a declared module agent`);
    }
    if (binding.runRoute && !binding.runRoute.startsWith("/")) {
      fail(`module.module.automations[${index}].run_route must start with /`);
    }
    return binding;
  });

  const commonsNeedsRaw = raw.commonsNeeds ?? raw.commons_needs ?? [];
  if (!Array.isArray(commonsNeedsRaw)) fail("module.module.commons_needs must be an array");
  const commonsNeeds: ModuleCapabilityNeed[] = commonsNeedsRaw.map((need, index) => {
    if (!isPlainObject(need)) fail(`module.module.commons_needs[${index}] must be an object`);
    const agentId = requiredString(need.agentId ?? need.agent_id, `module.module.commons_needs[${index}].agent_id`);
    if (!agentIds.has(agentId)) {
      fail(`module.module.commons_needs[${index}].agent_id must reference a declared module agent`);
    }
    const needKind = requiredString(need.kind, `module.module.commons_needs[${index}].kind`);
    if (!MODULE_KINDS.includes(needKind as ModuleKind)) {
      fail(`module.module.commons_needs[${index}].kind must be one of ${MODULE_KINDS.join(", ")}`);
    }
    const tags = parseStringArray(need.tags, `module.module.commons_needs[${index}].tags`);
    if (tags.length === 0) fail(`module.module.commons_needs[${index}].tags must contain at least one tag`);
    return {
      id: requiredString(need.id, `module.module.commons_needs[${index}].id`),
      title: requiredString(need.title, `module.module.commons_needs[${index}].title`),
      description: requiredString(need.description, `module.module.commons_needs[${index}].description`),
      agentId,
      kind: needKind as ModuleKind,
      tags,
    };
  });

  return {
    displayName,
    route,
    ...(parentModule !== undefined ? { parentModule } : {}),
    pages,
    agents,
    automations,
    commonsNeeds,
  };
}

/**
 * Parse+validate an already-parsed `module.yaml` object (or the equivalent
 * plain-object shape from a tRPC input) into a `ModuleManifest`. Accepts
 * both camelCase and the YAML-conventional snake_case keys shown in the
 * format doc's examples, so a raw `yaml.parse()` result needs no
 * pre-transformation by the caller.
 */
export function parseModuleManifest(raw: unknown): ModuleManifest {
  if (!isPlainObject(raw)) fail("root must be an object");
  const manifestRoot =
    typeof raw.name === "string" || raw.version !== undefined
      ? raw
      : isPlainObject(raw.module)
        ? raw.module
        : raw;

  const name = manifestRoot.name;
  if (typeof name !== "string" || name.length === 0) fail("module.name must be a non-empty string");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail("module.name must be kebab-case");

  const version = assertSemver(manifestRoot.version, "module.version");

  const kind = manifestRoot.kind;
  if (typeof kind !== "string" || !MODULE_KINDS.includes(kind as ModuleKind)) {
    fail(`module.kind must be one of ${MODULE_KINDS.join(", ")}`);
  }

  const summary = manifestRoot.summary;
  if (typeof summary !== "string" || summary.length === 0) fail("module.summary must be a non-empty string");

  const description = manifestRoot.description ?? summary;
  if (typeof description !== "string" || description.length === 0) fail("module.description must be a non-empty string");
  if (description.length > 1024) fail("module.description must be <=1024 chars (agentskills.io L1 convention)");

  const lineageRaw = manifestRoot.lineageManifestId ?? manifestRoot.lineage_manifest_id ?? null;
  if (lineageRaw !== null && typeof lineageRaw !== "string") fail("module.lineage_manifest_id must be a string or null");

  // BLUEPRINT-1: an organization_definition module carries its declarative
  // blueprint here; parse it through the full declarative gate. Presence also
  // relaxes the capabilities>=1 rule below (an organization_definition composes
  // capabilities by reference inside the blueprint, not by bundling them).
  const blueprint = manifestRoot.blueprint !== undefined
    ? parseOrganizationBlueprint(manifestRoot.blueprint)
    : undefined;
  const isBlueprintModule = kind === "organization_definition" && blueprint !== undefined;

  const dependenciesRaw = manifestRoot.dependencies ?? [];
  if (!Array.isArray(dependenciesRaw)) fail("module.dependencies must be an array");
  const dependencies = dependenciesRaw.map(parseDependency);

  const capabilitiesRaw = manifestRoot.capabilities ?? [];
  if (!Array.isArray(capabilitiesRaw)) fail("module.capabilities must be an array");
  if (capabilitiesRaw.length === 0 && !isBlueprintModule) {
    fail("module.capabilities must be a non-empty array — a module must bundle at least one capability (except an organization_definition carrying a blueprint)");
  }
  const capabilities = capabilitiesRaw.map(parseCapability);
  const seenIds = new Set<string>();
  for (const c of capabilities) {
    if (seenIds.has(c.id)) fail(`module.capabilities has a duplicate id: ${c.id}`);
    seenIds.add(c.id);
  }

  const contextProvidersRaw = manifestRoot.contextProviders ?? manifestRoot.context_providers ?? [];
  if (!Array.isArray(contextProvidersRaw)) fail("module.context_providers must be an array");
  const contextProviders = contextProvidersRaw.map((c, i) => {
    if (!isPlainObject(c)) fail(`context_providers[${i}] must be an object`);
    const providerKind = c.kind;
    if (typeof providerKind !== "string" || providerKind.length === 0) fail(`context_providers[${i}].kind must be a non-empty string`);
    const required = c.required ?? false;
    if (typeof required !== "boolean") fail(`context_providers[${i}].required must be a boolean`);
    return { kind: providerKind, required };
  });

  const organizationVocab = parseOrganizationVocab(
    manifestRoot.organizationVocab ?? manifestRoot.organization_vocab,
  );
  const module = parseModuleSurface(manifestRoot.module, capabilities);
  // The one parent check that IS answerable from a single manifest: a Module
  // cannot be its own parent. Everything else about the relation needs siblings.
  if (module?.parentModule === name) {
    fail("module.module.parent_module must not name the Module itself");
  }

  return {
    name,
    version,
    kind: kind as ModuleKind,
    summary,
    description,
    lineageManifestId: (lineageRaw as string | null) ?? null,
    dependencies,
    capabilities,
    contextProviders,
    organizationVocab,
    ...(module ? { module } : {}),
    ...(blueprint ? { blueprint } : {}),
  };
}
