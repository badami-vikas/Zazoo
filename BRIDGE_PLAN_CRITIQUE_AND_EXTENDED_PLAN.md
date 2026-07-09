# Bridge Plan Critique and Extended Plan

Date: 2026-07-07
Status: standalone review doc
Inputs reviewed:
- `BRIDGE_PLATFORM_RESET_HANDOFF.md`
- Attached draft: `Execution Plan - 2026-07 consolidation sprint`

This doc does not modify either source plan. It reviews both, flags conflicts and weak assumptions, pushes back where needed, and proposes a stronger extended plan after those issues are resolved.

## Executive Read

Both plans point in the right direction: no universal both-party consent, no runtime dummy data, one platform across clients, Day-1 avatar, ContextProvider seam, Capability Registry, Blueprints, progressive disclosure, and subagent-executable work.

The post-pivot consolidation plan is more ambitious and more product-complete than the handoff doc, but it also makes stronger claims that are risky or not currently verifiable in this repo. The handoff doc is safer, cleaner, and easier to hand to an agent, but it under-specifies the migration target, lacks stronger sequencing gates, and does not push hard enough on test strategy, sandboxing, package import security, and first-value onboarding.

My strongest recommendation:

Do not execute either plan as-is. Use the handoff doc as the stable brief, then apply the consolidation plan's stronger product lanes only after adding discovery gates, safety gates, and a stricter target-codebase map.

## Source-of-Truth Problem

The attached plan names several artifacts that are not discoverable in the current workspace:

```text
apps/web
ADR-026
ADR-023
ADR-019
capability/lifecycle.ts
PromptAssembler
package_installations
workspace_definitions
fs:read / code:exec capability primitives
```

The current repo visibly contains:

```text
Design Bridge AI Interface (Copy)/
platform/
Tools/
docs/
```

Pushback:

Before any implementation, the controller agent must map actual targets. A plan that says "migrate prototype design to apps/web" is dangerous if `apps/web` does not exist in this checkout. That is exactly how agents make broad, wrong edits.

Required gate:

```bash
find . -maxdepth 4 -type f -name package.json -o -name routes.tsx -o -name vite.config.ts
rg -n "ADR-026|ADR-023|ADR-019|workspace_definitions|PromptAssembler|package_installations|capability/lifecycle" .
```

If these are absent, the plan must be rewritten to use actual paths or state that it targets another repo.

## Conflicts Between The Two Docs

### 1. Existing-doc modification policy

`BRIDGE_PLATFORM_RESET_HANDOFF.md` says existing docs should not be modified unless approved.

The attached plan starts with doc reconciliation and says A1 is already done, including changes to design docs and ADR-026.

Concern:

This conflicts with the user's corrected request: keep changes in a single handoff doc unless explicitly approved.

Resolution:

Make all doc changes patch proposals first. Do not mark A1 as done unless the repo actually contains those edits and the user approved them.

### 2. Test double purge

The handoff doc allows isolated test fixtures.

The attached plan says user overrode that and all test doubles must die, converting tests to live-credential integration tests.

Pushback:

I would not accept this as a default. Purging runtime dummy data is correct. Purging all test doubles is a quality regression.

Why:

- Unit tests need deterministic synthetic inputs.
- Live-credential tests are slower, flakier, harder to run locally, and can mask failures behind skipped environments.
- "No fake product data" and "no synthetic test fixtures" are different policies.
- Removing all test doubles makes CI dependent on external systems, which is the opposite of reliable engineering.

Recommended rule:

```text
Runtime product state: zero dummy data.
Unit tests: synthetic fixtures allowed if impossible to confuse with product data.
Integration tests: real credentials allowed behind env gates.
Demo/local seeds: disallowed unless explicitly launched as a demo mode and visually marked.
```

Use a stronger marker than `dummy_` for tests:

```text
test_fixture_
synthetic_
__fixture__
```

Then enforce:

```text
No `dummy_`, `9009`, `test_fixture_`, or `synthetic_` in runtime bundles.
Fixtures allowed only under test directories.
```

Question for user:

Do you mean "no dummy data in the running product" or literally "no synthetic test data anywhere"? I strongly recommend the former.

### 3. Consent model

