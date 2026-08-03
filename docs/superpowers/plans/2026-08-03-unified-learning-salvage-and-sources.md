# Unified Learning Capability — Plan 1: Salvage + Sources

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the deleted recon connectors as `SourceConnector`s behind the existing `@bridge/sourcing` waterfall, so the Learning Agent gains one green `sources` tool instead of 35 ad-hoc fetches.

**Architecture:** One generic adapter wraps any recon enricher function into a `SourceConnector`, mapping `SourceQuery` → recon's `ReportCtx` and recon's `SourceContribution` → `CaptureEnvelope[]`. Nothing writes to the graph — envelopes ride the existing intake seam. The PII guard is restored before any salvage lands.

**Tech Stack:** TypeScript ESM monorepo, pnpm workspaces + turbo, node built-in test runner over compiled `dist/`, `@bridge/sourcing` / `@bridge/dedupe` / `@bridge/core`.

---

## Scope decomposition

The design spec ([2026-08-03-unified-learning-capability-design.md](../specs/2026-08-03-unified-learning-capability-design.md)) covers three independent subsystems. Each produces working, testable software on its own, so each gets its own plan:

| Plan | Scope | Spec steps | Status |
|---|---|---|---|
| **1 — Salvage + Sources** (this document) | PII guard, recon connector adapter, `sources` tool | 1–2 | written |
| 2 — Capture | Chrome extension restore, `registerLiveProvider("linkedin")`, `CaptureEnvelope` → `pipeline.propose` | 3 | after Plan 1 lands |
| 3 — Readers + Delegation | Domain policy table, `cloak-reader`, D1 visibility rule, D2 delegation contract, Context.dev | 4–6 | after Plan 2 lands |

Plan 1 is written in full below. Plans 2 and 3 are deliberately not written yet — Plan 2's extension work depends on the envelope shape Plan 1 settles, and writing it now would mean inventing that shape twice.

## Prerequisites

- [ ] **Step 0: Sync with `origin/main`**

This branch is behind. Everything below assumes `origin/main` state.

```bash
git fetch origin && git merge origin/main
```

Expected: fast-forward or a clean additive merge. If `docs/log.md` or `docs/wiki/index.md` conflict, both sides are additive — keep both.

## File structure

| File | Responsibility |
|---|---|
| `scripts/check-no-pii.sh` | Restored pre-commit guard. Blocks committing real names/emails |
| `platform/packages/sourcing/src/connectors/recon-adapter.ts` | The one adapter: recon enricher → `SourceConnector` |
| `platform/packages/sourcing/src/connectors/recon-enrichers.ts` | Ported enricher functions + their shared fetch helpers |
| `platform/packages/sourcing/test/recon-adapter.test.ts` | Adapter contract tests (no network) |
| `platform/packages/sourcing/src/index.ts` | Add the two new exports |

Salvage source: `.recon-salvage-2026-08-03/lib/recon.ts` (untracked, 3148 lines), or `git show 41d3b37^:Tools/recon/lib/recon.ts`.

---

### Task 1: Restore the PII guard

Capture is coming back. The guard that `41d3b37` deleted goes back first.

**Files:**
- Create: `scripts/check-no-pii.sh` (recover from `41d3b37^`)
- Modify: `.githooks/pre-commit`

- [ ] **Step 1: Recover the script and read it**

```bash
git show 41d3b37^:scripts/check-no-pii.sh > scripts/check-no-pii.sh
chmod +x scripts/check-no-pii.sh
cat scripts/check-no-pii.sh
```

Expected: a 35-line shell script. Read it before trusting it — confirm what patterns it matches and that it exits non-zero on a hit.

- [ ] **Step 2: Verify it fails on a planted PII string**

```bash
printf 'contact: jane.doe@example.com\n' > /tmp/pii-probe.txt
sh scripts/check-no-pii.sh /tmp/pii-probe.txt; echo "exit=$?"
```

