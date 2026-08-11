/**
 * status → Zazoo performance mapping (desktop companion overlay).
 *
 * The Zazoo rig is a RENDERING of the existing operational `AvatarStatus` —
 * never a new taxonomy. Canon (docs/wiki/avatar-commons.md): Avatar style is
 * visual-only, there is no lifecycle/personality model, and nothing here may
 * be persisted or alter behavior/authority. Every value below is a pure
 * derived function of status the store already tracks, so deleting this file
 * changes pixels and nothing else.
 *
 * One-shots (capture blink, answer delivered) use the director's `duration`
 * auto-revert so the base status pose always reasserts itself — the rig can
 * never get stuck in a transient expression.
 */
import type { AvatarStatus } from "../avatar-store";
import type { ZazooPerformance } from "./director";

export function statusToPerformance(status: AvatarStatus): ZazooPerformance {
  switch (status) {
    case "listening":
      // Ears up, eyes on the user — the PTT / transcription pose.
      return { emotion: "listening", energy: 0.55, confidence: 0.7, attention: "user" };
    case "reading_context":
      // Looking AT the screen it was invited to read (consented capture,
      // Observe, or a research step) — attention deliberately away.
      return { emotion: "curious", energy: 0.6, attention: "away" };
    case "drafting":
      return { emotion: "thinking", energy: 0.4, confidence: 0.6 };
    case "awaiting_approval":
      // Declared in AvatarStatus; nothing sets it yet (honest gap recorded in
      // OverlayApp). Mapped now so the rig is ready the day it fires.
      return { emotion: "unsure", warmth: 0.95, confidence: 0.45, energy: 0.3, attention: "user" };
    case "blocked_by_policy":
      return { emotion: "concerned", warmth: 0.6, confidence: 0.5, energy: 0.25 };
    case "error":
      return { emotion: "concerned", confidence: 0.4, energy: 0.3, attention: "user" };
    case "idle":
    default:
      return {
        emotion: "calm",
        action: "idle",
        warmth: 0.7,
        confidence: 0.7,
        energy: 0.35,
        attention: "cursor",
      };
  }
}

/** One-shot on every capture Event — the blink tell, made expressive. The
 * director's own blink plus a brief curious lift; auto-reverts to the status
 * pose so the tell stays a tell, never a state. */
export const CAPTURE_PERFORMANCE: ZazooPerformance = {
  emotion: "curious",
  energy: 0.6,
  duration: 0.9,
};

/** One-shot when an answer lands successfully. */
export const ANSWERED_PERFORMANCE: ZazooPerformance = {
  emotion: "happy",
  warmth: 0.9,
  energy: 0.6,
  duration: 2.5,
};

/** Fired on ⌘⇧Space press, ahead of the store's status flip, so the ears perk
 * on the keypress rather than on mic-open. */
export const PTT_PRESSED_PERFORMANCE: ZazooPerformance = {
  emotion: "listening",
  attention: "user",
  energy: 0.6,
};

/** One-shot when the user pets the avatar (a plain click on the collapsed
 * face) — the one emotion in the rig's vocabulary with no other trigger. */
export const PET_PERFORMANCE: ZazooPerformance = {
  emotion: "celebrating",
  warmth: 1,
  energy: 0.7,
  attention: "user",
  duration: 1.4,
};

/** "Meditate" from the right-click menu — sets both the felt state and the
 * whole-body action, so it visibly differs from plain idle. */
export const MEDITATE_PERFORMANCE: ZazooPerformance = {
  emotion: "sleepy",
  action: "meditating",
  energy: 0.15,
  warmth: 0.8,
};

/** Chase game (chat trigger "let's play a game", `chase.rs`) is live: the
 * rig's existing `sneaking` action — already built for exactly this, eyes
 * darting, ears up — reused rather than inventing a new one. Persists for
 * the whole flight; there is no `duration` because it only ends on capture. */
export const CHASE_FLEEING_PERFORMANCE: ZazooPerformance = {
  emotion: "curious",
  action: "sneaking",
  attention: "user",
  energy: 0.85,
};

/** One-shot when the real cursor catches the fleeing companion. */
export const CHASE_CAUGHT_PERFORMANCE: ZazooPerformance = {
  emotion: "concerned",
  action: "idle",
  energy: 0.5,
  duration: 1.6,
};
