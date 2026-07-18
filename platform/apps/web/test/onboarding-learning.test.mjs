import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const questionsUrl = new URL("../src/app/onboarding/questions.ts", import.meta.url);
const dialogUrl = new URL("../src/app/onboarding/OnboardingDialog.tsx", import.meta.url);
const avatarProgressUrl = new URL("../src/app/avatar/EggHatcher.tsx", import.meta.url);
const settingsUrl = new URL("../src/app/pages/SettingsPage.tsx", import.meta.url);
const layoutUrl = new URL("../src/app/Layout.tsx", import.meta.url);
const homeUrl = new URL("../src/app/pages/HomePage.tsx", import.meta.url);
const commonsPanelUrl = new URL("../src/app/components/CommonsCapabilityPanel.tsx", import.meta.url);

async function loadQuestionsModule() {
  const source = await readFile(questionsUrl, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText.replace(
    /import \{ SPIRIT_ANIMALS \} from "\.\.\/avatar\/avatar-store";/,
    `const SPIRIT_ANIMALS = [{ value: "owl", label: "Owl" }];`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

test("every onboarding question declares separate why and consequence copy", async () => {
  const source = await readFile(questionsUrl, "utf8");
  const questions = source.match(/const Q_[A-Z_]+: OnboardingQuestion = \{[\s\S]*?\n\};/g) ?? [];
  assert.equal(questions.length, 9);
  for (const question of questions) {
    assert.match(question, /\n\s+why:\s+"/);
    assert.match(question, /\n\s+consequence:\s+"/);
  }
  assert.doesNotMatch(source, /helpText: "Bridge calls this an Initiative/);
  assert.doesNotMatch(source, /label: "(?:Initiative|Touchpoint)"/);
  assert.match(source, /sales_deals: \{ nodeType: "initiative", label: "Deal" \}/);
  assert.match(source, /job_search: \{ nodeType: "initiative", label: "Application" \}/);
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
    spirit_animal: "owl",
    role_model: "",
    domain: "relationships",
    watch_first: ["surface_signals"],
    view_style: "table",
    workspace_name: "Signal workspace",
  });
  const declaredNodeTypes = new Set(blueprint.entities.map((entity) => entity.nodeType));

  assert.ok(declaredNodeTypes.has("signal"));
  for (const view of blueprint.views) {
    assert.ok(declaredNodeTypes.has(view.entity), `view entity "${view.entity}" must be declared`);
  }
});

test("onboarding does not offer the deprecated touchpoint vocabulary", async () => {
  const [questions, dialog, avatarProgress] = await Promise.all([
    readFile(questionsUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
    readFile(avatarProgressUrl, "utf8"),
  ]);
  assert.doesNotMatch(questions, /log_touchpoints|as touchpoints|'s Workspace/);
  assert.doesNotMatch(dialog, /"Your Organization is hatching|avatar has hatched/);
  assert.doesNotMatch(avatarProgress, /`Egg (?:hatched|incubating)/);
});

test("multi-select onboarding choices stay editable until Continue commits them", async () => {
  const source = await readFile(dialogUrl, "utf8");
  assert.match(source, /const \[multiDrafts, setMultiDrafts\] = useState<Record<string, string\[\]>>\(\{\}\)/);
  assert.match(source, /const selected = \(multiDrafts\[question\.id\] \?\? \[\]\)\.includes\(opt\.value\)/);
  assert.match(source, /answer\(question\.id, multiDrafts\[question\.id\] \?\? \[\]\)/);
  const toggleBody = source.match(/function toggleMulti[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.doesNotMatch(toggleBody, /setAnswers/);
});

test("onboarding persists the chosen Organization name and refreshes the shell", async () => {
  const [dialog, layout, settings] = await Promise.all([
    readFile(dialogUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(settingsUrl, "utf8"),
  ]);
  assert.match(dialog, /answers\.workspace_name/);
  assert.match(dialog, /trpc\.workspace\.rename\.mutate/);
  assert.match(dialog, /maxLength=\{question\.id === "workspace_name" \? 120 : undefined\}/);
  assert.ok(
    dialog.indexOf("trpc.workspace.rename.mutate") < dialog.indexOf("trpc.workspace.blueprint.propose.mutate"),
    "Organization rename must succeed before blueprint proposal and activation",
  );
  assert.ok(
    dialog.indexOf("trpc.workspace.blueprint.propose.mutate") < dialog.indexOf("trpc.workspace.blueprint.activate.mutate"),
  );
  assert.match(dialog, /onProposed\?\.\(organization\)/);
  assert.match(layout, /onProposed=\{\(organization\) => \{/);
  assert.match(layout, /setWorkspaceName\(organization\.name\)/);
  assert.match(layout, /setWorkspaces\(\(current\) =>/);
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
  assert.doesNotMatch(home, /relationships, initiatives/);
  assert.doesNotMatch(layout, /Switching workspaces/);
  assert.doesNotMatch(settings, /Open Intelligence|Shared Assistants|and Workflows|to="\/intelligence"/);
  assert.match(settings, /to=\{`\/module\/\$\{encodeURIComponent\(row\.packageName\)\}`\}/);
  assert.doesNotMatch(commonsPanel, /Commons package/);
});
