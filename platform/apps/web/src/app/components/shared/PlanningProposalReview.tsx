import { useMemo, useState } from "react";
import { PencilLine, ShieldCheck } from "lucide-react";
import {
  editWouldMaterialize,
  readPlanningProposal,
  toEditedPlanningItems,
  type PlanningReviewEntry,
} from "../../data/task-proposal-review";

/**
 * The surface a reviewer decides a planning draft on (ADR-208).
 *
 * ADR-200 made `candidate` proposals editable and recorded the residual every
 * slice after it repeated verbatim: nothing in the product could fetch a draft,
 * show its entries, or send a corrected one. A decision only the API can reach
 * is not a review.
 *
 * Deliberately thin: every rule about what may be edited lives in
 * `task-proposal-review.ts`, which is where it can be tested. This renders
 * what that returns and nothing else — including the refusals, because a
 * pre-mortem still has to be READABLE to be approved or vetoed.
 */
export function PlanningProposalReview({
  payload,
  busy = false,
  onDecide,
}: {
  payload: Readonly<Record<string, unknown>> | null | undefined;
  busy?: boolean;
  onDecide: (
    decision: "approve" | "edit" | "veto",
    editedPlanningItems?: Array<Record<string, unknown>>,
  ) => void | Promise<void>;
}) {
  const review = useMemo(() => readPlanningProposal(payload), [payload]);
  const [edited, setEdited] = useState<PlanningReviewEntry[] | null>(null);
  const entries = edited ?? review.entries;
  const dirty = edited !== null;
  const canSendEdit = dirty && editWouldMaterialize(review, entries);

  function change(index: number, field: keyof PlanningReviewEntry, value: string) {
    setEdited((current) => (current ?? review.entries).map((entry, position) =>
      position === index ? { ...entry, [field]: value } : entry,
    ));
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--color-steel)]" />
        <h2 className="text-sm font-semibold">
          Pending Human review: {review.kind ? review.kind.split("_").join(" ") : "planning draft"}
        </h2>
        {review.scaffold && (
          // Zero drafted items from a scaffold is not "the methodology found
          // nothing" — it is "no model was configured to answer it" (ADR-197).
          // Saying so is what keeps someone from approving an empty plan.
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
            Playbook scaffold — no model drafted this
          </span>
        )}
      </div>

      {review.refusal && <p className="mb-3 text-sm text-muted-foreground">{review.refusal}</p>}

      {/* The Skill's own explanation of why it drafted nothing. Without it a
          scaffold reads as "the methodology found nothing", which is a
          different and much worse claim than "no model was configured". */}
      {review.note && <p className="mb-3 text-sm text-muted-foreground">{review.note}</p>}

      {review.prompts.length > 0 && (
        <div className="mb-3">
          {review.methodology && (
            <p className="mb-1 text-xs font-medium text-muted-foreground">{review.methodology}</p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {review.prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
          </ul>
        </div>
      )}

      {entries.length > 0 && (
        <ol className="mb-3 space-y-3">
          {entries.map((entry, index) => (
            <li key={entry.index} className="rounded-md border p-3">
              {review.fields.map((field) => (
                <label key={field} className="mb-2 block text-xs last:mb-0">
                  <span className="mb-1 block text-muted-foreground">{FIELD_LABELS[field]}</span>
                  <input
                    value={entry[field] ?? ""}
                    disabled={!review.editable || busy}
                    onChange={(event) => change(index, field, event.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                  />
                </label>
              ))}
              {entry.taskId && (
                // Read-only on purpose: a finding's whole justification is the
                // row it came from, so re-homing it would be a new finding.
                <p className="mt-1 text-xs text-muted-foreground">From Task {entry.taskId}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {dirty && !canSendEdit && (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          This edit would create nothing. Veto the proposal instead of approving a plan that writes nothing.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || dirty}
          onClick={() => void onDecide("approve")}
          className="rounded-md bg-[var(--color-navy)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Approve as drafted
        </button>
        {review.editable && (
          <button
            type="button"
            disabled={busy || !canSendEdit}
            onClick={() => void onDecide("edit", toEditedPlanningItems(review, entries))}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <PencilLine className="size-3.5" /> Approve my edits
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDecide("veto")}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Veto
        </button>
      </div>
    </section>
  );
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Title",
  exitTest: "Exit test",
  measure: "Measure",
  target: "Target",
  indicatorKind: "Indicator (leading or lagging)",
};
