# Alternative homepage experiment — handoff

Isolated creative-direction experiment. Branch: `codex/zazoo-alt-home-creative-direction`. Never merge to `main` without explicit approval.

## Route and run instructions

- Route: `/alternative-home.html` (second Vite entry; matches the site's `.html`-page convention, e.g. `zazoo.me/consulting.html`).
- The original homepage stays at `/` and is byte-identical to `origin/main`.
- Dev: from `platform/apps/website`, run `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174`, then open `http://127.0.0.1:4174/alternative-home.html`. (`pnpm dev` works where corepack/pnpm is healthy.)
- Production: `pnpm build` (or `./node_modules/.bin/vite build`) emits both `dist/index.html` and `dist/alternative-home.html`; verified with `vite preview` that both respond 200 and the route loads directly and on refresh.

## Changed files

- `platform/apps/website/vite.config.ts` — the only shared change: registers the second build entry (smallest route/build registration).
- New, additive only:
  - `platform/apps/website/alternative-home.html` — entry document.
  - `platform/apps/website/src/alternative-home/` — `main.tsx`, `AlternativeHome.tsx`, `copy.json` (governed approved copy), `evidence.ts` (verified Section-1 evidence), four section components, `alt.css` + `styles/` (5 stylesheets).
  - `platform/apps/website/test/alternative-home.test.mjs` — contract tests.
  - `platform/apps/website/alternative-home/` — this handoff, `design-decisions.md`, `case-study-library.md`, `screenshots/`.
- Shared site files (`index.html`, `src/*`, `src/styles/*`) are imported read-only (tokens, hooks, base styles) and are unchanged from `origin/main`.

## Test commands and results

From `platform/apps/website` (all green as of the final commit):

- `./node_modules/.bin/tsc --noEmit` — pass.
- `./node_modules/.bin/vite build` — pass; emits both entries.
- `node --test test/*.test.mjs` — 13/13 pass (6 pre-existing storyboard tests + 7 new alternative-home contract tests covering isolation, section order, exact copy, era selector behavior, library "Used on page" fragment verification, button/keyboard interaction contracts, and responsive + reduced-motion CSS).
- `../../node_modules/.bin/eslint apps/website` (from `platform/`) — clean.
- Headless-Chrome run (Playwright driving the installed Chrome against the dev server): zero console errors; no horizontal overflow at desktop 1440 and 375 px; era-selector click jumps eras and the selected era survives scrolling backward; Section-2 controls are cumulative with correct `aria-pressed`, and `Compare before` restores the initial state without losing focus; Section-4 arrow keys advance stages with a visible focus ring and lenses re-emphasize the illustration; first Tab lands on `Book a strategy session`; all touch targets ≥ 44 px at 375 px; with `prefers-reduced-motion: reduce` the hook reports reduced, no infinite animation runs, and the complete argument (all four sections' copy) remains reachable by scroll and controls.

## Screenshots

In [screenshots/](screenshots/): desktop (1440×900) — hero, Section 1 steam + internet + AI resting frame + More-examples expansion, Section 2 before + transformed, Section 3 friction + replay + definition, Section 4 journey; mobile (375×812) — hero, Section 1 internet, Section 2 transformed, Section 3 definition, Section 4 journey; plus a reduced-motion Section 1 still.

## Known limitations and decisions requiring owner approval

- `Assess your organization` has no approved destination; it renders visibly unavailable (`aria-disabled`), matching the existing homepage's honest-disabled pattern.
- The existing site has no approved consulting CTA component, so Section 4 ends on the selected transformation state; the closing consulting CTA is missing pending approved copy and destination.
- Section 3's six question reveals are visual-only (detour trace in the friction pass, highlighted frictionless route in the replay); no explanatory microcopy is approved, and optional microcopy for those reveals remains an open item.
- No brand wordmark appears on the page: the copy boundary allows only the approved section copy, and no wordmark string is in the approved lists. Add it only with owner approval.
- `More examples`: rendered only for eras that have additional verified cases in the library beyond the base sequence. The Internet era carries two verified extended pairs (Encyclopaedia Britannica vs Wikipedia; classified-ad newspapers vs Craigslist, library Cases 23-24) that extend the sequence in place while preserving the current evidence position; the other historical eras have one verified pair each, so the control does not appear for them rather than inventing examples.
- Screenshot capture through the embedded browser pane was broken in this environment (blank frames for scrolled content, reproduced on the untouched original homepage); screenshots and interaction verification therefore ran through headless Chrome instead.

## Isolation confirmation

`git diff --name-only origin/main` shows exactly one modified file (`platform/apps/website/vite.config.ts`); everything else is new. `/` renders the original homepage unchanged (verified in-browser against the dev server and the production preview).
