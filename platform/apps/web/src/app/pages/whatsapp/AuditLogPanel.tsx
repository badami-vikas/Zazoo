import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { trpc } from "../../lib/trpc";

/**
 * The Analytics and Audit Log panel.
 *
 * Every number here is a count of BRIDGE's own actions. There is deliberately
 * no "messages received", no "most active contact" and no engagement chart:
 * producing those would mean reading the WhatsApp account as an analytics
 * source, which is both fresh read volume against a personal number and a kind
 * of measurement of other people that nobody asked for.
 *
 * So the panel answers a narrower and more useful question — what did Bridge
 * do, and when it declined to send, why. When Bridge has done nothing, it says
 * so rather than rendering an empty chart that looks like a zero.
 */

type AuditLog = Awaited<ReturnType<typeof trpc.whatsapp.auditLog.query>>;
type AuditEvent = AuditLog["events"][number];

/** Windows offered. `null` is the whole retained log. */
const WINDOWS: { id: string; label: string; days: number | null }[] = [
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "all", label: "Everything kept", days: null },
];

const KIND_LABEL: Record<string, string> = {
  send_attempted: "Send attempted",
  send_sent: "Message sent",
  send_refused: "Send refused",
  send_deferred: "Send deferred",
  send_needs_approval: "Send needs approval",
  sync_run: "Messages synced",
  extraction_run: "Contacts extracted",
  rule_fired: "Automation rule fired",
  rule_skipped: "Automation rule skipped",
  automation_halted: "Automation halted",
  automation_rearmed: "Automation re-armed",
};

function labelFor(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function detailText(event: AuditEvent): string {
  if (!event.detail) return "";
  return Object.entries(event.detail)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

export function AuditLogPanel() {
  const [log, setLog] = useState<AuditLog | null>(null);
  const [windowId, setWindowId] = useState("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const window = WINDOWS.find((candidate) => candidate.id === id);
      const sinceIso =
        window?.days == null
          ? undefined
          : new Date(Date.now() - window.days * 86_400_000).toISOString();
      setLog(
        await trpc.whatsapp.auditLog.query({
          limit: 100,
          ...(sinceIso ? { sinceIso } : {}),
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(windowId);
  }, [load, windowId]);

  const muted = { color: "var(--color-navy-mid)" };
  const border = { borderColor: "var(--color-border)" };

  if (error && !log) {
    return <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>;
  }
  if (!log) {
    return <p className="text-sm" style={muted}>Loading Bridge's activity…</p>;
  }

  const { summary, events } = log;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border px-2 py-1 text-sm"
          style={border}
          value={windowId}
          onChange={(event) => setWindowId(event.target.value)}
        >
          {WINDOWS.map((window) => (
            <option key={window.id} value={window.id}>{window.label}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(windowId)}>
          Refresh
        </Button>
        {loading ? <span className="text-xs" style={muted}>Loading…</span> : null}
      </div>

      {summary.total === 0 ? (
        // Honest empty state. Distinguishes "nothing happened" from "retention
        // discarded it", because those mean very different things.
        <div className="rounded-md border p-3 text-sm" style={border}>
          <p>Bridge has not recorded any activity in this window.</p>
          <p className="mt-1 text-xs" style={muted}>
            {summary.dropped > 0
              ? `${summary.dropped} older ${summary.dropped === 1 ? "entry has" : "entries have"} been discarded by retention, so this may not mean nothing happened. Try a wider window.`
              : "Rows appear here as Bridge acts — when it syncs messages, stages an extraction, or attempts a send."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "Attempted", value: summary.sends.attempted },
              { label: "Sent", value: summary.sends.sent },
              { label: "Refused", value: summary.sends.refused },
              { label: "Deferred", value: summary.sends.deferred },
              { label: "Needs approval", value: summary.sends.needsApproval },
            ].map((cell) => (
              <div key={cell.label} className="rounded-md border p-2" style={border}>
                <div className="text-lg font-medium" style={{ color: "var(--color-navy)" }}>
                  {cell.value}
                </div>
                <div className="text-xs" style={muted}>{cell.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs" style={muted}>
            Send counts only. Bridge does not measure your WhatsApp account —
            everything above is an action Bridge itself took.
          </p>

          {summary.refusalsByRule.length > 0 ? (
            <div className="space-y-1">
              <span className="text-xs font-medium" style={muted}>Why sends did not go out</span>
              <ul className="space-y-1">
                {summary.refusalsByRule.map((entry) => (
                  <li key={entry.rule} className="rounded-md border p-2 text-sm" style={border}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{entry.rule}</span>
                      <span style={muted}>{entry.count}</span>
                    </div>
                    {entry.reason ? (
                      <p className="mt-0.5 text-xs" style={muted}>{entry.reason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1">
            <span className="text-xs font-medium" style={muted}>What Bridge did</span>
            <ul className="flex flex-wrap gap-1">
              {summary.byKind.map((entry) => (
                <li key={entry.kind} className="rounded-full border px-2 py-0.5 text-xs" style={border}>
                  {labelFor(entry.kind)} · {entry.count}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium" style={muted}>Log</span>
              <span className="text-xs" style={muted}>
                {events.length < summary.total
                  ? `Newest ${events.length} of ${summary.total}`
                  : `${summary.total} ${summary.total === 1 ? "entry" : "entries"}`}
              </span>
            </div>
            <ul className="max-h-96 space-y-1 overflow-auto rounded-md border p-2" style={border}>
              {events.map((event) => (
                <li key={event.id} className="rounded-md border p-2 text-sm" style={border}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{labelFor(event.kind)}</span>
                    <span className="text-xs" style={muted}>
                      {new Date(event.at).toLocaleString()}
                    </span>
                  </div>
                  {event.reason ? (
                    <p className="mt-0.5 text-xs" style={muted}>{event.reason}</p>
                  ) : null}
                  {event.rule ? (
                    <p className="mt-0.5 text-xs" style={muted}>Rule: {event.rule}</p>
                  ) : null}
                  {event.subjectKey ? (
                    <p className="mt-0.5 truncate text-xs" style={muted}>{event.subjectKey}</p>
                  ) : null}
                  {event.detail ? (
                    <p className="mt-0.5 text-xs" style={muted}>{detailText(event)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {summary.dropped > 0 ? (
              <p className="text-xs" style={muted}>
                {summary.dropped} older {summary.dropped === 1 ? "entry has" : "entries have"} been
                discarded by retention.
              </p>
            ) : null}
          </div>
        </>
      )}

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}
    </div>
  );
}