Both docs align that both-party consent is not universal.

Concern:

The attached plan can overcorrect. It says "data owner controls own data." That is directionally right, but not enough. Some contexts still need participant consent, recipient consent, legal compliance, or workspace policy approval.

Resolution:

Use this policy:

```text
Owner controls private relationship data.
Outbound send/share requires governed approval.
Participant consent is required only when law, workspace policy, or surface policy requires it.
No silent enrichment.
No auto-send.
```

### 4. OSS adoption stance

The handoff doc says OpenFGA + OPA/Cedar should be studied.

The attached plan rejects OpenFGA/OPA/Cedar outright because Bridge governance is the moat.

Pushback:

Rejecting them outright is premature. Replacing Bridge's pipeline would be wrong, but studying policy engines does not require replacing the pipeline.

Recommended stance:

```text
Bridge Universal Action Pipeline remains source of truth.
OPA/Cedar can be evaluated only as policy-expression backends.
OpenFGA/SpiceDB can be evaluated only for enterprise ReBAC scale, not for day-one governance.
No swap unless a concrete scaling or enterprise requirement appears.
```

### 5. Sandbox strategy

The attached plan proposes local `isolated-vm` now and E2B/Daytona later.

Pushback:

`isolated-vm` is not a general Bash/code execution sandbox. It is acceptable for constrained JavaScript expression/code nodes only. It should not be the default implementation for `code:exec` or `shell:execute`.

Also, Daytona should not be treated as a clean OSS adoption target right now: its public repo says core development moved to a private codebase as of June 2026 and will receive no further updates. E2B remains a better current cloud-sandbox candidate for managed isolated execution.

Recommended split:

```text
ExpressionEngine: JMESPath/Jexl first, no arbitrary code.
JsCodeNode: isolated-vm only for narrow no-network transforms.
ShellExec: container/microVM/SandboxProvider only, never isolated-vm.
Cloud sandbox adapter: E2B first.
Daytona: pattern/reference only until maintenance model is clarified.
```

### 6. Firecrawl licensing

The attached plan lists Firecrawl under WebResearch.

Concern:

Firecrawl is useful, but the repo is AGPL-3.0 for the core project, while SDKs/some UI components have separate MIT licensing. Do not embed or fork casually.

Recommended stance:

```text
Use Firecrawl via hosted API or adapter boundary if terms fit.
Do not embed AGPL server code in Bridge.
Keep a plain Playwright/Stagehand path as fallback.
```

### 7. Nango licensing

The attached plan says Nango replaces per-integration OAuth code.

Concern:

Nango is useful, but current repo/docs state it is under Elastic License with limited free self-hosting. That is not the same as permissive OSS.

Recommended stance:

```text
Evaluate Nango for ConnectorProvider/AuthProvider.
Do not assume embeddable permissive dependency.
Require license/commercial review before product dependency.
Keep a minimal OAuth adapter seam for critical providers.
```

### 8. Activepieces import

The attached plan says Activepieces pieces can import as capability packages.

This is directionally good. Activepieces Community Edition is MIT and pieces are TypeScript, with MCP availability. The risk is not licensing as much as execution and permissioning.

Required guard:

```text
Never run an imported piece directly.
Translate manifest.
Declare permissions.
Version pin.
Sandbox executable logic.
Audit all runs.
Promote repeated patterns to native Bridge capability.
```

### 9. Avatar scope

Both docs agree avatar is Day 1.

Pushback:

The avatar should not be allowed to delay first value. It should communicate state and trust, not become a long animation project.

Recommended framing:

```text
Avatar v1 = operational status surface.
It shows: sleeping, listening, reading context, drafting, awaiting approval, blocked by policy.
Egg/hatch = onboarding progress, capped under 60 seconds.
Spirit animal = personalization, not required for core work.
```

Question for user:

Should the avatar be primarily a brand/personality layer, or an operational status/control surface? I recommend the latter with personality.

### 10. Prompt architecture

Both docs call for a better harness.

Concern:

"PromptAssembler" alone is not enough. The missing unit is a full "RunContext" contract that assembles prompt, context, permissions, tools, model config, output contract, and ledger trace keys.

Recommended kernel:

