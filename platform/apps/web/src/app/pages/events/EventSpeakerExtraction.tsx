import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

export interface EventOption {
  id: string;
  name: string;
  url?: string | undefined;
}

type SpeakerDraft = Awaited<ReturnType<typeof trpc.events.extraction.drafts.query>>[number];
type OutreachDraft = Awaited<ReturnType<typeof trpc.events.outreach.list.query>>[number];

const TIER_LABEL: Record<string, string> = {
  strong: "Strong match",
  moderate: "Possible match",
  flag: "Weak match",
  none: "No match — new Person",
};

const MUTED = { color: "var(--color-navy-mid)" } as const;
const BORDER = { borderColor: "var(--color-border)" } as const;

/**
 * The speaker-extraction review queue (TASK-070 follow-on) — run extraction
 * over an Event's URL, then approve/reject each drafted speaker one at a
 * time. Never a bulk "approve all": every tier, including `strong`, is a
 * human decision (see `events.extraction.decide`'s doc comment).
 */
export function EventSpeakerExtraction({ events }: { events: EventOption[] }) {
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [drafts, setDrafts] = useState<SpeakerDraft[]>([]);
  const [outreach, setOutreach] = useState<OutreachDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  async function reload(eventId: string) {
    const [pendingDrafts, notes] = await Promise.all([
      trpc.events.extraction.drafts.query({ organizationId: PILOT_ORGANIZATION, eventId, status: "pending" }),
      trpc.events.outreach.list.query({ organizationId: PILOT_ORGANIZATION, eventId }),
    ]);
    setDrafts(pendingDrafts);
    setOutreach(notes);
  }

  useEffect(() => {
    setDrafts([]);
    setOutreach([]);
    setError(null);
    if (selectedEventId) void reload(selectedEventId);
  }, [selectedEventId]);

  async function runExtraction() {
    if (!selectedEvent?.url) {
      setError("This Event needs a URL before extraction can run.");
      return;
    }
    setError(null);
    setBusy("Fetching and extracting speakers…");
    try {
      await trpc.events.extraction.run.mutate({
        organizationId: PILOT_ORGANIZATION,
        eventId: selectedEvent.id,
        eventUrl: selectedEvent.url,
      });
      await reload(selectedEvent.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  }

  async function decide(draftId: string, decision: "approve" | "reject") {
    if (!selectedEvent) return;
    setError(null);
    setBusy(decision === "approve" ? "Approving…" : "Rejecting…");
    try {
      await trpc.events.extraction.decide.mutate({
        organizationId: PILOT_ORGANIZATION,
        eventId: selectedEvent.id,
        eventName: selectedEvent.name,
        draftId,
        decision,
      });
      await reload(selectedEvent.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  }

  if (events.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border px-2 py-1.5 text-sm"
          style={BORDER}
          value={selectedEventId}
          onChange={(evt) => setSelectedEventId(evt.target.value)}
        >
          <option value="">Choose an Event…</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => void runExtraction()} disabled={!selectedEventId || busy !== null}>
          Run speaker extraction
        </Button>
        {busy && <span className="text-xs" style={MUTED}>{busy}</span>}
      </div>

      {error && <p className="text-xs" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>}

      {selectedEventId && (
        <div className="space-y-2">
          <p className="text-xs font-medium" style={MUTED}>
            Pending review ({drafts.length})
          </p>
          {drafts.length === 0 ? (
            <p className="text-xs" style={MUTED}>No drafted speakers awaiting review.</p>
          ) : (
            <ul className="space-y-2">
              {drafts.map((draft) => (
                <li key={draft.id} className="rounded-md border p-2 flex items-center justify-between gap-2" style={BORDER}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{draft.name}</p>
                    <p className="text-xs truncate" style={MUTED}>
                      {draft.affiliation ?? "No affiliation found"} · {TIER_LABEL[draft.tier] ?? draft.tier}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => void decide(draft.id, "reject")} disabled={busy !== null}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => void decide(draft.id, "approve")} disabled={busy !== null}>
                      Approve
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {outreach.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium" style={MUTED}>
                Drafted outreach notes ({outreach.length}) — copy and send manually
              </p>
              <ul className="space-y-2">
                {outreach.map((note) => (
                  <li key={note.id} className="rounded-md border p-2 text-xs" style={BORDER}>
                    {note.noteText}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
