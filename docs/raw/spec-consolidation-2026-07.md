---
title: Spec Consolidation — Control Panel, Workspace Naming, Avatar Day-1, Onboarding Egg, Dream Cycle, Virtual Office
type: raw
doc_kind: design
status: active
updated: 2026-07-06
companions: []
related_wiki: ['vision', 'clients', 'roadmap']
tags: [spec, avatar, onboarding, shell, control-panel, ux]
---

# Spec Consolidation — Bridge Frontend + Kernel Interfaces (2026-07-06)

This document consolidates five load-bearing UX + interaction specs that define the **first-session experience** and **daily workspace shell** for Bridge. Each section is independently buildable; together they form the Phase-1 interface contract for kernel + three clients.

---

## 1. Control Panel — Persistent Shell Affordance

**Goal:** Unified access to Settings, Tools, Approvals, Ledger, Integrations, Agents, Skills without leaving the workspace.

### Placement & Behavior

- **Desktop (Tauri shell):** Fixed sidebar icon (≈40px, bottom-left within the sidebar footer). Always visible when `apps/web` is mounted. Click opens a full-height overlay panel from the right edge, non-blocking (user can dismiss and return to workspace).
- **Web (browser):** Top-right corner of the nav bar (next to profile icon). Click opens a modal dialog, centered, ≈600px wide, scrollable interior. Same keyboard shortcut across both (`Ctrl+K` or `Cmd+K` + "control" subcommand, or dedicated `Ctrl+,` / `Cmd+,`).
- **Mobile:** Fixed bottom-sheet trigger (aligned to Settings icon). Opens a full-screen sheet with stacked sections (no horizontal scroll).

### Contents (Composable Sections)

Each section is a **clickable card** with title + icon + brief description + CTA (e.g., "Open Settings", "Review Approvals").

