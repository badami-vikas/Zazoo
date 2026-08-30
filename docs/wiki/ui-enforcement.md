# UI enforcement — how a rule stops being advisory

Rules: [`../raw/ui-rulebook.md`](../raw/ui-rulebook.md). This page is **how they bind**.

**The failure this exists to prevent** (rulebook §10): the UI rules once lived only in prose. Nothing
in the build failed when a page ignored them, so every new surface quietly reinvented the shell — 5 of
21 pages conformant, two competing toolbars. *A rule binds when a test fails. Prose cannot fail.*

## Four layers, one implementation each

| Layer | Mechanism | Fires | Covers |
|---|---|---|---|
| **Agent** | `.claude/settings.json` PostToolUse hook | the moment a `.tsx`/`.ts` under `apps/web/src` is edited | counted rules |
| **Commit** | `.githooks/pre-commit` (tracked) | `git commit` touching UI files or the rulebook | secrets/PII + counted rules |
| **Build** | `pnpm check:ui-rules` inside `pnpm verify` | locally and in CI | counted rules + doc gates |
| **Test** | `apps/web/test/ui-conformance.test.mjs` | `turbo run test` | structural rules |

The first three run **the same script**. One rule, one implementation, three moments — an agent-level
check that drifts from the CI check is worse than no agent-level check.

## Structural rules — `ui-conformance.test.mjs` (15 tests)

Things a regex over one file cannot judge: which shell a page uses, whether right-click opens the same
menu as the caret, whether a control's existence is conditional on a prop. Highlights: every data-shape
page renders `ModuleSurfaceLayout` + `DataViews` or sits in `EXEMPT` **with a written reason**; no page
re-implements a standardized primitive; a **ratchet of pre-existing divergences that may only shrink**
(a fixed entry left in the list also fails); the add-row is present-and-disabled rather than absent;
Second Brain has exactly one entry point; the insights row is one component.

**Added 2026-08-30**: every data-shape page carries a **Governance Section directly below
Intelligence**, and its empty state must say *an empty policy is not a default-deny*. Both shipped at 14
call sites and were ungated — which is precisely how the Second Brain rail entry drifted back.

## Counted rules — `platform/scripts/check-ui-rules.mjs`

Eight rules that are counted rather than structural, each naming the rulebook section it enforces:
`hardcoded-hex` · `raw-tailwind-gray` · `sub-12px-type` · `vh-not-dvh` · `native-dialog` ·
`bare-select` · `absolute-menu` · `overscroll-contain`.

**Ratchet, not hard fail.** A count that goes **up** fails: you introduced a violation. A count that
goes **down** *also* fails, asking you to record the fix — an unrecorded fix can silently regress. The
baseline is `platform/scripts/ui-rules-baseline.json`; after a genuine fix run
`node scripts/check-ui-rules.mjs --update`.

Ratchets exist because **395 violations predate the rules** (334 hardcoded hexes, 29 sub-12px sizes, 17
native dialogs, 10 `vh`, 2 `absolute top-full`, 2 bare `<select>`, 1 `overscroll-contain`). A hard fail
would make the gate unrunnable on day one, and an unrunnable gate gets deleted. The debt is now
*counted and frozen*, which is the difference between known and forgotten.

## Doc gates — hard failures, no baseline

Invariants true **today** that must never regress by one: `one-canonical-rulebook` (the four retired
canons stay stubs and may not regrow rules) · `no-module-yaml` (CLAUDE.md may not name a file that has
never existed) · `no-live-module-detail` (no rule may direct a reader to the deleted surface — a line
may *name* it to record that it is gone, which is what stops the references being re-added).

## Governance policy — the engine layer

Distinct from the gates above, which police the code. `module.governance` `allow`/`deny` declares what
a Module **may do**, engine-read via `governanceVerdict`/`assertModuleGovernance` (deny always wins,
segment-prefix matching). Today: **one enforcing call site, one Module of thirteen declaring a policy.**
ADR-248 was explicit that "the exit test is enforcement, not rendering", so this is the thinnest layer
and TASK-088 is what thickens it — moving the effective policy to an engine-held overlay keyed by
Organization + Module, which is what finally makes it editable.

## The gate's own gate

`scripts/check-ui-rules.test.mjs` — 4 tests, each **breaking a rule on purpose** and asserting the
detector fires: a new violation fails; an unrecorded fix fails; a stub that regrows into a second canon
fails; a clean tree passes. A checker nobody tests is a checker that silently stops checking.

Both new conformance gates were verified the same way — seen red with the Section removed and with the
empty-state copy changed, then green on restore. That pass **found a real defect in the gate itself**:
the first regex prefix-matched, so `<ModuleGovernanceSectionREMOVED` satisfied it. A tag boundary fixed
it. This is why CLAUDE.md says a test proves nothing until seen failing unfixed.

## Running it

```
cd platform && pnpm check:ui-rules          # counted rules + doc gates + their tests
cd platform/apps/web && node --test test/ui-conformance.test.mjs
cd platform && pnpm verify                  # everything, as CI runs it
git config core.hooksPath .githooks         # once per clone/worktree, to enable pre-commit
```

`core.hooksPath` already pointed at `.githooks`, but the directory had never been committed — so every
fresh clone and worktree had **no hook**, and commits needed `--no-verify`, which trains people to pass
that flag by reflex. The hook is tracked now.

## What is deliberately NOT enforced here

Judgement rules — Hick's Law, "a collapsed panel shows its finding", "familiar first". A regex that
claimed to check them would produce false confidence and false failures, and a gate that fires on
correct code is a gate people learn to ignore. Those stay reviewer-enforced and are tagged CANON rather
than GATED in the rulebook, so the distinction is visible rather than assumed.
