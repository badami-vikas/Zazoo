import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const questionsUrl = new URL("../src/app/onboarding/questions.ts", import.meta.url);
const dialogUrl = new URL("../src/app/onboarding/OnboardingDialog.tsx", import.meta.url);
const avatarProgressUrl = new URL("../src/app/avatar/AvatarSetupProgress.tsx", import.meta.url);
const avatarStoreUrl = new URL("../src/app/avatar/avatar-store.ts", import.meta.url);
const avatarCompatUrl = new URL("../src/app/avatar/avatar-v1-compat.ts", import.meta.url);
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
  const [compatSource, storeSource] = await Promise.all([
    readFile(avatarCompatUrl, "utf8"),
    readFile(avatarStoreUrl, "utf8"),
  ]);
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  };
  const compatJavaScript = ts.transpileModule(compatSource, { compilerOptions }).outputText;
  const compatDataUrl = `data:text/javascript;base64,${Buffer.from(compatJavaScript).toString("base64")}`;
  const isolatedStoreSource = storeSource
    .replace(
      /import \{ useEffect, useState \} from "react";/,
      "const useEffect = () => undefined; const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined];",
    )
    .replace('"./avatar-v1-compat"', `"${compatDataUrl}"`);
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
  assert.doesNotMatch(source, /label: "(?:Record|Touchpoint)"/);
  assert.match(source, /sales_deals: \{ nodeType: "record", label: "Deal" \}/);
  assert.match(source, /job_search: \{ nodeType: "record", label: "Application" \}/);
  assert.match(source, /support: \{ nodeType: "touchpoint", label: "Ticket" \}/);
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
  for (const retiredLabel of ['label: "Knowledge"', 'label: "Intelligence"', "how Workflows,"]) {
    assert.doesNotMatch(source, new RegExp(retiredLabel));
  }
});

test("signal onboarding choice declares every entity referenced by its views", async () => {
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

  assert.ok(declaredNodeTypes.has("signal"));
  for (const view of blueprint.views) {
    assert.ok(declaredNodeTypes.has(view.entity), `view entity "${view.entity}" must be declared`);
  }
});

test("onboarding does not offer deprecated setup-lifecycle vocabulary", async () => {
  const [questions, dialog, avatarProgress] = await Promise.all([
    readFile(questionsUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
    readFile(avatarProgressUrl, "utf8"),
  ]);
  assert.doesNotMatch(questions, /log_touchpoints|as touchpoints|'s Organization/);
  assert.doesNotMatch(questions, /spirit[_ -]animal/i);
  assert.doesNotMatch(dialog, /hatch|egg/i);
  assert.doesNotMatch(avatarProgress, /hatch|egg|creature|matur/i);
  assert.match(avatarProgress, /AvatarSetupProgress/);
});

test("legacy browser Avatar preferences migrate to v2 without a legacy write path", async () => {
  const [compatSource, storeSource] = await Promise.all([
    readFile(avatarCompatUrl, "utf8"),
    readFile(avatarStoreUrl, "utf8"),
  ]);
  const javascript = ts.transpileModule(compatSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compat = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
  const storage = new Map([
    [compat.LEGACY_AVATAR_STORAGE_KEY, JSON.stringify({ animal: "owl", eggHatched: true, avatarName: "Zazoo" })],
  ]);
  const migrated = compat.readLegacyAvatarPreferences({
    getItem(key) {
      return storage.get(key) ?? null;
    },
  });

  assert.deepEqual(migrated, { style: "owl", avatarReady: true, avatarName: "Zazoo" });
  assert.equal(
    compat.readLegacyAvatarPreferences({
      getItem() {
        return JSON.stringify({ animal: "owl", eggHatched: "false" });
      },
    }),
    null,
  );
  assert.match(storeSource, /const STORAGE_KEY = "bridge\.avatar\.v2"/);
  assert.match(storeSource, /writePrefs\(migrated\)/);
  assert.match(storeSource, /removeItem\(LEGACY_AVATAR_STORAGE_KEY\)/);
  assert.doesNotMatch(storeSource, /setItem\(LEGACY_AVATAR_STORAGE_KEY/);
});

test("every supported legacy Avatar style is persisted canonically before v1 is removed", async () => {
  const avatarStore = await loadAvatarStoreModule();
  const priorWindow = globalThis.window;
  const styles = [
    "owl",
    "fox",
    "turtle",
    "crane",
    "wolf",
    "cat",
    "lion",
    "dog",
    "panda",
    "butterfly",
    "dolphin",
    "peacock",
    "elephant",
    "eagle",
    "horse",
    "beaver",
  ];

  try {
    for (const style of styles) {
      const rows = new Map([
        ["bridge.avatar.v1", JSON.stringify({ animal: style, eggHatched: true })],
      ]);
      globalThis.window = {
        localStorage: {
          getItem(key) {
            return rows.get(key) ?? null;
          },
          setItem(key, value) {
            rows.set(key, value);
          },
          removeItem(key) {
            rows.delete(key);
          },
        },
      };

      assert.deepEqual(avatarStore.loadAvatarPrefs(false), { style, avatarReady: true });
      assert.deepEqual(JSON.parse(rows.get("bridge.avatar.v2")), { style, avatarReady: true });
      assert.equal(rows.has("bridge.avatar.v1"), false);
    }
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test("Avatar preference reads reject malformed readiness and never delete v1 after a failed v2 write", async () => {
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

    const legacyRows = new Map([
      ["bridge.avatar.v1", JSON.stringify({ animal: "turtle", eggHatched: true })],
    ]);
    let legacyRemoved = false;
    globalThis.window = {
      localStorage: {
        getItem(key) {
          return legacyRows.get(key) ?? null;
        },
        setItem() {
          throw new Error("quota exceeded");
        },
        removeItem(key) {
          legacyRemoved = true;
          legacyRows.delete(key);
        },
      },
    };
    const migrated = avatarStore.loadAvatarPrefs(false);
    assert.deepEqual(migrated, { style: "turtle", avatarReady: true });
    assert.equal(legacyRemoved, false);
    assert.equal(legacyRows.has("bridge.avatar.v1"), true);
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
  assert.doesNotMatch(settings, /Open Intelligence|Shared Assistants|and Workflows|to="\/intelligence"/);
  assert.match(settings, /to=\{`\/module\/\$\{encodeURIComponent\(row\.moduleName\)\}`\}/);
  assert.doesNotMatch(commonsPanel, /Commons module/);
});
