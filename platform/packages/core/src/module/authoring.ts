/**
 * Authored Module format — the pure shape guard behind "Chief of Staff, build
 * me a Module" (the capability the Chat surface could never reach: its
 * envelope had three kinds, none of which could name a Module).
 *
 * DOCTRINE: an authored Module is DATA, never generated code. `blueprint.ts`'s
 * View grammar already fixes this — "Generation = configurations of REGISTERED
 * components only, never new components" — and `registry.ts` enforces it at
 * render time. So this module produces a `ModuleManifest` describing Databases
 * and the Pages over them, and NOTHING that would need an implementation to
 * exist before it could run. That is why:
 *
 *   - `kind` is always "module" and `capabilities[]` carries only
 *     `capability_type: "database"` rows. No Skill, Agent or Automation is
 *     ever authored here. A declared Skill with no implementation behind it is
 *     precisely the "declared, not built" gap `modules/manifests` documents at
 *     length (TM3/TM4, ADR-198) — an authored Module must not be able to
 *     manufacture one.
 *   - `relation`, `formula` and `skill` column kinds are REFUSED
 *     ({@link AUTHORABLE_COLUMN_KINDS}). Each needs something outside the
 *     manifest to mean anything: a resolvable target Database, an expression
 *     evaluator, a governed Skill id. Admitting them would render a column
 *     that silently never computes.
 *   - permissions are `record` read/write at `private` scope with no egress.
 *     An authored Module cannot widen its own authority, so nothing it
 *     declares can reach the network or another owner's data.
 *
 * Pure and zero-dependency, same discipline as `manifest.ts`: callers hand in
 * an already-parsed plain object and get a typed `AuthoredModuleValidationError`
 * loudly on anything malformed, so a bad draft is refused at the seam rather
 * than installed as an empty shell.
 */
import type { CapabilityManifest } from "../capability/types.js";
import type { ModuleManifest, ModulePageBinding } from "./types.js";

/**
 * The column kinds an authored Module may use: `BLUEPRINT_FIELD_KINDS` minus
 * the three that are only meaningful with machinery outside the manifest.
 * Deliberately a separate list rather than a filter over the blueprint's,
 * so widening it is an explicit edit with this comment in view.
 */
export const AUTHORABLE_COLUMN_KINDS = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "url",
  "location",
] as const;
export type AuthoredColumnKind = (typeof AUTHORABLE_COLUMN_KINDS)[number];

/** Kinds a caller may ask for and this module refuses, named so the refusal
 * can say WHY rather than "unknown kind". */
const UNAUTHORABLE_COLUMN_REASONS: Record<string, string> = {
  relation: "a relation needs a target Database that exists and is governed; author the Databases first",
  formula: "a formula needs an expression evaluator this format does not carry",
  skill: "a skill column needs a governed Skill implementation behind it, which an authored Module cannot create",
};

/** Bounds. A Module a person described in one sentence does not have 40
 * Databases; these caps keep a malformed or adversarial draft from installing
 * something unreviewable. */
export const AUTHORED_MODULE_LIMITS = {
  databases: 6,
  columnsPerDatabase: 24,
  selectOptions: 40,
} as const;

/** kebab-case, the module-registry convention (`name` in every built-in
 * manifest). Anchored, no leading/trailing/double hyphen. */
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class AuthoredModuleValidationError extends Error {
  constructor(reason: string) {
    super(`authored module invalid: ${reason}`);
    this.name = "AuthoredModuleValidationError";
  }
}

