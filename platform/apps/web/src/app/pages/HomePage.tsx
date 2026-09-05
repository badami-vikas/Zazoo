import { useEffect, useState } from "react";
import { ArrowRight, Boxes, CalendarClock, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type InstalledModule = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

type MorningBrief = Awaited<ReturnType<typeof trpc.brief.morning.query>>;
type BriefPerson = Awaited<ReturnType<typeof trpc.relationship.listPeople.query>>["items"][number];

const BUCKET_LABELS = [
  ["overdue", "Overdue"],
  ["dueToday", "Due today"],
  ["upcoming", "Upcoming"],
] as const;

/**
 * K6 (TASK-050) — the morning brief: the visible daily payoff. Every section
 * is a live read of real stores (`brief.morning`); an unreachable API renders
 * nothing dead, and an empty morning says so honestly. Commitment suggestions
 * are reviewed HERE: the person link is the human's choice (the detector's
 * hint only preselects when exactly one Person matches), Accept materializes
 * through the governed pipeline, Reject silences that sentence forever.
 */
function MorningBriefCard() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [people, setPeople] = useState<BriefPerson[]>([]);
  const [personChoice, setPersonChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    trpc.brief.morning
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(setBrief)
      .catch(() => setBrief(null)); // unreachable API = render nothing dead
    trpc.relationship.listPeople
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((result) => setPeople(result.items))
      .catch(() => setPeople([]));
  }
  useEffect(refresh, []);

  if (!brief) return null;

  const suggestions = brief.suggestions.commitments;
  const bucketsEmpty = BUCKET_LABELS.every(([key]) => brief.commitments[key].length === 0);
  const quiet =
    bucketsEmpty && suggestions.length === 0 && brief.approvals.total === 0 &&
    brief.recentActivity.length === 0;

  function chosenPersonId(suggestionId: string, hint: string | null): string {
    const explicit = personChoice[suggestionId];
    if (explicit) return explicit;
    if (hint) {
      const matches = people.filter((person) =>
        (person.displayName ?? "").toLowerCase().includes(hint.toLowerCase()),
      );
      if (matches.length === 1) return matches[0]!.id;
    }
    return "";
  }

  async function acceptSuggestion(suggestionId: string, hint: string | null) {
    const personId = chosenPersonId(suggestionId, hint);
    if (!personId) {
      setMessage("Choose which Person this commitment is to before accepting.");
      return;
    }
    try {
      await trpc.learning.commitments.accept.mutate({
        organizationId: PILOT_ORGANIZATION,
        suggestionMemoryId: suggestionId,
        personId,
      });
      setMessage("Commitment created. It now shows in the buckets above and on the Person's page.");
    } catch (error) {
      setMessage(String(error));
    }
    refresh();
  }

  async function rejectSuggestion(suggestionId: string) {
    try {
      await trpc.learning.commitments.reject.mutate({
        organizationId: PILOT_ORGANIZATION,
        suggestionMemoryId: suggestionId,
      });
      setMessage("Dismissed. That sentence will not be suggested again.");
    } catch (error) {
      setMessage(String(error));
    }
    refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
        <h2 className="font-semibold" style={{ color: "var(--color-navy)" }}>Today</h2>
        <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          as of {new Date(brief.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {quiet ? (
        <p className="text-sm" style={{ color: "var(--color-warm-gray)" }}>
          Nothing needs you right now — no open commitments, suggestions, or waiting approvals.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {BUCKET_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-lg border p-3" style={{ borderColor: key === "overdue" && brief.commitments.overdue.length > 0 ? "var(--danger)" : "var(--color-border)" }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: key === "overdue" && brief.commitments.overdue.length > 0 ? "var(--danger)" : "var(--color-warm-gray)" }}>
                  {label} · {brief.commitments[key].length}
                </p>
                {brief.commitments[key].length === 0 ? (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>None.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {brief.commitments[key].map((item) => (
                      <li key={item.id} className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
                        {item.text}
                        <span className="block text-xs" style={{ color: "var(--color-warm-gray)" }}>
                          {item.personName ?? "Unlinked"}{item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {brief.nextActions.length > 0 && (
            <ul className="space-y-1">
              {brief.nextActions.map((line) => (
                <li key={line} className="text-sm" style={{ color: "var(--color-navy-mid)" }}>• {line}</li>
              ))}
            </ul>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>
                Noticed in your own messages — track these?
              </p>
              {suggestions.map((suggestion) => (
                <div key={suggestion.memoryId} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--color-border)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--color-navy)" }}>“{suggestion.candidate.text}”</p>
                    <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                      {suggestion.candidate.dueHint ? `Due ${suggestion.candidate.dueHint} · ` : ""}accepting creates a Commitment you can inspect, complete, or archive.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={chosenPersonId(suggestion.memoryId, suggestion.candidate.counterpartyHint)}
                      onChange={(event) => setPersonChoice((prev) => ({ ...prev, [suggestion.memoryId]: event.target.value }))}
                      className="rounded-lg border px-2 py-1.5 text-xs"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}
                      aria-label="Person this commitment is to"
                    >
                      <option value="">Person…</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>{person.displayName ?? person.id}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void acceptSuggestion(suggestion.memoryId, suggestion.candidate.counterpartyHint)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: "var(--color-steel)" }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void rejectSuggestion(suggestion.memoryId)}
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approvals belong to Tasks (ADR 2026-09-04): each one waiting is named
              with its Task and opens there; the count links to the full queue.
              TASK-097: ordered by the brief's `importance` (external > write >
              read, untrusted first, oldest first) and labelled with its tier. */}
          {brief.approvals.total > 0 && (
            <div className="flex flex-col gap-1 text-xs">
              {[...brief.approvals.items]
                .sort((a, b) => a.importance.rank - b.importance.rank || a.createdAt.localeCompare(b.createdAt))
                .slice(0, 5)
                .map((item) => (
                <Link
                  key={item.proposalId}
                  to={item.task ? `/task-manager/${item.task.taskId}#approvals` : "/approvals"}
                  className="no-underline hover:underline"
                  style={{ color: "var(--color-navy)" }}
                >
                  <span className="font-semibold">{item.skill ?? `${item.action} ${item.resourceType}`}</span>
                  {item.task ? ` · ${item.task.title}` : item.resource ? ` · ${item.resource}` : ""}
                  <span className="ml-1.5 uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>
                    {item.importance.tier}{item.importance.untrusted ? " · untrusted" : ""}
                  </span>
                </Link>
              ))}
              <Link to="/approvals" className="font-semibold" style={{ color: "var(--color-steel)" }}>
                {brief.approvals.total} approval{brief.approvals.total === 1 ? "" : "s"} waiting →
              </Link>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
            {brief.recentActivity.map((activity) => (
              <span key={activity.moduleId}>
                {activity.moduleId}: {activity.count} signal{activity.count === 1 ? "" : "s"} in 24h
              </span>
            ))}
          </div>
        </>
      )}
      {message && <p className="text-xs" style={{ color: "var(--color-steel)" }}>{message}</p>}
    </section>
  );
}

export function HomePage() {
  const [modules, setModules] = useState<InstalledModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (!active) return;
        setModules(
          result.items.filter(
            (item) =>
              item.state === "available" &&
              item.status === "installed" &&
              item.manifest.module !== undefined &&
              item.moduleAttachment === undefined,
          ),
        );
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setModules([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-steel)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Living Software
          </div>
          <h1
            style={{
              color: "var(--color-navy)",
              fontFamily: "var(--font-editorial)",
              fontSize: "34px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Your installed Modules
          </h1>
          <p style={{ color: "var(--color-warm-gray)", maxWidth: 640 }}>
            Open a Module to work with its real Records, Agents, Automations, Integrations, Files, and Results.
          </p>
        </div>

        <MorningBriefCard />

        {modules === null && !error ? (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--color-border)" }}>
            Loading installed Modules...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            Installed Modules could not be loaded: {error}
          </div>
        ) : null}

        {modules && modules.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {modules.map((item) => {
              const module = item.manifest.module!;
              return (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border bg-white p-5"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ backgroundColor: "color-mix(in srgb, var(--color-steel) 12%, transparent)" }}
                    >
                      <Boxes className="h-5 w-5" style={{ color: "var(--color-steel)" }} />
                    </div>
                    <div>
                      <h2 className="font-semibold" style={{ color: "var(--color-navy)" }}>{module.displayName}</h2>
                      <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Version {item.moduleVersion}</p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-navy-mid)" }}>
                    {item.manifest.description}
                  </p>
                  <Link
                    to={`/module/${item.moduleName}`}
                    className="inline-flex items-center gap-1.5 self-start text-sm font-semibold"
                    style={{ color: "var(--color-steel)" }}
                  >
                    Open Module <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : null}

        {modules && modules.length === 0 && !error ? (
          <div
            className="rounded-xl border border-dashed p-10 text-center"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No Modules are installed yet. Install a trusted Module from Settings.
          </div>
        ) : null}
      </div>
    </div>
  );
}
