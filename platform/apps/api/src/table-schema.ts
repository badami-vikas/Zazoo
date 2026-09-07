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
import {
  applyColumnOverlay,
  isMetadataColumn,
  type ColumnKind,
  type ColumnOverlay,
  type ColumnSpec,
  type TableSpec,
} from "@bridge/tables";
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
  return resolveColumnOverlay(
    moduleDatabaseBaseSpec(moduleName, database),
    readStoredTableSchema(storedOverlay).overlay,
  );
}

/**
 * A column the user added, plus the options a choice column needs to be worth
 * anything (TASK-108).
 *
 * ponytail: `options` rides on the stored `added` entry and is re-attached
 * HERE rather than inside `applyColumnOverlay`, because `@bridge/tables`'
 * `ColumnOverlay` is owned by a parallel slice. Move the field onto that type
 * and delete `resolveColumnOverlay`'s second pass when it lands.
 */
export type AddedColumn = NonNullable<ColumnOverlay["added"]>[number] & { options?: string[] };

/**
 * `applyColumnOverlay`, plus the choice options an added `select`/`status`
 * column carries. Without this a user-added select rendered a chooser over
 * nothing — a control that cannot be honoured (ADR-247).
 *
 * Rename and retype go through `applyColumnOverlay` untouched, so both keep
 * the options: they are keyed by column id, not by label or kind.
 */
export function resolveColumnOverlay(
  spec: TableSpec,
  overlay: ColumnOverlay | null | undefined,
): TableSpec {
  const resolved = applyColumnOverlay(spec, overlay);
  const optionsById = new Map<string, string[]>();
  for (const added of (overlay?.added ?? []) as AddedColumn[]) {
    if (added.options?.length) optionsById.set(added.id, [...added.options]);
  }
  if (optionsById.size === 0) return resolved;
  return {
    ...resolved,
    columns: resolved.columns.map((column) =>
      optionsById.has(column.id) && !column.options
        ? { ...column, options: optionsById.get(column.id)! }
        : column,
    ),
  };
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
      // Parsed by `parseModuleManifest` since TASK-108. Copied here since this
      // file was written — they were dead branches only because the parser
      // dropped them off the binding.
      ...(column.relationParent ? { relationParent: true } : {}),
      ...(column.hiddenInForm ? { hiddenInForm: true } : {}),
      ...(column.description ? { description: column.description } : {}),
      ...(column.statusGroups ? { statusGroups: { ...column.statusGroups } } : {}),
      ...(column.rollupSource ? { rollupSource: column.rollupSource } : {}),
      ...(column.rollupProperty ? { rollupProperty: column.rollupProperty } : {}),
      ...(column.rollupFunction ? { rollupFunction: column.rollupFunction } : {}),
      ...(column.actionId ? { actionId: column.actionId } : {}),
    })),
  };
}

export function moduleRecordsSpecId(moduleName: string, databaseId: string): string {
  return `${moduleName}.${databaseId}`;
}

// ── What a column can actually hold (TASK-108) ──────────────────────────────
//
// `pickDeclared` used to check KEY MEMBERSHIP only: a `number` column accepted
// `{"a":1}`, a `select` accepted an option nobody declared, and `required` in a
// manifest was never enforced. A Database whose values do not match their kinds
// cannot be filtered or sorted honestly — a `gt` over a column holding objects
// is not a query, it is a coin toss. So the floor goes HERE, at the write.

