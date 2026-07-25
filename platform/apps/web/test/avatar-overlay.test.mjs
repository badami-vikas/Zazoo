import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlayApp = readFileSync(new URL("../src/app/avatar/OverlayApp.tsx", import.meta.url), "utf8");
const avatarOverlay = readFileSync(new URL("../src/app/avatar/AvatarOverlay.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
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

test("browser and desktop Avatar surfaces render the selected visual style", () => {
  assert.match(avatarOverlay, /<AvatarFigure avatarStyle=\{style\}/);
  assert.match(avatarOverlay, /<AvatarFigure avatarStyle=\{avatarStyle\}/);
  assert.doesNotMatch(avatarOverlay, /style: _style/);
  assert.match(overlayApp, /avatarStyle=\{prefs\.style\}/);
  assert.match(overlayApp, /loadAvatarPrefs\(false\)/);
  assert.match(overlayApp, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(overlayApp, /event\.key === null \|\| event\.key === "bridge\.avatar\.v2"/);
  assert.match(overlayApp, /setPrefs\(loadAvatarPrefs\(false\)\)/);
  assert.match(overlayApp, /AVATAR_SESSION_READY_EVENT/);
  assert.match(overlayApp, /overlay_get_session_ready/);
  assert.match(overlayApp, /"overlay_present" : "overlay_conceal"/);
  assert.match(overlayApp, /if \(!sessionReady \|\| !prefs\.avatarReady\) return null/);
  assert.match(layout, /const hasOrganization = Boolean\(res\.definition\)/);
  assert.match(layout, /setOrganizationConfirmed\(hasOrganization\)/);
  assert.match(layout, /loadAvatarPrefs\(hasOrganization\)/);
  assert.match(layout, /storedPrefs = hasStoredPrefs\(\) \? loadAvatarPrefs\(true\) : null/);
  assert.doesNotMatch(layout, /if \(!hasStoredPrefs\(\)\)/);
  assert.match(layout, /trpc\.onboarding\.getProfile\.query/);
  assert.match(layout, /isAvatarStyle\(profile\.avatarStyle\)/);
  assert.match(layout, /if \(persistResolvedPrefs\) saveAvatarPrefs\(resolvedPrefs\)/);
  assert.match(layout, /overlay_set_session_ready/);
  assert.match(layout, /organizationConfirmed === true &&/);
  assert.match(nativeOverlay, /\.visible\(false\)/);
  assert.match(nativeOverlay, /set_ignore_cursor_events\(true\)/);
  assert.match(nativeOverlay, /pub fn overlay_set_session_ready/);
  assert.match(nativeOverlay, /assert_readiness_controller\(caller\.label\(\)\)/);
  assert.match(nativeOverlay, /pub fn overlay_present/);
  assert.match(desktopLib, /overlay::overlay_set_session_ready/);
  assert.match(desktopLib, /overlay::overlay_present/);
});
