# TASK-024 Zazoo website implementation

## Outcome

TASK-024 is complete. The standalone `@zazoo/website` React/Vite application turns the approved storyboard into one responsive, continuous public homepage:

Hero → Family → Governance → Library → Values → Process → Difference → Impact → Night → Morning invitation.

The implementation keeps approved visible prose in one governed source, uses original SVG character rigs, and remains separate from the authenticated Bridge application.

## Delivered behavior

- Scroll drives the cinematic day-to-night-to-morning progression.
- Library books open the requested chapter without a page reload; Escape cancels pending chapter navigation.
- The Process chapter pauses at the Human Decision gate until `Continue` is selected.
- Character, book, and notebook interactions work through pointer, keyboard focus, and touch.
- Reduced-motion users retain the complete narrative without continuous locomotion.
- The final invitation is honestly disabled because no approved destination exists.
- Desktop and exact 375×812 layouts retain readable compositions with no document-level horizontal overflow.

## Verification

- Website storyboard contract tests passed.
- Targeted lint and TypeScript checks passed.
- The production Vite build passed.
- Live desktop and exact 375×812 runs covered all ten scenes, scene navigation, Escape cancellation, Process gating, notebook behavior, the disabled final CTA, reduced motion, and overflow.
- Current `origin/main@512cf35` was merged before landing.

## Durable links

- [Website application](../platform/apps/website/)
- [Governed public copy](../platform/apps/website/src/copy.json)
- [Storyboard build contract](2026-07-19-zazoo-website-storyboard/00-global-build-contract.md)
- [Storyboard index](2026-07-19-zazoo-website-storyboard/README.md)
- [Canonical task](../docs/TASKS.md)
- [Approval AP-052](../docs/APPROVALS.md)
