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

**Shipped 2026-08-06 (ADR-181)** — the chain, not the roadmap. Before this
Builder held ZERO skills: identity + role + governance row, nothing callable.
Now: `capability.draft`, one skill, one junction.

Chain = Strategist recommends → Builder drafts Manifest → Governance computes
verdict → Human approves. Structural, not conventional: `draftCapability`
takes ONLY a RecommendedState (can't build unasked) · `reviewDraft` takes ONLY
a DraftedState and COMPUTES its verdict (no verdict parameter exists) · NO
`approved` phase, no `approve()` — chain ends at "reviewed" = fit to ASK ·
`humanApprovalRequired: true` is the literal type · every junction throws on
wrong actor (Builder can't self-review).

Router = ONE door (`capabilityBuild.run`). No per-junction endpoint = no
bypass. Test asserts against router DEFINITION (a caller proxy answers any
name, can never prove absence).

Blockers: type substitution · claimed origin ≠ ai_generated (real trust-tier
escalation) · sandbox floor · shell:execute w/o execution spec ·
retrospective recommendation with zero citations. Blocked ⇒ NO capability row
written (else a human gets asked about what Governance refused to forward).

Scope unchanged: all 3 skills declare `signal:write`, which all 3 Agents
already held. Builder holds NO builder-primitive grant — writes manifests,
not files; runs no code.

Still open: `@builder` chat path unchanged (prose via passthrough) · builder
primitives implemented+tested+granted to nobody · BA0–BA6 above untouched.
