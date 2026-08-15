---
title: Capability input packs — validated per-class structures (Skill · Module · Integration)
type: raw
doc_kind: canon
status: canon
companions:
  - docs/raw/bridge-constitution-2026-08.md
  - outputs/2026-08-14-regeneration-test-per-class-packs.md
  - docs/raw/decisions-log.md
related_wiki: docs/wiki/input-packs.md
updated: 2026-08-14
tags: [governance, capability-growth, input-packs, regeneration, harness]
---

# Capability input packs — per-class canon

Canonized 2026-08-14 (ADR-238, AP-156, TASK-042). Each class structure below was
validated empirically before canonization: per class, one isolated agent received the
full pack and one received only the platform-neutral harness; plans were graded against
the shipped ground-truth artifact on rubrics pinned before generation; packs were
amended until zero WORSE divergences remained attributable to a missing pack layer.
Full evidence: `outputs/2026-08-14-regeneration-test-per-class-packs.md`.

## How a pack is assembled

A capability input pack = six layers (ADR-175/177, constitution §"How this document is
used"):

1. **Constitution** — `docs/raw/bridge-constitution-2026-08.md`, verbatim. Never
   duplicated here.
2. **Kernel contract surface + installed-capability registry** — the section below,
   with the registry REFRESHED at pack-use time (the registry is a living inventory;
   the snapshot here is the validated 2026-08-14 baseline).
3. **Capability mandate** — written fresh per capability, ~150 words, MUST name the
   capability-specific risks. Class templates below show the validated shape.
4. **Layer M** — constitution §"Layer M — method obligations", verbatim.
5. **Layer B** — constitution §"Layer B — budget envelope", verbatim.
6. **Class harness** — the validated obligation set below, extended (never trimmed) per
   capability.

**Per-class minimums (the TASK-042 verdicts):** a Skill pack may omit constitution and
mandate at low risk (harness + contracts/registry pinned its class's safety AND its
composition); Module and Integration packs carry ALL six layers — the mandate is
load-bearing (legal/counterparty context for Modules; product-purpose for Integrations:
obligations alone produced a safe design that deleted the product).

## Layer 2 — Kernel contract surface (validated 2026-08-14)

- **Taint lattice** (closed enums): trust `verified_system | authenticated_human |
  verified_signed | untrusted | unknown`; source `operator | human | system |
  signed_import | screen | clipboard | sensor | email | google | web | mcp |
  file_import | memory | cache | queue | mixed | unknown`; sensitivity `public |
  organization | private | restricted | unknown`; instructionRisk `none | data |
  instruction_like | unknown`. Label = `{version, trust, source, sensitivity,
  instructionRisk, originChain (≤16 × {source, ref, hash, transform}),
  provenanceHash}`; worst-of joins; unknown fails closed at every sink.
- **Governance spine**: `propose()` → Proposal `{id, status: pending_review | applied |
  rejected, request, authority (engine-decided), policyResults[], output?,
  rejectionReason?}`; Decision `approve | veto | edit`; append-only replayable
  LedgerEntries with actor and skill attribution.
- **MemoryStore ops** (auth-scoped reads/deletes): `write`, `supersede`,
  `compareAndSupersede` (CAS), `writeIfAbsent` (idempotency), `get`, `retrieve`,
  `forget`, `redactLineageContent`, `currentForLineage`.
- **Knowledge/claims lane**: entities+claims behind KnowledgePort; ONE proposal door for
  claims about people — evidence refs per clause, red untypeable, amber "Observed
  about…" with evidence, raise-only sensitivity join.
- **Capture-consent contract**: per-source store (`chat | whatsapp | google | browser |
  apps` today), default OFF, fail-closed parse, Human-only flips, global kill switch;
  every capture is inspectable deletable Memory; raw capture never leaves the Local
  Plane.
- **Skill execution**: SkillRegistry under consuming Agents via the governed pipeline;
  model-calling/authority-bearing Skills declare `executionClass: "authority_bearing"`
  and pass the `skill_execution` taint sink. ModelRouter bindings carry plane defaults;
  `plane: "local"` FAILS when only cloud resolves — never falls through. Model calls
  return ledgerable receipts. **Provider availability is DYNAMIC** (the managed local
  model becomes healthy ~30s after desktop boot): resolution happens PER CALL, never
  snapshotted at construction — a boot-time snapshot leaves a capability permanently
  degraded on exactly the machines that have a local model. *(This sentence is a
  validated amendment: both Skill-class arms shipped the construction-time defect until
  it was added; the rerun then pinned it with a dedicated late-provider test.)*
- **RunContextAssembler**: the only context door; layered prompt; only accepted Memory
  enters as plain statements; memory-slot budget (12,000-char ceiling, tighten-only
  overrides, ranked-prefix truncation, always-present trace meter).
- **Budget primitives (honest inventory)**: the assembler's memory-slot budget; bounded
  loops with recorded StopReasons; child Runs get subset/intersection of parent
  authority/data/budget/taint; per-Run model receipts. There is NO general per-port
  budget meter — a capability declaring bounds names its own enforcing seam and the
  test proving each bound.
- **Evals**: per-capability datasets; platform injection suite in CI at 100%; pinned
  quality baselines block regressions.
- **Events & Signals**: append-only Events; pending-review Signals; learning signals
  are episodic Memory rows; accepted knowledge feeds every run via fusion retrieval.
- **Storage**: owner-scoped RLS relational store (Cloud Plane); embedded local Postgres
  with tsvector/GIN + trigram FTS (Local Plane). Flights default OFF.
- **Desktop shell**: Tauri; Rust owns privileged operations behind allowlists; webviews
  can be structurally denied IPC via capability exclusion; the shell owns the only
  privileged socket paths.

## Layer 2 — Installed-capability registry (2026-08-14 snapshot; REFRESH AT USE)

Modules: TaskManager (18 task-manager.* Skills, 16 Automations, dot-path queue with
candidate/live statuses, 5-Playbook methodology library) · NetworkManager
(People/Communities graph, suggested-then-accepted intake; WhatsApp sub-module: live
session, Local-Plane message store + FTS) · DealManager · JobManager · Helpdesk ·
Academics (Events sub-module) · DevPilot (GitHub tracker, integrations-github).
Agents (5 permanent): Chief of Staff · Learning · Internal Strategist · Governance ·
Capability Builder; Communications is a Skill family. Packages: net-guard ·
research/search + ContentGuard · dedupe (strong|moderate|flag|none) · facts · tables ·
sensors · integrations-google (OAuth PKCE + vault) · integrations-github ·
capability-kit · models (Ollama; managed local model) · local. Learning spine
(flight-gated, default OFF): consent → emitters → miner → digest → claims graph →
fusion retrieval → commitment detection → rejection fingerprints → acceptance audit.
Automation runtime: typed triggers, pure due-calc, no catch-up storm, governed
executor. Credential vault: encrypted-file with key id + key, OS-keyring option.

## Skill class

**Mandate template (validated shape):** name the consuming Module/Agent, the invocation
discipline (deliberate, never on every hot-path event), and AT LEAST: (a) the
structure-capture risk — model output must never decide placement/status/ordering;
(b) the fabrication risk — degraded output must be honest, labeled, and useful, never
filler or silence; (c) the residency risk for the data class the Skill reads.

**Harness (HS1–HS8, validated round 2):**
- HS1 injection suite over the Skill's untrusted inputs, 100%, from the first increment.
- HS2 structure integrity: adversarial model output claiming statuses/placements leaves
  governed state byte-identical until a human decision.
- HS3 zero-model honesty: no provider ⇒ genuinely useful, honestly-labeled output,
  never fabricated, never bare-empty.
- HS4 residency: plane-pinned binding fails (and degrades honestly) rather than falling
  through.
- HS5 malformed output: invalid entries dropped with reasons; nothing survives ⇒ honest
  scaffold with recorded reason.
- HS6 every model call yields a ledgerable receipt; an unreceipted call is a test
  failure.
- HS7 separation of duties: the Skill proposes and cannot activate/schedule/persist its
  own output as live work — structural (port allowlist), not log absence.
- HS8 declared per-invocation call/token bounds; exhaustion exits bounded with recorded
  reason and the honest scaffold.

## Module class

**Mandate template (validated shape):** name the data class held and its residency; the
counterparty and what it punishes; the session/credential surface; the graph-poisoning
and creepiness exposure; AND the trademark/trade-dress exposure when the Module renders
around someone else's product *(validated amendment — both arms missed the
makeshift-not-replica posture until the mandate named it)*.

