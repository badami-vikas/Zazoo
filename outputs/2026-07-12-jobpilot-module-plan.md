---
title: Session Outputs — JobPilot Module Plan
date: 2026-07-12
status: complete
---

# Scope

User asked for a JobPilot roadmap in the DealPilot plan style. This file records the user-facing
outcome.

# Delivered

- **Plan**: [docs/raw/jobpilot-module-plan-2026-07.md](../docs/raw/jobpilot-module-plan-2026-07.md) —
  DealPilot three-lens template: product decision (compiled package, auto-apply reframed to
  draft-then-approve), design lens (Overview/Cards/Application-detail/Pipeline/Materials/Sources/
  Answers/Interviews/Playbooks IA + full Application tabs), business coverage/exclusions, technical
  lens (8 agent archetypes, 21 skills, 15 automations, integration map), reuse-first source map with
  the legitimate-source catalog centerpiece, Application data graph + invariants, JP0–JP6 slices.
- **Wiki**: index line; Plan Registry line; log entry; **ADR-050**.

# Key conclusions

- **Auto-apply → draft-then-approve.** The standalone vision's unattended waterfall becomes governed:
  External-band submission is always human-approved at launch. JobPilot removes the tedium, not the
  decision to apply. Commercial research validates this — mass auto-apply tools (LazyApply/AIApply/
  Massive/Sonara) carry ~2.3/5 reputations and ToS bans, and drove the ~11,000-apps/minute arms race
  where 34% of recruiters now filter AI spam half the week (Greenhouse 2025).
- **Legitimate-source-first catalog** is the centerpiece: Tier-1 official/public APIs (ATS boards,
  aggregators, RSS) default-on; Tier-2 scraped sources (LinkedIn/Indeed/Glassdoor) off-by-default,
  never load-bearing, per Bridge's never-bypass-ToS rule. Sourced from the user's own
  `Tools/Job/Platforms` CSVs.
- **Truthfulness gate is hard**: tailored materials need per-line evidence vs the master profile;
  protected fields never fabricated; sensitive fields always human.
- **OSS leverage** (from the requirement doc §5, carried under Bridge reuse policy): Resume-Matcher
  (Apache-2.0) supplies ~70% of the writer/evaluator loop; career-ops/jobhive/JobFunnel (MIT) the
  sourcing + dedupe; ApplyPilot/job-ops (AGPL) are patterns-only. No AGPL/Commons-Clause/CC-NC
  vendored.
- **Builds on shipped foundations**: `@bridge/jobpilot` (50 tests), the `job-pilot` built-in
  manifest, db store, and prototype UI = JP0 done; JP1–JP6 sequence the feature build.
- Status `proposed`; roadmap P6; no H2 sequencer reorder.

# Note

The deep OSS code-diligence subagent hit the session limit (resets 8:20am CT); its verdicts were
recoverable from the user's own requirement-doc leverage plan (repo licenses/architecture already
researched there) plus the completed commercial-landscape research, so the plan is complete. A fresh
code-level clone-and-inspect of the OSS targets can refine the reuse map later if desired.
