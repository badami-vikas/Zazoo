const DESKTOP_NAVIGATION_EVENT = "bridge:navigate";
const TASK_ROUTE = /^\/task-manager\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isAllowedDesktopRoute(value: unknown): value is string {
  return typeof value === "string" && TASK_ROUTE.test(value);
}

export async function installDesktopNavigation(
  navigate: (route: string) => void | Promise<void>,
): Promise<() => void> {
  const internals = window.__TAURI_INTERNALS__;
  if (!window.__BRIDGE_DESKTOP__ || !internals?.invoke || !internals.transformCallback) {
    return () => undefined;
  }
  const handler = internals.transformCallback((data: unknown) => {
    const payload = (data as { payload?: unknown } | null)?.payload;
    if (isAllowedDesktopRoute(payload)) void navigate(payload);
  });
  const eventId = await internals.invoke("plugin:event|listen", {
    event: DESKTOP_NAVIGATION_EVENT,
    target: { kind: "Any" },
    handler,
  });
  if (typeof eventId !== "number") {
    throw new Error("Desktop navigation listener returned an invalid event id");
  }
  return () => {
    void internals.invoke("plugin:event|unlisten", {
      event: DESKTOP_NAVIGATION_EVENT,
      eventId,
    });
  };
}