**Harness (HM1–HM10, validated round 2; amendments marked):**
- HM1 injection suite over captured content, 100% from the first increment; content
  reaches models only in the data channel.
- HM2 residency: a hard test moves protected content toward EVERY egress path and sees
  it blocked. Cross-boundary identity linking is a KEY-SPACE LOOKUP joined at render
  time, never on disk — severing is a delete, not a migration *(amendment; ADR-159)*.
- HM3 session containment: the credential-holding surface has no privileged platform
  access, verified structurally (capability/process boundary).
- HM4 send discipline: automation only into threads the recipient initiated — never
  first contact; hard daily caps and per-recipient cooldowns in the privileged layer,
  durable, fail-closed; near-identical bodies across recipients refused; new sessions
  warm up; kill switch halts on any upstream warning and never auto-resumes; one test
  per cap including restart survival *(amendment: the gate's consent is the
  RECIPIENT's prior contact — "consent-shaped" alone was read as owner-consent by both
  arms)*.
- HM5 no cap or gate enforced only in a webview/renderer; the privileged layer refuses
  when the UI is bypassed.
- HM6 extraction is suggested-then-accepted; zero silent graph writes; rejections don't
  recur; red-class inference never proposed.
- HM7 capture consent default OFF; disabled ⇒ zero rows; captures inspectable/deletable.
- HM8 every vendored/adapted artifact carries a recorded license verdict and notices;
  no-license/incompatible candidates rejected in the record.
