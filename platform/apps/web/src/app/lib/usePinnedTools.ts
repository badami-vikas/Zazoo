import { useCallback, useSyncExternalStore } from "react";
import { getPinnedTools, setPinnedTools, unpinTool } from "./pins";
import { toolById } from "../data/tools";

/**
 * Ported-prototype shim: the prototype's Layout exported a `usePinnedTools`
 * context hook ({ pinnedTools, togglePin, isPinned }). apps/web's Layout is
 * the real shell and owns its own pin rendering (lib/pins.ts, localStorage),
 * so ported pages get the same hook API here, backed by that same real pin
 * store — no second source of truth.
 */

let listeners: Array<() => void> = [];
let snapshot: string[] = readIds();

function readIds(): string[] {
  return getPinnedTools().map((p) => p.id);
}

function emit() {
  snapshot = readIds();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function usePinnedTools(): {
  pinnedTools: string[];
  togglePin: (toolId: string) => void;
  isPinned: (toolId: string) => boolean;
} {
  const pinnedTools = useSyncExternalStore(subscribe, () => snapshot);

  const togglePin = useCallback((toolId: string) => {
    const current = getPinnedTools();
    if (current.some((p) => p.id === toolId)) {
      unpinTool(toolId);
    } else {
      const meta = toolById(toolId);
      setPinnedTools([
        ...current,
        {
          id: toolId,
          label: meta?.name ?? toolId,
          to: meta?.route ?? `/tool/${toolId}`,
        },
      ]);
    }
    emit();
  }, []);

  const isPinned = useCallback((toolId: string) => pinnedTools.includes(toolId), [pinnedTools]);

  return { pinnedTools, togglePin, isPinned };
}
