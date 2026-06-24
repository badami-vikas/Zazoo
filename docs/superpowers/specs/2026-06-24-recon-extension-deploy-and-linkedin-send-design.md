# Design — Recon Extension: Deployed Backend + LinkedIn Connection-Send

- **Date:** 2026-06-24
- **Status:** Draft (awaiting user review)
- **Scope:** `Tools/recon/extension/` (Chrome MV3 extension) + `Tools/recon/` (Next.js backend) + a Cloudflare deployment of the backend.
- **Author:** Claude (brainstormed with Vikas)

## Problem

The Bridge AI **Recon** browser extension currently talks only to `http://localhost:3001`
(the Recon Next.js dev server). The user wants:

1. The extension pointed at a **deployed** backend (not localhost), so the live data →
   staging → approval flow can be observed end-to-end.
2. A new capability: send **LinkedIn connection requests** with a **personalized note**
   to a set of **pre-defined profiles**, automatically.

This requires three coordinated pieces of work, delivered as **one effort**.

## Decisions (locked with user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Backend URL | **Configurable** via `chrome.storage.local` + popup settings field |
| 2 | Host permissions | **Broad `https://*/*`** wildcard (+ keep `http://localhost:3001/*` for dev) — no re-approval friction |
| 3 | Connection note text | **Template with `{placeholders}`** (`{firstName}`, `{name}`) stored in extension settings |
| 4 | Send automation | **Fully automated** background worker over the queue |
| 5 | Send queue source | **Reuse the existing `capture-queue`** with a new `action` field |
| 6 | Daily send cap | **15/day** (conservative), plus jitter + daytime window + kill-switch |
| 7 | Deployment platform | **Cloudflare** (same platform as the prototype `bridge-ai-1ay.pages.dev`) — "one platform now" |
| 8 | API protection | **Shared-secret header** sent by the extension on every API call |
| 9 | Full codebase merge (Vite prototype + Next.js Recon → single app) | **Out of scope** — separate future project |

## Non-goals

- Merging the prototype frontend and Recon into a single codebase/UI (decision #9).
- Migrating the filesystem-backed OSINT store (`/api/store/*`, `/api/background-check`,
  OFAC cache) to Supabase. See **Risk R1** — these features degrade on serverless and are
  handled as a follow-on.
- Changing the LinkedIn DOM-extraction logic (`content.ts` capture path stays as-is).

---

## Part 1 — Configurable backend URL (extension)

**Goal:** stop hardcoding `localhost:3001`; let the user point the extension at any
backend without rebuilding.

**Changes:**
- `Tools/recon/extension/src/popup.ts` — remove `const RECON_URL = 'http://localhost:3001'`.
  Read `reconUrl` from `chrome.storage.local` (with default). Update the localhost error string.
- `Tools/recon/extension/src/background.ts` — same: read `reconUrl` from storage instead of the const.
- A small shared `getReconUrl()` helper (new `src/config.ts`) so both entry points resolve
  the URL identically, including the secret token (Part 3).
- `Tools/recon/extension/src/popup.html` — add a **Settings** section with:
  - **Backend URL** text field (default `https://bridge-ai-1ay.pages.dev`, overridable).
  - **Shared secret** field (Part 3).
  - **Note template** textarea (Part 2).
  - **Auto-connect** toggle + **daily send cap** display (Part 2).
- `Tools/recon/extension/manifest.json` — `host_permissions` becomes
  `["https://www.linkedin.com/in/*", "https://*/*", "http://localhost:3001/*"]`.

**Default URL caveat:** the default `bridge-ai-1ay.pages.dev` is the *prototype frontend*,
which does **not** serve the Recon API routes. It is only a placeholder default; the field
must be set to the **deployed Recon URL** from Part 3 for the extension to function. The
implementation plan will set the default to the real Recon deployment URL once it exists.

**Data flow:** `popup`/`background` → `getReconUrl()` → `fetch(`${reconUrl}/api/...`, { headers: { 'x-recon-secret': token } })`.

---

## Part 2 — LinkedIn connection-send (extension + backend queue)

**Goal:** automatically send personalized connection requests to pre-defined profiles
drawn from the existing capture-queue.

### Queue model (backend, Supabase)
- Extend capture-queue items with an **`action`** field: `'capture' | 'connect'`
  (default `'capture'` so existing behaviour is unchanged).
- `connect` items optionally carry a `note_template_override` (else the extension's
  stored template is used).
- Result reporting (`POST /api/capture-queue`) accepts new statuses for connect items:
  `sent | already_connected | note_unavailable | soft_block | error`.
- `lib/capture.ts` query selects items by `action` for the worker.

### Send routine (content script)
New routine in `content.ts` (or a sibling `connect.ts`), invoked by the background worker:
1. Detect connection state. If already connected / pending, report `already_connected` and stop.
2. Locate the **Connect** button — handle both the primary button and the
   **"More → Connect"** overflow menu (LinkedIn moves Connect into the overflow for many profiles).
3. Click **Add a note**.
4. Resolve the note: take the stored template, substitute `{firstName}` / `{name}` from the
   extracted profile, **enforce LinkedIn's note character limit** (truncate at the limit and
   surface a warning in `lastConnect` state). If the note box is unavailable (e.g. free-tier
   invite-note limit reached), report `note_unavailable`.
