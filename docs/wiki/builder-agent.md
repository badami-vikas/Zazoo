# Capability Builder Agent

full: [../raw/builder-agent-roadmap-2026-07.md](../raw/builder-agent-roadmap-2026-07.md)

Builder = 1 of 4 permanent agents (ADR-046). Turns approved intent →
draft capabilities + workspaces. NOT builder IDE/product — user never
"opens builder"; talks to CoS, drafts land in Approvals. Two invariants:
generation ≠ activation (Draft only, ADR-011); builds only inside closed
grammar (compileBlueprint views, sandbox code) + only AFTER intent approval.

**Researched 2026-07-11**: bolt.diy · Dyad (Pro) · Budibase · Appsmith ·
ToolJet. Pattern sources, not competitor frame. All five converge:
declarative JSON definition + generic interpreter (no codegen for UI),
agents under same RBAC/audit plane, governance = the paywall. Their 3
shared gaps = Bridge moat: no public definition spec, no native
propose→diff→approve, snapshot-only versioning.

**Patterns adopted**:
- bolt.diy: streamed action-artifact contract (each action = audit unit) ·
  asymmetric diffing (full-write generate, diff feedback) · file locking ·
  per-model prompt packs. NO WebContainers (commercial license).
- Dyad (Apache core, src/pro FSL): chat-turn ≡ ledger commit + additive
  restore · Smart Context/Turbo Edits = two-tier model economy (small model
  picks context + applies edits, frontier reasons) — also monetization seam
  (local free / cloud routing paid) · managed preview runtime.
- Budibase (GPL/MPL/BSL): component-tree DSL interpreted by generic client ·
  prop-schema manifests validate generated UI · agent never exceeds invoking
  RBAC.
- Appsmith (Apache-2.0, strongest direct-reference candidate): DB-as-truth
  Git-as-projection — deterministic serialize to diffable files, secrets
  never serialize · whole-app = one JSON · HITL steps in workflows.
- ToolJet (AGPL, clean-room only): stable node IDs + edit-by-reference ·
  one JSON definition = export = git-sync = promotion · permissions travel
  with definition · credentials never in artifact.

**Pipeline**: intent → research (Learning Agent, integration-over-build) →
spec → plan → generate (streamed governed actions) → validate (registry
conformance + sandbox + eval + security scan + license gate) → bounded
self-repair → package → propose (pre-apply diff card). 21 skills, 10
automations (all draft-producing, none activate).

**Invariants**: stable node IDs everywhere · DB truth / git projection ·
credentials never serialize · restore = fork, never in-place · single live
version · origin=AI-generated recorded, risk computed never declared.

**Slices BA0–BA6**: BA0 toolbelt+sandbox (fs:read/write, code:exec, E2B +
isolated-vm, PromptAssembler) · BA1 workspace gen v2 (stable IDs,
edit-by-reference, real-data preview) · BA2 capability gen (scaffolds,
manifests, packages, evals) · BA3 validation lane · BA4 approval surface
(git projection + diff cards + "install instead?") · BA5 evolution loop
(drift, introspect-own-artifact, repair-on-SUSPEND, staged propagation) ·
BA6 economy + Commons (two-tier routing, cost receipts, prompt packs,
generalize→publish). Same universal exit gate as DealPilot slices.

**Strengthened 2026-07-12**: §6 now per-slice
goals/deliverables/exit-criteria/dependencies + §6.1 metrics + §6.2 risk
register. Load-bearing gates: BA0 containment suite = permanent CI (zero
sandbox escapes, monitored invariant) · BA1 node-ID stability test
(precondition for evolution, kept forever) · BA3 seeded bad-draft suite
(injection/license/grammar/secrets all blocked) · BA4 zero secrets in git
projections + install-instead fires on duplicates · BA5 three-way-merge
test (customizations never clobbered) · BA6 two-tier cost drop MEASURED vs
baseline + Commons scrubber (zero user data). Key metric: %
integrate-instead-of-build should RISE as Commons grows. Top risks:
sandbox escape, injection-via-research (lethal trifecta), license
contamination, grammar creep, repair burn, governance fatigue. BA4
consumes Governance GA1 risk blocks; BA1+ consumes Learning LA3/LA4
research; PromptAssembler = shared build with LA1.

