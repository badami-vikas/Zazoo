/**
 * K11 (TASK-054) — the input lane's drain loop: the JS half of the shell's
 * "drain, don't push" sensor design, following K7's `app-focus-capture.ts`
 * precedent exactly where it can and diverging only where this lane's
 * severity demands it.
 *
 * The Rust tap (`providers/input_tap.rs`) accumulates keystroke bursts and
 * BUFFERS emissions; it never does HTTP. This hook owns the other half:
 *
 *  - RECONCILE (30s + on mount): poll `learning.capture.input.policy` and
 *    start/stop the shell's "input" sensor to match, so the kill switch and
 *    the consent toggle stop the TAP ITSELF, not merely the API's acceptance
 *    of what it produces. For a keystroke tap that difference is the whole
 *    point: "we collected it and declined to store it" is not what the
 *    consent card promises.
 *  - DRAIN (5s while capturing): `sensor_drain`, then post each burst to
 *    `learning.capture.input.burst`.
 *
 * TWO DIVERGENCES FROM K7, both deliberate:
 *
 *  1. The typed text is NOT in the observation. It sits in the local-plane
 *     raw ring and is reachable only via `sensor_read_raw(raw_id)` — the
 *     ADR-014 rule that an Observation never carries raw capture content.
 *     So this loop makes a second, explicit call to fetch it.
 *  2. **The shell re-checks the field role before it fetches that text.**
 *     The Rust accumulator already refuses to collect characters for a
 *     non-content field, and the API re-distils everything it receives — so
 *     this is the third of three independent refusals. It is here because a
 *     drain loop is the easiest place to accidentally launder a payload: had
 *     it simply fetched whatever `raw_id` pointed at, a future producer bug
 *     that attached a raw payload to a secure-field burst would be posted
 *     verbatim. The role gate means a suppressed burst's text is never even
 *     REQUESTED from the ring.
 *
 * Browser deploys: feature-detected no-op (no shell, no sensor).
 */
import { useEffect } from "react";
import { trpc, PILOT_ORGANIZATION } from "./trpc";
// The decision layer lives in its own import-free module so the fail-closed
// role gate can be tested without React or a tRPC client — see its header.
import { planInputBurstReport, type DrainedObservation } from "./input-capture-plan";

const RECONCILE_INTERVAL_MS = 30_000;
const DRAIN_INTERVAL_MS = 5_000;

export function useInputCaptureDrain() {
  useEffect(() => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!window.__BRIDGE_DESKTOP__ || !invoke) return;

    let capturing = false;
    let draining = false;

    const reconcile = async () => {
      try {
        const policy = await trpc.learning.capture.input.policy.query({
          organizationId: PILOT_ORGANIZATION,
        });
        const next = Boolean(policy.enabled && policy.capturing);
        if (next === capturing) return;
        capturing = next;
        // `sensor_start` fails when Input Monitoring has not been granted.
        // That is a real state, not an error to swallow: the tap stays off
        // and `capturing` is rolled back so the next reconcile retries
        // rather than draining a sensor that never started.
        try {
          await invoke(next ? "sensor_start" : "sensor_stop", { sensorId: "input" });
        } catch {
          capturing = false;
        }
      } catch {
        // API away (booting, signed out): leave the sensor as it was. The
        // drain no-ops while `capturing` is false, and the API's own consent
        // gate holds regardless — defense in depth, not the only gate.
      }
    };

    const drain = async () => {
      if (!capturing || draining) return;
      draining = true;
      try {
        const observations = (await invoke("sensor_drain")) as DrainedObservation[];
        for (const observation of observations) {
          const plan = planInputBurstReport(observation);
          if (!plan) continue;

          // See divergence 2 in the header: `plan.rawId` is non-null ONLY for
          // a role that positively allows content, so a suppressed burst's
          // text is never even REQUESTED from the ring.
          let text = "";
          if (plan.rawId !== null) {
            const raw = (await invoke("sensor_read_raw", { id: plan.rawId })) as
              | { text?: unknown }
              | null;
            // The ring is bounded and evicts: a burst whose payload aged out
            // reports as a no-content burst rather than being dropped. The
            // fact that typing happened is still true and still consented.
            if (raw && typeof raw.text === "string") text = raw.text;
          }

          await trpc.learning.capture.input.burst.mutate({
            organizationId: PILOT_ORGANIZATION,
            burstId: crypto.randomUUID(),
            ...plan.report,
            text,
          });
        }
      } catch {
        // Dropped batch — no retry queue, by K7/K8 precedent. A queue here
        // would mean typed text outliving the drain that was supposed to
        // hand it over, which is the opposite of what this lane promises.
      } finally {
        draining = false;
      }
    };

    void reconcile();
    const reconcileTimer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
    const drainTimer = setInterval(() => void drain(), DRAIN_INTERVAL_MS);
    return () => {
      clearInterval(reconcileTimer);
      clearInterval(drainTimer);
      // The authed shell going away takes the drain loop with it — stop the
      // tap too, so keystrokes are never accumulated by a buffer nothing is
      // draining.
      void invoke("sensor_stop", { sensorId: "input" }).catch(() => {});
    };
  }, []);
}