Expected: non-zero exit. If it exits 0, the script's matcher does not cover emails — fix the matcher before continuing, because the whole point of this task is that it actually blocks.

- [ ] **Step 3: Verify it passes on a clean file**

```bash
printf 'no personal data here\n' > /tmp/clean-probe.txt
sh scripts/check-no-pii.sh /tmp/clean-probe.txt; echo "exit=$?"
rm -f /tmp/pii-probe.txt /tmp/clean-probe.txt
```

Expected: `exit=0`.

- [ ] **Step 4: Re-wire the pre-commit hook**

```bash
git show 41d3b37^:.githooks/pre-commit | diff - .githooks/pre-commit || true
```

Read the diff, then add back only the `check-no-pii.sh` invocation line into the current `.githooks/pre-commit`. Do not restore the whole old hook — it references other deleted scripts.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-no-pii.sh .githooks/pre-commit
git commit -m "Restore the PII pre-commit guard deleted in 41d3b37"
```

---

### Task 2: The recon connector adapter

One adapter for all 35 enrichers. Written test-first against the real `SourceConnector` contract.

**Files:**
- Create: `platform/packages/sourcing/src/connectors/recon-adapter.ts`
- Test: `platform/packages/sourcing/test/recon-adapter.test.ts`

Recon's enricher shape, verified from the salvage:

```ts
type SourceContribution = {
  source: string;
  personFields: Field[];
  companyFields: Field[];
  signals: Field[];
  steps: StepLog[];
};
type Field = {
  label: string; value: string; tier: 'A' | 'B' | 'C';
  source: string; url?: string; kind?: 'fact' | 'signal';
};
```

- [ ] **Step 1: Write the failing test**

Create `platform/packages/sourcing/test/recon-adapter.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReconConnector } from "../src/connectors/recon-adapter.js";
import type { SourceQuery } from "../src/types.js";

const query: SourceQuery = { kind: "person", hints: { name: "Ada Lovelace", company: "Analytical Engines" } };

test("maps a SourceContribution into one envelope per field", async () => {
  const connector = createReconConnector({
    id: "recon.finra",
    costUnits: 1,
    enrich: async () => ({
      source: "FINRA",
      personFields: [{ label: "FINRA registered", value: "Ada Lovelace (CRD 1)", tier: "A", source: "FINRA", url: "https://example.test/1" }],
      companyFields: [],
      signals: [],
      steps: [],
    }),
  });

  const envelopes = await connector.fetch(query);

  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].sourceConnectorId, "recon.finra");
  assert.equal(envelopes[0].tier, "free");
  assert.equal(envelopes[0].payload.label, "FINRA registered");
  assert.equal(envelopes[0].payload.url, "https://example.test/1");
});

test("tags every envelope untrusted_external", async () => {
  const connector = createReconConnector({
    id: "recon.news",
    costUnits: 1,
    enrich: async () => ({
      source: "News", personFields: [{ label: "Headline", value: "x", tier: "C", source: "GDELT" }],
      companyFields: [], signals: [], steps: [],
    }),
  });

  const [envelope] = await connector.fetch(query);
  assert.equal(envelope.taintLabel, "untrusted_external");
});

test("maps recon tier A/B/C onto a confidence the intake seam can re-score", async () => {
  const mk = (tier: "A" | "B" | "C") =>
    createReconConnector({
      id: "recon.t", costUnits: 1,
      enrich: async () => ({
        source: "S", personFields: [{ label: "l", value: "v", tier, source: "S" }],
        companyFields: [], signals: [], steps: [],
      }),
    }).fetch(query);

  assert.equal((await mk("A"))[0].confidence, 0.9);
  assert.equal((await mk("B"))[0].confidence, 0.6);
  assert.equal((await mk("C"))[0].confidence, 0.3);
});

