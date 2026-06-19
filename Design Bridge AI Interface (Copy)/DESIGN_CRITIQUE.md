# Design Critique: Bridge AI Interface

**Date:** April 10, 2026  
**Reviewer:** Claude (via /design-critique)  
**Stage:** Working prototype — code-level analysis  
**Product:** B2B Sales Intelligence Platform with embedded AI Agent

---

## Overall Impression

The interface projects a sophisticated, modern aesthetic with a well-considered three-panel architecture (sidebar + data engine + AI panel). The color system is compelling and the use of animation is generally restrained and purposeful. The biggest opportunity is **information density management** — the three panels compete for the user's attention equally, and there's no clear primary surface. Several navigational bugs and accessibility gaps need to be addressed before this can be considered production-ready.

---

## Usability

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Broken Home route** — Sidebar nav links "Home" to `/home` but no `/home` route is registered in `routes.tsx`. Clicking Home will hit a 404/blank screen. | 🔴 Critical | Change nav item `to: '/home'` to `to: '/'` or add a Home route to the router. |
| **Collapsed sidebar expand affordance is at the bottom** — When the sidebar collapses, the only way to re-expand is a small `ChevronsRight` button at the very bottom of the panel. It's far from the top nav and easy to miss. | 🟡 Moderate | Add a hover-activated expand handle on the right edge of the collapsed sidebar, similar to how Linear or Notion handle it. |
| **Collapsed AgentPanel shows a `ChevronsLeft` icon** — The icon direction implies "collapse further left," but the intent is to *expand* the panel rightward. Directionally confusing. | 🟡 Moderate | Swap to `ChevronsLeft` → `ChevronsRight` for the expand affordance, or use a `MessageSquare` / `Sparkles` icon with an expand tooltip. |
| **Timeline scrubber has no affordance** — The 20-dash vertical scrubber on the right edge of the AgentPanel uses `cursor-ns-resize` and renders as decorative tick marks. Users have no way to understand this is interactive or what it does. | 🟡 Moderate | Add a tooltip ("Scroll conversation history"), a hover label, or a visible track background. Consider whether this pattern adds value vs. a standard scrollbar. |
| **Duplicate navigation concepts** — `DataEngine` has tabs for `People / Sales Deals / Companies`, while the `Header` component (shown above the DataEngine) has segments for `People / Organization / Industry`. These are visually and semantically similar but operate on different data sets — creating confusion about which control does what. | 🟡 Moderate | Merge into a single tab system, or rename and visually distinguish them so it's clear one is a view filter and the other is a data category. |
| **Model selector "Orion-7" is truncated** — In the command bar, the model picker has `max-w-[80px]` and truncates at small widths. The model being used is critical context for power users. | 🟢 Minor | Increase the width or surface the full model name in a tooltip. Consider a popover model picker rather than an inline selector. |
| **The `+` menu in the command bar is inside the input container** — When it opens upward (`bottom-full`), it can clip in tight layouts and its items (Attach files, Mention agents, Workflows, Tools, Skills) lack keyboard navigation. | 🟢 Minor | Implement proper keyboard nav (`aria-menu`, focus trapping) and test at minimum panel width (240px) to ensure the menu doesn't overflow. |

---

## Visual Hierarchy

- **What draws the eye first:** The three panels have nearly equal visual weight. All three use white/near-white backgrounds with gray borders. The AI panel purple gradient on the "B" icon and the send button is the only strong color anchor, pulling the eye to the right — the opposite of where most users will look first (the data).
- **Reading flow:** Left sidebar → center content → right AI panel is the intended flow, but the center content (the data engine) is visually the quietest zone. The sidebar's workspace block and the AI panel's header both have strong dark/colored elements competing across the screen.
- **Emphasis:** Correct elements are highlighted — active nav state uses the brand purple, status badges use semantic colors, and action chips in the AI panel use the right subtle treatment. The problem is *parity* not *absence* of emphasis.