/** A refusal a caller can act on: which column, and what was wrong with it. */
export class RecordValueError extends Error {
  constructor(readonly columnId: string, reason: string) {
    // The reason usually opens with the column's own LABEL ("Amount holds a
    // number"), so the id is prefixed only when it would otherwise be absent.
    super(reason.startsWith(columnId) ? reason : `${columnId}: ${reason}`);
    this.name = "RecordValueError";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why this column can never be written, or null when it can. */
export function unwritableReason(column: ColumnSpec): string | null {
  if (isMetadataColumn(column.kind)) {
    return `${column.label} is filled from the Event log, so nothing can set it`;
  }
  switch (column.kind) {
    case "rollup":
      return `${column.label} is rolled up from a relation, so nothing can set it`;
    case "button":
      return `${column.label} runs an Action; it holds no value`;
    case "formula":
      // NOT LANDED, said honestly: a Module Database has no expression engine,
      // so a formula column has no value to compute and none to store either.
      return `${column.label} is a formula column, and a Module Database cannot evaluate an expression yet`;
    default:
      return null;
  }
}

function coerceOne(column: ColumnSpec, value: unknown): unknown {
  // Clearing a cell is always expressible; `required` is checked separately so
  // the message can say "required", not "wrong type".
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim() : value;
  switch (column.kind) {
    case "number":
    case "autoNumber": {
      const parsed = typeof text === "number" ? text : typeof text === "string" ? Number(text) : Number.NaN;
      if (!Number.isFinite(parsed)) {
        throw new RecordValueError(column.id, `${column.label} holds a number, got ${JSON.stringify(value)}`);
      }
      return parsed;
    }
    case "checkbox": {
      if (typeof value === "boolean") return value;
      if (text === "true") return true;
      if (text === "false") return false;
      throw new RecordValueError(column.id, `${column.label} is a checkbox: true or false, got ${JSON.stringify(value)}`);
    }
    case "date":
    case "createdTime":
    case "lastEditedTime": {
      if (typeof text !== "string" || Number.isNaN(new Date(text).getTime())) {
        throw new RecordValueError(column.id, `${column.label} holds a date, got ${JSON.stringify(value)}`);
      }
      return text;
    }
    case "select":
    case "status": {
      if (typeof text !== "string") {
        throw new RecordValueError(column.id, `${column.label} holds one of its options, got ${JSON.stringify(value)}`);
      }
      if (column.options?.length && !column.options.includes(text)) {
        throw new RecordValueError(
          column.id,
          `${column.label} has no option ${JSON.stringify(text)} — it offers ${column.options.join(", ")}`,
        );
      }
      return text;
    }
    case "multiselect": {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new RecordValueError(column.id, `${column.label} holds a list of its options, got ${JSON.stringify(value)}`);
      }
      const chosen = (value as string[]).map((entry) => entry.trim());
      const unknown = column.options?.length ? chosen.filter((entry) => !column.options!.includes(entry)) : [];
      if (unknown.length) {
        throw new RecordValueError(
          column.id,
          `${column.label} has no option ${unknown.map((entry) => JSON.stringify(entry)).join(", ")} — it offers ${column.options!.join(", ")}`,
        );
      }
      return chosen;
    }
    case "email": {
      if (typeof text !== "string" || !EMAIL_RE.test(text)) {
        throw new RecordValueError(column.id, `${column.label} holds an email address, got ${JSON.stringify(value)}`);
      }
      return text;
    }
    case "url": {
      if (typeof text !== "string" || !URL.canParse(text)) {
        throw new RecordValueError(column.id, `${column.label} holds a link, got ${JSON.stringify(value)}`);
      }
      return text;
    }
    case "relation": {
      if (typeof text !== "string") {
        throw new RecordValueError(column.id, `${column.label} holds the id of a related Record, got ${JSON.stringify(value)}`);
      }
      return text;
    }
    case "files": {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new RecordValueError(column.id, `${column.label} holds a list of file ids, got ${JSON.stringify(value)}`);
      }
      return value;
    }
    default: {
      // text / longText / phone / person / location / skill: prose, and prose
      // is not an object. A number reaching a text column is written as text
      // rather than refused — that one is a formatting question, not a lie.
      if (typeof text === "string") return text;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      throw new RecordValueError(column.id, `${column.label} holds text, got ${JSON.stringify(value)}`);
    }
  }
}

/**
 * The row as it may be STORED: only declared columns, each coerced to what its
 * kind can hold, derived columns refused rather than written, and — on insert —
 * every `required` column present.
 */
export function coerceRecordFields(
  spec: TableSpec,
  fields: Record<string, unknown>,
  options: { applyDefaults: boolean },
): Record<string, unknown> {
  const byId = new Map(spec.columns.map((column) => [column.id, column]));
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const column = byId.get(key);
    // The pre-existing membership refusal, word for word: callers test it.
    if (!column) throw new RecordValueError(key, `${key} is not a column of ${spec.id}`);
    const unwritable = unwritableReason(column);
    if (unwritable) throw new RecordValueError(key, unwritable);
    picked[key] = coerceOne(column, value);
  }
  if (!options.applyDefaults) return picked;
  for (const column of spec.columns) {
    if (unwritableReason(column)) continue;
    if (picked[column.id] === undefined && column.defaultValue !== undefined) {
      picked[column.id] = coerceOne(column, column.defaultValue);
    }
    if (column.required && (picked[column.id] === undefined || picked[column.id] === null)) {
      throw new RecordValueError(column.id, `${column.label} is required`);
    }
  }
  return picked;
}

/**
 * The relation targets a manifest names that no Database anywhere answers to
 * (TASK-108).
 *
 * `parseModuleManifest` checks the SAME-manifest half; this is the other half,
 * and it can only be asked here because it needs the manifests already
 * installed. A relation to a Database nobody declares renders a chooser over
 * nothing, which is the control ADR-247 forbids — so registration refuses it
 * rather than installing a Module whose column can never be filled.
 */
export function unknownRelationTargets(
  manifest: { name: string; module?: { databases?: ModuleDatabaseBinding[] } | undefined },
  installed: { moduleName: string; manifest: { module?: { databases?: ModuleDatabaseBinding[] } | undefined } }[],
): string[] {
  const known = new Set<string>();
  for (const database of manifest.module?.databases ?? []) {
    known.add(moduleRecordsSpecId(manifest.name, database.id));
  }
  for (const row of installed) {
    for (const database of row.manifest.module?.databases ?? []) {
      known.add(moduleRecordsSpecId(row.moduleName, database.id));
    }
  }
  const missing = new Set<string>();
  for (const database of manifest.module?.databases ?? []) {
    for (const column of database.columns) {
      if (!column.relationTarget) continue;
      const target = column.relationTarget.includes(".")
        ? column.relationTarget
        : moduleRecordsSpecId(manifest.name, column.relationTarget);
      if (!known.has(target)) missing.add(column.relationTarget);
    }
  }
  return [...missing].sort();
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
      /** `select`/`status`/`multiselect` only — the choices the column offers. */
      options?: string[] | undefined;
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
        ...(op.options?.length ? { options: [...op.options] } : {}),
        ...(op.position ? { position: op.position } : {}),
      } as AddedColumn);
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
