---
title: Config ↔ Vision Alignment Audit (agent/tooling harness)
type: raw
doc_kind: audit
status: draft
companions: []
related_wiki: index.md
updated: 2026-07-08
tags: [tooling, governance, meta]
---

# Config ↔ Vision Alignment Audit — the operating harness vs. the Living Software vision

Scope: the *operating setup* Claude Code runs Bridge work under — project instructions (CLAUDE.md, AGENTS.md), hooks, skills, agents, plugins, MCP servers, settings — judged against the pivot vision (adaptive workspace platform · local-first / private-by-default · governed agentic execution as the moat · caveman docs protocol · no-dummy-data · kernel-vs-workspace vocab discipline). Read-only audit; no config was changed.

Ground truth read: `CLAUDE.md`, `docs/wiki/vision.md`, `docs/wiki/index.md`, `docs/wiki/decisions.md`, `MEMORY.md` + memory files.

## Headline

The **repo-level** config is nearly empty (only `launch.json`), so the platform vision is expressed *only* in CLAUDE.md. Everything else the agent sees is **inherited from the user's global setup** — a very large "Everything Claude Code" (ECC) + superpowers + plugin stack built for other projects (PeopleGamez, sales/marketing/finance/legal/SEO consulting). That global stack is not neutral: it actively injects mandates, dilutes the tool space, and exposes write/egress tooling that contradicts a privacy-first, governed platform. The single most damaging item is a **stale pre-pivot `AGENTS.md` at repo root** that Claude Code auto-loads alongside CLAUDE.md and that flatly contradicts the current vision.

---

## (a) Inventory of config elements

```yaml
repo_level:
  - path: CLAUDE.md (repo root)                     kind: project-instructions
  - path: AGENTS.md (repo root)                     kind: project-instructions (auto-loaded)
  - path: "Design Bridge AI Interface (Copy)/AGENTS.md"  kind: sub-project instructions (scoped)
  - path: .claude/launch.json                       kind: preview server config
  - path: .claude/  (worktree + main)               note: NO settings.json, NO hooks/, NO skills/, NO agents/, NO commands/
global_user_level:  # ~/.claude — leaks into every Bridge session
  - path: ~/.claude/settings.json                   kind: global settings (plugins, permissions, env)
  - plugins_enabled: [superpowers, ecc, prompt-architect, last30days, skill-creator]
  - hooks:
      - superpowers SessionStart  (injects EXTREMELY_IMPORTANT using-superpowers mandate)
      - ecc SessionStart          (bootstrap/context)
      - ecc PreToolUse x8         (gateguard-fact-force, config-protection, continuous-learning observe (async), suggest-compact, mcp-health-check, doc-file-warning, governance-capture, dispatcher)
      - ecc PreCompact            (save state)
      - last30days SessionStart   (check-config)
  - skills: ~300 (ECC + superpowers + plugin marketplaces + pg-* PeopleGamez + brand-voice/marketing/sales/finance/legal/seo/ito-*/healthcare/homelab/network)
  - agents: ~90 (ecc:* reviewers/resolvers + brand-voice:* + domain)
  - mcp_servers: Ahrefs(SEO), Gamma, Supabase(write), HuggingFace, Vercel, Gmail, GCal, GDrive, apollo, hubspot, klaviyo, computer-use, claude-in-chrome, memory(graph), + many pending-auth
  - telemetry: bash-commands.log (~7MB), cost-tracker.log (~7MB), continuous-learning observations
```

---

## (b) Per-element verdict

