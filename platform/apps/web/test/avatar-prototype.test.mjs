import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const overlaySource = await readFile(new URL("../src/app/avatar/AvatarOverlay.tsx", import.meta.url), "utf8");

test("the in-app browser companion uses the shipped Zazoo renderer", () => {
  assert.match(overlaySource, /from ["']\.\/zazoo\/ZazooAvatar["']/);
  assert.match(overlaySource, /<ZazooAvatar\b/);
});

const annotateSource = await readFile(new URL("../src/app/avatar/AnnotateApp.tsx", import.meta.url), "utf8");
const pointerSource = await readFile(new URL("../src/app/avatar/AgentPointer.tsx", import.meta.url), "utf8");
const askSource = await readFile(new URL("../src/app/avatar/CompanionAsk.tsx", import.meta.url), "utf8");
const doSource = await readFile(new URL("../src/app/avatar/DoRun.tsx", import.meta.url), "utf8");

test("the companion's on-screen pointer is an arrow glyph that flies, not a ring", () => {
  assert.match(annotateSource, /<AgentPointer\b/);
  assert.doesNotMatch(annotateSource, /<circle cx=\{pointer\.x\}/);
  assert.match(pointerSource, /export const ARROW_PATH = "M0 0 L0 17\.5/);
  assert.match(pointerSource, /c \* c \* \(3 - 2 \* c\)/, "smoothstep clock");
  assert.match(pointerSource, /target\.stream/, "actuator samples snap instead of flying");
  assert.match(pointerSource, /prefers-reduced-motion/);
});

test("Do mode is explicit, consent-gated, and stoppable", () => {
  assert.match(askSource, /<DoRun\b/);
  assert.match(askSource, /aria-pressed=\{mode === "do"\}/);
  assert.match(doSource, /AVATAR_ALLOW_CONTROL_KEY = "bridge:avatar:allow_control"/);
  assert.match(doSource, /localStorage\.getItem\(AVATAR_ALLOW_CONTROL_KEY\) === "true"/, "control defaults OFF");
  assert.match(doSource, /task: trimmed,\s+allowControl,\s+speak,/, "consent travels with every request");
  assert.match(doSource, /tauriInvoke\("act_stop"\)/);
  assert.match(doSource, /bridge:act-step/);
  assert.match(doSource, /One screenshot per step is sent to Groq/);
});

test("the remaining Hey Clicky gaps have real surfaces: guide, circle-to-focus, dictation, app allowlist", () => {
  assert.match(doSource, /guide: asGuide/, "walkthrough mode rides the same act request");
  assert.match(doSource, /Show me how/);
  assert.match(doSource, /AVATAR_ALLOWED_APPS_KEY = "bridge:avatar:allowed_apps"/);
  assert.match(askSource, /annotate_scribble_begin/);
  assert.match(askSource, /focusRegion: sharing \? focusRegion : null/, "a circled area only travels with a consented screenshot");
  assert.match(askSource, /act_type_text/);
  assert.match(askSource, /allowControl: readAllowControl\(\)/, "dictation needs the same control consent as Do");
  assert.match(annotateSource, /annotate_scribble_done/);
  assert.match(annotateSource, /pointerEvents: scribble \? "auto" : "none"/, "the overlay is interactive only while circling");
});
