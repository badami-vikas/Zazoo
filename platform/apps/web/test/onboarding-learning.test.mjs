import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const questionsUrl = new URL("../src/app/onboarding/questions.ts", import.meta.url);
const dialogUrl = new URL("../src/app/onboarding/OnboardingDialog.tsx", import.meta.url);
const settingsUrl = new URL("../src/app/pages/SettingsPage.tsx", import.meta.url);

test("every onboarding question declares separate why and consequence copy", async () => {
  const source = await readFile(questionsUrl, "utf8");
  const questions = source.match(/const Q_[A-Z_]+: OnboardingQuestion = \{[\s\S]*?\n\};/g) ?? [];
  assert.equal(questions.length, 9);
  for (const question of questions) {
    assert.match(question, /\n\s+why:\s+"/);
    assert.match(question, /\n\s+consequence:\s+"/);
  }
  assert.doesNotMatch(source, /helpText: "Bridge calls this an Initiative/);
});

test("onboarding trust ceremony is bounded, visible, inspectable, and stoppable", async () => {
  const source = await readFile(dialogUrl, "utf8");
  assert.match(source, /Nothing runs in the background during setup/);
  assert.match(source, /desktopInvoke<void>\("sensor_start", \{ sensorId: "apps" \}\)/);
  assert.match(source, /trpc\.onboarding\.recordTrustCapture\.mutate/);
  assert.match(source, /dispatchCaptureEvent\(\{ kind: "apps", memoryId: memory\.id \}\)/);
  assert.match(source, /desktopInvoke<void>\("sensor_stop", \{ sensorId: "apps" \}\)/);
});

test("learning controls expose re-entry, correction, deletion, and all schedule decisions", async () => {
  const source = await readFile(settingsUrl, "utf8");
  for (const label of [
    "Re-enter onboarding",
    "Correct",
    "Delete",
    "Snooze 1 day",
    "Pause",
    "Schedule in 7 days",
    "Skip",
  ]) {
    assert.match(source, new RegExp(label));
  }
});
