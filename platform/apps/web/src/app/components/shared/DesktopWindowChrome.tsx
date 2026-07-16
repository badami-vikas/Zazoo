interface Props {
  expanded: boolean;
}

/**
 * Reserves a draggable Sidebar titlebar lane for macOS. Tauri's overlay title
 * bar places the real AppKit close/minimize/zoom controls in this space, so
 * their native keyboard, VoiceOver, and window-management behavior is kept.
 */
export function DesktopWindowChrome({ expanded }: Props) {
  const isMacDesktop =
    typeof window !== "undefined" &&
    window.__BRIDGE_DESKTOP_PLATFORM__ === "macos";

  if (!isMacDesktop) return null;

  return (
    <div
      className={`h-8 shrink-0 ${expanded ? "pr-2" : ""}`}
      data-tauri-drag-region
      aria-hidden="true"
    />
  );
}
