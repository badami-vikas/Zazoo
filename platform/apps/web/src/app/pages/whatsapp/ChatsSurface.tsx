import { useEffect, useRef, useState } from "react";
import {
  hideSession,
  isDesktopShell,
  openSession,
  positionSession,
  rectOf,
  sessionStatus,
  type WhatsAppStatus,
} from "./whatsapp-shell";

/**
 * The live WhatsApp Web surface.
 *
 * The session runs in a separate, contained webview window that this component
 * pins to its own placeholder rect, so it reads as embedded while holding no
 * Tauri capability of its own. The placeholder is what the layout sees; the
 * webview simply follows it.
 *
 * The window is hidden on unmount and route change, because a child window
 * that outlives its Page would float over unrelated surfaces.
 */
export function ChatsSurface() {
  const anchor = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);

  useEffect(() => {
    if (!isDesktopShell()) return;
    const element = anchor.current;
    if (!element) return;

    let cancelled = false;
    const track = () => {
      if (cancelled || !anchor.current) return;
      void positionSession(rectOf(anchor.current));
    };

    void openSession(rectOf(element));

    const observer = new ResizeObserver(track);
    observer.observe(element);
    // `scroll` in the capture phase: the Page's own scroll container moves the
    // anchor without firing a window-level scroll event.
    window.addEventListener("scroll", track, true);
    window.addEventListener("resize", track);
    // No blur listener. Showing and raising the session window moves focus to
    // it, which blurs the main window — a blur-hide handler therefore hid the
    // session the instant it appeared, every time. Hiding on unmount and route
    // change is enough, and those are the cases that actually matter.

    const poll = window.setInterval(() => {
      void sessionStatus().then((next) => {
        if (!cancelled) setStatus(next);
      });
    }, 3_000);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("scroll", track, true);
      window.removeEventListener("resize", track);
      window.clearInterval(poll);
      void hideSession();
    };
  }, []);

  if (!isDesktopShell()) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
            WhatsApp runs in the Bridge desktop app
          </p>
          <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
            A browser page cannot host a WhatsApp Web session. Contacts and
            Communities already captured on desktop stay readable here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* The session webview is pinned over this element. */}
      <div ref={anchor} className="h-full w-full" />
      {status && !status.live ? (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md px-3 py-1.5 text-xs"
          style={{ backgroundColor: "var(--color-surface)", color: "var(--color-navy-mid)" }}>
          {/* Three distinct states, never one indefinite spinner. */}
          {status.syncing
            ? `WhatsApp is downloading your messages (${status.chats} chats so far)`
            : status.socket === "CONNECTED"
              ? "Connected — waiting for your chats"
              : "Link this device by scanning the QR code"}
        </div>
      ) : null}
    </div>
  );
}
