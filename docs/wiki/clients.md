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
