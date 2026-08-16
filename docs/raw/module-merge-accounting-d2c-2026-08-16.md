---
title: Merging Avilo and CV Naturals into Bridge as the Accounting and D2C Modules
type: raw
doc_kind: plan
status: active
companions: []
related_wiki: ../wiki/decisions.md
updated: 2026-08-16
tags: [modules, merge, governance, accounting, d2c, avilo, cvn]
---

# Merging Avilo and CV Naturals into Bridge

Plan of record for AP-148/149/150 and ADR-230/231/232. Stage 1 (this document plus the
canon edits it describes) is docs-only. Stages 2 and 3 are TASK-067 and TASK-068.

## 1. Directive

User directive, 2026-08-16, verbatim:

> Merge Avilo and CV Naturals as modules within relationship OS called Accounting and D2C
> respectively. Ensure all rules in avilo and CVN are added as rules within all modules and
> beyond of relationship OS and adhered to. If there are any conflicts, ask me explicitly for
> resolution.

Four conflicts were raised explicitly and resolved in the same session. Their resolutions are
recorded in §4.

## 2. What the three repositories actually are

All three carry the same `platform/{apps,modules,packages}` skeleton — Avilo and CV Naturals
are downstream of Bridge's shape, not independent inventions. The depth differs sharply.

| | Bridge (Relationship OS) | Avilo | CV Naturals |
|---|---|---|---|
| Modules | `dealpilot`, `jobpilot`, `whatsapp`, `manifests` | `avilo` | `orders`, `whatsapp` |
| Module contract | `@bridge/core` `ModuleManifest` — module.yaml, signed, Commons provenance, risk bands, capability needs, page/agent/automation bindings | `module-host` `BridgeModule` — id, title, tRPC router, `ModuleContext` | same `module-host` (dist only; no `src/` in the checkout) |
| Store | Postgres/Supabase (`packages/db`) + Local Plane | better-sqlite3 | better-sqlite3 |
| Desktop shell | Tauri | **Electron 43** | Tauri |
| Governance ledgers | TASKS · APPROVALS · BUGS · raw/decisions-log · wiki/decisions · log · dummy · CODEMAPS | `docs/decisions.md` + `docs/bugs.md` only — **no execution queue, no approval gate** | TASKS · APPROVALS · BUGS · raw/decisions-log · wiki/decisions · log |
| Id ranges in use | ADR 006–229 · TASK 001–066 · AP 001–147 | ADR 001–053 · BUG 001–047 | ADR 001–016 · TASK 001–040 |

Avilo's `platform/packages/module-host/src/contract.ts` was written in anticipation of exactly
this merge. Its header states the intent directly:

> What a Bridge module is, and what a host owes it. […] Avilo Advisory was built as an
> application: it decided its own port, its own storage locations, and mounted its own tRPC
> router at the root of its own server. None of those decisions survive being merged with a
> second module.

That is why this is a merge and not a rewrite.

## 3. Two module contracts, both kept

`ModuleManifest` (Bridge) and `BridgeModule` (module-host) are not competing designs for the
same job. They are different layers:

- `ModuleManifest` **declares** — identity, version, parent, risk band, capability needs,
  Commons provenance, page/agent/automation bindings, and (new, §6) the governance policy. It is
  data, parsed and validated at the `apps/api` seam.
- `BridgeModule` **runs** — a tRPC router plus a `ModuleContext` of absolute paths the host
  grants. It is code.

Accounting and D2C therefore acquire a `module.yaml` they did not previously have, and keep the
`module-host` runtime contract they already satisfy. Neither contract is rewritten.

## 4. The four conflicts and their resolutions

### 4a. AI autonomy — RESOLVED: Bridge canon generalizes to Avilo; per-module governance carries the rest

Avilo canon reads *"The app works fully with no model configured. AI is additive, never
load-bearing. No model call without a button press."* Bridge canon reads *"adapt before asking;
learn before acting"* and is built on Automations that start Agent Runs. Applied literally and
globally, Avilo's rule would remove the thing Bridge is for.

The user's resolution, verbatim:

> Generalize current Bridge rules to avilo as well on AI. Bring in the governance section to all
> modules below the intelligence section where user can explicitly add whats allowed and whats
> not. In this, add Avilos specific rules for avilo module.

So: Bridge's AI canon applies to Accounting like every other Module. Avilo's stricter posture is
not deleted and is not globalized — it becomes **seeded governance entries on the Accounting
Module**, in a new per-Module Governance Section the user can edit at runtime (§6). The rule
stops being a global constant and becomes a declared, inspectable, per-Module policy.

This is a strictly stronger position than either original. Avilo's rule was correct but
unenforceable — it lived in prose and was violated repeatedly (BUG-029 … BUG-045 are all the
assistant claiming work it had not done). Moving it into a declared policy that the runtime reads
is the same move Avilo itself made when it turned regexes into `label_mappings`: **when you are
about to encode knowledge in code, check whether it should be data.**

