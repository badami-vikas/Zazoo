/**
 * notch-home.test.mjs — the pure geometry and drop physics behind Zazoo's
 * notch home (roadmap Z1).
 *
 * These are the parts that decide WHERE the companion ends up. A sign error or
 * a bad clamp here puts him off-screen, which is exactly the class of bug that
 * has already cost this project a debugging session (the stale
 * `overlay_positions.json` anchor), so it is pinned rather than eyeballed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));

async function loadNotchHome() {
  const source = readFileSync(
    resolve(here, "../src/app/avatar/notch-home.ts"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
  return import(url);
}

/** The live probe on this MacBook Air (Mac14,2): notch AND the Dock (93pt,
 * bottom-oriented) + menu bar (33pt), both measured via `NSScreen`. */
const GEOMETRY = {
  hasNotch: true,
  x: 646,
  y: 0,
  width: 179,
  height: 32,
  screenWidth: 1470,
  screenHeight: 956,
  scaleFactor: 2,
  visibleLeft: 0,
  visibleTop: 33,
  visibleRight: 1470,
  visibleBottom: 863,
};

test("the drop column spans the full display height", async () => {
  const { dropColumnBox } = await loadNotchHome();
  const box = dropColumnBox(GEOMETRY);
  assert.equal(box.height, 956, "the fall must be animatable inside one window");
});

test("the landed window rests at the bottom-RIGHT, clear of the Dock", async () => {
  const { landedWindowRect } = await loadNotchHome();
  const rect = landedWindowRect(GEOMETRY);
  assert.ok(rect.x >= GEOMETRY.visibleLeft, "left edge clear of the Dock/menu-bar area");
  assert.ok(rect.x + rect.width <= GEOMETRY.visibleRight, "right edge on screen");
  assert.ok(
    rect.y + rect.height <= GEOMETRY.visibleBottom,
    "bottom edge sits above the Dock — landing INSIDE the Dock's 93pt strip is the exact " +
      "bug being fixed: on-screen by raw coordinates, but visually swallowed by the Dock",
  );
  // User directive (with reference screenshot): the rest position is the
  // bottom-right corner, past the Dock's right end — NOT under the notch.
  assert.ok(
    rect.x + rect.width >= GEOMETRY.visibleRight - 40,
    "he should rest at the right edge of the visible area",
  );
});

test("the bounce is zero before impact, hops after it, and dies out", async () => {
  const { bounceOffsetY, squashSettled } = await loadNotchHome();
  assert.equal(bounceOffsetY(0), 0);
  assert.equal(bounceOffsetY(0.99), 0, "no bounce while still falling");
  assert.ok(bounceOffsetY(1.15) > 8, "a visible hop right after impact");
  assert.ok(
    bounceOffsetY(2.2) < 2 && squashSettled(2.2),
    "converged by the time the squash has settled — the rAF must be able to stop",
  );
});

test("the glide starts only after impact and ends at the landing centre", async () => {
  const { glideCenterX, landedWindowRect } = await loadNotchHome();
  const fallCentre = GEOMETRY.x + GEOMETRY.width / 2;
  assert.equal(glideCenterX(0.5, GEOMETRY), fallCentre, "vertical fall — no drift");
  assert.equal(glideCenterX(1, GEOMETRY), fallCentre, "still on the fall line at impact");
  const rect = landedWindowRect(GEOMETRY);
  const landCentre = rect.x + rect.width / 2;
  assert.ok(
    Math.abs(glideCenterX(2.5, GEOMETRY) - landCentre) < 0.5,
    "settles at the landing corner",
  );
});

test("a notch near the screen edge still lands the window fully on screen", async () => {
  const { landedWindowRect } = await loadNotchHome();
  // Contrived, but the clamp is the whole reason this function exists.
  const rect = landedWindowRect({ ...GEOMETRY, x: 0, width: 20 });
  assert.ok(rect.x >= GEOMETRY.visibleLeft, "must clamp rather than go negative");
  assert.ok(rect.x + rect.width <= GEOMETRY.visibleRight);
});

