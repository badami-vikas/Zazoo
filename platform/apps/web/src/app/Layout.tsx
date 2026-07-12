import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { Home, Target, Plus, Settings, Brain, BookOpen, Lock, Check, PanelLeftClose } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "./lib/trpc";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";
import { AvatarOverlay } from "./avatar/AvatarOverlay";
import { hasStoredPrefs, loadAvatarPrefs, computeGrowthStage, type AvatarPrefs, type GrowthStage } from "./avatar/avatar-store";
import { AgentPanel } from "./components/shared/AgentPanel";
import { NewModuleDialog } from "./components/NewModuleDialog";
import { useInitiatives, getInitiatives, createInitiative } from "./data/initiatives";
import { MODULE_ROUTES } from "./lib/moduleRoutes";

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
 * ADR-029 IA. 76px collapsed rail, icon + label stacked + centered,
 * active left-stripe indicator, workspace avatar at top, bottom section pinned.
 * SlidersHorizontal removed from rail — control panels reachable from detail
 * pages; icon kept imported here would be dead code, so import removed too.
 *
 * Expand/collapse (2026-07-10, user correction): the rail is genuinely
 * collapsible now — a NEW feature, not ported from the prototype (whose own
 * Sidebar.tsx explicitly declares itself fixed-width, "not a user toggle").
 * Collapsed = the original 76px icon-only design; expanded = 220px with
 * full labels beside icons. `railExpanded`/`setRailExpandedPersisted`,
 * `navItemClass`/`navLabelClass` below switch layout for every row.
 */