### 4b. Storage — RESOLVED: SQLite on the Local Plane

Accounting and D2C keep better-sqlite3 and the Drizzle sqlite dialect, registered on Bridge's
existing Local Plane. Cloud sync stays optional and off. No schema rewrite, no migration against
real advisor books, and Avilo's offline guarantee survives as a Local-Plane property rather than
a platform-wide constraint that would contradict Bridge Cloud.

### 4c. D2C's shape — RESOLVED: a Module with sub-modules

Sub-modules are already a Bridge primitive: `ModuleManifest` carries a `parent` field (ADR-178,
`platform/packages/core/src/module/types.ts:143`), navigation is built by `buildModuleNavTree`,
and the canon file layout is already `<Organization>/<Module>/<Sub-module>/`. The declaration in
`types.ts` is explicit that this buys nothing beyond navigation:

> This is a NAVIGATION relation only. A sub-module is still a whole Module — no shared
> credentials, no inherited permissions, no plane relaxation.

So D2C is a Module; Orders, Inventory, Research and Production declare `parent: d2c`. No new
kernel primitive, and no vocabulary approval needed. CV Naturals' own roadmap of eight modules
(`ecosystem-proposal.md`) survives intact.

### 4d. The `whatsapp` id collision — RESOLVED: there was never a conflict

`diff -rq` across the two `src/` trees returns nothing. All sixteen files are byte-identical.
CV Naturals' `package.json` says so itself:

> Cloned from Bridge's @bridge/whatsapp module; the manifest/catalog integration (@bridge/core,
> @bridge/module-manifests) was dropped because nothing outside that one Bridge-specific test
> used it.

Only `package.json` differs (name, deps). Resolution: keep `@bridge/whatsapp`, do not import the
clone, and have D2C depend on the Bridge module. Zero code is lost. This is the reason the
"decide after diffing" option existed — the cheap check dissolved the conflict instead of forcing
a choice between two things that turned out to be one thing.

## 5. Source repositories are read-only donors

User directive: *"Keep the original avilo and cvn untouched. Only optimize bridge."*

`avilo-dashboard-v9` and `CV Naturals` are **not modified by any stage of this merge.** Consequences,
all of them intended:

- Avilo's Electron 43 shell keeps building from its own repository. The v1.8.0 beta user keeps
  receiving updates. There is no cutover gap and no orphaned installer.
- Bridge grows an Accounting Module that runs in Bridge's Tauri shell. Two shells exist, but not
  in one repository and not on one maintainer's critical path.
- Avilo's Electron-specific working rules (asar `extract-file` grep, the cross-built-installer
  warning, `build.mjs` web-bundle ordering) stay true where they are true — in Avilo's repo — and
  are **not** copied into Bridge canon, where they would be false at every point of use. A rule
  that is false everywhere it is read is worse than an absent rule.
- History is preserved by subtree merge (`--allow-unrelated-histories`), a read-only fetch from
  each donor. Avilo's ~53 ADRs and 47 bug records stay traceable to the commits that produced
  them, which matters because their prose cites commit-era context.

## 6. The Governance Section

New `ModuleGovernanceSection.tsx`, rendered from `ModuleSurfaceLayout`'s `below` slot immediately
after `ModuleIntelligenceSection`, on **every** Module.

Placement is deliberate and mirrors the existing Intelligence Section exactly: manifest-sourced,
honest empty states, links to Module Detail for the full surface. Intelligence answers *what this
Module can do*; Governance answers *what it is allowed to do*. They belong adjacent, in that
order.

Shape: a `governance` block in each Module's `module.yaml`, holding user-editable `allow` and
`deny` entries. Seeded per Module, editable at runtime, read by the engine — not prose in a
prompt. Accounting's seed is Avilo's canon (§7b).

Per ADR-001 (present-not-absent), a Module with no governance entries renders the Section with an
honest empty state. It is never filtered out of the layout.

## 7. Rules

### 7a. Promoted to Bridge canon — apply to all Modules

These are Avilo's and CV Naturals' rules that generalize without contradicting anything Bridge
already holds. Each was earned against a real defect, which is why they are worth the recurring
context cost:

