/**
 * DrizzleJobLeaseStore — a lease ROW per scheduled job so only one API
 * instance runs it per window. One statement: insert, or take over a lease
 * whose `expires_at` has passed. Uses the database clock throughout so
 * instance clock skew cannot double-run a job.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { jobLeases } from "./schema.js";

export class DrizzleJobLeaseStore {
  constructor(private readonly db: Database) {}

  /** True when this holder now owns the lease for `ttlMs`. */
  async tryAcquire(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const rows = await this.db
      .insert(jobLeases)
      .values({
        name,
        holder,
        expiresAt: sql`now() + (${Math.trunc(ttlMs)}::int * interval '1 millisecond')`,
      })
      .onConflictDoUpdate({
        target: jobLeases.name,
        set: { holder: sql`excluded.holder`, expiresAt: sql`excluded.expires_at` },
        setWhere: sql`${jobLeases.expiresAt} < now()`,
      })
      .returning();
    return rows.length > 0;
  }

  /** Releases only if still held by `holder` (a takeover after expiry is left alone). */
  async release(name: string, holder: string): Promise<void> {
    await this.db.delete(jobLeases).where(and(eq(jobLeases.name, name), eq(jobLeases.holder, holder)));
  }
}
