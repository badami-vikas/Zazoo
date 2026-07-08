import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { Home, Target, Plus, Settings, SlidersHorizontal } from "lucide-react";
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
 * No intermediate "Initiatives" index page; no pinned Projects/Tools sections;
 * Intelligence/KnowledgeBase left primary nav (their routes stay live and are
 * reachable as progressive-disclosure links inside Settings → Intelligence /
 * Knowledge). Settings is PLATFORM-wide admin only; per-Initiative admin lives
 * at /initiative/:id/control-panel (the small slider icon on each nav item).
 *
 * Initiative nav items merge TWO real sources, deduped by id:
 *   - trpc `graph.listInitiatives` (DB-backed kernel rows)
 *   - the local useInitiatives store (user-created from the Work surface,
 *     localStorage — real user data, not seeded)
 * Honest empty state when both are empty.
 */
export default function Layout() {
  const location = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [remoteInitiatives, setRemoteInitiatives] = useState<{ id: string; title: string }[] | null>(null);
  const localInitiatives = useInitiatives();

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
        // Honest no-op — the avatar popover falls back to "Unnamed workspace".
      });
  }, []);

  // Merge kernel + local initiative lists, kernel first, deduped by id.
  const localItems = localInitiatives.map((i) => ({ id: i.id, title: i.name }));
  const remoteItems = remoteInitiatives ?? [];
  const seen = new Set(remoteItems.map((i) => i.id));
  const initiatives = [...remoteItems, ...localItems.filter((i) => !seen.has(i.id))];

  function isActive(to: string): boolean {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function navItemClass(active: boolean): string {
    return `relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors ${
      active
        ? "bg-[color-mix(in_srgb,var(--color-steel-light)_20%,transparent)] font-medium text-[var(--color-steel)]"
        : "text-[var(--color-navy-mid)] hover:bg-surface"
    }`;
  }

  function ActiveBar() {
    return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-r-full bg-[var(--color-steel)]" />;
  }

  const homeActive = location.pathname === "/" || isActive("/home");
  const settingsActive = isActive("/settings");

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Desktop/tablet sidebar — hidden below sm, replaced by the fixed bottom bar. */}
      <nav className="hidden sm:flex w-56 shrink-0 border-r border-border bg-background flex-col">
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5">
          <Link to="/" className={navItemClass(homeActive)}>
            {homeActive && <ActiveBar />}
            <Home className="w-4 h-4 shrink-0" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            Home
          </Link>

          {/* Initiatives — first-class nav items, no index page in between. */}
          {initiatives.map((i) => {
            const to = `/initiative/${encodeURIComponent(i.id)}`;
            const active = isActive(to);
            return (
              <div key={i.id} className={`group ${navItemClass(active)}`}>
                {active && <ActiveBar />}
                <Target className="w-4 h-4 shrink-0" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
                <Link to={to} className="flex-1 truncate no-underline text-inherit">
                  {i.title}
                </Link>
                <Link
                  to={`${to}/control-panel`}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[var(--color-steel)] transition-opacity"
                  aria-label={`${i.title} control panel`}
                  title="Control panel"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </Link>
              </div>
            );
          })}
          {remoteInitiatives !== null && initiatives.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No Initiatives yet.</div>
          )}

          {/* "+ New" — ALWAYS below all initiatives. */}
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left text-muted-foreground hover:bg-surface hover:text-[var(--color-steel)] transition-colors"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="w-4 h-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
            New
          </button>
        </div>

        {/* Divider + Settings — the only chrome below the fold. */}
        <div className="border-t border-border p-3 shrink-0">
          <Link to="/settings" className={navItemClass(settingsActive)}>
            {settingsActive && <ActiveBar />}
            <Settings className="w-4 h-4 shrink-0" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            Settings
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
          so it never flashes a default animal before the real one loads. */}
      {avatarPrefs && (
        <AvatarOverlay
          animal={avatarPrefs.animal}
          {...(avatarPrefs.avatarName ? { avatarName: avatarPrefs.avatarName } : {})}
          {...(workspaceName ? { workspaceName } : {})}
        />
      )}
    </div>
  );
}
