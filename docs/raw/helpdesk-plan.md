---
title: Helpdesk — Bridge Plan & Architecture (2026-06-03)
type: raw
doc_kind: plan
status: active
companions: [helpdesk-requirement.md]
related_wiki: wiki/helpdesk.md
updated: 2026-06-22
tags: [helpdesk, plan, routing]
---
# Helpdesk — Bridge Plan & Architecture (2026-06-03)

Requirement (verbatim): `helpdesk-requirement.md`. This is the interpretation + build plan.
Scope confirmed by user: **In-Bridge governed MVP** (no standalone public app / no anon
posting / no CAPTCHA-rate-limit-moderation this build). Vocabulary: **new Help Request
entity**; helping → a **Touchpoint**; a **Helpdesk Workspace** is its own entity (a public
help community), distinct from a Bridge tenant `workspace` and from `Community`.

## 1. Architecture mapping (Helpdesk = a native Bridge Tool)

| Requirement | Bridge primitive it reuses |
|---|---|
| Route to who can help, not a feed | The core thesis (relationship intelligence, "who can help whom", reciprocity) |
| Helpdesk AI proposes, humans decide | **Draft-then-approve** — each routing match = a governed proposal; human Offers Help |
| Capability-based routing (not topic) | The **capability broker**, applied to people: recipient capabilities (role/company/expertise/communities/past-help) vs the request's inferred needs |
| Per-recipient AI evaluates independently | **Local-plane** reasoning — request matched against each recipient's own data |
| Invisible by default | No route proposal → not shown (same rule as Signals: an action or it doesn't fire) |
| Broadcast mode + AI auto-filter | A routing_mode flag; auto-filter = a Policy(pre) that hides low-capability matches |
| AI = support strategist (drafts/resource/expertise/next-step/contact) | Different **outputs of one Agent+Skill** reasoning step, surfaced on the proposal |
| Custom Helpdesks = multi-tenant | `workspace_id`-style tenant scoping + **RLS** |
| Public helpdesk, no account, shareable URL | The **shared-link / public run mode** (deferred this build) |
| Public visibility rules | Two-tier **visibility + consent** projection (public sees title/status/#helpers only) |
| CAPTCHA / rate-limit / AI moderation before publish | Public-intake hardening + **Policy(pre)** moderation gate (deferred this build) |

Routing in the prototype = **deterministic capability-match over the relationship graph**
(role/company/expertise/community overlap with the request's inferred need-tokens), exactly
like the Signals engine. The real model slots into the same proposal seam later — no rework.

## 2. Data model

**Supabase (canonical, additive migration + RLS):**
- `helpdesk_workspaces(id, owner_id, name, slug unique, description, visibility[public|unlisted|private], broadcast_default bool, created_at)`
- `help_requests(id, workspace_id null, requester_id, title, body, need_tags text[], status[open|resolved|closed], routing_mode[ai_assisted|broadcast], created_at)` — workspace_id null = a personal/network request (routed over your own connections)
- `help_routes(id, request_id, recipient_id text, status[proposed|shown|offered|dismissed|hidden], score numeric, reason text, assistance_paths jsonb, created_at)` — the per-recipient "you may be able to help" (recipient_id = text so it can reference local network people in the prototype)
- `help_offers(id, request_id, route_id null, helper_id text, message, contact_shared bool, created_at)`
- `helpdesk_members(workspace_id, user_id, role[admin|member], created_at)`
- RLS: owner/admin manages own workspace; requester sees own requests + their routes; authenticated read scoped; public projection deferred. Append-friendly.

**Prototype (the demoable surface): a local reactive store** `data/helpdesk.ts` mirroring the
schema (workspaces/requests/routes/offers), because the prototype's People/relationships are
the LOCAL network (`network.ts`), not Supabase rows. Operational data stays local (residency,
same as Initiatives). **Governance rides Supabase**: each routing proposal also fires a
`proposeToLedger` row → it appears in **Approvals** (draft-then-approve). Helping (an accepted
offer) → a **Touchpoint** (the work node).

## 3. The routing engine (capability-match, deterministic in proto)

1. On submit, derive **need-tags** from the request (keyword/role tokens: "internship",
   "climate-tech", "fundraising", …).
2. For each candidate (AI-assisted = your connections; broadcast = all connections), score
   **capability overlap**: recipient role/company/position/community/expertise tokens ∩
   need-tags, weighted; NOT topic-affinity ("can contribute?" not "likes this?").
3. If score ≥ threshold → a **route** (status `proposed`) with a `reason` ("Founder at a
   climate fund · hires interns") and **assistance_paths** (Share opportunities · Recommend
   orgs · Recruiting advice · Review materials) inferred from the recipient's capability kind.
   Below threshold → no route (invisible-by-default).
4. **Broadcast + auto-filter**: all connections eligible; auto-filter hides routes below a
   (lower) capability floor so requesters get reach without recipient noise.
5. Each `proposed` route → a governed proposal via `proposeToLedger` (resourceType `help`,
   action `route`, channel `helpdesk`) → Approvals. The recipient **Offers Help** (approve →
   `help_offer` + a Touchpoint "Helped {requester} with {request}") or dismisses (veto).

## 4. UI (prototype, `/helpdesk`)

- **My Helpdesks dashboard**: workspaces (cards: active / resolved / pending-responses /
  helpers / members) + a "Personal requests" lane (workspace_id null) + Create Helpdesk.
- **Workspace view**: request list (status chips, #helpers), New Request.
- **New Request** modal: title + body + routing_mode toggle (AI-assisted default | Broadcast)
  + auto-filter switch (broadcast only) + optional workspace.
- **"Requests you may help with"** (the recipient inbox): routes addressed to you — each shows
  the requester's need, **why you may help** (reason), **proposed assistance paths**, and
  **Offer Help** (drafts an offer → Approvals) / Dismiss. Invisible-by-default honored.
- **Request detail**: status, #helpers, offers (helper name + message; contacts gated by the
  requester's contact preference).
- Registered as a **Tool** (`helpdesk`, intake-style nav) + a left-nav entry.

## 5. Explicitly deferred (post-MVP)

Standalone public web app + anonymous name/email posting + contact-preference public flow +
session-by-name+email + admin identity disputes + CAPTCHA + rate-limit + AI moderation gate +
the requirement's "Future Enhancements" (auto-filter tuning, capability learning,
cross-workspace discovery). The Supabase schema is shaped so these slot in without migration
churn (public projection columns, members/roles already present).

## 6. Phases

- **P0 (this build)**: schema + RLS · local store + routing engine · dashboard/workspace/
  request/inbox UI · governed routing proposals → Approvals · Offer Help → Touchpoint.
- **P1**: public read-only workspace page (in-app projection) + shareable slug.
- **P2**: standalone public app + anon identity + contact preferences + session mgmt.
- **P3**: security (CAPTCHA, rate-limit, AI moderation Policy-pre) + admin disputes.
- **P4**: future-enhancements (auto-filter tuning, capability learning, cross-workspace).
