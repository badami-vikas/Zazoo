/**
 * Avatar preferences + overlay status — the small persistence + state layer
 * behind AvatarOverlay.tsx (docs/raw/spec-consolidation-2026-07.md sections 3
 * + 4: "Avatar Day-1" + "Onboarding Egg").
 *
 * Two separate concerns kept in one small file since both are tiny:
 *  - `AvatarPrefs`: durable, per-browser choice (spirit animal, hatch state,
 *    optional name) — localStorage, NOT workspace state. This is a client-side
 *    preference, not kernel data; nothing here is proposed/governed (CLAUDE.md's
 *    "everything is proposed and governed" applies to WORKSPACE state, not local
 *    UI chrome prefs, same category as lib/pins.ts's client-side pinning).
 *  - `avatarStatus`: an in-memory pub/sub the overlay renders from. Exported
 *    `setAvatarStatus` so future kernel events (tRPC subscriptions, Tauri
 *    `sensor.capture`, ritual/agent run events) can drive the same state
 *    machine without the overlay needing to know who's driving it.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "bridge.avatar.v1";

export type SpiritAnimal = "owl" | "fox" | "turtle" | "crane" | "wolf" | "cat";

export const SPIRIT_ANIMALS: { value: SpiritAnimal; label: string }[] = [
  { value: "owl", label: "Owl" },
  { value: "fox", label: "Fox" },
  { value: "turtle", label: "Turtle" },
  { value: "crane", label: "Crane" },
  { value: "wolf", label: "Wolf" },
  { value: "cat", label: "Cat" },
];

export interface AvatarPrefs {
  animal: SpiritAnimal;
  eggHatched: boolean;
  avatarName?: string;
}

const DEFAULT_PREFS: AvatarPrefs = {
  animal: "owl",
  eggHatched: false,
};

/** Existing users (a workspace already exists, but no avatar prefs were ever
 * saved — nothing wrote `bridge.avatar.v1` before this feature shipped) get a
 * neutral hatched owl, never a forced re-onboarding (spec section 4, item 4 of
 * the build brief). */
const EXISTING_USER_DEFAULT: AvatarPrefs = {
  animal: "owl",
  eggHatched: true,
};

function readPrefs(): AvatarPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AvatarPrefs>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      animal: (parsed.animal as SpiritAnimal) ?? DEFAULT_PREFS.animal,
      eggHatched: Boolean(parsed.eggHatched),
      ...(parsed.avatarName ? { avatarName: parsed.avatarName } : {}),
    };
  } catch {
    return null;
  }
}

function writePrefs(prefs: AvatarPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Honest no-op: localStorage can throw (private mode, quota) — avatar
    // prefs are a cosmetic convenience, never worth surfacing an error for.
  }
}

/** True the FIRST time this browser has ever been asked — used to distinguish
 * "brand-new user, egg still incubating" from "existing user, no prefs saved
 * yet" (spec section 4 item 4). Onboarding itself is what flips this by
 * calling `savePrefs` once the egg hatches; existing users who never go
 * through onboarding again should not see an egg. */
export function hasStoredPrefs(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

/** Read current prefs, applying the existing-user fallback described above.
 * `hasExistingWorkspace` lets the caller (Layout) distinguish "this browser
 * has an active workspace already" (existing user) from "brand new, egg not
 * hatched yet" (new user, onboarding owns the reveal). */
export function loadAvatarPrefs(hasExistingWorkspace: boolean): AvatarPrefs {
  const stored = readPrefs();
  if (stored) return stored;
  return hasExistingWorkspace ? EXISTING_USER_DEFAULT : DEFAULT_PREFS;
}

export function saveAvatarPrefs(prefs: AvatarPrefs): void {
  writePrefs(prefs);
}

export function updateAvatarPrefs(patch: Partial<AvatarPrefs>): AvatarPrefs {
  const current = readPrefs() ?? DEFAULT_PREFS;
  const next = { ...current, ...patch };
  writePrefs(next);
  return next;
}

// ---------------------------------------------------------------------------
// Overlay operational status — tiny event-driven store (spec section 3).
// Not Redux/Zustand (no new dep needed for one value); a module-level
// subscriber list is enough and matches the "no new heavy deps" constraint.
// ---------------------------------------------------------------------------

export type AvatarStatus =
  | "idle"
  | "listening"
  | "reading_context"
  | "drafting"
  | "awaiting_approval"
  | "blocked_by_policy"
  | "error";

export const STATUS_LABEL: Record<AvatarStatus, string> = {
  idle: "Idle — meditating",
  listening: "Listening",
  reading_context: "Reading context",
  drafting: "Drafting",
  awaiting_approval: "Awaiting your approval",
  blocked_by_policy: "Blocked by policy",
  error: "Error",
};

let currentStatus: AvatarStatus = "idle";
const listeners = new Set<(status: AvatarStatus) => void>();

/** Exported setter — future kernel events (tRPC subscriptions, Tauri
 * `sensor.capture`, ritual/agent run completion) call this directly. No
 * polling: purely event-driven per the spec's technical contract. */
export function setAvatarStatus(status: AvatarStatus): void {
  currentStatus = status;
  listeners.forEach((fn) => fn(status));
}

export function getAvatarStatus(): AvatarStatus {
  return currentStatus;
}

/** Hook form for components. */
export function useAvatarStatus(): AvatarStatus {
  const [status, setStatus] = useState<AvatarStatus>(currentStatus);
  useEffect(() => {
    listeners.add(setStatus);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}

// ---------------------------------------------------------------------------
// Capture tell — window CustomEvent contract (spec section 3, "The Blink Tell").
// ---------------------------------------------------------------------------

export const CAPTURE_EVENT = "bridge:capture";

/** Dispatch a capture event — helper for callers (Tauri bridge, dev console,
 * future sensor hooks) rather than every caller re-typing `new CustomEvent`. */
export function dispatchCaptureEvent(detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail }));
}