1. **Settings**
   - Workspace name, avatar customization (spirit animal + visual style)
   - Model provider selection (Ollama dev / Claude default / user's own API key)
   - Data residency: local-only vs. cloud-synced (if Phase-2 gate enabled)
   - Export/Archive workspace
   - Keyboard shortcuts quick-ref (expandable)

2. **Tools**
   - List of installed/available tools (Resources, Calendar, JobPilot, Recon, Helpdesk, custom)
   - Status per tool (active / not-wired / beta / archived)
   - Quick "open" link for each
   - Search/filter by capability name

3. **Approvals** (=Governance Ledger)
   - PENDING count badge on the Control Panel icon itself
   - Opens to pending workflow/capability/ritual proposals
   - For each: requester, what/why, risk band, timestamp
   - CTA: "Review & Approve" or "Veto & Edit"
   - Optional: filter by type (capability / workflow / ritual)

4. **Ledger** (=Audit Trail)
   - Read-only immutable log of all executed proposals (approved / vetoed / merged)
   - Searchable by timestamp / initiator / capability name / result
   - Exportable as JSON for compliance/review
   - Link to each entry's full decision record + evidence trail

5. **Integrations**
   - Connected services (Gmail, Calendar, Zapier, custom OAuth apps)
   - Status per integration (connected / pending-auth / revoked)
   - Scopes granted + expiry per integration
   - "Revoke" / "Re-auth" / "Grant additional scope" CTAs

6. **Agents**
   - Active agents (Chief of Staff, Learning Agent, Capability Builder, user's custom agents)
   - Status per agent (idle / running / suspended / error)
   - Last action + next scheduled action (if applicable)
   - "Suspend temporarily" / "View logs" CTAs

7. **Skills**
   - User's installed skill library (both built-in + community)
   - Version info + last-updated per skill
   - Enable/disable toggle per skill
   - "View marketplace" link to discover new skills

### Interaction Details

- **Click icon → open panel** (modal or overlay depending on surface)
- **Click section card → expand full section** OR navigate to dedicated page (Settings might be full-page, Ledger might stay drawer)
- **Search/filter** available in Integrations, Agents, Skills, Ledger (single search box at the top of the panel)
- **Keyboard navigation:** Tab through cards, Enter to open, Escape to close panel
- **Badge on icon:** PENDING count (Approvals) or warning state (e.g., "1 error" if an agent is suspended)
- **No section defaults to open** — all collapsed/listed on first open

### Technical Contract

- Control Panel state = part of `<Layout>` (apps/web's main nav shell)
- Sections map to existing tRPC routers: `workspace.settings`, `tool.*`, `approvals.*`, `ledger.*`, `integration.*`, `agent.*`, `skill.*`
- No new API endpoints required; reuse existing CRUD + list procedures
- Mobile responsiveness: test at 375px (iPhone SE) from day 1

---

## 2. Workspace Name from Email Domain

**Goal:** Coherent, user-friendly workspace identity at signup, no manual naming step.

### Logic

At **signup confirmation** (after auth + email verification):

1. **Extract domain** from the user's email address (e.g., `alice@acme.com` → `acme.com`)

2. **Domain type classification:**
   - **Business domain** (not in the consumer-domain allowlist):
     - `acme.com` → `"Acme"` (title case, drop domain, single word OR use the company-registered name if available via a free DNS/corporate registrar API — optional sophistication, not required for MVP)
     - `aws-innovation.corp` → `"Aws Innovation"` (title case, convert hyphens to spaces)
     - `5-star-consulting.co.uk` → `"5 Star Consulting"` (hyphens → spaces, numbers preserved)
   
   - **Consumer domain** (hardcoded allowlist: `gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `icloud.com`, `aol.com`, etc.):
     - `alice@gmail.com` → `"Alice's Workspace"` (first name from email local part + " Workspace" suffix)
     - If the user's profile object has a `full_name` or `first_name` field after OAuth, prefer that; otherwise parse the email local part (before `+`)
   
   - **Edge cases:**
     - Subdomain (`alice@eng.acme.com`): treat as `acme.com`, workspace = `"Acme"`
     - Numbers/symbols only (`alice@123.com`): fallback to `"<FirstName>'s Workspace"`
     - Malformed/unusual TLD: fallback to `"<FirstName>'s Workspace"`

3. **Store as `workspace.name`** in the schema (workspace table). User can edit this anytime in Settings.

### Data Storage

- New field: `workspace.suggested_name` (string, nullable) — the name derived at signup time
- Existing field: `workspace.name` (string, non-null) — set to `suggested_name` at creation, mutable thereafter
- No migration needed; forward-only on new signups

### Implementation Points

- Logic lives in `apps/api` workspace-creation flow (e.g., `wiring.ts` or a new `workspace-naming.ts` helper)
- Consumer domain allowlist = small constant array (GitHub's `github/gitignore` email-regex pattern is a reference, but simpler is fine: just the 10 most common)
- Tested by unit tests covering business/consumer/edge cases (no network calls)
- UI: Display the suggested name during onboarding confirmation; show "Click to edit" tooltip if user hovers

---

## 3. Avatar Day-1 — Operational Status Surface, Personality Secondary

**Goal:** User sees **what the avatar is doing right now**, not just a decorative mascot. Every interaction leaves a trace.

### Operational States (Priority Order)

Avatar's **primary display** cycles through these states in real time:

1. **`idle` / `meditating`** — Avatar is waiting for user input or next scheduled ritual. Subtle breathing animation. (No action underway.)

2. **`listening`** — User just clicked the avatar or opened the Control Panel. Avatar "looks at" the user (eye contact). Duration: 2–3 seconds or until user navigates away.

3. **`reading_context`** — Avatar is querying the graph / Memory / integrations for context (e.g., before drafting a proposal). Animated "reading" pose (e.g., tilted head, scanning motion). Duration: typically 1–5 seconds.

4. **`drafting`** — Avatar is generating text or code (via LLM or learning model). Animated "thinking" pose (e.g., hand on chin, pen moving). Duration: 1–30 seconds depending on task.

5. **`awaiting_approval`** — A proposal is pending user decision (Approvals inbox has items). Avatar shows a "waiting" pose + a subtle indicator pointing to the Approvals section. Persists until user reviews.

6. **`blocked_by_policy`** — A capability or proposal was rejected by governance policy. Avatar shows a "blocked" pose (e.g., hand up, shaking head). Brief tooltip: "Blocked by policy: <reason>". Duration: until user acknowledges or changes conditions.

7. **`error`** — A ritual/workflow/agent failed. Avatar shows distress (e.g., frown, exclamation mark). Tooltip: "Error in <ritual/agent name>. Check logs." Duration: until user reviews or dismisses.

### The Blink Tell — Capture Events

**Core contract:** Every time the Sensor (desktop Tauri shell) captures an observation (app switch, clipboard change, etc.), the avatar **blinks**. This is the **capture tell** — the user always sees when something is being noticed.

- **Implementation:** `sensor.capture` Tauri event (from `sensor_bridge.rs`) fires → `<Layout>` receives via a React hook (`useAvatarCapture`) → avatar performs a quick blink animation + logs the observation to `CaptureLedger` tRPC
- **Visual:** 200ms eye-close + open (not startling, not hidden)
- **User reassurance:** The blink proves every capture maps to an inspectable Memory entry. User can click the avatar during/after blink → "View captured context" → opens Ledger filtered to that timestamp
- **No blink if no capture permission** — graceful: avatar stays idle, no false positives

### Personality (Secondary)

- **Spirit animal choice** at signup (user picks from 5–10 animals: owl, octopus, fox, bee, corvid, etc., each with a distinct animation style and color)
- **Learned quirks** — Over time, avatar's personality evolves based on user's interactions:
  - Frequently asks for clarification → avatar develops an "inquisitive" pose variant
  - Often approves proposals quickly → avatar becomes slightly more confident
  - Rarely uses a particular tool → avatar learns not to propose it often
- **No stat-streaks or gamification** — personality is *emergence from behavior*, not a quest-log

### Visual Hierarchy

- **Size:** 64×64px (desktop sidebar), 48×48px (mobile), 40×40px (web nav bar) — NOT a large avatar dominating the interface
- **Animation smoothness:** Lottie or SVG frame sequences (not CSS; frame-by-frame control for state clarity)
- **Color:** Inherits from workspace theme (derived from the spirit animal) but never distracts from content
- **Accessibility:** Alt text naming the current state (e.g., "avatar is drafting"); ARIA live region announces state changes ("Avatar is now awaiting approval")

### Technical Contract

- Avatar state machine lives in `@bridge/core` or `apps/web` state (Redux/Zustand/Context TBD)
- State transitions driven by:
  - `chiefOfStaff.converse` / `pipeline.propose` → `awaiting_approval`
  - `ritual.run` / `agent.*` executions → `drafting`
  - Successful decision → back to `idle`
  - `sensor_drain` event → blink + `listening` (2s)
  - Policy evaluation result → `blocked_by_policy` or `error`
- No polling; all transitions are event-driven (tRPC subscriptions or WebSocket for live updates)

---

## 4. Onboarding Egg — Ceremony Under 60s, Hatches on First Usable Workspace

**Goal:** Users see immediate progress; egg grows in lockstep with real setup, hatches only when the workspace is genuinely usable.

### Egg Lifecycle

The egg is a **visual artifact** displayed in the onboarding modal and, post-hatching, on the dashboard.

#### Stage 0: **Egg Created** (background task during signup)
- User enters email → auth → verification
- In parallel, `workspace.create` call is queued; egg (visual) is shown as "incubating" (closed, subtle glow)
- Status text: "Workspace is hatching…"
- No user input required; fully async

#### Stage 1: **Identity Captured**
- After signup, onboarding wizard asks 1–2 quick questions:
  - **Solo or team?** (radio buttons)
  - **Business email domain?** (inferred; can skip/edit)
- Answers stored in `workspace.onboarding_context` (JSON)
- Egg **grows** (visual feedback: egg sprite expands slightly)
- Status text: "✓ Identity captured"

#### Stage 2: **Goal Understood**
- Follow-up: "What's your primary goal?" (Relationship intelligence / Sales pipeline / Hiring / Custom)
- User picks one; stored
- Egg **grows** further (sprite ~50% larger)
- Status text: "✓ Goal understood"

#### Stage 3: **Context Permissions Granted**
- "Authorize one source?" (Gmail, Calendar, Notion, or "Skip for now")
- User grants OAuth OR skips
- If granted, system checks 1–3 integrations in parallel (async, non-blocking)
- Egg **grows** (sprite ~75% full size)
- Status text: "✓ Context connected" or "✓ Ready to proceed"

#### Stage 4: **Candidate Packages Found**
- (Async, background) Learning Agent researches: "Based on your goals + integrations, here are 3 pre-built capability packages"
  - DealPilot (if sales/relationships)
  - Helpdesk + Recon (if support/intel)
  - JobPilot (if hiring)
- Egg **grows** (sprite ~90% full size)
- Status text: "✓ Capabilities discovered"
- User can preview each package (what tables/workflows/agents come with it) OR proceed without

#### Stage 5: **Blueprint Created**
- `compileBlueprint()` runs: merges selected packages + default kernel entities + user's integrations → a runnable workspace definition
- Stored as active `workspace.blueprint`
- Egg **grows** to full size (sprite 100%)
- Status text: "✓ Workspace blueprint ready"

#### Stage 6: **Hatching** (Egg Opens, Avatar Emerges)
- User clicks "Open Workspace" OR 5 seconds auto-advance
- Egg sprite animates opening (shell cracks, avatar emerges from inside)
- Avatar's spirit animal is revealed (user's choice from Spirit Animal picker, integrated into Stage 1 or new Stage 1.5)
- Redirect to workspace dashboard
- Total time: **30–60 seconds** (user can skip questions, or read/think → 2–3 minutes)

### Egg Appearance & Animation

- **Sprite style:** Minimalist, soft-edged, warm color (golden/amber glow)
- **Growth:** Non-linear — faster early, slower mid, fast finish (easing curve)
- **Hatch animation:** 1–2 second sequence (shell cracks, light pours out, avatar floats upward)
- **Post-hatch:** Egg artifact appears on dashboard (user's "workspace created date" memento, no interactions; visual only)

### Data Model

```
workspace {
  id, name, created_at, archived_at,
  onboarding_context: {
    solo_or_team: 'solo' | 'team',
    primary_goal: 'relationships' | 'sales' | 'hiring' | 'custom',
    spirit_animal: 'owl' | 'octopus' | ... ,
    selected_packages: string[], // capability package IDs
    granted_integrations: string[], // oauth provider names
  },
  blueprint: { ... active blueprint ... },
  egg_hatched_at: timestamp | null, // null until Stage 6
}
```

### Technical Contract

- Onboarding wizard: `apps/web/src/app/onboarding/questions.ts` (already exists; adaptable)
- Egg visual: dedicated `<EggHatcher>` component (Lottie + state machine)
- Background tasks: `workspace.create` + `integration.connect` (OAuth) + Learning Agent's package discovery all async, non-blocking
- **No blockchain/verification nonsense:** stages are straightforward UX milestones, not consensus-driven

---

## 5. Fork-Egg Metaphor — Spawning New Workspaces

**Goal:** User can ask the avatar "Create a new workspace for X" → a new egg hatches, new avatar instance, same kernel.

### Interaction Flow

1. **User says** (via Chief of Staff): "I want to track a new deal in isolation" OR "Create a separate workspace for my side project"
2. **Chief of Staff classifies** this as a `workspace.fork` intent
3. **System proposes** (via pipeline) a new workspace with:
   - Name auto-generated (e.g., "Acme — Side Project") or user-provided
   - Selected capabilities (user picks from available packages, or inherits from parent)
   - Shared graph or isolated (yes/no switch)
4. **User approves** the proposal
5. **New egg hatches** (same 60-second ceremony)
6. **User can switch** between workspaces via a workspace switcher in the Control Panel OR the avatar's "office" menu

### Multi-Instance Architecture

- **Shared kernel:** One graph, one Memory, one ritual engine
- **Isolated workspace definitions:** Each workspace has its own `blueprint`, own `capability_state`, own Approvals queue
- **Data scope:** Graph entities tagged with `workspace_id` (or scoped by view/filter — exact mechanism deferred to Phase-2)
- **Avatar instances:** One avatar per active workspace; user can have N avatars (one per workspace), but only one active at a time
- **Merging/splitting:** Future capability (Phase 3–4); architecture must not block it

### Future Extensions (Out of Scope)

- Merge two workspaces (de-duplicate graph, reconcile Approvals)
- Publish a workspace as a template (for teams to fork)
- Share a workspace instance (multi-user, role-based access)

---

## 6. Dream Cycle — Idle-Time Background Ritual

**Goal:** Avatar continuously improves the workspace **without user prompting**, via governed proposals that user reviews asynchronously.

### Dream Mechanics

**Trigger:** Avatar detects idle time (no user interaction for N minutes, configurable; default 5 minutes).

**Ritual (`dream-cycle`):**

1. **Consolidate Memory:** Avatar runs `memory.search()` over the last 7 days of Signals + Touchpoints + Memories to identify:
   - Repeated workflows (same ritual ran 3+ times, or same agent solved similar problems)
   - Underutilized tools (installed but never used)
   - Governance patterns (user approves certain proposal types 90%+ of the time)
   - Capability gaps (user's actions suggest a missing tool or skill)

2. **Propose Improvements:** For each pattern discovered:
   - **Promote a workflow** (if repeated 5+ times + 80%+ consistent) to a new draft automation step
   - **Deprecate a tool** (if unused for 30 days) → propose archiving it
   - **Auto-grant capability approvals** (if approval rate >90% for a class) → propose raising trust budget for that class
   - **Suggest a new skill/integration** (e.g., "You email this person every Monday; try Calendar integration?")

3. **Draft → Approvals Queue:** Each proposal is governed:
   - Risk class computed from manifest (Informational proposals auto-approve; Advisory + Transformational require user review)
   - All appear in the Approvals section of the Control Panel
   - User can approve, veto, edit, or ignore (ignore = don't ask again for this pattern)

4. **Execute on Approval:** Approved proposals update workspace state (activate workflow, revoke skill, bump trust, etc.)

5. **Metrics:** Dream cycle logs its findings to a `dream_log` table (audit trail for understanding how avatar improves over time)

### Interaction Surface

- **No interruption:** User is never notified mid-interaction; dreams only run during detected idle time
- **Async review:** User checks Approvals when ready (hour(s) later)
- **Dismissal:** User can "snooze" a dream proposal (re-propose in 7 days) or "never" (suppresses pattern forever)

### Technical Contract

- Dream cycle = a scheduled `ritual` (triggered by `RitualExecutor` on idle or via cron, e.g., every 2 hours)
- Uses `memory.search()` (Mem0-style semantic search over past Signals)
- Proposals are drafted via `pipeline.propose()` (no new code path required)
- No LLM calls for analysis; use deterministic rules (count + timestamp-based) for pattern detection

---

## 7. Virtual Office / AI Executive Office — Board Meeting Ritual

**Goal:** Frame agents + capabilities as an executive team; periodic review ritual surfaces insights + metrics.

### The Executive Team

**Avatar acts as Chief of Staff.** Beneath the avatar, three additional personas (not full avatars, just titles + icons):

1. **Chief of Staff (= Avatar)** — Routing, prioritization, onboarding new capabilities
2. **Chief Learning Officer** — Market research, competitive intelligence, new integrations
3. **Chief Automation Officer** — Workflow health, ritual performance, skill versioning
4. **Chief Intelligence Officer** (optional) — Recon/Helpdesk/external data synthesis

Each agent maps to one of Bridge's core agents (Learning Agent, Capability Builder, etc.).

### The Board Meeting Ritual

**Trigger:** Weekly or user-requested (via "Board Meeting" option in Control Panel → Agents).

**Flow:**

1. **Chief of Staff opens the meeting** (brief narrative framing the week's activities)
2. **Each Chief presents** (in sequence, can skip):
   - **Learning Officer:** "Discovered 3 new integrations, 2 competitor moves. Recommend connecting Notion."
   - **Automation Officer:** "Ran 12 workflows, 95% success. Proposed 2 workflow automations from dream cycle."
   - **Intelligence Officer:** (if Recon installed) "Flagged 5 new high-potential companies. Proposed outreach sequence."
3. **User can ask questions** (Chief of Staff routing; user's voice input or text)
4. **Vote on proposals** (auto-approve Informational, ask user on Advisory+)
5. **Close meeting** (Chief of Staff summarizes decisions)

### Visuals

- **Board room UI:** Each agent is a card (title + brief bio + current status + "Let me hear from <Chief>")
- **No video/voice synthesis** (not MVP) — text responses from agents, read via screen reader for accessibility
- **Transcript:** Downloadable/exportable board-meeting minutes for audit trail

### Technical Contract

- Board meeting = a special `ritual` (orchestrated by `RitualExecutor`)
- Agents are iterated via `agent.run()` with a `board_meeting_context` (metadata: "You are X. Present findings.")
- All proposals during a meeting are tagged with `board_meeting_id` in the Ledger
- No new API endpoints; reuse existing `ritual.run` + `agent.run` + `pipeline.propose`

---

## 8. Integration Summary (All Specs Together)

### Day-1 User Flow

1. **Signup** → Email validated
2. **Onboarding wizard** (1–2 minutes)
   - Solo/team + goal + spirit animal
   - Egg grows through stages
3. **Egg hatches** → Avatar emerges → Dashboard opens
4. **Control Panel accessible** (corner icon) — user reviews Approvals, integrations, settings
5. **First interaction** (e.g., "Show me my deals") → Avatar listens, drafts a proposal, awaits approval
6. **Approval reviewed** → Avatar executes, shows result
7. **Idle 5 minutes** → Dream cycle runs → new proposals appear in Approvals

### Ongoing Rhythm

- **Daily:** User interacts with workspace; avatar shows operational states; blinks on captures
- **Weekly:** Dream cycle finds patterns; Board Meeting ritual summarizes week
- **Anytime:** User can fork new workspace, request new skills, adjust settings via Control Panel

### Non-Blocking Assumptions

- Avatar state machine + Control Panel structure assumed to work without changes to `@bridge/core` or the governance pipeline
- All APIs (tRPC routers) already exist or are planned in parallel Phase-1 work
- No new database tables required for egg/avatar states (metadata lives in existing `workspace` / `workspace_context` / `ledger`)

---

## 9. Open Questions & Deferral

- **Text-to-speech for agent presentations:** Not MVP (Board Meeting); optional Phase-2
- **Avatar customization beyond spirit animal:** Clothing, accessories; defer to Phase-2
- **Workspace sharing/multi-user:** Deferred to Phase-3 (architecture allows, no breaking changes needed now)
- **Undo/rollback of approved proposals:** Optional; approve/veto flow is immutable for now
- **Mobile dream cycle / board meetings:** Deferred; desktop-first (mobile gets lighter, simpler ritual support)

---

## Appendix: Vocabulary (Bridge Scope)

All mentions of agent work use **kernel vocabulary** (not sales/CRM terms):

- **Person** — Individual
- **Relationship** — Connection between Persons/Communities
- **Memory** — Captured fact or insight
- **Community** — Group or organization
- **Initiative** — Goal or project
- **Ritual** — Scheduled/repeatable workflow
- **Touchpoint** — Interaction event (email, call, etc.)
- **Signal** — Actionable observation
- **Capability** — Tool, skill, agent, or workflow
- **Proposal** — Draft artifact awaiting governance decision

Domain vocabularies (DealPilot's "Deal", Helpdesk's "Ticket", Recon's "Target") are OK in workspace scope; not in kernel docs/code.
