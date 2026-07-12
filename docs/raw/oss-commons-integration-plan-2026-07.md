---
title: OSS → Universal Commons integration plan — skills, agents, and commercial modules
type: raw
doc_kind: plan
status: draft
companions:
  - capability-package-format.md
  - roadmap-v2-universal-commons.md
related_wiki: commons.md
updated: 2026-07-08
tags: [commons, oss, skills, agents, integration, licensing]
---

# OSS → Universal Commons integration plan

Three related strategies for pulling open-source capability knowledge into the Universal Commons
(`platform/services/commons`, port 4780) as governed, curated, Community-origin packages —
**without** compromising the two invariants the Commons already enforces in code:

1. **Knowledge-only** — the privacy gate (`privacy-gate.ts`) rejects any payload carrying
   workspace/user/credential keys (422 `workspace_data_rejected` + offending paths). OSS artifacts
   are generalized capability knowledge by nature, so they pass — but ingestion tooling must never
   inject provenance fields that trip the gate (e.g. an `authorId` from a GitHub commit).
2. **Everything is a computed-risk, governed capability** — `parsePackageManifest` +
   `computePackageRisk` (`packages/core/src/package/`) run unchanged; foreign origin is treated as
   **untrusted (same tier as `user_code`)**, sandboxed, pinned, versioned, and reviewed by a human at
   the External band.

This plan does not rebuild the trust model. It layers three ingestion pipelines **on top of** the
existing package format, foreign importer (`capability/importer.ts`), and Commons publish contract.

---

## 0. Cross-cutting foundation — the supply-chain trust model (BUILD THIS FIRST)

