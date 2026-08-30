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
 * WHAT IT IS NOT. There is no "add column". A column the underlying Database
 * does not have would have nowhere to put its values, so that command stays
 * VISIBLE and disabled with that reason (ADR-001, ADR-247) rather than being
 * enabled against a store that does not exist.
 */
import type { ColumnOverlay, TableSpec } from "@bridge/tables";
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
      overlay.removed?.length,
  );
}

/** One column-menu command, as the server understands it. */
export type ColumnOp =
  | { kind: "rename"; columnId: string; label: string }
  | { kind: "setKind"; columnId: string; columnKind: TableSpec["columns"][number]["kind"] }
  | { kind: "setLocked"; columnId: string; locked: boolean }
  | { kind: "delete"; columnId: string };

/** Apply one command to an overlay. Pure — the caller persists the result. */
export function applyColumnOp(overlay: ColumnOverlay, op: ColumnOp, updatedAt: string): ColumnOverlay {
  const next: ColumnOverlay = {
    labels: { ...(overlay.labels ?? {}) },
    kinds: { ...(overlay.kinds ?? {}) },
    locked: [...(overlay.locked ?? [])],
    removed: [...(overlay.removed ?? [])],
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
 * Views are not persisted anywhere in this repository — every surface builds its
 * `ViewConfig` from `defaultViewConfig` on mount and holds it in React state, so
 * there is no saved View that could reference a column. That is a real
 * inspection with a real answer, not a shrug.
 */
export function viewDependencies(): DependencySource {
  return {
    inspected: true,
    items: [],
    note: "No View is persisted: every View is rebuilt from its default on load, so none can hold a reference to this column.",
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
