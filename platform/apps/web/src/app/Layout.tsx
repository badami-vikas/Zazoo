import { useEffect, useState, type ReactNode } from "react";
import { Suspense } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { MODULES_CHANGED_EVENT } from "./chat/useChat";
import { Home, Boxes, Plus, Settings, Check, LogOut, MessageSquare, ListChecks, Sparkles, ChevronRight, Building2 } from "lucide-react";
import { moduleNavTarget, buildModuleNavTree } from "@bridge/module-manifests";
import { moduleStructure } from "@bridge/core";
import { trpc, PILOT_ORGANIZATION } from "./lib/trpc";
import { useAppFocusCapture } from "./lib/app-focus-capture";
import { useInputCaptureDrain } from "./lib/input-capture-drain";
import { OnboardingDialog } from "./onboarding/OnboardingDialog";
import { AvatarOverlay } from "./avatar/AvatarOverlay";
import {
  hasStoredPrefs,
  isAvatarStyle,
  loadAvatarPrefs,
  saveAvatarPrefs,
  type AvatarPrefs,
} from "./avatar/avatar-store";
import { AgentPanel } from "./components/shared/AgentPanel";
import { NewModuleDialog } from "./components/NewModuleDialog";
import {
  usePanelControl,
  ResizeHandle,
  CollapseToggleButton,
} from "./components/shared/PanelControl";
import { MAC_TRAFFIC_LIGHT_GUTTER, useIsMacDesktop } from "./components/shared/DesktopWindowChrome";
import { useAuthSession } from "./auth/AuthSession";
// TASK-081: the rail borrows the table header's menu geometry rather than
// inventing a second one — same viewport clamp, same fixed panel, same
// right-click gesture that opens StandardColumnMenu on a column header.
import { clampMenuPosition, type MenuPosition } from "./components/shared/StandardColumnMenu";
import { useDismiss } from "./lib/useDismiss";
import {
  applyRailPresentation,
  canHideModule,
  EMPTY_RAIL_PRESENTATION,
  loadRailPresentation,
  moveModuleInOrder,
  railPresentationKey,
  saveRailPresentation,
  type RailPresentation,
} from "./rail-module-presentation";

/**
 * Shell IA v3 — TASK-001 / VOCAB6 (2026-07-16): installed Modules are
 * first-class left-nav items, sourced from modules.list (not hardcoded).
 * Each Module links to its PRIMARY data Page (ADR-152/AP-084 — the first
 * manifest Page, buttons-at-top), not the /module/:name capability inventory;
 * the inventory stays reachable via each data Page's Intelligence Section
 * ("Manage in Module Detail"); the duplicate 3-dots Control Panel entry was
 * dropped in ADR-180.
 * Deprecated surfaces (Knowledge, Intelligence, standalone Tools,
 * Projects) are removed from primary nav. Settings moves to its own section.
 *
 * RAIL SCOPE (ADR-180, user directive 2026-08-05): the rail carries ONLY the
 * profile/Organization control at the top, Modules, Second Brain, Intelligence
 * and Settings — Settings last, in a footer that never scrolls.
 *
 * Panel behaviour: usePanelControl (§5b) — left sidebar and right AgentPanel
 * share the same collapse/expand/resize/keyboard/ARIA contract via the shared
 * PanelControl component.
 */
// A left-nav Module entry — either a built-in default (Task Manager) or one
// sourced from modules.list. `to` is the landing route (a Module's PRIMARY data
// Page, per UI page-anatomy canon), and `base` is the path prefix used for the
// rail's active-highlight so every Page under the Module lights up its entry.
type NavModule = {
  moduleName: string;
  displayName: string;
  to: string;
  base: string;
  icon: typeof Boxes;
  /** Set when this Module declares a nav parent (ADR-178) — it renders nested. */
  parentModule?: string | undefined;
  /** Set for a manifest sub-module (TASK-100): a nav child grouping some of
   *  its Module's Pages, keyed `<module>/<sub-module id>`, not an installation
   *  of its own. These are its Page routes, for the active highlight. */
  routes?: string[] | undefined;
};

// TaskManager is a default Module: it always appears under Home regardless of
// modules.list state, so the Modules list is never empty and never errors out.
const DEFAULT_MODULES: NavModule[] = [
  { moduleName: "task-manager", displayName: "TaskManager", to: "/task-manager", base: "/task-manager", icon: ListChecks },
];

// Which parent Modules are expanded, persisted per Organization. A Module with
// sub-modules starts COLLAPSED — the promise of the hierarchy is that the rail
// shows roots until you ask for more — but an active sub-module always forces
// its parent open, so navigating to a nested Page can never leave the rail
// pointing at nothing.
const EXPANDED_KEY = `bridge.${PILOT_ORGANIZATION}.rail.expandedModules.v1`;

function loadExpandedModules(): string[] {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // A corrupt or unavailable store degrades to "everything collapsed", which
    // is a valid nav state — never an error surface.
    return [];
  }
}