test("marks signal fields so intake can route them to a Signal", async () => {
  const connector = createReconConnector({
    id: "recon.courtlistener", costUnits: 1,
    enrich: async () => ({
      source: "CourtListener", personFields: [], companyFields: [],
      signals: [{ label: "Litigation", value: "Case 1", tier: "A", source: "CourtListener", kind: "signal" }],
      steps: [],
    }),
  });

  const [envelope] = await connector.fetch(query);
  assert.equal(envelope.payload.kind, "signal");
});

test("a throwing enricher yields no envelopes and never rejects", async () => {
  const connector = createReconConnector({
    id: "recon.flaky", costUnits: 1,
    enrich: async () => { throw new Error("upstream 503"); },
  });

  assert.deepEqual(await connector.fetch(query), []);
});

test("estimateCost reports the declared cost", () => {
  const connector = createReconConnector({ id: "recon.x", costUnits: 3, enrich: async () => ({ source: "x", personFields: [], companyFields: [], signals: [], steps: [] }) });
  assert.equal(connector.estimateCost(query), 3);
});
```

The last-but-one test encodes recon's rule that a source failure is logged, never fatal.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

Expected: build FAILS — `Cannot find module '../src/connectors/recon-adapter.js'`.

- [ ] **Step 3: Write the adapter**

Create `platform/packages/sourcing/src/connectors/recon-adapter.ts`:

```ts
// Wraps a recon enricher (salvaged from Tools/recon/lib/recon.ts, deleted in 41d3b37)
// into the SourceConnector port. One adapter serves all 35 enrichers: the enrichers
// stay dumb fetch-and-shape functions, and every policy concern — taint, cost,
// failure isolation — lives here, once.

import type { CaptureEnvelope, SourceConnector, SourceQuery } from "../types.js";

/** A recon report field. Mirrors Tools/recon/lib/recon.ts `Field`. */
export interface ReconField {
  label: string;
  value: string;
  tier: "A" | "B" | "C";
  source: string;
  url?: string;
  kind?: "fact" | "signal";
}

/** What a recon enricher returns. Mirrors recon's `SourceContribution`. */
export interface ReconContribution {
  source: string;
  personFields: ReconField[];
  companyFields: ReconField[];
  signals: ReconField[];
  steps: unknown[];
}

export interface ReconConnectorConfig {
  id: string;
  costUnits: number;
  enrich(query: SourceQuery): Promise<ReconContribution>;
}

/** Recon's analyst tiers become a connector-side confidence. The intake seam
 *  re-scores independently — this is the connector's own estimate, nothing more. */
const CONFIDENCE_BY_TIER = { A: 0.9, B: 0.6, C: 0.3 } as const;

