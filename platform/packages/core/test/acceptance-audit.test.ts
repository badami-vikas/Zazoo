/**
 * K10 E2 (TASK-043) — the shown-text acceptance hash as an executable
 * obligation: an acceptance carrying the exact rendered text is stamped and
 * audits as REVIEWED; an acceptance without one (or with text that does not
 * match the canonical suggestion) still lands but audits as UNVERIFIED —
 * bulk rubber-stamping stops being indistinguishable from review.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMemoryStore } from "../src/memory/memory-store.js";
import { recordSignal } from "../src/learning/observation.js";
import {
  detectAutomationDraftCandidates,
  acceptAutomationDraft,
  listPromotionSuggestions,
  PROMOTION_MIN_REPETITIONS,
} from "../src/learning/promotion.js";
import {
  acceptanceStamp,
  auditAcceptances,
  hashShownText,
  readAcceptanceStamp,
} from "../src/learning/acceptance-audit.js";

const ORG = "org-e2";
const USER = "user-e2";
const SCOPE = { organizationId: ORG, userId: USER };
let n = 0;
const nextId = () => `id-${++n}`;

async function seedPromotion(store: InMemoryMemoryStore, attribute: string) {
  for (let i = 0; i < PROMOTION_MIN_REPETITIONS; i += 1) {
    await recordSignal(store, {
      id: nextId(),
      organizationId: ORG,
      ownerUserId: USER,
      moduleId: "dealpilot",
      recordKind: "deal",
      recordId: nextId(),
      action: "dismiss",
      attributes: { industry: attribute },
    });
  }
  const proposed = await detectAutomationDraftCandidates(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    nextId,
  });
  assert.equal(proposed.length, 1);
  return proposed[0]!;
}

test("stamp mechanics: matched, mismatched, absent", async () => {
  const canonical = "You have chosen X 6 times. Draft an Automation?";
  const matched = await acceptanceStamp(canonical, canonical);
  assert.ok(matched);
  assert.equal(matched.matchedCanonicalText, true);
  assert.equal(matched.shownTextHash, await hashShownText(canonical));

  const stale = await acceptanceStamp("an older wording the tab still showed", canonical);
  assert.ok(stale);
  assert.equal(stale.matchedCanonicalText, false);

  assert.equal(await acceptanceStamp(undefined, canonical), null);
  assert.equal(await acceptanceStamp("", canonical), null);
});

test("a stamped acceptance audits as REVIEWED; an unstamped one lands but audits as UNVERIFIED", async () => {
  const store = new InMemoryMemoryStore();

  // Reviewed: the client sends exactly what it rendered.
  const reviewed = await seedPromotion(store, "fintech");
  await acceptAutomationDraft(store, SCOPE, reviewed.memoryId, USER, nextId, reviewed.suggestedText);

  // Rubber-stamped: a scripted caller accepts without any shown text.
  const scripted = await seedPromotion(store, "biotech");
  await acceptAutomationDraft(store, SCOPE, scripted.memoryId, USER, nextId);

  // Stale-tab: the client shows text that no longer matches the canonical.
  const stale = await seedPromotion(store, "aerospace");
  await acceptAutomationDraft(store, SCOPE, stale.memoryId, USER, nextId, "outdated wording");

  const audit = await auditAcceptances(store, SCOPE);
  assert.equal(audit.reviewed, 1);
  assert.equal(audit.unverified, 2);
  const byReason = new Map(audit.rows.filter((row) => row.reason).map((row) => [row.reason, row]));
  assert.ok(byReason.has("no_stamp"));
  assert.ok(byReason.has("text_mismatch"));

  // The stamp itself lives on the accepted lineage head, readable in place.
  const accepted = await listPromotionSuggestions(store, SCOPE, "dealpilot", "accepted");
  assert.equal(accepted.length, 3);
  const heads = await Promise.all(
    accepted.map(async (row) => JSON.parse((await store.get(row.memoryId, SCOPE))!.content) as Record<string, unknown>),
  );
  const stamps = heads.map((content) => readAcceptanceStamp(content));
  assert.equal(stamps.filter((stamp) => stamp?.matchedCanonicalText).length, 1);
  assert.equal(stamps.filter((stamp) => stamp === null).length, 1);
});
