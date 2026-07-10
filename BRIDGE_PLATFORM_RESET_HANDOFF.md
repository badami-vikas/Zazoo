# Bridge Platform Reset Handoff

> **STATUS 2026-07-09 (ADR-044, AP-003): STABLE BRIEF of the reconciled consolidation trio.** Stronger product lanes come from `docs/raw/execution-plan-2026-07.md` but execute only behind discovery + safety gates. Critique `BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md` = accepted resolution. Tracker + registry: `docs/PROGRESS.md`.

This document consolidates the requested changes into one handoff artifact for another agent. It intentionally does not require modifying existing docs before execution. Treat this as the source brief for the next implementation pass.

## Source Inputs

- User request: re-evaluate prior instructions, resolve conflicts, and produce an execution plan suitable for Sonnet/Haiku-style subagents.
- Explicit updates from latest request:
  - Both-party consent must not be required globally.
  - Platform UI should match `https://bridge-ai-1ay.pages.dev/`.
  - Before creating ladders, evaluate whether items are peer options or sequential decisions. Only sequential chains become ladders.
  - Convert repeated ladders into internal workflows/Rituals where possible to save tokens and improve replay.
  - Avatar is required on Day 1.
  - Apply prototype design changes: control panel, knowledge base, projects/initiatives, and related chat-history changes.
  - Purge dummy data. Only real data should enter software from here on.
  - Keep LinkedIn pushback.
  - Taste and common UI are separate tasks.
  - Bridge should expose read/write/edit/bash-style capability surfaces through governed permissions.
  - System prompting should uplift user prompts similarly to Pi.dev or Claude Code.

## Reconciled Product Direction

### Consent

Replace “both-party consent everywhere” with:

- Private by default.
- Explicit visibility and sharing controls.
- Governed review for outbound/sensitive actions.
- Both-party or participant consent only when required by law, workspace policy, surface policy, or specific workflow.
- No silent enrichment.
- No auto-send.

Practical product rule:

```text
Intro suggestion = governed draft by default.
Outbound send = human approval.
Participant/both-party consent = policy-triggered exception, not universal platform invariant.
```

### Data

Replace “dummy data must be prefixed” as a runtime strategy with:

- No dummy/demo/mock data in runnable product surfaces.
- Existing `dummy_` and `9009` values become removal markers.
- New fixtures belong only in tests, docs examples, or isolated development harnesses.
- Product UI should render real imported/user-created data or empty states.

### Platform Shape

Bridge is one platform with three clients:

- Desktop: reference implementation, complete workspace, local execution, native context.
- Browser: first-class reach, collaboration, browser-native context, delegates privileged native work to Desktop.
- Mobile: capture, awareness, approvals, quick communication, quick action.

Users should think “I am using Bridge,” not “I am using Bridge Desktop/Web/Mobile.”

### Context Providers

The Learning Agent consumes typed context provider outputs, not screenshots as its core primitive.

Provider registry:

```text
Apps
Accessibility
Screen
Voice
Clipboard
Filesystem
Browser
Documents
Emails
```

Each context item should carry:

```text
provider
kind
payload
permission
data_scope
provenance
retention
```

Screenshot/screen capture is one provider output, not the architecture.

### Bridge Primitives

Borrow Pi’s philosophy, not its exact product shape:

```text
Extensions
Skills
Capability Packages
Blueprints
Workspaces
```

Definitions:

- Extension: low-level platform change such as connector, UI widget, runtime hook, parser.
- Skill: reusable reasoning/action unit with versioned input/output schema.
- Capability Package: bundle of objects, relationships, vocabulary, views, Signals, Rituals, Skills, Agents, Tools, governance rules, UI widgets, integrations, and blueprint fragments.
- Blueprint: generated software definition; packages contribute fragments, Learning Agent adapts, Workspace Generator compiles.
- Workspace: instantiated Blueprint with real data, permissions, and runtime state.

Package model:

- No App Store as primary mental model.
- Use a Capability Registry.
- Packages are candidate ingredients, not finished products.
- Onboarding/Learning Agent finds candidate packages, asks whether to use them, adapts them, and compiles a personalized workspace.

Foreign packages:

- Pi packages, MCP servers, OSS integrations, and third-party packages are foreign capabilities.
- Import through manifest translation.
- Wrap with Bridge governance, permission scopes, sandboxing, audit, version pinning, risk labels, and rollback.

### Ladders vs Workflows

Decision rule:

