/**
 * The one in-process tRPC caller for API tests. Replaced 39 hand-copied
 * `makeCaller`/`makeRun` pairs (2026-09-03 cleanup). Files that need a
 * taint-labelled RunCtx keep their own `makeRun`.
 */
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { PILOT_USER, type Wiring } from "../src/wiring.js";

export function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

/** `identity` may be an Actor, a bare user id, or (legacy call sites) the RNG seed. */
export function makeCaller(
  wiring: Wiring,
  identity?: Actor | string | number,
  seed = 1,
): ReturnType<typeof appRouter.createCaller> {
  const actor: Actor =
    typeof identity === "object"
      ? identity
      : { type: "user", id: typeof identity === "string" ? identity : PILOT_USER };
  return appRouter.createCaller({
    wiring,
    run: makeRun(typeof identity === "number" ? identity : seed),
    identity: actor,
    authenticated: true, // in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}