5. Fill the note textarea and click **Send**.
6. Detect success vs. soft-block (e.g. "you've reached the weekly invitation limit") and
   report the appropriate status.

LinkedIn's DOM is obfuscated and SDUI-driven; selectors anchor on stable signals
(`aria-label`, button text, `componentkey`/`data-testid`) exactly as the capture path does.

### Background worker (service worker)
- Reuse the existing alarm/jitter scheduler in `background.ts`.
- New storage keys: `autoConnect` (toggle, **default OFF**), `connectDailyCap` (**default 15**),
  `connectSentToday` + date stamp, `noteTemplate`, `lastConnect` (status/name/url/timestamp/warning).
- On each tick within the daytime window: if `autoConnect` is on and the daily cap not hit,
  pull one `connect` item, open the profile foreground tab, run the send routine, report the
  result, increment the counter.
- **Kill-switch:** turning `autoConnect` off halts all sending immediately.
- Capture and connect share the scheduler but have **independent daily caps**.

### Governance note (explicit)
Fully-automated sending departs from the project's **draft-then-approve** principle
(CLAUDE.md). It is accepted here because: sole user, the user's own LinkedIn account,
explicit request. Mitigations: 15/day cap, daytime window, randomized jitter, default-OFF
kill-switch, and per-send status logging. This trade-off is recorded as an ADR in
`docs/raw/decisions-log.md` and a row in `docs/wiki/known-issues.md`, and carries
LinkedIn ToS / account-restriction risk that the user has accepted.

---

## Part 3 — Deploy Recon backend to Cloudflare

