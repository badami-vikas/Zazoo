import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { Network, Home, Boxes, Plus, Settings, Check, ListChecks, LogOut, MessageSquare, X } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "./lib/trpc";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";
import { AvatarOverlay } from "./avatar/AvatarOverlay";
import { hasStoredPrefs, loadAvatarPrefs, saveAvatarPrefs, type AvatarPrefs } from "./avatar/avatar-store";
import { AgentPanel } from "./components/shared/AgentPanel";
import { NewModuleDialog } from "./components/NewModuleDialog";
import { usePanelControl, ResizeHandle, CollapseToggleButton } from "./components/shared/PanelControl";
import { DesktopWindowChrome } from "./components/shared/DesktopWindowChrome";
import { useAuthSession } from "./auth/AuthSession";

/**
 * Shell IA v3 — TASK-001 / VOCAB6 (2026-07-16): installed Modules are
 * first-class left-nav items, sourced from modules.list (not hardcoded).
 * Each Module links to /module/:moduleName (manifest-driven Module Detail).
 * Deprecated surfaces (Knowledge, Intelligence, standalone Tools,
 * Projects) are removed from primary nav. Settings moves to its own section.
 *
 * Panel behaviour: usePanelControl (§5b) — left sidebar and right AgentPanel
 * share the same collapse/expand/resize/keyboard/ARIA contract via the shared
 * PanelControl component.
 */
