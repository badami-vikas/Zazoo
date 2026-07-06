import { useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";

type ConverseResult = Awaited<ReturnType<typeof trpc.chiefOfStaff.converse.mutate>>;

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  decision?: ConverseResult["decision"];
  proposalId?: string;
}

/**
 * Chief of Staff v1 — the default interlocutor's chat panel (docs/wiki/
 * roadmap.md P1). Honest about current capability: it classifies intent and,
 * when confident, proposes a routed action through the SAME governed pipeline
 * every other mutation uses (visible below each reply as "Proposed for
 * review — see Approvals"), never executes anything directly. Star topology:
 * at most one route per turn; `chainDepth` increments only when the PREVIOUS
 * turn actually routed (a clarify/direct_reply turn does not deepen the
 * chain), matching the server's per-conversation depth tracking contract.
 */
export function ChiefOfStaffPage() {
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

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setSending(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text: message }]);
    try {
      const result = await trpc.chiefOfStaff.converse.mutate({ workspaceId: PILOT_WORKSPACE, message, chainDepth });
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: result.reply, decision: result.decision, proposalId: result.proposal?.id },
      ]);
      // Chain depth only advances on an actual route (a further hop) — a
      // clarify/direct_reply turn resets the conversation's routing chain.
      setChainDepth(result.decision.kind === "route" ? chainDepth + 1 : 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4 h-full max-w-2xl">
      <div>
        <h1 className="text-lg font-medium">Chief of Staff</h1>
        <p className="text-sm text-muted-foreground">
          Routes your message to at most one capability per turn — never executes anything without a governed approval.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-3 border rounded-md p-4 min-h-[280px]">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[85%] rounded-md px-3 py-2 text-sm ${
                t.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {t.text}
            </div>
            {t.decision && (
              <div className="mt-1 flex flex-wrap gap-1 justify-start">
                <Badge variant="outline">{t.decision.kind}</Badge>
                {t.decision.route && <Badge variant="secondary">{t.decision.route}</Badge>}
                <Badge variant="outline">{t.decision.source}</Badge>
                {t.proposalId && <Badge variant="outline">proposal pending in Approvals</Badge>}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex gap-2">
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
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
