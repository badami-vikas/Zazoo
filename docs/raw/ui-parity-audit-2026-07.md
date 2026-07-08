---
title: UI Parity Audit — apps/web vs Design Prototype (2026-07)
type: raw
doc_kind: audit
status: active
companions: []
related_wiki: ../wiki/design.md
updated: 2026-07-06
tags: [design, ui, parity]
---

# UI Parity Audit — apps/web vs Design Prototype

Scope: compare `platform/apps/web` (the real, wired frontend) against `Design Bridge AI Interface (Copy)/src`
(the visual-language prototype) and produce a concrete implementation punch-list. IA (information architecture)
follows the latest ADR-023 + 2026-07-06 user-revision decisions; visuals follow the prototype. Where the two
conflict, IA wins and the skin is adapted onto the current IA — the prototype's page *inventory* is not being
ported 1:1, only its *look*.

Hosted prototype check: `https://bridge-ai-1ay.pages.dev` is reachable (200, loads) but is a client-rendered SPA —
a plain WebFetch only returns the `<title>Design Bridge AI Interface</title>` shell with no rendered DOM/CSS, so
it could not be used for visual inspection. All findings below come from the local prototype source at
`Design Bridge AI Interface (Copy)/src`, which is complete and authoritative for the skin.

---

## 1. SKIN SPEC

Extracted from `Design Bridge AI Interface (Copy)/src/styles/theme.css`, `fonts.css`, `tailwind.css`. Drop this
into `platform/apps/web/src/styles/globals.css`, which today is **0 bytes** — apps/web currently renders with
zero custom tokens, zero imported fonts, and only bare Tailwind v4 defaults (no `@theme`, no font import, no
color system). This is the single highest-impact gap in the whole audit.

