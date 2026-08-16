/**
 * The companion rig has always been able to breathe, blink, follow the cursor
 * and flap its mouth — the director exposed every one of those channels from
 * Zazoo v1. What kept failing (reported three separate times through
 * 2026-08-12) is that the DESKTOP OVERLAY never switched them on: `setCursor`
 * and `setTalking` existed and were called only by the lab, and the resting
 * pose was `meditating`, whose eyes are shut and whose blink interval is 999
 * seconds. Nothing about that is visible to a type-check or to a director test
 * that drives the director directly.
 *
 * So these tests assert BOTH halves: the director really animates when driven,
 * and the overlay really drives it. The second half reads the overlay source,
 * which is unusual — but the defect class here is an absent call, and an absent
 * call is exactly what a behavioural test of the director cannot see.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ZazooDirector } from "../src/app/avatar/zazoo/director.ts";

const OVERLAY_SOURCE = readFileSync(
  new URL("../src/app/avatar/OverlayApp.tsx", import.meta.url),
  "utf8",
);
const COMPANION_ASK_SOURCE = readFileSync(
  new URL("../src/app/avatar/CompanionAsk.tsx", import.meta.url),
  "utf8",
);
const CHAT_VIEW_SOURCE = readFileSync(
  new URL("../src/app/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const ASK_HISTORY_SOURCE = readFileSync(
  new URL("../src/app/chat/ask-history.ts", import.meta.url),
  "utf8",
);
const SESSION_HISTORY_SOURCE = readFileSync(
  new URL("../src/app/chat/SessionHistoryView.tsx", import.meta.url),
  "utf8",
);
const SETTINGS_SOURCE = readFileSync(
  new URL("../src/app/pages/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const SENSOR_BRIDGE_SOURCE = readFileSync(
  new URL("../../desktop/src-tauri/src/sensor_bridge.rs", import.meta.url),
  "utf8",
);
const DESKTOP_LIB_SOURCE = readFileSync(
  new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);

/** Drives a director on one continuous ~60fps clock: `advance(seconds)` returns
 * every frame it produced, and time never rewinds between calls (a director
 * that saw dt go negative would spring in ways nothing on screen ever does). */
function stepper(director) {
  let t = 0;
  const step = 1 / 60;
  return (seconds) => {
    const frames = [];
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      t += step;
      frames.push(director.tick(t));
    }
    return frames;
  };
}

test("an idle companion breathes", () => {
  const director = new ZazooDirector();
  director.perform({ emotion: "calm", action: "idle", energy: 0.2 });
  const breath = stepper(director)(12).map((f) => f.breath);
  const span = Math.max(...breath) - Math.min(...breath);
  assert.ok(span > 0.5, `breath barely moved (span ${span.toFixed(3)})`);
});

test("an idle companion blinks", () => {
  const director = new ZazooDirector();
  director.perform({ emotion: "calm", action: "idle", energy: 0.2 });
  const frames = stepper(director)(30);
  assert.ok(
    frames.some((f) => f.blink > 0.5),
    "no blink in 30s of idle — check the resting action is not `meditating`",
  );
  // A blink is only a blink if the eye actually shuts.
  assert.ok(Math.min(...frames.map((f) => f.eyeOpen)) < 0.35, "the eye never closed");
});

test("talking opens the mouth and stopping closes it", () => {
  const director = new ZazooDirector();
  director.perform({ emotion: "calm", action: "idle" });
  const advance = stepper(director);
  const quiet = advance(2).map((f) => f.mouthOpen);
  director.setTalking(true);
  const talking = advance(3).map((f) => f.mouthOpen);
  director.setTalking(false);
  const after = advance(3).map((f) => f.mouthOpen);

  assert.ok(
    Math.max(...talking) > Math.max(...quiet) + 0.1,
    "setTalking did not open the mouth",
  );
  assert.ok(Math.max(...talking) - Math.min(...talking) > 0.1, "the mouth did not flap");
  assert.ok(after.at(-1) <= Math.max(...quiet) + 0.05, "the mouth stayed open after speech");
});

test("the eyes follow the cursor", () => {
  const director = new ZazooDirector();
  director.perform({ emotion: "calm", action: "idle", attention: "cursor" });
  const advance = stepper(director);
  director.setCursor({ x: 1, y: 1 });
  const right = advance(2).at(-1);
  director.setCursor({ x: -1, y: -1 });
  // Sampled mid-turn on purpose: the eyes lead and the head follows, so the
  // lag is only observable before the head has finished catching up.
  const turning = advance(0.1).at(-1);
  const left = advance(2).at(-1);

  assert.ok(right.gazeX > left.gazeX + 0.5, "gazeX did not track the cursor");
  assert.ok(right.gazeY > left.gazeY + 0.5, "gazeY did not track the cursor");
  assert.ok(left.headGazeX < right.headGazeX, "the head did not follow the eyes");
  assert.ok(
    Math.abs(turning.headGazeX) < Math.abs(turning.gazeX),
    "the head kept up with the eyes instead of lagging behind them",
  );
});

test("the desktop overlay actually drives the live channels", () => {
  // Each of these was, at some point, a channel the rig supported and the
  // overlay never called — which is precisely why they are asserted on the
  // source rather than on behaviour.
  for (const call of ["director.setCursor(", "director.setTalking("]) {
    assert.ok(OVERLAY_SOURCE.includes(call), `OverlayApp never calls ${call}`);
  }
  assert.ok(
    OVERLAY_SOURCE.includes("bridge:cursor") || OVERLAY_SOURCE.includes("CURSOR_EVENT"),
    "OverlayApp does not subscribe to the Rust cursor stream",
  );
});

