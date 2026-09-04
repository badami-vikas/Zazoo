# Governance proportionality audit — what blocks, what should only flag

Date: 2026-09-03. Tier C audit, read-only. Principle under test (user, verbatim intent): governance
should facilitate work, not block it; only critical issues block, everything else flags and can be
overridden; rules premised on weak models are suspect.

Two layers were inventoried: the **runtime** governance the product enforces on users and Agents,
and the **process** governance agents and humans follow in this repo. Current state of the checks on
this tree: `check:agent-context`, `check:vocabulary`, `check:ui-rules`, lint, typecheck, and the
dependency audit are all green (Phase 0 of the cleanup made them so). They check clean today. The
question is whether they should be blocking at all.

## Critical = keep as a hard block

"Critical" here means: prevents secret leakage, an unauthorized external side effect, a data-residency
violation, or irreversible loss. Model quality does not change any of these.

Runtime:
- Taint lattice at sinks (`packages/core/src/taint.ts:843-867`) and the PI-2 structural egress gate.
  Premise is *whose text it is*, not how good the model is. A perfect model still executes text it was
  told to treat as data.
- Server-owned Agent identity (`routers/action.ts:22`, `pipeline.ts:677`). A client can lie about actor
  type regardless of model quality.
- Agent-floor **self-modification** half (policy, grants, ledger, delegation). An Agent that edits the
  policy governing it defeats every other gate.
- Agent may not approve; Humans decide (`pipeline.ts:704-730`). Keeps the approval loop closed.
- Cloud egress residency clamp, public-cloud closure of capture and credentials, model-key storage
  refusal, `credentialSettingsProcedure`. Residency and secrets.
- Primitive `ABSOLUTE_DENY` (force-push, `rm -rf /`, `sudo`, disk ops) and `ALWAYS_APPROVE` for
  network/publish/credential commands. Irreversibility and the network boundary.
- Kill switch, child-Run authority narrowing, deny-by-default authority, untrusted-origin grant strip
  (supply chain), `external` risk band never auto-activates.

Process:
- PII pre-commit guard (`scripts/check-no-pii.sh`). The one process gate that is unambiguously
  load-bearing.
- Dependency audit at HIGH, non-root API container smoke, cross-OS desktop compile.
- Clean-room protocol for restricted sources. Legal exposure, not process taste.
- Coverage floors on the three packages where a regression is expensive: `core`, `net-guard`, `api`.

## Not critical = demote to flag, with an override

### Runtime (model-premised, safe to relax now)

| Gate | Today | Change |
|---|---|---|
| Blanket draft-then-approve for every Agent mutation (`pipeline.ts:235` returns true for any agent, ignoring risk band) | parks everything | Route through the Trust Model's own bands: Informational auto-applies with an audit row; Advisory and above still park. **Landed with a correction:** the first cut auto-applied Advisory too and 22 tests refused, correctly — every advisory manifest today is a learning suggestion or intake whose pending proposal IS the product (TASK-032 exit test, Google intake emission warrant, red-flag SAGA). A pending state that is the work is a feature, not friction. |
| Governed skill requires a Goal/Task ref (`pipeline.ts:432-451`) and Agent-only invocation (`:421-429`) | hard block; every router grew a `provisionGoalTask` helper to feed it | Flag: record `goalTaskRef: null` on the Run and continue. Attribution stays intact because the server already resolves the actor. |
| `assertHumanIdentity` family (~15 sites) and `requireWhatsAppHuman` | hard block for any Agent | Keep only where the action is a credential, an approval, or an external send (already covered above). Elsewhere, flag and let the Module's governance overlay decide. |
| Daily auto-activation budgets (20 info / 10 advisory) and evidence thresholds for `trusted` | escalates to approval when exhausted | Keep the counters, make exhaustion a flag in the Governance Section rather than a park. |
| Accounting `books.write.model` and `model.call.unattended` denies | hard block via manifest | Already overlay-editable (ADR-263). Leave; this is user-declared policy, not kernel policy. |
| Public-cloud procedure allowlist (`deployment-boundary.ts`) for everything except capture/credentials | `PRECONDITION_FAILED` on ~60 paths; produced the "most modules say retry" report | Invert: deny-list the residency-critical paths, allow the rest on cloud. |
| Feature flights (`BRIDGE_LEARNING_OBSERVATION`, `RETRIEVAL_FUSION`, `CLAIM_SUBSTRATE`, `DEVPILOT`, `COMMONS_ARCHETYPES`), all default OFF | built surfaces return 412 | Default ON once a surface has a test; keep the env var as an emergency off. |
| `assertPilotOrganization` (312 sites, now one middleware) | hard block on any second Organization | Unchanged until multi-tenancy; it is a scaffold, not governance. |

### Process (ceremony that has stalled work)