test("a left-oriented Dock is avoided too, not just a bottom one", async () => {
  const { landedWindowRect } = await loadNotchHome();
  // Dock moved to the left edge, 70pt wide.
  const rect = landedWindowRect({ ...GEOMETRY, visibleLeft: 70 });
  assert.ok(rect.x >= 70, "must not land under a side-docked Dock either");
});

test("the fall accelerates rather than sliding at constant speed", async () => {
  const { fallProgress } = await loadNotchHome();
  assert.equal(fallProgress(0), 0);
  assert.equal(fallProgress(1), 1);
  // Weight reads as covering less than half the distance by the halfway point.
  assert.ok(fallProgress(0.5) < 0.4, "gravity, not a linear slide");
  assert.ok(fallProgress(0.9) > fallProgress(0.5));
  assert.equal(fallProgress(2), 1, "clamped past landing");
});

test("squash-and-stretch conserves volume and settles back to rest", async () => {
  const { landingSquash, squashSettled } = await loadNotchHome();

  const airborne = landingSquash(0.9);
  assert.ok(airborne.scaleY > 1, "stretches along the fall axis");
  assert.ok(airborne.scaleX < 1, "and narrows, so it is not a plain scale-up");
  assert.ok(
    Math.abs(airborne.scaleX * airborne.scaleX * airborne.scaleY - 1) < 0.001,
    "volume preserved",
  );

  const impact = landingSquash(1);
  assert.ok(impact.scaleY < 1, "impact squashes the body");
  assert.ok(impact.scaleX > 1, "and spreads it sideways");

  // The settle must actually converge — an avatar left mid-wobble forever
  // would pin a rAF at 60fps for the life of the session.
  assert.ok(!squashSettled(1), "still animating at impact");
  assert.ok(squashSettled(2.2), "converged a beat later");
  const settled = landingSquash(2.2);
  assert.ok(Math.abs(settled.scaleY - 1) < 0.05, "back to rest");
});

test("landing offset keeps the avatar above the Dock, not merely above the screen edge", async () => {
  const { landingOffsetY, LANDED_AVATAR_SIZE } = await loadNotchHome();
  const y = landingOffsetY(GEOMETRY);
  assert.ok(y > 0);
  assert.ok(
    y + LANDED_AVATAR_SIZE <= GEOMETRY.visibleBottom,
    "must rest above the Dock's own strip, not merely above raw screen height",
  );
});

test("Zazoo stands entirely clear of the cutout, to its left", async () => {
  const { avatarPeekCenterX, notchBox, NOTCH_BOX_BED } = await loadNotchHome();
  const avatarWidth = 72;
  const boxWidth = notchBox(NOTCH_BOX_BED, GEOMETRY).width;
  const centerX = avatarPeekCenterX(boxWidth, avatarWidth, GEOMETRY);
  // The window's right edge IS the cutout's right edge, so the cutout owns
  // the last `GEOMETRY.width` px. Nothing of him may reach into it — that is
  // a hole in the display, and anything drawn there is simply deleted.
  const notchLocalLeft = boxWidth - GEOMETRY.width;
  assert.ok(
    centerX + avatarWidth / 2 <= notchLocalLeft,
    "his right edge must stop before the cutout starts",
  );
  // 8px of daylight between him and the hole, not flush against it.
  assert.ok(Math.abs(centerX + avatarWidth / 2 - (notchLocalLeft - 8)) < 0.01);
});

test("on a flat panel with no cutout, Zazoo falls back to centred", async () => {
  const { avatarPeekCenterX } = await loadNotchHome();
  const flat = { ...GEOMETRY, hasNotch: false, width: 0 };
  assert.equal(avatarPeekCenterX(300, 72, flat), 150);
});

test("the docked box is the cutout's width plus the drawable strip beside it", async () => {
  const { notchBox, NOTCH_BOX_BED, NOTCH_BOX_CHAT } = await loadNotchHome();
  assert.equal(notchBox(NOTCH_BOX_BED, GEOMETRY).width, GEOMETRY.width + NOTCH_BOX_BED.side);
  assert.equal(notchBox(NOTCH_BOX_CHAT, GEOMETRY).height, NOTCH_BOX_CHAT.height);
  // Flat panel: no cutout to reserve, so the strip is the whole box.
  const flat = { ...GEOMETRY, hasNotch: false, width: 0 };
  assert.equal(notchBox(NOTCH_BOX_BED, flat).width, NOTCH_BOX_BED.side);
});