```text
RunContextAssembler
  - identity/persona
  - user request
  - selected object/page/surface
  - ContextProvider packs
  - disclosed skills/tools/packages
  - governance state
  - memory/retrieval snippets
  - output schema
  - trace/ledger metadata
```

Prompt text is just one projection of this run context.

### 11. UI migration target

The attached plan says "prototype design -> apps/web." The handoff doc targets the local prototype.

Concern:

This is the most important execution ambiguity.

Resolution:

First worker must answer:

```text
Is `Design Bridge AI Interface (Copy)` the product target?
Is `platform/` only backend/core?
Is there a missing `apps/web` in another worktree?
Should the hosted pages.dev site be cloned into current prototype or used only as visual reference?
```

Do not start UI migration until this is answered.

### 12. Model-specific subagent labels

The plans refer to Sonnet/Haiku.

Concern:

This environment may not expose those model names. The plan should specify complexity tiers, not vendor/model names.

Resolution:

Use:

```text
Small/fast worker: grep, simple edits, test fixtures, copy cleanup.
Standard worker: focused implementation across 1-3 files.
Strong worker: architecture, security, cross-cutting UX, review.
```

## Current Public Source Checks

These checks matter because several OSS calls in the plan are time-sensitive.

- Docling remains a strong document provider candidate. Its GitHub README describes parsing many formats, local execution, OCR, ASR, MCP/API server support, and MIT licensing. Source: [docling-project/docling](https://github.com/docling-project/docling).
- Nango is strong for integration auth and execution, but it is under Elastic License with limited free self-hosting, not a clean permissive embed. Source: [NangoHQ/nango](https://github.com/NangoHQ/nango).
- Activepieces Community Edition is MIT, and its pieces/MCP story is relevant for capability-package import. Source: [activepieces/activepieces](https://github.com/activepieces/activepieces).
- E2B is Apache-2.0 and describes secure isolated cloud sandboxes for AI-generated code. Source: [e2b-dev/E2B](https://github.com/e2b-dev/E2B).
- Daytona's public repo says it is no longer maintained as of June 2026. Treat as reference, not adoption target until clarified. Source: [daytonaio/daytona](https://github.com/daytonaio/daytona).
- Stagehand is a good browser-action candidate because it mixes code and natural language, previews/caches AI actions, and aims at repeatable workflows. Source: [browserbase/stagehand](https://github.com/browserbase/stagehand).
- Firecrawl is useful for search/scrape/extract, but core is AGPL-3.0. Use behind adapter/hosted API, not embedded. Source: [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl).
- Graphiti is a useful temporal context-graph reference, but it has graph backend requirements and defaults that may not fit Bridge's Postgres-first path. Source: [getzep/graphiti](https://github.com/getzep/graphiti).
- Langfuse remains a good observability/eval sidecar candidate; repo states MIT except `ee` folders. Source: [langfuse/langfuse](https://github.com/langfuse/langfuse).

## Stronger Extended Plan

This extended plan is what should emerge after the conflicts above are resolved.

### Phase 0: Hard Discovery Gates

Goal: prevent agents from editing the wrong codebase.

Owner: controller agent.

Tasks:

1. Map actual runnable frontend targets.

```bash
find . -maxdepth 4 -type f -name package.json -o -name vite.config.ts -o -name routes.tsx
```

2. Confirm whether these paths exist:

```bash
test -d apps/web
test -d "Design Bridge AI Interface (Copy)"
test -d platform
```

3. Search claimed artifacts:

```bash
rg -n "ADR-026|ADR-023|ADR-019|workspace_definitions|PromptAssembler|package_installations|capability/lifecycle" .
```

4. Produce `IMPLEMENTATION_TARGET_MAP.md` as a new standalone doc:

```text
frontend target
backend/core target
prototype reference
hosted UI reference
docs that are read-only
files with existing user edits
```

Exit criteria:

- No worker starts implementation until target map exists.
- Missing artifacts are marked as assumptions, not facts.

### Phase 1: Product Safety Spine

Goal: lock the behavioral invariants before visual/product work.

Tasks:

1. Consent policy reset:
   - No universal both-party consent.
   - Outbound send/share requires approval.
   - Participant consent only by policy/law/surface.
   - UI exposes policy reason.

2. Runtime data policy:
   - Runtime fake data forbidden.
   - Test fixtures allowed only under test paths with synthetic marker.
   - Demo mode, if needed, is explicit and visibly marked.

3. Capability taxonomy:
   - Add resource tokens for file/shell/browser/context providers.
   - Mark risk class for each.
   - No shell execution without SandboxProvider.

4. ContextProvider contract:
   - Provider outputs include permission, data scope, provenance, retention.
   - Screenshot is one provider, not the primitive.

Exit criteria:

```bash
rg -n "dummy_|9009" <runtime-source>
rg -n "both-party|double-opt|awaiting_both|both sides must approve" <runtime-source>
```

Both return no runtime violations.

### Phase 2: First-Value Onboarding With Avatar

Goal: make avatar real without turning it into decoration.

Recommended flow:

1. User signs in with email/password.
2. Workspace name inferred from email domain if business domain exists; otherwise `<Name>'s Workspace`.
3. User answers profession/goal in free text.
4. Bridge states a hypothesis:

```text
I think you are trying to build a relationship workspace for [goal].
I can start from [candidate package] and adapt it.
```

5. Bridge asks permission to inspect relevant sources:
   - Installed apps.
   - Downloads/documents.
   - Browser context.
   - Email/calendar.

6. Avatar egg progresses with actual setup state:
   - Identity captured.
   - Goal understood.
   - Context permission granted.
   - Candidate packages found.
   - Blueprint created.

7. Egg hatches only after first useful workspace appears.

Pushback:

Do not let angels/egg animation precede value. It should run alongside setup and explain system state.

Exit criteria:

- User gets a usable workspace without finishing every integration.
- Avatar has operational states:

```text
idle
listening
reading_context
drafting
awaiting_approval
blocked_by_policy
error
```

### Phase 3: UI Parity and IA Consolidation

Goal: reconcile hosted prototype, local prototype, and explicit IA changes.

Tasks:

1. Capture hosted site if possible.
2. Compare against local prototype.
3. Confirm final IA:
   - Home/composer.
   - Projects/Initiatives.
   - Knowledge Base.
   - Control Panel.
   - Tools.
   - Approvals/Signals.
   - Settings/Data Privacy.
4. Migrate visual language only after IA target is explicit.

Pushback:

"Match the prototype" and "apply all explicit IA changes" can conflict. The stronger rule should be:

```text
IA follows latest explicit product decisions.
Visual system follows hosted prototype.
When they conflict, preserve IA and adapt the skin.
```

Exit criteria:

- Visual parity screenshots.
- No dummy UI.
- No banned vocabulary.
- Control Panel and Knowledge Base are first-class.

### Phase 4: Builder OS Kernel

Goal: make Bridge able to build and evolve capabilities safely.

Tasks:

1. RunContextAssembler:
   - Builds model run context from persona, request, object/page, context providers, disclosed packages, governance state, memory, output schema, trace metadata.

2. Progressive disclosure:
   - Package may contain many skills/workflows.
   - Only relevant subset loads per run.
   - Enforce active tool/skill budget.

3. Capability Registry:
   - Packages as ingredients.
   - Blueprints as generated definitions.
   - Workspaces as instantiated blueprints.
   - Foreign imports require manifest translation and governance.

4. Builder toolbelt:
   - `file:read`, `file:write`, `file:edit`.
   - `shell:execute`.
   - `browser:read`, `browser:act`.
   - All routed through Universal Action Pipeline.

5. SandboxProvider:
   - `shell:execute` never runs raw on host.
   - Local container/microVM first if local-first is required.
   - E2B adapter as cloud option.
   - Daytona reference only until maintenance clarified.

Exit criteria:

- Agent can propose a code/file change.
- User approves.
- Action runs in sandbox.
- Ledger records input, diff, policy, result.
- Veto does not change code; it tunes policy/preferences.

### Phase 5: OSS Adapters Behind Ports

Goal: use outside leverage without surrendering product architecture.

Recommended order:

1. DocumentProvider:
   - Docling primary.
   - Tika fallback.
   - Keep local execution path for private docs.

2. ConnectorProvider:
   - Nango evaluation for OAuth/token handling.
   - Activepieces piece import as capability package source.
   - Do license/commercial review before dependency.

3. ObservabilityProvider:
   - Langfuse sidecar for traces/prompt/evals.
   - Keep Bridge ledger as system of record.

4. WebResearchProvider:
   - Stagehand/Playwright for browser actions.
   - Firecrawl hosted/API only if terms fit; do not embed AGPL server code.

5. MemoryGraphProvider:
   - Study Graphiti for temporal/provenance model.
   - Do not swap Bridge's Postgres-first graph until a concrete query need exists.

Exit criteria:

- Each provider has a port.
- Each provider has an adapter.
- Each adapter declares license/deployment risk.
- No provider is visible directly to user as product architecture.

### Phase 6: Conformance and Release Gate

Goal: make agents prove work instead of claiming it.

Required checks:

```bash
git status --short
npm run typecheck
npm run build
pnpm build
pnpm test
rg -n "dummy_|9009" <runtime-source>
rg -n "\\b(Lead|Leads|Deal|Deals|Pipeline|Contact|Contacts)\\b" <runtime-source>
rg -n "both-party|double-opt|awaiting_both|both sides must approve" <runtime-source>
```

Browser checks:

- Home.
- Onboarding/avatar.
- Projects/Initiatives.
- Knowledge Base.
- Control Panel.
- Approvals/Signals.
- Settings/Data Privacy.

Governance checks:

- Outbound action cannot auto-send.
- Private context cannot cross egress.
- Shell/code exec cannot run without sandbox.
- Imported package cannot run without manifest, permission, version pin, and audit.

## Revised Subagent Execution Model

Use task complexity, not vendor model names.

### Small/Fast Workers

Use for:

- Grep audits.
- Dummy inventory.
- Banned vocabulary scans.
- Simple copy replacements.
- Creating patch proposals.

### Standard Workers

Use for:

- One route or component group.
- Empty-state conversions.
- ContextProvider type tests.
- Package registry skeleton.

### Strong Workers

Use for:

- Consent/governance model.
- SandboxProvider and shell execution.
- Avatar/onboarding experience.
- UI parity synthesis.
- OSS ADR decisions.
- Final spec and code review.

## Safer Sequencing

```text
Week 0:
  Phase 0 target map and source-of-truth gate.

Week 1:
  Consent/data policy reset.
  Runtime dummy inventory.
  UI parity audit.
  OSS ADR review.

Week 2:
  Onboarding/avatar v1.
  Control Panel and Knowledge Base IA.
  ContextProvider contract.

Week 3:
  Capability Registry and Blueprint skeleton.
  RunContextAssembler.
  Progressive disclosure.

Week 4:
  Builder toolbelt.
  SandboxProvider.
  Package import prototype.

Week 5:
  Provider adapters: DocumentProvider, ConnectorProvider, ObservabilityProvider.
  Release conformance gate.
```

## Open Questions For User

1. Which codebase is the implementation target: `Design Bridge AI Interface (Copy)`, an absent `apps/web`, or another worktree?

2. Do you literally want to delete all synthetic test doubles, or only all dummy data from the running product? I strongly recommend preserving isolated synthetic unit fixtures.

3. Should the avatar be primarily a personality mascot or an operational status/control surface? I recommend status/control first, personality second.

4. Does the hosted prototype visual system override later IA changes, or should IA remain latest-decision source of truth while the prototype supplies the skin? I recommend latest IA plus prototype skin.

5. Are hosted services acceptable for egress-scoped adapters such as Nango, Firecrawl, and E2B, or must every provider have a local-first path before use?

6. What is the first pilot workflow that must work end-to-end? My recommendation: post-meeting capture -> Memory -> Signal -> governed Touchpoint -> Ledger.

## Final Recommendation

Use this hierarchy:

```text
Product invariants first.
Target-codebase map second.
UI parity third.
Avatar and onboarding fourth.
Builder/kernel capabilities fifth.
OSS adapters last.
```

The attached plan has useful ambition, but it should not be executed until it is grounded in the actual repo and corrected for test strategy, sandboxing, licensing, and target-codebase ambiguity.

