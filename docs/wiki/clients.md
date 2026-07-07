# Clients + Context Providers (wiki)

full (verbatim requirement): [../raw/client-architecture-context-providers.md](../raw/client-architecture-context-providers.md) · adopted 2026-07-06 · extends Notion-model amendment in [vision](vision.md).

## One platform, three clients
Platform exists ONCE (graph · memory · governance · capability engine · runtime · workflows/skills/agents/tools/integrations). Desktop + Browser + Mobile = interaction surfaces only. User never think "Bridge Desktop" — only "Bridge". Learning in one client benefit all clients instantly (shared graph/memory/governance).

- **Desktop = depth.** Complete experience + reference implementation + LOCAL execution runtime (local connectors, scripts, native tools, screen understanding, local AI models). Owns native OS capabilities.
- **Browser = reach.** Same platform inside browser constraints. NOT lightweight product. Browser-native context (current tab, selected text, extension). **Delegation**: browser needs privileged native capability → delegates execution to Desktop if available (screen context, filesystem, native apps). Delegated exec still goes through pipeline + governance (fits existing `delegations` table pattern).
- **Mobile = accessibility.** Capture (voice/photos/notes/docs/contacts) · awareness (notifications/signals/briefing) · decisions (approvals!) · communication. Workflows = review+run only; skills/agents = view; governance = approvals.

Goal ≠ feature parity. Goal = consistent platform experience. Full capability matrix in raw doc.

## Context providers (supersede "3 sensor kinds")
Sensing layer = CONTEXT PROVIDER registry, providers = peers, swappable:
**apps · accessibility · screen · voice · clipboard · filesystem · browser · documents · emails**

- **Learning Agent consumes CONTEXT, not screenshots.** Consumers only see normalized derived ContextEntry/Memory observations. Raw payloads (frames, AX dumps, audio) = local-plane ONLY, structurally never on consumer API.
- Each provider = optional capability w/ own manifest → computed risk (emails/browser score higher than clipboard). Kernel runs with ZERO providers.
- Per-surface subsets: desktop = all · browser = browser/documents · mobile = voice/photos.
- Capture contract unchanged: every capture → inspectable Memory entry, blink = tell.

## Voice Command Center
Cross-platform, global shortcut (e.g. hold Fn). Understands: current workspace/page/selected object/active app/current doc/intent. Examples: "summarize this meeting", "build workflow from this", "turn this into agent". Consistent across all 3 clients; only available capabilities differ per platform permissions. NOTE: pulls part of P4 (Command Center) cross-surface — roadmap touch.

## Onboarding
= pop-up screen (user call 2026-07-06). Not separate page/app.

## Shell IA (ADR-023, 2026-07-06)
6 permanent chrome containers. Chrome fixed, contents generated/installed on demand — minimal-egg pattern.

**Bottom bar** (sidebar footer desktop/tablet, fixed bottom tab bar < sm): **Intelligence · KnowledgeBase · Settings**.
**Main nav area**: pinned Projects + pinned Tools (user's regulars). Full indexes reachable via KnowledgeBase/Tools pages, not the pin list.

**KnowledgeBase** (was: no standalone "Network" page existed — this IS the concept target) = toggle tabs **People / Communities / Resources / Projects**.
- Projects = display label for `initiative` node type (kernel id unchanged). Cross-disciplinary container (people+orgs+resources+chat) — today wired to `graph.listInitiatives` only, cross-linking is a real gap.
- Resources = websites/media/platforms, reuses existing ResourcesPage (`resources.list`).
- People/Communities = `graph.listPeople`/`graph.listCommunities` procedures now exist (2026-07-07, same paginated/workspace-scoped pattern as `listInitiatives`); apps/web wiring to KnowledgeBasePage is a separate follow-up track (still honest `NotWiredYet` in the UI as of this note).
- New toggle section = governed proposal (minor, Governance Agent may auto-approve), never silent restructure.

**Tools** = section tabs **Skills / Agents / Apps / Workflows** (Workflow = display label for `ritual`, kernel id unchanged).
- Apps = installed capability packages (DealPilot/JobPilot/Helpdesk) — real, wired.
- Skills/Agents/Workflows = honest empty, no list/get read procedure on backend yet (BUGS.md, pre-existing gap).

**Approvals** = pinned governance tool, now tabbed: **Approvals** (default) + **Signals** (2nd tab). Separate unread counts per tab — consent decisions never drown in signal noise. No standalone Signals page ever existed to remove.

**Capability landing rule**: Capability Builder output worth keeping → Tool. Q&A/chat output not worth a tool → saved under a Project.

**View convertibility**: every table-backed view gets switcher. table/kanban/card (gallery) ALWAYS eligible. calendar ⇐ date-kind column exists. map ⇐ location-kind column exists (heuristic today — `ColumnKind` has no dedicated location kind yet, BUGS.md). graph/network ⇐ relation-kind column exists. Eligibility computed client-side from spec columns (`apps/web/src/app/dataviews/eligibility.ts`), DataViews.tsx switcher uses it as default when no explicit override. Map has no rendering lib in repo → honest "map view (list fallback)" grouped-by-location list (MapView.tsx), not a fake map.

**Display-vocab renames** (workspace-scope only, kernel ids untouched): Initiative→Project, Ritual→Workflow, Network→KnowledgeBase. User's own naming always wins. Ontological primitives behind the labels ([ontology](ontology.md)): "Workflow"/`ritual` = **Automation** · "Project"/`initiative` = **ElementType** · Apps/connections = **Integration** · user-facing tool surfaces = **Workspace**.

**Peer-grouping heuristics** (blueprint-level, compiler-encoded): similar task → toggle sub-pages. different tasks → separate tools. same process+task, separate data → separate lists. Proposes structure, never silently imposes.

**Pins** = client-side localStorage today (`lib/pins.ts`). Server-side persistence = tracked gap (BUGS.md) — breaks the "learning in one client benefits all clients" promise above until fixed.