```text
Peer choices => table/board/canvas decision view.
Sequential dependencies => ladder.
Repeated ladder => compile into internal Ritual/workflow.
```

Do not force ladders onto peer alternatives. Ladders are for dependency chains.

### UI Surface Guardrails

Default generated view types:

- Table, including morphs such as calendar, board, map, graph, card.
- Chatbot/composer.
- Dashboard.
- Canvas.

No other generated view types unless user explicitly asks.

Relationships are visualized through graph or table.

### Day-1 Avatar

Avatar is not a later delight feature. It is part of Day 1.

Required behavior:

- Onboarding shows an egg being created in the background.
- User selects spirit/favorite animal during onboarding.
- As onboarding proceeds, egg rolls/evolves.
- At completion, egg hatches into avatar.
- Avatar persists on screen in meditating pose, eyes closed.
- Click wakes avatar and asks/reads current context through ContextProviders.
- Avatar blinks whenever screen context is captured.
- User can request a new software/workspace from current spirit animal; a new egg hatches into a new avatar/software instance.
- Merge/split of created software instances is future behavior, but architecture should not block it.

### Prototype UI Parity

Match the hosted Bridge UI at:

```text
https://bridge-ai-1ay.pages.dev/
```

If the agent cannot access it, it should:

- Record that access failed.
- Use the local prototype as current reference.
- Produce a parity audit before changing major UI.

Expected surfaces to audit:

- Home/composer.
- Sidebar and shell.
- Control Panel.
- Knowledge Base.
- Projects/Initiatives.
- Tools.
- Approvals.
- Settings.
- Data & Privacy.
- Connected apps.
- History/Memory/Playbook equivalents, translated to Bridge vocabulary.

### Vocabulary

Keep Bridge vocabulary strict:

```text
Person
Relationship
Memory
Community
Initiative
Ritual
Touchpoint
Signal
```

Avoid:

```text
Lead
Deal
Pipeline
Contact as noun
```

“Contact” as a verb should become “Reach out” or “Send Touchpoint.”

### Bridge Capability Surface

Bridge should model read/write/edit/bash capabilities, but never as raw unrestricted powers.

Recommended capability resources:

```text
file:read
file:write
file:edit
shell:execute
document:read
document:write
browser:read
browser:act
clipboard:read
clipboard:write
screen:read
accessibility:read
voice:capture
email:read
email:draft
external:fetch
external:send
```

Rules:

- Resource tokens are ceilings, not grants.
- Role grants intersect with capability scope.
- Ephemeral grants expire.
- Explicit deny wins.
- Shell execution is always governed, auditable, and policy-scoped.
- External send is never auto-commit.

## OSS Leverage Recommendation

Use OSS as replaceable providers behind Bridge interfaces, not as exposed product architecture.

Categories:

### Adopt/Evaluate Now

- Docling: primary document ingestion.
- Tika: fallback document extraction.
- Nango or Activepieces: integration/auth/action connector evaluation.
- Hatchet: ritual engine candidate, validate RLS.
- Refine: generated CRUD/table/page patterns.
- MCP SDK / FastMCP / SKILL.md: skill/tool import standards.
- Splink/nomenklatura: identity resolution.
- pgvector/pg_trgm: substrate retrieval.

### Study Now

- Graphiti: temporal graph memory.
- Langfuse: traces/prompt/eval lifecycle.
- DeepEval: automated quality checks.
- E2B or Daytona: generated-code sandbox.
- Firecrawl: web research/extraction.
- Stagehand: browser actions.
- screenpipe: optional Desktop ContextProvider.
- OpenFGA + OPA/Cedar: permissions + policy split.

### Pattern Only / Wrap Carefully

- Windmill / Trigger.dev: durable workflows and generated scripts.
- Weaviate/Qdrant/LanceDB: future retrieval backends.
- Appsmith/Baserow/NocoDB: generated app/table UX patterns, with licensing review.
- Pi packages: foreign capability imports only, never direct trust.

### Avoid Embedding Directly

- AGPL/SSPL/BUSL/fair-code/proprietary packages unless wrapped or reviewed legally.
- Any package that executes code without Bridge sandbox, audit, and permission mediation.

## Prototype Audit Findings

Explorer audit found:

