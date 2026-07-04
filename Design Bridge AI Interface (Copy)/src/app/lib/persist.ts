import { useEffect, useState } from 'react';

// Generalizes the localStorage persistence pattern already proven in ResourcesPage
// (EDITS_KEY/ADDED_KEY) so every table surface can survive a refresh, not just Resources.
// Prototype-tier persistence: per-browser, per-device. Swap for a Supabase/API-backed
// PersistencePort later without touching call sites (same hook shape).
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function usePersistentState<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(() => loadJSON(key, fallback));
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota/serialization — edit stays session-only this tab */ }
  }, [key, state]);
  return [state, setState] as const;
}