| Gate | Evidence it hurt | Change |
|---|---|---|
| `check:vocabulary` with an empty baseline, first step of `verify` | Six consecutive red runs on main from 2026-07-31; red again 2026-08-08 and 2026-08-16; because `supabase-migrate` needs `platform`, **pending migrations stopped applying to the hosted DB while code auto-deployed**. A lint caused prod schema drift. | Run it on changed files only, as a warning. Delete the empty-baseline ratchet. Keep the allowlist file; drop the AP-row requirement for entries. |
| `check:agent-context` byte ceiling (99.2% full) and exact-equality on 111 skill overrides / 5 plugins | AP-174: a session spent rewriting eleven CLAUDE.md bullets to fit one rule; toggling one skill reds CI | Warn over budget; delete the equality checks; keep only "no plugin enabled". |
| `check:ui-rules` enforced three times (CI, pre-commit, and a PostToolUse hook that walks the repo after every `.tsx` edit) | latency on every edit | Keep the CI gate. Delete the PostToolUse hook and the pre-commit copy. Demote the three DOC_GATES (one is a grep for a filename in CLAUDE.md) to warnings. |
| Coverage floors on 23 packages, 35% to 80% | `@bridge/sensors` red for seven weeks on a floor moved by *imported core growth* | Floors on `core`, `net-guard`, `api` only. |
| `no-crm-vocab` ESLint rule and `check:no-dummy-runtime` | neither is in `verify`; lint sat red five weeks; the dummy rule's partner is already deleted | Delete both. Vocabulary is a review concern, not a compiler concern. |
| APPROVALS row for task creation, queue position, renumbering | 79 of 184 rows (43%) are bookkeeping; 14 rows exist only to say a number collided | Rows only for irreversible or strategy-reversing decisions. Task creation and ordering go straight to TASKS.md with a one-line log entry. |
| ADR ids assigned at write time across parallel worktrees | 15 collisions, an informal renumbering convention, and a proposal for a gate to police the gate | Cite ADRs by date and title; numbers become a convenience, never a key. Stop renumbering. |
| Tier A/B/C classification and the 2k/4k orientation token budgets in CLAUDE.md | every session pays a classification step written for a small-context model | Merge A and B; drop the token budgets. Keep "don't load the 850 KB ledgers by default" because of size, not model weakness. |
| Raw-doc frontmatter with seven required keys, wiki companion, and log entry per changed raw doc | 125 raw docs, 60 wiki pages, log.md at 855 KB; nothing machine-checks it | Guidance, not a gate. |
| Four-step dummy-data protocol | ritual per fixture | Keep "no dummy in runtime"; delete the ritual. |

## Rules premised on weak models

Stale, retire or relax: blanket draft-then-approve; the Goal/Task ceremony; daily activation budgets as a park; tier classification and token budgets; the CLAUDE.md byte ceiling as a blocker; exact skill-override counts; `no-crm-vocab`; the `dummy_` prefix machinery; retired-vocabulary families `tool`, `package`, `project`, `element` (unavoidable words in a TypeScript monorepo with LLM tool-calling; 39 allowlist entries exist to say so).

Still valid, keep: everything in the critical list; "never fabricate a figure, unknown is first-class" (ADR-247); "a test proves nothing until seen failing"; "build and wire in the same run"; "generated UI binds ids, never values"; "the server has the last word".

## Change set proposed for approval (AP-182)

1. `pipeline.ts`: `requiresApproval` consults the risk band; Informational Agent actions auto-apply with an audit row (Advisory kept drafting after the tests showed its proposals are the product).
2. `pipeline.ts`: Goal/Task mismatch and Human-invokes-governed-skill become recorded flags, not throws. Delete `provisionGoalTask` call sites once nothing needs them.
3. `deployment-boundary.ts`: allowlist becomes a deny-list of residency-critical paths.
4. `wiring.ts`: flights default ON; env var is the off switch.
5. `platform/package.json` `verify`: vocabulary check becomes changed-files warning; agent-context check warns; equality checks deleted; UI-rules stays; coverage floors reduced to three packages; delete `check:no-dummy-runtime` and `no-crm-vocab`.
6. `.claude/settings.json`: delete the PostToolUse UI-rules hook. `.githooks/pre-commit`: keep PII, drop the UI-rules copy.
7. `docs/APPROVALS.md` policy section: rows only for irreversible or strategy-reversing decisions.
8. `CLAUDE.md`: merge Tier A/B, drop token budgets, drop the frontmatter/companion requirement to guidance, state the block-vs-flag principle in one line.
9. ADRs cited by date and title; no renumbering.

Not proposed: any change to taint, residency, secrets, agent-floor self-modification, kill switch,
`ABSOLUTE_DENY`, the PII hook, or the clean-room protocol.

## Rejected alternatives
- Keep every gate but raise thresholds. Rejected: the stalls came from gates being in the wrong
  position (a vocabulary lint ahead of the migration job), not from thresholds.
- Delete the runtime approval machinery outright. Rejected: the risk bands are the right shape; the
  defect is that the Action pipeline ignores them and parks everything.
- Add a `check:adr-numbers` gate. Rejected: a gate to police a gate; citing by date and title removes
  the collision class entirely.
