/**
 * The governed schema-mutation capability (TASK-084) — everything about it that
 * is a pure function of its inputs.
 *
 * WHY A SEPARATE FILE. `router.ts` holds the tRPC seam; this holds the rules, so
 * they can be tested without a Wiring and read without scrolling past 20k lines.
 *
 * WHAT IT IS. `StandardColumnMenu` shipped 13 of 17 items permanently disabled
 * because nothing stood behind them. What stands behind them now is a
 * per-Organization COLUMN OVERLAY resolved over the shipped `TableSpec`
 * (`@bridge/tables`), held on the Local Plane. It is deliberately not a
 * migration: these Databases ship with the application, and the Module author's
 * spec has to stay recoverable.
 *
 * ADDING A COLUMN is that same overlay, wherever the row store can hold one. A
 * Module Database (the Builder's own, served by `moduleRecords.*`) keeps its
 * Records as documents of declared columns, so a column added to the overlay
 * has somewhere to put its values. The shipped sqlite-backed specs do not, and
 * they report adding unavailable with that reason rather than enabling a
 * command that would write nowhere (ADR-001, ADR-247).
 */
import { applyColumnOverlay, type ColumnKind, type ColumnOverlay, type TableSpec } from "@bridge/tables";
import type { ModuleDatabaseBinding } from "@bridge/core";
import { extractDependencies, transitiveDependencies, buildDependencyGraph } from "@bridge/accounting";

export const TABLE_SCHEMA_NAMESPACE_PREFIX = "table:schema:";

/**
 * One level of undo, held beside the overlay it replaces.
 *
 * ponytail: one level, not a stack. A stack would need its own bounding and
 * eviction policy for a surface where the realistic mistake is the LAST one;
 * grow it to a bounded stack if a second "undo" is ever asked for.
 */
export interface StoredTableSchema {
  overlay: ColumnOverlay;
  previous: ColumnOverlay | null;
}

const EMPTY: StoredTableSchema = { overlay: {}, previous: null };

/** Parse whatever the state store held. Anything unrecognised reads as "no
 * overlay" — a corrupt row must not silently reshape a Database. */
export function readStoredTableSchema(raw: unknown): StoredTableSchema {
  if (!raw || typeof raw !== "object") return EMPTY;
  const record = raw as { overlay?: unknown; previous?: unknown };
  const overlay = record.overlay && typeof record.overlay === "object" ? (record.overlay as ColumnOverlay) : {};
  const previous =
    record.previous && typeof record.previous === "object" ? (record.previous as ColumnOverlay) : null;
  return { overlay, previous };
}

export function hasOverlay(overlay: ColumnOverlay): boolean {
  return Boolean(
    (overlay.labels && Object.keys(overlay.labels).length) ||
      (overlay.kinds && Object.keys(overlay.kinds).length) ||
      overlay.locked?.length ||
      overlay.removed?.length ||
      overlay.added?.length,
  );
}

/**
 * The manifest's declared columns as a TableSpec, with the Organization's
 * overlay resolved over them.
 *
 * HERE rather than in `routers/moduleRecords.ts` because both the Records
 * router and the schema capability in `router-shared.ts` need it, and
 * `router-shared.ts` importing a router would close an import cycle.
 */
export function moduleDatabaseSpec(
  moduleName: string,
  database: ModuleDatabaseBinding,
  storedOverlay: unknown,
): TableSpec {
  return applyColumnOverlay(
    moduleDatabaseBaseSpec(moduleName, database),
    readStoredTableSchema(storedOverlay).overlay,
  );
}

/** The manifest's own spec, with no overlay. Manifests are immutable (ADR-178):
 * this is what the user's overlay is always resolved over, never replaced. */
export function moduleDatabaseBaseSpec(
  moduleName: string,
  database: ModuleDatabaseBinding,
): TableSpec {
  return {
    id: moduleRecordsSpecId(moduleName, database.id),
    columns: database.columns.map((column) => ({
      id: column.id,
      label: column.label,
      kind: column.kind,
      editable: true,
      ...(column.options ? { options: [...column.options] } : {}),
      ...(column.skillId ? { skillId: column.skillId } : {}),
      ...(column.required ? { required: true } : {}),
      ...(column.defaultValue !== undefined ? { defaultValue: column.defaultValue } : {}),
      ...(column.relationTarget ? { relationTarget: column.relationTarget } : {}),
    })),
  };
}

export function moduleRecordsSpecId(moduleName: string, databaseId: string): string {
  return `${moduleName}.${databaseId}`;
}

/** One column-menu command, as the server understands it. */
export type ColumnOp =
  | { kind: "rename"; columnId: string; label: string }
  | { kind: "setKind"; columnId: string; columnKind: TableSpec["columns"][number]["kind"] }
  | { kind: "setLocked"; columnId: string; locked: boolean }
  | { kind: "delete"; columnId: string }
  | {
      kind: "add";
      columnId: string;
      label: string;
      columnKind: ColumnKind;
      position?: { relativeTo: string; side: "left" | "right" } | undefined;
    };

