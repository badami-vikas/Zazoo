/**
 * AI chat — persistent right panel, mounted once in <Layout> alongside the
 * main content Outlet (nav | content | AI chat, matching the reference UI at
 * bridge-ai-1ay.pages.dev). Ported from the prototype's AgentPanel.tsx, with
 * two deliberate changes (user spec 2026-07-07):
 *
 *  1. Header icon: the prototype used a generic "B" monogram badge for
 *     "Bridge AI". Replaced with the real avatar (AvatarIcon — the same
 *     spirit-animal/status system AvatarOverlay renders), so the chat
 *     panel's identity IS the user's actual avatar, not a placeholder logo.
 *  2. Chat logic: the prototype's "Intelligence Layer Feed" and timeline
 *     scrubber were decorative fixture content with no backing data. Dropped
 *     in favor of the real, already-built `chiefOfStaff.converse` governed
 *     routing chat (same logic ChiefOfStaffPage.tsx used) — every reply is a
 *     real classification, and a routed action is a real proposal visible in
 *     Approvals, never fabricated feed content.
 *
 * No `re-resizable`/`motion` dependency: apps/web doesn't have either, so
 * this is collapse/expand only (fixed width), not drag-resizable, using
 * plain CSS transitions.
 */
import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { AvatarIcon } from "../../avatar/AvatarOverlay";
import { loadAvatarPrefs } from "../../avatar/avatar-store";

type ConverseResult = Awaited<ReturnType<typeof trpc.chiefOfStaff.converse.mutate>>;

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  decision?: ConverseResult["decision"];
  proposalId?: string;
  agent?: ConverseResult["agent"];
}

/** Display names for the "agent" field ADR-033/046 added to converse's reply
 * — `@mention` any of these in the chat box to address them directly,
 * bypassing Chief of Staff's routing for that one turn. "communications" is
 * a display-only label (ADR-046: Communications is a skill, not an agent —
 * no identity/capability-scope row), kept here purely for badge continuity. */
const AGENT_LABELS: Record<string, string> = {
  chief_of_staff: "Chief of Staff",
  learning: "Learning Agent",
  communications: "Communications",
  governance: "Governance Agent",
  capability_builder: "Capability Builder",
};

// Default width = 1.3× the rail's default EXPANDED width (Layout.tsx's
// RAIL_EXPANDED=220) — user ask 2026-07-10, matching the reference
// deployment's proportions. Kept as a literal (220*1.3=286) rather than an
// import to avoid coupling this component to Layout.tsx's internals for one
// derived number; both are commented so they don't drift silently.
const PANEL_DEFAULT_WIDTH = 286;
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 520;
const WIDTH_KEY = "bridge.agentPanel.width.v1";
const COLLAPSE_KEY = "bridge.agentPanel.collapsed.v1";

