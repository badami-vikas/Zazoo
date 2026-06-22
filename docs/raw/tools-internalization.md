---
title: Tools — Internalization, Two Run Modes & Gated Intake (2026-06-03)
type: raw
doc_kind: research
status: active
companions: []
related_wiki: ../wiki/tools.md
updated: 2026-06-22
tags: [tools, internalization, research]
---
# Tools — Internalization, Two Run Modes & Gated Intake (2026-06-03)

User added two working reference tools (`Tools/card-scanner`, `Tools/recorder`) and set the
direction for how Bridge adopts tools generally. This is the architecture of record. Decisions
below are confirmed by the user (2026-06-03) EXCEPT card-scanner-specific behavior, where the
user's note was cut off mid-sentence ("For card scanner,") — held open.

## 1. The decision (what the user asked for)

- **Internalize external repos — plug-and-play adoption.** Bridge must be able to take an
  external GitHub repo (the two references are the first cases) and **internalize** it =
  create an **internal, modified copy** under Bridge's control. NOT a live runtime dependency
  on the upstream. Aligns with the existing air-gap / vendored-deps / "borrow patterns not
  packages" stance.
- **Keep the integration pathway broad and flexible, front and back.** Do not over-constrain
  what a tool's frontend or backend looks like. The contract is at the *edges* (model calls,
  persistence, output→entity mapping, egress), not the tool's internals.
- **Two run modes, one codebase** (confirmed "Same tool, two run modes"):
  - **Standalone / shareable-link** — the tool runs without a Bridge account; the user can
    **share a link** and friends use it. (Both references are already no-auth standalone — this
    is their natural state.)
  - **Account-bound** — the same tool, when a Bridge user is signed in, can push its output
    into that user's relationship graph.
- **Gated intake** (confirmed): data captured standalone or by a friend via a shared link is
  **gated / quarantined** and only enters the platform **upon user approval**. Capture ≠ commit.
- **Recorder consent** (confirmed): **single-party self-capture** for v1 — the user records
  their own meeting/notes; the transcript+memory is their private relationship-tier data. No
  other-party gate to capture. (Consent still governs sharing that memory *outward*.)
- **Capture plane** (confirmed): **local models by default** — card vision = local (Ollama
  vision), conversation transcription = local Whisper. Private captures stay local. Cloud
  models (Groq/Gemini/cloud Whisper) require an explicit egress grant through the gate.

## 2. Why this fits Bridge with ZERO new primitives

Every part of the ask is an existing Bridge primitive applied at the tool edge:

