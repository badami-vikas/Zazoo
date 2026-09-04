# OSS → Commons — skills, agents, modules

full: [../raw/oss-commons-integration-plan-2026-07.md](../raw/oss-commons-integration-plan-2026-07.md) · 2026-07-08. Related: [commons](commons.md), [packages](packages.md), [module-evolution](module-evolution.md).

Three ingestion strategies on ONE spine that never bypasses the two enforced Commons invariants:
knowledge-only privacy gate + computed-risk governance.

**The spine**: source-specific adapters → Canonical Intermediate Representation → **hard license gate**
→ map to `PackageManifest`/`CapabilityManifest` (ALWAYS `origin: community` = untrusted, same tier as
`user_code`) → `computePackageRisk()` + lethal-trifecta union → Component-Registry dedup → quarantine →
**human review of the exact artifact at External band** → sign → privacy-gate → `POST /v1/packages`.
v1 stays curated/human-published (Bridge-key signed); self-serve community publish out of scope.

**Supply-chain guardrails (build FIRST — security audit F1)**: add a `provenance` block (source repo,
commit SHA, content hash, SPDX license — no gate-denied key names) + `content_hash`/`signature` to the
manifest (**both missing today — an ADR-018 follow-on gap, filed in BUGS**). `versionPin` becomes a
content hash, not a label. **Drop the MCP sandbox exemption** (`importer.ts:96`) — MCP servers are
arbitrary processes; their output = tainted `untrusted_external`.

**Plan 1 — SKILLS** (the 15 repos in `01_agent_skill_repositories.csv`): 4-5 format adapters (Anthropic
SKILL.md / OpenClaw / Cursor / Codex / Gemini). Decisive subtlety — **repo license ≠ artifact license**:
the big "awesome" indexes (VoltAgent 1000+/5400+, antigravity 1800+, RoggeOhta, Spencer Pauly) are MIT
*indexes* pointing at third-party skills of unknown per-artifact license ⇒ **unsafe to bulk-redistribute,
mine per-skill**. Ingestion order: **anthropics/skills (Apache-2.0) → alirezarezvani/claude-skills (MIT,
345) → simota (124) → Agensi as a security-review PARTNER (not scraped) → smaller official repos → index
repos LAST, never bulk.** No resolvable OSS-permissive license = hard stop.

**Plan 2 — AGENTS** (ashishpatel26/500-AI-Agents-Projects, MIT catalog): import the PATTERN, not the
runtime. Read/advisory/draft-shaped categories fit (research, drafting, support, recruiting/sales
scoring); autonomously-executing categories REJECTED (trading, offensive cyber, robotics, self-healing
swarms, clinical). Every imported agent wrapped: star-topology under CoS, one governed draft/turn, zero
write access, `external:send` agent-floor DENY, sandboxed.

**Plan 3 — COMMERCIAL MODULES**: internalize OSS via the existing "internal modified copy, rebind 3
edges" pattern (model→ModelProvider · persistence→governed store · output→contract). License = make-or-
break: embed only **MIT/Apache/BSD/MPL-2.0/ISC**; **REJECT GPL/AGPL/SSPL/BUSL** (honors existing
Cal.com/Nextcloud/Radicale rejections), gate on TRANSITIVE deps too. Modularize first: calendar render +
RFC-5545 math · identity resolution (Splink) · scaffolding (Refine/Dyad) · then document/RAG + connector
bundles.

**Addendum (2026-07-09)**: other "list of lists" of example agent apps (e.g. `Shubhamsaboo/awesome-llm-apps`)
= Plan-2-shaped (mine as catalog, not hosted skills) — folded into Plan 2 §2.4, decision rule for future
submissions in the raw doc's addendum.
