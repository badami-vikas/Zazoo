import { useSyncExternalStore } from 'react';
import generated from './pending-work.generated.json' with { type: 'json' };

export type PendingWorkSource = 'task' | 'roadmap' | 'bug' | 'request' | 'approval' | 'manual';
export type PendingWorkStatus = 'pending' | 'in-progress' | 'blocked' | 'completed' | 'dropped' | 'open' | 'partial' | 'proposed';

export interface PendingWorkItem {
  id: string;
  title: string;
  sourceType: PendingWorkSource;
  sourceFile: string;
  sourceLine: number;
  status: PendingWorkStatus;
  canonicalStatus?: 'inbox' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'dropped';
  archived?: boolean;
  edited?: boolean;
  priority?: string;
  horizon?: string;
  outcome?: string;
  prototypeTest?: string;
  scope?: string[];
  evidence?: string[];
  requests?: string[];
  approval?: string;
  dependencies?: string[];
}

export interface PendingWorkEdits {
  order?: string[];
  items?: Record<string, { title?: string; archived?: boolean }>;
  manual?: PendingWorkItem[];
}

export const PENDING_WORK_GENERATED_AT = generated.generatedAt;
export const PENDING_WORK_SOURCE = generated.items as PendingWorkItem[];
const STORAGE_KEY = 'bridge.pending-work.v1';

export function applyPendingWorkEdits(source: PendingWorkItem[], edits: PendingWorkEdits, includeArchived = false): PendingWorkItem[] {
  const combined = [...source, ...(edits.manual ?? [])];
  const patched = combined.map((item) => {
    const patch = edits.items?.[item.id];
    return patch ? { ...item, ...patch, edited: patch.title !== undefined } : item;
  });
  const positions = new Map((edits.order ?? []).map((id, index) => [id, index]));
  patched.sort((a, b) => {
    const aRank = positions.get(a.id);
    const bRank = positions.get(b.id);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return combined.findIndex((item) => item.id === a.id) - combined.findIndex((item) => item.id === b.id);
  });
  const statusRank = (item: PendingWorkItem) => item.canonicalStatus === 'in_progress' ? 0 : item.canonicalStatus === 'done' || item.canonicalStatus === 'dropped' ? 2 : 1;
  patched.sort((a, b) => statusRank(a) - statusRank(b));
  return includeArchived ? patched : patched.filter((item) => !item.archived);
}

export function movePendingWorkItem(edits: PendingWorkEdits, source: PendingWorkItem[], movingId: string, beforeId: string | null): PendingWorkEdits {
  const order = applyPendingWorkEdits(source, edits, true).map((item) => item.id).filter((id) => id !== movingId);
  const targetIndex = beforeId ? order.indexOf(beforeId) : -1;
  order.splice(targetIndex < 0 ? order.length : targetIndex, 0, movingId);
  return { ...edits, order };
}

export function updatePendingWorkItem(edits: PendingWorkEdits, id: string, patch: { title: string }): PendingWorkEdits {
  return { ...edits, items: { ...edits.items, [id]: { ...edits.items?.[id], ...patch } } };
}

export function archivePendingWorkItem(edits: PendingWorkEdits, id: string, archived: boolean): PendingWorkEdits {
  return { ...edits, items: { ...edits.items, [id]: { ...edits.items?.[id], archived } } };
}

function loadEdits(): PendingWorkEdits {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as PendingWorkEdits : {};
  } catch { return {}; }
}

let edits = loadEdits();
const subscribers = new Set<() => void>();
function save(next: PendingWorkEdits) {
  edits = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local plane unavailable */ }
  subscribers.forEach((subscriber) => subscriber());
}

export function usePendingWorkEdits(): PendingWorkEdits {
  return useSyncExternalStore(
    (subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    () => edits,
    () => ({}),
  );
}

export function persistPendingWorkEdits(next: PendingWorkEdits) { save(next); }

export function addManualPendingWorkItem(current: PendingWorkEdits, title: string): PendingWorkEdits {
  const item: PendingWorkItem = {
    id: `manual:${crypto.randomUUID()}`,
    title: title.trim(), sourceType: 'manual', sourceFile: 'Pending work manager', sourceLine: 0, status: 'open',
  };
  return { ...current, manual: [...(current.manual ?? []), item], order: [item.id, ...(current.order ?? [])] };
}
