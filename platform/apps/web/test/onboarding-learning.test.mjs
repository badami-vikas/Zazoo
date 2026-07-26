import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const questionsUrl = new URL("../src/app/onboarding/questions.ts", import.meta.url);
const dialogUrl = new URL("../src/app/onboarding/OnboardingDialog.tsx", import.meta.url);
const avatarProgressUrl = new URL("../src/app/avatar/AvatarSetupProgress.tsx", import.meta.url);
const avatarStoreUrl = new URL("../src/app/avatar/avatar-store.ts", import.meta.url);
const settingsUrl = new URL("../src/app/pages/SettingsPage.tsx", import.meta.url);
const layoutUrl = new URL("../src/app/Layout.tsx", import.meta.url);
const homeUrl = new URL("../src/app/pages/HomePage.tsx", import.meta.url);
const commonsPanelUrl = new URL("../src/app/components/CommonsCapabilityPanel.tsx", import.meta.url);
const uiDialogUrl = new URL("../src/app/components/ui/dialog.tsx", import.meta.url);

async function loadQuestionsModule() {
  const source = await readFile(questionsUrl, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText.replace(
    /import \{ AVATAR_STYLES \} from "\.\.\/avatar\/avatar-store";/,
    `const AVATAR_STYLES = [{ value: "owl", label: "Owl" }];`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

async function loadAvatarStoreModule() {
  const storeSource = await readFile(avatarStoreUrl, "utf8");
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  };
  const isolatedStoreSource = storeSource
    .replace(
      /import \{ useEffect, useState \} from "react";/,
      "const useEffect = () => undefined; const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined];",
    );
  const storeJavaScript = ts.transpileModule(isolatedStoreSource, { compilerOptions }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(storeJavaScript).toString("base64")}`);
}

test("every onboarding question declares separate why and consequence copy", async () => {
  const source = await readFile(questionsUrl, "utf8");
  const questions = source.match(/const Q_[A-Z_]+: OnboardingQuestion = \{[\s\S]*?\n\};/g) ?? [];
  assert.equal(questions.length, 9);
  for (const question of questions) {
    assert.match(question, /\n\s+why:\s+"/);
    assert.match(question, /\n\s+consequence:\s+"/);
  }
  assert.doesNotMatch(source, /helpText: "Bridge calls this an Record/);
  assert.match(source, /sales_deals: \{ nodeType: "record", label: "Deal" \}/);
  assert.match(source, /job_search: \{ nodeType: "record", label: "Application" \}/);
  assert.match(source, /support: \{ nodeType: "event", label: "Support Event" \}/);
});

test("onboarding trust ceremony is bounded, visible, inspectable, and stoppable", async () => {
  const source = await readFile(dialogUrl, "utf8");
  assert.match(source, /Nothing runs in the background during setup/);
  assert.match(source, /desktopInvoke<void>\("sensor_start", \{ sensorId: "apps" \}\)/);
  assert.match(source, /trpc\.onboarding\.recordTrustCapture\.mutate/);
  assert.match(source, /dispatchCaptureEvent\(\{ kind: "apps", memoryId: memory\.id \}\)/);
  assert.match(source, /desktopInvoke<void>\("sensor_stop", \{ sensorId: "apps" \}\)/);
  assert.match(
    source,
    /<DialogContent className="max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain sm:max-w-md">/,
    "the trust ceremony must scroll inside the viewport so its required Continue action remains reachable",
  );
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

test("signal onboarding choice compiles canonical Event entities for every View", async () => {
  const { buildBlueprintFromAnswers } = await loadQuestionsModule();
  const blueprint = buildBlueprintFromAnswers({
    profession: "Product lead",
    avatar_style: "owl",
    role_model: "",
    domain: "relationships",
    watch_first: ["surface_signals"],
    view_style: "table",
    organization_name: "Signal organization",
  });
  const declaredNodeTypes = new Set(blueprint.entities.map((entity) => entity.nodeType));

  assert.ok(declaredNodeTypes.has("event"));
  for (const view of blueprint.views) {
    assert.ok(declaredNodeTypes.has(view.entity), `view entity "${view.entity}" must be declared`);
  }
});

test("onboarding uses canonical Avatar setup contracts", async () => {
  const [questions, dialog, avatarProgress] = await Promise.all([
    readFile(questionsUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
    readFile(avatarProgressUrl, "utf8"),
  ]);
  assert.match(questions, /id: "avatar_style"/);
  assert.match(dialog, /onAvatarReady/);
  assert.match(avatarProgress, /AvatarSetupProgress/);
});

test("Avatar preference reads accept only the canonical v2 shape", async () => {
  const avatarStore = await loadAvatarStoreModule();
  const priorWindow = globalThis.window;

  try {
    const malformedRows = new Map([
      ["bridge.avatar.v2", JSON.stringify({ style: "owl", avatarReady: "false" })],
    ]);
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return malformedRows.get(key) ?? null;
        },
        setItem(key, value) {
          malformedRows.set(key, value);
        },
        removeItem(key) {
          malformedRows.delete(key);
        },
      },
    };
    assert.equal(avatarStore.hasStoredPrefs(), false);
    assert.equal(avatarStore.loadAvatarPrefs(false).avatarReady, false);
    assert.equal(avatarStore.loadAvatarPrefs(true).avatarReady, true);
    assert.equal(avatarStore.isAvatarStyle("lion"), true);
    assert.equal(avatarStore.isAvatarStyle("unsupported"), false);

    const canonicalRows = new Map();
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return canonicalRows.get(key) ?? null;
        },
        setItem(key, value) {
          canonicalRows.set(key, value);
        },
        removeItem(key) {
          canonicalRows.delete(key);
        },
      },
    };
    avatarStore.saveAvatarPrefs({ style: "turtle", avatarReady: true });
    assert.deepEqual(avatarStore.loadAvatarPrefs(false), { style: "turtle", avatarReady: true });
    assert.deepEqual(JSON.parse(canonicalRows.get("bridge.avatar.v2")), {
      style: "turtle",
      avatarReady: true,
    });
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test("multi-select onboarding choices stay editable until Continue commits them", async () => {
  const source = await readFile(dialogUrl, "utf8");
  assert.match(source, /const \[multiDrafts, setMultiDrafts\] = useState<Record<string, string\[\]>>\(\{\}\)/);
  assert.match(source, /const selected = \(multiDrafts\[question\.id\] \?\? \[\]\)\.includes\(opt\.value\)/);
  assert.match(source, /answer\(question\.id, multiDrafts\[question\.id\] \?\? \[\]\)/);
  const toggleBody = source.match(/function toggleMulti[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.doesNotMatch(toggleBody, /setAnswers/);
});

test("dialog overlay forwards the Radix Presence ref", async () => {
  const source = await readFile(uiDialogUrl, "utf8");
  assert.match(source, /const DialogOverlay = React\.forwardRef</);
  assert.match(source, /<DialogPrimitive\.Overlay\s+ref=\{ref\}/);
});

test("onboarding persists the chosen Organization name and refreshes the shell", async () => {
  const [dialog, layout, settings] = await Promise.all([
    readFile(dialogUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(settingsUrl, "utf8"),
  ]);
  assert.match(dialog, /answers\.organization_name/);
  assert.match(dialog, /trpc\.organization\.rename\.mutate/);
  assert.match(dialog, /maxLength=\{question\.id === "organization_name" \? 120 : undefined\}/);
  assert.ok(
    dialog.indexOf("trpc.organization.rename.mutate") < dialog.indexOf("trpc.organization.blueprint.propose.mutate"),
    "Organization rename must succeed before blueprint proposal and activation",
  );
  assert.ok(
    dialog.indexOf("trpc.organization.blueprint.propose.mutate") < dialog.indexOf("trpc.organization.blueprint.activate.mutate"),
  );
  assert.match(dialog, /onProposed\?\.\(organization\)/);
  assert.match(layout, /onProposed=\{\(organization\) => \{/);
  assert.match(layout, /setOrganizationName\(organization\.name\)/);
  assert.match(layout, /setOrganizations\(\(current\) =>/);
  assert.match(settings, /open Learning and re-enter Onboarding/);
  assert.match(settings, /row\.manifest\.module !== undefined/);
  assert.match(settings, /row\.moduleAttachment === undefined/);
  assert.doesNotMatch(settings, /there's no update endpoint/);
});

test("the exact demo surfaces keep retired vocabulary out of visible copy", async () => {
  const [home, layout, settings, commonsPanel] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(settingsUrl, "utf8"),
    readFile(commonsPanelUrl, "utf8"),
  ]);
  assert.doesNotMatch(home, /relationships, records/);
  assert.doesNotMatch(layout, /Switching organizations/);
  assert.match(settings, /to=\{`\/module\/\$\{encodeURIComponent\(row\.moduleName\)\}`\}/);
  assert.doesNotMatch(commonsPanel, /Commons module/);
});