```yaml
imports:
  # Tailwind v4 + tw-animate-css, source-scoped to the app (not node_modules)
  tailwind: "@import 'tailwindcss' source(none); @source '../**/*.{js,ts,jsx,tsx}'; @import 'tw-animate-css';"
  fonts:
    ui: "Geist"            # google fonts: wght 300;400;500;600
    editorial: "Source Serif 4"  # google fonts: ital,opsz wght 300;400;500;600, italic 400
    # NOTE: self-host these two families instead of the Google Fonts CDN url() import used in the
    # prototype — CSP/offline/perf. Same weight set.

color_system:
  light:
    background: "#FAF9F5"
    surface: "#F0EEE8"
    navy: "#1A2B3C"        # heading ink
    navy_mid: "#2E4057"    # body ink
    steel: "#4D7EA8"       # primary brand / actions
    steel_light: "#7FA5C5"
    warm_gray: "#B8B4A8"   # muted text / icons
    border: "#E2DED5"
    sage: "#6B7C65"        # trust semantic
    amber_soft: "#C4955A"  # dormant semantic
    success: "#4F7A52"
    warning: "#C4955A"
    danger: "#C0573E"
    info: "#4D7EA8"
  dark:
    # NOTE: dark overrides the SAME --color-* custom-property names (not a separate namespace) —
    # components read var(--color-navy) etc. directly, so a correct dark mode requires overriding
    # every --color-* token inside `.dark`, not just the shadcn --background/--foreground legacy set.
    background: "#10151B"
    surface: "#1A2129"
    navy: "#ECEAE3"        # inverts to warm off-white, token kept for continuity
    navy_mid: "#C7CBD1"
    steel: "#6B9BC4"        # lifted for dark contrast
    steel_light: "#8FB4D2"
    warm_gray: "#8A8A82"
    border: "#2A323C"
    sage: "#8BA085"
    amber_soft: "#D4A968"
    success: "#7FA882"
    warning: "#D4A968"
    danger: "#E5677A"
    info: "#6B9BC4"

legacy_shadcn_mappings:
  # theme.css keeps a parallel shadcn-style variable set (--background/--foreground/--card/--primary/
  # --muted/--accent/--destructive/--input/--ring/--sidebar-*/--chart-1..5) mapped 1:1 onto the Bridge
  # palette above, so shadcn/ui primitives (button, card, dialog, etc.) inherit Bridge colors for free.
  primary: steel
  primary_foreground: background
  secondary: surface
  muted: surface
  muted_foreground: warm_gray
  accent: steel_light
  destructive: "#d4183d"   # NOTE: destructive is its OWN red, distinct from --danger — intentional split
  border: border
  ring: steel

spacing_cozy:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  "2xl": 64px

radius:
  card: 12px
  button: 8px
  pill: 20px
  avatar: 50%
  # tailwind @theme exposes: --radius-sm 8px / --radius-md 12px / --radius-lg 12px / --radius-xl 16px

typography:
  h1: { font: editorial, size: 32px, weight: 400, line_height: 1.2, color: navy }
  h2: { font: editorial, size: 24px, weight: 600, line_height: 1.2, color: navy }
  h3: { font: editorial, size: 18px, weight: 500, line_height: 1.2, color: navy }   # card headings / person names
  h4: { font: editorial, size: 16px, weight: 500, line_height: 1.2, color: navy_mid }
  body_p: { font: ui, size: 15px, weight: 400, line_height: 1.5, color: navy_mid }
  label: { font: ui, size: 12px, weight: 400, line_height: 1.5, color: navy_mid }
  button: { font: ui, size: 14px, weight: 500, line_height: 1.5 }
  input: { font: ui, size: 14px, weight: 400, line_height: 1.5 }
  base_font_size: 16px    # root html font-size

motion:
  fast: 200ms ease-out       # default interactive transition (buttons, links, hover)
  gentle: 400ms ease-out     # panel/background transitions
  orbit: 2s ease-in-out      # ambient/looping motion (e.g. status pulses)

component_patterns:
  card: "border rounded-xl (12px) bg-white, border-color var(--color-border), hover: border→steel-light + shadow-md"
  primary_button: "bg-[var(--color-steel)] text-white rounded-lg (8px), hover:opacity-90, active:scale-95"
  pill_badge: "rounded-full px-2/2.5 py-0.5, bg color-mix(in srgb, <token> 12-14%, transparent), text color <token>"
  input: "border rounded-lg, bg-[var(--color-surface)], focus:border-steel focus:ring-2 ring-steel/10, bg→white on focus"
  toggle_switch: "w-11 h-6 rounded-full, bg-border(off)/steel(on), thumb translate-x-5 on"
  sidebar_icon_rail: "fixed 76px width, icon+9px label stack, active = steel-light/20 bg + left accent bar"
  agent_panel_bubble_user: "gradient steel→navy-mid, white text, rounded-2xl rounded-tr-sm"
  agent_panel_bubble_agent: "white bg, border, navy text, rounded-2xl rounded-tl-sm"
  color_mix_usage: "extensive use of CSS color-mix(in srgb, <var> N%, transparent) for tinted badges/borders instead of pre-baked hex — requires a modern-CSS-capable browser target (fine for Tauri/Chromium + modern evergreen web)"
```

