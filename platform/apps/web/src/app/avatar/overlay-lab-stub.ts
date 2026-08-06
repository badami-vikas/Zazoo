/**
 * overlay-lab-stub — a browser-only stand-in for the Tauri bridge, so the
 * companion overlay (overlay.html) can be rendered, driven, and DEBUGGED in a
 * plain browser tab: `overlay.html?lab=1`.
 *
 * Why it exists: the desktop shell's webview cannot be inspected from outside
 * (no `.app` bundle, no attached devtools), so when a pointer/render bug
 * appears ONLY in the shell, this stub is the honest way to bisect — if the
 * bug reproduces here it's the React layer; if it doesn't, it's the shell.
 *
 * Honesty per AP-021: this never fakes success in the real app. It installs
 * only when `?lab=1` is present AND no real bridge exists, and every invoke
 * is logged to the console so what-the-shell-would-do stays visible.
 */

/** The live-measured geometry of this project's reference MacBook (Mac14,2). */
const LAB_GEOMETRY = {
  hasNotch: true,
  x: 646,
  y: 0,
  width: 179,
  height: 32,
  screenWidth: 1470,
  screenHeight: 956,
  scaleFactor: 2,
  visibleLeft: 0,
  visibleTop: 33,
  visibleRight: 1470,
  visibleBottom: 863,
};

export function installOverlayLabStub(): void {
  if (typeof window === "undefined") return;
  if (!new URLSearchParams(window.location.search).has("lab")) return;
  if (window.__TAURI_INTERNALS__) return; // never shadow the real bridge

  const listeners = new Map<number, { event: string; handler: (data: unknown) => void }>();
  let nextCallbackId = 1;
  const callbacks = new Map<number, (data: unknown) => void>();

  window.__TAURI_INTERNALS__ = {
    transformCallback(callback: (data: unknown) => void): number {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    async invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
      console.info("[overlay-lab] invoke", cmd, args ?? {});
      switch (cmd) {
        case "notch_geometry":
          return LAB_GEOMETRY;
        case "overlay_get_session_ready":
          return true;
        case "plugin:event|listen": {
          const handlerId = args?.handler as number;
          const event = args?.event as string;
          const handler = callbacks.get(handlerId);
          if (handler) {
            const id = nextCallbackId++;
            listeners.set(id, { event, handler });
            return id;
          }
          return -1;
        }
        case "plugin:event|unlisten":
          return null;
        default:
          // Window-management commands (dock/undock/resize/present/conceal)
          // have no browser equivalent; acknowledging them keeps the UI flow
          // moving so the choreography itself can be observed.
          return null;
      }
    },
  } as unknown as typeof window.__TAURI_INTERNALS__;

  // Lab controls, driveable from the devtools console / automation:
  (window as unknown as Record<string, unknown>).__OVERLAY_LAB__ = {
    geometry: LAB_GEOMETRY,
    emit(event: string, payload: unknown) {
      for (const entry of listeners.values()) {
        if (entry.event === event) entry.handler({ payload });
      }
    },
  };
  console.info("[overlay-lab] Tauri bridge stubbed — drive with window.__OVERLAY_LAB__");
}
