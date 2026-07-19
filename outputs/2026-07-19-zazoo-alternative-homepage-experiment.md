# Zazoo alternative homepage experiment (isolated)

## Outcome

An experimental cinematic homepage exists at the isolated route `/alternative-home.html` inside `@zazoo/website`, on branch `codex/zazoo-alt-home-creative-direction`. It leads an executive through four connected chapters: paradigm-shift patterns, the AI-native organization, Business AI Infrastructure, and the Managing Intelligence journey. Zazoo tokens, typography, and scene idiom are inherited; `/` and the original homepage are untouched (only `vite.config.ts` gained a second build entry).

## Deliverables

- Page: [alternative-home.html](../platform/apps/website/alternative-home.html) + [src/alternative-home/](../platform/apps/website/src/alternative-home/)
- [Design decisions](../platform/apps/website/alternative-home/design-decisions.md) (four Section Design Decisions + animation register)
- [Verified case-study library](../platform/apps/website/alternative-home/case-study-library.md) (22+ verified cases; page fragments marked "Used on page")
- [Handoff README](../platform/apps/website/alternative-home/README.md) with run instructions, verification results, screenshots, limitations
- Contract tests: [test/alternative-home.test.mjs](../platform/apps/website/test/alternative-home.test.mjs)

## Verification

Typecheck, lint, production build, and all 13 website contract tests pass. Headless-Chrome verification (desktop 1440, mobile 375, reduced motion) passed: no console errors, no horizontal overflow, era selector + backward-scroll preservation, cumulative S2 controls with focus-preserving reset, S4 arrow-key navigation with visible focus, 44px touch targets, reduced-motion still-frame fallback with the full argument reachable. Screenshots in [alternative-home/screenshots/](../platform/apps/website/alternative-home/screenshots/).

## Open items for owner

- No approved destination for "Assess your organization" (rendered honestly unavailable) and no approved consulting CTA to close Section 4.
- No approved microcopy for Section 3's six question reveals (visual-only).
- The experiment branch must never be merged to `main` without explicit approval.
