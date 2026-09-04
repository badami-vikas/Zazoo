/**
 * Saved Views for <DataViews> (TASK-062).
 *
 * A `ViewConfig` was React state, so every filter, sort, column-visibility
 * choice and List selection died on reload. This hook binds the shell to the
 * durable `view.saved.*` surface, and it lives INSIDE the shell rather than in
 * each page on purpose: fifteen pages render through <DataViews>, and a
 * per-page opt-in would have meant fifteen chances to forget.
 *
 * Two different kinds of state, deliberately kept apart:
 *  - the Views themselves are durable, owner-scoped and server-held;
 *  - WHICH one this browser had open is a per-viewer convenience, so it lives
 *    in localStorage. Losing it costs one click; putting it on the server
 *    would make one machine's UI state everyone else's.
 */
import { useCallback, useEffect, useState } from "react";
import type { ViewConfig } from "@bridge/tables";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

export interface SavedView {
  id: string;
  databaseId: string;
  name: string;
  scope: "personal" | "organization";
  config: Record<string, unknown>;
  hiddenColumns: readonly string[];
  ownerUserId: string;
}

const SELECTION_KEY = "bridge.dataviews.list";

function selectionKey(databaseId: string): string {
  return `${SELECTION_KEY}:${databaseId}`;
}

export function readSelectedView(databaseId: string): string | null {
  try {
    return window.localStorage.getItem(selectionKey(databaseId));
  } catch {
    return null;
  }
}

function persistSelectedView(databaseId: string, viewId: string | null): void {
  try {
    if (viewId) window.localStorage.setItem(selectionKey(databaseId), viewId);
    else window.localStorage.removeItem(selectionKey(databaseId));
  } catch {
    // A browser refusing site data still gets working Views; it just reopens
    // on "All" each time.
  }
}

export interface SavedViewsApi {
  views: SavedView[];
  /** Which saved View is showing; null is the Database's own default ("All"). */
  selectedId: string | null;
  /** Loaded at least once — until then the control is honestly unavailable. */
  ready: boolean;
  /** Why saving is impossible right now, or null when it is possible. */
  unavailableReason: string | null;
  select: (viewId: string | null) => SavedView | null;
  save: (name: string, config: ViewConfig, hiddenColumns: readonly string[]) => Promise<void>;
  /** Overwrite the selected View with what is on screen now. */
  update: (config: ViewConfig, hiddenColumns: readonly string[]) => Promise<void>;
  remove: (viewId: string) => Promise<void>;
}

export function useSavedViews(databaseId: string): SavedViewsApi {
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = (await trpc.view.saved.list.query({
      organizationId: PILOT_ORGANIZATION,
      databaseId,
    })) as SavedView[];
    setViews(rows);
    return rows;
  }, [databaseId]);

  useEffect(() => {
    let active = true;
    setReady(false);
    setSelectedId(null);
    void refresh()
      .then((rows) => {
        if (!active) return;
        setUnavailableReason(null);
        setReady(true);
        // Reopen the List this browser last had open, if it still exists.
        const remembered = readSelectedView(databaseId);
        if (remembered && rows.some((row) => row.id === remembered)) {
          setSelectedId(remembered);
        } else if (remembered) {
          persistSelectedView(databaseId, null);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        // Honest empty state, not a silent one: the control says why.
        setUnavailableReason(
          cause instanceof Error ? cause.message : "Saved Views are unavailable",
        );
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [databaseId, refresh]);

  const select = useCallback(
    (viewId: string | null) => {
      setSelectedId(viewId);
      persistSelectedView(databaseId, viewId);
      return viewId ? (views.find((view) => view.id === viewId) ?? null) : null;
    },
    [databaseId, views],
  );

  const save = useCallback(
    async (name: string, config: ViewConfig, hiddenColumns: readonly string[]) => {
      const created = (await trpc.view.saved.save.mutate({
        organizationId: PILOT_ORGANIZATION,
        databaseId,
        name,
        config,
        hiddenColumns: [...hiddenColumns],
      })) as SavedView;
      await refresh();
      setSelectedId(created.id);
      persistSelectedView(databaseId, created.id);
    },
    [databaseId, refresh],
  );

  const update = useCallback(
    async (config: ViewConfig, hiddenColumns: readonly string[]) => {
      if (!selectedId) return;
      await trpc.view.saved.update.mutate({
        organizationId: PILOT_ORGANIZATION,
        viewId: selectedId,
        config,
        hiddenColumns: [...hiddenColumns],
      });
      await refresh();
    },
    [refresh, selectedId],
  );

  const remove = useCallback(
    async (viewId: string) => {
      await trpc.view.saved.remove.mutate({
        organizationId: PILOT_ORGANIZATION,
        viewId,
      });
      if (selectedId === viewId) {
        setSelectedId(null);
        persistSelectedView(databaseId, null);
      }
      await refresh();
    },
    [databaseId, refresh, selectedId],
  );

  return { views, selectedId, ready, unavailableReason, select, save, update, remove };
}
