# TASK-002 — trust-first onboarding and controlled learning

## Delivered
- Onboarding opens with an honest desktop trust ceremony: current Accessibility and screen-recording states, no implied microphone capture, and a user-triggered one-observation foreground-app check that blinks the Avatar, saves an inspectable private Local Plane Memory, and stops the provider.
- Every question shows separate **Why** and **Consequence** copy. The flow no longer explains itself with internal kernel vocabulary.
- Public-role-model input is optional and paired with the behavior the user admires. Learning checks only the fixed Wikipedia API origin, refuses off-origin redirects, cites the result, separates source fact from user interpretation, and drafts one Signal recommendation.
- Recommendation approval uses the governed `action.decide` path with server-resolved human attribution; the Learning Agent never approves or executes it.
- Persistent startup idempotently provisions and verifies the Learning Agent, its Role, `signal:write` capability scope, type-wide Role grant, and matching attributable user grant. Concurrent provisioning is conflict-safe.
- Direct onboarding preferences and trust captures persist as private Local Plane Memory with explicit provenance.
- The day-7 qualities reflection is scheduled when the profile is saved even if role-model learning is skipped, and can be snoozed, paused, skipped, or scheduled again.
- Settings exposes onboarding re-entry plus trust/preference inspect, correct, and delete controls. Start over clears only draft answers.
- Memory deletion removes the complete correction lineage.

## Verification
- Changed-file ESLint: pass.
- API role-model research, governed approval, schedule lifecycle, trust Memory, correction, and deletion regressions: pass.
- Persistent pglite governance regression, including concurrent and repeated provisioning: pass.
- Full API, core, web, affected DB, and desktop Rust suites: pass.
- Web production build and desktop `cargo check`: pass.
- Real 375px Chrome path: trust copy, every adaptive question, preview, cited Indra Nooyi recommendation, governed approval, Learning Settings, pause/reschedule/snooze/skip, and no horizontal overflow: pass.
- Real native Tauri path: this branch's uniquely named binary launched against a fresh API; the trust ceremony rendered current macOS states (`Accessibility: Not granted`, screen recording unavailable) with the bounded live-check explanation.
- macOS denied synthetic Accessibility input, so the native live-check button was not machine-clicked. Its complete sensor start → one observation → drain → Memory → blink → provider stop choreography is covered by the web source-contract, API trust-Memory regression, and 19 passing desktop Rust tests; no permission bypass was attempted.
- Clean integrated web typecheck passes after TASK-001 added the missing `IntelligencePage.tsx` `Link` import.

## Files
- [TASKS](../docs/TASKS.md)
- [BUGS](../docs/BUGS.md)
- [Dummy-data ledger](../docs/dummy.md)
