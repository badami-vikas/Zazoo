/**
 * Minimal raw-internals Tauri v2 helpers shared by the companion surfaces
 * (OverlayApp, CompanionAsk, AnnotateApp). Reimplements the two calls
 * @tauri-apps/api would make rather than adding the module — the codebase's
 * existing browser-first approach (see desktop-shell.d.ts). Both no-op
 * outside Tauri so every component degrades gracefully in the browser.
 */

export function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke) return Promise.resolve(undefined);
  return internals.invoke(cmd, args).catch((err: unknown) => {
    // Never let a window-chrome failure break the avatar itself.
    console.error("[companion] invoke failed", cmd, err);
    return undefined;
  });
}

/** Variant that REJECTS on failure so callers can surface typed errors
 * (companion_ask returns structured { code, message } failures the ask panel
 * renders honestly instead of swallowing). */
export function tauriInvokeStrict(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke) {
    return Promise.reject(new Error("desktop shell unavailable"));
  }
  return internals.invoke(cmd, args);
}

export async function tauriListen<T>(
  event: string,
  callback: (payload: T) => void,
): Promise<() => void> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke || !internals.transformCallback) return () => undefined;
  const handler = internals.transformCallback((data: unknown) => {
    const eventData = data as { payload?: T };
    if (eventData && "payload" in eventData) callback(eventData.payload as T);
  });
  const eventId = await internals.invoke("plugin:event|listen", {
    event,
    target: { kind: "Any" },
    handler,
  });
  if (typeof eventId !== "number") throw new Error(`Invalid Tauri listener id for ${event}`);
  return () => {
    void internals.invoke("plugin:event|unlisten", { event, eventId }).catch((error: unknown) => {
      console.error("[companion] unlisten failed", event, error);
    });
  };
}
