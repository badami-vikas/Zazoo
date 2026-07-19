/**
 * Blueprint -> view grammar compiler (docs/wiki/vision.md "View grammar" +
 * docs/wiki/roadmap.md P1 "Workspace Generator"). Pure, zero-deps — mirrors
 * capability/risk.ts's shape (a plain function over plain data, no store, no
 * I/O) so it can run identically in apps/api (server-side compile-on-activate)
 * and apps/web (client-side compile-on-fetch, per the P1 spec).
 *
 * A WorkspaceBlueprint is the compiled workspace_definitions.blueprint jsonb
 * payload (packages/db/src/schema.ts) — a PROPOSED, governed artifact (Capability
 * Lifecycle Platform: blueprint changes go through workspace.blueprint.propose /
 * .activate, never applied directly). compileBlueprint() is the grammar
 * ENFORCEMENT layer: it is the only path from "a blueprint" to "a CompiledWorkspace
 * a <DataViews> shell can render," and it rejects anything outside the registered
 * grammar rather than silently passing it through.
 *
 * Grammar (docs/raw/brd-dataengine-views-2026-07.md):
 *   - one registered data-view set: table/board/gallery/form/calendar/map/graph/tree.
 *     This compiler handles those @bridge/tables-backed views; chatbot/dashboard/canvas
 *     views are the frontend's ViewComponentRegistry's problem, not this compiler's;
 *     a blueprint view of kind "dashboard" compiles through unchanged (no TableSpec
 *     needed) so the frontend registry can still render it.
 *   - Generation = configurations of REGISTERED components only. An unknown
 *     node type (not present in the caller-provided registry list) or an
 *     unknown view kind is a compile ERROR, never a silently-dropped view.
 *
 * NOTE on types: @bridge/core stays a zero-runtime-dependency package (per its
 * package.json description), so this file does NOT import @bridge/tables —
 * `BlueprintColumnSpec`/`BlueprintTableSpec`/`CompiledViewConfig` below are a
 * deliberate STRUCTURAL MIRROR of @bridge/tables' ColumnSpec/TableSpec/ViewConfig
 * (see packages/tables/src/types.ts). Consumers that already have @bridge/tables
 * (apps/web, apps/api) can pass a CompiledWorkspace's tableSpecs/viewConfigs
 * straight into @bridge/tables' engine/<DataViews> without a cast — the shapes
 * are identical by construction, only the type names differ to avoid the
 * cross-package dependency.
 */
import type { PackageManifest } from "./package/types.js";

/** Current WorkspaceBlueprint schema version. Version 2 replaces the persisted
 * view aliases `kanban`/`network` with the canonical `board`/`graph` kinds and
 * adds Form/Tree plus source-column metadata. Version-1 payloads remain readable
 * through parseWorkspaceBlueprint's explicit migration. Bumped on a
 * breaking change to the blueprint grammar; `parseWorkspaceBlueprint` stamps it
 * when absent and rejects a version it does not understand, so a Commons-
 * published blueprint carries the grammar version it was authored against. */
export const BLUEPRINT_SCHEMA_VERSION = 2 as const;
const LEGACY_BLUEPRINT_SCHEMA_VERSION = 1 as const;

/** Structural mirror of @bridge/tables' ColumnKind. */
export type BlueprintColumnKind =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url"
  | "relation"
  | "formula"
  | "tool"
  | "location";
export type BlueprintDefaultValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>;

/** Structural mirror of @bridge/tables' ColumnSpec. */
export interface BlueprintColumnSpec {
  id: string;
  label: string;
  kind: BlueprintColumnKind;
  options?: string[];
  toolId?: string;
  required?: boolean;
  defaultValue?: BlueprintDefaultValue;
  relationTarget?: string;
  relationParent?: boolean;
  hiddenInForm?: boolean;
}

/** Structural mirror of @bridge/tables' TableSpec. */
export interface BlueprintTableSpec {
  id: string;
  columns: BlueprintColumnSpec[];
}

export type BlueprintSortSpec = { id: string; dir: "asc" | "desc" };
export type BlueprintFilterOp = "contains" | "is" | "is_not" | "is_empty" | "is_not_empty" | "starts_with";
export type BlueprintRowFilter = { field: string; op: BlueprintFilterOp; value: string };

