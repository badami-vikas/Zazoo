import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";

type EventsResult = Awaited<ReturnType<typeof trpc.google.listEvents.mutate>>;

/**
 * Minimal Calendar surface: lists Google Calendar events via `google.listEvents`
 * (read-only projection, auto-approved) and offers a `google.syncCalendar` action to
 * pull events through the governed pipeline as Touchpoint proposals. This does NOT port
 * the prototype's full month/week/day/agenda grid + create/edit/delete drawer
 * (`Design Bridge AI Interface (Copy)/src/app/pages/CalendarPage.tsx`) — that visual/CRUD
 * richness is explicitly out of scope for this pass; it proves the migration pattern with
 * a functional list view.
 */
export function CalendarPage() {
  const [events, setEvents] = useState<EventsResult["events"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setBusy("load");
    setError(null);
    trpc.google.listEvents
      .mutate({ maxResults: 50 })
      .then((res) => setEvents(res.events))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null));
  }

  useEffect(load, []);

  async function sync() {
    setBusy("sync");
    setError(null);
    try {
      await trpc.google.syncCalendar.mutate({ maxResults: 50 });
      load();
    } catch (err) {
      setError(String(err));
      setBusy(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Calendar</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={busy !== null}>
            {busy === "load" ? "Loading…" : "Refresh"}
          </Button>
          <Button onClick={sync} disabled={busy !== null}>
            {busy === "sync" ? "Syncing…" : "Sync Calendar"}
          </Button>
        </div>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!events && !error && <div className="text-sm text-muted-foreground">Loading…</div>}
      {events && (
        <ul className="divide-y">
          {events.map((e: { eventId: string; summary: string; start: string; end?: string; location?: string }) => (
            <li key={e.eventId} className="py-2 text-sm">
              <div className="font-medium">{e.summary}</div>
              <div className="text-xs text-muted-foreground">
                {e.start}
                {e.end ? ` – ${e.end}` : ""}
                {e.location ? ` · ${e.location}` : ""}
              </div>
            </li>
          ))}
          {events.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No events.</li>
          )}
        </ul>
      )}
    </div>
  );
}