- HM9 upstream surface pinned at build AND health-asserted at session start; drift is a
  visible degraded state.
- HM10 honest surfaces: counterparty/ToS risk stated in-product; degraded states are
  visible states.

## Integration class

**Mandate template (validated shape):** name the credential class and its custody rule;
the attacker-reachability of the synced content; the consent-laundering boundary (a
synced record is not an approved record); AND what the product actually consumes
*(load-bearing: without "metadata is the product here", a safety-perfect design
quarantined the very attributes the learning lane mines)*.

**Harness (HI1–HI10, validated round 1 — no amendment needed):**
- HI1 credential custody: tokens in exactly one store; a sweep over every persistence
  path, log stream, and prompt assembly finds none.
- HI2 OAuth hardening: replayed state, missing PKCE, and concurrent finalization races
  each tested, each fails closed.
- HI3 injection suite over synced content, 100% from the first increment; fetched
  bodies quarantined as data.
- HI4 suggested-then-accepted: nothing fetched reaches graph/learning/model context
  without a human decision; veto leaves zero downstream trace.
- HI5 the learning moment is the approval, not the fetch; approve-one-of-many proves
  exactly-one emission.
- HI6 capture envelopes structurally content-incapable, at the type/schema level.
- HI7 one account-shaped consent source, default OFF, fail-closed parse, human-only
  flips.
- HI8 deterministic per-source-record ids; replays converge, never duplicate.
- HI9 post-approval bookkeeping failure logs and self-heals; it never reverses the
  human decision.
- HI10 unconfigured fails closed honestly; no fixture gateways in production paths;
  composition tests drive the real pipeline over injected fixtures.

## Validation record

Rubrics pinned before generation; eight runs (two arms × three classes + two amendment
reruns); 0 tool calls in all eight (host-session context visible to all arms equally —
disclosed in the report); every round-1 WORSE traced to exactly one missing pack
sentence; one amendment round closed every gap. Adopt-candidates surfaced by the arms
are recorded in the report and are NOT part of this canon.
