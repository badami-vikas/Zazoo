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
  ModulePlaybookBinding,
  ModuleCapabilityNeed,
  ModulePageBinding,
  ModuleDatabaseBinding,
  ModuleDatabaseSections,
  ModuleSubModuleBinding,
  ModuleSurfaceManifest,
  ModuleDependency,
  ModuleKind,
  ModuleManifest,
  ModuleOrganizationVocab,
  ModuleGovernancePolicy,
  ModuleGovernanceRule,
} from "./types.js";
import type { CapabilityExecutionSpec, CapabilityManifest, SandboxIsolationLevel } from "../capability/types.js";
import {
  BLUEPRINT_FIELD_KINDS,
  BLUEPRINT_ROLLUP_FUNCTIONS,
  parseOrganizationBlueprint,
  type BlueprintColumnKind,
  type BlueprintColumnSpec,
} from "../blueprint.js";
import { parseAutomationTrigger } from "../automation-trigger.js";

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

/**
 * The column fields a manifest could always DECLARE and the parser silently
 * dropped (TASK-108): a Skill-computed column's `skill_id`, a default, the
 * relation's parent side, a Form-hidden column, the description, a status
 * column's lifecycle groups, a rollup's three parts and a button's Action.
 *
 * `apps/api/src/table-schema.ts` has copied several of these onto the rendered
 * TableSpec since it was written — they were dead branches only because
 * nothing here ever put them on the binding.
 *
 * Each is accepted only where the KIND declares it: `status_groups` on a text
 * column is a manifest that means something it cannot do, and ADR-247 says say
 * so rather than storing it.
 */