**Recommendations:**
- Give the main content area a slightly cooler or different background than the panels to create depth (e.g., `#f0f0f5` vs. the current `#f8f9fa` for side panels).
- Reduce the visual complexity of the collapsed sidebar state — the nested pinned tool icons under Tools take up significant space in a 64px column and create visual noise.
- The segmented control in the Header could be left-aligned rather than centered, as this is a data pivot and users expect it near the data, not floating in the middle of the viewport.

---

## Consistency

| Element | Issue | Recommendation |
|---------|-------|----------------|
| **Color tokens vs. inline values** | `theme.css` declares `--primary: #030213` (near-black) but the app universally uses hardcoded `#6200EE` (purple) as the primary interactive color. The tokens are never used for primary actions. | Align the CSS variable `--primary` with the actual brand purple, or use the token consistently in Tailwind config. |
| **Sidebar bottom nav `font-medium`** | Bottom nav items explicitly set `font-medium` but top nav items don't — active state styling masks this inconsistency. When inactive, bottom items appear slightly bolder. | Normalize both to the same font-weight class in both active and inactive states. |
| **AgentPanel `h-14` header vs. Sidebar `h-14` header** | These share height but the AgentPanel header has an invisible spacer `<div className="w-9">` to force visual centering. This is a fragile layout hack. | Use CSS `grid` with 3 columns (icon / title / spacer) or `flex` with `justify-between` + a mirrored invisible button element. |
| **Activity message timestamps: `text-[9px]`** | Chat timestamps render at 9px — smaller than any other text in the interface. The standard minimum for readable UI text is 11–12px. | Use `text-[10px]` at minimum; `text-xs` (12px) is preferred and is used elsewhere in the panel. |
| **The `DataEngine` and `PlaybooksEngine` tab bars** | Both use custom inline tab bars built differently. DataEngine uses a `useState`-driven button list; Playbooks uses a similar pattern. Neither uses the shared `tabs.tsx` component from the UI library. | Consolidate on the shared `<Tabs>` component for maintainability and a11y. |

---

## Accessibility

- **Color contrast — `#00E5FF` on white:** The cyan accent color (`#00E5FF`) renders on white in the `animate-pulse` dot in the AgentPanel header and as the underline indicator in the Header segment control. Its contrast ratio against white is approximately **1.3:1** — failing WCAG AA (requires 3:1 for UI components, 4.5:1 for text). This color should only be used as a decorative glow, never as a sole informational indicator.
- **Touch targets:** The `+` button in the command bar is `w-7 h-7` (28×28px). The send button is also `p-1.5` making it ~28px. WCAG 2.1 SC 2.5.5 requires a minimum of 44×44px. Increase to `w-9 h-9` minimum with padding compensation.
- **Title-only labels:** Several interactive elements use `title` attributes as their only accessible label — the collapse/expand buttons, the workspace button (collapsed state), and pinned tool items. `title` is not reliably announced by screen readers. Add `aria-label` attributes in addition.
- **Timeline scrubber — no ARIA:** The 20-dash scrubber uses `cursor-ns-resize` but has no `role`, `aria-label`, `aria-valuenow`, or keyboard event handlers. It's currently a group of decorative `div`s. Either make it fully accessible with `role="slider"` semantics or mark it `aria-hidden="true"` to remove it from the accessibility tree.
- **Textarea `rows={1}` + `min-h-[60px]`:** These two constraints conflict — `rows={1}` implies 24px height; `min-h-[60px]` overrides it. The `resize-none` prevents user adjustment. Consider `field-sizing: content` (CSS) or a JS auto-resize approach for a cleaner grow-on-type experience.
- **Focus management — route changes:** When navigating between routes (e.g., clicking a row to open `ItemDetail`), focus is not programmatically managed. Add a `focus()` call to the page heading or a skip-to-content link on route change.

---

## What Works Well

