/**
 * Table multi-select — the DECISIONS, separated from the DOM.
 *
 * C-12 (rulebook Part II, resolved 2026-08-30 / ADR-261): on touch, long-pressing
 * a row enters multi-select; while it is active a tap TOGGLES the row rather than
 * opening it; and the synthetic click the browser fires on finger-lift is
 * swallowed — otherwise the same gesture that selects a row also opens it.
 *
 * WHY A REDUCER AND NOT JUST `useState` IN TableView. The swallow is the part
 * that bites, and it is pure logic about event ORDER, not about the DOM. Web's
 * test suite has no jsdom and no react-dom (see dataviews-behavior.test.mjs),
 * so a decision living inside a JSX handler is a decision nothing can fail on.
 * Here the sequence a finger produces — longPress, then activate — is drivable
 * in a plain test, and TableView is left with nothing but dispatch.
 */

/** Selected row keys, plus whether the next click is the finger-lift artefact. */
export interface SelectionState {
  readonly selected: readonly string[];
  readonly swallowClick: boolean;
}

export const EMPTY_SELECTION: SelectionState = { selected: [], swallowClick: false };

/**
 * How long a finger must rest before the press counts as a hold.
 *
 * 500ms is the platform convention (iOS/Android context menus both sit here). A
 * shorter threshold turns a slow tap into a selection; a longer one reads as
 * unresponsive.
 */
export const LONG_PRESS_MS = 500;

/** A finger drifts while resting. Past this the gesture is a scroll, not a hold. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export type SelectionEvent =
  /** The hold timer fired while the finger was still down. */
  | { type: "longPress"; key: string }
  /** A click/tap landed on a row's cells. */
  | { type: "activate"; key: string }
  /** The row's checkbox was used — the pointer entry point. */
  | { type: "checkbox"; key: string }
  /** Escape, or the action bar's Cancel. */
  | { type: "clear" };

export interface SelectionOutcome {
  state: SelectionState;
  /** True when the caller should open the Record (C-10's whole-row target). */
  open: boolean;
}

function toggle(selected: readonly string[], key: string): string[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

export function reduceSelection(state: SelectionState, event: SelectionEvent): SelectionOutcome {
  switch (event.type) {
    case "longPress":
      // `swallowClick` is armed here and nowhere else: the hold fires while the
      // finger is still down, so exactly one click — the one the browser
      // synthesises on lift — has to be discarded. Left unarmed, the observed
      // failure is not "the row also opens" but something worse: the lift
      // toggles the row straight back off, selection empties, and the NEXT tap
      // opens a record instead of selecting it.
      return {
        state: { selected: toggle(state.selected, event.key), swallowClick: true },
        open: false,
      };
    case "checkbox":
      return {
        state: { selected: toggle(state.selected, event.key), swallowClick: false },
        open: false,
      };
    case "activate": {
      // Consumed once, never sticky: a permanently-armed swallow makes the
      // table inert to every subsequent tap.
      if (state.swallowClick) return { state: { ...state, swallowClick: false }, open: false };
      if (state.selected.length === 0) return { state, open: true };
      return {
        state: { selected: toggle(state.selected, event.key), swallowClick: false },
        open: false,
      };
    }
    case "clear":
      return { state: EMPTY_SELECTION, open: false };
  }
}

/** True when the table is in multi-select — the checkbox column and the action
 *  bar are driven off this, never off a separate "mode" flag that can disagree. */
export function isSelecting(state: SelectionState): boolean {
  return state.selected.length > 0;
}