Tailwind v4 `@theme` block to add (mirrors prototype's `theme.css` lines 165-229, condensed): expose
`--color-bridge-*` custom colors, remap legacy shadcn `--color-*` aliases to the Bridge palette, and set
`--radius-sm/md/lg/xl`. See prototype `theme.css:165-229` for the literal block to adapt.

---

## 2. SURFACE-BY-SURFACE DIFFS

### 2.1 Shell / Sidebar

- **apps/web current**: `Layout.tsx` — ADR-023 six-container IA. Desktop: `w-56` bordered `<nav>` with plain
  text links (no icons), sections "Projects" / "Tools" (pinned, localStorage-backed via `lib/pins.ts`), a
  "Set up workspace…" trigger, and a bottom footer with Intelligence/KnowledgeBase/Settings text links. Mobile:
  `sm:hidden` fixed bottom bar, same three links. Zero color/font styling (globals.css empty) — renders as
  unstyled black-on-white Tailwind defaults with underline-on-hover text links, no icons, no active-state accent,
  no workspace switcher.
- **Desired**: Adopt the prototype's `Sidebar.tsx` visual language — fixed 76px icon rail, icon+micro-label
  stacks, active-state = `steel-light/20` background + left accent bar (2-4px, rounded-r, steel), workspace
  switcher avatar chip at top (can stay a static single-workspace glyph if multi-workspace isn't real yet — do
  not fabricate a workspace switcher UI if there's only one workspace; ADR/NO-dummy-data rule applies to hiding
  it, not to keeping the visual chrome). Map ADR-023's six containers onto icons: Projects → `Target` or
  `LayoutGrid`, Tools (pinned) → tool's own icon from a tools registry, bottom bar Intelligence → `Brain`,
  KnowledgeBase → `BookOpen`, Settings → `Settings`. Add a seventh: **Control Panel** icon (see 2.5) composing
  Settings/Tools/Approvals/Ledger/Integrations/Agents/Skills into one governance-and-config surface, distinct
  from the KnowledgeBase (content) and Intelligence (capability browsing) containers.
- **Files to create/edit**: `platform/apps/web/src/app/Layout.tsx` (restructure nav markup to icon+label rail,
  keep existing pin/unpin logic and route structure — do not touch the IA, only the presentation layer);
  `platform/apps/web/src/styles/globals.css` (tokens, per §1); new
  `platform/apps/web/src/app/components/Sidebar.tsx` if the team wants Layout split the way the prototype does
  (optional — apps/web currently inlines the nav in Layout.tsx, that's fine to keep inlined for a smaller diff).
- **Verification**: `preview_start` the web app, `preview_screenshot` the shell at desktop + mobile
  (`preview_resize` mobile preset), confirm active-route highlight renders, confirm bottom bar variant appears
  under `sm` breakpoint per the existing comment in Layout.tsx.

### 2.2 Home / Composer

- **apps/web current**: home route (`/`) renders `DealPilotPage` (a DealPilot-specific view), not a
  general adaptive-canvas home. The chat/composer lives at a separate route, `/chief-of-staff`
  (`ChiefOfStaffPage.tsx`), not embedded as a persistent right-hand panel.
- **Desired**: IA is intentionally different from the prototype here — DealPilot-as-home and a standalone
  Chief-of-Staff composer route are the current shell's decisions (post ADR-023) and should NOT be reverted to
  the prototype's generic `HomePage.tsx` adaptive-canvas + `AgentPanel.tsx` persistent right rail. What SHOULD
  transfer is the **skin**: apply the card/typography/motion tokens from `HomePage.tsx` (editorial h1 greeting,
  `@container`-responsive card grid, steel-accent CTA buttons with `ArrowRight` icons) to DealPilotPage's own
  card surfaces, and apply `AgentPanel.tsx`'s chat-bubble and command-bar visual treatment to
  `ChiefOfStaffPage.tsx` if it currently renders as a plain unstyled chat.
- **Files to create/edit**: `platform/apps/web/src/app/pages/DealPilotPage.tsx` (restyle cards/typography only),
  `platform/apps/web/src/app/pages/ChiefOfStaffPage.tsx` (restyle chat surface — bubbles, command bar, plus-menu
  pattern from `AgentPanel.tsx:270-353`).
- **Verification**: screenshot both pages before/after; confirm no route/behavior change, only visual.

### 2.3 Projects / Initiatives

- **apps/web current**: `KnowledgeBasePage.tsx` "Projects" tab renders a wired `DataViews` table
  (`graph.listInitiatives`) — no card view, no kanban, no calendar, no create-initiative modal, no per-list pill
  filter bar. Functional but visually bare (default DataViews table chrome).
- **Desired**: Prototype's `WorkPage.tsx` shows the fuller target: view-switcher (Card/Table/Board/Calendar),
  `ListPillRow` filter chips, toolbar (search/filter/sort/export/new), pagination footer, and a lightweight
  "New initiative" modal. Card view has status dot + progress bar + owner/deadline row (`WorkPage.tsx:126-187`).
  Only Card + Table views need to be real (Board/Calendar can stay a "switch back to Card" placeholder exactly
  as the prototype does at `WorkPage.tsx:461-484` — do not fabricate kanban/calendar data to fill the view).
- **Files to create/edit**: `platform/apps/web/src/app/pages/KnowledgeBasePage.tsx` (Projects section) or a new
  `platform/apps/web/src/app/dataviews/` view config for card-mode; port `ListPillRow`-equivalent component into
  `platform/apps/web/src/app/components/shared/`. Reuse `@bridge/tables` `ViewConfig`/`DataViews` machinery
  already in place (`dataviews/index.ts`) rather than the prototype's bespoke table — the prototype's exact
  markup is a skin reference, not code to copy verbatim, since apps/web already has a superior data-source-
  agnostic table abstraction.
- **Verification**: toggle Card/Table, confirm real `listInitiatives` rows render in both; confirm empty state
  matches prototype's `EmptyState` component style (`WorkPage.tsx:581-590`) without inventing placeholder rows.

### 2.4 Knowledge Base

- **apps/web current**: `KnowledgeBasePage.tsx` — tabs Projects/Resources/Communities/People (order: Projects,
  Resources, Communities, People per 2026-07-06 revision comment in file). Resources and Projects are wired;
  Communities and People render an honest `NotWiredYet` placeholder (no backend `graph.listPeople` /
  `graph.listCommunities` procedure exists — correctly not fabricated).
- **Desired**: IA is already correct and first-class per the brief ("KnowledgeBase first-class"). Needed:
  skin pass only — apply Bridge tokens to the `Tabs`/`TabsList` (prototype doesn't have an exact equivalent
  component but its tab-underline/pill pattern from `Header.tsx`/`ToolsPage.tsx` view-dropdown styling is the
  reference), and once `graph.listPeople`/`graph.listCommunities` exist, style People rows using the
  `PersonTiers.tsx` two-tier canonical/private card pattern (see 2.9).
- **Files to create/edit**: `platform/apps/web/src/app/pages/KnowledgeBasePage.tsx` (tab chrome only — do not
  touch the `NotWiredYet` logic, that's correct honesty, not a visual bug).
- **Verification**: confirm tab switch still drives `?section=` query param correctly after restyle.

### 2.5 Control Panel

- **apps/web current**: **does not exist**. There is no unified Control Panel shell entry. Settings, Tools,
  Approvals, Ledger, Integrations, Agents, and Skills are scattered across separate top-level routes
  (`/settings`, `/approvals`, `/integrations`, `/agents/*`) with no single icon/entry composing them, confirming
  the brief's fact.
- **Desired (IA ruling)**: introduce a **Control Panel** icon in the shell (sidebar rail, per 2.1) that composes
  Settings + Tools + Approvals + Ledger + Integrations + Agents + Skills as sub-sections of one governance/config
  surface — mirroring the prototype's `SettingsPage.tsx` left-nav-with-content-pane pattern
  (`navItems` at `SettingsPage.tsx:6-16`, workspace/team/boundaries/governance/notifications/billing/security/
  api/help), but widened to also host Approvals (today its own top-level route,
  `platform/apps/web/src/app/pages/ApprovalsPage.tsx`) and the Ledger (today nonexistent, see 2.7) as additional
  left-nav sections rather than separate top-level pages. Existing `/settings`, `/approvals`, `/integrations`,
  `/agents/*` routes can stay as deep-link targets that land inside the Control Panel's relevant section (avoids
  breaking bookmarks) — the Control Panel is a navigational composition, not necessarily a route-collapsing
  rewrite.
- **Files to create/edit**: new `platform/apps/web/src/app/pages/ControlPanelPage.tsx` (left-nav shell, ported
  from `SettingsPage.tsx` structure, sections: Workspace, Team, Tools, Approvals, Ledger, Integrations, Agents,
  Skills, Governance/Boundaries, Notifications, Billing, Security, API, Help); update
  `platform/apps/web/src/app/routes.tsx` to add `/control-panel` (and optionally alias old routes into it);
  update `platform/apps/web/src/app/Layout.tsx` sidebar to add the Control Panel entry.
- **Verification**: navigate to each composed section via the new left-nav, confirm each renders the same
  underlying component that used to be a standalone page (no functional regression, e.g. Approvals still shows
  live queue).

### 2.6 Approvals / Signals

- **apps/web current**: `ApprovalsPage.tsx` exists in apps/web as its own top-level route (`/approvals`) — need
  to verify against the file directly (not fully read in this audit; existence confirmed via `find`). `SignalsPage.tsx`
  also exists as a top-level route. Both are plain-Tailwind (no tokens) today given the empty globals.css.
- **Desired**: Adopt prototype `ApprovalsPage.tsx` visual language wholesale — it's a strong, close-to-final
  pattern: master list (left, 380px) + detail/diff drawer (right), `ActorChip`/`Provenance` line ("Drafted by
  Agent on behalf of User · ritual run"), line-diff view for proposed vs prior text, "Why this was proposed"
  reasoning card, veto-reason chip picker, Approve/Edit-then-approve/Veto action bar, resolution toast. This is
  governance-critical UI (the Capability Trust Model's human-approval surface) — treat close-to-1:1 visual
  port as correct, only re-wire data bindings to apps/web's existing action-queue/ledger sources instead of the
  prototype's `data/governance.ts` mock.
- **Files to create/edit**: `platform/apps/web/src/app/pages/ApprovalsPage.tsx` (restyle to match prototype
  markup/classes, keep existing tRPC data wiring); once Control Panel exists (2.5), this becomes a section
  within it rather than (or in addition to) a standalone route.
- **Verification**: trigger an approval item end-to-end (approve/veto/edit-then-approve) and confirm the ledger
  record still appends correctly after the restyle — this is a governance surface, so a functional regression
  here is more serious than a cosmetic one.

### 2.7 Ledger

- **apps/web current**: **no Ledger UI exists at all**, confirmed by the brief and by absence from the routes
  list and pages directory.
- **Desired**: Port `ExecutionLedger.tsx` wholesale — append-only tamper-evident table (Timestamp/Actor/On behalf
  of/Action/Resource/Decision), CSV/JSON export, actor/decision/resource-type filters, "Delegation lens" grouping
  toggle, and a slide-in decision-trace drawer (inputs/signals → proposed+diff → reasoning → pre/runtime/post
  policy ladder → emitted-event confirmation). This is core to the "governed before executing" + "explainable"
  principles in CLAUDE.md and should be a first-class, not deferred, surface.
- **Files to create/edit**: new `platform/apps/web/src/app/components/ExecutionLedger.tsx` (port from
  prototype, same filename for easy tracing) wired to whatever ledger/audit-log tRPC procedure exists or needs
  to be added on `apps/api`; mount it inside the Control Panel (2.5) as the "Ledger" section, and/or as its own
  route if governance surfaces should be independently linkable.
- **Verification**: confirm CSV/JSON export downloads produce valid files from real (not mock) ledger rows;
  confirm append-only guarantee is represented honestly (don't claim "tamper-evident" copy unless the backing
  table actually revokes UPDATE/DELETE — check `db`/migrations for that constraint before shipping the banner
  text verbatim).

### 2.8 Settings / Data & Privacy

- **apps/web current**: `SettingsPage.tsx` exists (need full read to confirm section list, but file exists per
  `find`). Styling is unstyled given empty globals.css.
- **Desired**: Reuse prototype's left-nav/content-pane pattern and section list (Workspace, Team, Boundaries,
  Governance, Notifications, Billing, API, Help) but only keep sections that map to real, non-fabricated
  state — the prototype's `teamMembers`/`apiKeys` arrays are dummy-prefixed placeholder data
  (`SettingsPage.tsx:24-35`) and must NOT be ported as-is under the NO-dummy-data rule; either wire to real
  team/API-key stores or render an honest "not wired yet" empty state matching the KnowledgeBasePage precedent
  (`NotWiredYet` pattern). Add a **Data & Privacy** section if one doesn't exist — the brief names it explicitly
  and it isn't in the prototype's `navItems` list either, so this is a net-new section to design (governance/
  boundaries content is the closest existing analog — the "Boundaries" tab default-allow/deny lists is good
  raw material to extend into a Data & Privacy section covering capture/residency/export/delete).
- **Files to create/edit**: `platform/apps/web/src/app/pages/SettingsPage.tsx` (restyle + add Data & Privacy
  section; do not port dummy team/API-key rows).
- **Verification**: confirm every rendered row in Team/API-Keys/etc. traces to a real query, or the section
  shows an honest empty/not-wired state.

### 2.9 Person detail

- **apps/web current**: **no Person detail page exists** (confirmed absent from routes.tsx and pages dir).
- **Desired**: Port the **two-tier** pattern from `PersonTiers.tsx` — Canonical/Public (read-only, sourced,
  e.g. LinkedIn-attributed role/company/location) rendered side-by-side but visually distinct from
  Private/Your-relationship (qualitative Warmth + Orbit/ring labels — explicitly NOT numeric scores per the
  component's own invariant comment, private note, per-relationship visibility control: Only you / Your team /
  Whole workspace). Also port `IntroConsentCard` from the same file — the both-party-consent introduction state
  machine (requested → awaiting_both → active/declined) directly implements the "both-party consent" trust
  principle from CLAUDE.md and should not be simplified into a one-sided "send intro" button.
- **Files to create/edit**: new `platform/apps/web/src/app/pages/PersonDetail.tsx`; new
  `platform/apps/web/src/app/components/PersonTiers.tsx` (ported); add route (e.g. `/person/:id`) to
  `routes.tsx`; link into it from KnowledgeBase's People tab once `graph.listPeople` exists (2.4) — this page
  and that backend gap are coupled, log the dependency rather than building a page with nowhere to navigate
  from.
- **Verification**: once `graph.listPeople` exists, click through from KnowledgeBase → Person detail and confirm
  canonical fields are read-only while private fields (note, visibility) are editable and persist.

### 2.10 Onboarding + avatar

- **apps/web current**: `OnboardingDialog.tsx` exists (a modal, triggered from Layout's "Set up workspace…" and
  auto-opened when `workspace.blueprint.get` returns no definition). No avatar/egg concept anywhere in apps/web
  or in the prototype — confirmed by grep across both trees; the avatar-overlay states
  (idle/listening/reading_context/drafting/awaiting_approval/blocked_by_policy/error) and "egg" onboarding
  metaphor are **net-new product concepts**, not something to port from the prototype visually. The word "egg"
  only appears in `platform/apps/web/src/app/Layout.tsx`'s own comment ("minimal-egg pattern" describing the
  chrome-vs-generated-content split) — a different, already-implemented metaphor (fixed chrome containers with
  swappable inner content), not a literal onboarding UI element.
- **Desired**: This is genuinely new design work, not a parity gap — there is no prototype reference to align
  to. Recommend treating the avatar overlay as its own design pass (spawn a follow-up design/brainstorm task)
  rather than inventing states inline in this audit. Minimum viable: a persistent small avatar affordance (could
  reuse the prototype `AgentPanel.tsx`'s collapsed-rail avatar glyph at `AgentPanel.tsx:84-124` — a 40px rounded
  gradient badge with a status-dot — as the visual seed for "idle/listening/etc." states, since that's the
  closest existing asset: gradient steel→navy-mid badge + small status dot already exists as a pattern for the
  collapsed AI panel entry point).
  For onboarding <60s: `OnboardingDialog.tsx` already exists and is wired to `workspace.blueprint.get` /
  propose→activate (per MEMORY.md's onboarding chaining note) — the <60s constraint is a UX/copy/step-count
  budget to audit against the existing dialog's question flow (`questions.ts`), not a new component.
- **Files to create/edit**: none mandated by this audit (flagging as design-needed, not parity-gap); if pursued,
  new `platform/apps/web/src/app/components/AvatarOverlay.tsx` + a state machine hook, informed by
  `AgentPanel.tsx`'s collapsed-state visual seed.
- **Verification**: N/A until design is scoped — recommend a `superpowers:brainstorming` or
  `product-management:product-brainstorming` pass before implementation.

---

## 3. RANKED IMPLEMENTATION ORDER

1. **P0 — Tokens/globals.css fix.** `platform/apps/web/src/styles/globals.css` is empty; port the full
   `@theme`/`:root`/`.dark` block from the prototype's `theme.css` + font imports from `fonts.css`. Nothing else
   in this audit matters visually until this lands — every other surface today renders in unstyled black-on-
   white Tailwind defaults. This is a pre-existing bug independent of any prototype-parity work and should be
   filed/fixed first regardless of sequencing preference.
2. **P1 — Shell/Sidebar restyle.** Icon rail, active states, Bridge tokens applied to `Layout.tsx`. Every other
   page inherits the sidebar, so this compounds visual credibility fastest.
3. **P1 — Control Panel surface (new).** Composes Settings/Tools/Approvals/Ledger/Integrations/Agents/Skills —
   structurally the biggest IA lift in this audit; unblocks 2.5/2.6/2.7/2.8 landing as one coherent surface
   instead of four separate restyles.
4. **P2 — Approvals restyle** (2.6) — governance-critical, high-visibility, close-to-1:1 portable from
   prototype.
5. **P2 — Ledger port** (2.7) — net-new surface, directly serves the "governed, auditable" principle; no
   apps/web precedent exists yet so this is pure addition, sequence after Control Panel exists to mount into.
6. **P2 — Person detail + PersonTiers port** (2.9) — blocked on `graph.listPeople` existing; can build the page
   against a stub/mock in parallel with backend work, but do not ship real navigation into it until the backend
   query lands (avoid a dead-end page).
7. **P3 — KnowledgeBase tab chrome + Projects card/table view** (2.3, 2.4) — functional already, this is pure
   skin + view-mode completeness.
8. **P3 — Settings restyle + Data & Privacy section** (2.8) — replace dummy team/API-key rows with real or
   honestly-empty state as part of the restyle, not after.
9. **P3 — Home/Composer skin pass** (2.2) — lowest structural risk, cosmetic-only change to already-correct IA.
10. **P4 — Avatar overlay + egg onboarding UX** (2.10) — explicitly flagged as needing its own design pass before
    implementation; not blocking any other item above.

---

## Notes on method

- Read directly: `theme.css`, `globals.css` (both prototype and apps/web), `fonts.css`, `tailwind.css`,
  `index.css`, `Layout.tsx` (both), `Sidebar.tsx`, `AgentPanel.tsx`, `HomePage.tsx`, `WorkPage.tsx`,
  `ToolsPage.tsx`, `ResourcesPage.tsx` (both), `SettingsPage.tsx` (prototype), `ApprovalsPage.tsx` (prototype),
  `ExecutionLedger.tsx`, `PersonTiers.tsx`, `KnowledgeBasePage.tsx` (apps/web), `routes.tsx` (apps/web).
- `InitiativeDetail.tsx` was located but not deep-read beyond confirming its existence in the prototype's pages
  directory — its content (initiative detail view: stages, notes, related people) is lower-priority than the
  surfaces above per the brief's list and is covered structurally by item 7 (Projects/Initiatives) in this
  audit; a follow-up pass should read it directly if a dedicated Initiative-detail page is scheduled for
  implementation.
- Hosted site `https://bridge-ai-1ay.pages.dev`: reachable, but WebFetch only returns the static
  pre-hydration HTML shell (title only) for this client-rendered SPA — no visual/DOM detail obtainable via
  WebFetch. All visual claims in this audit are sourced from local prototype code, which is complete.