export function AgentPanel() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  });
  // Resizable, same drag pattern as Layout.tsx's rail (user ask: "the right
  // chatbot section also behaves the same way") — but this one persists the
  // actual dragged width (continuous, clamped) rather than snapping to two
  // fixed states, since a chat panel's useful width is a range, not a binary.
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return PANEL_DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return stored >= PANEL_MIN_WIDTH && stored <= PANEL_MAX_WIDTH ? stored : PANEL_DEFAULT_WIDTH;
  });
  const [panelDragWidth, setPanelDragWidth] = useState<number | null>(null);

  function startPanelDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    function onMove(ev: MouseEvent) {
      // Panel is docked right — dragging LEFT (negative dx) grows it.
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth - (ev.clientX - startX)));
      setPanelDragWidth(next);
    }
    function onUp(ev: MouseEvent) {
      const finalWidth = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth - (ev.clientX - startX)));
      setPanelDragWidth(null);
      setPanelWidth(finalWidth);
      try {
        window.localStorage.setItem(WIDTH_KEY, String(finalWidth));
      } catch {
        // Cosmetic preference only — safe no-op if storage is unavailable.
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      role: "assistant",
      text: "Hi — I'm Chief of Staff. I can route requests to JobPilot, DealPilot, Calendar, Helpdesk, or Resources. Anything else, I'll say so honestly rather than guess.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [chainDepth, setChainDepth] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarPrefs = loadAvatarPrefs(true);
  const animal = avatarPrefs.animal;
  // The panel's header shows the Chief of Staff's actual given name (same
  // fallback pattern OverlayApp.tsx uses: the name chosen at onboarding, or
  // the capitalized animal if none was set) — user correction 2026-07-10:
  // this was a static "Bridge AI" brand lockup, not the agent's identity.
  const agentName = avatarPrefs.avatarName || animal.charAt(0).toUpperCase() + animal.slice(1);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Cosmetic preference only — safe no-op if storage is unavailable.
    }
  }

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setSending(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text: message }]);
    try {
      const result = await trpc.chiefOfStaff.converse.mutate({ workspaceId: PILOT_WORKSPACE, message, chainDepth, animal });
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: result.reply, decision: result.decision, proposalId: result.proposal?.id, agent: result.agent },
      ]);
      setChainDepth(result.decision.kind === "route" ? chainDepth + 1 : 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsedPersisted(false)}
        title="Open AI chat"
        className="w-12 shrink-0 border-l flex flex-col items-center gap-1.5 pt-3"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        {/* Collapsed rail leads with the avatar, not a chevron/logo (requests.md R-014). */}
        <AvatarIcon animal={animal} size={28} />
        <ChevronsLeft className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
      </button>
    );
  }

  return (
    <aside
      style={{ width: panelDragWidth ?? panelWidth, borderColor: "var(--color-border)" }}
      className={`shrink-0 border-l flex flex-col h-full overflow-hidden bg-white relative ${panelDragWidth === null ? "transition-[width] duration-75" : ""}`}
    >
      {/* Resize handle — left edge (panel is docked right), same
          hover-cursor + drag pattern as Layout.tsx's rail handle. */}
      <div
        onMouseDown={startPanelDrag}
        className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize z-10 group -ml-0.5"
        title="Drag to resize"
      >
        <div className="w-px h-full mx-auto bg-transparent group-hover:bg-[var(--color-steel-light)] transition-colors" />
      </div>
      <div className="h-14 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: "var(--color-border)" }}>
        <button
          onClick={() => setCollapsedPersisted(true)}
          className="p-2 rounded-lg mr-2"
          style={{ color: "var(--color-warm-gray)" }}
          title="Collapse panel"
        >
          <ChevronsRight className="w-5 h-5" />
        </button>
        <div className="font-bold text-lg tracking-tight flex items-center gap-2">
          <AvatarIcon animal={animal} size={24} />
          <span style={{ color: "var(--color-navy)" }}>{agentName}</span>
        </div>
        <div className="w-9" />
      </div>

      <div className="flex-1 overflow-auto space-y-3 p-4">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
            {t.role === "assistant" && t.agent && t.agent !== "chief_of_staff" && (
              <div className="text-xs font-medium mb-0.5" style={{ color: "var(--color-steel)" }}>
                {AGENT_LABELS[t.agent] ?? t.agent}
              </div>
            )}
            <div
              className="inline-block max-w-[85%] rounded-md px-3 py-2 text-sm"
              style={{
                backgroundColor: t.role === "user" ? "var(--color-steel)" : "var(--color-surface)",
                color: t.role === "user" ? "white" : "var(--color-navy)",
              }}
            >
              {t.text}
            </div>
            {t.decision && (
              <div className="mt-1 flex flex-wrap gap-1 justify-start">
                <Badge variant="outline">{t.decision.kind}</Badge>
                {t.decision.route && <Badge variant="secondary">{t.decision.route}</Badge>}
                {t.proposalId && <Badge variant="outline">proposal pending in Approvals</Badge>}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="px-4 pb-2 text-xs text-red-600 break-words">{error}</div>}

      <div className="px-4 pb-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
        @learning · @communications · @governance · @builder — address one directly
      </div>
      <div className="p-3 pt-1 border-t flex gap-2 shrink-0" style={{ borderColor: "var(--color-border)" }}>
        <Input
          placeholder="Ask Chief of Staff…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) send();
          }}
          disabled={sending}
        />
        <Button onClick={send} disabled={sending || !draft.trim()}>
          {sending ? "…" : "Send"}
        </Button>
      </div>
    </aside>
  );
}
