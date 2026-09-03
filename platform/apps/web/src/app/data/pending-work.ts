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
  /** The verbatim qualifier on the canonical `- Status:` line, when it has one
   * ("LANDED 2026-08-30, ADR-262; the invite half is NOT met"). It is the only
   * written record of partly-done work, so it is carried, not summarized. */
  statusNote?: string;
  /** Horizon Goal node (`isGoal`) or the task hanging under one. `path`/`level`
   * are the same tree coordinates the Task Manager Database materializes. */
  isGoal?: boolean;
  path?: string;
  level?: number;
  parentId?: string | null;
  archived?: boolean;
  edited?: boolean;
  priority?: string;
  /** Coarse effort estimate from the ledger's `- Estimate:` line ("2d").
   * Absent for done work and for anything nobody has estimated. */
  estimate?: string;
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

// =====================================================================
// Canonical ledger -> Task Manager import payload (ADR-267).
//
// The generated projection is the only thing the browser has: docs/TASKS.md is
// a repository file, and the API has no path to it in a packaged desktop build.
// The mapping lives here rather than in the Page because it is the part that
// can be WRONG — the Node runner strips types but does not transform JSX, so
// logic inside a component cannot be asserted by a test.
// =====================================================================

export type CanonicalTaskStatus =
  | 'candidate' | 'committed' | 'pending' | 'in_progress'
  | 'blocked' | 'done' | 'parked' | 'abandoned' | 'archived';

/** The canonical ledger's six statuses onto the Task Record's nine.
 * `dropped -> abandoned` rather than `archived`: the ledger drops work that was
 * decided against, and archiving says "finished and filed", which is a
 * different claim about the same row. */
const LEDGER_STATUS: Record<string, CanonicalTaskStatus> = {
  inbox: 'candidate',
  ready: 'pending',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  dropped: 'abandoned',
};

export interface CanonicalLedgerImportEntry {
  recordId: string;
  title: string;
  isGoal: boolean;
  parentRecordId?: string | null;
  status: CanonicalTaskStatus;
  priority?: string;
  estimate?: string;
  outcome?: string;
  exitTest?: string;
}

/**
 * Goal nodes first, then their tasks — the server assigns dot-paths in the
 * order it receives entries, so a child arriving before its parent has no path
 * to hang from. Sorting here rather than trusting the file's order means the
 * payload is correct even if the generator's order ever changes.
 *
 * An entry whose `canonicalStatus` is not one of the six known statuses is
 * DROPPED, not guessed into `pending`: importing a Task at a status nobody
 * wrote is a fabricated fact about the queue.
 */
export function canonicalLedgerImportPayload(
  source: PendingWorkItem[],
): CanonicalLedgerImportEntry[] {
  const goals = source.filter((item) => item.isGoal);
  const tasks = source.filter((item) => !item.isGoal);
  return [...goals, ...tasks].flatMap((item) => {
    // A Goal node is a container the ledger states no status for. `pending` is
    // the honest neutral: it is neither a claim that the Horizon is finished
    // nor that anyone is working "the Horizon" itself.
    const status = item.isGoal ? 'pending' : LEDGER_STATUS[item.canonicalStatus ?? ''];
    if (!status) return [];
    return [{
      recordId: item.id,
      title: item.title,
      isGoal: Boolean(item.isGoal),
      parentRecordId: item.parentId ?? null,
      status,
      ...(item.priority ? { priority: item.priority } : {}),
      ...(item.estimate ? { estimate: item.estimate } : {}),
      ...(item.outcome ? { outcome: item.outcome } : {}),
      ...(item.prototypeTest ? { exitTest: item.prototypeTest } : {}),
    }];
  });
}