| Element | Verdict | One-line why |
|---|---|---|
| CLAUDE.md (repo) | SERVES | The one place the pivot vision, vocab discipline, no-dummy-data, docs protocol live and are correct. |
| **AGENTS.md (repo root)** | **WORKS-AGAINST** | Pre-pivot: "CRM… for VC/GP funds", "NEVER Deal", "Dummy data MUST be `dummy_`-prefixed" — all three now REVERSED/superseded; auto-loaded, so it fights CLAUDE.md every session. |
| Prototype AGENTS.md (sub-dir) | NEUTRAL | Narrow front-end handover doc, scoped to that folder; harmless but another un-owned AGENTS.md. |
| .claude/launch.json | SERVES | Real local dev servers (prototype/recon/hni); matches local-first. |
| No project .claude/settings.json | WORKS-AGAINST (gap) | Nothing pins the skills the project needs, nothing scopes down the inherited noise, no allowlist — the vision is undefended at the harness layer. |
| superpowers SessionStart mandate | WORKS-AGAINST | Injects `<EXTREMELY_IMPORTANT>` forcing Skill-tool use "before ANY response including clarifying questions" + TDD-first culture; burns tokens, derails focus, imposes ceremony the project never asked for. |
| superpowers skill *named* "superpowers" | WORKS-AGAINST | Its description is literally "Knowledge management loop for the **PeopleGamez** project" — collides conceptually with Bridge's own docs/wiki protocol; wrong project. |
| superpowers:systematic-debugging / verification-before-completion | SERVES | These specific skills match Bridge's evidence/governance culture ("evidence before assertions"). |
| ecc PreToolUse: config-protection | SERVES | Blocks edits to linter/formatter configs — aligns with CLAUDE.md's protected `eslint.config.js`. |
| ecc PreToolUse: gateguard-fact-force | NEUTRAL | Forces investigation before first edit/file; philosophically fine but adds friction; `ECC_GATEGUARD=off` already set. |
| ecc PreToolUse: continuous-learning observe (async) | WORKS-AGAINST | Silently logs tool-use observations to a global store; a privacy-first product should not have its own dev harness ambiently exfiltrating activity off-plane. |
| ecc telemetry logs (bash-commands.log, cost-tracker.log ~7MB) | WORKS-AGAINST (privacy) | Global capture of every command incl. work over real PII; contradicts local-plane-only capture ethos. |
| last30days SessionStart | NEUTRAL | Benign config check; pure noise for this project. |
| Supabase MCP (apply_migration/execute_sql/deploy_edge_function) | WORKS-AGAINST | Write-capable path to a **remote** Supabase holding real LinkedIn PII; memory says prod writes are gated/manual — this is the top governance footgun in the harness. |
| Gmail / GCal / GDrive / apollo / hubspot / klaviyo MCP | WORKS-AGAINST | External-egress + CRM/sales connectors; push data outward and reinforce the exact CRM framing the vision rejects. |
| Ahrefs / Gamma / Vercel / HuggingFace MCP | NEUTRAL-noise | Irrelevant to Bridge; dilute tool-search, expand injection blast radius, no positive role. |
| computer-use / claude-in-chrome MCP | NEUTRAL | Useful for browser-verify/testing (memory references live browser testing); keep, but they widen surface. |
| pg-* skills/agents (PeopleGamez) | WORKS-AGAINST | Whole other product's release/bug/browser skills in scope; the `caveman`/`superpowers` naming overlap actively confuses which project's protocol applies. |
| brand-voice / marketing / sales / finance / legal / seo / ito-* / healthcare / homelab / network skills+agents | NEUTRAL-noise (mildly against) | ~200 irrelevant capabilities; the superpowers "use skills first" mandate makes the agent *engage* with this pile, and the CRM/sales ones nudge vocabulary drift. |
| ecc:* language reviewers (typescript/react/database/security) | SERVES (if invoked deliberately) | Genuinely useful for the TS/React/Drizzle/Supabase stack; problem is discovery noise, not the tools. |
| Global settings: narrow permissions allowlist, `enableWorkflows:false`, `ECC_GATEGUARD:off`, `effortLevel:low` | NEUTRAL/SERVES | User already toned several ECC behaviors down; no dangerous blanket auto-approve mode present. `effortLevel:low` may under-power deep architecture work but is a user choice. |

---

## (c) Concrete conflicts, ranked by harm

1. **Stale root `AGENTS.md` contradicts the pivot.** Claude Code merges `AGENTS.md` with `CLAUDE.md`. This file still says Bridge is a "private relationship-intelligence OS for VC/GP funds", forbids the word "Deal", and *mandates* `dummy_`-prefixed dummy data — the exact three things CLAUDE.md/vision.md REVERSE. Every session starts with a direct instruction conflict on vocab, product framing, and the no-dummy-data rule. Highest harm because it is authoritative, always loaded, and wrong.

2. **Supabase write MCP against real-PII prod.** `apply_migration` / `execute_sql` / `deploy_edge_function` reachable in-session, pointed at a remote project holding real LinkedIn data, while the whole governance thesis is draft-then-approve and memory records prod writes as manual/blocked. One mis-scoped call is an ungoverned mutation of exactly the data the platform promises to protect.