**Goal:** a stable https URL serving the Recon API + approval UI, reachable by the extension,
so the live flow is observable. Data already lives in **Supabase** (`@supabase/supabase-js`,
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`) — no DB migration needed.

**Platform:** Cloudflare (same account/platform as the prototype), via the Cloudflare Next.js
adapter (`@opennextjs/cloudflare`, which supports the Node.js runtime Recon needs — preferred
over `@cloudflare/next-on-pages`, which forces the edge runtime).

**API protection (shared secret):**
- Backend: a small middleware / per-route guard checks an `x-recon-secret` header against a
  `RECON_SHARED_SECRET` env var. Missing/wrong → `401`. Applied to all `/api/*` routes the
  extension calls (`linkedin-import`, `capture-queue`, `extraction-flags`).
- Extension: sends the header on every fetch; the secret is stored in popup settings
  (Part 1 field) and read via `getReconUrl()`'s companion `getReconSecret()`.
- The human-facing approval UI keeps relying on the same secret or Cloudflare Access
  (decided at deploy time; default: secret-gated APIs, UI behind the same).

**Env vars to set in Cloudflare:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RECON_SHARED_SECRET`
(+ any OSINT keys already used: `SEARXNG_URL`, `ALEPH_URL`, etc., where applicable).

**Steps:**
1. Add the Cloudflare adapter + `wrangler`/deploy config to `Tools/recon/`.
2. Add the shared-secret guard to the extension-facing routes.
3. Deploy; obtain the Recon Cloudflare URL.
4. Set that URL + secret as the extension defaults / in settings.
5. Smoke-test the full path against the deployed backend (Part-4 verification).

---

## Risks & honest limitations

- **R1 — Filesystem-backed OSINT features break on serverless.** `lib/store.ts` (staging/
  permanent JSONL), `lib/recon.ts` (OFAC cache), and parts of `lib/capture.ts` write to
  `process.cwd()/data/`. Cloudflare (and Vercel) have no persistent writable FS, so
  `/api/store/*` and `/api/background-check` will not fully function when deployed.
  **The extension's data path is unaffected** (it is Supabase-backed). Handling: deploy with
  these features degraded/disabled and migrate them to Supabase in a **follow-on project**.
  Flagged to the user; recorded in known-issues.
- **R2 — Broad `https://*/*` host permission** widens the extension's reach. Accepted for a
  sole-user tool to avoid re-approval friction; revisit if the extension is ever distributed.
- **R3 — Shared secret in extension storage** is readable by anyone with the unpacked
  extension/devtools on the user's machine. Acceptable for a single-user local install; not a
  public-distribution posture.
- **R4 — LinkedIn DOM drift.** Connect-button/overflow selectors will need maintenance as
  LinkedIn ships new SDUI builds, same as the existing capture selectors.
- **R5 — Default URL is a placeholder** (`pages.dev` prototype) until Part 3 yields the real
  Recon deployment URL; the plan must update the default to avoid silent 404s.

## Verification (Part 4, in the plan)

- Build the extension (`npm run build`) clean; load unpacked.
- Local regression: with Backend URL = `localhost:3001`, capture still works (no behaviour change).
- Deployed path: with Backend URL = Recon Cloudflare URL + secret, capture a profile and
  confirm it lands in Supabase staging and appears in the approval UI.
- Connect path: seed a `connect` queue item for a test profile, enable `autoConnect`, confirm
  the note is filled (with `{firstName}` substituted, within char limit) and the request sends;
  confirm result status is reported back; confirm the daily cap and kill-switch both halt sending.
- Negative: wrong/missing secret → `401`; cap reached → no further sends.

## Files touched (anticipated)

**Extension** (`Tools/recon/extension/`):
- `manifest.json` (host_permissions)
- `src/config.ts` (new — `getReconUrl`, `getReconSecret`)
- `src/popup.ts`, `src/popup.html` (settings UI, use config)
- `src/background.ts` (use config; connect worker, caps, kill-switch)
- `src/content.ts` or new `src/connect.ts` (send routine)
- `src/types.ts` (queue `action`, connect result types)

**Backend** (`Tools/recon/`):
- `lib/capture.ts` (action field in queue select/report)
- new shared-secret guard (middleware or per-route helper)
- `app/api/linkedin-import/route.ts`, `app/api/capture-queue/route.ts`,
  `app/api/extraction-flags/route.ts` (apply guard)
- Cloudflare adapter + deploy config (`@opennextjs/cloudflare`, `wrangler.toml`/`open-next.config`)

**Docs:**
- `docs/raw/decisions-log.md` (ADR: automated send; Cloudflare deploy; shared-secret)
- `docs/wiki/known-issues.md` (R1 FS limitation; automated-send risk)
- `docs/log.md` (change log entry)
