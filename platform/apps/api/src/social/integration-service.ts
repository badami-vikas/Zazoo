/**
 * Integration service — a process-wide handle to the governed integration store,
 * bound to the LOCAL plane (integration records + tokens are private, so they live
 * on the local pglite store, never cloud Supabase). Memoized so the local db opens
 * once. BRIDGE_LOCAL_DIR points at a file-backed store; absent, an in-memory pglite
 * is used (dev).
 */
import { createLocalDb, DrizzleIntegrationStore } from "@bridge/db";

let handle: Promise<{ store: DrizzleIntegrationStore; close: () => Promise<void> }> | null = null;

export function getIntegrationStore(): Promise<{ store: DrizzleIntegrationStore; close: () => Promise<void> }> {
  if (!handle) {
    const dataDir = process.env.BRIDGE_LOCAL_DIR;
    handle = createLocalDb(dataDir ? { dataDir } : {}).then(({ db, close }) => ({
      store: new DrizzleIntegrationStore(db),
      close,
    }));
  }
  return handle;
}