| Rule | Origin | Why it generalizes |
|---|---|---|
| **When you are about to encode knowledge in code, check whether it should be data.** | Avilo house rule; four inversions of v9's failure modes | The single most load-bearing rule in Avilo's docs. Most of its ADRs are applications of it. |
| **Never fabricate a figure.** Everything on screen traces to an imported fact, a stored override, or a formula. "Unknown" is a first-class result. | Avilo | Strengthens Bridge's existing "real connected data or honest empty states" by naming the positive obligation, not just the prohibition. |
| **Generated UI binds, never carries.** Components name an id; no field can hold a value. | Avilo ADR-041 | Makes the rule above hold *by construction* through generated surfaces rather than by policy. Directly relevant to Bridge's blueprint pipeline. |
| **An author declares which levers it changes, and is held to it.** A diff touching anything outside the declaration is refused whole; an omitted declaration refuses everything. | Avilo ADR-045 | Written after prompt text failed twice on the same defect (BUG-031, BUG-033). Generalizes to any Bridge Agent that writes. |
| **Where the server knows the truth, the server speaks first.** A reply claiming a change that was not made is withheld and replaced from the diff, not printed and rebutted. | Avilo ADR-047 | Printing a lie and arguing with it still shows the user the lie. Applies to every Bridge Agent surface. |
| **"Already configured" is not a refusal.** | Avilo ADR-052, BUG-045 | Cost a user three attempts and a session believing a working capability was missing. Same family as CVN's ADR-001. |
| **A fresh database is not a test.** Migration bugs hide behind fresh installs; the failure mode is always an existing database. | Avilo | Bridge has migrations and a Local Plane. Directly applicable, currently unwritten. |
| **Blast-radius check before finishing** — callers, shared types, the packaged app, the other surfaces. | Avilo | Bridge already has tier-scoped ownership; this is the concrete checklist form. ADR-229's root cause was exactly a missed affected-neighbour. |
| **Present-not-absent** — a command that cannot run stays visible, disabled, stating why. | CVN ADR-001 | Already consistent with Bridge's honest-empty-state canon; makes the disabled case explicit. |
| **A task closes only when its outcome is true in the running app**, live-verified where observable, or with a note saying why it could not be. | CVN | Bridge's completion rule says this for runtime surfaces; CVN's phrasing generalizes it and names the escape hatch honestly. |

### 7b. Seeded as Accounting Module governance — not global

Avilo's stricter AI posture, moved from prose into the Module's declared policy:

- No model call without an explicit user action. No call on upload, render, navigation, or timer.
- One key, one reader (`groq_api_key` via `groqConfig()`). Never a second key or a second reader.
- A model may choose, never invent. A hallucinated id degrades to `skip`; a summary containing a
  figure the books do not have is rejected.
- Only a formula may introduce a new id, and only if its expression compiles against real
  accounts and formulas. Every other id is closed.
- A benchmark is the one number a blueprint may carry — a threshold the advisor sets, never a
  reading from the books.
- The client-scoped levers never carry a client id; they act on the open client.
- An external agent reaches configuration, never the books. Enforced by module graph, not prompt.
- Every configuration change leaves a state you can return to. Restore is forward-only.
- The deterministic narrative is the source of truth; generated prose is a rewrite of it.
- New data supersedes a custom edit.

### 7c. Not imported

- Avilo's Electron packaging rules — see §5. They remain true in Avilo's repo.
- Avilo's absence of a task queue and approval gate. Accounting adopts Bridge's tier model,
  `docs/TASKS.md`, and `docs/APPROVALS.md`.
- Avilo's `~/Documents/Bridge/Avilo Advisory/` path, which predates the `<Organization>` slot.
  Becomes `~/Documents/Bridge/<Organization>/Accounting/`.

## 8. Identifier renumbering

All three repositories number from 001, so ADR, TASK and BUG ids collide three ways. Bridge's
ranges win because Bridge is the surviving repository; the donors are renumbered on import with
their original id retained in parentheses so the prose in imported docs stays traceable.

| Series | Bridge in use | Avilo | CV Naturals | Imported as |
|---|---|---|---|---|
| ADR | 006–229 | 001–053 | 001–016 | Avilo → ADR-233…, CVN → after Avilo's block |
| TASK | 001–066 | — | 001–040 | CVN → TASK-069… |
| BUG | `BUG-2026-*` dated form | 001–047 | own series | Imported under Bridge's dated form |
| AP | 001–147 | none | own series | Donors had no comparable gate; not imported |

The mapping table is produced during Stage 2 and lands in this document as §8a. Renumbering
follows the precedent already set in `docs/TASKS.md` for the TASK-029, TASK-032 and TASK-033
collisions: **the later-arriving side renumbers.**

## 9. Stages

- **Stage 1 — canon (this document).** APPROVALS rows, ADRs, wiki one-liners, CLAUDE.md rule
  additions, TASKS rows for the following stages, log entry. No code moves.
- **Stage 2 — TASK-067.** Subtree merges, module trees, `module.yaml` manifests, whatsapp
  dedupe, id renumbering map, `pnpm verify` green.
- **Stage 3 — TASK-068.** `ModuleGovernanceSection.tsx`, the `governance` manifest block, the
  Accounting seed, live verification on the running app.

## 10. Open items

- Avilo's `platform/packages/module-host` in the CV Naturals checkout contains only `dist/` and
  `node_modules/` — no `src/`. Stage 2 must confirm CV Naturals consumes Avilo's published
  module-host rather than a divergent copy before either is imported.
- Bridge's `packages/db` is Postgres-only. Stage 2 must confirm the Local Plane registration path
  for a sqlite-dialect Module exists, or record an honest blocker.
