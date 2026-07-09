// Lists — the standardized, platform-wide user-creatable list subsystem (Phase 2 of the UI
// standardization pass). Any tool page can mount a scope (e.g. 'jobpilot', 'dealpilot') and get:
// create/rename/delete, a per-list AI instruction the agent must follow, real membership, and
// merge (which stamps every member with a "category" = the name of the list it came from, so a
// merged list's table/list view can show provenance instead of silently blending data).
import { useSyncExternalStore } from 'react';

export interface ToolList {
  id: string;
  scope: string;
  name: string;
  instruction: string;
  memberIds: string[];
  // Present only on a list produced by mergeLists — memberId -> the name of the list it came from.
  origin?: Record<string, string>;
  createdAt: number;
}

const KEY = 'bridge_lists_v1';
let state: Record<string, ToolList[]> = load();
const listeners = new Set<() => void>();

function load(): Record<string, ToolList[]> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

function id() { return `list_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

export function useLists(scope: string): ToolList[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state[scope] ?? EMPTY,
  );
}
const EMPTY: ToolList[] = [];

export function createList(scope: string, name: string, instruction = ''): ToolList {
  const list: ToolList = { id: id(), scope, name, instruction, memberIds: [], createdAt: Date.now() };
  state = { ...state, [scope]: [...(state[scope] ?? []), list] };
  persist();
  return list;
}

// Seeds default lists for a scope exactly once — reads the module's own state directly (not a
// hook value) so it's safe to call from an effect that React (StrictMode) may invoke twice.
export function seedListsIfEmpty(scope: string, seeds: { name: string; instruction?: string }[]) {
  if ((state[scope] ?? []).length > 0) return;
  for (const s of seeds) createList(scope, s.name, s.instruction ?? '');
}

export function deleteList(scope: string, listId: string) {
  state = { ...state, [scope]: (state[scope] ?? []).filter((l) => l.id !== listId) };
  persist();
}

export function setListInstruction(scope: string, listId: string, instruction: string) {
  state = { ...state, [scope]: (state[scope] ?? []).map((l) => (l.id === listId ? { ...l, instruction } : l)) };
  persist();
}

export function toggleMember(scope: string, listId: string, itemId: string) {
  state = {
    ...state,
    [scope]: (state[scope] ?? []).map((l) => {
      if (l.id !== listId) return l;
      const has = l.memberIds.includes(itemId);
      return { ...l, memberIds: has ? l.memberIds.filter((m) => m !== itemId) : [...l.memberIds, itemId] };
    }),
  };
  persist();
}

// Merge N lists into a new one. Every member is stamped with the name of the (last) source list
// it belonged to, so the merged list can render a "Category" column showing where each row came
// from — the source lists are removed once folded in.
export function mergeLists(scope: string, listIds: string[], newName: string): ToolList {
  const lists = state[scope] ?? [];
  const sources = lists.filter((l) => listIds.includes(l.id));
  const memberIds: string[] = [];
  const origin: Record<string, string> = {};
  for (const src of sources) {
    for (const m of src.memberIds) {
      if (!memberIds.includes(m)) memberIds.push(m);
      origin[m] = src.name;
    }
  }
  const merged: ToolList = { id: id(), scope, name: newName, instruction: sources.map((s) => s.instruction).filter(Boolean).join(' · '), memberIds, origin, createdAt: Date.now() };
  state = { ...state, [scope]: [...lists.filter((l) => !listIds.includes(l.id)), merged] };
  persist();
  return merged;
}