function fail(reason: string): never {
  throw new AuthoredModuleValidationError(reason);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function boundedString(raw: unknown, field: string, max: number): string {
  if (typeof raw !== "string") fail(`${field} must be a string`);
  const trimmed = (raw as string).trim();
  if (trimmed.length === 0) fail(`${field} must not be empty`);
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`);
  return trimmed;
}

export interface AuthoredColumnSpec {
  id: string;
  label: string;
  kind: AuthoredColumnKind;
  /** Required and non-empty for select/multiselect; refused for every other kind. */
  options?: string[];
  required?: boolean;
}

export interface AuthoredDatabaseSpec {
  id: string;
  label: string;
  columns: AuthoredColumnSpec[];
}

export interface AuthoredModuleSpec {
  /** kebab-case; unique against the caller-supplied reserved list. */
  name: string;
  displayName: string;
  summary: string;
  description: string;
  databases: AuthoredDatabaseSpec[];
}

function parseColumn(raw: unknown, dbId: string, index: number): AuthoredColumnSpec {
  const at = `databases[${dbId}].columns[${index}]`;
  if (!isPlainObject(raw)) fail(`${at} must be an object`);
  const id = boundedString(raw.id, `${at}.id`, 60);
  if (!KEBAB_RE.test(id)) fail(`${at}.id must be kebab-case, got ${JSON.stringify(id)}`);
  const label = boundedString(raw.label, `${at}.label`, 120);
  const kind = raw.kind;
  if (typeof kind !== "string") fail(`${at}.kind must be a string`);
  const refusal = UNAUTHORABLE_COLUMN_REASONS[kind];
  if (refusal) fail(`${at}.kind "${kind}" cannot be authored: ${refusal}`);
  if (!AUTHORABLE_COLUMN_KINDS.includes(kind as AuthoredColumnKind)) {
    fail(`${at}.kind must be one of ${AUTHORABLE_COLUMN_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  }
  const needsOptions = kind === "select" || kind === "multiselect";
  // An EMPTY options array reads as "no options given", not as an error. The
  // provider's strict JSON-schema mode admits no optional properties, so a
  // model describing a text column has no way to omit the key and sends `[]`.
  // Refusing that would make the format reject its own wire shape. A NON-empty
  // list on a kind that cannot use it is still a real mistake and still fails.
  const rawOptions = Array.isArray(raw.options) && raw.options.length === 0
    ? undefined
    : raw.options;
  if (!needsOptions && rawOptions !== undefined) {
    fail(`${at}.options is only meaningful for select/multiselect, not "${kind}"`);
  }
  let options: string[] | undefined;
  if (needsOptions) {
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      fail(`${at}.options must be a non-empty array for kind "${kind}"`);
    }
    if ((rawOptions as unknown[]).length > AUTHORED_MODULE_LIMITS.selectOptions) {
      fail(`${at}.options must hold at most ${AUTHORED_MODULE_LIMITS.selectOptions} entries`);
    }
    options = (rawOptions as unknown[]).map((option, optionIndex) =>
      boundedString(option, `${at}.options[${optionIndex}]`, 120),
    );
    if (new Set(options).size !== options.length) fail(`${at}.options must be unique`);
  }
  const required = raw.required;
  if (required !== undefined && typeof required !== "boolean") {
    fail(`${at}.required must be a boolean when present`);
  }
  return {
    id,
    label,
    kind: kind as AuthoredColumnKind,
    ...(options ? { options } : {}),
    ...(required !== undefined ? { required: required as boolean } : {}),
  };
}

function parseDatabase(raw: unknown, index: number): AuthoredDatabaseSpec {
  if (!isPlainObject(raw)) fail(`databases[${index}] must be an object`);
  const id = boundedString(raw.id, `databases[${index}].id`, 60);
  if (!KEBAB_RE.test(id)) fail(`databases[${index}].id must be kebab-case, got ${JSON.stringify(id)}`);
  const label = boundedString(raw.label, `databases[${index}].label`, 120);
  const rawColumns = raw.columns;
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    fail(`databases[${id}].columns must be a non-empty array — a Database with no columns holds nothing`);
  }
  if (rawColumns.length > AUTHORED_MODULE_LIMITS.columnsPerDatabase) {
    fail(`databases[${id}].columns must hold at most ${AUTHORED_MODULE_LIMITS.columnsPerDatabase} columns`);
  }
  const columns = rawColumns.map((column, columnIndex) => parseColumn(column, id, columnIndex));
  const ids = columns.map((column) => column.id);
  if (new Set(ids).size !== ids.length) fail(`databases[${id}].columns[].id must be unique within the Database`);
  return { id, label, columns };
}

/**
 * Validate an authored Module draft. `reservedNames` is the caller's registry
 * of names already taken (built-in Modules plus whatever this Organization has
 * installed) — passed IN rather than imported, keeping this function pure and
 * mirroring how `compileBlueprint` takes its node-type registry as a param.
 */
