/**
 * What a reviewer sees, and what an edit sends back (ADR-208).
 *
 * ADR-200 made a planning proposal editable and recorded the honest residual
 * every slice since repeated: **no UI reaches the edit**. `decideProposal`
 * accepted `editedPlanningItems`, and nothing could fetch a draft, show its
 * entries, or send a corrected one — the decision was API-reachable and not
 * human-reachable, which for a review surface means it did not exist.
 *
 * The logic lives here rather than inside the component because this is the
 * part that can be WRONG: which key of the payload holds the entries, which
 * kinds refuse an edit, and which fields a given kind actually materializes
 * from. A component can only render what this returns.
 *
 * `EDITABLE_CONTENT_KEY` is imported from the materializer rather than copied.
 * A surface with its own copy shows an empty list the moment a planning kind
 * is added there — the reviewer would read "this plan proposes nothing" about
 * a plan that proposes plenty, and approve it believing that.
 */
import { EDITABLE_CONTENT_KEY } from "@bridge/core";

/** One row a reviewer can read and correct. Every field is optional except
 * the label, because the kinds materialize from different fields and a form
 * showing all of them for every kind would invite edits that are dropped. */
export interface PlanningReviewEntry {
  /** Position in the staged array. The wire format is positional, so this is
   * how an edited row finds its way back to the entry it corrects. */
  index: number;
  title: string;
  exitTest?: string;
  measure?: string;
  target?: string;
  indicatorKind?: "leading" | "lagging";
  /** `opportunity_scan` only: the Task this finding came from. Read-only —
   * the finding's whole justification is that specific row (ADR-199). */
  taskId?: string;
}

/** Which fields of an entry this kind materializes from. Anything else shown
 * would be an edit the materializer silently drops. */
export type PlanningEditableField = "title" | "exitTest" | "measure" | "target" | "indicatorKind";

const EDITABLE_FIELDS: Readonly<Record<string, readonly PlanningEditableField[]>> = {
  task_decomposition: ["title", "exitTest"],
  candidate_task_generation: ["title"],
  // Only the first entry is materialized (the Skill orders them
  // cheapest-to-run first), but every candidate is editable and reorderable —
  // choosing which exit test to keep IS the edit here.
  exit_test_authoring: ["exitTest"],
  opportunity_scan: ["title"],
  goal_outcome_framing: ["title", "measure", "target", "indicatorKind"],
};

