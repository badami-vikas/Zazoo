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
// ADR-154 — the cross-Module capability inventory moved out of Settings.
const intelligenceUrl = new URL("../src/app/pages/IntelligencePage.tsx", import.meta.url);
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
    `const AVATAR_STYLES = [{ value: "owl", label: "Owl" }, { value: "fox", label: "Fox" }];`,
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

/** Walks the real adaptive flow, answering each question with a plausible
 * value, and returns every question the user would actually be shown. */
async function walkFlow(seed = {}, options = {}) {
  const { nextQuestion } = await loadQuestionsModule();
  const answers = { ...seed };
  const asked = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const question = nextQuestion(answers, options);
    if (!question) return asked;
    asked.push(question);
    if (question.kind === "multi_select") {
      answers[question.id] = [question.options[0].value];
    } else if (question.kind === "single_select") {
      answers[question.id] = question.options[0].value;
    } else {
      answers[question.id] = "Sales lead at a SaaS startup; I run and cook";
    }
  }
  throw new Error("onboarding flow did not terminate");
}

test("the user-facing onboarding set is exactly the five documented manual questions", async () => {
  // docs/raw/bridge-foundational-agents-onboarding-2026-07.md step 6. Avatar
  // style is spec STEP 3 and is deliberately not one of the five.
  const asked = await walkFlow();
  assert.deepEqual(
    asked.map((question) => question.id),
    ["avatar_style", "profession", "workday", "work_context", "work_lives", "watch_first"],
  );
  const manual = asked.filter((question) => question.id !== "avatar_style");
  assert.equal(manual.length, 5);
  const workday = asked.find((question) => question.id === "workday");
  assert.equal(workday.maxSelections, 3, "spec allows up to 3 workday picks");
});

