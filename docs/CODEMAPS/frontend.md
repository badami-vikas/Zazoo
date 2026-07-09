<!-- Generated: 2026-07-04 | Files scanned: Design Bridge AI Interface (Copy)/src/app | Token estimate: ~350 -->

# Frontend Codemap

React + Vite prototype (`Design Bridge AI Interface (Copy)/`). Router in `routes.tsx`;
`Layout.tsx`/`StandaloneLayout.tsx` shells; `AuthGate.tsx` is a hardcoded demo credential
check, not real auth.

## Page → data-source map

```
DataEngine (People/Communities table+gallery+kanban) → data/network.ts (dummy_ stub, real
    file gitignored) → data/db.ts falls back Supabase canonical → local stub, silently
DealPilotPage      → data/dealpilot.ts, real API when VITE_API_URL set (dealpilot.source/
                     commit/list), else dummy_dealCandidates demo set
JobPilotPage       → data/jobpilot.ts — 100% local dummy data, NOT wired to the real
                     @bridge/jobpilot backend at all
CalendarPage       → real Google Calendar API (P0-P2 shipped), dummy_ fallback if API off
HelpdeskPage       → local store; public /help/:slug works outside AuthGate; Supabase anon
                     RLS model designed, not live
SettingsPage       → local; API-Keys tab has a dummy-row duplicate-React-key bug (known-issues)
```

## Persistence

Every table edit (add row, cell override, custom fields, saved lists, sort/filter/group state)
goes through `lib/persist.ts`'s `usePersistentState` → **localStorage only**, explicitly
documented as "prototype-tier; swap for a DB" — this is the intended swap point once the
platform API is live for these surfaces.

## Known structural issues (see ../BUGS.md)

Duplicate merge-artifact config files at prototype root (`package-1.json`, `vite.config-1.ts`,
`postcss.config-1.mjs`, `ATTRIBUTIONS-1.md`) — stale copies, not the live config.

See also: [architecture.md](architecture.md).
