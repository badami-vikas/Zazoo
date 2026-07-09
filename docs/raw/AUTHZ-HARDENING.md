---
title: Authorization hardening — relevance assessment (2026-05-31)
type: raw
doc_kind: design
status: active
companions: []
related_wiki: ../wiki/architecture.md
updated: 2026-06-22
tags: [authz, security, governance]
---
# Authorization hardening — relevance assessment (2026-05-31)

Context: an external review of *another* platform recommended a "Permission Engine" pillar
(membership ledger, single `can()` source, workspace context from membership not JWT, home-workspace
invariant, impersonation attribution, RLS-as-primary-guard, an authorization conformance suite).
**Is it relevant to Bridge AI?** Yes — the failure class (facilitator leaks into another workspace;
admin locked out of own workspace; permissions reimplemented in 4 places that disagree) is exactly the
"multiple implementations of one truth" bug. But Bridge **already implements the core** of the fix and is,
on this axis, ahead of the platform being critiqued.

## What Bridge already has (verified against the live schema)
- **Membership ledger** → `workspace_members(workspace_id, user_id, role_id)`. Role is **per-(workspace,user)**, NOT a column on `users` (which holds identity only: id/email/name). This structurally prevents Failure 1 (role without workspace check) and Failure 2 (role and ownership stored separately and evaluated independently). `roles` are workspace-scoped; `teams`/`team_members` exist.
- **Single permission source** → app-layer `requireAuthority(actor, resource, action, { onBehalfOf, runId })` resolves `(role_grants ∩ agent.capability_scope) ∪ active_ephemeral_grants − explicit_deny` (and `∩ principal authority` for on-behalf-of). This IS the recommended `can(userId, workspaceId, action)` — one implementation, not per-UI/per-worker.
- **Permissions from membership, not JWT** → authority resolves from DB rows; the JWT (Supabase Auth) carries **identity only** — `users` has no role column to infer from. ✅ matches "JWT = identity, permissions = membership."
- **RLS as primary guard** → applied + **isolation PROVEN** via JWT-impersonation (cross-workspace / co-member-private / cross-owner-write all blocked). `workspace_members` drives the `my_workspace_ids` SECURITY DEFINER helper → even if UI/worker/API break, Postgres refuses the query.
- **Impersonation attribution** → the append-only `ledger` records `on_behalf_of_type/id` + `delegation_id` (actor → effective principal). Bridge is **ahead** of the recommendation here (the doc only asks for `{actor, actingAs}`; Bridge also has delegation provenance + run_id).

## Net-new to adopt (the real gaps)
1. **Authorization Conformance Suite — elevate to a first-class pillar** (the biggest add). Bridge proved RLS once, ad-hoc. Formalize the standing scenarios, run in CI like the runtime conformance:
   - S1 Workspace admin accesses own workspace → **succeed**.
   - S2 Facilitator/member accesses assigned workspace → **succeed**.
   - S3 Member accesses **unassigned** workspace → **fail** (RLS + requireAuthority).
   - S4 Platform owner impersonates workspace admin → **succeed** AND ledger row with `{actor, actingAs}`.
   - S5 **Removed** member with a still-valid JWT → **fail** (RLS joins `workspace_members` live, so revocation is immediate — add the test to lock it in).
   - S6 Cross-workspace access attempt → **fail**.
2. **Home-workspace invariant** — formalize as DB constraints: add `users.home_workspace_id` + `workspaces.owner_user_id` with `users.home_workspace_id = workspaces.owner_user_id` for the owner. Makes "admin can't access own workspace" structurally impossible.
3. **No permission may ever read a JWT role claim** — add a lint/test asserting authz never derives from JWT claims (identity only). Today there's no role claim to misuse; keep it that way as auth evolves.
4. **One `can()` entrypoint everywhere** — ensure the React route guards / future edge functions / direct Supabase queries all funnel through `requireAuthority` (or RLS), never a re-implemented check. RLS is the backstop; `requireAuthority` is the app-layer single source.

## Verdict
Runtime/authority model is mature; the **permission-truth** discipline (membership ledger, single resolver,
RLS, on-behalf-of) is already in place. Treat **Permission Truth** as a named pillar alongside the Runtime
Engine, and make the **Authorization Conformance Suite + home-workspace invariant** the standing rigor —
then role-scoping bugs become as hard to introduce as state-sync bugs.
