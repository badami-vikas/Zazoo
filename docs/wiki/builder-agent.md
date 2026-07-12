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

BA0/BA1 refine existing P0–P1 tracks (ADR-017/019/026/036), do NOT reorder
H2 sequencer. Pull-forward → APPROVALS.