/** View kinds this compiler understands as @bridge/tables-backed data views —
 * a structural mirror of @bridge/tables' ViewConfig["kind"]. Kept separate from
 * the blueprint's own view surface (chatbot/dashboard/canvas) so those can be
 * layered on top without @bridge/tables ever needing to know about them. */
export type DataViewKind =
  | "table"
  | "board"
  | "gallery"
  | "form"
  | "calendar"
  | "map"
  | "graph"
  | "tree";
const DATA_VIEW_KINDS: readonly DataViewKind[] = [
  "table",
  "board",
  "gallery",
  "form",
  "calendar",
  "map",
  "graph",
  "tree",
];
type LegacyDataViewKind = "kanban" | "network";

/** The blueprint's full view surface — @bridge/tables' data-view kinds plus the
 * three non-tabular view kinds the vision doc's grammar also allows. */
export type BlueprintViewKind = DataViewKind | "chatbot" | "dashboard" | "canvas";
const BLUEPRINT_VIEW_KINDS: readonly BlueprintViewKind[] = [...DATA_VIEW_KINDS, "chatbot", "dashboard", "canvas"];

export interface BlueprintFieldSpec {
  id: string;
  label: string;
  kind: BlueprintColumnKind;
  options?: string[];
  toolId?: string;
  required?: boolean;
  defaultValue?: BlueprintDefaultValue;
  relationTarget?: string;
  relationParent?: boolean;
  hiddenInForm?: boolean;
}

export interface BlueprintEntitySpec {
  /** The node type this entity projects (must be present in the caller-supplied
   * registry — see compileBlueprint's `registeredNodeTypes` param — or the
   * compile fails: "rejects unknown node types against a provided registry list"). */
  nodeType: string;
  label: string;
  fields: BlueprintFieldSpec[];
}

export interface BlueprintViewSpec {
  entity: string; // BlueprintEntitySpec.nodeType this view renders
  kind: BlueprintViewKind;
  config?: {
    sorts?: BlueprintSortSpec[];
    rowFilters?: BlueprintRowFilter[];
    filterMatch?: "all" | "any";
    groupBy?: string | null;
    dateBy?: string;
    locationBy?: string;
    relationBy?: string;
    parentBy?: string;
    graphScope?: "single_database" | "multi_database" | "full";
    graphDatabaseIds?: string[];
  };
}

/** The governed, versioned artifact stored in workspace_definitions.blueprint. */
export interface WorkspaceBlueprint {
  /** BLUEPRINT-1 grammar version this payload was authored against. Optional on
   * the in-memory type (existing stored blueprints and code-constructed literals
   * predate it) — `parseWorkspaceBlueprint` stamps BLUEPRINT_SCHEMA_VERSION when
   * absent, and `workspaceBlueprintToPackageManifest` always sets it, so every
   * Commons-published blueprint carries an explicit version. */
  schemaVersion?: number;
  /** Kernel-vocab label overrides (e.g. { initiative: "Deal" } for DealPilot) —
   * "vocabulary override applied to labels" (workspace scope, CLAUDE.md's
   * two-scope vocab rule: this is exactly the sanctioned override point). */
  vocabulary: Record<string, string>;
  entities: BlueprintEntitySpec[];
  views: BlueprintViewSpec[];
  /** capability_manifests.id refs this workspace composes (Compose verb, vision.md
   * "Workspaces = projections") — carried through untouched; this compiler does
   * not validate capability ids (that's the CapabilityStore's job, a store lookup
   * this pure function deliberately does not perform). */
  capabilities: string[];
}

export interface NavigationEntry {
  nodeType: string;
  label: string;
  /** Compiled view ids (CompiledViewConfig.id) available for this entity, in blueprint order. */
  viewIds: string[];
}

export interface CompiledWorkspace {
  /** One TableSpec per entity — the @bridge/tables-compatible contract <DataViews> consumes. */
  tableSpecs: BlueprintTableSpec[];
  /** One compiled view config per BlueprintViewSpec (chatbot/dashboard/canvas
   * included — `kind` is the full BlueprintViewKind grammar, wider than
   * @bridge/tables' own ViewConfig["kind"]; the frontend registry is what
   * decides how to render each kind). */
  viewConfigs: CompiledViewConfig[];
  navigation: NavigationEntry[];
}

/** A compiled view — a structural mirror of @bridge/tables' ViewConfig but with
 * `kind` widened to the full BlueprintViewKind grammar (chatbot/dashboard/canvas
 * are valid compiled views; they simply carry no TableSpec) plus the owning
 * entity's node type so the frontend can join a view back to its TableSpec. */
