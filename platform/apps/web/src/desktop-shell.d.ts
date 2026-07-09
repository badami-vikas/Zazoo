/**
 * Globals injected by the Bridge desktop shell (apps/desktop, Tauri v2).
 * Absent in plain-browser deploys — always feature-detect.
 */
interface Window {
  /** Set by the shell's window init script — marks "running inside Tauri". */
  __BRIDGE_DESKTOP__?: boolean;
  /** Sidecar API base URL (e.g. "http://127.0.0.1:49321"), injected before
   * any app module evaluates. See apps/desktop src-tauri/src/lib.rs. */
  __BRIDGE_API_URL__?: string;
  /** Tauri v2 runtime internals — used for `invoke` without adding
   * @tauri-apps/api as a dependency of the (browser-first) web app. */
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
}
