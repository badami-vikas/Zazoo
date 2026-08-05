/**
 * macOS inline-titlebar strip (ADR-187).
 *
 * Tauri's overlay title bar (`title_bar_style: Overlay` in tauri.conf.json —
 * already configured, no native change needed here) draws the real AppKit
 * traffic-light buttons ON TOP of our webview content, top-left. Earlier this
 * was handled with a dedicated `h-8` spacer stacked ABOVE the left rail's
 * organization row only — which pushed the rail's header 32px lower than the
 * main-content and chat-panel headers and produced the "two underlines"
 * artifact (the rail's own border-b landing 32px below the other headers'
 * border-b/shadow line).
 *
 * Fix: reserve the traffic-light gutter in ONE shared strip that spans the
 * FULL window width, mounted above all three shell columns (rail | main
 * content | chat panel) in Layout.tsx, instead of inside the rail alone.
 * Because every column's own header now starts at the same y (either 0, off
 * macOS desktop, or MAC_TITLEBAR_H, on it), the three h-14 header rows can
 * never drift apart again — there is nothing column-specific left to drift.
 *
 * This strip is also where the workspace/organization name renders "next to"
 * the traffic lights (user ask, 2026-08-05): a plain, non-interactive label
 * in the native-titlebar convention. The INTERACTIVE organization switcher
 * (avatar + name + dropdown) still lives in the rail's own header row below —
 * this label does not replace it, it mirrors it the way a native app mirrors
 * its document title next to the traffic lights.
 */
export const MAC_TITLEBAR_H = 32; // px — h-8, unchanged from the prior spacer
export const MAC_TRAFFIC_LIGHT_GUTTER = 78; // px — clears AppKit's traffic-light cluster

export function useIsMacDesktop(): boolean {
  return (
    typeof window !== "undefined" && window.__BRIDGE_DESKTOP_PLATFORM__ === "macos"
  );
}

interface DesktopTitlebarProps {
  organizationName?: string | undefined;
}

/**
 * Full-width draggable titlebar strip. Renders nothing off macOS desktop —
 * web and non-mac desktop builds keep the default browser/OS chrome and need
 * no reserved space, so the shell headers already start at y=0 in lockstep.
 */
export function DesktopTitlebar({ organizationName }: DesktopTitlebarProps) {
  const isMacDesktop = useIsMacDesktop();
  if (!isMacDesktop) return null;

  return (
    <div
      data-tauri-drag-region
      className="flex items-center shrink-0"
      style={{ height: MAC_TITLEBAR_H, paddingLeft: MAC_TRAFFIC_LIGHT_GUTTER }}
      aria-hidden="true"
    >
      {organizationName && (
        <span
          className="text-xs font-medium truncate select-none"
          style={{ color: "var(--color-navy-mid)" }}
        >
          {organizationName}
        </span>
      )}
    </div>
  );
}
