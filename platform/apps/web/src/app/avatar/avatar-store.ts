/** Avatar visual preferences plus the operational-status store. */
import { useEffect, useState } from "react";
import {
  LEGACY_AVATAR_STORAGE_KEY,
  readLegacyAvatarPreferences,
} from "./avatar-v1-compat";

const STORAGE_KEY = "bridge.avatar.v2";

export type AvatarStyle =
  | "owl"
  | "fox"
  | "turtle"
  | "crane"
  | "wolf"
  | "cat"
  | "lion"
  | "dog"
  | "panda"
  | "butterfly"
  | "dolphin"
  | "peacock"
  | "elephant"
  | "eagle"
  | "horse"
  | "beaver";

export const AVATAR_STYLES: { value: AvatarStyle; label: string }[] = [
  { value: "lion", label: "Lion" },
  { value: "fox", label: "Fox" },
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "panda", label: "Panda" },
  { value: "butterfly", label: "Butterfly" },
  { value: "dolphin", label: "Dolphin" },
  { value: "owl", label: "Owl" },
  { value: "turtle", label: "Turtle" },
  { value: "crane", label: "Crane" },
  { value: "wolf", label: "Wolf" },
  { value: "peacock", label: "Peacock" },
  { value: "elephant", label: "Elephant" },
  { value: "eagle", label: "Eagle" },
  { value: "horse", label: "Horse" },
  { value: "beaver", label: "Beaver" },
];

export interface AvatarPrefs {
  style: AvatarStyle;
  avatarReady: boolean;
  avatarName?: string;
}

const DEFAULT_PREFS: AvatarPrefs = {
  style: "owl",
  avatarReady: false,
};

/** Existing users never get forced back through Onboarding. */
const EXISTING_USER_DEFAULT: AvatarPrefs = {
  style: "owl",
  avatarReady: true,
};

function isAvatarStyle(value: unknown): value is AvatarStyle {
  return typeof value === "string" && AVATAR_STYLES.some((option) => option.value === value);
}

function parsePrefs(raw: string): AvatarPrefs | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !isAvatarStyle(parsed.style) ||
      typeof parsed.avatarReady !== "boolean"
    ) return null;
    return {
      style: parsed.style,
      avatarReady: parsed.avatarReady,
      ...(typeof parsed.avatarName === "string" && parsed.avatarName
        ? { avatarName: parsed.avatarName }
        : {}),
    };
  } catch {
    return null;
  }
}

function readPrefs(): AvatarPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = parsePrefs(current);
      if (parsed) return parsed;
    }

    const legacy = readLegacyAvatarPreferences(window.localStorage);
    if (!legacy || !isAvatarStyle(legacy.style)) return null;
    const migrated: AvatarPrefs = {
      style: legacy.style,
      avatarReady: legacy.avatarReady,
      ...(legacy.avatarName ? { avatarName: legacy.avatarName } : {}),
    };
    if (writePrefs(migrated)) window.localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY);
    return migrated;
  } catch {
    return null;
  }
}

function writePrefs(prefs: AvatarPrefs): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    // Honest no-op: localStorage can throw (private mode, quota) — avatar
    // prefs are a cosmetic convenience, never worth surfacing an error for.
    return false;
  }
}

export function hasStoredPrefs(): boolean {
  return readPrefs() !== null;
}

export function loadAvatarPrefs(hasExistingOrganization: boolean): AvatarPrefs {
  const stored = readPrefs();
  if (stored) return stored;
  return hasExistingOrganization ? EXISTING_USER_DEFAULT : DEFAULT_PREFS;
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
 * `sensor.capture`, Automation/Agent Run completion) call this directly. No
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
