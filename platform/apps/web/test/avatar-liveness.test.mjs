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
