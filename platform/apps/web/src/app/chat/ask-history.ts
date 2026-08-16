/**
 * ask-history — the companion's screen-and-voice asks, kept on THIS DEVICE so
 * they can be read back later (user directive 2026-08-16: their sessions belong
 * in the Chat history dropdown, read-only, "just for history of prompts and
 * results").
 *
 * Local Plane, deliberately. An ask answer can be screen-derived — the model
 * may have been looking at a screenshot when it produced the text — so the
 * transcript stays in this device's webview storage and is never sent anywhere.
 * `companion.rs` still persists nothing; the answer is recorded here, on the
 * surface that received it, after the fact. Recording history does not widen
 * what leaves the machine: the screenshot egress decision is still the
 * per-question consent in the ask panel and nothing else.
 *
 * Storage is shared across the app's webviews (main window and overlay run on
 * one origin), which is what lets an ask made from the floating companion show
 * up in the Home Page's chat history.
 *
 * A "session" here matches the ask panel's own idle-bounded conversation: the
 * same gap that clears the model's working memory starts a new session, so what
 * the reader sees grouped is exactly what the model treated as one exchange.
 */

const STORAGE_KEY = "bridge.companion.ask-history.v1";
/** Newest-first cap. Local history is a convenience, not an archive — an
 * unbounded list in webview storage is a slow leak nobody ever notices. */
const MAX_SESSIONS = 25;
const MAX_TURNS_PER_SESSION = 40;
/** Fired when this device's history changes, so an open Chat panel in the SAME
 * webview refreshes. Other webviews get the browser's own `storage` event. */
export const ASK_HISTORY_EVENT = "bridge:ask-history";

export interface AskHistoryTurn {
  question: string;
  answer: string;
  /** Which model answered — the same provider tag the panel shows. */
  provider: string;
  /** True when a screenshot was shared for this question. Recorded because
   * "what did it see when it said that" is the first thing worth knowing when
   * reading an old answer back. */
  screenShared: boolean;
  at: string;
}

export interface AskHistorySession {
  id: string;
  startedAt: string;
  turns: AskHistoryTurn[];
}

function isSession(value: unknown): value is AskHistorySession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.startedAt === "string" &&
    Array.isArray(candidate.turns)
  );
}

export function readAskSessions(): AskHistorySession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSession);
  } catch {
    // Unreadable history is no history — never break the panel over it.
    return [];
  }
}

/** Appends one answered question to its session, creating the session on the
 * first turn. Returns false when the write failed, so a caller can stay honest
 * about history it did not actually keep. */
export function appendAskTurn(
  session: { id: string; startedAt: string },
  turn: AskHistoryTurn,
): boolean {
  try {
    const sessions = readAskSessions();
    const existing = sessions.find((entry) => entry.id === session.id);
    if (existing) {
      existing.turns = [...existing.turns, turn].slice(-MAX_TURNS_PER_SESSION);
    } else {
      sessions.unshift({ id: session.id, startedAt: session.startedAt, turns: [turn] });
    }
    const ordered = [...sessions]
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, MAX_SESSIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
    window.dispatchEvent(new CustomEvent(ASK_HISTORY_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** True when `key` is a change this device's ask history should react to —
 * including the null key a full storage clear reports. */
export function isAskHistoryStorageKey(key: string | null): boolean {
  return key === null || key === STORAGE_KEY;
}

export function askSessionLabel(session: AskHistorySession): string {
  const when = new Date(session.startedAt).toLocaleDateString();
  const first = session.turns[0]?.question ?? "(no question)";
  const question = first.length > 48 ? `${first.slice(0, 48)}…` : first;
  return `Ask · ${question} · ${when}`;
}