/** Apply one command to an overlay. Pure — the caller persists the result. */
export function applyColumnOp(overlay: ColumnOverlay, op: ColumnOp, updatedAt: string): ColumnOverlay {
  const next: ColumnOverlay = {
    labels: { ...(overlay.labels ?? {}) },
    kinds: { ...(overlay.kinds ?? {}) },
    locked: [...(overlay.locked ?? [])],
    removed: [...(overlay.removed ?? [])],
    added: [...(overlay.added ?? [])],
    updatedAt,
  };
  switch (op.kind) {
    case "rename":
      next.labels![op.columnId] = op.label;
      break;
    case "setKind":
      next.kinds![op.columnId] = op.columnKind;
      break;
    case "setLocked":
      next.locked = op.locked
        ? [...new Set([...next.locked!, op.columnId])]
        : next.locked!.filter((id) => id !== op.columnId);
      break;
    case "delete":
      if (!next.removed!.includes(op.columnId)) next.removed!.push(op.columnId);
      break;
    case "add":
      // Adding back an id the user deleted is an UN-delete: leaving the id on
      // `removed` would store the column and then hide it, and the user would
      // believe the add had silently failed.
      next.removed = next.removed!.filter((id) => id !== op.columnId);
      next.added!.push({
        id: op.columnId,
        label: op.label,
        kind: op.columnKind,
        ...(op.position ? { position: op.position } : {}),
      });
      break;
  }
  return next;
}

/**
 * One source of breakage, and — the point of the shape — whether it was
 * actually looked at.
 *
 * An empty `items` from a source nobody inspected reads exactly like "nothing
 * breaks", which is the lie ADR-247 forbids. `inspected: false` with a `note`
 * is the honest form: unknown is first-class.
 */
export interface DependencySource {
  inspected: boolean;
  items: string[];
  note: string | null;
}

/**
 * Views WERE unpersisted when this was written, and this said so with
 * `inspected: true`. TASK-062 gave them a store (`view_configs`), and a saved
 * List's filters, sorts and hidden columns all name columns — so the old
 * answer became a claim of safety nobody had checked, which is exactly what
 * ADR-247 forbids. Until the preview reads that store under the caller's
 * identity, "not inspected" is the honest answer.
 */
export function viewDependencies(): DependencySource {
  return {
    inspected: false,
    items: [],
    note: "Not inspected: saved Lists are durable since TASK-062 and their filters, sorts and hidden columns name columns, but this preview does not yet read them. Absence here is not evidence of safety.",
  };
}

/**
 * An Automation step declares a Skill, an action, a resourceType and an opaque
 * `inputs` payload — there is no column-level reference anywhere in the
 * contract. So this CANNOT be answered by inspection, and its emptiness is not
 * evidence of safety.
 */
export function automationDependencies(): DependencySource {
  return {
    inspected: false,
    items: [],
    note: "Not inspected: an Automation step records a Skill and a resource type, never a column, so a step whose opaque inputs name this column cannot be found. Absence here is not evidence of safety.",
  };
}

/** Same gap on the Skill side, plus the one thing that IS knowable: a column
 * computed by a Skill names that Skill on the column itself. */
export function skillDependencies(spec: TableSpec, columnId: string): DependencySource {
  const own = spec.columns.find((column) => column.id === columnId)?.skillId;
  return {
    inspected: false,
    items: own ? [`Computed by Skill ${own}`] : [],
    note: "Not inspected: a Skill declares capabilities and resource types, never a column, so a Skill reading this column cannot be found. Absence here is not evidence of safety.",
  };
}

/** Relations are declared ON the column, so this one is fully knowable. */
export function relationDependencies(spec: TableSpec, columnId: string): DependencySource {
  const column = spec.columns.find((entry) => entry.id === columnId);
  const items: string[] = [];
  if (column?.relationTarget) {
    items.push(
      `Relation to ${column.relationTarget}${column.relationParent ? " (this column is the parent side)" : ""}`,
    );
  }
  return { inspected: true, items, note: null };
}

/**
 * Every stored formula whose expression depends — directly or transitively — on
 * this identifier. Derived from the Accounting engine's own dependency graph
 * rather than a second parser: `engine.ts` is the one place an expression is
 * understood.
 */
export function formulaDependencies(
  formulas: { id: string; label: string; expression: string; active?: boolean }[],
  identifier: string,
): DependencySource {
  const dependents = formulaDependentIds(formulas, identifier);
  if (dependents === null) {
    // A registry that does not currently build cannot be interrogated. Say so
    // rather than reporting an empty list.
    return {
      inspected: false,
      items: [],
      note: "Not inspected: the formula registry does not currently form a valid dependency graph.",
    };
  }
  const byId = new Map(formulas.map((formula) => [formula.id, formula]));
  return {
    inspected: true,
    items: dependents
      .map((id) => {
        const formula = byId.get(id);
        return formula ? `${formula.label} (${formula.id}) — ${formula.expression}` : id;
      })
      .sort(),
    note: null,
  };
}

/**
 * The ids of every active formula that depends on `identifier`, directly or
 * transitively — or `null` when the registry does not currently form a graph.
 *
 * Ids, not prose: the caller that needs to know WHICH cells recompute must not
 * have to parse them back out of a sentence.
 */
export function formulaDependentIds(
  formulas: { id: string; label: string; expression: string; active?: boolean }[],
  identifier: string,
): string[] | null {
  const active = formulas.filter((formula) => formula.active !== false);
  let deps: Map<string, string[]>;
  try {
    ({ deps } = buildDependencyGraph(active));
  } catch {
    return null;
  }
  return active
    .filter(
      (formula) =>
        formula.id !== identifier && transitiveDependencies(formula.id, deps).includes(identifier),
    )
    .map((formula) => formula.id)
    .sort();
}

export interface ColumnDependencyPreview {
  specId: string;
  columnId: string;
  views: DependencySource;
  automations: DependencySource;
  skills: DependencySource;
  formulas: DependencySource;
  relations: DependencySource;
}

/** The identifiers a candidate expression depends on, or a thrown parse error.
 * Re-exported so the router does not import the engine twice. */
export { extractDependencies };
