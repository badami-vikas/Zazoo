# Social Media Integrations — Design Spec

**Date:** 2026-06-20 · **Status:** approved; build in progress (Slice A done)
**Scope:** LinkedIn, Instagram, X, Facebook integrations under Integrations, with user-editable permissions, feeding the relationship graph by approval and writing draft-then-approve. Private content on the local plane; cloud canonical = public facts only.

## Honest boundary
Live API calls to all four platforms need external credentials that cannot be provisioned by writing code (X paid dev app; Meta App Review for IG/FB; LinkedIn forbids network reads → consented `Tools/recon` extension capture). The system is built **to the credential seam**: real, tested, end-to-end in dev via a `dummy_` fixture provider mode that flips to live when each platform's OAuth app keys are supplied.

## Architecture
One `SocialProvider` interface; four implementations behind it. Nothing bypasses the gate (`pipeline.propose` / `pipeline.decide` in `apps/api`). Two-plane residency enforced: private content (DMs, posts, tokens, bodies) persists local-only; only public/identity facts dual-write to Supabase.

## Internal slices (all this session)
- **A — Local-store adapter (DONE, verified).** `pglite`-backed Drizzle handle (`packages/db/src/client-local.ts`, `createLocalDb`) binding the SAME schema + ports as cloud. Loads the `vector` extension before migrating (0000 references `vector(768)`; its `CREATE EXTENSION` lives in the non-journaled seed). `Database` type broadened to the postgres-js | pglite union so all Drizzle stores drive either plane. Test: `packages/db/test/local-store.test.ts` boots the local plane, migrates, and reads ledger + governance tables through the real ports. Full monorepo typecheck + tests green.
- **B — Permission management.** tRPC procedures over `governance-stores.ts`: list / grant / narrow / revoke per-integration scopes (`resource:action` tokens, `revoked_at`, ephemeral grants). `external:send` shown as always-approval-required (agent-floor DENY, non-togglable). Frontend panel replaces the mock in `IntegrationDetail.tsx`.
- **C/D — Provider framework + 4 clients.** `SocialProvider` { connect, sourceTouchpoints, draftAction, publish }. X (API v2), IG/FB (Meta Graph, business accounts), LinkedIn (recon extension). OAuth config from env; `dummy_` fixture mode when keys absent.
- **E/F — Read + write wiring.** Read: source → local quarantine → `pipeline.propose` (typed Person/Touchpoint/Memory/Signal) → approve → commit + ledger. Write: `draftAction` → `pipeline.decide` at ≥L2 → gated `publish` → audit. Uncertain person-matches → manual-confirm Signal, never auto-link.

## Per-platform access reality
- **X:** API v2, OAuth2 user-context, paid tiers; compliant read + post.
- **Instagram/Facebook:** Meta Graph, business/creator only; relationship/DM reads heavily restricted; no scraping.
- **LinkedIn:** API forbids network/DM reads → consented `Tools/recon` extension capture only.

## Data flow
capture/source (live or fixture) → **local plane (pglite)** → quarantine → gate proposal → human approval → Mirror commit + append-only ledger. Tokens + bodies local-only; public identity facts dual-write to Supabase.

## Testing
Per slice. A: pglite adapter against the real migrations + port reads (done). B: grant/revoke units. C/D: fixture provider. E/F: one read-to-approved-proposal, one draft-to-approved-publish, one grant+revoke.

## Notes / deferred
- Append-only REVOKEs + RLS (cloud, multi-tenant) are not applied to the single-user local plane; revisit if the local store becomes multi-tenant.
- Only migration `0000` is journaled; the governance seed (`0001`) is applied out-of-band in cloud and is not needed for the local read-path test.