The 2026-07-08 security audit found the real gaps this plan must close **before** the first foreign
artifact is published (findings F1, and injection-vuln #5):

- **No signature / checksum / publisher verification on foreign imports.** `versionPin` is a plain
  string label, not a content hash. Trust rests on a human `auditRequired` boolean and a
  *self-declared* `sandboxPolicy` never verified to be applied at runtime.
- **MCP-server imports are exempted from the sandbox requirement "by protocol"**
  (`importer.ts:96-99`, `requiresSandbox()` returns `false` for `mcp-server`). An MCP server is an
  arbitrary external process — this exemption must be dropped.
- **No runtime taint** — the lethal-trifecta rule is a static install-time manifest audit
  (`package/risk.ts:48`), not a data-flow check.

### 0.1 Provenance record (new — required on every ingested artifact)

Every OSS artifact entering the pipeline carries a `provenance` block. It is **capability
knowledge, not user data**, so it publishes cleanly — but note it deliberately uses no
gate-denied key names (`sourceRepo` not `authorId`, `upstreamMaintainer` as a free-text label only):

```yaml
provenance:
  source_repo: "github.com/anthropics/skills"
  source_ref: "skills/pdf"              # path within repo
  commit_sha: "a1b2c3d…"                # EXACT commit — the content-address anchor
  content_hash: "sha256:…"              # hash of the normalized artifact bytes (see §0.2)
  upstream_license: "Apache-2.0"        # SPDX id, resolved per-artifact (see Plan 3 triage)
  license_verified: true                # a real LICENSE/SPDX header was found, not assumed
  ingested_at: "2026-07-08T…Z"
  ingest_pipeline_version: "1.0.0"
  fetched_by: "learning_agent"          # actor label, NOT a userId
```

### 0.2 Signing + content-hash pinning (extends the package format)

- Add `content_hash` (sha256 over canonicalized artifact) and an optional `signature` block to the
  package manifest / Commons publish envelope. `versionPin` becomes a **content hash**, not a label.
- Commons publish (`POST /v1/packages`) gains a verification step **after** the privacy gate and
  `parsePackageManifest`: recompute the hash from the payload; reject `409`-style on mismatch.
  Published versions stay immutable (existing rule).
- **Publisher identity**: v1 Commons is a *curated, human-published* registry, so the publisher is
  the Bridge maintainer operating the ingestion pipeline — sign with a Bridge-held key. When the
  registry lifts to Bridge Cloud, the same signature slot carries a real publisher cert. Community
  contribution (self-serve publish) stays **out of scope for v1**; it is the External band and would
  require the full signing chain plus per-artifact human review.

### 0.3 Origin & sandbox posture (config change, first-class)

- All three pipelines set `origin: community` on every produced `CapabilityManifest` (the foreign
  importer already hard-codes this via `FOREIGN_IMPORT_ORIGIN`). Community === untrusted === treated
  as `user_code` for risk/promotion purposes — **no trust shortcut for being on GitHub**.
- **Drop the MCP sandbox exemption.** `requiresSandbox()` must return `true` for `mcp-server`, and
  any executable artifact (skills shipping `scripts/`, agents, activepieces pieces) must carry
  `sandboxPolicy.isolation !== "none"` or `translateForeignCapability` returns `{ ok: false }` (the
  guard already exists — this just removes the carve-out). MCP tool *outputs* are tainted
  `untrusted_external` and can never trigger a `propose()` without a human.
- **Quarantine before publish.** Ingested artifacts land in a quarantine store (the
  `intake_policy.quarantine` flag the tools model already declares), inert until a human review step
  promotes them to a Commons publish. Capture ≠ publish, exactly as capture ≠ commit elsewhere.

### 0.4 Manifest gap this plan opens (log to punch-list)

`PackageManifest`/`CapabilityManifest` have **no `license` or `provenance` field today**. Both must
be added (additive, optional at parse time initially, required for `origin: community`). Filed as a
follow-on to ADR-018. Until added, provenance rides in the publish envelope's `tags` + a sidecar,
never smuggled into gate-denied keys.

---

## PLAN 1 — Ingest OSS agent-SKILLS from GitHub into the Commons

### 1.1 The pipeline (fetch → normalize → map → risk → quarantine → review → publish)

```
GitHub repo (pinned commit)
  → S1 FETCH        clone at commit_sha, read-only; enumerate skill units
  → S2 LICENSE      resolve per-artifact SPDX license; STOP if incompatible (§Plan3 triage)
  → S3 NORMALIZE    format adapter → Canonical Intermediate Representation (CIR)
  → S4 MAP          CIR → PackageManifest + CapabilityManifest(s)  [origin: community]
  → S5 RISK         computePackageRisk() — executable (scripts/) ⇒ sandbox required; trifecta union
  → S6 DEDUP        similarity vs Component Registry + already-published Commons packages
  → S7 QUARANTINE   inert record; provenance + content_hash attached
  → S8 HUMAN REVIEW External band — reviewer reads the EXACT artifact (not the description)
  → S9 PUBLISH      sign → POST /v1/packages → immutable Community-origin package
```

Stages S1/S2/S3/S6 are new ingestion tooling. S4/S5/S8/S9 reuse existing seams
(`parsePackageManifest`, `computePackageRisk`, `pipeline.propose/decide`, Commons publish contract).

### 1.2 Format heterogeneity — the adapter layer

The 15 repos ship at least four on-disk conventions. A single `SkillFormatAdapter` port with one
adapter per format emits a **Canonical Intermediate Representation (CIR)**; only the CIR→manifest
mapper (S4) knows Bridge types. This is the same ports-and-adapters discipline the codebase uses
everywhere (`SkillFormatAdapter` sits beside `ModelProvider`, `CommonsRegistry`, etc.).

```yaml
skill_format_adapters:
  anthropic_skill_md:      # anthropics/skills, alirezarezvani, simota, most
    detects: "SKILL.md with frontmatter { name, description }"
    reads: [name, description, body_markdown, scripts/, references/, assets/]
  openclaw_clawhub:        # VoltAgent/awesome-openclaw-skills → ClawHub packages
    detects: "ClawHub package manifest (skill.json / registry entry)"
    reads: [id, title, prompt, tools[], registry_license]
  cursor_skill:            # spencerpauly/awesome-cursor-skills
    detects: ".cursor/rules or .mdc rule files"
    reads: [rule_name, glob_scope, instruction_body]
  codex_skill:             # RoggeOhta, ComposioHQ, OpenAI Codex directory
    detects: "codex skill dir (AGENTS.md / codex manifest)"
    reads: [name, description, commands[], body]
  gemini_skill:            # google-gemini, saeed-vayghan (has its own CLI converter)
    detects: "gemini skill manifest"
    reads: [name, description, tool_bindings[], body]
```

**CIR (adapter output, format-agnostic):**

```yaml
cir_skill:
  slug: string                 # normalized → kebab-case for package.name
  display_name: string
  description: string          # → summary + description (truncate to 1024, agentskills.io L1)
  instruction_body: markdown   # → references/ (L3, loaded on demand; never auto-into-context)
  scripts: [ {path, lang} ]    # PRESENCE ⇒ executable ⇒ sandbox required, risk escalates
  declared_tools: [string]     # → candidate connectors (each externalSend UNKNOWN → assume true)
  references: [ {path} ]
  assets: [ {path} ]           # NO seed DATA (no-dummy-data rule); templates/icons only
  provenance: { ...§0.1 }
  raw_license: string|null
```

### 1.3 Manifest-mapping schema (CIR → Bridge)

```yaml
map_cir_to_package:
  package.name:        cir.slug                         # kebab-case, unique in registry
  package.version:     "1.0.0"                          # first ingest; upstream bumps → new version
  package.kind:        "skill"
  package.summary:     cir.description[:first_sentence]
  package.description: cir.description[:1024]
  package.lineage_manifest_id: null                     # v1 import
  package.dependencies: []                              # cross-skill deps resolved manually in review
  package.capabilities:
    - id:              "{slug}.main"
      capability_type: "skill"
      origin:          "community"                      # ALWAYS — untrusted tier
      audience:        "private"                        # importer default; raised in review if shared
      permissions:     # DECLARATIVE skill (prose only, no scripts) → []  (informational risk)
                       # skill with scripts/ that read files → [{resource_type, action:read, data_scope:all, egress:false}]
                       # skill that calls a network tool     → egress:true  (→ external risk + trifecta leg)
                       # permissions are NEVER inferred from the description text ("a manifest can lie") —
                       # only from what the scripts/declared_tools actually touch, reviewed by a human
      connectors:      # one per declared_tool; externalSend defaults TRUE (conservative) until proven local
      dependencies:    []
  # provenance + content_hash ride the publish envelope (§0.4 gap)
```

**Risk expectations:** a pure-prose skill (instruction body only, no scripts, no tools) computes to
`informational` and is the safe common case. A skill shipping `scripts/` that fetch the network hits
`external` and is a lethal-trifecta candidate at install time — correct and intended.

### 1.4 License triage (which repos are safe to redistribute commercially)

Bridge embeds only permissive licenses (`docs/wiki/oss.md`): **MIT / Apache-2.0 / BSD / MPL-2.0 /
ISC / PostgreSQL**. Copyleft (GPL/AGPL/SSPL/BUSL/fair-code/CC-BY-NC) is rejected. For skills the
critical subtlety is **repo license ≠ artifact license**: the *awesome-list* repos are MIT-licensed
**indexes** whose entries point at third-party skills each carrying its own (often absent or
unknown) license.

| Repo | Repo license | Hosts or indexes? | Redistribution safety |
|---|---|---|---|
| anthropics/skills | Apache-2.0 (docx/pdf/pptx/xlsx = source-available, NOT OSS) | Hosts | SAFE — exclude the 4 source-available doc skills |
| alirezarezvani/claude-skills | MIT (hosts own 345) | Hosts | SAFE |
| simota/agent-skills | MIT (verify) | Hosts | SAFE if MIT confirmed |
| Orchestra-Research/AI-Research-SKILLs | permissive (verify) | Hosts | LIKELY SAFE — verify |
| google-gemini/gemini-skills | Apache-2.0 (verify) | Hosts | SAFE — needs gemini adapter |
| saeed-vayghan/gemini-agent-skills | verify | Hosts | VERIFY per-artifact |
| ComposioHQ/awesome-codex-skills | MIT list | Mixed | PER-ARTIFACT license resolve required |
| RoggeOhta/awesome-codex-cli | MIT list | Indexes | UNSAFE to bulk-redistribute — per-link resolve |
| spencerpauly/awesome-cursor-skills | MIT list | Indexes | UNSAFE to bulk — per-link resolve |
| VoltAgent/awesome-agent-skills (1000+) | MIT list | Indexes | UNSAFE to bulk — per-link resolve |
| VoltAgent/awesome-openclaw-skills (5400+) | MIT list → ClawHub | Indexes | UNSAFE to bulk — ClawHub per-skill license, curated-not-audited |
| sickn33/antigravity-awesome-skills (1800+) | verify list | Indexes | UNSAFE to bulk — per-link resolve |
| OpenAI Codex Skills directory | site ToS | Hosted directory | ToS review — treat as index |
| Agensi Skills Marketplace | commercial site, security-reviewed | Marketplace | PARTNER, don't scrape (see §1.6) |

**Rule enforced at S2:** an artifact with no resolvable OSS-permissive license is **quarantined and
never published** — no license = no redistribution. This is a hard stop, not a warning.

### 1.5 Dedup / similarity vs the Component Registry

The Module-Evolution Component Registry + similarity detection (ADR-032, designed-not-built) is the
natural home for S6. On ingest, embed the CIR (slug + description + body) and compare against
(a) already-published Commons packages and (b) built-in capabilities. Three outcomes: **near-dup**
(skip, link as alternate provenance), **variant** (publish as a distinct package, cross-referenced),
**novel** (publish). This directly serves the Commons thesis — recognizing that many workspaces
develop the *same* pattern and generalizing it once.

### 1.6 Ranked ingestion order (value × safety)

1. **anthropics/skills** — canonical SKILL.md, Apache-2.0, official, small/high-trust. Proves the
   pipeline end-to-end. (Exclude the 4 source-available doc skills.)
2. **alirezarezvani/claude-skills** — MIT, hosts its own 345, agentskills.io standard, professional
   domains (engineering/marketing/product/compliance/research) that map 1:1 onto Bridge workspace
   archetypes. Highest volume-of-safe-value.
3. **simota/agent-skills** — 124 specialist skills across dev/security/design/testing/compliance;
   doubles as agent-primitive input for Plan 2.
4. **Agensi Skills Marketplace** — do NOT scrape; **pursue as a provenance/signing partner**. Its
   8-point automated security scan is exactly the S8 pre-filter Bridge wants; a feed of
   already-security-reviewed SKILL.md skills would sharpen the whole moat.
5. **Orchestra-Research/AI-Research-SKILLs** + **google-gemini/gemini-skills** — smaller, official/
   research-grade; gemini needs its adapter.
6. **saeed-vayghan/gemini-agent-skills**, **ComposioHQ/awesome-codex-skills** — per-artifact license
   resolution; useful workflow-automation skills.
7. **The large index repos** (VoltAgent ×2, antigravity, RoggeOhta, spencerpauly, OpenAI directory)
   — LAST, and never bulk. Mine them as *discovery surfaces*: resolve each candidate skill's own
   license and re-fetch from its source repo at a pinned commit. The 5400+/1800+/1000+ counts are
   reach, not ingestible inventory.

### 1.7 Phased rollout (Plan 1)

- **P1 (Weeks 1-3)** — Build §0 (provenance, content-hash, signing slot, drop MCP exemption,
  add manifest `license`/`provenance` fields). Anthropic-SKILL.md adapter + CIR + S4 mapper. Ingest
  anthropics/skills. Manual S8 review. First honest Community-origin publishes.
- **P2 (Weeks 4-6)** — License resolver (S2) + quarantine store (S7) + Component-Registry dedup (S6).
  Ingest alirezarezvani + simota.
- **P3 (Weeks 7-10)** — OpenClaw/Cursor/Codex/Gemini adapters. Agensi partnership conversation.
  Selective per-artifact ingest from the index repos.

---

## PLAN 2 — Integrate KINDS of AGENTS from GitHub into the Commons

Anchored on **ashishpatel26/500-AI-Agents-Projects** (MIT-licensed catalog; 20+ industry categories;
frameworks LangGraph / CrewAI / AutoGen / Agno / LlamaIndex).

### 2.1 What's actually in the catalog (and what that means)

The repo is a **catalog of agent *projects*** organized by industry use-case
(healthcare, finance, education, customer service, retail, logistics, legal, HR, cybersecurity,
software-dev, media, …), each built on a heavyweight agent framework. Critically: it is an **index
of external projects**, so — exactly as in Plan 1 — the MIT catalog license does **not** cover the
underlying projects, and most projects are *full agent applications* (a LangGraph graph, a CrewAI
crew), **not** a Bridge-shaped agent (goal + identity + capability_scope, one governed draft/turn).

**Bridge does not import agent runtimes.** It imports the *pattern* an agent project embodies and
re-expresses it as a governed Bridge Agent capability under the Chief-of-Staff star topology. The
catalog's real value is as a **domain-blueprint and workflow-archetype source** — the "workflow
archetypes / reusable capability patterns" the Commons is explicitly for.

### 2.2 Taxonomy → mapping onto Bridge's agent primitive

| Catalog agent kind | Bridge mapping | Fit / posture |
|---|---|---|
| Research / RAG / "study scholar" | Learning Agent behavior OR a research Skill | GOOD — read-only, advisory band |
| Drafting / summarization / report | Communications Agent behavior / draft Skill | GOOD — draft-then-approve native |
| Customer-service / support chatbot | Helpdesk workspace capability (governed) | GOOD — maps to existing Helpdesk |
| Recruiting / HR matching | JobPilot-adjacent scoring Skill | GOOD — deterministic scoring, no autonomy |
| Sales / recommendation | DealPilot-adjacent Skill | GOOD |
| Trading / autonomous financial execution | — | **REJECT** — autonomous money movement violates governed-execution + External floor |
| Cybersecurity red-team / autonomous exploit | — | **REJECT** — offensive autonomy, lethal-trifecta by design |
| Autonomous delivery / robotics / control loops | — | **REJECT** — physical-world actuation, out of thesis |
| "Self-healing" autonomous multi-agent swarms | — | **REJECT** — no one-governed-draft-per-turn, no star topology |
| Medical diagnosis / clinical decision | — | **REJECT for v1** — regulated, needs domain compliance track |

**Principle:** anything **read/advisory/draft-shaped** fits Bridge's privacy-first, draft-then-approve
thesis. Anything **autonomously executes an irreversible external action** (money, physical control,
sending, offensive security) is rejected — Bridge's External band is always human at launch and the
agent-floor DENYs `external:send` regardless of origin.

### 2.3 The agent-import contract

An external agent project becomes a governed Bridge Agent via the existing foreign importer path
extended with an `agent-project` source type (joins `pi-package | mcp-server | activepieces-piece |
oss-integration`):

```yaml
agent_import:
  source: "agent-project"
  provenance: { ...§0.1, framework: "langgraph|crewai|autogen|agno|llamaindex" }
  # NOT imported: the framework runtime, the project's own model/orchestration loop
  # IMPORTED: the pattern → a Bridge Agent capability
  translated_capability:
    capability_type: "agent"
    origin: "community"
    goal: string                         # what the agent is for (from project README, human-verified)
    identity: string                     # its persona/role label
    capability_scope:                    # the permissions the Bridge agent may request
      permissions: [ {resource_type, action, data_scope, egress} ]
      connectors:  [ {id, external_send} ]
    topology: "star_under_chief_of_staff" # NON-NEGOTIABLE — no peer-to-peer agent swarms
    turn_contract: "one_governed_draft_per_turn"
    write_access: "none"                 # agents PROPOSE, never approve (agent-floor)
    sandbox_policy: { isolation: "container", network_egress: "off_by_default" }
```

**Governance wrapping (all mandatory, none optional for community agents):**
- Runs under **Chief of Staff** star topology — never a free multi-agent mesh, however the upstream
  project was wired.
- **One governed draft per turn**, no independent write access; every effect is a `pipeline.propose`
  a human decides on.
- `external:send` is agent-floor DENY — an imported agent literally cannot draft an egress as itself.
- Computed risk on `capability_scope`; the lethal-trifecta union check applies; External band = human
  review of the exact translated capability.
- Sandbox required (agents are executable); network egress off inside sandbox by default; tainted
  outputs (`untrusted_external`) cannot trigger `propose()` without a human.

### 2.4 Ranked onboarding + phasing (Plan 2)

Onboard categories in trust-ascending order: **Research/RAG → Drafting/Comms → Support (Helpdesk) →
Recruiting/Sales scoring**. Reject the autonomous-execution categories outright.

- **P1** — Add `agent-project` source to the importer + the agent-import contract. Model 3-5 Research/
  RAG catalog patterns as read-only advisory Agent capabilities. Human review each.
- **P2** — Drafting/Comms + Support patterns; wire into Helpdesk/Comms-Agent behaviors.
- **P3** — Recruiting/Sales scoring patterns as deterministic Skills feeding JobPilot/DealPilot.
  Publish the surviving patterns as **domain blueprints** in the Commons.

---

## PLAN 3 — Reusable commercial MODULES from OSS software projects

Where Plans 1-2 ingest declarative/agent knowledge, Plan 3 **internalizes whole OSS software
projects** into commercially-reusable Commons Modules, using the existing tools-internalization model
(`docs/wiki/tools.md`, ADR-006): **internalize = internal modified copy, contract at the edges only**.

### 3.1 The internalization pattern (rebind 3 edges)

Bridge never takes a live runtime dependency on an upstream. It takes an **internal, modified,
vendored copy** at a pinned commit and rebinds exactly three edges (the rest of the project's FE/BE
stays as-is — "broad/flexible pathway, contract at the edges"):

1. **Model calls → `ModelProvider`** (local-default plane).
2. **Persistence → the governed store / quarantine** (never the live graph directly).
3. **Output → typed `output_contract`** mapping to Bridge primitives.

The internal copy is a versioned, diffable, rollbackable artifact; upstream is just `v0`. Packaged, it
becomes a Commons Module (`package.kind: tool | integration_bundle | view`).

### 3.2 License strategy — what's safe to build a commercial product on

This is the make-or-break of Plan 3. Bridge is a commercial product, so a Module may embed **only**
permissive code:

| Class | Licenses | Commercial-embed verdict |
|---|---|---|
| Permissive | MIT, Apache-2.0, BSD-2/3, MPL-2.0 (file-level copyleft OK), ISC, PostgreSQL | SAFE to internalize + ship |
| Weak copyleft | LGPL | CASE-BY-CASE — dynamic-link only, risky when vendored; avoid |
| Strong copyleft | GPL-2.0 / GPL-3.0 | **TRAP** — infects the product; REJECT |
| Network copyleft | AGPL-3.0 | **TRAP** — SaaS use triggers source disclosure; REJECT |
| Source-available | SSPL, BUSL, fair-code (n8n), Elastic | REJECT — not OSS, commercial restrictions |
| Data licenses | CC-BY-NC (OpenSanctions data) | REJECT — non-commercial |

**Already-flagged rejections to honor** (`docs/wiki/oss.md`): **Cal.com (AGPLv3), Nextcloud (AGPLv3),
Radicale/Baïkal (GPL-3.0)** — never embed a calendar product/server; also Plane/Leantime/ToolJet/
ParadeDB/Lantern (AGPL), Inngest server (SSPL, SDK OK), n8n (fair-code), OpenProject/Budibase-core
(GPL). **MPL-2.0 is the important nuance**: its file-level copyleft is compatible with a commercial
product as long as modified MPL files stay open — usable, unlike GPL/AGPL. (This is why ical.js is an
accepted calendar pick.)

**Gate S2 for Modules:** resolve the project's SPDX license *and every transitive dependency's*
before any internalization work — a permissive top-level with an AGPL dependency is still an AGPL
trap.

### 3.3 The Module-creation pipeline

```
OSS software project (permissive-verified, pinned commit)
  → fork/vendor internal copy
  → rebind 3 edges (ModelProvider / governed store / output_contract)
  → wrap as PackageManifest (kind: tool|integration_bundle|view) with declared permissions
  → computePackageRisk() + trifecta union
  → conformance test (manifest validates, edges rebind, no upstream live dep)
  → sign + provenance (upstream license carried in NOTICE/attribution)
  → Commons publish (Community-origin, or built_in if Bridge-authored wrapper)
```

Attribution/NOTICE files travel with the Module (Apache-2.0 §4 and MIT both require attribution).

### 3.4 Roadmap — which OSS categories to modularize first

Prioritize categories that (a) serve a live Bridge use-case, (b) are reliably permissive, and (c) are
"adopt behind a port" per the build-the-moat/adopt-behind-port rule:

1. **Calendar rendering + RFC-5545 math** — react-big-calendar (MIT), ical.js (MPL-2.0),
   ical-generator (MIT), Luxon (MIT). Serves the Calendar workspace; picks already locked.
2. **Identity resolution** — Splink + nomenklatura (permissive); feeds people/company-sourcing dedup.
3. **Skill/app scaffolding** — Refine + Dyad (permissive); feeds Capability-Builder generation.
4. **Ritual/workflow engine adapters** — Hatchet (check RLS), LangGraph interrupt/checkpoint patterns.
5. **Document/RAG processing** — Docling (Python sidecar behind a port), embedding/parser utilities.
6. **Connector adapters** — MCP SDK + FastMCP (permissive) as Module-shaped integration bundles —
   **with the §0.3 sandbox posture applied** (MCP treated as untrusted egress, no protocol exemption).

Sequencing: **P1** calendar + identity-resolution Modules (live use-cases, licenses cleared). **P2**
scaffolding + document/RAG. **P3** engine adapters + connector bundles. Each ships only after the S2
transitive-license gate and a conformance test proving the three edges rebind and no live upstream
dependency remains.

---

## Unified architecture (all three plans)

One ingestion spine, three source-type front-ends, all converging on the existing Commons publish
contract and trust model:

```
[Plan1 skills] [Plan2 agents] [Plan3 software]
      \             |              /
   format/source adapters → Canonical Intermediate Representation
      → license gate (S2, hard-stop on non-permissive / unknown)
      → map → PackageManifest/CapabilityManifest (origin: community)
      → computePackageRisk() + lethal-trifecta union
      → dedup vs Component Registry
      → quarantine (inert; provenance + content_hash + signature)
      → HUMAN REVIEW (External band, reviews the exact artifact)
      → sign → privacy-gate → parsePackageManifest → POST /v1/packages (immutable)
```

Nothing bypasses the gate, the risk model, or human review. The moat Bridge is building — computed
risk, agent-floor, draft-then-approve, provenance/taint — becomes the very thing that makes ingesting
5000+ community skills *safe*, which is the competitive edge over ungoverned skill marketplaces.

## 2026-07-11 candidate intake additions

Research/inspiration candidates (not approved dependencies): `tinyhumansai/openhuman` (TokenJuice,
Memory Trees, integrations, model routing) · `chandra447/pi-hermes-memory` (policy-only retrieval,
correction/failure learning, consolidation, secret scan) · `Mintplex-Labs/anything-llm/open-computer`
(visible isolated agent computer) · `noahnan-max/private-equity-investment-dd-skill` ·
`yuping322/financial-services-plugins-new` · `sradgowski/deal-evaluator` ·
`xrishiraj/Private-Equity-Fund-Selection-through-ML` · `parolkar/SmallPE` (DealPilot patterns).
Each remains inert until pinned-commit license/artifact/transitive-dependency, security, provenance,
and conformance gates pass. Full evaluation: `optimizations-memory-vm-dealpilot-plan-2026-07.md`.

**SmallPE gate resolved 2026-07-11:** direct repository inspection found substantive agents,
workflows, templates, and tools. Its current license is FSL-1.1-Apache-2.0 Future License and defines
substantially similar commercial functionality as a prohibited competing use. Therefore SmallPE is
NOT a commercial-vendoring candidate today. Allowed next paths: obtain permission/commercial terms,
wait for applicable future-license conversion, interoperate without copying, or use independently
specified functional requirements. Details: `dealpilot-module-plan-2026-07.md` §4.
