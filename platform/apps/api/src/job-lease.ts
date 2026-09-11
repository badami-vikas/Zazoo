/**
 * withLease — run a scheduled job only on the instance that holds its lease.
 * Render's zero-downtime deploy runs old+new API processes briefly; without a
 * lease every interval job runs twice. No store (no DATABASE_URL: the desktop
 * sidecar, in-memory dev) means single-instance by construction, so just run.
 */
import { hostname } from "node:os";

export interface JobLeaseStore {
  tryAcquire(name: string, holder: string, ttlMs: number): Promise<boolean>;
  release(name: string, holder: string): Promise<void>;
}

export const LEASE_HOLDER = `${hostname()}:${process.pid}`;

export async function withLease(
  store: JobLeaseStore | null,
  name: string,
  ttlMs: number,
  run: () => Promise<void>,
  log?: { debug(obj: object, msg: string): void },
): Promise<void> {
  if (!store) return run();
  if (!(await store.tryAcquire(name, LEASE_HOLDER, ttlMs))) {
    log?.debug({ job: name }, "job skipped: lease held by another instance");
    return;
  }
  // ponytail: released on completion, so two instances with offset timers can
  // each run once per interval; hold until expiry if exactly-once-per-window matters.
  try {
    await run();
  } finally {
    await store.release(name, LEASE_HOLDER);
  }
}