BA0/BA1 refine existing P0–P1 tracks (ADR-017/019/026/036), do NOT reorder
H2 sequencer. Pull-forward → APPROVALS.

## 2026-09-02 — BA0 STARTED. Builder can act now.

**Before**: `builder-primitives.ts` classified risk since F2, zero callers.
Persona + text draft = whole agent. Roadmap `proposed`, no TASK rows.

**Now shipped** (45 tests):
- `primitive-policy.ts` — execute / approve / refuse. NOT two outcomes.
  execute = reads + declared writePaths + allowed commands (empty policy
  → execute, ADR-263). approve = leaves machine / credentials / outside
  declared. refuse = push·merge·rebase·reset --hard·main·rm -rf·sudo,
  unlockable by nobody. Refuse list scoped to REVIEWABILITY not danger.
- `builder-loop.ts` — 1 action/step, constrained JSON on existing
  ModelProvider (no port change, runs local llama). Named stops only.
  needs_approval HALTS loop (else model narrates work that never ran).
- `primitive-executor.ts` (api) — first code that actually executes. 2 path gates,
  minimal spawn env, audits execute+escalate+refuse alike.

**Execution-first** (user directive): governance ≠ blocking. Roadmap's
implicit propose-everything is REVERSED → ADR-266.

**ADR-027 scoped, not weakened**: container/microVM still mandatory for
UNTRUSTED bodies (Commons/import/generated). HostPrimitiveExecutor covers the
other case — user's own folder, own machine, own request; boundary =
allow/deny + branch-and-merge (myzazoo model). `isolation:
"host-process"`, not assignable to SandboxProvider.

**Chat gained a BACKEND axis** beside plane (ADR-265): Claude Code =
Agent SDK headless in API process, terminal never shown. OAuth PKCE →
Local Plane vault. Backend declares residency → cloud thread. NO cloud
grant (can't disclose a context the external agent chose). Codex/Cursor
= registry rows. Avatar inherits via same ChatView.

**NOT done**: no container adapter · no CI containment suite · zero
browser evidence. → TASK-092.
Plan: [../raw/builder-agent-execution-plan-2026-09.md](../raw/builder-agent-execution-plan-2026-09.md)

## 2026-09-02 (later) — chat continuity + Module sessions

Model switch NO LONGER clears chat. `setBackend` repoints LIVE thread,
turns stay. New engine gets `priorTurnsTranscript` (20 turns / 12k, user
words verbatim, assistant truncated) — else it answers as if nothing
was said. Clearing predates agentic backend: plane selector always did
`newChat`. Both fixed.

Cross-plane switch relabels private→public = export to Anthropic. User
chose **carry silently** (offered: prompt-once / silent / summary).
ADR-267(c) names the revisit trigger: first non-owner user. Store still
records; only the PROMPT is gone.

Module sessions: `module_name` + `attached_modules` (mig 0045),
`forModule` resumes live thread, `attachModule` = multi-project session.
**UI does not call either yet** → TASK-093.

## 2026-09-02 (wiring pass) — built ≠ shipped (ADR-268, AP-174)

`builder.run` procedure = the Run seam. Module governance answers
`builder.run` FIRST (refuses in user's own words). One executor per Run;
its audit hook → ledger, every call (ran / escalated / refused). Run
closes with ONE receipt: stop reason, model, calls, tokens. Loop now
counts usage per step + per run. Local Plane only.

Empty `ModulePrimitivePolicy` on purpose: dotted governance selectors ≠
shell globs, don't collapse them. ABSOLUTE_DENY still bites.

Builder has a uuid identity now (`BUILDER_AGENT_RUNTIME_ID`) — ledger
`actor_id` is uuid, `builder:task-manager` is not an actor.

Chat panel on a Module opens THAT Module's thread (Layout → AgentPanel →
ChatView → `useChat(surface, moduleName)`). Agentic turn's
`changedPaths` = a turn ref, not prose.

Standing rule in CLAUDE.md: wire in the same run you build, or write
NOT LANDED.