export function parseAuthoredModuleSpec(
  raw: unknown,
  reservedNames: readonly string[] = [],
): AuthoredModuleSpec {
  if (!isPlainObject(raw)) fail("spec must be an object");
  const name = boundedString(raw.name, "name", 60);
  if (!KEBAB_RE.test(name)) fail(`name must be kebab-case, got ${JSON.stringify(name)}`);
  if (reservedNames.includes(name)) {
    fail(`name "${name}" is already taken by an installed Module — choose another name`);
  }
  const displayName = boundedString(raw.displayName, "displayName", 60);
  const summary = boundedString(raw.summary, "summary", 200);
  const description = boundedString(raw.description, "description", 1024);
  const rawDatabases = raw.databases;
  if (!Array.isArray(rawDatabases) || rawDatabases.length === 0) {
    fail("databases must be a non-empty array — a Module with no Database has nothing to show");
  }
  if (rawDatabases.length > AUTHORED_MODULE_LIMITS.databases) {
    fail(`databases must hold at most ${AUTHORED_MODULE_LIMITS.databases} entries`);
  }
  const databases = rawDatabases.map((database, index) => parseDatabase(database, index));
  const ids = databases.map((database) => database.id);
  if (new Set(ids).size !== ids.length) fail("databases[].id must be unique within the Module");
  return { name, displayName, summary, description, databases };
}

/**
 * Narrow a manifest's stored `authoredDatabases[].columns` back to
 * `AuthoredColumnSpec[]`.
 *
 * `parseModuleManifest` only shape-checks that list (id/label/kind are
 * strings), because the semantic rules live here. So a manifest could in
 * principle carry a `kind` this format refuses — a tampered row, or one
 * written by an older build. Re-running the same per-column parser is what
 * makes reading it back safe; casting would let exactly the column kinds this
 * module exists to refuse through the back door.
 */
export function parseAuthoredColumns(raw: unknown, databaseId = "stored"): AuthoredColumnSpec[] {
  if (!Array.isArray(raw)) fail(`databases[${databaseId}].columns must be an array`);
  return raw.map((column, index) => parseColumn(column, databaseId, index));
}

/** The capability id a Database inside an authored Module is governed under. */
export function authoredDatabaseCapabilityId(moduleName: string, databaseId: string): string {
  return `${moduleName}.${databaseId}`;
}

/** Where an authored Module's Page lives. Same `/module/<name>/<page>` shape
 * the built-in sub-modules use, so the existing nav and Module Detail resolve
 * it with no special case. */
export function authoredModuleRoute(moduleName: string, databaseId?: string): string {
  return databaseId ? `/module/${moduleName}/${databaseId}` : `/module/${moduleName}`;
}

/**
 * Project a validated spec into the `ModuleManifest` the module store installs.
 * Pure: the SAME spec always yields the same manifest, so a proposal's
 * reviewed payload and the manifest that gets installed cannot drift.
 *
 * `version` is always "0.1.0" for a freshly authored Module — a version bump
 * is a re-author through the same governed proposal, never an in-place edit.
 */
export function authoredModuleToManifest(spec: AuthoredModuleSpec): ModuleManifest {
  const capabilities: CapabilityManifest[] = spec.databases.map((database) => ({
    id: authoredDatabaseCapabilityId(spec.name, database.id),
    name: `${database.label} database and views`,
    version: "0.1.0",
    capabilityType: "database",
    // Drafted by a model from the owner's request, then approved by the
    // owner — never "built_in" (which would claim it shipped with Bridge) and
    // never "user_code" (nothing here is code). `ai_generated` is the origin
    // the Capability Trust Model already reserves for exactly this path, and
    // it is what the risk/approval bands key on.
    origin: "ai_generated",
    audience: "private",
    permissions: [
      { resourceType: "record", action: "read", dataScope: "private", egress: false },
      { resourceType: "record", action: "write", dataScope: "private", egress: false },
    ],
    connectors: [],
    dependencies: [],
  }));
  const pages: ModulePageBinding[] = spec.databases.map((database) => ({
    id: database.id,
    name: database.label,
    route: authoredModuleRoute(spec.name, database.id),
    databaseId: authoredDatabaseCapabilityId(spec.name, database.id),
    capabilityId: authoredDatabaseCapabilityId(spec.name, database.id),
  }));
  return {
    name: spec.name,
    version: "0.1.0",
    kind: "module",
    summary: spec.summary,
    description: spec.description,
    lineageManifestId: null,
    dependencies: [],
    capabilities,
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    // The reviewed artifact carries the column shape its storage is built
    // from — see ModuleManifest.authoredDatabases.
    authoredDatabases: spec.databases.map((database) => ({
      id: database.id,
      label: database.label,
      columns: database.columns.map((column) => ({
        id: column.id,
        label: column.label,
        kind: column.kind as string,
        ...(column.options ? { options: [...column.options] } : {}),
        ...(column.required !== undefined ? { required: column.required } : {}),
      })),
    })),
    module: {
      displayName: spec.displayName,
      route: authoredModuleRoute(spec.name, spec.databases[0]!.id),
      pages,
      // An authored Module ships no Agents and no Automations, by construction
      // — see this file's header. These stay empty rather than absent so
      // Module Detail renders an honest "none" instead of a missing section.
      agents: [],
      automations: [],
    },
  };
}