export interface PlanningReview {
  kind: string;
  /** False when this kind refuses an edit, with `refusal` saying why. */
  editable: boolean;
  refusal: string | null;
  fields: readonly PlanningEditableField[];
  entries: readonly PlanningReviewEntry[];
  /** The technique's questions, under the payload's own `prompts` key.
   * ALWAYS present (`task-playbooks.ts`): with a model they explain how the
   * draft was reached, and in scaffold mode they ARE the answer. */
  prompts: readonly string[];
  /** The Playbook that produced this, so a reviewer can see which methodology
   * they are accepting the output of rather than only its conclusions. */
  methodology: string | null;
  /** The Skill's own explanation when it degraded — why nothing was drafted. */
  note: string | null;
  /** Present when the Skill degraded to its Playbook scaffold. */
  scaffold: boolean;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function entriesOf(payload: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Read a staged planning proposal into something a reviewer can act on.
 *
 * Never throws: a proposal that cannot be edited still has to be READABLE, so
 * a reviewer can decide whether to approve or veto it. The refusal is data,
 * not an exception — a review surface that crashes on a pre-mortem would make
 * the one kind with nothing to edit also the one kind nobody can see.
 */
export function readPlanningProposal(
  payload: Readonly<Record<string, unknown>> | null | undefined,
): PlanningReview {
  const kind = typeof payload?.["kind"] === "string" ? (payload["kind"] as string) : "";
  const prompts = Array.isArray(payload?.["prompts"])
    ? (payload["prompts"] as unknown[]).map(str).filter((value): value is string => value !== undefined)
    : [];
  const scaffold = payload?.["source"] === "playbook_scaffold";
  const base = {
    kind,
    prompts,
    scaffold,
    methodology: str(payload?.["methodology"]) ?? null,
    note: str(payload?.["note"]) ?? null,
  };

  if (kind === "premortem_scenario") {
    return {
      ...base,
      editable: false,
      // The same sentence the API refuses with, so the surface never invites
      // an edit the server would reject.
      refusal: "A pre-mortem has nothing an edit could change — approving one writes nothing to the queue by design. Approve it or veto it.",
      fields: [],
      entries: [],
    };
  }

  const key = EDITABLE_CONTENT_KEY[kind];
  if (!key) {
    return {
      ...base,
      editable: false,
      refusal: kind
        ? `This proposal is a ${kind.split("_").join(" ")}, which is approved or vetoed rather than edited.`
        : "This proposal carries no planning draft to review.",
      fields: [],
      entries: [],
    };
  }

  const fields = EDITABLE_FIELDS[kind] ?? [];
  const entries: PlanningReviewEntry[] = [];
  entriesOf(payload!, key).forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const draft = raw as Record<string, unknown>;
    // `opportunity_scan` names its title `proposedTitle`, because the finding
    // is a proposal about a Task rather than the Task itself. Normalized here
    // so the surface has one label field instead of a per-kind branch.
    const title = str(draft["title"]) ?? str(draft["proposedTitle"]) ?? "";
    entries.push({
      index,
      title,
      ...(str(draft["exitTest"]) ? { exitTest: str(draft["exitTest"])! } : {}),
      ...(str(draft["measure"]) ? { measure: str(draft["measure"])! } : {}),
      ...(str(draft["target"]) ? { target: str(draft["target"])! } : {}),
      ...(draft["indicatorKind"] === "leading" || draft["indicatorKind"] === "lagging"
        ? { indicatorKind: draft["indicatorKind"] as "leading" | "lagging" }
        : {}),
      ...(str(draft["taskId"]) ? { taskId: str(draft["taskId"])! } : {}),
    });
  });

  return { ...base, editable: true, refusal: null, fields, entries };
}

/**
 * Turn edited entries back into the wire shape `decideProposal` accepts.
 *
 * Only the fields this kind materializes from are sent. The API schema is
 * `.strict()`, so sending a field the kind ignores is a 400 rather than a
 * silent drop — and building the payload from the kind's own field list is
 * what keeps that from happening.
 *
 * `taskId` rides along for `opportunity_scan` because the materializer needs
 * it to place the candidate under the Task the finding named; it is not
 * editable, it is carried.
 */
export function toEditedPlanningItems(
  review: PlanningReview,
  entries: readonly PlanningReviewEntry[],
): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    const item: Record<string, unknown> = {};
    for (const field of review.fields) {
      const value = entry[field];
      if (typeof value === "string" && value.trim().length > 0) {
        // The scan's label travels back under the name the materializer
        // parses it by, not the one the surface displays it by.
        if (field === "title" && review.kind === "opportunity_scan") item["proposedTitle"] = value.trim();
        else item[field] = value.trim();
      }
    }
    if (review.kind === "opportunity_scan" && entry.taskId) item["taskId"] = entry.taskId;
    return item;
  });
}

/**
 * Would this edit materialize anything?
 *
 * The API refuses an edit that writes nothing — "an approval that writes
 * nothing is a veto wearing an approval's clothes" (ADR-200). Checking it
 * here too is not duplication for its own sake: it lets the surface disable
 * the button and say why, instead of sending a request whose refusal the
 * reviewer has to interpret. The server check is still the one that counts.
 */
export function editWouldMaterialize(
  review: PlanningReview,
  entries: readonly PlanningReviewEntry[],
): boolean {
  if (!review.editable) return false;
  return toEditedPlanningItems(review, entries).some((item) => {
    if (review.kind === "goal_outcome_framing") {
      // The Playbook exists to produce MEASURABLE outcomes; one missing its
      // measure or target is exactly what it is meant to prevent.
      return Boolean(item["title"] && item["measure"] && item["target"]);
    }
    if (review.kind === "exit_test_authoring") return Boolean(item["exitTest"]);
    if (review.kind === "opportunity_scan") return Boolean(item["proposedTitle"] && item["taskId"]);
    return Boolean(item["title"]);
  });
}