export interface CompiledViewConfig {
  id: string;
  entity: string;
  kind: BlueprintViewKind;
  sorts: BlueprintSortSpec[];
  rowFilters: BlueprintRowFilter[];
  filterMatch: "all" | "any";
  groupBy: string | null;
  dateBy?: string;
  locationBy?: string;
  relationBy?: string;
  parentBy?: string;
  graphScope?: "single_database" | "multi_database" | "full";
  graphDatabaseIds?: string[];
  /** View-convertibility grammar (ADR-023 item 6 / ADR-024): which
   * DataViewKinds this view's owning entity could morph into, computed from
   * the entity's OWN column kinds — not the view's declared `kind`. Always
   * includes table/gallery/form for every table-backed entity; other kinds are
   * admitted strictly from column metadata. Non-tabular views
   * (chatbot/dashboard/canvas) carry an empty array. */
  convertibleKinds: DataViewKind[];
}

export class BlueprintCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintCompileError";
  }
}

function tableSpecId(nodeType: string): string {
  return nodeType;
}

function viewConfigId(entity: string, kind: BlueprintViewKind, index: number): string {
  return `${entity}.${kind}.${index}`;
}

function parentRelationField(entity: BlueprintEntitySpec): BlueprintFieldSpec | undefined {
  return entity.fields.find(
    (field) =>
      field.kind === "relation" &&
      (field.relationParent === true || field.relationTarget === entity.nodeType),
  );
}

function graphRelationField(entity: BlueprintEntitySpec): BlueprintFieldSpec | undefined {
  return entity.fields.find(
    (field) =>
      field.kind === "relation" &&
      field.relationParent !== true &&
      field.relationTarget !== entity.nodeType,
  );
}

/** Canonical View eligibility. Always-on kinds are table/gallery/form; every
 * other kind is admitted only when the entity carries the required metadata. */
function computeConvertibleKinds(entity: BlueprintEntitySpec): DataViewKind[] {
  const kinds: DataViewKind[] = ["table"];
  if (entity.fields.some((field) => field.kind === "select")) kinds.push("board");
  kinds.push("gallery", "form");
  if (entity.fields.some((field) => field.kind === "date")) kinds.push("calendar");
  if (entity.fields.some((field) => field.kind === "location")) kinds.push("map");
  if (graphRelationField(entity)) kinds.push("graph");
  if (parentRelationField(entity)) kinds.push("tree");
  return kinds;
}

/** A board view's default `groupBy` is the entity's own
 * "select"-kind column (its stage/status field) when one exists and the
 * blueprint author didn't already specify one — never overrides an explicit
 * `config.groupBy` (including an explicit `null`, which means "no grouping,
 * intentionally"). Picks the FIRST select-kind field in declaration order;
 * a blueprint with more than one select column should name the intended one
 * explicitly via `config.groupBy`. */
function defaultBoardGroupBy(entity: BlueprintEntitySpec): string | null {
  return entity.fields.find((f) => f.kind === "select")?.id ?? null;
}

function defaultDateBy(entity: BlueprintEntitySpec): string | undefined {
  return entity.fields.find((field) => field.kind === "date")?.id;
}

function defaultLocationBy(entity: BlueprintEntitySpec): string | undefined {
  return entity.fields.find((field) => field.kind === "location")?.id;
}

function validateDriverColumn(
  entity: BlueprintEntitySpec,
  columnId: string | undefined,
  viewKind: DataViewKind,
  predicate: (field: BlueprintFieldSpec) => boolean,
): string | undefined {
  if (columnId === undefined) return undefined;
  const field = entity.fields.find((candidate) => candidate.id === columnId);
  if (!field || !predicate(field)) {
    throw new BlueprintCompileError(
      `blueprint ${viewKind} view for entity "${entity.nodeType}" references ineligible driver column "${columnId}"`,
    );
  }
  return columnId;
}

/**
 * Compile a WorkspaceBlueprint into the grammar-enforced CompiledWorkspace a
 * <DataViews> shell (or any other registered-component consumer) renders from.
 *
 * @param blueprint the proposed/active workspace_definitions.blueprint payload
 * @param registeredNodeTypes the kernel's known node-type registry (universal-
 *   entity was REJECTED per vision.md — node types are an explicit registry, not
 *   an open string). An entity naming a nodeType outside this list is a compile
 *   error: "generation = configs of REGISTERED components only."
 * @param relationshipNodeTypes which of the registered node types are
 *   relationship-shaped (their views are grammar-restricted to graph|table).
 *   Defaults to the single literal "relationship" if omitted.
 */
