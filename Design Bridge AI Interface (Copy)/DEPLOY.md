# Deploying Bridge (Cloudflare Pages) — public shareable helpdesk URLs

The prototype is a static Vite SPA. Deploying it gives every page a public URL, so
custom-helpdesk **Copy Link** produces a real shareable link instead of `localhost`.

## One-time
1. Have a Cloudflare account. Install/login the CLI:
   ```
   npx wrangler@latest login
   ```
2. (First deploy only) create the Pages project — the `deploy` script targets
   `--project-name=bridge-ai`; create it in the dashboard or let wrangler prompt you.

## Deploy
```
cd "Design Bridge AI Interface (Copy)"
npm run deploy            # = vite build && wrangler pages deploy dist --project-name=bridge-ai
```
Wrangler prints your URL, e.g. `https://bridge-ai.pages.dev`.

## Make Copy Link use the public domain
Set the public base URL so shareable links point at the deployed site, then redeploy:
```
echo 'VITE_PUBLIC_BASE_URL=https://bridge-ai.pages.dev' >> .env
npm run deploy
```
(See `.env.example`. Supabase vars default to the live Bridge project if unset.)

## What works after deploy
- The whole app is reachable at the public URL. The app shell is auth-gated; the
  **public helpdesk page `/help/:slug` is ungated** (SPA deep-link handled by `public/_redirects`).
- **Card Scanner** runs natively in-app (no separate server) — paste a free Groq key in
  its AI Engine settings to scan on the deployed site.

## Public helpdesk data — now on Supabase (cross-device)
The public surface (`/help/:slug`) reads/writes **Supabase** so testers on other devices share state:
- **Create Helpdesk** (signed-in owner) → INSERT `helpdesk_workspaces` (`owner_id = auth.uid()`),
  plus a local copy for the owner's in-app list. The shareable link resolves by **slug** on any device.
- The public page resolves the workspace by slug, lists public **approved** asks, and lets anyone
  with the link **post asks/offers** — all via the anon publishable key under RLS
  (`helpdesk_v2_anon_public_testing` migration: anon SELECT public/unlisted workspaces + approved
  public asks/offers; anon INSERT asks (`requester_id` null) + offers; destructive anon grants revoked).
- Every remote call is **best-effort with a localStorage fallback** — if Supabase is unreachable or
  the owner is signed out, the link still works on the creating device (a "saved on this device only"
  hint shows in the create dialog).

A live demo helpdesk is seeded: **`/help/dummy-bridge-test`** (public, one sample ask).

Remaining seam (optional): an ask the owner creates **in-app** and marks public is not yet pushed to
Supabase — only asks posted on the public page itself sync. Wire `submitRequest` (authenticated INSERT,
`requester_id = auth.uid()`) to close it.
