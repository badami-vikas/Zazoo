# Onboarding dialog deadlock

Date: 2026-07-24

The desktop-height onboarding deadlock is fixed. The trust ceremony now stays within the webview and
scrolls internally, keeping its required Continue action reachable without changing observation or
governance behavior.

At the reproduced 1130×738 window (`innerHeight` 651), rendered proof measured a 615px dialog client
height, 1192px scroll height, `overflow-y: auto`, and a 617px maximum height. Continue moved from
1146px off-screen to 569px on-screen after scrolling, and activating it advanced to “What's your role
or profession?”.

Changed:

- [`platform/apps/web/src/app/onboarding/OnboardingDialog.tsx`](../platform/apps/web/src/app/onboarding/OnboardingDialog.tsx)
- [`platform/apps/web/test/onboarding-learning.test.mjs`](../platform/apps/web/test/onboarding-learning.test.mjs)
- [`docs/BUGS.md`](../docs/BUGS.md)
- [`docs/TASKS.md`](../docs/TASKS.md)

Evidence: focused onboarding tests 10/10, web typecheck, focused ESLint, production web build, and
rendered viewport interaction proof.
