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
 * Grammar (docs/wiki/vision.md "View grammar", guardrail):
 *   - default views = table (morphable: calendar/kanban/map/graph/card) · chatbot ·
 *     dashboard · canvas. This compiler only handles the @bridge/tables-backed data
 *     views (table/gallery/kanban/calendar/map/network) — chatbot/dashboard/canvas
 *     views are the frontend's ViewComponentRegistry's problem, not this compiler's;
 *     a blueprint view of kind "dashboard" compiles through unchanged (no TableSpec
 *     needed) so the frontend registry can still render it.
 *   - Relationships (any entity whose nodeType is "relationship") render as
 *     graph or table ONLY — compileBlueprint forces this, rejecting kanban/
 *     calendar/map/gallery for a relationship entity's view.
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

/** Structural mirror of @bridge/tables' ColumnKind, PLUS "location" (ADR-023/
 * ADR-024 view-convertibility grammar: map-view eligibility needs a real
 * location-kind column instead of a name-based heuristic). @bridge/tables'
 * own ColumnKind does not have this member yet — additive-only here per
 * CLAUDE.md's backward-compatibility rule for kernel type changes; a
 * follow-up can widen @bridge/tables' ColumnKind to match. */
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

/** Structural mirror of @bridge/tables' ColumnSpec. */
export interface BlueprintColumnSpec {
  id: string;
  label: string;
  kind: BlueprintColumnKind;
  options?: string[];
  toolId?: string;
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
export type DataViewKind = "table" | "gallery" | "kanban" | "calendar" | "map" | "network";
const DATA_VIEW_KINDS: readonly DataViewKind[] = ["table", "gallery", "kanban", "calendar", "map", "network"];

/** The blueprint's full view surface — @bridge/tables' data-view kinds plus the
 * three non-tabular view kinds the vision doc's grammar also allows. */
export type BlueprintViewKind = DataViewKind | "chatbot" | "dashboard" | "canvas";
const BLUEPRINT_VIEW_KINDS: readonly BlueprintViewKind[] = [...DATA_VIEW_KINDS, "chatbot", "dashboard", "canvas"];

/** Kinds a relationship entity's view is restricted to (grammar: "graph or table ONLY"). */
const RELATIONSHIP_ALLOWED_KINDS: readonly BlueprintViewKind[] = ["network", "table"];

export interface BlueprintFieldSpec {
  id: string;
  label: string;
  kind: BlueprintColumnKind;
  options?: string[];
  toolId?: string;
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
  };
}

/** The governed, versioned artifact stored in workspace_definitions.blueprint. */
export interface WorkspaceBlueprint {
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
  /** View-convertibility grammar (ADR-023 item 6 / ADR-024): which
   * DataViewKinds this view's owning entity could morph into, computed from
   * the entity's OWN column kinds — not the view's declared `kind`. Always
   * includes table/kanban/gallery ("card") for any table-backed entity;
   * "calendar" is added when a "date" column exists, "map" when a "location"
   * column exists, "network" (graph) when a "relation" column exists. A
   * relationship-shaped entity (per `relationshipNodeTypes`) is restricted to
   * exactly ["table", "network"], mirroring the RELATIONSHIP_ALLOWED_KINDS
   * compile-time restriction below. Non-tabular views (chatbot/dashboard/
   * canvas) carry an empty array — they have no TableSpec to morph from. */
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

/** ADR-023/ADR-024 view-convertibility grammar: table/kanban/gallery ("card")
 * are always convertible for any table-backed entity; calendar/map/network
 * are gated on the entity actually carrying a column kind that could drive
 * them, so a switcher never offers a view guaranteed to render empty. A
 * relationship-shaped entity is restricted to exactly table+network,
 * mirroring RELATIONSHIP_ALLOWED_KINDS' compile-time restriction. */
function computeConvertibleKinds(entity: BlueprintEntitySpec, isRelationship: boolean): DataViewKind[] {
  if (isRelationship) return ["table", "network"];
  const kinds: DataViewKind[] = ["table", "kanban", "gallery"];
  if (entity.fields.some((f) => f.kind === "date")) kinds.push("calendar");
  if (entity.fields.some((f) => f.kind === "location")) kinds.push("map");
  if (entity.fields.some((f) => f.kind === "relation")) kinds.push("network");
  return kinds;
}

/** ADR-023/ADR-024: a kanban view's default `groupBy` is the entity's own
 * "select"-kind column (its stage/status field) when one exists and the
 * blueprint author didn't already specify one — never overrides an explicit
 * `config.groupBy` (including an explicit `null`, which means "no grouping,
 * intentionally"). Picks the FIRST select-kind field in declaration order;
 * a blueprint with more than one select column should name the intended one
 * explicitly via `config.groupBy`. */
function defaultKanbanGroupBy(entity: BlueprintEntitySpec): string | null {
  return entity.fields.find((f) => f.kind === "select")?.id ?? null;
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
  relationshipNodeTypes: readonly string[] = ["relationship"],
): CompiledWorkspace {
  const registered = new Set(registeredNodeTypes);
  const relationshipSet = new Set(relationshipNodeTypes);
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
    if (relationshipSet.has(view.entity) && !RELATIONSHIP_ALLOWED_KINDS.includes(view.kind)) {
      throw new BlueprintCompileError(
        `entity "${view.entity}" is a relationship node type — its views are restricted to ${RELATIONSHIP_ALLOWED_KINDS.join(" or ")}, got "${view.kind}"`,
      );
    }

    const index = viewsByEntityIndex.get(view.entity) ?? 0;
    viewsByEntityIndex.set(view.entity, index + 1);
    const id = viewConfigId(view.entity, view.kind, index);

    const isRelationship = relationshipSet.has(view.entity);
    // groupBy: an explicit config.groupBy (including explicit null) always
    // wins; otherwise a kanban view defaults to the entity's own select-kind
    // ("stage") column when one exists, else null (ungrouped).
    const groupBy =
      view.config?.groupBy !== undefined ? view.config.groupBy : view.kind === "kanban" ? defaultKanbanGroupBy(entity) : null;

    viewConfigs.push({
      id,
      entity: view.entity,
      kind: view.kind,
      sorts: view.config?.sorts ?? [],
      rowFilters: view.config?.rowFilters ?? [],
      filterMatch: view.config?.filterMatch ?? "all",
      groupBy,
      convertibleKinds: DATA_VIEW_KINDS.includes(view.kind as DataViewKind)
        ? computeConvertibleKinds(entity, isRelationship)
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
