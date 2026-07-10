import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { Home, Target, Plus, Settings, Brain, BookOpen, CalendarDays, Lock } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "./lib/trpc";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";
import { AvatarOverlay } from "./avatar/AvatarOverlay";
import { hasStoredPrefs, loadAvatarPrefs, type AvatarPrefs } from "./avatar/avatar-store";
import { AgentPanel } from "./components/shared/AgentPanel";
import { NewModuleDialog } from "./components/NewModuleDialog";
import { useInitiatives } from "./data/initiatives";

/**
 * Shell IA v2 (requests.md R-017..R-020, ADR-029 — supersedes ADR-023's
 * six-container chrome): the primary nav is Apple-Notes-minimal —
 *
 *   Home → each Initiative (first-class nav items) → "+ New" → ─── → Settings
 *
 * No intermediate "Initiatives" index page; no pinned Projects/Tools sections.
 * Knowledge/Intelligence/Calendar (ADR-033's onboarding-spec progressive
 * capability model) ARE in primary nav, below the fold — Knowledge/Calendar
 * render "inactive" (muted + lock icon) until enough is connected to be
 * useful, but are always clickable, never a dead end. Settings is
 * PLATFORM-wide admin only; per-Initiative admin lives at
 * /initiative/:id/control-panel (the small slider icon on each nav item).
 *
 * Initiative nav items merge TWO real sources, deduped by id:
 *   - trpc `graph.listInitiatives` (DB-backed kernel rows)
 *   - the local useInitiatives store (user-created from the Work surface,
 *     localStorage — real user data, not seeded)
 * Honest empty state when both are empty.
 *
 * Visual language (Track C2, 2026-07-09): prototype icon-rail skin applied to
 * ADR-029 IA. Always-collapsed 76px rail, icon + label stacked + centered,
 * active left-stripe indicator, workspace avatar at top, bottom section pinned.
 * SlidersHorizontal removed from rail — control panels reachable from detail
 * pages; icon kept imported here would be dead code, so import removed too.
 */