function parseColumnExtras(
  column: Record<string, unknown>,
  kind: BlueprintColumnKind,
  where: string,
): Partial<BlueprintColumnSpec> {
  const extras: Record<string, unknown> = {};

  const skillId = column.skillId ?? column.skill_id;
  if (skillId !== undefined) {
    if (kind !== "skill") fail(`${where}.skill_id is only meaningful on a skill column`);
    extras.skillId = requiredString(skillId, `${where}.skill_id`);
  }

  if (column.defaultValue !== undefined || column.default_value !== undefined) {
    const raw = column.defaultValue ?? column.default_value;
    const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
    if (!scalar(raw) && !(Array.isArray(raw) && raw.every((v) => scalar(v) && v !== null))) {
      fail(`${where}.default_value must be a string, number, boolean, null, or an array of those`);
    }
    extras.defaultValue = raw;
  }

  const relationParent = column.relationParent ?? column.relation_parent;
  if (relationParent !== undefined) {
    if (typeof relationParent !== "boolean") fail(`${where}.relation_parent must be a boolean`);
    if (kind !== "relation") fail(`${where}.relation_parent is only meaningful on a relation column`);
    if (relationParent) extras.relationParent = true;
  }

  const hiddenInForm = column.hiddenInForm ?? column.hidden_in_form;
  if (hiddenInForm !== undefined) {
    if (typeof hiddenInForm !== "boolean") fail(`${where}.hidden_in_form must be a boolean`);
    if (hiddenInForm) extras.hiddenInForm = true;
  }

  if (column.description !== undefined) {
    extras.description = requiredString(column.description, `${where}.description`);
  }

  const statusGroups = column.statusGroups ?? column.status_groups;
  if (statusGroups !== undefined) {
    if (kind !== "status") fail(`${where}.status_groups is only meaningful on a status column`);
    if (!isPlainObject(statusGroups)) fail(`${where}.status_groups must be an object`);
    const declared = new Set((column.options as string[] | undefined) ?? []);
    const groups: Record<string, "todo" | "doing" | "done"> = {};
    for (const [option, group] of Object.entries(statusGroups)) {
      if (declared.size > 0 && !declared.has(option)) {
        fail(`${where}.status_groups names ${option}, which is not one of its options`);
      }
      if (group !== "todo" && group !== "doing" && group !== "done") {
        fail(`${where}.status_groups.${option} must be todo, doing or done`);
      }
      groups[option] = group;
    }
    extras.statusGroups = groups;
  }

  const rollupSource = column.rollupSource ?? column.rollup_source;
  const rollupProperty = column.rollupProperty ?? column.rollup_property;
  const rollupFunction = column.rollupFunction ?? column.rollup_function;
  if (rollupSource !== undefined || rollupProperty !== undefined || rollupFunction !== undefined) {
    if (kind !== "rollup") fail(`${where} declares rollup_* but is not a rollup column`);
    extras.rollupSource = requiredString(rollupSource, `${where}.rollup_source`);
    extras.rollupProperty = requiredString(rollupProperty, `${where}.rollup_property`);
    const fn = requiredString(rollupFunction, `${where}.rollup_function`);
    if (!(BLUEPRINT_ROLLUP_FUNCTIONS as readonly string[]).includes(fn)) {
      fail(`${where}.rollup_function must be one of ${BLUEPRINT_ROLLUP_FUNCTIONS.join(", ")}`);
    }
    extras.rollupFunction = fn;
  } else if (kind === "rollup") {
    // A rollup with nothing to roll up computes nothing, and an empty cell
    // reads exactly like a real answer of zero.
    fail(`${where} is a rollup and must declare rollup_source, rollup_property and rollup_function`);
  }

  const actionId = column.actionId ?? column.action_id;
  if (actionId !== undefined) {
    if (kind !== "button") fail(`${where}.action_id is only meaningful on a button column`);
    extras.actionId = requiredString(actionId, `${where}.action_id`);
  } else if (kind === "button") {
    fail(`${where} is a button and must declare the action_id it runs`);
  }

  return extras as Partial<BlueprintColumnSpec>;
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
    if (capabilityById.get(binding.capabilityId)?.capabilityType !== "database") {
      fail(`module.module.pages[${index}].capability_id must reference a database capability`);
    }
    return binding;
  });

  // Declared Databases (ADR 2026-09-04). A Builder-built Module has no code
  // to hand the shell a TableSpec, so the manifest carries the columns and the
  // standard Module Page renders from them. Optional: a built-in whose spec is
  // code declares none. When present, every Page's database_id must resolve
  // here — a Page pointing at a Database nobody declared has nothing to show.
  const databasesRaw = raw.databases ?? [];
  if (!Array.isArray(databasesRaw)) fail("module.module.databases must be an array");
  const databases: ModuleDatabaseBinding[] = databasesRaw.map((database, index) => {
    if (!isPlainObject(database)) fail(`module.module.databases[${index}] must be an object`);
    const id = requiredString(database.id, `module.module.databases[${index}].id`);
    if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(id)) {
      fail(`module.module.databases[${index}].id must be kebab-case`);
    }
    const columnsRaw = database.columns;
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) {
      fail(`module.module.databases[${index}].columns must be a non-empty array`);
    }
    const seen = new Set<string>();
    const columns: BlueprintColumnSpec[] = columnsRaw.map((column, columnIndex) => {
      const where = `module.module.databases[${index}].columns[${columnIndex}]`;
      if (!isPlainObject(column)) fail(`${where} must be an object`);
      const columnId = requiredString(column.id, `${where}.id`);
      if (seen.has(columnId)) fail(`${where}.id duplicates ${columnId}`);
      seen.add(columnId);
      const kind = requiredString(column.kind, `${where}.kind`);
      if (!(BLUEPRINT_FIELD_KINDS as readonly string[]).includes(kind)) {
        fail(`${where}.kind must be one of ${BLUEPRINT_FIELD_KINDS.join(", ")}`);
      }
      const options = column.options;
      if (options !== undefined && (!Array.isArray(options) || options.some((o) => typeof o !== "string"))) {
        fail(`${where}.options must be an array of strings`);
      }
      return {
        id: columnId,
        label: requiredString(column.label, `${where}.label`),
        kind: kind as BlueprintColumnKind,
        ...(options !== undefined ? { options: options as string[] } : {}),
        ...(column.required === true ? { required: true } : {}),
        ...(typeof column.relationTarget === "string" ? { relationTarget: column.relationTarget } : {}),
        ...(typeof column.relation_target === "string" ? { relationTarget: column.relation_target } : {}),
        ...parseColumnExtras(column, kind as BlueprintColumnKind, where),
      };
    });
    // Sections per DATABASE (UI Rulebook Part IV §1). Absent = all on: Notes
    // and Governance are mandatory by default; the owner switches them off
    // per Database, and a manifest may pre-set that choice, never a Record's.
    const sectionsRaw = database.sections ?? {};
    if (!isPlainObject(sectionsRaw)) fail(`module.module.databases[${index}].sections must be an object`);
    const sections: ModuleDatabaseSections = { notes: true, intelligence: true, governance: true };
    for (const section of ["notes", "intelligence", "governance"] as const) {
      const value = sectionsRaw[section];
      if (value === undefined) continue;
      if (typeof value !== "boolean") fail(`module.module.databases[${index}].sections.${section} must be a boolean`);
      sections[section] = value;
    }
    return { id, name: requiredString(database.name, `module.module.databases[${index}].name`), columns, sections };
  });
  if (databases.length > 0) {
    const declared = new Set(databases.map((database) => database.id));
    for (const [index, page] of pages.entries()) {
      if (!declared.has(page.databaseId)) {
        fail(`module.module.pages[${index}].database_id ${page.databaseId} is not a declared database`);
      }
    }
  }

  // Sub-modules (UI Rulebook §2 rule 3, TASK-100): collapsible nav children
  // that group this Module's own Pages. Every listed Page must be declared
  // above and may belong to ONE sub-module — a Page under two children would
  // light two rail rows for one surface. Unlisted Pages are the root's.
  const subModulesRaw = raw.subModules ?? raw.sub_modules ?? [];
  if (!Array.isArray(subModulesRaw)) fail("module.module.sub_modules must be an array");
  const pageIds = new Set(pages.map((page) => page.id));
  const pageOwner = new Map<string, string>();
  const subModuleIds = new Set<string>();
  const subModules: ModuleSubModuleBinding[] = subModulesRaw.map((sub, index) => {
    if (!isPlainObject(sub)) fail(`module.module.sub_modules[${index}] must be an object`);
    const id = requiredString(sub.id, `module.module.sub_modules[${index}].id`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(`module.module.sub_modules[${index}].id must be kebab-case`);
    if (subModuleIds.has(id)) fail(`module.module.sub_modules[${index}].id duplicates ${id}`);
    subModuleIds.add(id);
    const subPages = parseStringArray(sub.pages, `module.module.sub_modules[${index}].pages`);
    for (const [pageIndex, pageId] of subPages.entries()) {
      if (!pageIds.has(pageId)) {
        fail(`module.module.sub_modules[${index}].pages[${pageIndex}] ${pageId} is not a declared page`);
      }
      const owner = pageOwner.get(pageId);
      if (owner !== undefined) {
        fail(`module.module.sub_modules[${index}].pages[${pageIndex}] ${pageId} already belongs to sub-module ${owner}`);
      }
      pageOwner.set(pageId, id);
    }
    return { id, name: requiredString(sub.name, `module.module.sub_modules[${index}].name`), pages: subPages };
  });

  const agentsRaw = raw.agents ?? [];
  if (!Array.isArray(agentsRaw)) fail("module.module.agents must be an array");
  const agents: ModuleAgentBinding[] = agentsRaw.map((agent, index) => {
    if (!isPlainObject(agent)) fail(`module.module.agents[${index}] must be an object`);
    const plane = agent.plane;
    if (plane !== undefined && plane !== "local" && plane !== "cloud") {
      fail(`module.module.agents[${index}].plane must be local or cloud`);
    }
    const agentRunRoute = agent.runRoute ?? agent.run_route;
    const binding: ModuleAgentBinding = {
      id: requiredString(agent.id, `module.module.agents[${index}].id`),
      name: requiredString(agent.name, `module.module.agents[${index}].name`),
      capabilityId: requiredString(agent.capabilityId ?? agent.capability_id, `module.module.agents[${index}].capability_id`),
      skillIds: parseStringArray(agent.skillIds ?? agent.skill_ids, `module.module.agents[${index}].skill_ids`),
      ...(plane ? { plane } : {}),
      ...(agentRunRoute !== undefined
        ? { runRoute: requiredString(agentRunRoute, `module.module.agents[${index}].run_route`) }
        : {}),
    };
    if (binding.runRoute && !binding.runRoute.startsWith("/")) {
      fail(`module.module.agents[${index}].run_route must start with /`);
    }
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
    // ADR-179: the machine-readable trigger, parsed with the same validator the
    // Automation store uses so a manifest and a stored row cannot disagree
    // about what a schedule means. A malformed schedule FAILS the manifest
    // rather than silently degrading to "never runs".
    const scheduleRaw = automation.schedule;
    const schedule = scheduleRaw === undefined ? undefined : parseAutomationTrigger(scheduleRaw);
    const binding: ModuleAutomationBinding = {
      id: requiredString(automation.id, `module.module.automations[${index}].id`),
      name: requiredString(automation.name, `module.module.automations[${index}].name`),
      capabilityId: requiredString(
        automation.capabilityId ?? automation.capability_id,
        `module.module.automations[${index}].capability_id`,
      ),
      agentId: requiredString(automation.agentId ?? automation.agent_id, `module.module.automations[${index}].agent_id`),
      trigger: requiredString(automation.trigger, `module.module.automations[${index}].trigger`),
      ...(schedule !== undefined ? { schedule } : {}),
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

  // TM6 (ADR-206) — versioned methodologies the Module ships. Each names the
  // Skill capabilities it may run, and those must be Skills the Module
  // actually declares: a Playbook pointing at a Skill that is not here would
  // let a fresh install run a methodology whose Skills never arrived.
  const playbooksRaw = raw.playbooks ?? [];
  if (!Array.isArray(playbooksRaw)) fail("module.module.playbooks must be an array");
  const playbooks: ModulePlaybookBinding[] = playbooksRaw.map((playbook, index) => {
    if (!isPlainObject(playbook)) fail(`module.module.playbooks[${index}] must be an object`);
    const skillCapabilityIds = parseStringArray(
      playbook.skillCapabilityIds ?? playbook.skill_capability_ids,
      `module.module.playbooks[${index}].skill_capability_ids`,
    );
    if (skillCapabilityIds.length === 0) {
      // A Playbook that may run nothing is a description, not a methodology.
      fail(`module.module.playbooks[${index}].skill_capability_ids must contain at least one Skill`);
    }
    for (const capabilityId of skillCapabilityIds) {
      if (capabilityById.get(capabilityId)?.capabilityType !== "skill") {
        fail(`module.module.playbooks[${index}].skill_capability_ids must reference declared Skill capabilities`);
      }
    }
    return {
      id: requiredString(playbook.id, `module.module.playbooks[${index}].id`),
      methodology: requiredString(playbook.methodology, `module.module.playbooks[${index}].methodology`),
      version: assertSemver(playbook.version, `module.module.playbooks[${index}].version`),
      intent: requiredString(playbook.intent, `module.module.playbooks[${index}].intent`),
      skillCapabilityIds,
    };
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
    ...(databases.length > 0 ? { databases } : {}),
    ...(subModules.length > 0 ? { subModules } : {}),
    agents,
    automations,
    ...(playbooks.length > 0 ? { playbooks } : {}),
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
  const authoredDatabases = parseAuthoredDatabases(
    manifestRoot.authoredDatabases ?? manifestRoot.authored_databases,
  );
  const blueprint = manifestRoot.blueprint !== undefined
    ? parseOrganizationBlueprint(manifestRoot.blueprint)
    : undefined;
  const isBlueprintModule = kind === "organization_definition" && blueprint !== undefined;

  const governance = parseGovernance(manifestRoot.governance);

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

  // A relation names the Database it points at the way `moduleRecords` serves
  // rows for it: `<module>.<database>`, or a bare `<database>` in this Module.
  // Only the SAME-manifest half is answerable here — a target in another
  // Module is checked at registration, where the installed manifests can be
  // read (`relationTargetsMissingFrom` in apps/api). Until TASK-108 nothing
  // checked either half, so a relation to a Database nobody declared parsed
  // fine and rendered a chooser over nothing.
  const selfName: string = name;
  for (const database of module?.databases ?? []) {
    for (const column of database.columns) {
      const target = column.relationTarget;
      if (!target) continue;
      const dot = target.indexOf(".");
      const targetModule: string = dot < 0 ? selfName : target.slice(0, dot);
      const targetDatabase = dot < 0 ? target : target.slice(dot + 1);
      if (targetModule !== selfName) continue;
      if (!(module?.databases ?? []).some((candidate) => candidate.id === targetDatabase)) {
        fail(
          `module.module.databases ${database.id}.${column.id} relates to ${target}, which this Module does not declare`,
        );
      }
    }
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
    ...(authoredDatabases ? { authoredDatabases } : {}),
    ...(governance ? { governance } : {}),
  };
}

/**
 * `authored_databases` — the declared column shape of a Module the owner
 * authored. Absent for every built-in and Commons Module.
 *
 * Validated here for the same reason every other field is: this is what the
 * Module's storage gets built from after approval, so a malformed payload must
 * fail at the seam rather than install a Database whose columns are silently
 * empty. Shape only — `parseAuthoredModuleSpec` owns the semantic rules (which
 * kinds are authorable, option lists, caps), and it runs BEFORE a manifest is
 * ever projected.
 */
function parseAuthoredDatabases(raw: unknown): NonNullable<ModuleManifest["authoredDatabases"]> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) fail("module.authored_databases must be an array when present");
  return raw.map((entry, index) => {
    if (!isPlainObject(entry)) fail(`module.authored_databases[${index}] must be an object`);
    const id = entry.id;
    const label = entry.label;
    if (typeof id !== "string" || id.length === 0) {
      fail(`module.authored_databases[${index}].id must be a non-empty string`);
    }
    if (typeof label !== "string" || label.length === 0) {
      fail(`module.authored_databases[${index}].label must be a non-empty string`);
    }
    const columnsRaw = entry.columns;
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) {
      fail(`module.authored_databases[${index}].columns must be a non-empty array`);
    }
    const columns = columnsRaw.map((column, columnIndex) => {
      const at = `module.authored_databases[${index}].columns[${columnIndex}]`;
      if (!isPlainObject(column)) fail(`${at} must be an object`);
      const columnId = column.id;
      const columnLabel = column.label;
      const columnKind = column.kind;
      if (typeof columnId !== "string" || columnId.length === 0) fail(`${at}.id must be a non-empty string`);
      if (typeof columnLabel !== "string" || columnLabel.length === 0) fail(`${at}.label must be a non-empty string`);
      if (typeof columnKind !== "string" || columnKind.length === 0) fail(`${at}.kind must be a non-empty string`);
      const options = column.options === undefined
        ? undefined
        : parseStringArray(column.options, `${at}.options`);
      if (column.required !== undefined && typeof column.required !== "boolean") {
        fail(`${at}.required must be a boolean when present`);
      }
      return {
        id: columnId as string,
        label: columnLabel as string,
        kind: columnKind as string,
        ...(options ? { options } : {}),
        ...(column.required !== undefined ? { required: column.required as boolean } : {}),
      };
    });
    return { id: id as string, label: label as string, columns };
  });
}

/**
 * Per-Module governance policy (ADR-248). Absent is legal and means "nothing
 * declared"; present-but-malformed is not, and fails loudly here for the same
 * reason every other field does — a corrupt policy must never install as if it
 * were empty, because "empty" is the permissive state.
 */
function parseGovernance(raw: unknown): ModuleGovernancePolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) fail("module.governance must be an object");

  const rules = (value: unknown, field: string): ModuleGovernanceRule[] => {
    const list = value ?? [];
    if (!Array.isArray(list)) fail(`module.governance.${field} must be an array`);
    return list.map((entry, i) => {
      if (!isPlainObject(entry)) fail(`module.governance.${field}[${i}] must be an object`);
      const action = entry.action;
      if (typeof action !== "string" || action.length === 0) {
        fail(`module.governance.${field}[${i}].action must be a non-empty string`);
      }
      // A rule that cannot explain itself is a rule the user cannot audit, and
      // the refusal message quotes this text back to them verbatim.
      const reason = entry.reason;
      if (typeof reason !== "string" || reason.length === 0) {
        fail(`module.governance.${field}[${i}].reason must be a non-empty string — a rule must say why`);
      }
      return { action, reason };
    });
  };

  const userEdited = raw.userEdited ?? raw.user_edited;
  if (userEdited !== undefined && typeof userEdited !== "boolean") {
    fail("module.governance.userEdited must be a boolean");
  }

  return {
    allow: rules(raw.allow, "allow"),
    deny: rules(raw.deny, "deny"),
    ...(typeof userEdited === "boolean" ? { userEdited } : {}),
  };
}