export function compileBlueprint(
  blueprint: WorkspaceBlueprint,
  registeredNodeTypes: readonly string[],
  _relationshipNodeTypes: readonly string[] = ["relationship"],
): CompiledWorkspace {
  const registered = new Set(registeredNodeTypes);
  const entityByNodeType = new Map<string, BlueprintEntitySpec>();

  for (const entity of blueprint.entities) {
    if (!registered.has(entity.nodeType)) {
      throw new BlueprintCompileError(
        `blueprint entity "${entity.nodeType}" is not a registered node type (registry: ${[...registered].join(", ") || "<empty>"})`,
      );
    }
    if (entityByNodeType.has(entity.nodeType)) {
      throw new BlueprintCompileError(`blueprint declares entity "${entity.nodeType}" more than once`);
    }
    entityByNodeType.set(entity.nodeType, entity);
  }

  const tableSpecs: BlueprintTableSpec[] = blueprint.entities.map((entity) => ({
    id: tableSpecId(entity.nodeType),
    columns: entity.fields.map(
      (f): BlueprintColumnSpec => ({
        id: f.id,
        label: applyVocabulary(f.label, blueprint.vocabulary),
        kind: f.kind,
        ...(f.options ? { options: f.options } : {}),
        ...(f.toolId ? { toolId: f.toolId } : {}),
        ...(f.required !== undefined ? { required: f.required } : {}),
        ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        ...(f.relationTarget ? { relationTarget: f.relationTarget } : {}),
        ...(f.relationParent !== undefined ? { relationParent: f.relationParent } : {}),
        ...(f.hiddenInForm !== undefined ? { hiddenInForm: f.hiddenInForm } : {}),
      }),
    ),
  }));

  const viewConfigs: CompiledViewConfig[] = [];
  const navByEntity = new Map<string, string[]>();

  const viewsByEntityIndex = new Map<string, number>();
  for (const view of blueprint.views) {
    const entity = entityByNodeType.get(view.entity);
    if (!entity) {
      throw new BlueprintCompileError(
        `blueprint view references unknown entity "${view.entity}" (not declared in blueprint.entities)`,
      );
    }
    if (!BLUEPRINT_VIEW_KINDS.includes(view.kind)) {
      throw new BlueprintCompileError(
        `blueprint view kind "${view.kind}" for entity "${view.entity}" is not a registered view kind (registered: ${BLUEPRINT_VIEW_KINDS.join(", ")})`,
      );
    }
    const convertibleKinds = computeConvertibleKinds(entity);
    if (
      DATA_VIEW_KINDS.includes(view.kind as DataViewKind) &&
      !convertibleKinds.includes(view.kind as DataViewKind)
    ) {
      throw new BlueprintCompileError(
        `blueprint view kind "${view.kind}" is not eligible for entity "${view.entity}" from its column metadata (eligible: ${convertibleKinds.join(", ")})`,
      );
    }

    const index = viewsByEntityIndex.get(view.entity) ?? 0;
    viewsByEntityIndex.set(view.entity, index + 1);
    const id = viewConfigId(view.entity, view.kind, index);

    // groupBy: an explicit config.groupBy (including explicit null) always
    // wins; otherwise a board view defaults to the entity's own select-kind
    // ("stage") column when one exists, else null (ungrouped).
    const groupBy =
      view.config?.groupBy !== undefined ? view.config.groupBy : view.kind === "board" ? defaultBoardGroupBy(entity) : null;
    if (view.kind === "board" && groupBy !== null) {
      validateDriverColumn(entity, groupBy, "board", (field) => field.kind === "select");
    }

    const dateBy =
      view.kind === "calendar"
        ? validateDriverColumn(
            entity,
            view.config?.dateBy ?? defaultDateBy(entity),
            "calendar",
            (field) => field.kind === "date",
          )
        : undefined;
    const locationBy =
      view.kind === "map"
        ? validateDriverColumn(
            entity,
            view.config?.locationBy ?? defaultLocationBy(entity),
            "map",
            (field) => field.kind === "location",
          )
        : undefined;
    const relationBy =
      view.kind === "graph"
        ? validateDriverColumn(
            entity,
            view.config?.relationBy ?? graphRelationField(entity)?.id,
            "graph",
            (field) =>
              field.kind === "relation" &&
              field.relationParent !== true &&
              field.relationTarget !== entity.nodeType,
          )
        : undefined;
    const parentBy =
      view.kind === "tree"
        ? validateDriverColumn(
            entity,
            view.config?.parentBy ?? parentRelationField(entity)?.id,
            "tree",
            (field) =>
              field.kind === "relation" &&
              (field.relationParent === true || field.relationTarget === entity.nodeType),
          )
        : undefined;

    viewConfigs.push({
      id,
      entity: view.entity,
      kind: view.kind,
      sorts: view.config?.sorts ?? [],
      rowFilters: view.config?.rowFilters ?? [],
      filterMatch: view.config?.filterMatch ?? "all",
      groupBy,
      ...(dateBy ? { dateBy } : {}),
      ...(locationBy ? { locationBy } : {}),
      ...(relationBy ? { relationBy } : {}),
      ...(parentBy ? { parentBy } : {}),
      ...(view.kind === "graph" ? { graphScope: view.config?.graphScope ?? "single_database" } : {}),
      ...(view.kind === "graph" && view.config?.graphDatabaseIds
        ? { graphDatabaseIds: view.config.graphDatabaseIds }
        : {}),
      convertibleKinds: DATA_VIEW_KINDS.includes(view.kind as DataViewKind)
        ? convertibleKinds
        : [],
    });

    const list = navByEntity.get(view.entity) ?? [];
    list.push(id);
    navByEntity.set(view.entity, list);
  }

  const navigation: NavigationEntry[] = blueprint.entities.map((entity) => ({
    nodeType: entity.nodeType,
    label: applyVocabulary(entity.label, blueprint.vocabulary),
    viewIds: navByEntity.get(entity.nodeType) ?? [],
  }));

  return { tableSpecs, viewConfigs, navigation };
}

