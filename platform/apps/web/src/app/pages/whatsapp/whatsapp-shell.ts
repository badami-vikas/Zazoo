/**
 * Typed wrappers over the desktop shell's WhatsApp commands — the TRANSPORT
 * layer only.
 *
 * Surfaces do not import this module. They consume `WhatsAppEngine` from
 * `./engine`, which is the single adapter over everything here (ADR-158). The
 * split is deliberate: this file knows how to reach the shell, the engine
 * defines what the app is allowed to ask it for.
 *
 * Every function feature-detects the shell and returns an `unavailable` result
 * in a plain browser rather than throwing: the session cannot exist there at
 * all — `web.whatsapp.com` refuses framing and no page may inject into another
 * origin — so the web and mobile clients must degrade to an honest state, never
 * a broken one.
 */
import { tauriInvoke, tauriInvokeJob, tauriInvokeStrict } from "../../avatar/tauri-internals";

/** Read operations the shell's allowlist accepts. v1 has no write op. */
export type WhatsAppReadOp =
  | "list_contacts"
  | "list_groups"
  | "group_participants"
  | "list_direct_chats"
  | "pn_lid_map";

export interface SessionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WhatsAppStatus {
  open: boolean;
  live: boolean;
  socket: string;
  chats: number;
  syncing: boolean;
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && window.__BRIDGE_DESKTOP__ === true;
}

/**
 * The element's rect RELATIVE TO THE WEBVIEW VIEWPORT. The shell resolves it
 * against the real window origin and scale factor.
 *
 * Deliberately does NOT add `window.screenX/screenY`: inside a Retina WKWebView
 * those did not share units with `getBoundingClientRect()`, which placed the
 * session window at y=1016 on an 800-point display — off-screen and invisible,
 * with no error anywhere.
 */
export function rectOf(element: HTMLElement): SessionRect {
  const box = element.getBoundingClientRect();
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

export async function openSession(rect: SessionRect): Promise<void> {
  if (!isDesktopShell()) return;
  await tauriInvoke("whatsapp_open", { rect });
}

export async function positionSession(rect: SessionRect): Promise<void> {
  if (!isDesktopShell()) return;
  await tauriInvoke("whatsapp_position", { rect });
}

export async function hideSession(): Promise<void> {
  if (!isDesktopShell()) return;
  await tauriInvoke("whatsapp_hide", {});
}

export async function sessionStatus(): Promise<WhatsAppStatus> {
  if (!isDesktopShell()) {
    return { open: false, live: false, socket: "UNAVAILABLE", chats: 0, syncing: false };
  }
  try {
    return (await tauriInvokeStrict("whatsapp_status", {})) as WhatsAppStatus;
  } catch {
    // A status probe that fails is "not live", not a crash — the Page still has
    // an honest state to render.
    return { open: false, live: false, socket: "UNKNOWN", chats: 0, syncing: false };
  }
}

export interface OpResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * Run one read operation. Start-then-poll, because a contact read on a large
 * account runs for minutes and a command that answers after ~60s aborts the
 * whole app under WKWebView.
 */
export async function runReadOp<T>(op: WhatsAppReadOp, arg?: string): Promise<T> {
  if (!isDesktopShell()) {
    throw new Error("WhatsApp runs in the Bridge desktop app.");
  }
  const envelope = await tauriInvokeJob<{ op: string; json: string }>(
    "whatsapp_extract_start",
    "whatsapp_extract_poll",
    arg === undefined ? { op } : { op, arg },
    { valueKey: "value", timeoutMs: 300_000, intervalMs: 1_200 },
  );
  const parsed = JSON.parse(envelope.json) as OpResult<T>;
  if (!parsed.ok) {
    throw new Error(parsed.error ?? "The WhatsApp operation failed.");
  }
  return parsed.value as T;
}

// Payload shapes returned by the allowlisted ops. These mirror
// `@bridge/whatsapp`'s types without importing them into the browser bundle.

export interface RawContact {
  id: string;
  name?: string;
  pushname?: string;
  phone?: string;
  isMyContact: boolean;
  isGroup: boolean;
}

export interface RawGroup {
  id: string;
  name: string;
  participantCount: number | null;
}

export interface PnLidPair {
  pn: string;
  lid: string;
}
