/**
 * DrizzleRateLimitStore — fixed-window counter shared by every API instance.
 * One upsert per hit; the window restarts when `reset_at` has passed. The
 * database clock is the only clock.
 */
import { lt, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { rateLimitBuckets } from "./schema.js";

export class DrizzleRateLimitStore {
  constructor(private readonly db: Database) {}

  async incr(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const expired = sql`${rateLimitBuckets.resetAt} < now()`;
    const [row] = await this.db
      .insert(rateLimitBuckets)
      .values({
        key,
        count: 1,
        resetAt: sql`now() + (${Math.trunc(windowMs)}::int * interval '1 millisecond')`,
      })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: {
          count: sql`case when ${expired} then 1 else ${rateLimitBuckets.count} + 1 end`,
          resetAt: sql`case when ${expired} then excluded.reset_at else ${rateLimitBuckets.resetAt} end`,
        },
      })
      .returning();
    // ponytail: opportunistic sweep of stale buckets (~1% of hits); a scheduled
    // job if the table ever measurably grows.
    if (Math.random() < 0.01) {
      void this.db
        .delete(rateLimitBuckets)
        .where(lt(rateLimitBuckets.resetAt, sql`now() - interval '1 day'`))
        .catch(() => undefined);
    }
    // ponytail: ttl mixes the db's reset_at with this process's clock; only the
    // reset/retry-after headers see any skew, never the count.
    return { count: row!.count, ttlMs: Math.max(0, row!.resetAt.getTime() - Date.now()) };
  }
}