/** Vocabulary override: an exact-match lookup on the label string (e.g.
 * vocabulary["Initiative"] = "Deal"), falling back to the original label
 * unchanged. Kept deliberately simple (no templating) — "user's own naming
 * always wins" per CLAUDE.md, so the override is a direct replacement, not a
 * partial substring rewrite that could clobber unrelated text. */
function applyVocabulary(label: string, vocabulary: Record<string, string>): string {
  return vocabulary[label] ?? label;
}

/**
 * Thrown by parseWorkspaceBlueprint when a payload is not a well-formed,
 * DECLARATIVE blueprint — distinct from BlueprintCompileError (which is about
 * the grammar/registry, at compile time). "The LLM emits only the declarative
 * manifest, never runtime code" (BLUEPRINT-1): this parser is the enforcement
 * point, using a closed key allowlist at every level so there is nowhere to
 * smuggle a `code`/`handler`/`exec`/`fn` field or any non-primitive value.
 */
export class BlueprintValidationError extends Error {
  constructor(message: string) {
    super(`workspace blueprint invalid: ${message}`);
    this.name = "BlueprintValidationError";
  }
}

function bfail(reason: string): never {
  throw new BlueprintValidationError(reason);
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject any key on `obj` that is not in `allowed` — the closed-grammar rule
 * that makes a blueprint declarative (no smuggled code/handler/exec fields). */
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) bfail(`${where} has unknown key "${k}" (blueprints are declarative — only ${allowed.join("/")} are allowed here)`);
  }
}

const BLUEPRINT_FIELD_KINDS: readonly BlueprintColumnKind[] = [
  "text", "number", "select", "multiselect", "date", "checkbox", "url", "relation", "formula", "tool", "location",
];
const FILTER_OPS: readonly BlueprintFilterOp[] = ["contains", "is", "is_not", "is_empty", "is_not_empty", "starts_with"];

function isDefaultValue(value: unknown): value is BlueprintDefaultValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) &&
      value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"))
  );
}

