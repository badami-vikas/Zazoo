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

/**
 * Start-then-poll invocation (BUGS 2026-07-30 residual, fixed): WKWebView
 * aborts the whole app when a command answers after ~60s, so long-running
 * shell commands (`companion_ask`, `research_locate`, `research_chat`) are
 * split into a `_start` returning a job id and an instant `_poll`. This
 * helper drives that pair: start, then poll until `done` or the client-side
 * deadline. The poll envelope is `{ done, <valueKey> }` where the value may
 * itself be null (e.g. "locate finished, target not found").
 */
export async function tauriInvokeJob<T>(
  startCmd: string,
  pollCmd: string,
  args: Record<string, unknown>,
  options: { valueKey: string; timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const job = (await tauriInvokeStrict(startCmd, args)) as number;
  if (typeof job !== "number") {
    throw new Error(`${startCmd} returned no job id`);
  }
  const intervalMs = options.intervalMs ?? 900;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const envelope = (await tauriInvokeStrict(pollCmd, { job })) as {
      done: boolean;
    } & Record<string, unknown>;
    if (envelope.done) return envelope[options.valueKey] as T;
    if (Date.now() > deadline) {
      throw new Error(`${startCmd} did not finish within ${Math.round(options.timeoutMs / 1000)}s`);
    }
  }
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
