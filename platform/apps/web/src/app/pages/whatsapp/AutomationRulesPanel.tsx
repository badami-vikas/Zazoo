/**
 * Automation Rules — author, list, enable/disable, delete.
 *
 * The copy here does real work and is not decoration. A rules editor is where
 * someone forms their mental model of what automation is allowed to do, so the
 * panel states the two limits plainly and in the places they bind:
 *
 *  - a rule reacts inside a conversation that already exists; it never opens one;
 *  - a rule may make the send discipline stricter, never looser.
 *
 * Both are enforced in `@bridge/whatsapp` (`planAutomationRun`, `tightenLimits`)
 * and re-enforced at send time. The text is here so the owner is not surprised
 * by a refusal they had no way to predict.
 *
 * "Check rules now" is the one button that does something: it evaluates every
 * rule against what the message store actually holds and queues what is due. It
 * touches the WhatsApp session not at all, and it sends nothing.
 */
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { trpc } from "../../lib/trpc";
import {
  agentLabel,
  chatLabel,
  useAutomationState,
  whenLabel,
  type AutomationRuleRow,
} from "./automation-store";

type CheckOutcome = Awaited<
  ReturnType<typeof trpc.whatsapp.automation.check.mutate>
>["outcomes"][number];

export function AutomationRulesPanel() {
  const { state, loading, error, run, busy, refresh } = useAutomationState();
  const [authoring, setAuthoring] = useState(false);
  const [outcomes, setOutcomes] = useState<CheckOutcome[] | null>(null);

  // Draft fields.
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [triggerKind, setTriggerKind] = useState<"inbound_message" | "thread_quiet">(
    "inbound_message",
  );
  const [bodyContains, setBodyContains] = useState("");
  const [quietDays, setQuietDays] = useState(14);
  const [goal, setGoal] = useState("");

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>Reading rules…</p>;
  }
  if (!state) {
    return (
      <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>
        {error ?? "Rules could not be read."}
      </p>
    );
  }

  const assignedChats = new Set(
    state.assignments.filter((row) => !row.unassignedAt).map((row) => row.subject.key),
  );

  async function create() {
    const ok = await run(() =>
      trpc.whatsapp.automation.createRule.mutate({
        name,
        subject: { kind: "chat", key: chatId },
        trigger:
          triggerKind === "inbound_message"
            ? {
                kind: "inbound_message",
                ...(bodyContains.trim() ? { bodyContains: bodyContains.trim() } : {}),
              }
            : { kind: "thread_quiet", quietDays },
        goal,
        enabled: true,
      }),
    );
    if (ok) {
      setAuthoring(false);
      setName("");
      setGoal("");
      setBodyContains("");
      setChatId("");
    }
  }

  async function check() {
    try {
      const result = await trpc.whatsapp.automation.check.mutate();
      setOutcomes(result.outcomes);
      await refresh();
    } catch (failure) {
      setOutcomes([
        {
          ruleId: "",
          ruleName: "",
          status: "failed",
          explanation: failure instanceof Error ? failure.message : String(failure),
        },
      ]);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
        A rule starts an Agent Run in a conversation you already have — it never opens one. It can
        make the sending limits stricter, never looser, and everything it produces still passes the
        send gate.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setAuthoring((open) => !open)} disabled={busy}>
          {authoring ? "Cancel" : "New rule"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void check()}
          disabled={busy || state.rules.length === 0}
        >
          Check rules now
        </Button>
        {state.rules.length === 0 ? (
          <span className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
            Nothing to check yet.
          </span>
        ) : null}
      </div>

      {authoring ? (
        <div
          className="space-y-3 rounded-md border p-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {state.chats.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              No chats have been synced, so there is no conversation to write a rule about. Sync
              your messages on the Chats Page first.
            </p>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span style={{ color: "var(--color-navy-mid)" }}>Name</span>
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span style={{ color: "var(--color-navy-mid)" }}>Chat</span>
                <select
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  value={chatId}
                  onChange={(event) => setChatId(event.target.value)}
                >
                  <option value="">Choose a synced chat…</option>
                  {state.chats.map((chat) => (
                    <option key={chat.chatId} value={chat.chatId}>
                      {chatLabel(state.chats, chat.chatId)}
                      {assignedChats.has(chat.chatId) ? "" : " (no Agent assigned)"}
                    </option>
                  ))}
                </select>
                {chatId && !assignedChats.has(chatId) ? (
                  <span className="block text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    This chat has no assigned Agent, so the rule will save but stay blocked until
                    you assign one — an Automation starts an Agent Run.
                  </span>
                ) : null}
              </label>

              <label className="block space-y-1 text-sm">
                <span style={{ color: "var(--color-navy-mid)" }}>When</span>
                <select
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  value={triggerKind}
                  onChange={(event) =>
                    setTriggerKind(event.target.value as "inbound_message" | "thread_quiet")
                  }
                >
                  <option value="inbound_message">They write to me</option>
                  <option value="thread_quiet">The chat goes quiet</option>
                </select>
              </label>

              {triggerKind === "inbound_message" ? (
                <label className="block space-y-1 text-sm">
                  <span style={{ color: "var(--color-navy-mid)" }}>
                    …and their message mentions (optional)
                  </span>
                  <input
                    className="w-full rounded-md border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--color-border)" }}
                    value={bodyContains}
                    onChange={(event) => setBodyContains(event.target.value)}
                  />
                </label>
              ) : (
                <label className="block space-y-1 text-sm">
                  <span style={{ color: "var(--color-navy-mid)" }}>…for this many days</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="w-full rounded-md border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--color-border)" }}
                    value={quietDays}
                    onChange={(event) => setQuietDays(Number(event.target.value))}
                  />
                </label>
              )}

              <label className="block space-y-1 text-sm">
                <span style={{ color: "var(--color-navy-mid)" }}>
                  What should the Agent Run achieve
                </span>
                <textarea
                  rows={3}
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                />
                <span className="block text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  A goal, not a message. The rule never writes the text — the Agent does, and
                  anything it sends still needs the recipient to have written first.
                </span>
              </label>

              <Button
                size="sm"
                onClick={() => void create()}
                disabled={busy || !name.trim() || !goal.trim() || !chatId}
              >
                Save rule
              </Button>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}

      {state.rules.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
          No automation rules yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {state.rules.map((rule) => (
            <li
              key={rule.id}
              className="space-y-2 rounded-md border p-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                    {rule.name}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    {describeRuleRow(rule, chatLabel(state.chats, rule.subject.key))}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    {ruleStatusLine(rule, assignedChats.has(rule.subject.key), state.agents, state.assignments)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        trpc.whatsapp.automation.setRuleEnabled.mutate({
                          ruleId: rule.id,
                          enabled: !rule.enabled,
                        }),
                      )
                    }
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        trpc.whatsapp.automation.deleteRule.mutate({ ruleId: rule.id }),
                      )
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {outcomes ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
            Last check
          </h3>
          {outcomes.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              No rules were evaluated.
            </p>
          ) : (
            <ul className="space-y-1">
              {outcomes.map((outcome, index) => (
                <li
                  key={`${outcome.ruleId}-${index}`}
                  className="text-xs"
                  style={{ color: "var(--color-navy-mid)" }}
                >
                  <span style={{ color: "var(--color-navy)" }}>
                    {outcome.ruleName || "This check"}
                  </span>{" "}
                  — {outcome.status}: {outcome.explanation}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function describeRuleRow(rule: AutomationRuleRow, chat: string): string {
  const when =
    rule.trigger.kind === "inbound_message"
      ? rule.trigger.bodyContains
        ? `When they write in “${chat}” mentioning “${rule.trigger.bodyContains}”`
        : `When they write in “${chat}”`
      : `When “${chat}” has been quiet for ${rule.trigger.quietDays} days`;
  return `${when}, start an Agent Run to: ${rule.goal}`;
}

/**
 * The state line. It says the thing that is actually true, including the case
 * where a rule is switched on but cannot fire — a rule showing "on" while
 * silently never running is the worst of the available lies.
 */
function ruleStatusLine(
  rule: AutomationRuleRow,
  hasAgent: boolean,
  agents: readonly { id: string; name: string }[],
  assignments: readonly { subject: { key: string }; agentId: string; unassignedAt?: string }[],
): string {
  if (!rule.enabled) {
    const why = rule.disabledReason ? ` — ${rule.disabledReason}` : "";
    return `Off since ${whenLabel(rule.disabledAt)}${why}`;
  }
  if (!hasAgent) {
    return "On, but blocked: no Agent is assigned to this chat.";
  }
  const assigned = assignments.find(
    (row) => !row.unassignedAt && row.subject.key === rule.subject.key,
  );
  return `On — runs as ${agentLabel(agents, assigned?.agentId ?? "")}.`;
}