- `src/app` has hundreds of `dummy_` matches across visible surfaces.
- Day-1 avatar/onboarding egg is missing.
- Control Panel is not first-class; current pieces are split between Settings, Tools, Approvals, and ledger.
- Knowledge Base exists inside Initiative detail but not as a first-class global surface.
- No-required-both-party-consent is not met; intro UI includes “Awaiting both parties” and “both sides must approve.”
- Vocabulary drift remains, especially “Contact” and Card Scanner language.

Key local files/routes:

```text
Design Bridge AI Interface (Copy)/src/app/routes.tsx
Design Bridge AI Interface (Copy)/src/app/Layout.tsx
Design Bridge AI Interface (Copy)/src/app/components/Sidebar.tsx
Design Bridge AI Interface (Copy)/src/app/components/AuthGate.tsx
Design Bridge AI Interface (Copy)/src/app/pages/HomePage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/WorkPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ToolsPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ResourcesPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/InitiativeDetail.tsx
Design Bridge AI Interface (Copy)/src/app/pages/SettingsPage.tsx
Design Bridge AI Interface (Copy)/src/app/components/PersonTiers.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ItemDetail.tsx
```

## Final Development Plan

This plan is written for a controller agent coordinating subagents. Use one worker per task. Do not run workers that edit the same file set in parallel.

### Task 0: Worktree Safety

Owner: main/controller agent.

Steps:

1. Run:

```bash
git status --short
```

2. Record pre-existing modified/untracked files.
3. Do not revert unrelated edits.
4. If using subagents, assign disjoint write scopes.

Acceptance:

- Controller knows current dirty worktree.
- No unrelated edits are reverted.

### Task 1: Doctrine Patch Proposal

Owner: documentation/planning worker.

Write scope:

```text
No existing docs unless explicitly approved.
If docs must change later, propose exact patches first.
```

Deliverable:

- A patch proposal for root project instructions and wiki/raw docs that:
  - Replaces universal both-party consent with policy-scoped consent.
  - Replaces dummy-data runtime convention with no-dummy runtime rule.
  - Adds one-platform/three-client direction.
  - Adds ContextProvider registry.
  - Adds Capability Registry + Blueprints.
  - Adds ladder-vs-workflow rule.

Acceptance:

- Proposal is self-contained.
- No existing docs are modified unless user approves.

### Task 2: Runtime Dummy-Data Purge

Owner: frontend worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/pages/HomePage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/WorkPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/SettingsPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/IntelligencePage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ItemDetail.tsx
Design Bridge AI Interface (Copy)/src/app/data/governance.ts
Other src/app runtime data files only if dummy scan requires it.
```

Steps:

1. Inventory:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
rg -n "dummy_|9009" src/app -g '*.ts' -g '*.tsx'
```

2. Replace fake data with:
   - Real Supabase/network/imported data where available.
   - User-created local store data where already real.
   - Empty states and import/create actions where no real data exists.

3. Do not strip `dummy_` while leaving fake data behind.

4. Add a guard script:

```json
"check:no-dummy-runtime": "rg \"dummy_|9009\" src/app -g '*.ts' -g '*.tsx' && exit 1 || exit 0"
```

Acceptance:

```bash
npm run build
npm run check:no-dummy-runtime
```

Both pass.

### Task 3: Consent Reset in Prototype

Owner: frontend governance worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/components/PersonTiers.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ItemDetail.tsx
Design Bridge AI Interface (Copy)/src/app/components/SignalsView.tsx
Design Bridge AI Interface (Copy)/src/app/data/signals.ts
```

Steps:

1. Find mandatory consent copy:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
rg -n "both-party|both party|double-opt|awaiting_both|both sides must approve|both parties|consent" src/app
```

2. Implement:
   - Visibility controls remain private/team/workspace.
   - Intro/reconnect suggestions become governed drafts.
   - Outbound send still requires approval.
   - Participant consent appears only when a policy flag requires it.
   - UI copy explains active policy reason instead of universal rule.

Acceptance:

```bash
npm run build
rg -n "both-party|both party|double-opt|awaiting_both|both sides must approve|both parties" src/app
```

Build passes and no mandatory two-party gate remains in runtime UI.

### Task 4: Day-1 Avatar and Onboarding Egg

