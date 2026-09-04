/**
 * TASK-081 — the rail's per-Organization Module presentation: which Modules
 * are hidden, what the user calls them, and what order they sit in.
 *
 * THE BOUNDARY THIS FILE DEFENDS. Hiding a Module in the rail is presentation
 * and nothing else. It does not uninstall the Module, does not touch a
 * permission or a plane, and does not remove the Module from Intelligence,
 * from search, or from the Organization admin surface — ADR-178's rule that a
 * re-arrangement is never a filter. `applyRailPresentation` therefore returns
 * EVERY Module it was handed, carrying a `hidden` flag; only the rail's own
 * render reads that flag. Nothing outside `Layout.tsx` imports this module.
 *
 * State lives beside the rail's existing `expandedModules` store — one
 * localStorage key per Organization, in the same `bridge.<org>.rail.*` family,
 * because it is the same kind of state for the same reason: a nav preference
 * that belongs to this person on this machine.
 *
 * KNOWN CEILING — a rename does NOT move the Module's local Files folder.
 * `~/Documents/Bridge/<Organization>/<Module display name>/` is derived
 * server-side from `installation.manifest.module.displayName`, and
 * `module-files.ts` carries a rename forward from a static table of previous
 * labels. Nothing is lost by this: the folder is untouched, and the Files
 * Section keeps reading exactly the same directory — the rail label and the
 * folder name simply differ until the rename is durable server-side. Making
 * it durable is NOT a second rename path in `module-files.ts`; it is a
 * per-Organization display-name override the API can read, because the
 * manifest itself is not a home for it: `seedBuiltInModules` rewrites a
 * built-in Module's stored manifest on every boot whenever it differs from
 * the shipped one, so a rename written there is reverted at next start.
 */

/** Anything with a stable Module name and a label the rail draws. */
export interface RailModuleLike {
  moduleName: string;
  displayName: string;
}

export interface RailPresentation {
  /** Module names, most-preferred first. A Module absent from this list keeps
   *  its incoming (API) order, after everything the list does name. */
  order: string[];
  /** Module names the user has hidden from the rail. Never lost: the rail's
   *  View options entry lists every Module with its visibility checkbox. */
  hidden: string[];
  /** moduleName → the label the user gave it. */
  names: Record<string, string>;
}

export const EMPTY_RAIL_PRESENTATION: RailPresentation = { order: [], hidden: [], names: {} };

export function railPresentationKey(organizationId: string): string {
  return `bridge.${organizationId}.rail.modulePresentation.v1`;
}

/** The two localStorage methods this model needs — injectable so it is testable
 *  without a DOM, and so a browser with storage disabled is a supported case. */
export interface PresentationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A corrupt or unavailable store degrades to "no preferences", which is a
 *  valid rail state — never an error surface. Same contract as the rail's
 *  existing expanded-Modules loader. */
export function loadRailPresentation(
  key: string,
  storage: PresentationStorage,
): RailPresentation {
  try {
    const raw = storage.getItem(key);
    if (!raw) return EMPTY_RAIL_PRESENTATION;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_RAIL_PRESENTATION;
    const record = parsed as Record<string, unknown>;
    const names: Record<string, string> = {};
    const rawNames = record["names"];
    if (typeof rawNames === "object" && rawNames !== null) {
      for (const [moduleName, label] of Object.entries(rawNames as Record<string, unknown>)) {
        if (typeof label === "string") names[moduleName] = label;
      }
    }
    return { order: stringList(record["order"]), hidden: stringList(record["hidden"]), names };
  } catch {
    return EMPTY_RAIL_PRESENTATION;
  }
}

/** Persistence is a convenience — a failure leaves the session's state intact. */
export function saveRailPresentation(
  key: string,
  value: RailPresentation,
  storage: PresentationStorage,
): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // The rail still works for this session.
  }
}

export type PresentedModule<T extends RailModuleLike> = T & { hidden: boolean };

/**
 * Order + rename + flag. Deliberately NOT a filter (see the file header).
 * A blank rename is ignored rather than blanking the row.
 */
export function applyRailPresentation<T extends RailModuleLike>(
  modules: readonly T[],
  presentation: RailPresentation,
): PresentedModule<T>[] {
  const hidden = new Set(presentation.hidden);
  const rank = new Map(presentation.order.map((name, index) => [name, index]));
  return modules
    .map((mod, index) => {
      const custom = presentation.names[mod.moduleName]?.trim();
      return {
        mod: {
          ...mod,
          ...(custom ? { displayName: custom } : {}),
          hidden: hidden.has(mod.moduleName),
        } as PresentedModule<T>,
        // Unlisted Modules sort after every listed one, keeping their incoming
        // relative order — a newly installed Module appears at the end of the
        // rail rather than jumping to the top of a list the user arranged.
        key: [rank.get(mod.moduleName) ?? Number.POSITIVE_INFINITY, index] as const,
      };
    })
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
    .map((entry) => entry.mod);
}

/**
 * The moved Module takes the target's slot: the insertion index is the
 * target's position in the ORIGINAL list, which is what makes a downward drag
 * land AFTER the row you dropped on and an upward drag land BEFORE it — the
 * behaviour every drag-reorder list has. A no-op for an unknown name.
 */
export function moveModuleInOrder(order: readonly string[], moved: string, target: string): string[] {
  const targetIndex = order.indexOf(target);
  if (moved === target || !order.includes(moved) || targetIndex < 0) return [...order];
  const next = order.filter((name) => name !== moved);
  next.splice(targetIndex, 0, moved);
  return next;
}

/** The rail can never empty itself: the last visible Module refuses to hide. */
export function canHideModule(
  modules: readonly RailModuleLike[],
  hidden: readonly string[],
  moduleName: string,
): boolean {
  const hiddenSet = new Set(hidden);
  const visible = modules.filter((mod) => !hiddenSet.has(mod.moduleName));
  return visible.length > 1 && !hiddenSet.has(moduleName);
}