function parseField(raw: unknown, where: string): BlueprintFieldSpec {
  if (!isPlainObj(raw)) bfail(`${where} must be an object`);
  rejectUnknownKeys(
    raw,
    [
      "id",
      "label",
      "kind",
      "options",
      "toolId",
      "required",
      "defaultValue",
      "relationTarget",
      "relationParent",
      "hiddenInForm",
    ],
    where,
  );
  const { id, label, kind } = raw;
  if (typeof id !== "string" || id.length === 0) bfail(`${where}.id must be a non-empty string`);
  if (typeof label !== "string" || label.length === 0) bfail(`${where}.label must be a non-empty string`);
  if (typeof kind !== "string" || !BLUEPRINT_FIELD_KINDS.includes(kind as BlueprintColumnKind)) {
    bfail(`${where}.kind must be one of ${BLUEPRINT_FIELD_KINDS.join(", ")}`);
  }
  let options: string[] | undefined;
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.some((o) => typeof o !== "string")) bfail(`${where}.options must be a string[]`);
    options = raw.options as string[];
  }
  if (raw.toolId !== undefined && typeof raw.toolId !== "string") bfail(`${where}.toolId must be a string`);
  if (raw.required !== undefined && typeof raw.required !== "boolean") bfail(`${where}.required must be a boolean`);
  if (raw.defaultValue !== undefined && !isDefaultValue(raw.defaultValue)) {
    bfail(`${where}.defaultValue must be a scalar or scalar array`);
  }
  if (raw.relationTarget !== undefined && typeof raw.relationTarget !== "string") {
    bfail(`${where}.relationTarget must be a string`);
  }
  if (raw.relationParent !== undefined && typeof raw.relationParent !== "boolean") {
    bfail(`${where}.relationParent must be a boolean`);
  }
  if (raw.hiddenInForm !== undefined && typeof raw.hiddenInForm !== "boolean") {
    bfail(`${where}.hiddenInForm must be a boolean`);
  }
  return {
    id,
    label,
    kind: kind as BlueprintColumnKind,
    ...(options ? { options } : {}),
    ...(typeof raw.toolId === "string" ? { toolId: raw.toolId } : {}),
    ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
    ...(raw.defaultValue !== undefined ? { defaultValue: raw.defaultValue } : {}),
    ...(typeof raw.relationTarget === "string" ? { relationTarget: raw.relationTarget } : {}),
    ...(typeof raw.relationParent === "boolean" ? { relationParent: raw.relationParent } : {}),
    ...(typeof raw.hiddenInForm === "boolean" ? { hiddenInForm: raw.hiddenInForm } : {}),
  };
}

