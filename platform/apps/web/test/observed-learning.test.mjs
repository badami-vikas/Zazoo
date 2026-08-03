/**
 * TASK-029 — ObservedLearningCard (Settings → Learning) source contract:
 * the flight-gated "your Egg noticed a pattern — keep it?" review surface.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsUrl = new URL("../src/app/pages/SettingsPage.tsx", import.meta.url);

test("ObservedLearningCard hides itself completely unless the flight reports enabled — no dead controls", async () => {
  const source = await readFile(settingsUrl, "utf8");
  assert.match(source, /trpc\.learning\.status\s*\n?\s*\.query/, "must ask the server whether the flight is on");
  assert.match(source, /if \(enabled !== true\) return null;/, "flight off OR still resolving must render NOTHING");
  assert.match(source, /\.catch\(\(\) => setEnabled\(false\)\)/, "an unreachable API must be treated as off, never as an error surface with dead controls");
});

test("suggested-then-accepted stays Human-gated in the UI: accept is the only preference-minting action", async () => {
  const source = await readFile(settingsUrl, "utf8");
  assert.match(source, /trpc\.learning\.suggestions\.accept\.mutate/);
  assert.match(source, /trpc\.learning\.suggestions\.reject\.mutate/);
  assert.match(source, /trpc\.learning\.digest\.mutate/, "digest (check for patterns) is exposed");
  // The card never writes a preference directly — no memory write call exists.
  assert.doesNotMatch(source, /trpc\.learning\.preferences\.\w*(create|write|add)/, "no direct preference write path may exist in the UI");
});

test("everything learned stays inspectable and deletable, with honest provenance copy", async () => {
  const source = await readFile(settingsUrl, "utf8");
  assert.match(source, /trpc\.learning\.preferences\.list\s*\n?\s*\.query/);
  assert.match(source, /evidenceSignalIds\.length/, "evidence count must be shown for both suggestions and accepted preferences");
  assert.match(source, /Nothing is learned without your acceptance/, "the card states the suggested-then-accepted contract in user copy");
  assert.match(source, /forgetPreference/, "accepted preferences must be deletable");
  assert.match(source, /window\.confirm\("Delete this learned preference from Bridge\?"\)/);
});

test("the card is mounted inside the Settings Learning section", async () => {
  const source = await readFile(settingsUrl, "utf8");
  assert.match(source, /<ObservedLearningCard \/>/);
});