test("FREE_BOX matches the collapsed free-mode window size — a correctness pin, not a style choice", async () => {
  const { FREE_BOX } = await loadNotchHome();
  // Live-reproduced regression: OverlayApp.tsx's WINDOW_SIZE.collapsed is
  // 96x96. Landing at any OTHER size lets that component's own resize
  // effect (re-armed the instant `home` flips to "free") immediately
  // overwrite this module's Dock-aware placement via the pre-existing
  // `overlay_resize` command, whose bottom-right-pin formula has no idea
  // where the Dock is. Verified live: a 300x190 landing box drifted to a
  // position with ~80% of its height behind the Dock. If OverlayApp's
  // collapsed size ever changes, this constant must change with it.
  assert.deepEqual(FREE_BOX, { width: 96, height: 96 });
});

test("he stays behind the notch at rest and comes out on hover or shortcut", async () => {
  const { companionPresence, companionSummoned, restingNotchBox, NOTCH_REST_PEEK } =
    await loadNotchHome();

  // User directive 2026-09-08: always present behind the notch; out of it only
  // on a notch hover or the shortcut.
  const rest = {
    pttActive: false,
    panelOpen: false,
    chatPose: false,
    inNotchHome: true,
    notchHovered: false,
  };
  assert.equal(companionSummoned(rest), false);
  assert.equal(companionSummoned({ ...rest, notchHovered: true }), true);
  assert.equal(companionSummoned({ ...rest, pttActive: true }), true);
  // The free-floating home has no notch to hover, so a cursor at the top of
  // the screen must not drag it on screen.
  assert.equal(
    companionSummoned({ ...rest, inNotchHome: false, notchHovered: true }),
    false,
  );

  // Resting in the notch is SHOWN but click-through — the strip it occupies is
  // the menu bar, so a window taking the mouse there would cost the user their
  // own menus. Resting anywhere else is off screen.
  assert.equal(
    companionPresence({ sessionReady: true, inNotchHome: true, summoned: false }),
    "resting",
  );
  assert.equal(
    companionPresence({ sessionReady: true, inNotchHome: true, summoned: true }),
    "interactive",
  );
  assert.equal(
    companionPresence({ sessionReady: true, inNotchHome: false, summoned: false }),
    "concealed",
  );
  assert.equal(
    companionPresence({ sessionReady: false, inNotchHome: true, summoned: false }),
    "concealed",
  );

  // The resting window is the cutout plus the peek, so the top of his head
  // shows below the notch and the window itself clips the rest of him.
  const box = restingNotchBox(GEOMETRY);
  assert.equal(box.width, GEOMETRY.width, "parked exactly over the cutout");
  assert.equal(box.height, GEOMETRY.height + NOTCH_REST_PEEK);
  assert.ok(NOTCH_REST_PEEK > 0 && NOTCH_REST_PEEK < 40, "a peek, not a panel");
});

test("the resting peek shows his head, not the empty margin above it", async () => {
  const { restingAvatarY, NOTCH_REST_PEEK, avatarDrawnHeight } = await loadNotchHome();
  // The rig draws nothing in the top ~25% of its box, so parking the BOX top
  // at the cutout edge showed a plain black strip (seen in overlay.html?lab=1).
  // His crown, not his bounding box, belongs at the cutout's lower edge.
  const width = 72;
  const y = restingAvatarY(GEOMETRY.height, width);
  assert.ok(y < GEOMETRY.height, "the box starts ABOVE the cutout edge");
  const crown = y + avatarDrawnHeight(width) * (76.16 / 310);
  assert.ok(
    Math.abs(crown - GEOMETRY.height) <= 1,
    `the crown should land on the cutout's lower edge, got ${crown}`,
  );
  assert.ok(
    crown + NOTCH_REST_PEEK <= GEOMETRY.height + NOTCH_REST_PEEK,
    "the whole peek strip is filled with head",
  );
});