export default function Layout() {
  const location = useLocation();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  // Rail expand/collapse (user correction 2026-07-10 — a real toggle, not a
  // port of the prototype, which is deliberately fixed-width). Persisted
  // client-side same as other UI chrome prefs (pins.ts/AgentPanel's collapse
  // key) — a display preference, not workspace state. Default EXPANDED
  // (user correction 2026-07-10, matching the reference deployment's actual
  // default — only an explicit prior "0" collapses it).
  const [railExpanded, setRailExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("bridge.rail.expanded.v1") !== "0";
  });
  function setRailExpandedPersisted(next: boolean) {
    setRailExpanded(next);
    try {
      window.localStorage.setItem("bridge.rail.expanded.v1", next ? "1" : "0");
    } catch {
      // Cosmetic preference only — safe no-op if storage is unavailable.
    }
  }
  // Live drag feedback width, px — only set while a drag is in progress
  // (null = not dragging, render the fixed COLLAPSED/EXPANDED width instead).
  // Snaps to the nearer fixed state on release rather than persisting an
  // arbitrary width — two clean states, dragged like a slider between them
  // (user ask: "dragging allows collapse and expansion").
  const [railDragWidth, setRailDragWidth] = useState<number | null>(null);
  const RAIL_COLLAPSED = 76;
  const RAIL_EXPANDED = 220;
  const RAIL_SNAP_MIDPOINT = (RAIL_COLLAPSED + RAIL_EXPANDED) / 2;

  function startRailDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = railExpanded ? RAIL_EXPANDED : RAIL_COLLAPSED;
    function onMove(ev: MouseEvent) {
      const next = Math.min(RAIL_EXPANDED, Math.max(RAIL_COLLAPSED, startWidth + (ev.clientX - startX)));
      setRailDragWidth(next);
    }
    function onUp(ev: MouseEvent) {
      const finalWidth = Math.min(RAIL_EXPANDED, Math.max(RAIL_COLLAPSED, startWidth + (ev.clientX - startX)));
      setRailDragWidth(null);
      setRailExpandedPersisted(finalWidth >= RAIL_SNAP_MIDPOINT);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [remoteInitiatives, setRemoteInitiatives] = useState<{ id: string; title: string }[] | null>(null);
  const [connectedSourceCount, setConnectedSourceCount] = useState(0);
  const [calendarConnected, setCalendarConnected] = useState(false);
  // Growth stage: memory count not yet fetchable via tRPC (no /memory endpoint
  // today) — defaults to 0 until that surface ships. Capability count ≈
  // connected integration count, which Layout already fetches below. This gives
  // a live stage the moment integrations connect; memory count wires in later.
  const [growthStage, setGrowthStage] = useState<GrowthStage>("egg");
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
      .then((res) => {
        setConnectedSourceCount((prev) => {
          const next = prev + res.total;
          // Recompute growth stage: memoryCount=0 until /memory tRPC ships;
          // capabilityCount ≈ integration count (best proxy available today).
          setGrowthStage(computeGrowthStage(0, next));
          return next;
        });
      })
      .catch(() => {
        // Honest no-op: an unreachable API just keeps Knowledge/Calendar
        // showing their locked state rather than guessing they're connected.
      });
    trpc.google.list
      .query()
      .then((info) => {
        if (info.connection.connected) {
          setConnectedSourceCount((prev) => {
            const next = prev + 1;
            setGrowthStage(computeGrowthStage(0, next));
            return next;
          });
          setCalendarConnected(true);
        }
      })
      .catch(() => {
        // Same honest no-op as above.
      });
  }, []);

  // Calendar auto-seeds its own Initiative entry (user correction 2026-07-10:
  // "user should never see 'No Initiatives'"). It's pre-installed
  // (built-in-packages.ts seeds it unconditionally on every API boot) —
  // unlike DealPilot/JobPilot/Helpdesk, which the user opts into via "+ New",
  // Calendar's Initiative should just be there from the start. Same
  // dedupe-by-packageName guard NewModuleDialog.tsx already uses, so this is
  // idempotent and never creates a duplicate on remount.
  useEffect(() => {
    const already = getInitiatives().some((i) => i.packageName === "calendar");
    if (!already) {
      const calendar = MODULE_ROUTES.calendar;
      if (calendar) {
        createInitiative({ name: calendar.label, goal: calendar.desc, list: "Work", moduleTo: calendar.to, packageName: "calendar" });
      }
    }
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
        setWorkspaces(rows.map((w) => ({ id: w.id, name: w.name || "Unnamed organization" })));
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

  // Rail nav item — TWO layouts sharing one active-state treatment (user
  // correction 2026-07-10: added a real expand/collapse toggle; the
  // prototype's rail is fixed-width by design, so this is new work, not a
  // port). Collapsed: icon + short label stacked/centered (original 76px
  // design). Expanded: icon + full label in a row, left-aligned, room for
  // real names instead of 9px truncated labels.
  function navItemClass(active: boolean): string {
    const layout = railExpanded ? "flex-row items-center gap-2.5 px-2.5 py-2" : "flex-col items-center gap-0.5 py-2";
    return `relative flex ${layout} rounded-lg w-full no-underline transition-colors cursor-pointer ${
      active
        ? "bg-[color-mix(in_srgb,var(--color-steel-light)_20%,transparent)] text-[var(--color-steel)]"
        : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
    }`;
  }

  // Label span for a nav item — collapsed shows the original tiny centered
  // caption; expanded shows a normal-size left-aligned label with room for
  // the full name (no 60px truncation clamp).
  function navLabelClass(extra = ""): string {
    return railExpanded ? `text-sm font-medium leading-none truncate ${extra}` : `text-[9px] font-medium leading-none ${extra}`;
  }

  // Left-side active indicator stripe — same height/style as prototype rail.
  function ActiveBar() {
    return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-[var(--color-steel)]" />;
  }

  const homeActive = location.pathname === "/" || isActive("/home");
  const settingsActive = isActive("/settings");
  const intelligenceActive = isActive("/intelligence");
  const knowledgeActive = isActive("/knowledge-base");
  const knowledgeUnlocked = connectedSourceCount >= 2;

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Desktop/tablet sidebar — hidden below sm, replaced by the fixed bottom bar.
          Rail visual language (Track C2): collapsed = 76px icon rail, icon +
          short label stacked + centered, active left-stripe, workspace avatar at
          top, bottom-section pinned. ADR-029 IA (routing/items) preserved exactly.
          Expand/collapse toggle added 2026-07-10 (user correction — see
          `railExpanded`/`setRailExpandedPersisted` above); width transitions between
          the original 76px and 220px, same active-stripe/icon language either
          way — only the layout direction + label size change. */}
      <nav
        className={`hidden sm:flex shrink-0 border-r flex-col relative ${railDragWidth === null ? "transition-[width] duration-150" : ""} ${
          !railExpanded ? "cursor-pointer" : ""
        }`}
        style={{
          width: railDragWidth ?? (railExpanded ? RAIL_EXPANDED : RAIL_COLLAPSED),
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => {
          // Click-anywhere-to-expand when collapsed (user ask). React's
          // synthetic events bubble to this handler even from a clicked
          // Link/button (their own onClick/href still fires independently),
          // so `e.target === e.currentTarget` is too strict — it excludes
          // every click that landed in the gaps BETWEEN nav items too (those
          // hit an inner wrapper div, never the <nav> itself). Correct
          // check: did the click land on or inside a real interactive
          // element? If not, it's empty background — expand.
          if (!railExpanded && !(e.target as HTMLElement).closest("a, button")) {
            setRailExpandedPersisted(true);
          }
        }}
      >
        {/* Resize handle — right edge, hover shows a resize cursor; drag
            live-follows the mouse (railDragWidth) and snaps to the nearer of
            the two fixed states on release (startRailDrag above). */}
        <div
          onMouseDown={startRailDrag}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 group"
          title={railExpanded ? "Drag to collapse" : "Drag to expand"}
        >
          <div className="w-px h-full mx-auto bg-transparent group-hover:bg-[var(--color-steel-light)] transition-colors" />
        </div>

        {/* Organization switcher — Notion-style: click the workspace avatar to
            open a flyout listing every workspace `workspace.list` returns for
            this identity (real data, not fabricated — today that's exactly
            one row, the pilot workspace). Switching to a DIFFERENT workspace
            is intentionally not wired yet (app is single-tenant by
            construction — PILOT_WORKSPACE baked into ~17 files + a backend
            guard test); a non-active row is shown but disabled with an
            honest reason rather than silently doing nothing. Settings
            deliberately NOT included here (user correction 2026-07-10) —
            this menu is workspace switching only; Settings keeps its own
            dedicated rail icon below.
            h-14 (not h-16) — user correction 2026-07-10: this row must align
            with the center Header.tsx and right AgentPanel.tsx headers,
            both h-14. All three "top row" strips across the 3-column layout
            (left rail org box / center page header / right chat panel
            header) now share one height, so they read as a single aligned
            row instead of three misaligned strips. */}
        <div
          className={`h-14 flex items-center border-b shrink-0 relative ${railExpanded ? "justify-start px-3" : "justify-center"}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={orgMenuOpen}
            className={`flex rounded-lg hover:bg-[var(--color-surface)] transition-colors ${
              railExpanded ? "flex-row items-center gap-2.5 py-1.5 px-1.5 w-full" : "flex-col items-center gap-0.5 py-1.5 px-1"
            }`}
            title={workspaceName || "Bridge"}
          >
            <div
              className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0"
              style={{ backgroundColor: "var(--color-steel)" }}
            >
              {(workspaceName || "B").charAt(0).toUpperCase()}
            </div>
            <span className={navLabelClass(railExpanded ? "text-left" : "")} style={{ color: "var(--color-navy-mid)", maxWidth: railExpanded ? undefined : 64 }}>
              {workspaceName || "Bridge"}
            </span>
          </button>

          {/* Collapse toggle — sits next to the org name (user ask
              2026-07-10), not buried at the bottom of the rail. Only shown
              expanded; when collapsed, the whole rail is itself the expand
              control (onClick handler above + drag handle). */}
          {railExpanded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRailExpandedPersisted(false);
              }}
              className="ml-auto p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors shrink-0"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
            </button>
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
                  {(workspaces.length ? workspaces : [{ id: PILOT_WORKSPACE, name: workspaceName || "Bridge" }]).map((w, i) => {
                    const active = w.id === PILOT_WORKSPACE;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        disabled={!active}
                        title={active ? undefined : "Switching workspaces isn't wired yet"}
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

        {/* Top nav — Home + dynamic Initiatives + New, icon+label stacked. */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 px-1.5 pt-3">
          <Link to="/" className={navItemClass(homeActive)} title="Home">
            {homeActive && <ActiveBar />}
            <Home className="w-5 h-5 shrink-0" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Home</span>
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
                <Target className="w-5 h-5 shrink-0" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
                <span className={navLabelClass(railExpanded ? "" : "max-w-[60px]")}>{i.title}</span>
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
            <Plus className="w-5 h-5 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>New</span>
          </button>
        </div>

        {/* Bottom section — Knowledge/Intelligence/Settings, separated by a
            border. Knowledge shows an overlaid lock icon when not yet
            unlocked (ADR-033 progressive capability model). Calendar
            deliberately NOT pinned here (user correction 2026-07-10) — it's
            a Module like DealPilot/JobPilot/Helpdesk now (built-in-
            packages.ts), reachable via Intelligence → Modules or by
            creating it as an Initiative from "+ New", same as the others;
            it doesn't get a dedicated rail slot any more than they do. */}
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
            <div className="relative shrink-0">
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
            <span className={navLabelClass(knowledgeUnlocked ? "" : "opacity-60")}>Knowledge</span>
          </Link>
          <Link to="/intelligence" className={navItemClass(intelligenceActive)} title="Intelligence">
            {intelligenceActive && <ActiveBar />}
            <Brain className="w-5 h-5 shrink-0" style={{ color: intelligenceActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Intelligence</span>
          </Link>
          <Link to="/settings" className={navItemClass(settingsActive)} title="Settings">
            {settingsActive && <ActiveBar />}
            <Settings className="w-5 h-5 shrink-0" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Settings</span>
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
          growthStage={growthStage}
          {...(avatarPrefs.avatarName ? { avatarName: avatarPrefs.avatarName } : {})}
          {...(workspaceName ? { workspaceName } : {})}
        />
      )}
    </div>
  );
}
