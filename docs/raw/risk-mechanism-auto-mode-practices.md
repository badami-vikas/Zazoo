---
title: Dual-Axis Risk Mechanism + Auto-Mode Practices from ChatGPT/Claude
type: raw
doc_kind: design
status: proposed
companions:
  - capability-module-format.md
  - roadmap-v2-universal-commons.md
related_wiki: ../wiki/roadmap.md
updated: 2026-07-06
tags: [risk, governance, dual-axis, auto-mode, approvals, governance-agent]
---

# Dual-Axis Risk Mechanism (proposed, per user direction 2026-07-06)

Layered ON TOP of the shipped `computeRisk()` band model (informational → advisory → transformational → operational → external), not replacing it. Bands classify the CAPABILITY; the dual axis classifies each ACTION INSTANCE at proposal time.

## The two axes

```yaml
axis_impact:            # what the action can change
  read: 0               # reads only, no state change
  draft: 1              # creates a draft/proposal (nothing committed)
  internal_commit: 2    # commits state inside the workspace
  external_effect: 3    # leaves the workspace: send/publish/pay/delete-remote

axis_reversibility:     # can we get back to before
  free: 0               # versioned/undoable in one step (append-only stores)
  effortful: 1          # reversible with work (bulk edit w/ snapshot, re-import)
  irreversible: 2       # cannot be undone (email sent, money moved, data disclosed)
```

## Escalation class = matrix(impact, reversibility)

```yaml
matrix:                 # rows impact 0-3, cols reversibility 0-2
  - [minor,   minor,    minor]      # read
  - [minor,   minor,    moderate]   # draft
  - [minor,   moderate, major]      # internal commit
  - [moderate, major,   major]      # external effect
```

Modifiers (applied after the matrix, only ever UPWARD except trust):
- **Trifecta**: private-read + untrusted-ingest + egress in one closure ⇒ major, always.
- **Sensitivity**: touches PII / credentials / financial fields ⇒ +1 class.
- **Volume**: bulk beyond policy threshold (n rows / n recipients) ⇒ +1 class.
- **Trust discount**: capability in Trusted state ⇒ -1 class, floor: external band actions can never fall below major. Discount suspends on any failed heartbeat/eval.

## Who approves what

```yaml
minor:    governance_agent   # auto-approve, ledgered under agent identity, budgeted (existing auto-activation budgets)
moderate: human_only         # agent-floor DENY holds
major:    human_only         # explicit approval card, never batchable, never delegable to agents
```

Every decision (auto or human) writes the same ledger row: axes, modifiers fired, class, decider identity. Human overrides of auto-decisions feed the personal-threshold learning loop (P3): Bridge learns each user's tolerance per axis-cell and proposes threshold adjustments (themselves governed changes).

# Auto-mode practices observed in ChatGPT + Claude (knowledge-based, cutoff Jan 2026 — verify before citing externally)

Convergent patterns across Claude Code, Anthropic computer use, OpenAI Operator/ChatGPT agent mode:

1. **Reversible-by-default execution.** Drafts, previews, plan modes before any commit (Claude Code plan mode; Operator step preview). Bridge equivalent: draft-then-approve everywhere — already shipped.
2. **Confirmation pinned to irreversibility boundaries, not to "AI-ness".** Operator asks before purchases/sends regardless of confidence; Claude Code always confirms destructive/outward ops even in permissive modes. Matches axis_reversibility being the stronger axis in the matrix above.
3. **Risk from ACTION KIND, never model self-report.** Permission systems key on tool + arguments (Claude Code allowlists per tool/path), not on model claims. Matches "manifests can lie" / computed risk.
4. **Graduated permission modes as user-chosen policy, not model-chosen.** Claude Code: default-ask / acceptEdits / plan / bypass; the USER moves between modes. Bridge equivalent: policy_params per workspace; Governance Agent enforces, never chooses.
5. **Credential isolation.** Operator take-over mode (user types passwords, agent never sees them); Bridge equivalent: CredentialBroker port — already shipped.
6. **Watch/attend mode on sensitive surfaces.** Operator requires user presence on sensitive sites. Bridge candidate: External-band ritual runs can require "user present" flag (P4 ambient acting gate).
7. **Budgets + kill switch.** Rate caps and one-tap disable are universal. Already shipped (auto-activation budgets, kill switch).
8. **Full action ledger, user-inspectable.** Universal. Already shipped (pipeline ledger + capture contract).

Gap analysis: Bridge already implements 1, 3, 5, 7, 8. New from this pass: the dual-axis matrix (2), user-owned mode policy formalization (4), user-present flag (6).
