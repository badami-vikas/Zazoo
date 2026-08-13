/**
 * K7 (TASK-051) — the desktop drain loop: the JS half of the shell's
 * "drain, don't push" sensor design (src-tauri sensor_bridge.rs).
 *
 * The Rust capture core polls the frontmost app (name, bundle id, and — only
 * with the Accessibility grant — window title, fail-closed) and BUFFERS
 * emissions; it never does HTTP itself. This hook owns the other half:
 *
 *  - RECONCILE (30s + on mount): poll `learning.capture.appfocus.status`
 *    and start/stop the shell's "apps" sensor to match — consent-driven at
 *    the SOURCE, so flipping the toggle or the kill switch stops the poller
 *    itself, not just the API's acceptance of reports (which stays as
 *    defense in depth).
 *  - DRAIN (5s while capturing): `sensor_drain` the buffered observations
 *    and POST each as one `appfocus.focus` report with a minted focusId.
 *    Declines come back as structured verdicts, never errors; a failed POST
 *    drops (no retry queue — K8 precedent; the next real focus change
 *    creates the next signal). Each drain also fires the shell's
 *    `sensor:capture` events, which is what blinks the overlay Avatar.
 *
 * Browser deploys: feature-detected no-op (no shell, no sensor).
 */
import { useEffect } from "react";
import { trpc, PILOT_ORGANIZATION } from "./trpc";

const RECONCILE_INTERVAL_MS = 30_000;
const DRAIN_INTERVAL_MS = 5_000;

interface DrainedObservation {
  kind?: string;
  ts?: number;
  app_name?: string;
  bundle_id?: string;
  window_title?: string;
}

export function useAppFocusCapture() {
  useEffect(() => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!window.__BRIDGE_DESKTOP__ || !invoke) return;

    let capturing = false;
    let draining = false;

    const reconcile = async () => {
      try {
        const status = await trpc.learning.capture.appfocus.status.query({
          organizationId: PILOT_ORGANIZATION,
        });
        const next = Boolean(status.enabled && status.capturing);
        if (next === capturing) return;
        capturing = next;
        await invoke(next ? "sensor_start" : "sensor_stop", { sensorId: "apps" });
      } catch {
        // API away (booting, signed out): leave the sensor as it was — the
        // drain no-ops while `capturing` is false, and the API's own consent
        // gate holds regardless.
      }
    };

    const drain = async () => {
      if (!capturing || draining) return;
      draining = true;
      try {
        const observations = (await invoke("sensor_drain")) as DrainedObservation[];
        for (const observation of observations) {
          if (
            observation.kind !== "apps" ||
            typeof observation.app_name !== "string" ||
            typeof observation.bundle_id !== "string"
          ) {
            continue;
          }
          await trpc.learning.capture.appfocus.focus.mutate({
            organizationId: PILOT_ORGANIZATION,
            focusId: crypto.randomUUID(),
            appName: observation.app_name,
            bundleId: observation.bundle_id,
            // Absent = suppressed at the source (no Accessibility grant) —
            // forwarded as null, never repaired into "".
            windowTitle:
              typeof observation.window_title === "string" ? observation.window_title : null,
            focusedAt: new Date(
              typeof observation.ts === "number" ? observation.ts : Date.now(),
            ).toISOString(),
          });
        }
      } catch {
        // Dropped batch — no retry queue by design; focus rhythm signals
        // are dense enough that the next change re-establishes the stream.
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
      // poller too so the queue cannot grow unobserved in the Rust core.
      void invoke("sensor_stop", { sensorId: "apps" }).catch(() => {});
    };
  }, []);
}
