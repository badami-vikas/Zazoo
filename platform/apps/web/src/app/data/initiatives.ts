// User-created Initiatives — a reactive, localStorage-backed store. Starts EMPTY (no dummy data);
// the user creates initiatives from the Work surface. Edits are LOCAL (relationship/operational tier
// is customer-controlled per the residency split) — nothing here writes to Supabase.
import { useSyncExternalStore } from 'react';

export interface Initiative {
  id: string;
  name: string;
  status: 'Planning' | 'Active' | 'On Hold' | 'Completed';
  list: string;            // Work / Academics / Personal / …
  goal: string;
  progress: number;        // 0–100
  owner: string;
  deadline: string;
  visibility: 'private' | 'team' | 'workspace';  // two-tier residency / RLS tier
  moduleTo?: string;      // when this Initiative was created from a Module (NewModuleDialog), its real surface route
  packageName?: string;   // the source Module's package name
}

const KEY = 'bridge.initiatives.v1';

function load(): Initiative[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
let items: Initiative[] = typeof window !== 'undefined' ? load() : [];
let counter = items.length;
const subs = new Set<() => void>();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }
function emit() { subs.forEach(fn => fn()); }

export function getInitiatives(): Initiative[] { return items; }

export function createInitiative(p: Partial<Initiative>): Initiative {
  counter += 1;
  const it: Initiative = {
    id: `INI-${counter}-${(items.length + 1)}`,
    name: (p.name || '').trim() || 'Untitled initiative',
    status: p.status || 'Planning',
    list: p.list || 'Work',
    goal: p.goal || '',
    progress: typeof p.progress === 'number' ? p.progress : 0,
    owner: p.owner || 'You',
    deadline: p.deadline || '—',
    visibility: p.visibility || 'workspace',
    ...(p.moduleTo ? { moduleTo: p.moduleTo } : {}),
    ...(p.packageName ? { packageName: p.packageName } : {}),
  };
  items = [it, ...items];
  persist(); emit();
  return it;
}

export function deleteInitiative(id: string) {
  items = items.filter(i => i.id !== id);
  persist(); emit();
}

export function updateInitiative(id: string, patch: Partial<Initiative>) {
  items = items.map(i => i.id === id ? { ...i, ...patch } : i);
  persist(); emit();
}

export function useInitiatives(): Initiative[] {
  return useSyncExternalStore(
    fn => { subs.add(fn); return () => { subs.delete(fn); }; },
    () => items,
    () => items,
  );
}
