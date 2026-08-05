/**
 * Source contracts for the Automation-drafts editor and Retrieval-quality
 * cards (ADR-172/173/174):
 *  - both cards are flight-gated: they render NOTHING while the flight is
 *    off, still resolving, or the API is unreachable (no dead controls);
 *  - the draft editor states the inert-draft contract ("never runs"),
 *    disables Activate on an empty draft, and surfaces server refusals
 *    verbatim instead of swallowing them;
 *  - the retrieval card carries the honest metric label — self-retrieval
 *    consistency, explicitly NOT human-judged relevance — even when the
 *    API's own metricNote has not loaded;
 *  - both cards mount in the Learning section beside ObservedLearningCard.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsUrl = new URL("../src/app/pages/SettingsPage.tsx", import.meta.url);

test("learning cards: flight gates, draft governance copy, honest metric label, mounting", async () => {
  const source = await readFile(settingsUrl, "utf8");

  const draftsCard = source.slice(source.indexOf("function AutomationDraftsCard"), source.indexOf("function RetrievalQualityCard"));
  const qualityCard = source.slice(source.indexOf("function RetrievalQualityCard"), source.indexOf("function SectionHeader"));
  assert.ok(draftsCard.length > 0 && qualityCard.length > 0, "both cards must exist in SettingsPage");

  // Flight gate: null unless enabled === true; unreachable API treated as off.
  for (const [name, card] of [["AutomationDraftsCard", draftsCard], ["RetrievalQualityCard", qualityCard]]) {
    assert.match(card, /if \(enabled !== true\) return null;/, `${name} must render nothing while off/resolving`);
    assert.match(card, /\.catch\(\(\) => setEnabled\(false\)\)/, `${name} must treat an unreachable API as off`);
  }
  // The drafts card gates on the learning flight; the quality card on the
  // retrieval-fusion flight — separate flights, separate honest gates.
  assert.match(draftsCard, /trpc\.learning\.status\s*\n?\s*\.query/);
  assert.match(qualityCard, /trpc\.learning\.retrieval\.status\s*\n?\s*\.query/);

  // Draft governance: the inert-draft contract is stated to the user, an
  // empty draft cannot be activated from the UI, and activation asks first.
  assert.match(draftsCard, /A draft never runs/);
  assert.match(draftsCard, /disabled=\{draft\.steps\.length === 0\}/);
  assert.match(draftsCard, /window\.confirm\("Activate this Automation\?/);
  // Server refusals (unknown skill, no steps) surface verbatim — never swallowed.
  const surfacedErrors = draftsCard.match(/setMessage\(String\(error\)\)/g) ?? [];
  assert.ok(surfacedErrors.length >= 2, "update and activate must surface typed server refusals");
  // Step editing goes through the governed update mutation, nothing client-invented.
  assert.match(draftsCard, /trpc\.learning\.promotions\.drafts\.update\.mutate/);
  assert.match(draftsCard, /trpc\.learning\.promotions\.drafts\.activate\.mutate/);

  // Honest metric label: the API's own note renders, and the fallback copy
  // makes the same disclaimer when the note has not loaded — the card can
  // never show numbers without the self-retrieval caveat.
  assert.match(qualityCard, /evals\?\.metricNote \?\?/);
  assert.match(qualityCard, /Not human-judged relevance/);
  assert.match(qualityCard, /self-retrieval cases/);

  // Both cards mount in the Learning section beside the observed-patterns card.
  const learningSection = source.slice(source.indexOf("function LearningSection"), source.indexOf("function OnboardingCard") === -1 ? source.indexOf("function ObservedLearningCard") : source.indexOf("function OnboardingCard"));
  assert.match(learningSection, /<ObservedLearningCard \/>/);
  assert.match(learningSection, /<AutomationDraftsCard \/>/);
  assert.match(learningSection, /<RetrievalQualityCard \/>/);
});
