# Helpdesk (wiki)

full: [../raw/helpdesk-plan.md](../raw/helpdesk-plan.md) · requirement (verbatim): [../raw/helpdesk-requirement.md](../raw/helpdesk-requirement.md)

**What:** AI-mediated assistance network — route a need to people who CAN help (capability, not topic), propose actionable ways they could contribute, kill feed noise. A native Bridge Tool (ontologically a **Workspace** surface; Help Request = a domain-shaped **Request** work primitive — [ontology](ontology.md)).

**Fits the thesis:** "who can help whom" + reciprocity. Routing = **capability-match over the relationship graph** → governed proposals (draft-then-approve). Invisible-by-default = no match = not shown (= Signals rule).

## Maps to existing primitives
- AI proposes / humans decide = **draft-then-approve** (each route = a proposal in Approvals).
- Capability routing (NOT topic) = **capability broker** applied to people (recipient role/company/expertise/community ∩ request need-tags; "can contribute?" not "likes?").
- Per-recipient independent eval = **local-plane** reasoning.
- Custom Helpdesks (multi-tenant) = workspace scoping + **RLS**.
- Public helpdesk + shareable URL = **shared-link/public run mode** (deferred).
- Public visibility rules = two-tier **visibility + consent** projection.
- AI moderation before publish = **Policy(pre)** gate (deferred).

## Scope (user-confirmed)
- **THIS build = In-Bridge governed MVP.** Vocabulary = **new Help Request entity**; helping → **Touchpoint**; **Helpdesk Workspace** = own entity (public help community), NOT a tenant workspace, NOT a Community.
- Routing in prototype = **deterministic intent × capability** over `network.ts` (real model later, same seam). `classifyIntents` (regex → intro/hiring/funding/feedback/expertise/…) × `KIND_SERVES` matrix (capability-kind serves intent, 0–2) = the gate; topic overlap = bonus (strict tokenMatch + DOMAIN_NOISE filter + word-boundary kinds). Founder serves hiring/funding/intro even off-topic. Node-verified vs the 600-person network.