| Ask | Existing primitive it reuses |
|---|---|
| Internalized modified copy of a repo | Versioning (agents/skills/rituals/**tools**) — the internal copy is a versioned, diffable, rollbackable artifact; upstream is just the v0 import. |
| Broad/flexible front+back pathway | The Tool meta-model already = "composition + surface"; the binding points are the seams (ModelProvider, data seam, capability broker, typed output contract). |
| Gated intake on approval | The **Universal Action Pipeline** — a standalone/friend capture is a **proposal** (`pending_review`) that the user approves before it commits + ledgers. Draft-then-approve, applied at the ingestion edge. |
| Standalone shared-link runtime | The **cloud plane**. A public shared-link tool lives on the internet = cloud plane by definition. Pulling its captures into the user's local graph is an **inbound sourcing through the gate** → public-scope, untrusted, must be reviewed. |
| Output → Person/Memory/Touchpoint | The **typed output contract** (same self-healing-contract mechanism from the rituals work) maps a tool's raw output shape to Bridge entities. |
| External model calls | The **capability broker** — a tool never calls a model/API directly; it requests a capability through the pipeline (ModelProvider for inference, egress gate for network). |
| Local-by-default captures | The **two-plane gate** — private capture binds to local models; cloud inference = an egress crossing. |

So "Tools" is not a new subsystem — it is the pipeline + two-plane + contracts + versioning,
composed at the data-ingestion boundary.

## 3. The Tool adapter contract (the only net-new surface)

To keep front+back flexible while still governed, an internalized tool declares a small
**manifest** at its edges (internals stay whatever they are):

```
tool.manifest:
  id, name, version, source_repo (provenance), internalized_at
  run_modes: [standalone, account_bound]
  surfaces:                      # flexible — tool owns its FE/BE
    frontend: <how it's mounted / the shareable-link entry>
    backend:  <how it's invoked>
  model_bindings:                # rebind upstream model calls → ModelProvider
    - { use: vision|transcription|llm, plane_default: local }
  capabilities:                  # what it may request through the broker
    - { resourceType, action, dataScope, egress: bool }
  output_contract:               # typed; maps raw output → Bridge entities
    - { from: <tool field/shape>, to: Person|Memory|Touchpoint|Signal|Initiative, mapping }
  intake_policy:                 # gated by default
    quarantine: true             # standalone/shared-link captures held until adopted
    commit_via: pipeline_proposal  # approval required to enter the graph
```

**Internalization** = importing the repo, then rebinding its three edges: (1) model calls →
`ModelProvider` (local-default plane); (2) persistence → a **quarantine store** (not the live
graph); (3) output → the typed `output_contract`. The "internal modified copy" is exactly where
these rebindings live; the tool's UI/logic can otherwise stay as-is (broad/flexible).

## 4. Gated intake flow (standalone OR shared-link OR account-bound)

```
capture (standalone / friend via shared link / in-app)
   → tool's own QUARANTINE store (cloud-plane, public-scope, provenance-tagged)
   → user opens "Adopt" in Bridge
   → Universal Action Pipeline: Authority → Policy → map via output_contract → pending_review
   → user approve | edit | veto
   → commit to graph (Person/Memory/Touchpoint/…) + append ledger (provenance: tool+version+source)
```

- A friend's shared-link capture is **third-party-sourced** → never silently merged; it's a
  proposal with provenance. This is the same posture as canonical enrichment.
- Account-bound in-app captures may use **auto-mode** for trivial commits (per the auto-mode
  allowlist), but external/standalone captures are forced through review (untrusted origin).

## 5. Mapping the two references

**card-scanner** → a **Person-capture tool**.
- Internalize: rebind Ollama/Groq/Gemini switch → `ModelProvider` (vision, local default);
  drop dead `parse-card.ts`; drop vestigial `@anthropic-ai/sdk`.
- output_contract: 8 fields → **Person** (canonical-tier facts) + a **Touchpoint** ("met /
  scanned card on <date>"). Keep the few-shot **feedback loop** (clean, reusable).
- Modes: share a link at an event → captures quarantine → user adopts later → Persons enter
  the graph as reviewed proposals.
- **Link-version intake UX (confirmed 2026-06-03)**: in the shared-link/standalone version the
  captured data is either **downloadable** (pure standalone, stays out of Bridge) OR an
  **"Add to Bridge"** action is offered. "Add to Bridge" pushes the captures into the user's
  **Tools section in Bridge** as a pending/quarantined list; each item shows an **"Add"** button
  → that Add is the Pipeline proposal → review → commit to the graph (Person + Touchpoint) +
  ledger. So: download = exit standalone; Add to Bridge = enqueue to quarantine; per-item Add =
  the gated commit. (Generalizes to any link-version tool: download | Add-to-Bridge → Tools
  section pending list → per-item Add = pipeline commit.)

**recorder** → a **Conversation→Memory tool**.
- Internalize: keep the transcription ABC + LLM ABC (already ≈ our ModelProvider); local
  Whisper default; bind Supabase access behind the local-first data seam (no service-role
  bypass — RLS-governed).
- output_contract: transcript+summary → **Memory**; `next_steps[{text,owner,due}]` →
  **Touchpoints** (shape already matches); "project" → **Initiative** or a meeting attached to
  a Person/Community.
- Single-party self-capture; private; stays local; commit via pipeline (auto-mode eligible
  in-app, review for shared-link).

## 6. Schema / registry deltas (v2 pass)

- **Tools registry** gains: `source_repo`, `internalized_copy_ref`, `version` (reuse the
  versioning lineage), `run_modes[]`, `output_contract` (typed), `capabilities[]`,
  `intake_policy`.
- **Quarantine store**: a staging area for standalone/shared-link captures pending adoption —
  cloud-plane, public-scope, provenance-tagged; rows are inert until adopted via the pipeline.
- Reuses (no new tables of their own): pipeline/ledger (intake + audit), typed `contracts`
  (output mapping), `versions` lineage (internalized copies), two-plane gate (capture/egress).

## 7. Open / held

- ~~"For card scanner, …" truncated~~ — RESOLVED 2026-06-03: link-version = download | Add-to-Bridge
  → Tools-section pending list → per-item Add = pipeline commit (see §5).
- **Sequencing**: build card-scanner as the **pilot internalized Tool** now (it exercises the
  whole adapter contract end-to-end on a small surface), or continue to Initiatives first?
  Pending user call.
- Shared-link **hosting model** (where the standalone deployment lives, how the link is minted,
  retention of quarantined captures) — design when we build the first tool.