- **Context-aware AI panel** — The AgentPanel smartly changes its messages and suggested actions based on whether the user is on a detail page or the main data view. This is excellent UX design that makes the AI feel embedded, not bolted on.
- **Pinned tools in the sidebar** — The ability to pin tools from the Tools page and have them appear as a nested list under the "Tools" nav item is a thoughtful power-user feature. The collapsed icon indicators are a nice touch.
- **Resizable AI panel** — Using `re-resizable` for the AgentPanel lets users expand the chat area for longer conversations without hiding their data. Well placed.
- **Workspace switcher** — The dropdown workspace picker (Acme Corp / Wayne Ent.) with smooth AnimatePresence exit animation is polished and appropriately scoped.
- **Active state in sidebar** — The collapsed sidebar correctly uses a left-edge indicator bar (`absolute left-0 w-1 h-5 bg-[#6200EE]`) alongside the colored icon. This is a reliable and accessible active state pattern.
- **Semantic status badges** — The `StatusBadge` component and its color mapping (Active → green, Draft → gray, Paused → yellow, Degraded → amber) is consistent and meaningful throughout the Playbooks and Integrations views.
- **Suggested actions** — The "Suggested" chip area in the AI panel provides clear, contextual next steps without taking over the interface. Good progressive disclosure.
- **Spring animation timing** — The sidebar collapse uses `{ type: 'spring', bounce: 0, duration: 0.3 }` which is snappy without being jarring. The message entry animations use staggered delays (0.1s per item) that feel natural.

---

## Priority Recommendations

### 1. Fix the broken Home route (🔴 Critical — 5 minutes)
In `src/app/components/Sidebar.tsx:30`, change:
```ts
{ icon: Home, label: 'Home', to: '/home' },
```
to:
```ts
{ icon: Home, label: 'Home', to: '/' },
```
Or register a `/home` route in `routes.tsx` that renders an actual Home page component.

---

### 2. Fix the collapsed AgentPanel expand icon direction (🟡 — 5 minutes)
In `AgentPanel.tsx:76`, the collapsed view renders `<ChevronsLeft>` which points the wrong way. Change to `<ChevronsRight>` to indicate the panel will expand to the right.

---

### 3. Align CSS design tokens with actual brand colors (🟡 — 30 minutes)
In `theme.css`, `--primary` is `#030213` but `#6200EE` is the true primary. Either:
- Update `--primary: #6200EE` and use `bg-primary` / `text-primary` in Tailwind instead of hardcoded hex values, or
- Add a `--brand: #6200EE` token and wire Tailwind to it

This prevents future drift and makes theming/dark mode easier.

---

### 4. Replace `#00E5FF` as an informational color (🟡 — 1 hour)
Audit all instances of `#00E5FF` used as more than decoration. The animated dot in the AgentPanel header and the segment indicator underline in `Header.tsx` need either a darker shade (e.g., `#009BB5` achieves 3:1 on white) or pairing with a non-color indicator (icon, border, text).

---

### 5. Increase minimum touch target sizes (🟡 — 1 hour)
The command bar buttons (`+`, mic, send) are 28px. Increase to 36–40px by adding padding: `p-2.5` instead of `p-1.5`. The icon size can stay at 14–16px — only the clickable area needs to grow.

---

### 6. Resolve the duplicate tab/segment navigation (🟡 — design decision first)
The Header segment control (People / Organization / Industry) and DataEngine's own tabs (People / Sales Deals / Companies) need to be reconciled. Schedule a design review to define: is the Header control a global pivot or a DataEngine-specific filter? Once clear, remove one layer.

---

### 7. Add `aria-label` to all icon-only interactive elements (🟢 — 2 hours)
Every `<button>` that contains only an icon (collapse buttons, pin buttons, mic, send, more-menu triggers) needs `aria-label="..."` in addition to `title="..."`. The `title` attribute is insufficient for screen readers and touch devices.

---

*Analysis performed via source code review of the React/TypeScript/Tailwind implementation. Visual rendering assumptions are based on code — a live screenshot pass is recommended to verify layout at 1280px, 1440px, and 1920px widths, and at 100%, 125%, and 150% zoom levels.*
