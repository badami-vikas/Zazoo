/**
 * Globals injected by the Bridge desktop shell (apps/desktop, Tauri v2).
 * Absent in plain-browser deploys — always feature-detect.
 */
interface Window {
  /** Set by the shell's window init script — marks "running inside Tauri". */
  __BRIDGE_DESKTOP__?: boolean;
  /** Rust target OS, used for platform-safe shell chrome. */
  __BRIDGE_DESKTOP_PLATFORM__?: "macos" | "windows" | "linux" | string;
  /** Sidecar API base URL (e.g. "http://127.0.0.1:49321"), injected before
   * any app module evaluates. See apps/desktop src-tauri/src/lib.rs. */
  __BRIDGE_API_URL__?: string;
  /** Per-launch capability for the managed loopback API. Never persisted or put in a URL. */
  __BRIDGE_SIDECAR_TOKEN__?: string;
  /** Tauri v2 runtime internals — used for `invoke` (and, for the annotate
   * window, event `listen`) without adding @tauri-apps/api as a dependency
   * of the (browser-first) web app. `transformCallback` registers a JS
   * callback and returns its numeric id — the same primitive
   * @tauri-apps/api's own `listen()` uses internally to satisfy the
   * `plugin:event|listen` command's `handler: CallbackFn` (a bare u32,
   * confirmed against the vendored tauri crate source). Both are
   * core-injected by every Tauri v2 webview, not part of the optional npm
   * module. */
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    transformCallback?: (callback: (data: unknown) => void, once?: boolean) => number;
  };
}
