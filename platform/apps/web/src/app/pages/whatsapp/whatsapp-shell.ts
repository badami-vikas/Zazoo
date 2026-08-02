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

/**
 * Read operations the shell's allowlist accepts.
 *
 * The single WRITE op is deliberately absent from this union and unreachable
 * from `runReadOp`: sending goes through `sendMessage` below, which the shell
 * routes past its durable Rust ceiling (ADR-158). Two entry points, because
 * they have genuinely different gates.
 */
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

// ── The write path ──────────────────────────────────────────────────────────
//
// Everything below crosses into the shell's SEND command, which is a different
// gate from the read allowlist. The renderer supplies a target id, a recipient
// key and a body. It cannot supply JavaScript, and it cannot supply a count:
// the daily cap, the per-recipient cooldown and the kill switch are all read
// from a durable ledger on the shell's side. Whatever `decideAutomatedSend`
// concluded here, the shell decides again — and the shell's answer is the one
// that binds (ADR-158).

/** The ceiling as the shell reports it, so the UI explains rather than guesses. */
export interface SendCeilingStatus {
  limits: {
    dailyCap: number;
    recipientCooldownDays: number;
    warmUpFirstDayCap: number;
    warmUpDailyIncrement: number;
  };
  killSwitch: {
    status: "armed" | "halted";
    haltedAtMs?: number | null;
    reason?: string | null;
    rearmedAtMs?: number | null;
    rearmedBy?: string | null;
  };
  sentLast24h: number;
  effectiveDailyCap: number;
  linkedAtMs: number;
}

/** A structured shell refusal: `{ code, message, earliestAtMs? }`. */
export interface ShellError {
  code: string;
  message: string;
  earliestAtMs?: number;
}

function asShellError(error: unknown): ShellError {
  if (typeof error === "object" && error !== null && "code" in error) {
    const shaped = error as ShellError;
    return {
      code: String(shaped.code),
      message: String(shaped.message ?? "The desktop shell refused the send."),
      ...(typeof shaped.earliestAtMs === "number" ? { earliestAtMs: shaped.earliestAtMs } : {}),
    };
  }
  return {
    code: "WHATSAPP_SEND_FAILED",
    message: error instanceof Error ? error.message : "The message could not be sent.",
  };
}

export type SendMessageResult =
  | { status: "sent"; messageId?: string }
  | { status: "refused"; code: string; reason: string; earliestAtMs?: number };

/**
 * Send one message. Start-then-poll like every other slow shell command: an
 * ack can stall behind a reconnect, and a command that answers after ~60s
 * aborts the whole app under WKWebView.
 *
 * Refusals come back as values, not exceptions. "The cap is full" is a normal
 * outcome of a governed send path, and a caller should not have to catch to
 * learn it.
 */
export async function sendMessage(
  targetId: string,
  recipientKey: string,
  body: string,
): Promise<SendMessageResult> {
  if (!isDesktopShell()) {
    return {
      status: "refused",
      code: "WHATSAPP_UNAVAILABLE",
      reason: "WhatsApp sending runs in the Bridge desktop app.",
    };
  }
  try {
    const envelope = await tauriInvokeJob<{ op: string; json: string }>(
      "whatsapp_send_start",
      "whatsapp_send_poll",
      { targetId, recipientKey, body },
      { valueKey: "value", timeoutMs: 120_000, intervalMs: 500 },
    );
    const parsed = JSON.parse(envelope.json) as OpResult<{ id?: string }>;
    if (!parsed.ok) {
      return {
        status: "refused",
        code: "WHATSAPP_SEND_FAILED",
        reason: parsed.error ?? "WhatsApp did not accept the message.",
      };
    }
    return parsed.value?.id ? { status: "sent", messageId: parsed.value.id } : { status: "sent" };
  } catch (error) {
    const shaped = asShellError(error);
    return {
      status: "refused",
      code: shaped.code,
      reason: shaped.message,
      ...(shaped.earliestAtMs !== undefined ? { earliestAtMs: shaped.earliestAtMs } : {}),
    };
  }
}

export async function sendCeilingStatus(): Promise<SendCeilingStatus | undefined> {
  if (!isDesktopShell()) return undefined;
  try {
    return (await tauriInvokeStrict("whatsapp_send_status", {})) as SendCeilingStatus;
  } catch {
    return undefined;
  }
}

/**
 * Halt automated sending. Any WhatsApp-side warning, unexpected disconnect or
 * delivery anomaly should call this, and nothing lifts it but `rearmSending`.
 */
export async function haltSending(reason: string): Promise<SendCeilingStatus | undefined> {
  if (!isDesktopShell()) return undefined;
  return (await tauriInvokeStrict("whatsapp_send_halt", { reason })) as SendCeilingStatus;
}

/**
 * Re-arm. Takes the NAME OF A HUMAN, and the shell refuses an empty one.
 * Never call this from an Agent, a retry loop, or a timer — the whole value of
 * the kill switch is that nothing but a person can clear it.
 */
export async function rearmSending(rearmedBy: string): Promise<SendCeilingStatus | undefined> {
  if (!isDesktopShell()) return undefined;
  return (await tauriInvokeStrict("whatsapp_send_rearm", { rearmedBy })) as SendCeilingStatus;
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
