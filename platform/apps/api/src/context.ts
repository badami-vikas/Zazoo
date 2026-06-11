/**
 * tRPC request context. Carries the assembled pipeline + a per-request RunCtx
 * (determinism seams). At the system boundary we use the wall clock; the RNG is
 * seeded from the clock so engine code stays deterministic and replayable.
 */
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import type { Wiring } from "./wiring.js";

export interface ApiContext {
  wiring: Wiring;
  run: RunCtx;
}

export function makeContextFactory(wiring: Wiring) {
  return function createContext(): ApiContext {
    const clock = new SystemClock();
    const rng = new SeededRng(clock.nowMs() >>> 0); // boundary seed
    // UuidGen (not UlidGen): ledger ids are written to Postgres `uuid` columns.
    return { wiring, run: { clock, rng, ids: new UuidGen(clock, rng) } };
  };
}