export default function Layout() {
  const auth = useAuthSession();
  const location = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(null);
  const [organizationConfirmed, setOrganizationConfirmed] = useState<boolean | null>(null);
  const [organizationName, setOrganizationName] = useState<string | undefined>(undefined);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [mobileModulesOpen, setMobileModulesOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSignOutError(null);
    try {
      await auth.signOut();
    } catch (failure) {
      setSignOutError(
        failure instanceof Error ? failure.message : "Could not sign out",
      );
    }
  }

  // TASK-001 §5b: left rail uses the shared usePanelControl hook. A drag below
  // the midpoint collapses it; larger widths are preserved as the extended
  // state instead of snapping back to the normal width.
  const RAIL_COLLAPSED = 76;
  const RAIL_EXPANDED = 220;
  const RAIL_EXTENDED = 360;
  const rail = usePanelControl({
    defaultWidth: RAIL_EXPANDED,
    minWidth: RAIL_COLLAPSED,
    maxWidth: RAIL_EXTENDED,
    storageKeyWidth: "bridge.rail.width.v2",
    storageKeyCollapsed: "bridge.rail.collapsed.v2",
    snap: true,
    snapMidpoint: (RAIL_COLLAPSED + RAIL_EXPANDED) / 2,
  });
  // Alias for readability — "expanded" means NOT collapsed.
  const railExpanded = !rail.collapsed;
  function setRailExpandedPersisted(next: boolean) {
    rail.setCollapsedPersisted(!next);
  }

  // TASK-001 VOCAB6: installed modules from modules.list (real API, not
  // hardcoded). Only `available` state modules appear in the nav.
  const [installedModules, setInstalledModules] = useState<
    { moduleName: string; displayName: string }[] | null
  >(null);

  const [moduleLoadError, setModuleLoadError] = useState<string | null>(null);

  // TASK-001 VOCAB6: load installed modules from modules.list for the nav.
  // Only `available` state modules appear. Fetched once per mount.
  useEffect(() => {
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((res) => {
        const available = res.items
          .filter(
            (p) =>
              p.state === "available" &&
              p.status === "installed" &&
              p.manifest?.module !== undefined &&
              p.moduleAttachment === undefined,
          )
          .map((p) => ({
            moduleName: p.moduleName,
            displayName: p.manifest?.module?.displayName ?? p.manifest?.name ?? p.moduleName,
          }));
        setInstalledModules(available);
      })
      .catch((failure) => {
        setModuleLoadError(String(failure));
        setInstalledModules([]);
      });
  }, []);

  useEffect(() => {
    const openOnboarding = () => setOnboardingOpen(true);
    window.addEventListener("bridge:open-onboarding", openOnboarding);
    return () => window.removeEventListener("bridge:open-onboarding", openOnboarding);
  }, []);

  useEffect(() => {
    trpc.organization.blueprint.get
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((res) => {
        // Existing users (a organization already has an active blueprint) never
        // see onboarding forced back open; the avatar just defaults to a
        // neutral ready Avatar if this browser never saved prefs (spec section
        // 4, item 4 — "no forced re-onboarding").
        const hasOrganization = Boolean(res.definition);
        setOrganizationConfirmed(hasOrganization);
        if (!hasOrganization) setOnboardingOpen(true);
        if (!hasStoredPrefs()) {
          const resolvedPrefs = loadAvatarPrefs(hasOrganization);
          if (hasOrganization) saveAvatarPrefs(resolvedPrefs);
          setAvatarPrefs(resolvedPrefs);
        }
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

  const desktopAvatarSessionReady =
    organizationConfirmed === true && avatarPrefs?.avatarReady === true;

  useEffect(() => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!window.__BRIDGE_DESKTOP__ || !invoke) return;
    void invoke("overlay_set_session_ready", { ready: desktopAvatarSessionReady }).catch(
      (failure: unknown) => {
        console.error("[avatar] failed to synchronize desktop readiness", failure);
      },
    );
  }, [desktopAvatarSessionReady, avatarPrefs?.style, avatarPrefs?.avatarName]);

  useEffect(() => {
    trpc.organization.list
      .query()
      .then((rows) => {
        const mine = rows.find((w) => w.id === PILOT_ORGANIZATION);
        if (mine?.name) setOrganizationName(mine.name);
        setOrganizations(rows.map((w) => ({ id: w.id, name: w.name || "Unnamed organization" })));
      })
      .catch(() => {
        // Honest no-op — the avatar popover falls back to "Unnamed organization".
      });
  }, []);

  function isActive(to: string): boolean {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  // Rail nav item — TWO layouts sharing one active-state treatment.
  // Collapsed: icon + short label stacked/centered. Expanded: icon + full label in a row.
  function navItemClass(active: boolean): string {
    const layout = railExpanded ? "flex-row items-center gap-2.5 px-2.5 py-2" : "flex-col items-center gap-0.5 py-2";
    return `relative flex ${layout} rounded-lg w-full no-underline transition-colors cursor-pointer ${
      active
        ? "bg-[color-mix(in_srgb,var(--color-steel-light)_20%,transparent)] text-[var(--color-steel)]"
        : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
    }`;
  }

  function navLabelClass(extra = ""): string {
    return railExpanded ? `text-sm font-medium leading-none truncate ${extra}` : `text-[9px] font-medium leading-none ${extra}`;
  }

  function ActiveBar() {
    return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-[var(--color-steel)]" />;
  }

  const homeActive = location.pathname === "/" || isActive("/home");
  const settingsActive = isActive("/settings");
  const pendingWorkActive = isActive("/task-manager") || isActive("/pending-work");
  const secondBrainActive = isActive("/second-brain");

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Desktop/tablet sidebar — hidden below sm; uses shared PanelControl
          semantics (§5b, TASK-001): same snap/collapse/resize/ARIA contract as
          the right AgentPanel via the usePanelControl hook above. */}
      <nav
        id="panel-left"
        aria-label="Module navigation"
        className={`hidden sm:flex shrink-0 border-r flex-col relative ${rail.dragWidth === null ? "transition-[width] duration-150" : ""} ${
          !railExpanded ? "cursor-pointer" : ""
        }`}
        style={{
          width: rail.dragWidth ?? (railExpanded ? rail.panelWidth : RAIL_COLLAPSED),
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => {
          if (!railExpanded && !(e.target as HTMLElement).closest("a, button")) {
            setRailExpandedPersisted(true);
          }
        }}
        onKeyDown={(e) => {
          // §5b: Escape key returns expanded → collapsed.
          if (e.key === "Escape" && railExpanded) {
            setRailExpandedPersisted(false);
          }
        }}
      >
        {/* Resize handle — shared ResizeHandle component (§5b). */}
        <ResizeHandle
          side="left"
          onMouseDown={(e) => rail.startDrag(e, "left")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") rail.resizeBy(16);
            if (e.key === "ArrowLeft") rail.resizeBy(-16);
          }}
          label="Resize sidebar"
        />

        {/* macOS-only titlebar lane: AppKit's real traffic lights overlay this
            draggable Sidebar space. Other platforms keep native chrome. */}
        <DesktopWindowChrome expanded={railExpanded} />

        {/* Organization switcher — h-14 matches center Header and right panel headers. */}
        <div
          className={`h-14 flex items-center border-b shrink-0 relative ${railExpanded ? "justify-start px-3" : "justify-center"}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={orgMenuOpen}
            aria-label={`Organization: ${organizationName || "Bridge"}`}
            className={`flex rounded-lg hover:bg-[var(--color-surface)] transition-colors ${
              railExpanded ? "flex-row items-center gap-2.5 py-1.5 px-1.5 w-full" : "flex-col items-center gap-0.5 py-1.5 px-1"
            }`}
            title={organizationName || "Bridge"}
          >
            <div
              className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0"
              style={{ backgroundColor: "var(--color-steel)" }}
            >
              {(organizationName || "B").charAt(0).toUpperCase()}
            </div>
            <span className={navLabelClass(railExpanded ? "text-left" : "")} style={{ color: "var(--color-navy-mid)", maxWidth: railExpanded ? undefined : 64 }}>
              {organizationName || "Bridge"}
            </span>
          </button>

          {/* Collapse toggle — shared CollapseToggleButton (§5b). */}
          {railExpanded && (
            <CollapseToggleButton
              side="left"
              collapsed={false}
              onClick={() => setRailExpandedPersisted(false)}
            />
          )}

          {orgMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOrgMenuOpen(false)} />
              <div
                role="menu"
                aria-label="Switch organization"
                className="absolute top-full left-1 w-52 mt-1 border rounded-xl shadow-lg z-50 overflow-hidden"
                style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                <div className="p-1.5 flex flex-col">
                  {(organizations.length ? organizations : [{ id: PILOT_ORGANIZATION, name: organizationName || "Bridge" }]).map((w, i) => {
                    const active = w.id === PILOT_ORGANIZATION;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        disabled={!active}
                        title={active ? undefined : "Switching Organizations isn't available yet"}
                        onClick={() => setOrgMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:enabled:bg-[var(--color-surface)]"
                        style={{ backgroundColor: active ? "var(--color-surface)" : "transparent" }}
                      >
                        <div
                          className="w-6 h-6 min-w-[24px] rounded-md text-white flex items-center justify-center text-xs font-bold shadow-sm"
                          style={{ backgroundColor: i % 2 === 0 ? "var(--color-navy)" : "var(--color-steel)" }}
                        >
                          {w.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium flex-1" style={{ color: "var(--color-navy)" }}>{w.name}</span>
                        {active && <Check className="w-3.5 h-3.5" style={{ color: "var(--color-steel)" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Top nav — Home + installed Modules (VOCAB6) + "+New", icon+label stacked.
            Modules are sourced from modules.list (not hardcoded). Each links to
            /module/:moduleName (manifest-driven Module Detail, §4b). */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 px-1.5 pt-3">
          {!railExpanded && (
            <div className="flex justify-center pb-1">
              <CollapseToggleButton
                side="left"
                collapsed
                onClick={() => setRailExpandedPersisted(true)}
              />
            </div>
          )}
          <Link to="/" className={navItemClass(homeActive)} title="Home">
            {homeActive && <ActiveBar />}
            <Home className="w-5 h-5 shrink-0" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Home</span>
          </Link>

          {/* Installed Modules — from modules.list (real API, §5c). */}
          {installedModules === null ? (
            // Loading state: show a subtle indicator rather than a spinner in the nav.
            <div
              className="py-1.5 px-2 text-[9px]"
              style={{ color: "var(--color-warm-gray)" }}
              role="status"
              aria-label="Loading installed modules"
            >
              {railExpanded ? "Loading modules…" : "…"}
            </div>
          ) : installedModules.length === 0 ? (
            <div className="py-1.5 text-[9px] text-center" style={{ color: "var(--color-warm-gray)" }}>
              {railExpanded ? (moduleLoadError ? "Modules unavailable" : "No modules installed") : "—"}
            </div>
          ) : (
            installedModules.map((mod) => {
              const to = `/module/${mod.moduleName}`;
              const active = isActive(to);
              return (
                <Link
                  key={mod.moduleName}
                  to={to}
                  className={navItemClass(active)}
                  title={mod.displayName}
                  aria-current={active ? "page" : undefined}
                >
                  {active && <ActiveBar />}
                  <Boxes className="w-5 h-5 shrink-0" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
                  <span className={navLabelClass(railExpanded ? "" : "max-w-[60px]")}>{mod.displayName}</span>
                </Link>
              );
            })
          )}

          <Link to="/second-brain" className={navItemClass(secondBrainActive)} title="Second Brain">
            {secondBrainActive && <ActiveBar />}
            <Network className="w-5 h-5 shrink-0" style={{ color: secondBrainActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass(railExpanded ? "" : "max-w-[60px]")}>Second Brain</span>
          </Link>

          {/* "+New" — ALWAYS below all modules. */}
          <button
            type="button"
            className={navItemClass(false)}
            onClick={() => setNewOpen(true)}
            title="New module or record"
            aria-label="Create new module or record"
          >
            <Plus className="w-5 h-5 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>New</span>
          </button>
        </div>

        {/* Bottom section — Settings + Pending work.
            TASK-001 VOCAB6: Knowledge and Intelligence removed from primary nav
            (deprecated surfaces: Tools, Knowledge, Projects). */}
        <div
          className="border-t flex flex-col gap-0.5 px-1.5 pb-3 pt-2 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Link to="/settings" className={navItemClass(settingsActive)} title="Settings">
            {settingsActive && <ActiveBar />}
            <Settings className="w-5 h-5 shrink-0" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Settings</span>
          </Link>
          <Link to="/task-manager" className={navItemClass(pendingWorkActive)} title="Task Manager">
            {pendingWorkActive && <ActiveBar />}
            <ListChecks className="w-5 h-5 shrink-0" style={{ color: pendingWorkActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Task Manager</span>
          </Link>
          {auth.configured && (
            <button
              type="button"
              className={navItemClass(false)}
              onClick={() => void signOut()}
              title="Sign out"
            >
              <LogOut className="h-5 w-5 shrink-0 text-[var(--color-warm-gray)]" />
              <span className={navLabelClass()}>Sign out</span>
            </button>
          )}

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

      {mobileModulesOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            aria-label="Close Module navigation"
            onClick={() => setMobileModulesOpen(false)}
          />
          <nav
            id="mobile-module-menu"
            aria-label="Mobile Module navigation"
            className="relative z-10 h-full w-[min(86vw,320px)] border-r bg-white p-3 shadow-xl"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="mb-3 flex h-11 items-center justify-between border-b" style={{ borderColor: "var(--color-border)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Installed Modules</span>
              <button type="button" onClick={() => setMobileModulesOpen(false)} aria-label="Collapse sidebar" className="rounded p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              {installedModules?.map((module) => (
                <Link
                  key={module.moduleName}
                  to={`/module/${module.moduleName}`}
                  onClick={() => setMobileModulesOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
                  style={{ color: "var(--color-navy)" }}
                >
                  <Boxes className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
                  {module.displayName}
                </Link>
              ))}
              <Link
                to="/second-brain"
                onClick={() => setMobileModulesOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
                style={{ color: "var(--color-navy)" }}
              >
                <Network className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
                Second Brain
              </Link>
              {moduleLoadError && <p className="px-3 py-2 text-xs text-red-600">Modules unavailable: {moduleLoadError}</p>}
            </div>
            <div className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <button
                type="button"
                onClick={() => {
                  setMobileModulesOpen(false);
                  setNewOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
                style={{ color: "var(--color-navy)" }}
              >
                <Plus className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
                New module or record
              </button>
              <Link
                to="/task-manager"
                onClick={() => setMobileModulesOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
                style={{ color: "var(--color-navy)" }}
              >
                <ListChecks className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
                Task Manager
              </Link>
            </div>
          </nav>
        </div>
      )}

      {mobileChatOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            aria-label="Close chat panel"
            onClick={() => setMobileChatOpen(false)}
          />
          <div className="relative z-10 h-full">
            <AgentPanel mobile onClose={() => setMobileChatOpen(false)} />
          </div>
        </div>
      )}

      {/* Narrow-screen overlay controls preserve access to both shell panels. */}
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
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs ${
            mobileModulesOpen ? "font-medium text-[var(--color-steel)]" : "text-muted-foreground"
          }`}
          onClick={() => setMobileModulesOpen((open) => !open)}
          aria-expanded={mobileModulesOpen}
          aria-controls="mobile-module-menu"
        >
          <Boxes className="w-4 h-4" style={{ color: mobileModulesOpen ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
          Modules
        </button>
        <button
          type="button"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground"
          onClick={() => setMobileChatOpen(true)}
        >
          <MessageSquare className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
          Chat
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
        {auth.configured && (
          <button
            type="button"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4 text-[var(--color-warm-gray)]" />
            Sign out
          </button>
        )}
      </nav>

      {signOutError && (
        <div
          role="alert"
          className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-700 px-4 py-2 text-sm text-white shadow-lg"
        >
          {signOutError}
        </div>
      )}

      <NewModuleDialog open={newOpen} onOpenChange={setNewOpen} />

      {checkedOnboarding && (
        <OnboardingDialog
          open={onboardingOpen}
          onOpenChange={setOnboardingOpen}
          // Does NOT close the dialog (see OnboardingDialog.tsx's prop comment,
          // docs/BUGS.md cosmetic-auto-close fix) — only marks that onboarding
          // no longer needs to auto-open on a future mount.
          onProposed={(organization) => {
            setOrganizationName(organization.name);
            setOrganizations((current) =>
              current.some((item) => item.id === organization.id)
                ? current.map((item) => (item.id === organization.id ? organization : item))
                : [...current, organization],
            );
          }}
          onAvatarReady={(prefs) => {
            setAvatarPrefs(prefs);
            setOrganizationConfirmed(true);
          }}
        />
      )}

      {/* Persistent avatar overlay — every route, inside the authed shell
          (spec-consolidation-2026-07.md section 3). Renders once prefs are
          resolved (either from localStorage or the existing-user fallback)
          so it never flashes a default style before the real one loads.
          SUPPRESSED in the desktop shell (R-002): there the avatar is an
          OS-level floating companion window (apps/desktop overlay.rs +
          apps/web OverlayApp.tsx) and rendering both would duplicate it;
          plain-browser deploys keep this in-page overlay. */}
      {organizationConfirmed === true &&
        avatarPrefs?.avatarReady &&
        !(typeof window !== "undefined" && window.__TAURI_INTERNALS__) && (
        <AvatarOverlay
          style={avatarPrefs.style}
          {...(avatarPrefs.avatarName ? { avatarName: avatarPrefs.avatarName } : {})}
          {...(organizationName ? { organizationName } : {})}
        />
      )}
    </div>
  );
}