export function createReconConnector(config: ReconConnectorConfig): SourceConnector {
  return {
    id: config.id,
    tier: "free",
    estimateCost: () => config.costUnits,
    async fetch(query: SourceQuery): Promise<CaptureEnvelope[]> {
      let contribution: ReconContribution;
      try {
        contribution = await config.enrich(query);
      } catch {
        // Recon's rule: a source failure is logged, never fatal. One dead upstream
        // must not abort a waterfall that has 34 other connectors to run.
        return [];
      }

      const capturedAt = new Date().toISOString();
      const fields = [...contribution.personFields, ...contribution.companyFields, ...contribution.signals];

      return fields.map((field) => ({
        sourceConnectorId: config.id,
        tier: "free" as const,
        query,
        payload: {
          label: field.label,
          value: field.value,
          source: field.source,
          ...(field.url ? { url: field.url } : {}),
          ...(field.kind ? { kind: field.kind } : {}),
        },
        confidence: CONFIDENCE_BY_TIER[field.tier],
        costUnits: config.costUnits,
        capturedAt,
        // Every recon source is an external fetch. No exceptions, no per-source override.
        taintLabel: "untrusted_external" as const,
      }));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

Expected: 6 tests PASS. If `taintLabel: "untrusted_external"` fails to typecheck, read the `TaintLabel` union in `@bridge/core` and use its exact member — do not widen the type to `string`.

- [ ] **Step 5: Export from the package index**

Modify `platform/packages/sourcing/src/index.ts`, adding after the existing connector exports:

```ts
export type { ReconField, ReconContribution, ReconConnectorConfig } from "./connectors/recon-adapter.js";
export { createReconConnector } from "./connectors/recon-adapter.js";
```

- [ ] **Step 6: Typecheck the whole monorepo**

```bash
cd platform && pnpm typecheck
```

Expected: PASS. A fresh worktree may emit unrelated pre-existing noise — compare against `git stash && pnpm typecheck` output if unsure whether a failure is yours.

- [ ] **Step 7: Commit**

```bash
git add platform/packages/sourcing/src/connectors/recon-adapter.ts platform/packages/sourcing/src/index.ts platform/packages/sourcing/test/recon-adapter.test.ts
git commit -m "Add the recon enricher -> SourceConnector adapter"
```

---

### Task 3: Port the first three enrichers

Three, not 35 — they prove the three distinct shapes (keyless JSON API, cached bulk list, name-disambiguating). The remaining 32 follow the same pattern in Task 5.

**Files:**
- Create: `platform/packages/sourcing/src/connectors/recon-enrichers.ts`
- Test: `platform/packages/sourcing/test/recon-enrichers.test.ts`

- [ ] **Step 1: Read the three source enrichers before porting**

```bash
sed -n '1365,1442p' .recon-salvage-2026-08-03/lib/recon.ts   # finraEnrich
sed -n '1442,1481p' .recon-salvage-2026-08-03/lib/recon.ts   # openAlexEnrich
sed -n '2022,2073p' .recon-salvage-2026-08-03/lib/recon.ts   # ofacEnrich
```

`finraEnrich` carries the namesake-disambiguation logic (`nameMatchScore` + `affiliationCorroborates`) that exists because a name-only match once attached another person's disclosures to a subject. Port that logic intact — it is the reason this file is worth salvaging rather than rewriting.

- [ ] **Step 2: Write the failing test**

Create `platform/packages/sourcing/test/recon-enrichers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchScore, affiliationCorroborates } from "../src/connectors/recon-enrichers.js";

test("nameMatchScore is 1 for an exact normalized match", () => {
  assert.equal(nameMatchScore("Ada Lovelace", "ada  lovelace"), 1);
});

test("nameMatchScore is below the namesake floor for a different person", () => {
  assert.ok(nameMatchScore("Ada Lovelace", "Charles Babbage") < 0.5);
});

test("affiliationCorroborates confirms on a shared employer", () => {
  assert.equal(affiliationCorroborates({ company: "Analytical Engines" }, "Analytical Engines LLC"), "confirm");
});

test("affiliationCorroborates conflicts on a different employer", () => {
  assert.equal(affiliationCorroborates({ company: "Analytical Engines" }, "Difference Engine Corp"), "conflict");
});

test("affiliationCorroborates is unknown when there is no employer to compare", () => {
  assert.equal(affiliationCorroborates({ company: "Analytical Engines" }, ""), "unknown");
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

Expected: build FAILS — module not found.

- [ ] **Step 4: Port the helpers and the three enrichers**

Create `platform/packages/sourcing/src/connectors/recon-enrichers.ts`. Copy `norm`, `nameMatchScore`, `affiliationCorroborates`, `fetchJSON`, `finraEnrich`, `openAlexEnrich`, `ofacEnrich`, `parseSdn`, `loadSdn` from the salvage. Export `nameMatchScore` and `affiliationCorroborates` (the test needs them; they are also the reusable part).

Two required changes during the port:
1. Replace recon's `fetchJSON` with a call through `@bridge/net-guard` — do not port `ssrf.ts`. Task 4 verifies this.
2. `loadSdn` cached to `data/ofac-sdn.json`; point it at the platform's cache directory rather than a repo-relative path, and never commit the cache.

- [ ] **Step 5: Run to verify it passes**

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

Expected: 11 tests PASS (6 adapter + 5 enricher).

- [ ] **Step 6: Commit**

```bash
git add platform/packages/sourcing/src/connectors/recon-enrichers.ts platform/packages/sourcing/test/recon-enrichers.test.ts
git commit -m "Port FINRA, OpenAlex, and OFAC enrichers with namesake disambiguation"
```

---

### Task 4: Prove net-guard replaces recon's SSRF client

**Files:**
- Test: `platform/packages/sourcing/test/recon-ssrf.test.ts`
- Reference: `.recon-salvage-2026-08-03/test/ssrf.test.ts`

- [ ] **Step 1: Read both guards side by side**

```bash
cat .recon-salvage-2026-08-03/lib/ssrf.ts
cat .recon-salvage-2026-08-03/test/ssrf.test.ts
git show origin/main:platform/packages/net-guard/src/index.ts
```

- [ ] **Step 2: Port recon's SSRF tests against net-guard**

Create `platform/packages/sourcing/test/recon-ssrf.test.ts` with recon's cases rewritten to call net-guard's exported guard. At minimum: RFC-1918 blocked, link-local blocked, cloud metadata IP (`169.254.169.254`) blocked, non-http(s) scheme rejected, redirect to a blocked host rejected.

- [ ] **Step 3: Run the tests**

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

Expected: PASS. **If any case fails, net-guard has a real gap** — fix net-guard rather than reintroducing recon's `ssrf.ts`. A failure here is a finding, not a blocker to route around.

- [ ] **Step 4: Commit**

```bash
git add platform/packages/sourcing/test/recon-ssrf.test.ts
git commit -m "Prove net-guard covers recon's SSRF cases"
```

---

### Task 5: Port the remaining 32 enrichers

Mechanical once Tasks 2–4 land. Do them in source-family batches, committing per batch so a bad port is easy to isolate.

**Files:** `platform/packages/sourcing/src/connectors/recon-enrichers.ts` (extend), plus one test per batch.

- [ ] **Step 1: Registries batch** — `secEdgarEnrich`, `secAdvEnrich`, `secXbrlRevenueEnrich`, `gleifEnrich`, `usaspendingEnrich`, `courtlistenerEnrich`, `propublica990Enrich`. Commit: `"Port registry enrichers"`
- [ ] **Step 2: Academic batch** — `openAlexEnrich` (done), `orcidEnrich`, `semanticScholarEnrich`. Commit: `"Port academic enrichers"`
- [ ] **Step 3: Social batch** — `blueskyEnrich`, `mastodonEnrich`, `socialMentionsEnrich`, `usernameEnrich`, `socialSearcherEnrich`. Commit: `"Port social enrichers"`
- [ ] **Step 4: Company batch** — `jsonldEnrich`, `webFootprintEnrich`, `companyTeamEnrich`, `hiringEnrich`, `detectTech`, `emailInferEnrich`. Commit: `"Port company enrichers"`
- [ ] **Step 5: Risk batch** — `ofacEnrich` (done), `hibpEnrich`, `alephEnrich`, `interpolEnrich`. Commit: `"Port risk enrichers"`
- [ ] **Step 6: Economics batch** — `privateRevenueModelEnrich`, `gpFundEconomicsEnrich`, `founderEconomicsEnrich`, `blsOewsSalaryEnrich`, `dolOflcSalaryEnrich`. These emit banded estimates with provenance; assert in tests that no point number is ever produced. Commit: `"Port economics models"`
- [ ] **Step 7: Discovery batch** — `wikidataEnrich`, `githubEnrich`, `newsEnrich`, `stateSosEnrich`, `uccEnrich`, `verifiedDeepLinks`. Deep-link sources emit "unverified pointer" fields, never fabricated facts — assert that. Commit: `"Port discovery enrichers"`

After each batch:

```bash
cd platform && pnpm -F @bridge/sourcing build && pnpm -F @bridge/sourcing test
```

---

### Task 6: Move identity resolution into `@bridge/dedupe`

`platform/packages/dedupe/src/types.ts` already cites recon's match governance as its origin. This task makes that real instead of aspirational.

**Files:**
- Modify: `platform/packages/dedupe/src/match.ts`
- Test: `platform/packages/dedupe/test/recon-resolution.test.ts`

- [ ] **Step 1: Read the existing dedupe matcher and recon's resolver**

```bash
git show origin/main:platform/packages/dedupe/src/match.ts
sed -n '2627,2760p' .recon-salvage-2026-08-03/lib/recon.ts   # resolveIdentities, foldInto, idKeys, mergeCandidates
```

- [ ] **Step 2: Write the failing test**

Create `platform/packages/dedupe/test/recon-resolution.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCandidates } from "../src/match.js";

test("collapses two candidates that share a strong identifier", () => {
  const merged = mergeCandidates([
    { id: "a", name: "Ada Lovelace", identifiers: { githubLogin: "ada" }, sources: ["GitHub"] },
    { id: "b", name: "A. Lovelace", identifiers: { githubLogin: "ada" }, sources: ["Wikidata"] },
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ["GitHub", "Wikidata"]);
});

test("keeps two same-name candidates apart when no identifier is shared", () => {
  const merged = mergeCandidates([
    { id: "a", name: "John Smith", identifiers: { domain: "acme.test" }, sources: ["JSON-LD"] },
    { id: "b", name: "John Smith", identifiers: { domain: "other.test" }, sources: ["JSON-LD"] },
  ]);

  assert.equal(merged.length, 2);
});
```

The second test is the namesake guard at the resolution layer — the same class of bug `finraEnrich` guards at the source layer.

- [ ] **Step 3: Run to verify it fails**

```bash
cd platform && pnpm -F @bridge/dedupe build && pnpm -F @bridge/dedupe test
```

Expected: FAIL — `mergeCandidates` is not exported.

- [ ] **Step 4: Port `mergeCandidates`, `foldInto`, and `idKeys` into `match.ts`, reusing the existing `MatchTier` and `DEFAULT_THRESHOLDS`** rather than recon's own constants. Export `mergeCandidates`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd platform && pnpm -F @bridge/dedupe build && pnpm -F @bridge/dedupe test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/packages/dedupe/src/match.ts platform/packages/dedupe/test/recon-resolution.test.ts
git commit -m "Move recon identity resolution into @bridge/dedupe"
```

---

### Task 7: Wire the `sources` green tool

**Files:**
- Modify: `platform/packages/research/src/ports.ts`
- Modify: `platform/packages/research/src/engine.ts`
- Test: `platform/packages/research/test/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `platform/packages/research/test/engine.test.ts`:

```ts
test("sources is a green tool and runs without a Proposal", async () => {
  const step = { tool: "sources" as const, argument: "Ada Lovelace", rationale: "resolve the subject" };
  assert.equal(authorityFor(step), "green");
});
```

Match the existing file's import style and the real name of its authority helper — read the file first; do not assume `authorityFor`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd platform && pnpm -F @bridge/research build && pnpm -F @bridge/research test
```

Expected: FAIL — `"sources"` is not in `ResearchToolName`.

- [ ] **Step 3: Add the tool**

In `platform/packages/research/src/ports.ts`, extend the union:

```ts
export type ResearchToolName =
  | "search"
  | "read"
  | "find"
  | "click"
  | "type"
  | "note"
  | "sources";
```

Add the port:

```ts
/** Keyless connector waterfall over @bridge/sourcing. Read-only, always green. */
export interface ResearchSources {
  lookup(query: SourceQuery): Promise<readonly CaptureEnvelope[]>;
}
```

In `engine.ts`, add `"sources"` to the green tier alongside `search`/`read`/`find`/`note`. Do **not** add it to amber or red.

- [ ] **Step 4: Run to verify it passes**

```bash
cd platform && pnpm -F @bridge/research build && pnpm -F @bridge/research test
```

Expected: all research tests PASS, including the existing 31.

- [ ] **Step 5: Full monorepo check**

```bash
cd platform && pnpm typecheck && pnpm test && pnpm lint
cd .. && pnpm --dir platform check:no-dummy-runtime
```

Expected: PASS. Note `check:vocabulary` is a known-red gate on main (TASK-028 evidence) — a failure there is pre-existing, not yours. Confirm by running it on a clean checkout before dismissing it.

- [ ] **Step 6: Commit**

```bash
git add platform/packages/research/src/ports.ts platform/packages/research/src/engine.ts platform/packages/research/test/engine.test.ts
git commit -m "Add the sources green tool to the research engine"
```

---

### Task 8: Governance records

**Files:**
- Modify: `docs/raw/decisions-log.md`, `docs/wiki/decisions.md`, `docs/TASKS.md`, `docs/log.md`

- [ ] **Step 1: Assign ADR numbers before writing**

```bash
grep -o 'ADR-[0-9]\+' docs/raw/decisions-log.md | sort -V | tail -1
```

Take the next three numbers. Assign them **now**, in this step — parallel agents each pick the same "next" number otherwise.

- [ ] **Step 2: Append the three ADRs to `docs/raw/decisions-log.md`**, each with rationale, rejected alternatives, and consequences:
  1. Recon salvage as connectors behind `@bridge/sourcing`; rejected: wholesale Module restore (keeps a second store and scheduler), connectors-only (discards tuned breaker logic)
  2. Provider tiering extension — Context.dev Tier 2; CloakBrowser / Coasty / Rindler Tier 3; WUPHF / Prized / LemonLime reference-only, license or residency barred
  3. `sources` as a green tool — read-only over keyless public sources, so it cannot reach amber

- [ ] **Step 3: Add one-line strategic entries to `docs/wiki/decisions.md`** for ADRs 2 and 3. ADR 1 is implementation detail; leave it in raw only.

- [ ] **Step 4: Add the TASK row to `docs/TASKS.md`** with an independent exit test: *a person query returns cited envelopes from at least three distinct live sources, every envelope tagged `untrusted_external`, and a namesake with a conflicting employer produces zero FINRA fields.*

- [ ] **Step 5: Append the log entry to `docs/log.md`.**

- [ ] **Step 6: Commit**

```bash
git add docs/raw/decisions-log.md docs/wiki/decisions.md docs/TASKS.md docs/log.md
git commit -m "Record ADRs, task, and log for the Learning capability salvage"
```

---

## Self-review

**Spec coverage (Plan 1 scope only):** PII guard → Task 1. Connector migration → Tasks 2, 3, 5. `ssrf.ts` vs net-guard → Task 4. Identity resolution + tiering → Tasks 3, 6. `sources` green tool → Task 7. SearXNG adapter and Context.dev → **deferred to Plan 3** (both are `ResearchSearch` adapters and belong with the reader-tier work, not the connector work). Governance records → Task 8.

**Type consistency:** `createReconConnector` / `ReconContribution` / `ReconField` used identically in Tasks 2, 3, 5. `mergeCandidates` named identically in Task 6 test and implementation. `SourceQuery` and `CaptureEnvelope` are the real exports from `@bridge/sourcing`, read from `origin/main`, not invented.

**Known soft spots, flagged rather than hidden:**
- Task 3 Step 4 and Task 5 say "copy from the salvage" without reproducing 3,000 lines inline. That is deliberate — the salvage file is the source of truth and reproducing it here would create a second copy that drifts. Every task names the exact line range to read.
- Task 7 Step 1 tells the implementer to read the real authority-helper name rather than trusting `authorityFor`. I did not verify that symbol.
