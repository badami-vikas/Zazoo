# 2026-07-09 — Last planning session audit (answers, not new decisions)

## 1. AGENTS.md deprecation + Signal standalone drop — both already aligned with roadmap

**AGENTS.md**: not just planned, already done. `/AGENTS.md` was rewritten to a pointer stub on
2026-07-08 (commits `d454ac7`/`f71c1aa`) — it used to be auto-loaded alongside CLAUDE.md and
preached pre-pivot VC/GP-fund framing that actively contradicted the current vision. Flagged as the
#1 item in the 2026-07-08 config-alignment audit, fixed same day. Logged: `docs/log.md`,
[../wiki/config-alignment.md](../wiki/config-alignment.md).

**Signal as standalone**: never existed as a standalone page to begin with, so there was nothing to
"drop" in the UI sense — but the ontology work (ADR-028, 2026-07-07) did formally reclassify it:
Signal = derived Incident, not a root primitive. It lives as a tab inside Approvals (ADR-023, Shell
IA restructure, 2026-07-06). Both roadmap.md and ontology.md state this consistently. No action
needed — this was already correct going in.

## 2. End-to-end architecture — delivered as a permanent doc, not here

Written to [../raw/architecture-end-to-end-2026-07.md](../raw/architecture-end-to-end-2026-07.md)
(with a wiki pointer added to [../wiki/architecture.md](../wiki/architecture.md)) because it's
durable reference knowledge, not a one-off answer — walks Kernel → Compiler → Runtime → Generated
Workspace top to bottom, citing the raw doc that owns each claim.

## 3. Docs restructure — applied this session

- `docs/output/` (this folder) — non-permanent answers/audits.
- `docs/plan/` — `INDEX.md` (present/past/future plan docs, no files moved) + `PROGRESS.md` (the one
  live-tracked active-work doc).
- `docs/wiki/QUESTIONS.md` — open threads / future article candidates.
- `docs/wiki/index.md` Protocol section — added article standard (confidence flags
  established/emerging/speculative + mandatory `full:` source line), source-provenance rule (every
  claim cites raw or is flagged speculative), and the confirmed promotion pattern (a raw doc becomes
  a wiki page once it's cross-referenced from 2+ other wiki pages or re-asked-about — verified this
  is already how the existing 33-page wiki behaves, e.g. decisions-log/roadmap/packages/oss-commons).
- CHANGELOG requirement: NOT a new file — `docs/log.md` already serves that exact role (dated,
  append-only audit trail), so index.md now names it explicitly as one of the 3 nav files instead of
  duplicating it.
- Caveman English: CLAUDE.md already mandates "wiki in CAVEMAN style" and the existing 33 wiki pages
  already write in dense telegraphic shorthand — kept that established voice rather than introducing
  literal caveman grammar, which would read as inconsistent against 33 existing pages.
- **Explicitly out of scope this session**: did not retrofit all 33 existing wiki pages to the new
  article standard (confidence flags, explicit `related` sections everywhere) — that's a batch job,
  applied opportunistically on next-touch per the Protocol note, not a blocking rewrite.

## 4. OSS ingestion plan (awesome-llm-apps and similar) — plan already exists, in draft

[../raw/oss-commons-integration-plan-2026-07.md](../raw/oss-commons-integration-plan-2026-07.md)
(454 lines, 2026-07-08, `status: draft`) already covers exactly this: 3 governed pipelines (OSS
skills / OSS agent-catalogs / commercial modules), ranked ingestion order, license triage table,
supply-chain trust foundation (§0) that must land first. The specific repo you linked
(`Shubhamsaboo/awesome-llm-apps`) wasn't named — added as an addendum to Plan 2 (agent-catalog
ingestion), same shape as the existing anchor (`ashishpatel26/500-AI-Agents-Projects`), plus a
general routing rule for future "list of lists" submissions (full-app-example catalogs → Plan 2,
hosted-skill catalogs → Plan 1).

**Status reality check**: the plan is *decided*, not *built*. Section 0 (content-hash pinning,
signing, dropping the MCP sandbox exemption, adding `license`/`provenance` fields to
`PackageManifest`) is the prerequisite and nothing downstream should start before it — queued as
priority #1 in [../plan/PROGRESS.md](../plan/PROGRESS.md).

## 5. Missing pieces found this session

- `PackageManifest`/`CapabilityManifest` still have no `license`/`provenance` field (tracked:
  `docs/BUGS.md`, ADR-018 follow-on) — blocks OSS ingestion plan §0.
- No single end-to-end architecture doc existed before this session (now fixed, see §2).
- `docs/output/`, `docs/plan/`, `docs/wiki/QUESTIONS.md` didn't exist before this session (now
  fixed).
- Consolidation sprint (ADR-026, tracks A-G) status vs. real code was NOT re-verified this session —
  `docs/plan/PROGRESS.md` flags this as the first thing to check before writing new code, since a
  stale "done" claim here would misdirect the next session.
- Security HIGH findings (H1-H4 in `docs/BUGS.md`: no auth by default, vulnerable deps, Tauri
  `csp: null`, no rate limiting) are still open and unrelated to this session's docs work — flagging
  because "last planning session before I start work" should probably account for them in whatever
  gets built first.
