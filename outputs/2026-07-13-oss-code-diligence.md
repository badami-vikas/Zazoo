# 2026-07-13 — OSS code-level diligence for the five strengthened roadmaps

**Trigger**: user — "run a deeper codebase analysis of open source repos." Closes the gap flagged in ADR-050/051 (earlier diligence subagents died on session limits, leaving several reuse-map verdicts at README/pattern level).

**Method**: 4 parallel subagents, shallow clones read at source level — file-verified licenses (per-directory sweeps for mixed licensing), does-the-claimed-thing-exist checks, exact file paths for every pattern Bridge adopts. Full findings: [oss-code-diligence-2026-07.md](../docs/raw/oss-code-diligence-2026-07.md); ADR-053.

## Headlines

- **No vapor.** Everything the roadmaps lean on exists in code; Resume-Matcher is *stronger* than assumed — its truthfulness gate, PROTECTED_FIELDS-style blocklist, 5 deterministic scorers, and LLM judge all exist and are decoupled from its web stack.
- **Firecrawl verdict revised** (Learning LA3): engine is AGPL with a 5-service self-host footprint. Preferred path is now porting its ~95-line `safeFetch.ts` SSRF pattern (connect-time resolved-IP check — defeats DNS rebinding) into Bridge's own client + driving Playwright directly.
- **cal.diy license suspicion cleared**: fork is genuinely MIT at root, `/ee` removed — full-tree sweep still required at pin time.
- **react-big-calendar lanes** (CAL4): real, MIT, Luxon localizer exists — but NOT piecemeal-importable; adoption = a full `<Calendar>` instance behind the CalendarView port for the lane surface only. This pre-answers the CAL4 spike shape.
- **Compliance traps found**: mem0 telemetry ships to PostHog BY DEFAULT (`MEM0_TELEMETRY=False` mandatory) and its zero-config defaults phone OpenAI/qdrant (explicit local config mandatory); stagehand has no SSRF guard and its `act()`/CUA paths must be gated off for a never-executes Learning Agent; neither ical.js nor ical-generator ships timezone data (one shared IcsCodec VTIMEZONE seam, now budgeted into CAL5's DST eval work).
- **Corrections applied to roadmaps**: career-ops URL resolved (`santifer/career-ops`; 54 providers, more than claimed) but its A–G rubric + batch worker are markdown prompts + a bash harness → design-reference only; JobFunnel's `key_id` is a source identifier, not a `company|title|location` composite.

## Artifacts

- New: `docs/raw/oss-code-diligence-2026-07.md` (status: active — Builder-stack section pending; first pass died on a session limit after confirming bolt.diy asymmetric diffing + file locking, re-run in flight)
- Corrected in place: §4 reuse maps of `learning-agent-roadmap-2026-07.md`, `jobpilot-module-plan-2026-07.md`, `calendar-module-plan-2026-07.md`
- ADR-053 in `docs/raw/decisions-log.md`; ledger row in `docs/log.md`; wiki index line

Docs only — no code changed. All license verdicts re-verify at vendor-pin time per the standing reuse gates.
