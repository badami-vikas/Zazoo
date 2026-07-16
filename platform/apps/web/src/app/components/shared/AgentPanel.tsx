/**
 * AI chat — persistent right panel, mounted once in <Layout> alongside the
 * main content Outlet (nav | content | AI chat, matching the reference UI at
 * bridge-ai-1ay.pages.dev). Ported from the prototype's AgentPanel.tsx.
 *
 * TASK-001 §5b: refactored to use shared PanelControl hooks/components so the
 * right panel and left sidebar share identical collapse/expand/resize/ARIA
 * behaviour. The chat state (turns, draft) is unaffected — it survives
 * collapse/expand cycles.
 */
import { useState } from "react";
import { ChevronsLeft } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { AvatarIcon } from "../../avatar/AvatarOverlay";
import { loadAvatarPrefs } from "../../avatar/avatar-store";
import { getRoutingDecisionDisplay } from "../../lib/routing-decision-display";
import { usePanelControl, ResizeHandle, CollapseToggleButton } from "./PanelControl";

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

// PANEL_DEFAULT_WIDTH = 1.3× the rail's default EXPANDED width (220*1.3≈286).
const PANEL_DEFAULT_WIDTH = 286;
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 520;
const WIDTH_KEY = "bridge.agentPanel.width.v2";
const COLLAPSE_KEY = "bridge.agentPanel.collapsed.v2";

export function AgentPanel() {
  // §5b: shared usePanelControl — same semantics as the left sidebar but
  // continuous width (no snap), right-side drag direction.
  const panel = usePanelControl({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
    storageKeyWidth: WIDTH_KEY,
    storageKeyCollapsed: COLLAPSE_KEY,
    snap: false,
  });
  const { collapsed, setCollapsedPersisted, panelWidth, dragWidth } = panel;

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
  const agentName = avatarPrefs.avatarName || animal.charAt(0).toUpperCase() + animal.slice(1);

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
        id="panel-right"
        aria-label="Expand chat panel"
        aria-expanded="false"
        aria-controls="panel-right"
        onClick={() => setCollapsedPersisted(false)}
        title="Open AI chat"
        className="w-12 shrink-0 border-l flex flex-col items-center gap-1.5 pt-3"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        {/* Collapsed strip: avatar + expand-chevron (§5b — same as left rail). */}
        <AvatarIcon animal={animal} size={28} />
        <ChevronsLeft className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
      </button>
    );
  }

  return (
    <aside
      id="panel-right"
      aria-label="Chat panel"
      style={{ width: dragWidth ?? panelWidth, borderColor: "var(--color-border)" }}
      className={`shrink-0 border-l flex flex-col h-full overflow-hidden bg-white relative ${dragWidth === null ? "transition-[width] duration-75" : ""}`}
      onKeyDown={(e) => {
        // §5b: Escape key returns expanded → collapsed (does not discard chat).
        if (e.key === "Escape") setCollapsedPersisted(true);
      }}
    >
      {/* Resize handle — shared ResizeHandle component (§5b), left edge. */}
      <ResizeHandle
        side="right"
        onMouseDown={(e) => panel.startDrag(e, "right")}
        label="Drag to resize chat panel"
      />
      <div className="h-14 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: "var(--color-border)" }}>
        {/* Shared CollapseToggleButton (§5b). */}
        <CollapseToggleButton
          side="right"
          collapsed={false}
          onClick={() => setCollapsedPersisted(true)}
        />
        <div className="font-bold text-lg tracking-tight flex items-center gap-2">
          <AvatarIcon animal={animal} size={24} />
          <span style={{ color: "var(--color-navy)" }}>{agentName}</span>
        </div>
        <div className="w-9" />
      </div>

      <div className="flex-1 overflow-auto space-y-3 p-4">
        {turns.map((t, i) => {
          const decisionDisplay = t.decision ? getRoutingDecisionDisplay(t.decision) : null;
          return <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
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
            {decisionDisplay && (
              <div className="mt-1 flex flex-wrap gap-1 justify-start">
                <Badge variant="outline">{decisionDisplay.kindLabel}</Badge>
                {decisionDisplay.routeLabel && <Badge variant="secondary">{decisionDisplay.routeLabel}</Badge>}
                {t.proposalId && <Badge variant="outline">proposal pending in Approvals</Badge>}
              </div>
            )}
          </div>
        })}
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