Owner: frontend experience worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/routes.tsx
Design Bridge AI Interface (Copy)/src/app/components/AuthGate.tsx
Design Bridge AI Interface (Copy)/src/app/Layout.tsx
Design Bridge AI Interface (Copy)/src/app/components/AvatarOverlay.tsx
Design Bridge AI Interface (Copy)/src/app/pages/OnboardingPage.tsx
Design Bridge AI Interface (Copy)/src/app/data/onboarding.ts
Nearest theme/style file if needed.
```

Steps:

1. Inspect current shell:

```bash
rg -n "Layout|Onboarding|onboarding|AuthGate|Router|routes" "Design Bridge AI Interface (Copy)/src/app" -g '*.tsx'
```

2. Add onboarding preference seam:

```ts
type AvatarPreferences = {
  animal: string;
  eggHatched: boolean;
  avatarName?: string;
};
```

3. Persist locally until account settings exist.
4. Add onboarding egg screen with favorite/spirit animal selection.
5. Add persistent avatar overlay:
   - Bottom/right.
   - Meditating/asleep default.
   - Click wakes and emits/request current context placeholder.
   - Blinks on `screen-capture` custom event.

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
npm run build
```

Manual/browser verification:

- New users see onboarding.
- Completed onboarding shows avatar overlay.
- Clicking avatar changes awake state.
- Dispatching screen-capture event triggers blink.

### Task 5: ContextProvider Contract

Owner: platform/core worker.

Write scope:

```text
platform/packages/core/src/context-provider.ts
platform/packages/core/src/index.ts
platform/packages/core/test/context-provider.test.ts
```

Implement type contract:

```ts
export type ContextProviderName =
  | "apps"
  | "accessibility"
  | "screen"
  | "voice"
  | "clipboard"
  | "filesystem"
  | "browser"
  | "documents"
  | "emails";

export type ContextDataScope = "public" | "workspace" | "team" | "private" | "restricted";
export type ContextRetention = "turn" | "session" | "short" | "long";

export interface ContextItem<TPayload = unknown> {
  provider: ContextProviderName;
  kind: string;
  permission: string;
  dataScope: ContextDataScope;
  retention: ContextRetention;
  provenance: {
    source: string;
    capturedAt: string;
    subject?: string;
  };
  payload: TPayload;
}
```

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/platform"
pnpm --filter @bridge/core test
pnpm --filter @bridge/core build
```

### Task 6: Capability Registry and Blueprint Skeleton

Owner: platform/core worker.

Write scope:

```text
platform/packages/core/src/capability-registry.ts
platform/packages/core/src/index.ts
platform/packages/core/test/capability-registry.test.ts
```

Required types:

```text
Extension
SkillRef
CapabilityPackage
BlueprintFragment
Blueprint
WorkspaceInstantiation
ForeignCapabilityImport
RiskLabel
SandboxPolicy
PermissionDeclaration
RollbackRef
```

Rules:

- Keep as type-level skeleton unless existing validation pattern exists.
- Do not add a new dependency without justification.
- Foreign imports must require source, version pin, permission declaration, sandbox policy, audit flag, risk label, and rollback id.

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/platform"
pnpm --filter @bridge/core test
pnpm --filter @bridge/core build
```

### Task 7: Control Panel and Platform Navigation

Owner: frontend navigation worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/components/Sidebar.tsx
Design Bridge AI Interface (Copy)/src/app/pages/SettingsPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/ToolsPage.tsx
Design Bridge AI Interface (Copy)/src/app/data/tools.ts
Potential new ControlPanel page/component if route pattern supports it.
```

Goal:

- Compose Settings, Tools, Approvals, Ledger, Integrations, Skills/Agents, and capability controls into a clear Control Panel surface.
- Keep existing Bridge shell and prototype visual language.
- Do not make a marketing/landing page.

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
npm run build
```

Browser verification:

- Control Panel is discoverable.
- Governance and permissions are visible.
- Tool/Integration/Agent/Skill management does not feel like separate products.

### Task 8: Knowledge Base Surface

Owner: frontend knowledge worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/pages/ResourcesPage.tsx
Design Bridge AI Interface (Copy)/src/app/pages/InitiativeDetail.tsx
Design Bridge AI Interface (Copy)/src/app/data/resources.generated.ts
Design Bridge AI Interface (Copy)/src/app/data/db.ts
```

Goal:

- Rename/reframe Resources into Knowledge Base where user-facing copy requires.
- Keep files/documents as Bridge knowledge layer.
- Avoid fake resources.
- Tie Knowledge Base to Files, Memory, Initiatives, and retrieval-ready context.

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
npm run build
rg -n "dummy_|9009" src/app/pages/ResourcesPage.tsx src/app/pages/InitiativeDetail.tsx
```

### Task 9: UI Parity Audit

Owner: design/frontend audit worker.

Write scope:

