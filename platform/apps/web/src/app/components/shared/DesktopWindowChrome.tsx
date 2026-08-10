/**
 * macOS inline-titlebar geometry (ADR-187, revised 2026-08-10).
 *
 * Tauri's overlay title bar (`title_bar_style: Overlay` in tauri.conf.json)
 * draws the real AppKit traffic-light buttons ON TOP of our webview content,
 * top-left. ADR-187 reserved that space with a dedicated 32px strip spanning
 * the full window above the three shell columns.
 *
 * That strip is now gone. User directive 2026-08-10: *"The header row is the
 * one with traffic lights. I asked for workspace name (Test) not to repeat
 * below traffic light. ALso the toggle should appear in same row as traffic
 * light and so should Chief of Staff text."* A separate strip guarantees the
 * opposite — it pushes every header row 32px BELOW the traffic lights, so the
 * window name has to be duplicated up there to fill the empty band.
 *
 * The replacement: the shell's own h-14 header row IS the titlebar. The rail's
 * header carries `data-tauri-drag-region` and a left pad of
 * MAC_TRAFFIC_LIGHT_GUTTER, so the traffic lights sit inside it, with the
 * Organization switcher, the centre toggle and the chat panel's Chief of Staff
 * all on that one line. ADR-187's actual invariant — one shared reservation,
 * never a per-column one — is preserved: there is now zero reserved space, so
 * the three headers still cannot drift apart.
 */
export const MAC_TRAFFIC_LIGHT_GUTTER = 78; // px — clears AppKit's traffic-light cluster

export function useIsMacDesktop(): boolean {
  return (
    typeof window !== "undefined" && window.__BRIDGE_DESKTOP_PLATFORM__ === "macos"
  );
}