export default function Layout() {
  const location = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [remoteInitiatives, setRemoteInitiatives] = useState<{ id: string; title: string }[] | null>(null);
  const [connectedSourceCount, setConnectedSourceCount] = useState(0);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const localInitiatives = useInitiatives();

  // Progressive-capability gating (ADR-033's onboarding spec: Knowledge/
  // Calendar are visible in nav from day one, but read "inactive" until
  // enough is connected to be useful — never a dead end, just an honest
  // locked state). Knowledge's threshold ("connect any 2 sources") is real
  // integration.list rows + Google being connected; Calendar's is Google
  // specifically, since it's the only calendar source wired today.
  useEffect(() => {
    trpc.integration.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 200, offset: 0 })
      .then((res) => setConnectedSourceCount((prev) => prev + res.total))
      .catch(() => {
        // Honest no-op: an unreachable API just keeps Knowledge/Calendar
        // showing their locked state rather than guessing they're connected.
      });
    trpc.google.list
      .query()
      .then((info) => {
        if (info.connection.connected) {
          setConnectedSourceCount((prev) => prev + 1);
          setCalendarConnected(true);
        }
      })
      .catch(() => {
        // Same honest no-op as above.
      });
  }, []);

  useEffect(() => {
    trpc.graph.listInitiatives
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then((res) => setRemoteInitiatives(res.items.map((i) => ({ id: i.id, title: i.title }))))
      .catch(() => setRemoteInitiatives([])); // honest no-op: API unreachable → local-only list
  }, [location.pathname]);

  useEffect(() => {
    trpc.workspace.blueprint.get
      .query({ workspaceId: PILOT_WORKSPACE })
      .then((res) => {
        // Existing users (a workspace already has an active blueprint) never
        // see onboarding forced back open; the avatar just defaults to a
        // neutral hatched owl if this browser never saved prefs (spec section
        // 4, item 4 — "no forced re-onboarding").
        const hasWorkspace = Boolean(res.definition);
        if (!hasWorkspace) setOnboardingOpen(true);
        if (!hasStoredPrefs()) setAvatarPrefs(loadAvatarPrefs(hasWorkspace));
      })
      .catch(() => {
        // Honest no-op: if the check itself fails (e.g. API unreachable), don't
        // force the modal open on top of an already-broken app shell.
      })
      .finally(() => setCheckedOnboarding(true));

    // Independent of the blueprint check above: load whatever prefs this
    // browser already has immediately, so the overlay doesn't flash/wait on
    // the network round-trip for returning users.
    if (hasStoredPrefs()) setAvatarPrefs(loadAvatarPrefs(true));
  }, []);

  useEffect(() => {
    trpc.workspace.list
      .query()
      .then((rows) => {
        const mine = rows.find((w) => w.id === PILOT_WORKSPACE);
        if (mine?.name) setWorkspaceName(mine.name);
      })
      .catch(() => {
        // Honest no-op — the avatar popover falls back to "Unnamed organization".
      });
  }, []);

  // Merge kernel + local initiative lists, kernel first, deduped by id. Local
  // items carry an optional moduleTo (set by NewModuleDialog) so an Initiative
  // created from a Module links straight to its real surface, not a generic
  // /initiative/:id detail page that has no data for it.
  const localItems = localInitiatives.map((i) => ({ id: i.id, title: i.name, moduleTo: i.moduleTo }));
  const remoteItems = (remoteInitiatives ?? []).map((i) => ({ ...i, moduleTo: undefined as string | undefined }));
  const seen = new Set(remoteItems.map((i) => i.id));
  const initiatives = [...remoteItems, ...localItems.filter((i) => !seen.has(i.id))];

  function isActive(to: string): boolean {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  // Rail nav item: icon + short label stacked and centered in the 76px rail.
  // Active state = steel-tinted background; the left stripe is <ActiveBar />.
  function navItemClass(active: boolean): string {
    return `relative flex flex-col items-center gap-0.5 py-2 rounded-lg w-full no-underline transition-colors cursor-pointer ${
      active
        ? "bg-[color-mix(in_srgb,var(--color-steel-light)_20%,transparent)] text-[var(--color-steel)]"
        : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
    }`;
  }

  // Left-side active indicator stripe — same height/style as prototype rail.
  function ActiveBar() {
    return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-[var(--color-steel)]" />;
  }

  const homeActive = location.pathname === "/" || isActive("/home");
  const settingsActive = isActive("/settings");
  const intelligenceActive = isActive("/intelligence");
  const knowledgeActive = isActive("/knowledge-base");
  const calendarNavActive = isActive("/calendar");
  const knowledgeUnlocked = connectedSourceCount >= 2;
  const calendarUnlocked = calendarConnected;

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Desktop/tablet sidebar — hidden below sm, replaced by the fixed bottom bar.
          Rail visual language (Track C2): always-collapsed 76px icon rail, icon +
          short label stacked + centered, active left-stripe, workspace avatar at
          top, bottom-section pinned. ADR-029 IA (routing/items) preserved exactly. */}
      <nav
        className="hidden sm:flex shrink-0 border-r flex-col"
        style={{
          width: 76,
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Workspace avatar — very top of rail. Steel square with workspace initial.
            Links to Settings → Organization (platform-wide org home). */}
        <Link
          to="/settings"
          className="h-16 flex flex-col items-center justify-center gap-0.5 border-b shrink-0 hover:bg-[var(--color-surface)] transition-colors no-underline"
          style={{ borderColor: "var(--color-border)" }}
          title={workspaceName || "Bridge"}
        >
          <div
            className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm"
            style={{ backgroundColor: "var(--color-steel)" }}
          >
            {(workspaceName || "B").charAt(0).toUpperCase()}
          </div>
          <span className="text-[9px] font-medium" style={{ color: "var(--color-navy-mid)" }}>
            Profile
          </span>
        </Link>

        {/* Top nav — Home + dynamic Initiatives + New, icon+label stacked. */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 px-1.5 pt-3">
          <Link to="/" className={navItemClass(homeActive)} title="Home">
            {homeActive && <ActiveBar />}
            <Home className="w-5 h-5" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className="text-[9px] font-medium leading-none">Home</span>
          </Link>

          {/* Initiatives — first-class nav items (ADR-029). Each shows a Target icon +
              truncated title label; the control-panel slider is reachable from the
              initiative detail page, not exposed in the narrow rail. */}
          {initiatives.map((i) => {
            const controlPanelBase = `/initiative/${encodeURIComponent(i.id)}`;
            const to = i.moduleTo ?? controlPanelBase;
            const active = isActive(to);
            return (
              <Link
                key={i.id}
                to={to}
                className={navItemClass(active)}
                title={i.title}
              >
                {active && <ActiveBar />}
                <Target className="w-5 h-5" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
                <span className="text-[9px] font-medium leading-none truncate max-w-[60px]">{i.title}</span>
              </Link>
            );
          })}
          {remoteInitiatives !== null && initiatives.length === 0 && (
            <div className="py-1.5 text-[9px] text-center" style={{ color: "var(--color-warm-gray)" }}>
              No Initiatives
            </div>
          )}

          {/* "+ New" — ALWAYS below all initiatives. */}
          <button
            type="button"
            className={navItemClass(false)}
            onClick={() => setNewOpen(true)}
            title="New Initiative"
          >
            <Plus className="w-5 h-5" style={{ color: "var(--color-warm-gray)" }} />
            <span className="text-[9px] font-medium leading-none">New</span>
          </button>
        </div>

        {/* Bottom section — Knowledge/Intelligence/Calendar/Settings, separated by
            a border. Knowledge/Calendar show overlaid lock icon when not yet
            unlocked (ADR-033 progressive capability model). */}
        <div
          className="border-t flex flex-col gap-0.5 px-1.5 pb-3 pt-2 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Link
            to="/knowledge-base"
            className={navItemClass(knowledgeActive)}
            title={knowledgeUnlocked ? "Knowledge" : "Knowledge — connect 2+ sources to unlock"}
          >
            {knowledgeActive && <ActiveBar />}
            <div className="relative">
              <BookOpen
                className="w-5 h-5"
                style={{ color: knowledgeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }}
              />
              {!knowledgeUnlocked && (
                <Lock
                  className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5"
                  style={{ color: "var(--color-warm-gray)" }}
                />
              )}
            </div>
            <span className={`text-[9px] font-medium leading-none${knowledgeUnlocked ? "" : " opacity-60"}`}>
              Knowledge
            </span>
          </Link>
          <Link to="/intelligence" className={navItemClass(intelligenceActive)} title="Intelligence">
            {intelligenceActive && <ActiveBar />}
            <Brain className="w-5 h-5" style={{ color: intelligenceActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className="text-[9px] font-medium leading-none">Intelligence</span>
          </Link>
          <Link
            to="/calendar"
            className={navItemClass(calendarNavActive)}
            title={calendarUnlocked ? "Calendar" : "Calendar — connect a calendar to unlock"}
          >
            {calendarNavActive && <ActiveBar />}
            <div className="relative">
              <CalendarDays
                className="w-5 h-5"
                style={{ color: calendarNavActive ? "var(--color-steel)" : "var(--color-warm-gray)" }}
              />
              {!calendarUnlocked && (
                <Lock
                  className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5"
                  style={{ color: "var(--color-warm-gray)" }}
                />
              )}
            </div>
            <span className={`text-[9px] font-medium leading-none${calendarUnlocked ? "" : " opacity-60"}`}>
              Calendar
            </span>
          </Link>
          <Link to="/settings" className={navItemClass(settingsActive)} title="Settings">
            {settingsActive && <ActiveBar />}
            <Settings className="w-5 h-5" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className="text-[9px] font-medium leading-none">Settings</span>
          </Link>
        </div>
      </nav>

      <div className="flex-1 overflow-auto pb-14 sm:pb-0 bg-background">
        <Outlet />
      </div>

      {/* Persistent AI chat — nav | content | AI chat (reference UI at bridge-ai-1ay.pages.dev).
          Hidden below sm: a 336px side panel doesn't fit alongside the mobile bottom tab bar. */}
      <div className="hidden sm:flex">
        <AgentPanel />
      </div>

      {/* Mobile bottom tab bar — Home · New · Settings (initiatives are reached
          from Home on narrow widths; a tab bar can't hold an unbounded list). */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 border-t border-border bg-background flex items-stretch h-14 z-10">
        <Link
          to="/"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs no-underline ${
            homeActive ? "font-medium text-[var(--color-steel)]" : "text-muted-foreground"
          }`}
        >
          <Home className="w-4 h-4" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
          Home
        </Link>
        <button
          type="button"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
          New
        </button>
        <Link
          to="/settings"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs no-underline ${
            settingsActive ? "font-medium text-[var(--color-steel)]" : "text-muted-foreground"
          }`}
        >
          <Settings className="w-4 h-4" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
          Settings
        </Link>
      </nav>

      <NewModuleDialog open={newOpen} onOpenChange={setNewOpen} />

      {checkedOnboarding && (
        <OnboardingDialog
          open={onboardingOpen}
          onOpenChange={setOnboardingOpen}
          // Does NOT close the dialog (see OnboardingDialog.tsx's prop comment,
          // docs/BUGS.md cosmetic-auto-close fix) — only marks that onboarding
          // no longer needs to auto-open on a future mount.
          onProposed={() => {}}
          onHatched={(prefs) => setAvatarPrefs(prefs)}
        />
      )}

      {/* Persistent avatar overlay — every route, inside the authed shell
          (spec-consolidation-2026-07.md section 3). Renders once prefs are
          resolved (either from localStorage or the existing-user fallback)
          so it never flashes a default animal before the real one loads.
          SUPPRESSED in the desktop shell (R-002): there the avatar is an
          OS-level floating companion window (apps/desktop overlay.rs +
          apps/web OverlayApp.tsx) and rendering both would duplicate it;
          plain-browser deploys keep this in-page overlay. */}
      {avatarPrefs && !(typeof window !== "undefined" && window.__TAURI_INTERNALS__) && (
        <AvatarOverlay
          animal={avatarPrefs.animal}
          {...(avatarPrefs.avatarName ? { avatarName: avatarPrefs.avatarName } : {})}
          {...(workspaceName ? { workspaceName } : {})}
        />
      )}
    </div>
  );
}
