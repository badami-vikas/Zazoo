---
title: Capability Builder Agent Roadmap — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [module-evolution-system-2026-07.md, capability-package-format.md, dealpilot-module-plan-2026-07.md, clean-room-capability-research-protocol-2026-07.md, oss-commons-integration-plan-2026-07.md, brain-engine-execution-plan-2026-07.md]
related_wiki: ../wiki/builder-agent.md
updated: 2026-07-13
tags: [builder-agent, capability-builder, generation, compiler, workspaces, packages, evolution, reuse]
---

# 0. Product decision

The Capability Builder is one of Bridge's four permanent platform Agents (ADR-046). It is the component that turns approved intent into draft capabilities and draft workspaces — Skills, Automations, Agent archetypes, Integrations, Blueprints, and whole capability packages. It is **not a separate builder product, IDE, or app-builder destination**. Users never "open the builder"; they converse with Chief of Staff, and Builder output arrives as governed proposals in Approvals.

Two invariants frame everything below (ADR-011, ADR-046):

- **Generation ≠ activation.** The Builder only ever produces `Draft` state. Activation always round-trips through the Capability Trust Model and the work pipeline (`pipeline.propose`/`decide`).
- **The Builder builds only AFTER approval of intent** and only within the closed grammar: generated workspaces are configurations of registered components (`compileBlueprint` + `<DataViews>` enforcement), never new UI components; generated code runs only inside `SandboxProvider`.

```yaml
builder_position:
  upstream:
    - Chief_of_Staff: sole router; owns the conversation and the final proposal into Approvals
    - Learning_Agent: researches integrations/competitors/overlap BEFORE building (integration over custom development, ADR-020)
    - Governance_Agent: risk-scores every draft; sole holder of auto-approve-MINOR
  builder_outputs:
    - WorkspaceBlueprint (compiled + previewed via compileBlueprint)
    - capability manifests: skill | workflow | agent | tool | view | integration_bundle | workspace_definition
    - capability packages (bridge.package.yaml bundles)
    - eval cases, migrations, prompt packs, diff explanations
  downstream:
    - Capability Trust Model: computed risk, states Draft→…→Active, lethal-trifecta escalation
    - Approvals: pre-apply diff, human decision
    - Runtime + evolution loop: observation → new Builder drafts
```

Reference platforms researched for this plan (2026-07-11): bolt.diy, Dyad (incl. Pro), Budibase, Appsmith, ToolJet. They are **pattern sources, not the competitive frame** — Bridge is not an app builder or low-code tool; the Builder is an internal organ of Living Software. Their convergent 2025–26 architecture (declarative JSON app definitions interpreted by a generic runtime; agents as governed capabilities atop workflow engines; governance as the paywall) confirms Bridge's kernel bets. Their three shared gaps are the Builder's moat: no stable public spec for app definitions, no first-class proposal/review flow on definition changes, and versioning bolted on rather than native diff-then-approve.

# 1. Design lens — builder surfaces

## 1.1 No builder IDE

Principle: the Builder is invisible infrastructure. Its surfaces are embedded in existing chrome (chat, Approvals, Activity, workspace preview). Never a canvas of draggable widgets; the user's "drag-drop editor" is conversation plus governed diffs. Confidence-tiered flow per ADR-032: high confidence → do and state; medium → recommend one, confirm; low → 2–3 labeled options with a stated pick. Never surface agent/skill/workflow/schema nouns mid-flow — user vocabulary is Assistant/Tool/Automation/Knowledge/Connection/Module.

## 1.2 Build session (conversation)

- Runs inside Chief of Staff conversation (`chiefOfStaff.converse`); Builder is dispatched, never addressed cold.
- **Persistent build context**: the session remembers prior turns, generated artifacts, and user corrections (ToolJet pattern: persistent conversational context).
- **Edit by reference, not regeneration** (ToolJet): every generated element carries a stable node ID; "make the second column a date" resolves to a node patch, not a fresh generation. Requires stable IDs in the Blueprint spec (see §5).
- Two modes mirrored from Dyad/bolt.diy practice: **Ask** (discuss, zero writes) and **Build** (produces drafts). Build mode's every materialized step lands in the ledger (§1.5).
- User edits made directly to a draft feed back to the Builder as diffs, not full artifacts (bolt.diy asymmetric-diffing pattern): generation emits full definitions for determinism; human deltas travel as diffs to keep the loop token-cheap and customization-aware.