```text
New standalone audit file only, unless user authorizes applying changes.
```

Steps:

1. Try to open:

```text
https://bridge-ai-1ay.pages.dev/
```

2. Capture desktop and mobile screenshots if tooling allows.
3. Compare against local prototype:
   - Shell.
   - Home/composer.
   - Control Panel.
   - Knowledge Base.
   - Projects/Initiatives.
   - Settings.
   - Data & Privacy.
   - Connected apps.
   - History/Memory/Playbook equivalents translated to Bridge vocabulary.

4. Produce exact implementation diffs:

```text
route/component
observed current behavior
desired behavior
files to edit
verification
```

Acceptance:

- Audit is actionable enough for workers to implement without guessing.

### Task 10: Remaining Detail-Page Scrub

Owner: frontend cleanup worker.

Write scope:

```text
Design Bridge AI Interface (Copy)/src/app/pages/AgentDetail.tsx
Design Bridge AI Interface (Copy)/src/app/pages/SkillDetail.tsx
Design Bridge AI Interface (Copy)/src/app/pages/IntegrationDetail.tsx
Design Bridge AI Interface (Copy)/src/app/pages/RitualDetail.tsx
Design Bridge AI Interface (Copy)/src/app/data/governance.ts
```

Goal:

- Remove dummy data.
- Remove mandatory both-party consent copy.
- Remove banned vocabulary in user-facing text.
- Convert fake metrics/logs to real traces or empty states.

Acceptance:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
npm run build
rg -n "dummy_|9009" src/app/pages/AgentDetail.tsx src/app/pages/SkillDetail.tsx src/app/pages/IntegrationDetail.tsx src/app/pages/RitualDetail.tsx src/app/data/governance.ts
rg -n "\\b(Lead|Leads|Deal|Deals|Pipeline|Contact|Contacts)\\b" src/app/pages/AgentDetail.tsx src/app/pages/SkillDetail.tsx src/app/pages/IntegrationDetail.tsx src/app/pages/RitualDetail.tsx
```

### Task 11: Final Verification

Owner: controller agent.

Run:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/Design Bridge AI Interface (Copy)"
npm run typecheck
npm run build
npm run check:no-dummy-runtime
rg -n --glob '!node_modules/**' --glob '!dist/**' 'dummy_|9009' src/app
rg -n --glob '!node_modules/**' --glob '!dist/**' '\b(Lead|Leads|Deal|Deals|Pipeline|Contact|Contacts)\b' src/app
rg -n --glob '!node_modules/**' --glob '!dist/**' 'both-party|both party|double-opt|awaiting_both|both sides must approve|both parties' src/app
```

Run platform checks:

```bash
cd "/Users/vikasbadami/Documents/Workspace/Relationship OS/platform"
pnpm build
pnpm test
```

Final review:

- Spec compliance review.
- Code quality review.
- Visual/browser review for main shell, onboarding/avatar, Control Panel, Knowledge Base, Work/Initiatives, and governed intro/reconnect flow.

## Recommended Subagent Allocation

Use smaller/cheaper agents for:

- Dummy-data inventory and mechanical removal.
- Vocabulary grep and copy cleanup.
- Writing guard scripts.
- Empty-state replacements.

Use stronger agents for:

- Consent/governance model changes.
- ContextProvider core contract.
- Capability Registry/Blueprint type model.
- Avatar/onboarding experience.
- UI parity audit and design decisions.

Do not run these in parallel because write scopes overlap:

- Task 2 and Task 10 if both touch detail pages.
- Task 3 and Task 10 if both touch `ItemDetail`/governance copy.
- Task 4 and Task 7 if both touch shell/layout/routes.

Safe parallel groups:

```text
Group A:
- Task 5 ContextProvider
- Task 6 Capability Registry
- Task 9 UI parity audit

Group B after audit:
- Task 2 dummy purge Home/Work/Settings
- Task 3 consent reset
- Task 8 Knowledge Base

Group C after shell decisions:
- Task 4 avatar/onboarding
- Task 7 Control Panel/navigation
```

## Final Notes for Implementing Agent

- Do not modify existing docs unless user explicitly approves.
- Preserve dirty worktree changes not owned by the task.
- Prefer `rg` for all searches.
- Use `apply_patch` for manual edits.
- Keep Bridge vocabulary strict.
- No fake data in runtime.
- No universal both-party consent gate.
- No auto-send.
- Every sensitive/outbound mutation goes through governance.