function parseViewConfig(raw: unknown, where: string): NonNullable<BlueprintViewSpec["config"]> {
  if (!isPlainObj(raw)) bfail(`${where} must be an object`);
  rejectUnknownKeys(
    raw,
    [
      "sorts",
      "rowFilters",
      "filterMatch",
      "groupBy",
      "dateBy",
      "locationBy",
      "relationBy",
      "parentBy",
      "graphScope",
      "graphDatabaseIds",
    ],
    where,
  );
  let sorts: BlueprintSortSpec[] | undefined;
  if (raw.sorts !== undefined) {
    if (!Array.isArray(raw.sorts)) bfail(`${where}.sorts must be an array`);
    sorts = raw.sorts.map((s, i): BlueprintSortSpec => {
      if (!isPlainObj(s)) bfail(`${where}.sorts[${i}] must be an object`);
      rejectUnknownKeys(s, ["id", "dir"], `${where}.sorts[${i}]`);
      if (typeof s.id !== "string" || (s.dir !== "asc" && s.dir !== "desc")) bfail(`${where}.sorts[${i}] must be { id, dir: asc|desc }`);
      return { id: s.id, dir: s.dir };
    });
  }
  let rowFilters: BlueprintRowFilter[] | undefined;
  if (raw.rowFilters !== undefined) {
    if (!Array.isArray(raw.rowFilters)) bfail(`${where}.rowFilters must be an array`);
    rowFilters = raw.rowFilters.map((f, i): BlueprintRowFilter => {
      if (!isPlainObj(f)) bfail(`${where}.rowFilters[${i}] must be an object`);
      rejectUnknownKeys(f, ["field", "op", "value"], `${where}.rowFilters[${i}]`);
      if (typeof f.field !== "string" || typeof f.value !== "string" || !FILTER_OPS.includes(f.op as BlueprintFilterOp)) {
        bfail(`${where}.rowFilters[${i}] must be { field, op, value } with op in ${FILTER_OPS.join("/")}`);
      }
      return { field: f.field, op: f.op as BlueprintFilterOp, value: f.value };
    });
  }
  if (raw.filterMatch !== undefined && raw.filterMatch !== "all" && raw.filterMatch !== "any") {
    bfail(`${where}.filterMatch must be "all" or "any"`);
  }
  if (raw.groupBy !== undefined && raw.groupBy !== null && typeof raw.groupBy !== "string") {
    bfail(`${where}.groupBy must be a string or null`);
  }
  for (const key of ["dateBy", "locationBy", "relationBy", "parentBy"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      bfail(`${where}.${key} must be a string`);
    }
  }
  if (
    raw.graphScope !== undefined &&
    raw.graphScope !== "single_database" &&
    raw.graphScope !== "multi_database" &&
    raw.graphScope !== "full"
  ) {
    bfail(`${where}.graphScope must be single_database, multi_database, or full`);
  }
  if (
    raw.graphDatabaseIds !== undefined &&
    (!Array.isArray(raw.graphDatabaseIds) ||
      raw.graphDatabaseIds.some((databaseId) => typeof databaseId !== "string" || databaseId.length === 0))
  ) {
    bfail(`${where}.graphDatabaseIds must be an array of non-empty strings`);
  }
  return {
    ...(sorts ? { sorts } : {}),
    ...(rowFilters ? { rowFilters } : {}),
    ...(raw.filterMatch === "all" || raw.filterMatch === "any" ? { filterMatch: raw.filterMatch } : {}),
    ...(raw.groupBy !== undefined ? { groupBy: raw.groupBy as string | null } : {}),
    ...(typeof raw.dateBy === "string" ? { dateBy: raw.dateBy } : {}),
    ...(typeof raw.locationBy === "string" ? { locationBy: raw.locationBy } : {}),
    ...(typeof raw.relationBy === "string" ? { relationBy: raw.relationBy } : {}),
    ...(typeof raw.parentBy === "string" ? { parentBy: raw.parentBy } : {}),
    ...(raw.graphScope === "single_database" || raw.graphScope === "multi_database" || raw.graphScope === "full"
      ? { graphScope: raw.graphScope }
      : {}),
    ...(Array.isArray(raw.graphDatabaseIds) ? { graphDatabaseIds: raw.graphDatabaseIds as string[] } : {}),
  };
}

/**
 * Parse+validate an untrusted payload (a Commons-published blueprint, a tRPC
 * input, or a stored jsonb row) into a WorkspaceBlueprint, rejecting anything
 * that is not a well-formed DECLARATIVE blueprint. Uses a closed key allowlist
 * at every level so runtime code cannot be smuggled in. Stamps
 * BLUEPRINT_SCHEMA_VERSION when absent; rejects an unknown (future) version.
 * Pure — no I/O. Does NOT check the node-type registry (that is
 * compileBlueprint's job); this is the SHAPE/declarative gate.
 */
