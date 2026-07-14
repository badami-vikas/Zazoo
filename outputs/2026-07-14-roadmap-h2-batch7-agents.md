# 2026-07-14 — H2 roadmap Batch 7: Month-5, AGENTS-1 + AGENTS-2 (the agent team as invocable peers + persona)

## Task scope
Continued autopilot execution of the H2-2026 security/capability roadmap
(`docs/raw/roadmap-6month-2026-h2.md` §M5), on branch
`manishsbhoopalam8498-month-4-self-improve` (PR #11, stacked on `…-security-p0-hardening`). Month 5 is
where the foundational agents become real, separately-addressable peers with a shared, governed
prompt-assembly seam, and the Chief of Staff's identity is seeded from the user's onboarding profile
(spirit-animal tone included) — resolved on the server, not trusted from the client.

## User requests addressed
- "Execute the next plan of action from the roadmap" (Month 5, Batch 7).
- Parallelism where independent: assessed and — unlike Batches 4–6 — built sequentially here, because
  both edges live in the same `@bridge/core` package (shared `dist`/buildinfo/`index.ts`), so parallel
  subagents would race on shared build state. The genuine parallel opportunity is the deferred Batch 8.
- Scope decision confirmed with the user: ship AGENTS-1 + AGENTS-2 now; split the infra-gated XP-2/XP-3
  into a separate Batch 8.
- Governance honored: nothing marked DONE without a user-approved `docs/APPROVALS.md` row
  (AP-016 PROPOSED); PROGRESS boxes left UNTICKED.

## What was delivered (2 roadmap items)

### AGENTS-1 — the foundational agents as first-class invocable peers + the prompt-assembly seam
- **The "PromptAssembler" (undefined-elements #6) IS the shipped `RunContextAssembler`** (ADR-027,
  `@bridge/core/src/run-context.ts`) — whose own header already retired the earlier PromptAssembler
  idea — extended, not duplicated (ADR-072). Added the two layers it was thin on:
  - **Layer 1 `KERNEL_INVARIANTS`** — a 4-line, non-omittable governance block (draft-then-approve,
    lethal-trifecta→human, untrusted-content-is-DATA, no-dummy-data), always emitted first.
  - **Layer 2 agent identity** — `RunPersona` gains optional `responsibilities`/`guardrails`/`tone`.
  - `renderPersonaSystemPreamble(persona)` = the single shared layer-1+2 renderer; `projectToSystemPrompt`
    = the sibling projection to `projectToPrompt` (which was left untouched, keeping its tests green) for
    the `model.complete({system, prompt})` split.
- **`agents.ts`**: `buildAgentPersona(id, tone?)`, `buildAgentSystemPrompt` reimplemented on the shared
  renderer, and `invokeAgent(args): AgentInvocationResult` — a discriminated union of `information`
  (Learning/Governance, `neverExecutes`) | `draft` (Capability Builder, `requiresApproval`) with **NO
  `executed` variant**. "No independent write" is thus *structural*, not conventional (ADR-073): the
  type can't express execution, and `invokeAgent` holds no pipeline/store handle. The design-constraint
  check is surfaced as a flag on a draft, never a gate.
- **DONE-WHEN met**: `core/test/agents-invoke.test.ts` (9) proves information-vs-draft selection by
  `requiresApproval`, the offline fallback, the kernel-invariants layer in the assembled prompt, and
  dummy-data language flagged (not gated) on a draft.

### AGENTS-2 — onboarding-profile → Chief-of-Staff persona (resolved server-side)
- **`core/src/onboarding-profile.ts`**: the Memory-family `OnboardingProfile` view (undefined-elements
  #11 schema — `role`/`goals[]`/`domains[]`/`connectedSources[]`/`chosenAnimalId`/`workingStyleNotes`/
  `source`, every personalization field optional); `profileFromRow` bridges the durable
  `OnboardingProfileRow` honestly (omits absent fields — no invented data); `resolveAnimalTone` reuses
  the already-reconciled `ANIMAL_TONE` map (case-insensitive, `undefined` for unknown/unset — graceful
  degrade); `buildChiefOfStaffPersona(profile): RunPersona` (animal → tone, role/goals/domains/working-
  style → identity framing, fixed CoS duties → responsibilities). Personality only ever touches
  tone/framing, never authority (ADR-074).
- **Wired into `apps/api` `chiefOfStaff.converse`**: the spirit-animal tone + CoS persona are resolved
  SERVER-SIDE from `onboardingProfileStore` (the stored animal wins over the client-supplied
  `input.animal`, which becomes a fallback); an additive, display-only `persona` card `{id,name,tone?}`
  is returned on every response. @mention agent turns now route through `invokeAgent`
  (`information → direct_reply`; `draft → governed `pipeline.propose``); the `@communications` skill
  reply consumes the same server-resolved tone.
- **Roster reconciliation (key call, ADR-074)**: the roadmap's "5 agents (CoS + Learning/Communications/
  Governance/Capability-Builder)" is superseded by the later, authoritative ADR-046 → **4 agents + 1
  skill**. Communications stays a skill (bespoke prompt, no agent identity/capability scope) and was
  NOT re-promoted; `FOUNDATIONAL_AGENTS` remains the 3 delegate agents alongside the non-deletable CoS.