test("the overlay's resting pose is not the eyes-shut meditation", () => {
  // `meditating` sets eyeOpen 0 and blinkEvery 999: a companion parked in it
  // cannot blink, which is how "the avatar is frozen" kept coming back.
  const resting = OVERLAY_SOURCE.slice(
    OVERLAY_SOURCE.indexOf("Free-floating Zazoo"),
    OVERLAY_SOURCE.indexOf("function beginAvatarPointerGesture"),
  );
  assert.ok(resting.length > 0, "could not locate the resting-pose effect");
  assert.ok(!resting.includes("meditating"), "the resting pose is meditating again");
  assert.ok(resting.includes('attention: "cursor"'), "the resting pose ignores the cursor");
});

test("Observe routes through the screen-aware ask instead of discarding a screenshot", () => {
  const observe = OVERLAY_SOURCE.slice(
    OVERLAY_SOURCE.indexOf("function handleObserve"),
    OVERLAY_SOURCE.indexOf("const name ="),
  );
  assert.ok(observe.length > 0, "could not locate the Observe handler");
  assert.ok(observe.includes('setPanel("ask")'), "Observe does not open the analysis panel");
  assert.ok(observe.includes("setAskSeed("), "Observe does not seed a screen-aware question");
  assert.ok(observe.includes("OBSERVE_QUESTION"), "Observe lost its screen-analysis question");
  assert.ok(
    !observe.includes("capture_screenshot_on_demand"),
    "Observe still takes and discards a screenshot instead of analyzing it",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("void ask(autoQuestion.text)"),
    "CompanionAsk does not submit Observe to the analysis job",
  );
  assert.ok(
    !SENSOR_BRIDGE_SOURCE.includes("pub fn capture_screenshot_on_demand"),
    "raw screenshot bytes remain exposed through an unused IPC command",
  );
  assert.ok(
    !DESKTOP_LIB_SOURCE.includes("sensor_bridge::capture_screenshot_on_demand"),
    "the raw screenshot IPC command remains registered",
  );
});

test("the companion visibly exposes screen sharing and Research", () => {
  assert.ok(
    COMPANION_ASK_SOURCE.includes('id="companion-share-screen"'),
    "screen sharing is hidden outside the companion panel",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("setShareScreen(enabled)"),
    "the visible screen-sharing control does not update the ask path",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("localStorage.setItem(AVATAR_SHARE_SCREEN_KEY"),
    "the visible screen-sharing choice does not persist to Settings",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes(
      'localStorage.getItem(AVATAR_SHARE_SCREEN_KEY) === "true"',
    ),
    "an absent screen-sharing preference no longer fails closed",
  );
  assert.ok(
    SETTINGS_SOURCE.includes("useState(readAvatarShareScreenPreference)"),
    "Settings and Companion do not share one fail-closed screen preference reader",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("onClick={() => setResearchMode(true)}"),
    "Research remains reachable only through a hidden typed phrase",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("aria-pressed={researchMode}"),
    "the visible Research mode does not expose its selected state",
  );
});

test("past companion sessions are readable from the Chat history dropdown", () => {
  // User directive 2026-08-16: "I just want their session to be visible under
  // 'Chat' in the chat with date section dropdown. just for history of prompts
  // and results. It can be readonly."
  assert.ok(
    CHAT_VIEW_SOURCE.includes('<optgroup label="Research">'),
    "the Chat history dropdown does not group past Research sessions",
  );
  assert.ok(
    CHAT_VIEW_SOURCE.includes("agentOrchestration.research.list"),
    "the dropdown invents session history instead of reading the kernel records",
  );
  assert.ok(
    CHAT_VIEW_SOURCE.includes("{openRun && <ResearchSessionView") &&
      CHAT_VIEW_SOURCE.includes("{openAsk && <AskSessionView"),
    "a selected session does not render its transcript",
  );
  assert.ok(
    CHAT_VIEW_SOURCE.includes('<optgroup label="Ask">'),
    "the Chat history dropdown does not group past Ask sessions",
  );
  // Ask history is Local Plane: recorded by the panel that received the answer,
  // into this device's storage, never through the API.
  assert.ok(
    COMPANION_ASK_SOURCE.includes("appendAskTurn("),
    "answered asks are not recorded, so their history cannot exist",
  );
  assert.ok(
    !ASK_HISTORY_SOURCE.includes("trpc.") && ASK_HISTORY_SOURCE.includes("window.localStorage"),
    "ask history left the Local Plane",
  );
  // Read-only means read-only: no composer, and none of the thread actions
  // that would act on whichever Chat thread happened to be selected.
  assert.ok(
    CHAT_VIEW_SOURCE.includes("{!openHistory && (") &&
      CHAT_VIEW_SOURCE.includes("{!openHistory && localThread &&"),
    "the live composer still renders over a read-only session transcript",
  );
  assert.ok(
    /\{!openHistory && \(\s*<>\s*<Button[^]{0,120}aria-label="Archive chat"/.test(CHAT_VIEW_SOURCE),
    "Archive/Delete remain live while a read-only session is open",
  );
  assert.ok(
    !SESSION_HISTORY_SOURCE.includes("<textarea") && !SESSION_HISTORY_SOURCE.includes("mutate("),
    "the session transcript is not read-only",
  );
});

test("spoken companion answers remain visible in the panel", () => {
  assert.ok(
    COMPANION_ASK_SOURCE.includes('aria-label={`${name} response`}'),
    "the spoken answer has no visible, named response surface",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes('role="status"'),
    "the spoken answer is not announced as a live status",
  );
  assert.ok(
    COMPANION_ASK_SOURCE.includes("responseRef.current?.scrollIntoView"),
    "the answer can render below the newly visible controls without being brought into view",
  );
});