## 1.3 Proposal card + pre-apply diff

The Builder's primary "screen" is the Approvals card:

- what changes: human-readable summary (Communications skill `draftCommunication`) + structural diff of definitions;
- why: originating intent, research trail from Learning Agent, similar existing capabilities found (similarity detection — install/extend beats build);
- risk: computed band, origin axis (AI-generated), lethal-trifecta verdict, dependency closure;
- evidence: eval results, sandbox run records, license/provenance record for any reused source;
- rollback: what reverting restores (fork-from-history semantics, never in-place revert).

Diffs render from the **git-projection** of definitions (§5): Appsmith's DB-as-truth/Git-as-projection pattern makes every proposal a reviewable file diff without making git the source of truth.

## 1.4 Draft preview

- Workspace drafts: compiled client-side with the real `compileBlueprint()` and rendered in the `<DataViews>` shell against the user's real data in read-only preview — or an honest empty state. No dummy rows (AP-002).
- Capability drafts: a dry-run panel — inputs in, outputs out, inside the sandbox, with the run record attached to the proposal.
- Old-version preview before rollback (Dyad pattern): show the historical definition rendered, then fork.

## 1.5 Build activity and receipts

Every build session appends to the immutable Activity timeline: intent, model/prompt versions, files/definitions touched, sandbox commands, tokens/cost (Optimizations receipts), approvals. **Chat-turn ≡ ledger entry** (Dyad's chat-turn-≡-commit, generalized): the evolution history of a workspace is readable as a conversation, and restore is additive — history is never destroyed.

## 1.6 Evolution proposals

The Builder's ongoing surface after v1: unprompted improvement cards. Source signals: usage, failures, drift, user friction, Commons updates. Behavior per module-evolution ADR-032 and the Dust-Sidekick learning: the Builder **introspects its own prior artifact** (config + usage + feedback) and proposes a concrete diff, never a fresh regeneration. Local customizations are never silently overwritten.

## 1.7 Failure and repair

Failed capability run → auto-SUSPEND (Trust Model) → Builder drafts a repair: reads run logs/errors in the sandbox (Dyad Smart-Agent pattern), produces a candidate fix as a normal governed proposal. Safety never queues; repair always does.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  intent_capture:
    - conversational need discovery during onboarding and steady state
    - ambiguity resolution via confidence-tiered questions, never forms
  research_before_build:
    - Learning Agent checks installed software/browser apps (explicit permission, stated intent)
    - Commons + Component Registry similarity search; install/extend/wrap beats build
    - live per-domain competitor/capability research at blueprint time (never hardcoded)
  specification:
    - intent → typed spec: entities, views, vocabularies, automations, integrations, policies
    - user vocabulary always wins; Bridge-theme alignment by default
  generation:
    - WorkspaceBlueprint emission within the closed view grammar
    - Skill / Automation / Agent-archetype / Integration scaffolds + capability manifests
    - package assembly (bridge.package.yaml), migrations, eval cases, prompt packs
  validation:
    - manifest parse + Component Registry conformance
    - sandboxed execution, held-out evals, security & prompt-injection scan
    - license/provenance gate on any reused source
  approval_and_activation:
    - pre-apply diff proposal; Governance risk scoring; human decision (auto-approve MINOR only)
    - activation via existing pipeline; single-live-version promote/demote
  observation_and_evolution:
    - run records, cost receipts, failure capture, drift detection
    - introspect-own-artifact improvement drafts; versioned updates with staged propagation
  commons_generalization:
    - strip user data, generalize, publish capability knowledge to Universal Commons (knowledge only)
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - autonomous activation, promotion, or trust-band elevation of anything the Builder generated
  - generating new UI components, view kinds, or shell chrome outside the registered grammar
  - kernel modification: the Builder builds Commons content, never Kernel code
  - executing generated code outside SandboxProvider, or granting it standing credentials
  - embedding secrets/credentials in any generated artifact (CredentialBroker only)
  - copying or lightly paraphrasing license-restricted code, prompts, or templates (clean-room protocol applies)
  - egress capabilities auto-approved: External band is always human-approved at launch
  - bulk/unattended external sends generated as a side effect of a build
  - bypassing website terms, authentication, or data-use rights during research or generation
  - cross-tenant reuse of user data in generation; Commons receives generalized knowledge only
  - representing generated capability quality as guaranteed; eval results ship with confidence, not promises
```

# 3. Technical lens

## 3.1 Builder pipeline and generation contract

```yaml
builder_pipeline:
  stages:
    intent: normalized request + constraints from CoS conversation
    research: Learning Agent handoff — integrations, overlap, domain patterns
    spec: typed spec synthesis; user validates only ambiguous bits
    plan: build plan artifact (Markdown plan before code — bolt.diy roadmap pattern)
    generate: definitions + scaffolds emitted as streamed governed actions
    validate: parse → registry conformance → sandbox run → evals → security scan → license gate
    repair: bounded self-repair loop on validation failure; escalate after N attempts
    package: manifests + bridge.package.yaml + migrations + eval set
    propose: diff projection + risk computation + Approvals card
  generation_contract:
    form: streamed action artifacts (bolt.diy boltArtifact/boltAction pattern, governed)
    action_types: [definition_write, file_write, sandbox_exec, eval_run]
    property: each action = one audit/approval/rollback unit in the ledger
    determinism: full-definition emission on generate; diffs only for human-edit feedback
```

## 3.2 Skills

```yaml
builder_skills:
  - intent-to-spec-synthesis
  - similarity-and-overlap-detection
  - integration-first-mapping           # installed-software/API discovery → integration proposal
  - blueprint-generation                # WorkspaceBlueprint within closed grammar
  - blueprint-edit-by-reference         # node-ID-addressed patches
  - vocabulary-generation-and-alignment
  - skill-scaffold-generation
  - automation-scaffold-generation      # trigger/idempotency/budget/retry/stop-condition complete
  - agent-archetype-generation
  - connector-generation-from-spec      # OpenAPI/CC0-spec → governed connector (day1-integrations factory)
  - manifest-authoring-and-risk-annotation
  - package-assembly                    # bridge.package.yaml, progressive-disclosure layout
  - migration-authoring
  - eval-case-generation                # every build ships its own held-out eval set
  - prompt-pack-authoring               # per-model prompt packs as versioned artifacts
  - sandbox-run-and-log-analysis
  - self-repair-from-failure
  - diff-explanation                    # via Communications skill for the human summary
  - license-and-provenance-audit
  - artifact-introspection              # own config + usage + feedback → improvement diff
  - generalize-for-commons
```

## 3.3 Automations

```yaml
builder_automations:
  - validation-lane-on-draft-created            # parse→conformance→sandbox→eval→scan, auto
  - eval-regression-rerun-on-dependency-change
  - failed-run-repair-draft                     # post-SUSPEND, drafts fix proposal
  - drift-detection-and-improvement-candidate   # usage/failure/friction signals → candidate
  - commons-update-available-proposal           # upstream version → staged update card
  - dependency-and-license-watch
  - prompt-pack-eval-on-model-change
  - build-cost-receipt-and-budget-guard
  - stale-draft-expiry-and-cleanup
  - propagation-staging                         # approved update → staged rollout across Initiatives
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, and immutable run record. Nothing in this list activates capabilities; they produce or maintain drafts and records.

## 3.4 Toolbelt, runtime, and model economy

- **Toolbelt (ADR-026)**: `fs:read` / `fs:write` / `code:exec` as governed capability primitives — Bridge's equivalents of Read/Write/Bash, always through the pipeline.
- **Sandbox (ADR-036)**: `isolated-vm` for narrow JS transforms; **E2B** for shell/`code:exec`; Pi-style minimal tool surface inside the sandbox; managed runtime bundled so environment setup is never the user's failure class (Dyad managed-Node lesson).
- **PromptAssembler**: layered system-prompt uplift; per-model prompt packs are first-class versioned capability artifacts (bolt.diy's admitted one-prompt-many-models failure mode, inverted).
- **Model economy (two-tier, Dyad Smart-Context/Turbo-Edits pattern)**: small/cheap model selects relevant context (definitions, files, memory) and materializes routine edits; frontier model does spec synthesis and generation reasoning. `ModelProvider` seam; local models remain viable for the capture/sensor plane and for cost-sensitive apply steps. This split is also the monetization seam (local core vs Bridge Cloud routing/optimization) — same shape as Dyad free/Pro and ToolJet AI credits.
- **Interpreter over codegen for surfaces** (Budibase/Appsmith/ToolJet convergence): workspaces are declarative definitions interpreted by the shell — regeneration is a definition write, no build step. Codegen exists only for capability scripts, and those run only in the sandbox.

# 4. Reuse-first source map

No Builder capability should be rebuilt from scratch before importer/wrapper/adaptation review. When direct reuse is license-limited, apply `clean-room-capability-research-protocol-2026-07.md` (lawful research → feature inventory → black-box benchmarks → independently authored spec → outcome comparison; never copy protected code, prompts, templates, or distinctive expression).

```yaml
reuse_policy:
  order:
    - install_or_import_existing_permissive_skill
    - wrap_existing_tool_or_repository_behind_Bridge_port
    - adapt_existing_template_or_workflow_with_attribution
    - integrate_upstream_runtime_without_copying_when_license_allows_service_use
    - build_minimal_Bridge_native_gap_only_after_documented_review
  gates:
    - pinned_commit
    - repository_and_artifact_license
    - transitive_dependencies
    - security_and_prompt_injection
    - provenance_and_signature
    - contract_and_eval_conformance
```

Source decisions (researched 2026-07-11):

```yaml
sources:
  stackblitz-labs/bolt.diy:
    use: streamed action-artifact generation contract (StreamingMessageParser, message-parser.ts — code-verified 2026-07-13 WebContainer-FREE, portable, ships tests+golden snapshots); asymmetric diffing (diff.ts — feedback picks smaller of unified-diff vs full content, confirmed); per-chat file locking (lockedFiles.ts — client-side localStorage only, Bridge re-backs with definition DB); prompt VARIANT registry (prompt-library.ts — corrected: promptId-selected variants, NOT model-conditioned; per-model packs are Bridge's extension of the registry pattern); plan-before-code
    mode: MIT code — adapt parser/diff/locks; action-runner.ts is REFERENCE-ONLY (WebContainer-bound executor — the dependency is concentrated there, re-author against Tauri/sandbox); DO NOT adopt WebContainers
    link: https://github.com/stackblitz-labs/bolt.diy
  dyad-sh/dyad:
    use: chat-turn≡commit ledger (response_processor.ts processFullResponseActions — one commit/turn, commitHash on messages row) + additive restore (git_utils.ts gitStageToRevert — revert = new commit on top, history never rewritten; both code-verified 2026-07-13); OS-keychain secrets (settings.ts Electron safeStorage); Smart Context / Turbo Edits two-tier model economy; auto-approve-safe-tool-calls precedent
    mode: core Apache-2.0 adapt/reference; src/pro is FSL-1.1 — clean-room only (Smart-Context/Turbo-Edits prompts, search-replace DSL, entire local_agent tool engine, MCP auto-consent enforcement ALL live there). TWO TRAPS (verified): root package.json says "MIT" — wrong, LICENSE file governs; Apache response_processor.ts:49 imports FSL applySearchReplace — sever that seam on port (full-write path Apache, diff-edit apply clean-room)
    link: https://github.com/dyad-sh/dyad
  budibase/budibase:
    use: JSON component-tree DSL interpreted by generic client; prop-schema manifests validating generated UI; per-workspace isolated definition DB; agents-never-exceed-invoking-RBAC invariant; agent-in-automation with typed output schemas
    mode: tri-license (GPLv3 core / MPL client / BSL pro) — pattern adoption; MPL component-schema ideas referenceable; no GPL/BSL vendoring into kernel
    link: https://github.com/budibase/budibase
  appsmithorg/appsmith:
    use: DB-as-truth Git-as-projection serialization (code-verified 2026-07-13 — appsmith-git module: DB → GitResourceMap intermediate → diffed file tree; per-entity ExportableService plugins; deterministic Gson converters for stable diffs; secrets exclusion = ENTIRE datasourceConfiguration nulled on git-sync, DatasourceExportableServiceCEImpl.sanitizeEntities); code-defined workflows with first-class HITL approval steps; RBAC granular to query/datasource
    mode: Apache-2.0 — strongest direct-reference candidate, CONFIRMED (CE/EE boundary is code-structural, all load-bearing serialization = CE/Apache in-repo); adapt with attribution; DROP their SHARE+exportWithConfiguration branch (the one path that serializes decrypted secrets); flatten Spring @Primary CE/EE ceremony on port
    link: https://github.com/appsmithorg/appsmith
  ToolJet/ToolJet:
    use: single versioned JSON definition serving export+git-sync+promotion; edit-by-reference with stable node IDs and persistent conversational context; permissions attached to the definition; agents=workflows+LLM nodes under one governance plane; credentials-never-in-artifact
    mode: AGPLv3 — patterns only via clean-room; no code reuse into a commercial service
    link: https://github.com/ToolJet/ToolJet
```

Cross-platform doctrine distilled (what all five prove):

- declarative definition + generic interpreter is the winning substrate for LLM generation — emit and patch documents, not code;
- agents belong under the same RBAC/audit/execution-log plane as everything else — Bridge already holds this line (Trust Model);
- governance is universally the paywall (RBAC granularity, audit, SSO, environments, git) — Bridge ships it as kernel, which is the differentiation;
- the shared gaps — no stable public definition spec, no native propose→diff→approve on definition changes, snapshot-not-diff versioning — are exactly Bridge's pre-apply-approval moat. Do not trade it away for speed.

# 5. Data and capability model

Primary Build graph:

```yaml
BuildRequest:
  relates_to:
    - Intent               # originating Request from CoS conversation
    - ResearchFindings     # Learning Agent output; overlap/integration candidates
    - Spec                 # typed, versioned
    - BuildPlan            # plan-before-code artifact
    - WorkspaceBlueprint   # stable node IDs throughout
    - CapabilityManifest   # one per generated capability
    - Package              # bridge.package.yaml assembly
    - EvalSet              # generated with the build
    - SandboxRun           # immutable execution records
    - ValidationReport     # conformance + security + license verdicts
    - Proposal             # pipeline.propose round-trip
    - Diff                 # git-projection of definition changes
    - ActivationDecision
    - EvolutionSignal      # usage/failure/drift feeding the next BuildRequest
    - Memory               # corrections, failures, user preferences applied
```

Invariants:

- **Stable node IDs** on every Blueprint/definition element — the precondition for edit-by-reference, targeted diffs, and non-destructive evolution;
- **DB as truth, git as projection**: authoritative definitions live in `workspace_definitions`/capability stores; a deterministic serializer produces the diffable file tree for review; secrets never serialize (CredentialBroker refs only);
- **Credentials never in artifacts**; environment-resolved constants re-bind on install (ToolJet hygiene);
- **Chat-turn ≡ ledger entry; restore is additive** — build history is immutable, rollback forks;
- **One live version per workspace** (Zapier model, already shipped for packages) extends to Builder-generated updates: promote auto-demotes, rollback forks from history;
- every generated artifact records origin=AI-generated, model/prompt versions, and its evidence — the risk axis is computed from these, never declared.

# 6. Delivery sequence

Universal exit gate (applies to every slice, in addition to its own criteria): source/license record, manifest risk computed, tests, held-out eval, browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, and no dummy runtime data.

```yaml
slices:
  BA0:
    goal: a safe place to build — governed toolbelt + sandbox, provably contained
    depends_on: [pipeline propose/decide (shipped), ADR-026 toolbelt, ADR-036 sandbox]
    deliverables:
      - fs:read / fs:write / code:exec as governed capability primitives, always through the pipeline
      - SandboxProvider live: isolated-vm (narrow JS transforms) + E2B (shell/code:exec), Pi-style minimal tool surface, managed runtime bundled
      - PromptAssembler v1 (layered system-prompt uplift); every build action lands in the immutable ledger with cost receipt
    exit_criteria:
      - containment suite green: sandbox has no network/fs/credential reach beyond explicit grants; escape attempts (seeded) all blocked and logged
      - no code path executes generated code outside SandboxProvider (negative test, kept as a permanent CI gate)
      - every sandbox_exec appears in the ledger with model/prompt versions + tokens/cost attached
  BA1:
    goal: conversation -> workspace draft -> targeted edit, on real data, without regeneration
    depends_on: [BA0, compileBlueprint + workspace_definitions (shipped)]
    deliverables:
      - intent -> typed-spec synthesis with confidence-tiered clarification (never forms)
      - blueprint emission with stable node IDs on every element; edit-by-reference node patches
      - real-data read-only draft preview via client-side compileBlueprint (or honest empty state)
      - Ask vs Build session modes; human edits fed back as diffs (asymmetric diffing)
    exit_criteria:
      - generate -> "make the second column a date" -> re-preview loop works; the change lands as a node patch (diff-size audit proves patch, not rewrite)
      - node IDs survive regeneration of unrelated parts (stability test — the precondition for evolution)
      - preview shows the user's real data or an honest empty state; zero dummy rows (AP-002)
  BA2:
    goal: the Builder emits capabilities, not just surfaces — each born with its manifest and its own evals
    depends_on: [BA0, capability-package-format]
    deliverables:
      - skill / automation / agent-archetype / connector scaffolds (automation scaffolds trigger/idempotency/budget/retry/stop-condition COMPLETE, never partial)
      - manifest authoring + risk annotation; bridge.package.yaml assembly; migration authoring
      - eval-case generation: every build ships a held-out eval set as part of the artifact
    exit_criteria:
      - one generated skill + one generated automation pass the (BA3) validation lane and install as a normal package
      - every generated artifact records origin=AI-generated + model/prompt versions + evidence (risk is computed from these, never declared)
      - the generated eval set actually executes and gates the artifact (not decorative)
  BA3:
    goal: nothing unvalidated reaches a human approver — the lane filters, the human decides
    depends_on: [BA1, BA2, Component Registry]
    deliverables:
      - validation lane automation on draft-created: manifest parse -> registry conformance -> sandbox run -> held-out evals -> security/prompt-injection scan -> license/provenance gate
      - bounded self-repair: read failure logs in-sandbox, draft fix, retry <= N, then escalate with the failure report attached
    exit_criteria:
      - seeded bad-draft suite fully blocked: grammar violations, injection payloads (incl. instructions hidden in researched web content), license-restricted code, contract breaks, embedded secrets
      - repair loop provably bounded: N failures -> escalation with human-readable failure report; budget spent on repair capped and receipted
      - validation verdicts attach to the proposal record (approver sees evidence, not assertions)
  BA4:
    goal: the approval card becomes the Builder's real UI — diff, why, risk, evidence, rollback, or "install instead"
    depends_on: [BA3, Governance Agent GA-risk scoring (see governance-agent-roadmap-2026-07.md)]
    deliverables:
      - deterministic definition -> git-projection serializer (DB as truth, git as projection; secrets never serialize)
      - pre-apply diff cards: structural diff + draftCommunication summary + originating intent + research trail + risk band + eval/sandbox evidence + rollback semantics
      - similarity detection: overlap with existing/Commons capabilities surfaces "install/extend instead?" before generation completes
    exit_criteria:
      - a real build renders a complete card (all six elements) and round-trips propose -> human decide -> activate through the existing pipeline
      - serialized tree scanned: zero credentials/secrets in any projection (permanent gate)
      - a duplicate build request triggers the install-instead prompt with the matched capability linked (integration-over-build enforced at the surface, not just policy)
  BA5:
    goal: the Living-Software loop closes — the Builder improves its own artifacts without trampling the user's customizations
    depends_on: [BA4, runtime signals (usage/failure/drift), Trust Model SUSPEND]
    deliverables:
      - evolution signal intake (usage, failures, friction, Commons updates) -> improvement candidates
      - artifact introspection: prior config + usage + feedback -> concrete diff proposal, never fresh regeneration
      - repair-on-SUSPEND: failed run -> auto-SUSPEND -> repair draft as a governed proposal
      - versioned updates + staged propagation across Initiatives; single-live-version promote/demote; rollback forks from history
    exit_criteria:
      - forced capability failure -> SUSPEND -> repair proposal appears with logs attached; safety never queues, repair always does (timing test)
      - improvement card cites the real signals that produced it (no vibes-based proposals)
      - three-way-merge test: user's local customization survives an upstream/template update; nothing silently overwritten
  BA6:
    goal: builds get cheap and knowledge compounds — model economy + Commons publication
    depends_on: [BA5, ModelProvider seam (shipped)]
    deliverables:
      - two-tier routing: small model selects context + materializes routine edits; frontier model does spec synthesis/generation reasoning
      - cost receipts + budget guard per build session (runaway builds halt, receipted)
      - per-model prompt packs as versioned capability artifacts, eval-gated on model change
      - generalize-and-publish: strip user data, generalize, publish capability knowledge to Universal Commons
    exit_criteria:
      - measured cost drop vs single-frontier-model baseline on a fixed build suite, with no eval regression (the two-tier bet verified, not assumed)
      - budget guard halts a seeded runaway build mid-session with a clean partial-state ledger
      - Commons scrubber eval: published package contains zero user data / tenant-identifying content (hard gate — Commons is knowledge only)
```

## 6.1 Success measures

```yaml
metrics:
  throughput: intent -> proposal card median time; drafts passing validation lane first try (build success rate)
  quality: post-activation failure rate of Builder-generated capabilities; repair-loop convergence rate (fixed within N)
  restraint: percent of build intents resolved by install/extend/integrate instead of generate (integration-over-build ratio — should RISE as Commons grows)
  economy: cost per build; two-tier savings vs baseline; budget-guard trips (each one inspected)
  trust: unapproved activations == 0; secrets in projections == 0; sandbox escapes == 0 (hard invariants, monitored)
  evolution: improvement proposals accepted rate; customizations clobbered == 0
```

## 6.2 Risk register

```yaml
risks:
  sandbox_escape:
    risk: generated code reaches network/credentials/fs beyond grants — the platform's worst failure
    mitigation: BA0 containment suite as permanent CI gate; E2B isolation + minimal tool surface; code:exec only via pipeline; escapes are a monitored zero-invariant
  prompt_injection_via_research:
    risk: Learning Agent research trail or user documents carry instructions that steer generation (lethal trifecta)
    mitigation: BA3 injection scan over ALL inputs incl. research content; researched content treated as data never instructions; trifecta verdict on every proposal
  license_contamination:
    risk: AGPL/BSL/FSL patterns leak into shipped artifacts as copied expression
    mitigation: license/provenance gate in the lane; clean-room protocol for restricted sources; provenance record on every reused element
  grammar_creep:
    risk: pressure to emit novel UI components/view kinds erodes the closed grammar (and with it validation + preview guarantees)
    mitigation: registry conformance is a hard lane stage; grammar extensions are kernel work through APPROVALS, never Builder output
  repair_burn:
    risk: self-repair loops consume budget chasing unfixable drafts
    mitigation: bounded N + budget cap + escalation with failure report; convergence rate monitored
  node_id_instability:
    risk: regeneration reshuffles IDs, silently breaking edit-by-reference and evolution diffs
    mitigation: BA1 stability test is an exit gate and stays as a regression test forever
  governance_fatigue:
    risk: every build interrupting the human trains reflexive-approve
    mitigation: auto-approve-MINOR stays Governance-Agent-scoped; card quality (evidence, diffs) makes review cheap; restraint metric keeps volume honest
```

Sequencing note: BA0/BA1 overlap existing P0–P1 commitments (ADR-017/019/026/036) and the module-evolution Day-1 ruling (4-agent onboarding team ships before Component Registry/eval wave) — BA slices refine those tracks, they do not reorder the H2 sequencer. Any pull-forward goes through `docs/APPROVALS.md`. Cross-roadmap: BA4 consumes the Governance Agent's risk scoring (`governance-agent-roadmap-2026-07.md`); research-before-build at BA1+ consumes the Learning Agent (`learning-agent-roadmap-2026-07.md`); the eval harness in BA3 is the Agent Quality eval model (EVAL-1/2).