/**
 * Cell values for one authored Record, keyed by {@link AuthoredColumnSpec.id}.
 * `null` is a deliberately empty cell — distinct from an absent key, which is
 * a cell that was never set. Both are honest; neither is a fabricated value.
 */
export type AuthoredRecordProperties = Record<string, string | number | boolean | string[] | null>;

export class AuthoredRecordValidationError extends Error {
  constructor(reason: string) {
    super(`authored record invalid: ${reason}`);
    this.name = "AuthoredRecordValidationError";
  }
}

function rejectRecord(reason: string): never {
  throw new AuthoredRecordValidationError(reason);
}

/** ISO calendar date (YYYY-MM-DD) or a full ISO timestamp. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

function isEmptyCell(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Validate and normalize one Record against its Database's DECLARED columns.
 *
 * Postgres cannot type-check a cell inside a jsonb column, so this is the only
 * place an authored Database's shape is actually enforced — it runs at the API
 * seam before every write. It is strict in both directions: an unknown key is
 * refused (never silently dropped, which would lose a person's typing without
 * telling them) and a declared-required cell must be present.
 *
 * Pure. Returns a NEW object containing only declared keys, in declared order.
 */
export function validateAuthoredRecord(
  columns: readonly AuthoredColumnSpec[],
  raw: unknown,
): AuthoredRecordProperties {
  if (!isPlainObject(raw)) rejectRecord("properties must be an object");
  const declared = new Map(columns.map((column) => [column.id, column]));
  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) {
      rejectRecord(`"${key}" is not a column of this Database`);
    }
  }
  const out: AuthoredRecordProperties = {};
  for (const column of columns) {
    const present = Object.prototype.hasOwnProperty.call(raw, column.id);
    const value = (raw as Record<string, unknown>)[column.id];
    if (!present || isEmptyCell(value)) {
      if (column.required) rejectRecord(`"${column.label}" is required`);
      if (present) out[column.id] = null;
      continue;
    }
    switch (column.kind) {
      case "text":
      case "url":
      case "location": {
        if (typeof value !== "string") rejectRecord(`"${column.label}" must be text`);
        out[column.id] = (value as string).trim();
        break;
      }
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          rejectRecord(`"${column.label}" must be a finite number`);
        }
        out[column.id] = value as number;
        break;
      }
      case "checkbox": {
        if (typeof value !== "boolean") rejectRecord(`"${column.label}" must be true or false`);
        out[column.id] = value as boolean;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
          rejectRecord(`"${column.label}" must be an ISO date (YYYY-MM-DD)`);
        }
        out[column.id] = value as string;
        break;
      }
      case "select": {
        if (typeof value !== "string" || !column.options?.includes(value)) {
          rejectRecord(`"${column.label}" must be one of ${(column.options ?? []).join(", ")}`);
        }
        out[column.id] = value as string;
        break;
      }
      case "multiselect": {
        if (!Array.isArray(value)) rejectRecord(`"${column.label}" must be a list`);
        const chosen = value as unknown[];
        for (const entry of chosen) {
          if (typeof entry !== "string" || !column.options?.includes(entry)) {
            rejectRecord(`"${column.label}" must only contain ${(column.options ?? []).join(", ")}`);
          }
        }
        if (new Set(chosen as string[]).size !== chosen.length) {
          rejectRecord(`"${column.label}" must not repeat a choice`);
        }
        out[column.id] = [...(chosen as string[])];
        break;
      }
    }
  }
  return out;
}