## MVP build (P0)
- **Supabase schema + RLS**: `helpdesk_workspaces · help_requests · help_routes · help_offers · helpdesk_members` (recipient_id/helper_id = text so they reference local network people).
- **Prototype**: local reactive store `data/helpdesk.ts` (operational data local, like Initiatives) + routing engine; governance rides Supabase (each route → `proposeToLedger` → Approvals).
- **UI `/helpdesk`**: My Helpdesks dashboard (counts) · workspace view · New Request (mode: AI-assisted default | Broadcast + auto-filter) · **"Requests you may help with"** inbox (why-you + assistance paths + Offer Help/Dismiss) · request detail (#helpers, offers, contact gated by pref). Registered as a Tool + nav.
- **Offer Help** = approve → `help_offer` + a **Touchpoint** "Helped {requester}".

## P1–P4 BUILT (2026-06-03, all builds green; public surface render-verified)
- **Helpdesk AI = a real Agent** — `IntelligencePage` agentsData + `AgentDetail['helpdesk-ai']` (Goal/Memory/Permissions/Skills: capability-match, intent classification, offer drafting; deny-default, draft-then-approve). Under Intelligence→Agents AND Systems tool list.
- **P1 public page** — `/help/:slug` OUTSIDE AuthGate (App/routes restructured: public route + `<AuthGate><Layout/></AuthGate>` branch). Branded board, public-safe projection (title/body/status/#helpers only). Make-public toggle + Open link in My Helpdesks.
- **P2 anon app** — `PublicHelpdesk.tsx`: identity (name/email req, phone opt), **contact prefs** (allow-direct: email/phone/both vs private "how I can help"), anon offer + contact reveal (`revealContact`, only to a helper who opts in, per visibility), **session recovery** by EXACT name+email (`findMySubmissions`).
- **P3 security** — `Captcha.tsx` (arithmetic challenge) on all public forms; `rateOk()` advisory client rate-limit; **deterministic moderation** `moderate()` (scam/harassment/link/shortener → approved|flagged|held) gates publish; **admin console** (`WorkspaceAdmin`: submissions, moderation approve/hide, identity verification).
- **P4 learning** — auto-filter tuning (inbox 👍/👎 → `tuneIntent` per-intent bias × routing score); capability learning (`recordOffer`→`noteHelpRecorded` → `helperHitBonus` boosts a helper's future routing); cross-workspace discovery (`crossPublish` posts a personal request across the user's public Helpdesks).
- Schema v2 migration `helpdesk_v2_public_identity_moderation` (identity/contact/moderation/brand cols + `help_requests_public` view + anon read of public workspaces). Prototype demo drives off the local store; Supabase model ready for the real public surface.
- **Render-verified**: `/help/entrepreneurship-hub` shows branded board (identities hidden) + Ask-form (identity, contact prefs, CAPTCHA, moderation note) with NO login. In-Bridge additions build-green (behind auth).

## Redesign R1–R5 BUILT (2026-06-04, build green; render-verified in-app)
**Single-page Tool, network-table-aligned, gamified.** Reuses concrete Network sub-assets (`GlideTable` + gallery-card grid + `ListPillRow` + view-dropdown/modal patterns). Formal `<DataViews>` shell extraction = deferred task #76.
- **Pinnable, not nav item** — dropped from Sidebar `navItems`; default-pinned under Work (`Layout` pins + `tools.ts` route `/helpdesk`). User can unpin. Left nav + right AI chat stay omnipresent (Layout).
- **`dummy_` rule** added to CLAUDE.md (all mock/seed `dummy_`-prefixed). Helpdesk seeds re-prefixed.
- **Breadcrumb** — new shared `components/Breadcrumb.tsx`; shows on branch/detail (HelpdeskThread + InitiativeDetail). Top-level nav pages = no crumb.
- **Lists** (`ListPillRow`, `allLabel`/`addLabel` props added): All Requests · Network Requests · My Helpdesk · Other Helpdesks · + Add List. **My asks pinned top of every list**. "My Asks" = filter chip.
- **Views** dropdown: **Card (default, 5:3 h:w portrait `aspect-[3/5]`)** · Table (`GlideTable`). Cards consistent across lists, click → Reddit-style thread `/helpdesk/ask/:id`.
- **Top bar**: AI-mode dropdown (AI filters and Recommendations | AI filters | AI Recommendation | Disable Helpdesk AI — `off` kills routing) · **Add Ask** (steel, Initiatives-style) → modal · **Create Helpdesk** (My Helpdesk list only) · **Streak card** ("7 weeks / of helping others") · **Badges** · **❤️ People Helped** (dummy_base + real offers count) · Impact Report.
- **Add Ask modal** (pop-up): "Share an ask" / "What's your ask?" + body · AI **ways-to-help** preview (`suggestWaysToHelp`, intent→ways; internship example matches verbatim) · attachment clip · "Who should see this ask?" → **Broadcast** multiselect (My Network + Bridge AI 🔒 + "Network Helpdesks I'm part of" w/ (Public)/lock) · **Capability-Based Routing** toggle (replaces AI-Assisted) + tooltip · auto identity (editable) for public asks · "Public asks. Private contact."
- **Ask thread** (`HelpdeskThread`): ask + audience badge + attachments; **"How can you help?"** offer composer (ways checklist + attach + governed `proposeToLedger`→Touchpoint); offers as threaded cards + **nested replies** (`addReply`); **reputation badges** next to helpers (`reputationFor`, dummy_).
- **Create Helpdesk**: name + optional desc (placeholder verbatim) → public-by-default → success "Your helpdesk is ready… [Copy Link]".
- **Impact Report** modal: Dec-31 gated + dev preview button; copy verbatim, dummy_ values.
- **Gamification** = dummy_-seeded, reactive where cheap (People-Helped). Data: `data/helpdesk.ts` extended (waysToHelp/attachments/audience/aiMode on request; waysSelected/attachments/replies on offer; aiMode store; suggestWaysToHelp; my/invited helpdesks; streak/badges/reputation/impact getters; isMine/requestById/addReply).
- Verified: vite build green · Node smoke (suggestWaysToHelp + isMine + aiMode all PASS) · in-app render (page, gamification, lists, Card view, AI-mode, Add Ask + ways preview, Broadcast, Capability Routing, thread, breadcrumb, pinned-under-Work).

## Refinements (2026-06-04)
- Topbar: `StatsCard` merges streak + people-helped; **shield-shaped badges**; **Impact Report = square button** (icon + 2-line label).
- Toolbar: **Filters** dropdown (contains My Asks + status) left of **My Asks**; **3-dot menu** right = **AI recommendation** + **AI Screening** checkboxes (default-on, tooltips) → fold into `aiMode` (replaces AI-mode dropdown).
- Cards: per-card **Pin/Unpin** (`isAskPinned`/`toggleAskPin`); my asks pinned by default; pinned float to top.
- **Add Ask scoped to the active list** (`AskScope`): Network→My Network+Bridge AI🔒+communities; My Helpdesk→my helpdesks; Public Helpdesks→public; All→everything.
- **"Other Helpdesks" → "Public Helpdesks"** (public OR shared-via-link: `addLinkedHelpdesk`/`publicHelpdesks`/`linkedHelpdesks`).
- **Create Helpdesk NOT public by default** — invite-via-link default + Public choice at create AND Make-public toggle after.

## Still deferred
Real Turnstile/hCaptcha + server-side rate-limit/moderation (model) + wiring the public surface to Supabase anon RLS (prototype uses local store) + admin identity-dispute overrides beyond approve/hide.
