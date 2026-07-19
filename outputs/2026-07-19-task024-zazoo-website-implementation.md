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

## Deployment history

- Built the merged website source represented by `relationship-os@932ed80934f4af014582ee24034f45d100a1d124`.
- Published the production artifact to `badami-vikas/badami-vikas.github.io@2306808bb056ffaed7fadcccf64b8cd9f132d2b4`.
- Initial GitHub Pages run `29683315854` completed successfully.
- At the user's request, reverted that publication with `badami-vikas/badami-vikas.github.io@6b764661d5a0e46bdf0322b63898c0c9e1e05aa3`; rollback run `29683837490` completed successfully.
- `https://zazoo.me` now serves the pre-TASK-024 `index.html` from `063997ae53789ee0981f08ef9187243f4912f263`. The live response is byte-for-byte identical to the restored file.
- The `zazoo.me` `CNAME`, `/consulting.html`, `/training.html`, and their existing static assets remain available. The TASK-024 hashed JavaScript/CSS bundles return 404 as expected after rollback.
- The TASK-024 implementation remains merged in `relationship-os`; only its GitHub Pages publication was reverted.

## Durable links

- [Live website](https://zazoo.me)
- [GitHub Pages deployment commit](https://github.com/badami-vikas/badami-vikas.github.io/commit/2306808bb056ffaed7fadcccf64b8cd9f132d2b4)
- [GitHub Pages deployment run](https://github.com/badami-vikas/badami-vikas.github.io/actions/runs/29683315854)
- [GitHub Pages rollback commit](https://github.com/badami-vikas/badami-vikas.github.io/commit/6b764661d5a0e46bdf0322b63898c0c9e1e05aa3)
- [GitHub Pages rollback run](https://github.com/badami-vikas/badami-vikas.github.io/actions/runs/29683837490)
- [Website application](../platform/apps/website/)
- [Governed public copy](../platform/apps/website/src/copy.json)
- [Storyboard build contract](2026-07-19-zazoo-website-storyboard/00-global-build-contract.md)
- [Storyboard index](2026-07-19-zazoo-website-storyboard/README.md)
- [Canonical task](../docs/TASKS.md)
- [Approvals AP-052 and AP-053](../docs/APPROVALS.md)
