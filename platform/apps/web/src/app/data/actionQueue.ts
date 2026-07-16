// Shared pending-action store. A Signal's chosen action is DRAFTED here (decision === null) and
// surfaces in the Approvals inbox — the draft-then-approve loop. This is the seam A3 upgrades:
// today it persists to localStorage; later `proposeAction`/`resolveAction` write through to the
// Supabase `ledger` table (see data/ledger.ts), with the same hook API so components don't change.
import { useSyncExternalStore } from 'react';
import type { LedgerEntry } from './governance';

const KEY = 'bridge.actionQueue.v1';

function load(): LedgerEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LedgerEntry[]) : [];
  } catch {
    return [];
  }
}

let queue: LedgerEntry[] = load();
const subscribers = new Set<() => void>();

function emit() {
  try { localStorage.setItem(KEY, JSON.stringify(queue)); } catch { /* ignore quota/SSR */ }
  subscribers.forEach(fn => fn());
}

/** Draft a proposed action into the pending queue (idempotent by id). */
export function proposeAction(entry: LedgerEntry) {
  if (queue.some(e => e.id === entry.id)) return;
  queue = [entry, ...queue];
  emit();
}

/** Remove a pending action once it's been decided (approved/vetoed/edited). */
export function resolveAction(id: string) {
  if (!queue.some(e => e.id === id)) return;
  queue = queue.filter(e => e.id !== id);
  emit();
}

/** Bind an offline draft to the one remote proposal created for it. */
export function bindProposal(id: string, proposalId: string) {
  if (!queue.some(entry => entry.id === id)) return;
  queue = queue.map(entry => entry.id === id ? { ...entry, proposalId } : entry);
  emit();
}

export function clearActions() {
  queue = [];
  emit();
}

export function getActions(): LedgerEntry[] {
  return queue;
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Reactive read of the pending-action queue. */
export function useActionQueue(): LedgerEntry[] {
  return useSyncExternalStore(subscribe, () => queue, () => queue);
}
