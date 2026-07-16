/**
 * DesktopWindowChrome — supplemental close/minimize/zoom buttons shown in the
 * sidebar header when running under the Tauri desktop shell (TASK-003).
 *
 * Cross-platform-safe: the buttons call Rust commands (`close_main_window`,
 * `minimize_main_window`, `toggle_zoom_main_window`) that work on all
 * platforms. Rendered only when `window.__TAURI_INTERNALS__` is present so
 * the web-only build is unaffected.
 *
 * **macOS "traffic lights" pattern (local macOS session required)**
 * The canonical macOS look — native red/yellow/green circles in the
 * top-left corner replacing the title bar — requires:
 *   1. `.decorations(false)` on the main window builder in `lib.rs`
 *   2. `data-tauri-drag-region` on the sidebar header `h-14` div
 *   3. macOS-specific CSS: `env(titlebar-area-x/y/width/height)` OR
 *      `-webkit-app-region: drag/no-drag` on the appropriate elements
 *   4. `hiddenTitle: true` in `tauri.conf.json` (optional cosmetic)
 * This component deliberately does NOT do those changes. They require live
 * macOS verification and are flagged as blockers in TASK-003's output.
 */

function tauriInvoke(cmd: string): Promise<unknown> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke) return Promise.resolve(undefined);
  return internals.invoke(cmd).catch((err: unknown) => {
    console.error("[window-chrome] invoke failed", cmd, err);
    return undefined;
  });
}

interface Props {
  /** Whether the sidebar is currently expanded (shows labels alongside icons). */
  expanded: boolean;
}

/**
 * Tiny, OS-agnostic window controls — styled neutrally so they look
 * intentional on all platforms. Only visible under Tauri.
 */
export function DesktopWindowChrome({ expanded }: Props) {
  const isTauri =
    typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
  if (!isTauri) return null;

  return (
    <div
      className={`flex items-center gap-1 shrink-0 ${
        expanded ? "px-3 py-2" : "px-2 py-2 justify-center"
      }`}
      aria-label="Window controls"
      // data-tauri-drag-region would allow dragging the main window from the
      // sidebar area. It only takes effect when the window is undecorated
      // (decorations: false in the main window builder). Kept here as a
      // forward-compatible hook for the macOS-specific work.
      data-tauri-drag-region
    >
      <button
        type="button"
        onClick={() => void tauriInvoke("close_main_window")}
        aria-label="Close Bridge"
        title="Close"
        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:opacity-80 focus:outline-none focus-visible:ring-1 transition-opacity"
        style={{ minWidth: 12, minHeight: 12 }}
      />
      <button
        type="button"
        onClick={() => void tauriInvoke("minimize_main_window")}
        aria-label="Minimise Bridge"
        title="Minimise"
        className="w-3 h-3 rounded-full bg-[#febc2e] hover:opacity-80 focus:outline-none focus-visible:ring-1 transition-opacity"
        style={{ minWidth: 12, minHeight: 12 }}
      />
      <button
        type="button"
        onClick={() => void tauriInvoke("toggle_zoom_main_window")}
        aria-label="Zoom Bridge"
        title="Zoom"
        className="w-3 h-3 rounded-full bg-[#28c840] hover:opacity-80 focus:outline-none focus-visible:ring-1 transition-opacity"
        style={{ minWidth: 12, minHeight: 12 }}
      />
    </div>
  );
}
