// User-created Records — a reactive, localStorage-backed store. Starts EMPTY (no dummy data);
// the user creates records from the Work surface. Edits are LOCAL (relationship/operational tier
// is customer-controlled per the residency split) — nothing here writes to Supabase.
import { useSyncExternalStore } from 'react';

export interface Record {
  id: string;
  name: string;
  status: 'Planning' | 'Active' | 'On Hold' | 'Completed';
  list: string;            // Work / Academics / Personal / …
  goal: string;
  progress: number;        // 0–100
  owner: string;
  deadline: string;
  visibility: 'private' | 'team' | 'organization';  // two-tier residency / RLS tier
  moduleTo?: string;      // when this Record was created from a Module (NewModuleDialog), its real surface route
  moduleName?: string;   // the source Module's module name
}

const KEY = 'bridge.records.v1';

function load(): Record[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
let items: Record[] = typeof window !== 'undefined' ? load() : [];
let counter = items.length;
const subs = new Set<() => void>();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }
function emit() { subs.forEach(fn => fn()); }

export function getRecords(): Record[] { return items; }

export function createRecord(p: Partial<Record>): Record {
  counter += 1;
  const it: Record = {
    id: `INI-${counter}-${(items.length + 1)}`,
    name: (p.name || '').trim() || 'Untitled record',
    status: p.status || 'Planning',
    list: p.list || 'Work',
    goal: p.goal || '',
    progress: typeof p.progress === 'number' ? p.progress : 0,
    owner: p.owner || 'You',
    deadline: p.deadline || '—',
    visibility: p.visibility || 'organization',
    ...(p.moduleTo ? { moduleTo: p.moduleTo } : {}),
    ...(p.moduleName ? { moduleName: p.moduleName } : {}),
  };
  items = [it, ...items];
  persist(); emit();
  return it;
}

export function deleteRecord(id: string) {
  items = items.filter(i => i.id !== id);
  persist(); emit();
}

export function updateRecord(id: string, patch: Partial<Record>) {
  items = items.map(i => i.id === id ? { ...i, ...patch } : i);
  persist(); emit();
}

export function useRecords(): Record[] {
  return useSyncExternalStore(
    fn => { subs.add(fn); return () => { subs.delete(fn); }; },
    () => items,
    () => items,
  );
}
