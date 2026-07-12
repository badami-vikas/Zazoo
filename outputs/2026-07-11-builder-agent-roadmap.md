---
title: Session Outputs — Capability Builder Agent Roadmap
date: 2026-07-11
status: complete
---

# Scope

User asked for a comprehensive Builder Agent roadmap in the style of the DealPilot plan, grounded in
live research of bolt.diy, Dyad (particularly Pro features), Budibase, Appsmith, and ToolJet. This
file records the user-facing outcome.

# Delivered

- **Plan**: [docs/raw/builder-agent-roadmap-2026-07.md](../docs/raw/builder-agent-roadmap-2026-07.md) —
  DealPilot-template structure: product decision, design lens (no builder IDE; build session,
  proposal cards, draft preview, receipts, evolution, repair), business lens (covered/excluded
  processes), technical lens (pipeline + generation contract, 21 skills, 10 automations,
  toolbelt/sandbox/model economy), reuse-first source map for all five platforms with license
  stances, Build data graph + invariants, BA0–BA6 delivery slices with the universal exit gate.
- **Wiki**: [docs/wiki/builder-agent.md](../docs/wiki/builder-agent.md) + index line.
- **ADR-048**: adopted generation-architecture patterns + per-source license stances.
- **Registry**: Plan Registry line in PROGRESS.md; log.md entry.

# Key conclusions

- All five platforms converge on declarative JSON definitions interpreted by a generic runtime, and
  on agents governed under the same RBAC/audit plane — independent confirmation of Bridge's
  compileBlueprint + Capability Trust Model bets.
- Their three shared gaps (no stable public definition spec; no native propose→diff→approve on
  definition changes; snapshot-only versioning) are exactly Bridge's pre-apply-approval moat.
- Patterns adopted: streamed governed action-artifacts (bolt.diy), chat-turn ≡ ledger commit +
  additive restore and the two-tier Smart-Context/Turbo-Edits model economy (Dyad Pro — also the
  local-free/cloud-paid monetization seam), DB-as-truth/git-as-projection diffable serialization
  with secrets never serialized (Appsmith), stable node IDs + edit-by-reference (ToolJet),
  interpreter-over-codegen with schema-validated component vocabulary (Budibase).
- License stances: Appsmith (Apache-2.0) strongest direct-reference candidate; bolt.diy MIT patterns
  yes but no WebContainers; Dyad `src/pro` (FSL-1.1), ToolJet (AGPL), Budibase pro (BSL) are
  clean-room-protocol only.
- Delivery: BA0 toolbelt/sandbox → BA1 workspace generation v2 → BA2 capability/package generation →
  BA3 validation lane → BA4 diff-approval surface → BA5 evolution loop → BA6 model economy + Commons
  publishing. Status `proposed`; refines existing P0–P1 tracks, no H2 sequencer reorder; any
  pull-forward via APPROVALS.
