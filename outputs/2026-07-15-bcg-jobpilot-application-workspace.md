# BCG MBA Consultant — JobPilot application workspace

## Outcome

Built a real request-scoped BCG Consultant application-preparation Record in the canonical Bridge web app. The JobPilot landing page now contains an actionable BCG line item that opens a routable application detail at `/jobpilot/application/bcg-consultant-mba-2026`.

The workspace contains:

- an evidence-backed pursue decision with strengths and open concerns;
- a tailored one-page consulting resume draft;
- a BCG cover-letter draft with an honest office-specific placeholder;
- a reusable application answer bank with sensitive fields reserved for the candidate;
- a relationship-first networking plan and outreach copy;
- five behavioral stories mapped to BCG's stated evaluation dimensions;
- a six-week case-interview practice plan based on official BCG guidance;
- interviewer questions that test mutual fit;
- a submission checklist and hard Human approval gate;
- a claim ledger distinguishing verified evidence from dates or metrics that still need review;
- visible Agent ownership and consuming Skill for every artifact.

## Sources used

- `Tools/Job/Master Profile/master.json`, compiled from 45+ supplied application documents.
- `Tools/Job/Job Application/Vikas_Badami_Resume_Consulting.docx`.
- `Tools/Job/Job Application/Consulting Cover Letter.docx` and related supplied drafts.
- `docs/raw/brd-jobpilot-2026-07.md` and the JobPilot delivery plan.
- Official BCG interview-process and case-preparation guidance.

## Files changed

- `platform/apps/web/src/app/data/bcg-application.ts`
- `platform/apps/web/src/app/data/bcg-application.test.mjs`
- `platform/apps/web/src/app/pages/JobPilotApplicationDetail.tsx`
- `platform/apps/web/src/app/pages/JobPilotPage.tsx`
- `platform/apps/web/src/app/routes.tsx`
- `docs/PROGRESS.md`
- `docs/raw/decisions-log.md`
- `docs/log.md`

## Verification

- Three BCG content-contract tests pass.
- `pnpm --filter @bridge/web typecheck` passes.
- `pnpm --filter @bridge/web build` passes.
- Live browser verification could not run because starting the local preview server required approval and the workspace approval service reported that it was out of credits. No bypass was attempted; desktop and 375px evidence remains explicitly open in `docs/PROGRESS.md`.