// TASK-081: hidden / renamed / reordered Modules, persisted per Organization
// in the same `bridge.<org>.rail.*` family as EXPANDED_KEY above. Rail
// PRESENTATION only — nothing here installs, uninstalls, re-scopes or
// re-planes a Module, and nothing outside the rail reads it (ADR-178: a
// re-arrangement is never a filter). See rail-module-presentation.ts.
const PRESENTATION_KEY = railPresentationKey(PILOT_ORGANIZATION);

/** Drag payload type for rail reordering. A private MIME type keeps a dragged
 *  Module from being dropped into (or accepted from) anything else. */
const RAIL_DRAG_TYPE = "application/x-bridge-rail-module";

/** A rail Module carrying its presentation state. */
type PresentedNavModule = NavModule & { hidden: boolean };

/**
 * The rail's context / View-options panel. Deliberately the SAME shape as
 * `StandardColumnMenuPanel`: fixed, viewport-clamped, dismissed by Escape or an
 * outside pointerdown. The gesture that opens a column menu on a table header
 * is the gesture that opens this one on a rail Module.
 */
function RailMenuPanel({
  position,
  label,
  onClose,
  children,
}: {
  position: MenuPosition;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useDismiss(true, onClose);
  return (
    <div
      role="menu"
      aria-label={label}
      className="fixed z-[80] max-h-[min(70dvh,420px)] w-56 overflow-auto rounded-xl border py-1 text-left shadow-xl"
      style={{
        left: position.x,
        top: position.y,
        borderColor: "var(--color-border)",
        background: "var(--popover)",
        color: "var(--popover-foreground)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export default function Layout() {
  const auth = useAuthSession();
  const location = useLocation();
  const isMacDesktop = useIsMacDesktop();
  // K7 (TASK-051): desktop-only, consent-driven app-focus drain loop —
  // feature-detected no-op in browser deploys.
  useAppFocusCapture();
  // K11 (TASK-054): the same shape for the keystroke lane. Both are
  // consent-driven at the SOURCE — the poller/tap is what stops, not just
  // the API's willingness to accept what it produced.
  useInputCaptureDrain();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Resolved SYNCHRONOUSLY from localStorage (falling back to the deliberate
  // "owl" default) so the companion is on screen at first paint instead of
  // waiting on a network round-trip. The blueprint/profile effect below only
  // refines the style; it no longer decides whether the avatar exists.
  const [avatarPrefs, setAvatarPrefs] = useState<AvatarPrefs | null>(() =>
    typeof window === "undefined" ? null : loadAvatarPrefs(false),
  );
  /** null = the readiness check has not resolved yet. false = onboarding has
   * demonstrably not happened, so the companion must not offer workspace
   * actions it cannot perform (AP-021). */
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
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
  //
  // On macOS the rail's header row IS the window titlebar (see
  // DesktopWindowChrome), so the collapsed rail has to be at least as wide as
  // the traffic-light cluster plus the Organization avatar it sits beside —
  // otherwise AppKit paints the traffic lights straight over the switcher.
  const RAIL_COLLAPSED = isMacDesktop ? MAC_TRAFFIC_LIGHT_GUTTER + 44 : 76;
  const RAIL_EXPANDED = 220;
  const RAIL_EXTENDED = 360;
  const rail = usePanelControl({
    defaultWidth: RAIL_EXPANDED,
    minWidth: RAIL_COLLAPSED,
    maxWidth: RAIL_EXTENDED,
    storageKeyWidth: `bridge.${PILOT_ORGANIZATION}.rail.width.v3`,
    storageKeyCollapsed: `bridge.${PILOT_ORGANIZATION}.rail.collapsed.v3`,
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
    { moduleName: string; displayName: string; parentModule?: string | undefined; landing?: string | undefined; base?: string | undefined; routes?: string[] | undefined }[] | null
  >(null);
  const [expandedModules, setExpandedModules] = useState<string[]>(() => loadExpandedModules());

  // TASK-081 rail presentation. Resolved synchronously so the rail paints in
  // the user's own order/labels at first paint rather than reshuffling itself.
  const [presentation, setPresentation] = useState<RailPresentation>(() =>
    typeof window === "undefined"
      ? EMPTY_RAIL_PRESENTATION
      : loadRailPresentation(PRESENTATION_KEY, window.localStorage),
  );
  /** Open rail menu. `moduleName` undefined = opened on empty rail space, so
   *  only the View-options list applies. */
  const [railMenu, setRailMenu] = useState<{ position: MenuPosition; moduleName?: string } | null>(null);
  /** The Module whose rail row is currently an inline rename input. */
  const [renamingModule, setRenamingModule] = useState<string | null>(null);

  function updatePresentation(next: RailPresentation) {
    setPresentation(next);
    if (typeof window !== "undefined") saveRailPresentation(PRESENTATION_KEY, next, window.localStorage);
  }

  function toggleModuleExpanded(moduleName: string) {
    setExpandedModules((current) => {
      const next = current.includes(moduleName)
        ? current.filter((name) => name !== moduleName)
        : [...current, moduleName];
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      } catch {
        // Persistence is a convenience; the nav still works for this session.
      }
      return next;
    });
  }

  // TASK-001 VOCAB6: load installed modules from modules.list for the nav.
  // Only `available` state modules appear. Fetched on mount and again whenever
  // something announces `bridge:modules-changed` — a chat turn that built and
  // installed a Module, say — so the nav never claims less than the server
  // has (BUGS 2026-09-05 "the chatbot claims academics is in my side bar").
  useEffect(() => {
    const loadInstalledModules = () => trpc.modules.list
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
          .flatMap((p) => {
            // ADR 2026-09-04 / TASK-100: a Module outside the built-in catalog
            // lands on its first ROOT Page in the standard shell, and each
            // manifest sub-module is a nav child of it — the same disclosure a
            // hand-written sub-module gets (ADR-178), keyed `<module>/<sub id>`.
            const structure = moduleStructure(p.manifest);
            const landingPage = structure.rootPages[0] ?? p.manifest?.module?.pages[0];
            const parent = {
              moduleName: p.moduleName,
              // TASK-081: the Organization's own name for the Module wins. It is
              // durable (module_installations.display_name_override) and moves the
              // local Files folder with it, so it is the label on every machine —
              // the localStorage copy below is only this browser's optimistic echo.
              displayName: p.displayNameOverride
                ?? p.manifest?.module?.displayName ?? p.manifest?.name ?? p.moduleName,
              parentModule: p.manifest?.module?.parentModule,
              landing: landingPage ? `/module/${p.moduleName}/${landingPage.id}` : undefined,
              base: landingPage ? `/module/${p.moduleName}` : undefined,
            };
            const children = structure.subModules.map((sub) => {
              const routes = sub.pages.map((page) => `/module/${p.moduleName}/${page.id}`);
              return {
                moduleName: `${p.moduleName}/${sub.id}`,
                displayName: sub.name,
                parentModule: p.moduleName,
                landing: routes[0],
                base: routes[0],
                routes,
              };
            });
            return [parent, ...children];
          });
        setInstalledModules(available);
      })
      .catch((failure) => {
        // The nav always shows the default Modules (Task Manager), so a load
        // failure degrades silently rather than surfacing an "unavailable" state.
        console.error("[nav] failed to load installed modules", failure);
        setInstalledModules([]);
      });
    loadInstalledModules();
    window.addEventListener(MODULES_CHANGED_EVENT, loadInstalledModules);
    return () => window.removeEventListener(MODULES_CHANGED_EVENT, loadInstalledModules);
  }, []);

  useEffect(() => {
    const openOnboarding = () => setOnboardingOpen(true);
    window.addEventListener("bridge:open-onboarding", openOnboarding);
    return () => window.removeEventListener("bridge:open-onboarding", openOnboarding);
  }, []);

  useEffect(() => {
    trpc.organization.blueprint.get
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(async (res) => {
        const hasOrganization = Boolean(res.definition);
        const storedPrefs = hasStoredPrefs() ? loadAvatarPrefs(true) : null;
        let resolvedPrefs = storedPrefs ?? loadAvatarPrefs(hasOrganization);
        let persistResolvedPrefs = hasOrganization && storedPrefs === null;
        // A saved onboarding profile is the honest record of "onboarding has
        // happened". The blueprint alone is not: a pre-seeded Organization
        // would silently count as onboarded. Unknown (the query failed) is
        // treated as "already onboarded" so a broken API never forces a modal.
        let onboardingCompleted: boolean | null = null;
        try {
          const { profile } = await trpc.onboarding.getProfile.query({
            organizationId: PILOT_ORGANIZATION,
          });
          onboardingCompleted = profile !== null;
          if (profile && isAvatarStyle(profile.avatarStyle)) {
            resolvedPrefs = {
              ...resolvedPrefs,
              style: profile.avatarStyle,
              avatarReady: true,
            };
            persistResolvedPrefs = true;
          } else if (profile) {
            persistResolvedPrefs = false;
            console.error(`[avatar] unsupported saved Avatar style "${profile.avatarStyle}"`);
          }
        } catch (failure) {
          persistResolvedPrefs = false;
          console.error("[avatar] failed to restore saved Avatar preferences", failure);
        }
        // User directive 2026-08-05: "if a user onboarding hasnt happened, the
        // onboarding process should launch at launch by default". Fires only
        // after this readiness check resolves (no flash for returning users),
        // once per mount, and never again after a profile exists.
        const needsOnboarding = onboardingCompleted === false || (onboardingCompleted === null && !hasOrganization);
        setSetupComplete(!needsOnboarding);
        if (needsOnboarding) setOnboardingOpen(true);
        if (persistResolvedPrefs) saveAvatarPrefs(resolvedPrefs);
        setAvatarPrefs(resolvedPrefs);
      })
      .catch(() => {
        // Don't force the onboarding modal open on top of an already-broken app
        // shell — but DO give the companion its preferences anyway. This effect
        // runs once per mount, so leaving `avatarPrefs` null here left
        // `desktopAvatarSessionReady` false for the rest of the session:
        // `overlay_set_session_ready(false)` concealed the overlay, OverlayApp
        // rendered nothing, and no later recovery of the API brought it back —
        // only a window reload did. One transient API failure at startup
        // (2026-08-16: the sidecar stalled under load and the shell declared
        // Local Plane loss) therefore cost the user their avatar for the whole
        // session, against the standing directive that the companion appears
        // irrespective of onboarding.
        setAvatarPrefs(loadAvatarPrefs(false));
      })
      .finally(() => setCheckedOnboarding(true));

    // Independent of the blueprint check above: load whatever prefs this
    // browser already has immediately, so the overlay doesn't flash/wait on
    // the network round-trip for returning users.
    if (hasStoredPrefs()) setAvatarPrefs(loadAvatarPrefs(true));
  }, []);

  // User directive 2026-08-05: "Irrespective of onboarding, I want the avatar
  // to appear." Companion presence is no longer gated on organization
  // confirmation or on the onboarding-completion flag it used to carry — the
  // authed shell being mounted IS the session. What the companion may DO is
  // still gated (see `setupComplete` below and AP-021): before setup it greets
  // and drives onboarding instead of offering actions that cannot execute.
  const desktopAvatarSessionReady = avatarPrefs !== null;

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

  // Modules shown under Home: default Modules (Task Manager) first, then the
  // installed Modules from modules.list, de-duplicated by moduleName. Defaults
  // guarantee the list is never empty, so no "unavailable" state is ever shown.
  // Land each Module on its primary data Page (buttons-at-top). Module Detail
  // was removed 2026-08-10 — a Module with no declared Page has nowhere of its
  // own to land, so it goes to Home rather than a dead `/module/:name` link.
  const apiModules: NavModule[] = (installedModules ?? []).map((mod) => {
    const nav = moduleNavTarget(mod.moduleName);
    return {
      moduleName: mod.moduleName,
      displayName: mod.displayName,
      to: nav?.landing ?? mod.landing ?? "/home",
      base: nav?.base ?? mod.base ?? "/home",
      icon: Boxes,
      parentModule: mod.parentModule,
      routes: mod.routes,
    };
  });
  const navModules: NavModule[] = [
    ...DEFAULT_MODULES,
    ...apiModules.filter(
      (mod) => !DEFAULT_MODULES.some((def) => def.moduleName === mod.moduleName),
    ),
  ];
  // TASK-081: the user's own order and labels are applied BEFORE the tree is
  // built (buildModuleNavTree preserves input order), and hiding is carried as
  // a flag rather than a filter — every Module is still here, and still in
  // Intelligence, search, and the Organization admin surface.
  const presentedModules: PresentedNavModule[] = applyRailPresentation(navModules, presentation);
  const presentedOrder = presentedModules.map((mod) => mod.moduleName);
  // The Module the user is actually looking at, if any. The right panel binds
  // its conversation to this, so opening a Module reopens that Module's own
  // chat instead of whatever thread happened to be last (ADR-267e). Longest
  // base wins so a sub-module's page does not resolve to its parent.
  const activeModuleName: string | undefined = navModules
    // A manifest sub-module is a grouping of its Module's Pages, not a Module
    // with a chat of its own, so it never becomes the bound Module.
    .filter((mod) => !mod.routes && isActive(mod.base))
    .sort((left, right) => right.base.length - left.base.length)[0]?.moduleName;
  // ADR-178: roots first, sub-modules nested one level under their parent.
  const navTree = buildModuleNavTree(presentedModules).filter((node) => !node.module.hidden);

  function reorderModule(moved: string, target: string) {
    // Seeded from what is on screen, so the first drag records a complete
    // order instead of a two-name fragment the rest of the rail sorts around.
    updatePresentation({ ...presentation, order: moveModuleInOrder(presentedOrder, moved, target) });
  }

  function setModuleHidden(moduleName: string, hidden: boolean) {
    if (hidden && !canHideModule(presentedModules, presentation.hidden, moduleName)) return;
    updatePresentation({
      ...presentation,
      hidden: hidden
        ? [...presentation.hidden, moduleName]
        : presentation.hidden.filter((name) => name !== moduleName),
    });
  }

  /**
   * A blank label removes the override, restoring the Module's own name.
   *
   * TASK-081: the rename is now durable AND moves the Module's local Files
   * folder (`modules.rename`). The localStorage write stays as the optimistic
   * echo so the rail relabels on the keystroke rather than on the round trip;
   * the server's answer then becomes the label `modules.list` returns on every
   * machine. A failed call is logged and the local echo left in place — the
   * label is recoverable by renaming again, and dropping the user's typing to
   * report a network error would lose more than it explains.
   */
  function commitModuleRename(moduleName: string, label: string) {
    const trimmed = label.trim();
    const names = { ...presentation.names };
    if (trimmed) names[moduleName] = trimmed;
    else delete names[moduleName];
    updatePresentation({ ...presentation, names });
    setRenamingModule(null);
    // ponytail: a manifest sub-module (`<module>/<sub id>`) has no installation
    // row to rename, so its label stays this browser's; a durable rename lands
    // when the Builder can edit module.yaml from the rail.
    if (moduleName.includes("/")) return;
    trpc.modules.rename
      .mutate({ organizationId: PILOT_ORGANIZATION, moduleName, displayName: trimmed || null })
      .then((result) => {
        setInstalledModules((current) => current?.map((mod) => (
          mod.moduleName === moduleName ? { ...mod, displayName: result.displayName } : mod
        )) ?? current);
      })
      .catch((failure) => {
        console.error("[nav] failed to persist Module rename", failure);
      });
  }

  function openRailMenu(event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, moduleName?: string) {
    event.preventDefault();
    event.stopPropagation();
    setRailMenu({
      position: clampMenuPosition({ x: event.clientX, y: event.clientY }),
      ...(moduleName ? { moduleName } : {}),
    });
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

  // Highlight for the Module's data Pages (base). Module Detail (/module/:name)
  // was removed 2026-08-10 — there is no separate overview route to also match.
  function moduleActive(mod: NavModule): boolean {
    // A manifest sub-module lights up on any of its Pages; its Pages share the
    // Module's `/module/<name>` prefix, so a prefix test would light the whole rail.
    return mod.routes ? mod.routes.some(isActive) : isActive(mod.base);
  }

  /** One rail entry. `disclosure` adds the sub-module expand/collapse control;
   *  `nested` renders the smaller indented treatment for a sub-module. */
  function renderModuleLink(
    mod: NavModule,
    opts: {
      active: boolean;
      nested?: boolean;
      disclosure?: { open: boolean; listId: string; onToggle: () => void };
    },
  ) {
    const Icon = mod.icon;
    const { active, nested, disclosure } = opts;
    const iconSize = nested ? "w-4 h-4" : "w-5 h-5";
    if (renamingModule === mod.moduleName) {
      // Rename happens in place, on the row itself — the same shape Notion and
      // Finder use. Enter/blur commit, Escape abandons.
      return (
        <div key={mod.moduleName} className="relative flex items-center px-2.5 py-1">
          <input
            autoFocus
            defaultValue={mod.displayName}
            aria-label={`Rename ${mod.displayName}`}
            className="w-full rounded-md border px-1.5 py-1 text-sm"
            style={{ borderColor: "var(--color-steel)", backgroundColor: "var(--color-surface)", color: "var(--color-navy)" }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitModuleRename(mod.moduleName, event.currentTarget.value);
              if (event.key === "Escape") setRenamingModule(null);
            }}
            onBlur={(event) => commitModuleRename(mod.moduleName, event.currentTarget.value)}
          />
        </div>
      );
    }
    return (
      <div
        key={mod.moduleName}
        className="relative flex items-center"
        // Drag-reorder uses the browser's own drag-and-drop rather than a
        // dependency: the rail is a short list of rows, which is exactly what
        // the native API is for. Touch has no HTML5 drag, so the mobile drawer
        // deliberately does not offer reordering.
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          // The dragged Module travels in the drag payload, NOT in React
          // state: dragstart and drop can land in the same batch, and a
          // useState written on dragstart is still null when drop reads it.
          event.dataTransfer.setData(RAIL_DRAG_TYPE, mod.moduleName);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(RAIL_DRAG_TYPE)) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const moved = event.dataTransfer.getData(RAIL_DRAG_TYPE);
          if (moved) reorderModule(moved, mod.moduleName);
        }}
        onContextMenu={(event) => openRailMenu(event, mod.moduleName)}
      >
        <Link
          to={mod.to}
          // The chevron sits ON the row, so reserve its width — otherwise a
          // long Module name renders underneath the control.
          className={`${navItemClass(active)}${disclosure ? " pr-8" : ""}`}
          title={mod.displayName}
          aria-current={active ? "page" : undefined}
        >
          {active && <ActiveBar />}
          <Icon
            className={`${iconSize} shrink-0`}
            style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }}
          />
          <span className={navLabelClass(railExpanded ? "" : "max-w-[60px]")}>{mod.displayName}</span>
        </Link>
        {disclosure && (
          <button
            type="button"
            onClick={disclosure.onToggle}
            aria-expanded={disclosure.open}
            aria-controls={disclosure.listId}
            aria-label={`${disclosure.open ? "Collapse" : "Expand"} ${mod.displayName} sub-modules`}
            className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-surface)]"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${disclosure.open ? "rotate-90" : ""}`}
              style={{ color: "var(--color-warm-gray)" }}
            />
          </button>
        )}
      </div>
    );
  }

  /** Mobile drawer entry — same hierarchy, indentation instead of disclosure.
   *  Same right-click menu as the rail; no drag (touch has no HTML5 drag). */
  function renderMobileModuleLink(mod: NavModule, nested: boolean) {
    const Icon = mod.icon;
    return (
      <Link
        key={mod.moduleName}
        to={mod.to}
        onContextMenu={(event) => openRailMenu(event, mod.moduleName)}
        onClick={() => setMobileModulesOpen(false)}
        className={`flex items-center gap-3 rounded-lg py-3 text-sm font-medium ${nested ? "pl-9 pr-3" : "px-3"}`}
        style={{ color: "var(--color-navy)" }}
      >
        <Icon className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
        {mod.displayName}
      </Link>
    );
  }

  function ActiveBar() {
    return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-[var(--color-steel)]" />;
  }

  const homeActive = location.pathname === "/" || isActive("/home");
  // Intelligence is its own top-level cross-Module capability page (ADR-154);
  // it no longer deep-links into a Settings section.
  const intelligenceActive = isActive("/intelligence") || isActive("/second-brain");
  const settingsActive = isActive("/settings");
  // ADR-180 (user directive 2026-08-05): the rail is reserved for Modules,
  // Second Brain, Intelligence, Settings and the profile/Organization control at
  // the top. Research is NOT a rail citizen — `/research` is the Run surface of
  // the `web-research` Skill consumed by the Relationship Module's Learning
  // Agent, so it is reached from Intelligence → Agents (and the per-Module
  // Intelligence Section), never from a top-level nav entry of its own.

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden font-sans">
      {/* No titlebar strip. On macOS the rail's own h-14 header row IS the
          titlebar (see DesktopWindowChrome) — traffic lights, Organization
          name, the centre toggle and Chief of Staff all land on one line. */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
      {/* Desktop/tablet sidebar — hidden below sm; uses shared PanelControl
          semantics (§5b, TASK-001): same snap/collapse/resize/ARIA contract as
          the right AgentPanel via the usePanelControl hook above. */}
      <nav
        id="panel-left"
        aria-label="Module navigation"
        className={`hidden sm:flex shrink-0 flex-col relative ${rail.dragWidth === null ? "transition-[width] duration-150" : ""} ${
          !railExpanded ? "cursor-pointer" : ""
        }`}
        style={{
          width: rail.dragWidth ?? (railExpanded ? rail.panelWidth : RAIL_COLLAPSED),
          backgroundColor: "var(--color-background)",
          // Shell-boundary separation is a soft shadow, not a hard rule
          // (ADR-187 / docs/wiki/ui-architecture.md "Shell boundaries") — the
          // rail|main-content seam reads as depth, not a drawn line.
          boxShadow: "var(--shadow-shell-right)",
        }}
        onClick={(e) => {
          if (!railExpanded && !(e.target as HTMLElement).closest("a, button, [role='separator']")) {
            setRailExpandedPersisted(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") rail.handleEscape();
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
          value={rail.dragWidth ?? rail.panelWidth}
          min={RAIL_COLLAPSED}
          max={RAIL_EXTENDED}
          isDragging={rail.isDragging}
        />

        {/* Organization switcher — h-14 matches center Header and right panel
            headers. On macOS this row is ALSO the window titlebar: it carries
            the drag region and pads past the traffic lights, so the workspace
            name sits beside them rather than being repeated on a strip above
            (user directive 2026-08-10). */}
        <div
          data-tauri-drag-region={isMacDesktop ? true : undefined}
          className={`h-14 flex items-center border-b shrink-0 relative ${railExpanded || isMacDesktop ? "justify-start px-3" : "justify-center"}`}
          style={{
            borderColor: "var(--color-border)",
            ...(isMacDesktop ? { paddingLeft: MAC_TRAFFIC_LIGHT_GUTTER } : {}),
          }}
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

          {/* Single collapse toggle — the full-screen/extend control was
              removed per user request; width is adjusted via the inner-edge
              double-arrow resize handle instead. */}
          {railExpanded && (
            <div className="flex items-center">
              <CollapseToggleButton
                side="left"
                collapsed={false}
                onClick={() => setRailExpandedPersisted(false)}
              />
            </div>
          )}

          {orgMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOrgMenuOpen(false)} />
              <div
                role="menu"
                aria-label="Account"
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

                {/* TASK-089: the Organization admin surface. ADR-180's closed
                    left-nav scope grants exactly one slot outside Modules /
                    Intelligence / Settings — the Organization control at the
                    top of the rail — so Module mount state, scopes, versions
                    and membership hang off THIS menu, scoped to the
                    Organization. It is one Organization surface, never a
                    per-Module page: Module Detail stays deleted (ADR-224/261). */}
                <div className="border-t" style={{ borderColor: "var(--color-border)" }} />
                <div className="p-1.5">
                  <Link
                    to="/organization/admin"
                    role="menuitem"
                    onClick={() => setOrgMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-left no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--color-navy)_8%,transparent)]"
                    title="Modules, scopes, versions and members for this Organization"
                  >
                    <Building2 className="h-4 w-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>Manage Organization</span>
                  </Link>
                </div>

                {/* Sign out lives at the bottom of the account menu (Notion
                    pattern), not as a standalone rail item. */}
                {auth.configured && (
                  <>
                    <div className="border-t" style={{ borderColor: "var(--color-border)" }} />
                    <div className="p-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOrgMenuOpen(false);
                          void signOut();
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-navy)_8%,transparent)]"
                        title="Sign out"
                      >
                        <LogOut className="h-4 w-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
                        <span className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Top nav — Home + installed Modules (VOCAB6) + "+New", icon+label stacked.
            Modules are sourced from modules.list (not hardcoded). Each links to
            its primary data Page (moduleNavTarget landing, ADR-152/AP-084). */}
        {/* THE ONLY SCROLLER IN THE RAIL. `min-h-0` is load-bearing: a flex
            item's default `min-height: auto` lets this region grow to its
            content instead of to its share of the column, which pushed the
            pinned footer (Settings) off the bottom of the viewport and made the
            whole rail scroll — the user could scroll past Settings. With
            `min-h-0` the region takes exactly the leftover height, scrolls its
            own overflow, and the footer below stays fixed on screen (ADR-180). */}
        <div
          className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-0.5 px-1.5 pt-3"
          // Right-clicking empty rail space opens View options, so a hidden
          // Module is reachable even with no row left to right-click.
          onContextMenu={(event) => openRailMenu(event)}
        >
          <Link to="/" className={navItemClass(homeActive)} title="Home">
            {homeActive && <ActiveBar />}
            <Home className="w-5 h-5 shrink-0" style={{ color: homeActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Home</span>
          </Link>

          {/* Modules under Home — Task Manager (default) first, then installed
              Modules from modules.list. Always non-empty, so no "unavailable"
              or "no modules" state is ever rendered. */}
          {navTree.map((rawNode) => {
            // Hiding a parent hides the group it heads; a hidden child drops
            // out on its own. Neither is removed from anywhere but the rail.
            const node = { ...rawNode, children: rawNode.children.filter((child) => !child.hidden) };
            const parentActive = moduleActive(node.module);
            const anyChildActive = node.children.some(moduleActive);
            // An active sub-module forces its parent open — otherwise the rail
            // would show a collapsed parent with no visible current item.
            const open =
              node.children.length > 0 &&
              (expandedModules.includes(node.module.moduleName) || anyChildActive);
            const listId = `nav-submodules-${node.module.moduleName}`;
            return (
              <div key={node.module.moduleName} className="flex flex-col gap-0.5">
                {renderModuleLink(node.module, {
                  // The parent row stays a link — clicking the Module always
                  // opens the Module. Disclosure is a SEPARATE control, so the
                  // chevron can never swallow a navigation the user asked for.
                  active: parentActive || (!open && anyChildActive),
                  disclosure:
                    node.children.length > 0 && railExpanded
                      ? { open, listId, onToggle: () => toggleModuleExpanded(node.module.moduleName) }
                      : undefined,
                })}
                {open && (
                  <div id={listId} className="flex flex-col gap-0.5 pl-4">
                    {node.children.map((child) =>
                      renderModuleLink(child, { active: moduleActive(child), nested: true }),
                    )}
                  </div>
                )}
                {/* Rail collapsed to icons: there is no room for a nested list,
                    so sub-modules render inline as siblings rather than being
                    hidden behind a disclosure the user cannot see. */}
                {!railExpanded &&
                  node.children.map((child) =>
                    renderModuleLink(child, { active: moduleActive(child) }),
                  )}
              </div>
            );
          })}

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

        {/* PINNED FOOTER — never scrolls (`shrink-0`, and the region above owns
            the overflow). Settings is the LAST entry, at the absolute bottom of
            the rail: there is nothing to scroll past it (user directive
            2026-08-05, ADR-180).
            Intelligence sits above Settings and is the ONLY entry point to
            Second Brain: the cross-Module Graph is Intelligence's first tab
            (ADR-224 / user directive 2026-08-10 — "I asked for second brain to
            appear inside intelligence but I still see it in left nav bar").
            One entry point, so the rail cannot disagree with the tab strip. */}
        <div
          className="border-t flex flex-col gap-0.5 px-1.5 pb-3 pt-2 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Link to="/intelligence" className={navItemClass(intelligenceActive)} title="Intelligence">
            {intelligenceActive && <ActiveBar />}
            <Sparkles className="w-5 h-5 shrink-0" style={{ color: intelligenceActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Intelligence</span>
          </Link>
          <Link to="/settings" className={navItemClass(settingsActive)} title="Settings">
            {settingsActive && <ActiveBar />}
            <Settings className="w-5 h-5 shrink-0" style={{ color: settingsActive ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
            <span className={navLabelClass()}>Settings</span>
          </Link>
        </div>
      </nav>

      {/* TASK-081: one panel carries both halves of the pairing the table
          header already uses — Hide on the row, and the View options list that
          brings a hidden Module back. Hiding is rail presentation: it never
          uninstalls a Module, never touches a permission or a plane, and never
          removes the Module from Intelligence, search, or the Organization
          admin surface. */}
      {railMenu && (
        <RailMenuPanel
          position={railMenu.position}
          label="Module rail actions"
          onClose={() => setRailMenu(null)}
        >
          {railMenu.moduleName && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={!canHideModule(presentedModules, presentation.hidden, railMenu.moduleName)}
                title={
                  canHideModule(presentedModules, presentation.hidden, railMenu.moduleName)
                    ? "Hides this Module from the rail only — it stays installed"
                    : "Unavailable: the rail always keeps at least one Module visible"
                }
                onClick={() => {
                  setModuleHidden(railMenu.moduleName!, true);
                  setRailMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-45"
              >
                Hide
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenamingModule(railMenu.moduleName ?? null);
                  setRailMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10"
              >
                Rename
              </button>
              <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
            </>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 text-xs opacity-60">
            <span>View options</span>
            <span>{presentation.hidden.length} hidden</span>
          </div>
          {presentedModules.map((mod) => {
            const blocked = !mod.hidden && !canHideModule(presentedModules, presentation.hidden, mod.moduleName);
            return (
              <label
                key={mod.moduleName}
                title={blocked ? "Unavailable: the rail always keeps at least one Module visible" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 ${blocked ? "opacity-45" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={!mod.hidden}
                  disabled={blocked}
                  onChange={(event) => setModuleHidden(mod.moduleName, !event.target.checked)}
                />
                <span className="truncate">{mod.displayName}</span>
              </label>
            );
          })}
        </RailMenuPanel>
      )}

      <div className="min-w-0 flex-1 overflow-auto pb-14 sm:pb-0 bg-background">
        {/* Module Pages are lazy chunks (Egg profile, ADR 2026-09-04): the shell
            paints while a Page's chunk loads, so nothing here blocks on it. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>

      {/* Persistent AI chat — nav | content | AI chat (reference UI at bridge-ai-1ay.pages.dev).
          Hidden below sm: a 336px side panel doesn't fit alongside the mobile bottom tab bar. */}
      <div className="hidden sm:flex">
        <AgentPanel moduleName={activeModuleName} />
      </div>
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
              <CollapseToggleButton
                side="left"
                collapsed={false}
                onClick={() => setMobileModulesOpen(false)}
              />
            </div>
            <div className="space-y-1">
              {/* Same one-level hierarchy as the rail. The drawer has room, so
                  sub-modules are shown indented rather than behind a
                  disclosure — one fewer tap to reach a nested Module. */}
              {navTree.map((node) => (
                <div key={node.module.moduleName} className="space-y-1">
                  {renderMobileModuleLink(node.module, false)}
                  {node.children.map((child) => renderMobileModuleLink(child, true))}
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <Link
                to="/intelligence"
                onClick={() => setMobileModulesOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium"
                style={{ color: "var(--color-navy)" }}
              >
                <Sparkles className="h-4 w-4" style={{ color: "var(--color-steel)" }} />
                Intelligence
              </Link>
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
            <AgentPanel mobile moduleName={activeModuleName} onClose={() => setMobileChatOpen(false)} />
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
          {...(auth.session?.user?.email ? { userEmail: auth.session.user.email } : {})}
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
            setSetupComplete(true);
          }}
        />
      )}

      {/* Persistent avatar overlay — every route, inside the authed shell
          (spec-consolidation-2026-07.md section 3). Present IRRESPECTIVE of
          onboarding (user directive 2026-08-05): prefs resolve synchronously,
          so the companion is there from first paint with the deliberate "owl"
          default until a saved style loads.
          SUPPRESSED in the desktop shell (R-002): there the avatar is an
          OS-level floating companion window (apps/desktop overlay.rs +
          apps/web OverlayApp.tsx) and rendering both would duplicate it;
          plain-browser deploys keep this in-page overlay. */}
      {avatarPrefs &&
        !(typeof window !== "undefined" && window.__TAURI_INTERNALS__) && (
        <AvatarOverlay
          style={avatarPrefs.style}
          setupComplete={setupComplete !== false}
          onStartSetup={() => setOnboardingOpen(true)}
          {...(avatarPrefs.avatarName ? { avatarName: avatarPrefs.avatarName } : {})}
          {...(organizationName ? { organizationName } : {})}
        />
      )}
    </div>
  );
}
