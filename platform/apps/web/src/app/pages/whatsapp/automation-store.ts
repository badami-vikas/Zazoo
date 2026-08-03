/**
 * The three automation panels share one read.
 *
 * Rules, the schedule and assignments are stored together and are genuinely
 * coupled — a rule is unfireable without an assignment, and deleting a rule
 * cancels its queued actions — so the panels read them together too. Three
 * independent fetches would let the Rules panel show a rule as live while the
 * Assignment panel next to it showed the assignment already removed.
 *
 * Every mutation re-reads rather than patching local state. The server ledger
 * is the authority, and a locally-patched copy is how a surface ends up
 * claiming a rule is off when the write actually failed.
 */
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";

type AutomationState = Awaited<ReturnType<typeof trpc.whatsapp.automation.state.query>>;

export type AutomationRuleRow = AutomationState["rules"][number];
export type AgentAssignmentRow = AutomationState["assignments"][number];
export type ScheduledActionRow = AutomationState["scheduled"][number];
export type ModuleAgent = AutomationState["agents"][number];
export type SyncedChat = AutomationState["chats"][number];

export interface AutomationView {
  state: AutomationState | null;
  /** True only before the first successful read. Not on every refresh. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Run a mutation, surface its error, and re-read on success. */
  run: (work: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}

export function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useAutomationState(): AutomationView {
  const [state, setState] = useState<AutomationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await trpc.whatsapp.automation.state.query());
      setError(null);
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        await refresh();
        return true;
      } catch (failure) {
        // Surfaced, never swallowed: a refused write that looks like a success
        // is the failure mode that makes a governance surface untrustworthy.
        setError(describeFailure(failure));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { state, loading, error, refresh, run, busy };
}

/** A chat's label, or its id. A WhatsApp name is a label, never an identifier. */
export function chatLabel(chats: readonly SyncedChat[], chatId: string): string {
  const chat = chats.find((candidate) => candidate.chatId === chatId);
  const name = chat?.name?.trim();
  return name && name.length > 0 ? name : chatId;
}

/** An Agent's display name, or its id when the manifest no longer lists it. */
export function agentLabel(agents: readonly ModuleAgent[], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

export function subjectLabel(
  chats: readonly SyncedChat[],
  subject: { kind: string; key: string },
): string {
  return subject.kind === "chat" ? chatLabel(chats, subject.key) : subject.key;
}

/** Shared date rendering. Absent stays absent — never "just now" as a guess. */
export function whenLabel(iso: string | undefined): string {
  if (!iso) return "an unrecorded time";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
