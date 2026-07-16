/**
 * Client-side pin persistence (ADR-023 item 1: "pinned Projects + pinned
 * Tools ... Pinning can be a simple client-side persisted list (localStorage)
 * for now"). Server-side pin persistence is real, tracked debt — filed in
 * docs/BUGS.md rather than silently left as the permanent mechanism; there is
 * no `pins`/`user_preferences` table or tRPC procedure to persist this
 * per-user server-side yet.
 *
 * A pin is just a navigable link — { id, label, to } — not a fabricated
 * domain object. There is no global Knowledge destination; Project pins stay
 * empty until a Module-owned routable Record Detail exists.
 */
export interface PinnedItem {
  id: string;
  label: string;
  to: string;
}

const STORAGE_KEY_PROJECTS = "bridge.pins.projects";
const STORAGE_KEY_TOOLS = "bridge.pins.tools";

/** No fabricated pins — these are the only real, currently-routable
 * destinations for each kind, used only when the user's own localStorage
 * list is empty (first run). The user can unpin them like any other pin. */
const DEFAULT_PROJECT_PINS: PinnedItem[] = [];
const DEFAULT_TOOL_PINS: PinnedItem[] = [
  // Approvals + Signals = TWO separate pinned governance tools by default
  // (user revision 2026-07-06 splitting the earlier tabs-merge back apart).
  { id: "approvals", label: "Approvals", to: "/approvals" },
  { id: "signals", label: "Signals", to: "/module/relationship/signals" },
  { id: "dealpilot", label: "DealPilot", to: "/dealpilot" },
  { id: "jobpilot", label: "JobPilot", to: "/jobpilot" },
  { id: "helpdesk", label: "Helpdesk", to: "/module/relationship/helpdesk" },
  { id: "chief-of-staff", label: "Chief of Staff", to: "/chief-of-staff" },
];

function read(key: string, fallback: PinnedItem[]): PinnedItem[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function write(key: string, items: PinnedItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Honest no-op — localStorage unavailable (private browsing, quota) should
    // not crash the shell; pins just won't persist this session.
  }
}

export function getPinnedProjects(): PinnedItem[] {
  return read(STORAGE_KEY_PROJECTS, DEFAULT_PROJECT_PINS);
}

export function getPinnedTools(): PinnedItem[] {
  return read(STORAGE_KEY_TOOLS, DEFAULT_TOOL_PINS);
}

export function setPinnedProjects(items: PinnedItem[]): void {
  write(STORAGE_KEY_PROJECTS, items);
}

export function setPinnedTools(items: PinnedItem[]): void {
  write(STORAGE_KEY_TOOLS, items);
}

export function unpinProject(id: string): PinnedItem[] {
  const next = getPinnedProjects().filter((p) => p.id !== id);
  setPinnedProjects(next);
  return next;
}

export function unpinTool(id: string): PinnedItem[] {
  const next = getPinnedTools().filter((p) => p.id !== id);
  setPinnedTools(next);
  return next;
}
