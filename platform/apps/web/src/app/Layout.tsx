import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { trpc, PILOT_WORKSPACE } from "./lib/trpc";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";
import { getPinnedProjects, getPinnedTools, unpinProject, unpinTool, type PinnedItem } from "./lib/pins";
import { AvatarOverlay } from "./avatar/AvatarOverlay";
import { hasStoredPrefs, loadAvatarPrefs, type AvatarPrefs } from "./avatar/avatar-store";

/**
 * Shell IA (ADR-023, docs/raw/decisions-log.md last entry): permanent chrome
 * is SIX containers — bottom bar Intelligence/KnowledgeBase/Settings, main
 * nav area pinned Projects + pinned Tools. Chrome is fixed; everything INSIDE
 * the containers is generated/installed on demand ("minimal-egg pattern").
 *
 * Bottom bar becomes a horizontal bar on narrow widths (< sm) per the ADR's
 * "bottom of left sidebar (or bottom bar on narrow widths)" — this shell
 * renders the same three links in both a left-sidebar footer (desktop/tablet)
 * and a fixed bottom tab bar (mobile), rather than trying to make one layout
 * serve both.
 *
 * Pinning is client-side/localStorage today (see lib/pins.ts) — server-side
 * pin persistence is tracked debt (docs/BUGS.md), not silently pretended to
 * be durable.
 */
export default function Layout() {
  const location = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [pinnedProjects, setPinnedProjectsState] = useState<PinnedItem[]>([]);
  const [pinnedTools, setPinnedToolsState] = useState<PinnedItem[]>([]);
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);

  useEffect(() => {
    setPinnedProjectsState(getPinnedProjects());
    setPinnedToolsState(getPinnedTools());
  }, []);

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

  // Intelligence = the capability surface (Tools/Integrations/Agents/
  // Workflows/Skills — user revision 2026-07-06), NOT the Chief of Staff
  // chat, which stays a pinnable tool at /chief-of-staff.
  const bottomBarLinks = [
    { to: "/intelligence", label: "Intelligence" },
    { to: "/knowledge-base", label: "KnowledgeBase" },
    { to: "/settings", label: "Settings" },
  ];

  function isActive(to: string): boolean {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Desktop/tablet sidebar — hidden below sm, replaced by the fixed bottom bar. */}
      <nav className="hidden sm:flex w-56 shrink-0 border-r flex-col">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground px-1">Projects</div>
            {pinnedProjects.map((p) => (
              <div key={p.id} className="flex items-center gap-1 group">
                <Link to={p.to} className="text-sm hover:underline flex-1 truncate">
                  {p.label}
                </Link>
                <button
                  type="button"
                  className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={() => setPinnedProjectsState(unpinProject(p.id))}
                  aria-label={`Unpin ${p.label}`}
                >
                  ×
                </button>
              </div>
            ))}
            {pinnedProjects.length === 0 && <div className="text-xs text-muted-foreground px-1">No pinned projects.</div>}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground px-1">Tools</div>
            {pinnedTools.map((t) => (
              <div key={t.id} className="flex items-center gap-1 group">
                <Link to={t.to} className="text-sm hover:underline flex-1 truncate">
                  {t.label}
                </Link>
                <button
                  type="button"
                  className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={() => setPinnedToolsState(unpinTool(t.id))}
                  aria-label={`Unpin ${t.label}`}
                >
                  ×
                </button>
              </div>
            ))}
            {pinnedTools.length === 0 && <div className="text-xs text-muted-foreground px-1">No pinned tools.</div>}
          </div>

          <button
            type="button"
            className="text-sm text-left text-muted-foreground hover:underline mt-2 pt-2 border-t"
            onClick={() => setOnboardingOpen(true)}
          >
            Set up workspace…
          </button>
        </div>

        {/* Bottom-of-sidebar chrome: Intelligence · KnowledgeBase · Settings. */}
        <div className="border-t p-3 flex flex-col gap-2 shrink-0">
          {bottomBarLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`text-sm hover:underline ${isActive(l.to) ? "font-medium" : "text-muted-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="flex-1 overflow-auto pb-14 sm:pb-0">
        <Outlet />
      </div>

      {/* Mobile bottom tab bar — the "bottom bar on narrow widths" variant of the
          same three chrome links. */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 border-t bg-background flex items-stretch h-14 z-10">
        {bottomBarLinks.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`flex-1 flex items-center justify-center text-xs ${isActive(l.to) ? "font-medium" : "text-muted-foreground"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>

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
