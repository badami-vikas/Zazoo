# Progress — what's actually in flight right now

The ONE doc that tracks ongoing work. Everything else in [INDEX.md](INDEX.md) is planned-but-not-
active or historical. Other docs should reference THIS file when they need to know "is X being
worked on right now" — not re-derive it. Keep this short; when an item finishes, move its line to
the "Recently closed" section with a date, don't delete the trail.

## Active
_(nothing actively in flight as of 2026-07-09 — this was a planning-only session, no code touched)_

## Queued next (highest priority first — REORDERED 2026-07-09 to match the 6-month plan's Month 1;
## the previous ordering skipped the open security HIGHs entirely)
1. **Security HIGHs H1-H4** (auth-by-default, dep CVE bumps, Tauri CSP, rate limiting) + XP-1
   (cfg-gate Apple crates, 3-OS cargo-check CI) — 6-month plan Month 1, all OPEN in
   [../BUGS.md](../BUGS.md). Cheapest highest-leverage fixes; everything else builds on an
   unauthenticated API until done.
2. OSS-Commons plan §0 — supply-chain trust foundation (content-hash pinning, signing slot, drop MCP
   sandbox exemption — `importer.ts:88-98` verified still exempting, add `license`/`provenance`
   fields to `PackageManifest` — `package/types.ts:51-68` verified still missing). Blocks all 3
   ingestion pipelines. Spec: [../raw/oss-commons-integration-plan-2026-07.md](../raw/oss-commons-integration-plan-2026-07.md) §0.
3. Recon package migration — still standalone at `Tools/recon` (verified in code 2026-07-09), not yet
   repackaged as an add-on capability package like DealPilot/Helpdesk (roadmap.md P2).
4. Schema v2 punch-list remainder (decisions.md) — governance roles/delegation/ephemeral grants,
   touchpoint hierarchy, versioning enforcement. ORPHANED: no month owns it; needs a slot before the
   trust-model work in #2 piles more on top of it.
5. ADR-026 leftovers — Docling + Nango providers (zero code, BUGS.md row filed 2026-07-09) — build or
   formally descope. Tracks A-G otherwise verified substantially complete in code (2026-07-09 audit:
   toolbelt/avatar/Pi-importer/dummy-purge all real; PromptAssembler superseded by run-context per ADR-027).

## Open user decisions (blocking sequencing, from 2026-07-09 audit)
- Day-1 onboarding bar (ADR-033) requires the Browser Companion extension, but roadmap defers browser
  extension to P4 — descope the onboarding step, or pull the extension forward?
- Module-proposal Day-1 slice vs Component Registry ordering is inverted between module-evolution.md
  and the 6-month plan (Registry Month 4, agents Month 5) — which wins?
- Prototype→kernel data migration (canonical people, ETA/WashU lists) is owned by NO doc — needs an
  owner before the two systems drift permanently.

## Recently closed
- 2026-07-08/09 — AGENTS.md deprecated/pointer-stubbed (superseded by CLAUDE.md), confirmed aligned
  with roadmap this session (no further action needed).
- 2026-07-06 — Signal folded into Approvals as a tab + ontology-mapped to "derived Incident" (never
  had a standalone page to remove).
- 2026-07-09 — docs system restructure: `docs/output/`, `docs/plan/`, `docs/wiki/QUESTIONS.md`,
  article standard + source-provenance rule added to wiki Protocol, end-to-end architecture doc
  written.