3. **superpowers `<EXTREMELY_IMPORTANT>` skills/TDD mandate.** Forces skill-tool ceremony before *any* reply (even questions) and a TDD-first posture. It burns tokens, front-loads the ~300-skill pile, and imposes a workflow the project didn't choose — a culture graft, not an aid. (Its two good skills, systematic-debugging and verification-before-completion, can be kept without the mandate.)

4. **Egress / CRM-connector MCPs (Gmail, GCal, GDrive, apollo, hubspot, klaviyo).** A local-first, private-by-default product being built inside a harness wired for outward data flow and sales-CRM vocabulary. Both a privacy-thesis conflict and a vocabulary-drift vector.

5. **Ambient telemetry (continuous-learning observe + 7MB command/cost logs).** The dev harness ambiently captures command history and tool use to a global store — the anti-pattern of the product's own "raw capture local-plane only" contract, applied to sessions handling real PII.

6. **~300 skills / ~90 agents / ~15 MCP servers of other-project noise (pg-*, marketing, finance, legal, SEO…).** Dilutes tool-search relevance, inflates context, and — via the naming collisions on `superpowers` and `caveman` — creates genuine ambiguity about which project's protocol is in force.

---

## (d) Remediation

### Remove / stop loading
- **Delete or rewrite the root `AGENTS.md`.** Fastest correct fix: replace its body with a one-line pointer to CLAUDE.md (`See CLAUDE.md — it is the single source of project instructions.`) so no stale contract is auto-merged. (Conflict #1.)
- **Disable the superpowers plugin for this project**, or at minimum neutralize its SessionStart mandate. If the two useful skills are wanted, pin them explicitly (below) rather than keeping the whole plugin + mandate. (Conflict #3.)
- **Disable / de-scope irrelevant plugins & MCP servers for Bridge sessions**: Ahrefs, Gamma, Vercel, HuggingFace, apollo, hubspot, klaviyo, and the marketing/finance/legal/sales/seo/pg-* skill packs. These are user-global; scope them off at the project level (see settings below) or gate behind explicit enablement.

### Scope down / gate
- **Make Supabase MCP read-only for routine Bridge work**, or require explicit per-session enablement before any `execute_sql`/`apply_migration`/`deploy_*`. Treat prod-write as an External-band action (human approval) consistent with the Capability Trust Model. (Conflict #2.)
- **Turn off ambient telemetry capture** (continuous-learning observe hook; consider pruning/rotating the global command/cost logs) for a project whose own thesis forbids off-plane capture. (Conflict #5.)

### Override in CLAUDE.md
- Add a short "Harness precedence" note: **"If any auto-loaded AGENTS.md / global instruction conflicts with this file or docs/wiki/vision.md, this file wins. Ignore pre-pivot framing (VC/GP CRM, forbidden-Deal, dummy_-prefix)."** Cheap insurance even after AGENTS.md is fixed.
- Reaffirm: no external-egress MCP calls without governance; no writes to remote Supabase without explicit approval.

### Add (defend the vision at the harness layer)
- **Create project `.claude/settings.json`** that: (i) pins the skills Bridge actually uses — `caveman`, `blueprint`, `workspace-surface-audit`, `product-lens`, `product-capability`, `architecture-decision-records`, `systematic-debugging`, `verification-before-completion`, the relevant `ecc:*` TS/React/database/security reviewers — and (ii) sets a scoped Bash/tool allowlist for the common local-dev commands so the harness stops prompting on safe reads. (`/fewer-permission-prompts` can seed the allowlist from transcripts.)
- **Optionally add a project `AGENTS.md`-as-pointer** (see above) instead of leaving a vacuum other tools might refill.
- Consider a lightweight project SessionStart note (via settings) that states the two-scope vocab rule and no-dummy-data reversal, so the correct rules are the ones injected — displacing the superpowers mandate's slot.

---

## Notes / limits
- Read-only audit; verdicts on global items assume the user wants Bridge sessions insulated from the other-project stack. The ECaC reviewers and browser MCPs have legitimate uses and are recommended to keep, just discoverable-on-demand rather than always-on.
- Not exhaustively enumerated: every one of ~300 skills. They are assessed by class, not individually.