test("every onboarding question declares separate why and consequence copy", async () => {
  const source = await readFile(questionsUrl, "utf8");
  for (const question of await walkFlow()) {
    assert.ok(question.why, `${question.id} must declare why`);
    assert.ok(question.consequence, `${question.id} must declare a consequence`);
    assert.notEqual(question.why, question.consequence);
  }
  assert.doesNotMatch(source, /helpText: "Bridge calls this an Record/);
  assert.match(source, /sales_deals: \{ nodeType: "record", label: "Deal" \}/);
  assert.match(source, /job_search: \{ nodeType: "record", label: "Application" \}/);
  assert.match(source, /support: \{ nodeType: "event", label: "Support Event" \}/);
});

test("role-model questions are gated out of the default flow, not deleted", async () => {
  // They belong to a separately-approved requirement
  // (docs/raw/requirement-role-model-learning-dealpilot-ui-2026-07-14.md).
  const byDefault = (await walkFlow()).map((question) => question.id);
  assert.ok(!byDefault.includes("role_model"));
  assert.ok(!byDefault.includes("role_model_why"));
  const restored = (await walkFlow({}, { includeRoleModel: true })).map((question) => question.id);
  assert.ok(restored.includes("role_model"));
  assert.ok(restored.includes("role_model_why"));
});

test("dropped questions are derived or defaulted, never silently lost", async () => {
  const { inferDomain, derivedVocabName, derivedViewStyle, defaultOrganizationName, buildBlueprintFromAnswers } =
    await loadQuestionsModule();

  // domain + vocabulary + view style are inferred from profession/workday.
  const sales = { profession: "Sales lead at a SaaS startup", workday: ["pipeline"] };
  assert.equal(inferDomain(sales), "sales_deals");
  assert.equal(derivedViewStyle(sales), "board");
  assert.equal(derivedVocabName({ profession: "Recruiter" }), "Candidate");
  assert.equal(inferDomain({ profession: "Support manager" }), "support");
  // A generic profession still lands somewhere honest.
  assert.equal(inferDomain({ profession: "Chief of staff" }), "relationships");
  assert.equal(derivedViewStyle({ profession: "Chief of staff" }), "table");
  // An explicit answer still overrides every derived value.
  assert.equal(inferDomain({ profession: "Recruiter", domain: "relationships" }), "relationships");
  assert.equal(derivedVocabName({ profession: "Recruiter", vocab_name: "Applicant" }), "Applicant");
  assert.equal(derivedViewStyle({ profession: "Sales lead", view_style: "table" }), "table");
  // The Organization name is defaulted from the signed-in email.
  assert.equal(defaultOrganizationName("alice@acmecorp.com"), "Acmecorp");
  assert.equal(defaultOrganizationName(undefined), "My Organization");

  // The adaptive contextual answer becomes a real starter column.
  const blueprint = buildBlueprintFromAnswers({
    profession: "Sales lead at a SaaS startup",
    workday: ["pipeline"],
    work_context: "amount",
    work_lives: ["email"],
    watch_first: [],
  });
  assert.ok(blueprint.entities[0].fields.some((field) => field.id === "amount" && field.kind === "number"));
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

test("grouped onboarding choices stay editable until the screen's Continue commits them", async () => {
  // E4 (2026-08-05, "group them"): questions are now batched per screen behind
  // one `groupDrafts` map and one Continue, replacing the old one-question
  // `multiDrafts`/`toggleMulti` pair. The guarantee this test protects is
  // unchanged: nothing reaches `answers` (governed state) until committed.
  const source = await readFile(dialogUrl, "utf8");
  assert.match(source, /const \[groupDrafts, setGroupDrafts\] = useState<Record<string, string \| string\[\]>>\(\{\}\)/);
  assert.match(source, /const drafted = draftFor\(q\.id, q\.kind\) as string\[\]/);
  assert.match(source, /const selected = drafted\.includes\(opt\.value\)/);
  assert.match(source, /onClick=\{\(\) => toggleGroupMulti\(q\.id, opt\.value, q\.maxSelections\)\}/);
  // "Up to 3" (spec step 6, manual question 2) is enforced, not just suggested.
  assert.match(source, /if \(maxSelections !== undefined && drafted\.length >= maxSelections\) return current;/);
  const toggleBody = source.match(/function toggleGroupMulti[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.doesNotMatch(toggleBody, /setAnswers/);
  // The actual commit path — every question on the screen, one state update.
  const commitBody = source.match(/function commitGroup\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(commitBody, /setAnswers\(updated\)/);
  assert.match(commitBody, /setGroupDrafts\(\{\}\)/);
});

test("onboarding questions are batched into topical screens, not asked one at a time", async () => {
  // E4: nextQuestionGroup batches the same six ids nextQuestion() walks
  // singly. Completion semantics must agree exactly with nextQuestion/
  // isComplete — this is a presentation layer, not a second source of truth.
  const { nextQuestion, nextQuestionGroup, isComplete } = await loadQuestionsModule();
  let answers = {};
  const seenIds = [];
  const groupTitles = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const group = nextQuestionGroup(answers);
    if (!group) break;
    groupTitles.push(group.title);
    assert.ok(group.questions.length >= 1, `${group.title} must carry at least one question`);
    for (const q of group.questions) {
      seenIds.push(q.id);
      answers = { ...answers, [q.id]: q.kind === "multi_select" ? [q.options[0].value] : q.kind === "single_select" ? q.options[0].value : "Sales lead at a SaaS startup; I run and cook" };
    }
  }
  assert.deepEqual(seenIds, ["avatar_style", "profession", "workday", "work_context", "work_lives", "watch_first"]);
  assert.equal(groupTitles.length, 3, "the five manual questions plus avatar_style batch into exactly three screens");
  assert.equal(nextQuestion(answers), null, "nextQuestion must agree the flow is complete once every group is committed");
  assert.ok(isComplete(answers));
});

test("typing a known animal into the companion-name question resolves a real style; anything else keeps the current one", async () => {
  // AP-021 honesty: Bridge can only ever RENDER the 16 real, hand-drawn
  // styles, so a typed word that doesn't match one of them must not be
  // silently accepted as if it would change the look.
  const { resolveAvatarStyleFromText } = await loadQuestionsModule();
  assert.equal(resolveAvatarStyleFromText("Rex the Fox"), "fox");
  assert.equal(resolveAvatarStyleFromText("owl"), "owl");
  assert.equal(resolveAvatarStyleFromText("OWL"), "owl", "matching is case-insensitive");
  assert.equal(resolveAvatarStyleFromText("Foxglove"), undefined, "must match a WHOLE word, not a substring");
  assert.equal(resolveAvatarStyleFromText("Luna"), undefined, "a plain name with no recognized animal resolves to nothing");
});

test("dialog overlay forwards the Radix Presence ref", async () => {
  const source = await readFile(uiDialogUrl, "utf8");
  assert.match(source, /const DialogOverlay = React\.forwardRef</);
  assert.match(source, /<DialogPrimitive\.Overlay\s+ref=\{ref\}/);
});

test("onboarding persists the Organization name and refreshes the shell", async () => {
  const [dialog, layout, settings] = await Promise.all([
    readFile(dialogUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(settingsUrl, "utf8"),
  ]);
  // E3 (2026-08-05): the Organization name is no longer a question. An explicit
  // answer still wins; otherwise it is DEFAULTED from the signed-in email.
  assert.match(dialog, /answers\.organization_name/);
  assert.match(dialog, /defaultOrganizationName\(userEmail\)/);
  assert.match(layout, /userEmail: auth\.session\.user\.email/);
  assert.match(dialog, /trpc\.organization\.rename\.mutate/);
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
  // ADR-154 — the installed-Module predicate moved to IntelligencePage with the
  // capability inventory; Settings no longer carries a Capabilities section.
  const intelligence = await readFile(intelligenceUrl, "utf8");
  assert.match(intelligence, /row\.manifest\.module !== undefined/);
  assert.match(intelligence, /row\.moduleAttachment === undefined/);
  assert.doesNotMatch(settings, /IntelligenceSection/);
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
  // ADR-154 — every installed Module stays clickable through to manifest-driven
  // Module Detail, now from the Intelligence page's provenance badge.
  const intelligence = await readFile(intelligenceUrl, "utf8");
  assert.match(intelligence, /to=\{`\/module\/\$\{encodeURIComponent\(source\.moduleName\)\}`\}/);
  assert.doesNotMatch(commonsPanel, /Commons module/);
});
