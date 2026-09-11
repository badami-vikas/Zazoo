/**
 * @fastify/rate-limit custom `store` over the shared Postgres counter, so a
 * second API instance shares one budget instead of doubling it. Contract for
 * the installed 10.x plugin: `new Store(options)`, `incr(key, cb, timeWindow,
 * max)` calling back `{ current, ttl }` (ttl in ms), `child(routeOptions)`.
 */
import type rateLimit from "@fastify/rate-limit";
import type { DrizzleRateLimitStore } from "@bridge/db";

type Store = rateLimit.FastifyRateLimitStore;

export function pgRateLimitStore(counter: Pick<DrizzleRateLimitStore, "incr">): rateLimit.FastifyRateLimitStoreCtor {
  class PgRateLimitStore implements Store {
    constructor(_options: rateLimit.FastifyRateLimitOptions) {}
    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow = 60_000,
    ): void {
      counter.incr(key, timeWindow).then(
        ({ count, ttlMs }) => callback(null, { current: count, ttl: ttlMs }),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    }
    child(routeOptions: rateLimit.FastifyRateLimitOptions): Store {
      return new PgRateLimitStore(routeOptions);
    }
  }
  return PgRateLimitStore;
}
