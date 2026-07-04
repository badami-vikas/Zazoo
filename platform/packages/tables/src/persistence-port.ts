// Framework-agnostic persistence contract. The prototype's `usePersistentState` (lib/persist.ts,
// 2026-07-03) is a React-hook WRAPPER around exactly this shape — swap the adapter (localStorage
// now, the governed pipeline/API later) without touching call sites, per the plan's
// "compose, don't copy" rule.
export interface PersistencePort {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

export function createLocalStoragePort(storage: Pick<Storage, "getItem" | "setItem">): PersistencePort {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = storage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set<T>(key: string, value: T): void {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        // quota/serialization failure — caller stays session-only for this key, same
        // fallback behavior as the original usePersistentState.
      }
    },
  };
}

// In-memory adapter — for tests, SSR, or any non-React tool (JobPilot/DealPilot backends)
// that wants the same port without a browser.
export function createMemoryPort(): PersistencePort {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback: T): T {
      return store.has(key) ? (store.get(key) as T) : fallback;
    },
    set<T>(key: string, value: T): void {
      store.set(key, value);
    },
  };
}
