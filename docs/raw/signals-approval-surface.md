# Signals as the unified approval surface (recon + data-processing)

**Decision (2026-06-19):** All draft-then-approve gates — recon's promotion gate, recon entity-merges, and ad-hoc data-processing ops (ETA load, community cleanup/merge) — surface as **Signals in the Bridge AI app** and are approved there. One governance surface, not per-tool gates.

## Why
Bridge's principle is governed agentic execution: explainable, permissioned, auditable, draft-then-approve, with **every Signal → an action**. Recon already implements draft-then-approve *locally* (staging.jsonl → permanent.jsonl). The browser/MCP path for direct prod writes is (correctly) gated. Routing through Signals unifies the human gate and lets a **server-side executor with the service key** perform the privileged write on approval — never the RLS-bound browser.

## Data model (existing `signals` + `signal_actions` tables)
`signals`: `id, workspace_id, subject_type, subject_id, type, payload jsonb, recommended_action jsonb, status` (public SELECT policy → frontend reads directly). `signal_actions`: `id, signal_id, user_id, workspace_id, verb` (public SELECT+INSERT).

Conventions added by this surface:
- `type`: `recon.promotion` | `recon.entity_merge` | `data.eta_replace` | `data.company_cleanup` | `data.company_merge`
- `status`: `new` → `approved` → `applied` | `dismissed` (executor sets `applied`; failures set `error` in payload)
- `payload`: operation params + a human **preview** (counts, sample diff) so the card is explainable without resolving uuids
- `recommended_action`: `{ verb, label, description, apply: { tool: 'recon', op: <type> } }`

## Flow
1. **Publish.** A gate fires → `publishSignal()` (recon, service key) upserts a `signals` row (`status='new'`). Recon promotion: when `storeStatus().needsApproval`. Data ops: staged explicitly (this session's ETA work).
2. **Render.** Bridge `SignalsView` loads DB signals (`loadDbSignals()`) merged with the existing derived signals; renders context/insight/evidence + the preview; Approve / Dismiss buttons.
3. **Approve.** Bridge records the decision in the append-only `ledger` (existing `recordDecisionAppend`/`proposeToLedger` path) AND POSTs to recon `POST /api/signals/[id]/apply` (`NEXT_PUBLIC_RECON_URL`).
4. **Execute.** Recon `applySignal(id)` dispatches on `type` to a handler that performs the privileged write with the service key, sets `status='applied'`, writes a result into payload. Idempotent (re-apply is a no-op once `applied`).

## Handlers (recon `lib/signals.ts`)
- `recon.promotion` → `promoteStaging()` (existing) — commit staged OSINT rows to permanent.
- `recon.entity_merge` → record the confirmed EntityLink / merge canonical rows.
- `data.eta_replace` → delete prior `searcher_insights_website` searcher-site rows (`del1-3.sql`) + load clean set (`load.sql`). Executes staged SQL via a `pg` client (`DATABASE_URL`).
- `data.company_cleanup` → null junk `current_company_name` (employment-type, tenure, company==full_name).
- `data.company_merge` → apply `{variant → canonical}` map to `current_company_name`.

## Status
- ✅ recon `lib/signals.ts` (contract + `publishSignal` + `applySignal` dispatch; promotion handler wired to `promoteStaging`).
- ✅ recon API: `GET /api/signals`, `POST /api/signals/[id]/apply`, `POST /api/signals/sync` (publish recon gates).
- ⏳ Bridge frontend: `loadDbSignals()` + `SignalsView` render/approve wiring (spec above).
- ⏳ data-op SQL handlers wired to `pg` (staged SQL files exist in `My Data/ETA/scraper/investors/`).
- ⏳ live end-to-end verification (recon dev server + Bridge preview).
