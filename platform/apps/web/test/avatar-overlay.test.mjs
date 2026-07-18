import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlayApp = readFileSync(new URL("../src/app/avatar/OverlayApp.tsx", import.meta.url), "utf8");
const nativeOverlay = readFileSync(
  new URL("../../desktop/src-tauri/src/overlay.rs", import.meta.url),
  "utf8",
);
const desktopLib = readFileSync(new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url), "utf8");

test("the Avatar surface starts native dragging without consuming ordinary clicks", () => {
  assert.match(overlayApp, /onPointerDown=\{beginAvatarPointerGesture\}/);
  assert.match(overlayApp, /onPointerMove=\{continueAvatarPointerGesture\}/);
  assert.match(overlayApp, /Math\.hypot/);
  assert.match(overlayApp, /tauriInvoke\("overlay_start_dragging"\)/);
  assert.match(overlayApp, /onClick=\{activateAvatar\}/);
  assert.match(overlayApp, /suppressAvatarClick/);
});

test("the native Avatar drag command is implemented and registered", () => {
  assert.match(nativeOverlay, /pub fn overlay_start_dragging/);
  assert.match(nativeOverlay, /window\.start_dragging\(\)/);
  assert.match(desktopLib, /overlay::overlay_start_dragging/);
});