- **DONE-WHEN met**: `core/test/agents-persona.test.ts` (7) proves two profiles → two distinct personas,
  animal tone reflected, unknown/unset animal degrades gracefully, honest row-mapping;
  `apps/api/test/chief-of-staff.test.ts` (+2) proves two stored profiles → two persona cards and that a
  stored profile's animal overrides the client `input.animal`.

## Execution & parallelism
Both AGENTS-1 and AGENTS-2 edges live in `@bridge/core` (shared `dist`, tsc buildinfo, and `index.ts`
barrel), so — unlike Batches 4–6, which fanned disjoint packages to parallel subagents — this batch was
built sequentially by me: parallel writers would have raced on the shared build state and the single
barrel. Order: `run-context.ts` foundation (layers 1–2) → `agents.ts` invoke seam → `onboarding-profile.ts`
persona → apps/api integration. The real parallel opportunity is the deferred Batch 8 (native vs mobile
are genuinely independent surfaces).

## XP-2 / XP-3 deferral → infra-gated Batch 8 (ADR-075)
Month-5's other two items were split OUT into a separate, explicitly infra-gated **Batch 8**:
- **XP-2** (signed native installers + a running desktop capture build on macOS/Windows/Linux) needs
  code-signing certificates + a 3-OS CI matrix — unavailable here.
- **XP-3** (mobile app rebased onto the shared kernel, running on a device/simulator) needs the mobile
  Expo app, which does not exist on this branch at all (`platform/apps` = api/desktop/web only; it is
  stranded on branch `claude/heuristic-booth-f8f5da`), plus devices/simulators.
A DONE-WHEN that can't be executed or verified here would either be falsely claimed or force fabricated
evidence, so they are registered in PROGRESS with their unblock conditions. Confirmed with the user
before proceeding. Nothing in code or docs claims XP-2/XP-3 complete.

## Verification
- Full `pnpm turbo run typecheck test build --force` → **59/59 tasks green**, all coverage floors pass.
- `@bridge/core` → 317 tests (93.04%); `apps/api` converse tests 7→9.
- ESLint clean on every changed kernel file (`bridge/no-crm-vocab` respected — Bridge vocab only).
- Blast radius checked: `buildAgentSystemPrompt`/`ANIMAL_TONE`/`checkDesignConstraintViolations` remain
  exported from core (only the router's local imports changed); the `persona` response field is additive
  (unknown-field-safe for existing clients); `run-context.ts`'s `projectToPrompt` and its tests were left
  untouched.

## Governance
- ADR-072–075 recorded in `docs/raw/decisions-log.md` (PromptAssembler = RunContextAssembler + layers 1–2;
  `invokeAgent` structural no-independent-write; onboarding-profile → CoS persona + the ADR-046 roster
  reconciliation; the XP-2/XP-3 deferral).
- **AP-016 filed PROPOSED** in `docs/APPROVALS.md` — PROGRESS §Batch 7 boxes left UNTICKED pending the
  user's approval; §Batch 8 registered as an infra-gated deferral.
- No dummy data (`profileFromRow` omits absent fields; a sparse profile yields a generic persona, not a
  fabricated one). No new BUGS.

## Artifacts (created/changed)
- Core (changed): `packages/core/src/run-context.ts` (layers 1–2: `KERNEL_INVARIANTS`,
  `renderPersonaSystemPreamble`, `projectToSystemPrompt`, `RunPersona` extensions), `agents.ts`
  (`buildAgentPersona`, `invokeAgent`, `AgentInvocationResult`, `buildAgentSystemPrompt` reimpl),
  `onboarding-profile.ts` (`OnboardingProfile`, `profileFromRow`, `resolveAnimalTone`,
  `buildChiefOfStaffPersona`), `index.ts` (Batch-7 exports).
- Core (new tests): `test/agents-invoke.test.ts`, `test/agents-persona.test.ts`.
- apps/api (changed): `src/router.ts` (`converse` routes @mentions through `invokeAgent` + server-side
  persona/tone resolution + additive `persona` card), `test/chief-of-staff.test.ts` (+2 cases).
- Docs: `docs/raw/decisions-log.md` (ADR-072–075), `docs/log.md`, `docs/PROGRESS.md` (§Batch 7 + §Batch 8),
  `docs/APPROVALS.md` (AP-016), this file.

## Deferred by design (follow-ups)
- The richer four-axis SpiritAnimal tone card (warmth/directness/playfulness/formality + voice examples)
  as Commons-authored Knowledge — the string tone descriptor is the shipped v1.
- A model-backed Chief-of-Staff voice (CoS still emits deterministic routing/clarify replies; the persona
  is surfaced as a card and threads tone into agent/skill invocations).
- Batch 8: XP-2 (native installers/capture) + XP-3 (mobile Expo rebase), infra-gated.