export function parseWorkspaceBlueprint(raw: unknown): WorkspaceBlueprint {
  if (!isPlainObj(raw)) bfail("root must be an object");
  rejectUnknownKeys(raw, ["schemaVersion", "vocabulary", "entities", "views", "capabilities"], "blueprint");

  const sourceSchemaVersion = raw.schemaVersion;
  if (raw.schemaVersion !== undefined) {
    if (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion)) bfail("schemaVersion must be an integer");
    if (raw.schemaVersion < LEGACY_BLUEPRINT_SCHEMA_VERSION) {
      bfail(`schemaVersion ${raw.schemaVersion} is older than this kernel can migrate`);
    }
    if (raw.schemaVersion > BLUEPRINT_SCHEMA_VERSION) {
      bfail(`schemaVersion ${raw.schemaVersion} is newer than this kernel understands (max ${BLUEPRINT_SCHEMA_VERSION})`);
    }
  }

  if (!isPlainObj(raw.vocabulary)) bfail("vocabulary must be an object");
  const vocabulary: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.vocabulary)) {
    if (typeof v !== "string") bfail(`vocabulary.${k} must be a string`);
    vocabulary[k] = v;
  }

  if (!Array.isArray(raw.entities)) bfail("entities must be an array");
  const entities = raw.entities.map((e, i): BlueprintEntitySpec => {
    if (!isPlainObj(e)) bfail(`entities[${i}] must be an object`);
    rejectUnknownKeys(e, ["nodeType", "label", "fields"], `entities[${i}]`);
    if (typeof e.nodeType !== "string" || e.nodeType.length === 0) bfail(`entities[${i}].nodeType must be a non-empty string`);
    if (typeof e.label !== "string" || e.label.length === 0) bfail(`entities[${i}].label must be a non-empty string`);
    if (!Array.isArray(e.fields)) bfail(`entities[${i}].fields must be an array`);
    return { nodeType: e.nodeType, label: e.label, fields: e.fields.map((f, j) => parseField(f, `entities[${i}].fields[${j}]`)) };
  });

  if (!Array.isArray(raw.views)) bfail("views must be an array");
  const views = raw.views.map((v, i): BlueprintViewSpec => {
    if (!isPlainObj(v)) bfail(`views[${i}] must be an object`);
    rejectUnknownKeys(v, ["entity", "kind", "config"], `views[${i}]`);
    if (typeof v.entity !== "string" || v.entity.length === 0) bfail(`views[${i}].entity must be a non-empty string`);
    if (typeof v.kind !== "string") {
      bfail(`views[${i}].kind must be a string`);
    }
    let kind = v.kind as string;
    if (kind === "kanban" || kind === "network") {
      if (sourceSchemaVersion === BLUEPRINT_SCHEMA_VERSION) {
        bfail(`views[${i}].kind "${kind}" is a version-1 alias; use "${kind === "kanban" ? "board" : "graph"}"`);
      }
      kind = kind === "kanban" ? "board" : "graph";
    }
    if (!BLUEPRINT_VIEW_KINDS.includes(kind as BlueprintViewKind)) {
      bfail(`views[${i}].kind must be one of ${BLUEPRINT_VIEW_KINDS.join(", ")}`);
    }
    return {
      entity: v.entity,
      kind: kind as BlueprintViewKind,
      ...(v.config !== undefined ? { config: parseViewConfig(v.config, `views[${i}].config`) } : {}),
    };
  });

  if (!Array.isArray(raw.capabilities) || raw.capabilities.some((c) => typeof c !== "string" || c.length === 0)) {
    bfail("capabilities must be an array of non-empty capability-manifest-id strings");
  }

  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    vocabulary,
    entities,
    views,
    capabilities: raw.capabilities as string[],
  };
}

export interface WorkspaceBlueprintPublishOptions {
  /** kebab-case package name for the Commons entry. */
  name: string;
  /** exact semver for the Commons entry. */
  version: string;
  summary?: string;
  description?: string;
}

/**
 * Bridge a WorkspaceBlueprint into a Commons-publishable PackageManifest
 * (kind "workspace_definition"). The blueprint travels intact in
 * `manifest.blueprint` (so PKG-2 signing covers it byte-for-byte), with
 * schemaVersion stamped. A workspace_definition COMPOSES capabilities by
 * reference (blueprint.capabilities) rather than bundling them, so the
 * manifest's own capabilities[] is empty — parsePackageManifest permits this
 * for a blueprint-carrying workspace_definition. Pure.
 */
export function workspaceBlueprintToPackageManifest(
  blueprint: WorkspaceBlueprint,
  options: WorkspaceBlueprintPublishOptions,
): PackageManifest {
  const summary = options.summary ?? `${options.name} workspace blueprint`;
  return {
    name: options.name,
    version: options.version,
    kind: "workspace_definition",
    summary,
    description: options.description ?? summary,
    lineageManifestId: null,
    dependencies: [],
    capabilities: [],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: blueprint.vocabulary },
    blueprint: { ...blueprint, schemaVersion: BLUEPRINT_SCHEMA_VERSION },
  };
}

/**
 * Inverse of workspaceBlueprintToPackageManifest — extract and re-validate the
 * blueprint from an installed PackageManifest, running the full declarative
 * gate (parseWorkspaceBlueprint) so a tampered/non-declarative payload that
 * somehow reached install is rejected at the boundary. Throws
 * BlueprintValidationError if the manifest is not a blueprint-carrying
 * workspace_definition. Pure.
 */
export function workspaceBlueprintFromPackageManifest(manifest: PackageManifest): WorkspaceBlueprint {
  if (manifest.kind !== "workspace_definition") {
    bfail(`package "${manifest.name}" is kind "${manifest.kind}", not a workspace_definition — no blueprint to extract`);
  }
  if (manifest.blueprint === undefined) {
    bfail(`workspace_definition package "${manifest.name}" carries no blueprint payload`);
  }
  return parseWorkspaceBlueprint(manifest.blueprint);
}
