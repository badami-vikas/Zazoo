# DealPilot

BRD: [../raw/brd-dealpilot-2026-07.md](../raw/brd-dealpilot-2026-07.md) · delivery: [../raw/dealpilot-module-plan-2026-07.md](../raw/dealpilot-module-plan-2026-07.md)

- One ETA Module. Human owns data rights + investment Decisions.
- Only default Pages: Deals / Sources / Theses. Everything else = standard Module or Record Detail Section unless user adds eligible DB-backed Page.
- Every row gets Record Detail. Deal: evidence/finance/Files/Results/Integrations/Relations/Tasks/activity. Source: connection/credential controls/rights/health/Runs/Deals/Theses. Thesis: criteria/versions/evidence/Sources/Deals/fit.
- Source table: Link · secure virtual User ID/Password · Last checked · Spend cap/spend · rights/health. Secret stays Credential Broker/keychain. Reveal/copy = Human re-auth + audit; never Agent/crawler/API/export.
- Discovery = manifest Automation → stored Egress Agent → Goal/Task Skill. Browser cannot claim Agent.
- Gmail = Source cursor + receipt-time overlap + approved sender + message-ID dedupe + 5-page resumable runs. Keep first checkpoint + token history. Bad token/cycle fails closed, restarts head. Ack after capture/spend. Partial fetch/backlog keeps cursor. Charge every attempted alert, even parse miss.
- Approved Source↔Thesis backfills existing Deal↔Thesis. New Deals inherit same relation.
- Relationship column only with Relationship DB binding. Tasks column with Calendar/Work binding; present by default.
- Standard capability inventory. DealPilot customizes contents, never structure.
- Work split: Learning research · Internal Strategist analysis · CoS stakeholders · Builder programming · Governance review. Skills bind Goal/Task; no default specialist Agents.
- Delivery DP0–DP6. Acceptance includes real data/empty states, standard toolbar/menus, desktop+375px proof, no display aliases, runtime taint gates.
- TASK-006 open. Supabase/Auth/RLS/restart/UI proven live. Blocked: authorized Source credential + Google OAuth → BizBuySell Deal + reveal/copy/revoke/expiry.
