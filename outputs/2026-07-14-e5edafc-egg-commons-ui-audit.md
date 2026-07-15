# e5edafc, Egg + Commons readiness, and UI consistency audit

## Bottom line

`e5edafc` is a large backend/security/capability merge, not the Egg + Commons interface pass. Relative to its first parent it changes 166 files (+18,027/-116), but only two web source lines, both TypeScript union narrowing fixes. Its desktop-facing changes enable bundle targets and add icons; it does not change onboarding, the sidebar, Intelligence, the main-window chrome, or the overlay implementation. That is why the reported product behavior is still present.

The confirmed Egg + Commons prototype acceptance gate is EG0 + EG1 + CM0 + CM1. Important foundations landed, especially profile-to-CoS persona, agent invocation, signed Commons manifests, verify-on-fetch, TLS enforcement, and sandbox hard rejection. The user-visible prototype is still not demo-ready because the trust-first ceremony, reliable movable companion, standard Intelligence surface, and Commons app consumption path are absent. Current readiness is approximately 25–35% of the confirmed acceptance gate; roughly 65–75% remains. This is not a final polish pass.

## What e5edafc merged

- Security/CI: auth-on-mutation, fail-closed CORS posture, rate limits, dependency security gate, RLS migration/boot guard, workspace membership checks, Recon SSRF protection/redaction, multi-OS desktop build matrix groundwork.
- Memory and injection defense: provenance/taint fields, MemoryStore + database persistence, capture-to-Memory wiring, tainted-context egress gate, local ContentGuard.
- Evaluation/self-improvement: Agent Quality Vector, eval store/judge/comparison, capability registry/overlap detection, variance adjustment, governance health rollup.
- Agents: separately invocable foundational peers, shared prompt assembly, stored onboarding profile to server-resolved Chief-of-Staff persona.
- Packages/Commons: sandbox floor for executable packages, signed manifests, verify-on-fetch, TLS-by-default, community-origin trust floor, versioned Commons-publishable workspace blueprints.
- Tests/docs: broad new core/API/database/service test coverage and roadmap/approval/ADR outputs.

## Egg + Commons acceptance status

| Slice | What exists | Critical remainder | Readiness |
|---|---|---|---|
| EG0 | Tauri shell, CSP, bundle artifacts, launch-time overlay windows, app/clipboard sensors | `tauri-nspanel`, draggable/persistent companion, all-Spaces/fullscreen behavior, display topology changes, xcap, global hotkey, keychain posture | ~20% |
| EG1 | Egg questionnaire, profile persistence, profile-to-CoS persona, invocable agent seam | trust-first permission ceremony, proof capture + Memory/blink, performed pointing demo, live Module proposals, single next action, comprehensible question causality | ~25–30% |
| CM0 | Commons service, HTTP client, publish-builtins utility | `commons.*` tRPC surface, governed install-from-Commons, live app consumer, Learning Agent similarity reads | ~20–25% |
| CM1 | registry signing, signature verification, TLS enforcement, untrusted-origin floor, sandbox exemption removed | content-hash version pins, real publisher verification/revocation, complete provenance block, 8-point publish scan gate | ~45–50% |

## Onboarding critique against EG1

The live experience is still the old blueprint compiler exposed as a questionnaire:

1. It asks for profession, spirit animal, domain, what Bridge should watch, vocabulary, view style, and Organization name.
2. It previews internal concepts as Entities and Views.
3. It explains governance mechanics and asks the user to propose the setup.

This fails the plan in both sequence and comprehension. EG1 says onboarding should first establish trust in human language, request permissions with visible proof, perform one real-value beat on the user's screen, draft live Module proposals while the user answers, and finish with one action. None of those beats exists in the current dialog.

Several questions also overstate their purpose:

- `profession` is saved but only reserved for future smart mapping in the blueprint builder.
- `watch_first` says it seeds first views, but its effects are limited and uneven.
- `view_style` commits an initial renderer when the product should expose interchangeable standard views.
- `spirit_animal` is explicitly cosmetic but is mixed into functional setup.
- `Initiative`, `Entities`, `Views`, `proposal`, and `governance` are surfaced before the user has a reason to understand them.

The right correction is not better help text around this sequence. The sequence should become EG1's trust-and-first-value ceremony, with only essential personalization questions. Every question that remains must state the immediate consequence of the answer in ordinary language.

## Root causes of the reported desktop behavior

- Cannot move overlay: there is no drag call or Tauri drag region in the overlay frontend or Rust command surface.
- Does not follow virtual desktops/fullscreen: the code does not implement the planned non-activating `FullScreenAuxiliary`/join-all-Spaces panel behavior.
- Extended screens: it creates one overlay per monitor only at launch. It does not track monitor attach/detach, persist a chosen location, or migrate a single companion with the user. The current documentation calling this “per-monitor built” obscures the requested behavior.
- Close/minimize placement: the main window uses default native decorations and the web sidebar has no window-control/header region. The supplied reference therefore cannot be produced by the current architecture.

## Intelligence consistency audit

The user's consistency expectation is correct. The canonical rule requires the landing-section toolbar order:

`List → view → search → filter → Add/custom action → 3-dots → insights`

`IntelligencePage.tsx` bypasses that shared shell. It directly renders bespoke cards, unordered lists, links, and developer-facing stub messages. It also hardcodes `Workflows`, `Create a workflow`, and `Run a workflow`. The current canonical and the user's ruling are **Automations**; `ritual` may remain an internal identifier, but neither `ritual` nor `workflow` should leak into normal UI.

The missing toolbar is therefore not an ambiguous design decision. UI-RULES-1 was placed first in the Egg + Commons batch and was never executed. The page is still showing the older implementation.

## Intake decision

The corrective interrupt is now recorded in `docs/PROGRESS.md`. Direct work covers onboarding clarity, companion mobility, sidebar-integrated window controls, the Intelligence standard shell/read paths, and Automations vocabulary. Bounded same-surface pull-ins cover onboarding re-entry, the Dialog warning, package-gated surfaces, and server error-copy vocabulary. The report is preserved verbatim in `docs/raw/requirement-bugs-2026-07-14-onboarding-shell-intelligence.md`, with four separate root-cause rows in `docs/BUGS.md`.

The tracker now has a hard next-session gate: execute the prototype interrupt in numbered order; do not return to the already-completed H2 security roadmap, cleanup, generic backlog, EG2+, or CM2+ while the interrupt or EG0–EG1/CM0–CM1 remains open. The four reported defect groups are explicit Egg acceptance criteria, not deferred polish. The stale CM0 tracker claim was also corrected: the port and HTTP client exist, but the `commons.*` tRPC/application consumption surface does not.
