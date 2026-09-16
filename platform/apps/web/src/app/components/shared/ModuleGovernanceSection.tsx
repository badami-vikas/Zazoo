/**
 * ModuleGovernanceSection — the standard per-Module "Governance" section
 * (ADR-248, AP-159). Sits directly BELOW the Intelligence Section on every
 * Module surface and shows the `allow`/`deny` policy the engine enforces for
 * that Module.
 *
 * WHY IT SITS HERE AND NOT IN SETTINGS. Intelligence answers *what this Module
 * can do*; Governance answers *what it is allowed to do*. A capability list
 * whose limits live on another screen is half an answer, and it makes the
 * limits something the user has to go looking for rather than something they
 * see next to the capability.
 *
 * WHY THE POLICY IS DATA. The rule this Section was built to carry — Avilo's
 * "no model call without an explicit user action" — was correct for a year and
 * enforced by nothing, because it lived in prose. BUG-029…BUG-045 are all the
 * assistant claiming work it had not done under that rule. So the policy is
 * declared in the manifest and read by `governanceVerdict` in @bridge/core; this
 * component renders that same declaration.
 *
 * IT IS ALWAYS EDITABLE (user directive 2026-09-06: the policy is edited
 * inline). There is no edit mode: a rule is a pair of fields, adding one appends
 * a row, the bin removes it. Leaving a field saves the WHOLE policy through
 * `moduleGovernance.set` — the overlay REPLACES the manifest's declaration
 * (ADR-263) — and the Section re-renders whatever the server returns, never the
 * input it was given (ADR-247). A rule missing an action or a reason is not
 * sent: the row stays put and says it is not saved yet, so nothing on screen
 * claims a policy the engine does not hold.
 *
 * Honest empty states throughout (present-not-absent): a Module with no policy
 * still renders the Section. "Nothing denied" is a fact, not a boundary — the
 * tooltip carries the distinction so a reader of "Denied 0" cannot conclude
 * everything is blocked.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Check, Ban, Plus, Trash2, RotateCcw } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

type GovernanceView = Awaited<ReturnType<typeof trpc.moduleGovernance.get.query>>;
type GovernanceRule = { action: string; reason: string };
type GovernanceTab = "allow" | "deny";
type Draft = { allow: GovernanceRule[]; deny: GovernanceRule[] };

const TABS: { id: GovernanceTab; label: string; icon: typeof Check; hint: string }[] = [
  { id: "allow", label: "Allowed", icon: Check, hint: "Actions this Module may take" },
  { id: "deny", label: "Denied", icon: Ban, hint: "A denial wins over an allow" },
];

const inputStyle = {
  borderColor: "var(--color-border)",
  color: "var(--color-navy)",
  backgroundColor: "var(--color-background)",
} as const;

const complete = (rule: GovernanceRule) =>
  rule.action.trim().length > 0 && rule.reason.trim().length > 0;

/** The two halves a rule is made of, trimmed — what the mutation would send. */
const serialize = (body: { allow: GovernanceRule[]; deny: GovernanceRule[] }) =>
  JSON.stringify(
    (["allow", "deny"] as const).map((key) =>
      body[key].map((rule) => [rule.action.trim(), rule.reason.trim()]),
    ),
  );

export function ModuleGovernanceSection({
  moduleName,
  title = "Governance",
}: {
  moduleName: string;
  title?: string;
}) {
  const [view, setView] = useState<GovernanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GovernanceTab>("deny");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return trpc.moduleGovernance.get
      .query({ organizationId: PILOT_ORGANIZATION, moduleName })
      .then((next) => setView(next))
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [moduleName]);

  useEffect(() => {
    setView(null);
    setDraft(null);
    void load();
  }, [load]);

  const allow = useMemo(() => draft?.allow ?? view?.resolved?.allow ?? [], [draft, view]);
  const deny = useMemo(() => draft?.deny ?? view?.resolved?.deny ?? [], [draft, view]);
  const rules = tab === "allow" ? allow : deny;
  const declared = allow.length + deny.length > 0;
  const unsaved = draft !== null && [...allow, ...deny].some((rule) => !complete(rule));

  /** The server has the last word on what changed (ADR-247): every mutation
   * re-reads the resolved policy from the response rather than echoing input. */
  const apply = async (operation: Promise<GovernanceView>) => {
    setSaving(true);
    setError(null);
    try {
      setView(await operation);
      setDraft(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** Send the whole policy: the overlay replaces the declaration (ADR-263). A
   * rule that cannot explain itself is one the user cannot audit later, so an
   * incomplete row is kept locally and never sent. Nor is an unchanged one:
   * leaving a field fires blur even when the click was the row's bin, and two
   * overlapping saves can land out of order and show the deleted rule back. */
  const persist = (body: Draft) => {
    if ([...body.allow, ...body.deny].some((rule) => !complete(rule))) return;
    if (serialize(body) === serialize(view?.resolved ?? { allow: [], deny: [] })) return;
    return apply(
      trpc.moduleGovernance.set.mutate({
        organizationId: PILOT_ORGANIZATION,
        moduleName,
        allow: body.allow.map((rule) => ({ action: rule.action.trim(), reason: rule.reason.trim() })),
        deny: body.deny.map((rule) => ({ action: rule.action.trim(), reason: rule.reason.trim() })),
      }),
    );
  };

  /** Edit the tab's rules in place; returns the whole policy so a caller that
   * finished an edit (removing a row) can save it immediately. */
  const edit = (next: GovernanceRule[]): Draft => {
    const body = { allow, deny, [tab]: next } as Draft;
    setDraft(body);
    return body;
  };

  return (
    <section className="space-y-3" aria-labelledby={`${moduleName}-governance-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" style={{ color: "var(--color-steel)" }} />
          <h2
            id={`${moduleName}-governance-title`}
            className="text-sm font-semibold"
            style={{ color: "var(--color-navy)" }}
          >
            {title}
          </h2>
          <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
            {saving ? "Saving…" : unsaved ? "Not saved yet" : view?.userEdited ? "edited by you" : declared ? "seeded" : ""}
          </span>
        </div>
        {view?.userEdited ? (
          <button
            type="button"
            onClick={() =>
              void apply(
                trpc.moduleGovernance.reset.mutate({
                  organizationId: PILOT_ORGANIZATION,
                  moduleName,
                }),
              )
            }
            disabled={saving || loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:opacity-50 hover:bg-[var(--color-surface)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
            title="Drop your changes and go back to the policy this Module declared"
          >
            <RotateCcw className="size-3.5" />
            Restore declared
          </button>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label={`${title} sections`}
        className="flex items-center gap-1 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        {TABS.map((entry) => {
          const active = tab === entry.id;
          const Icon = entry.icon;
          const count = entry.id === "allow" ? allow.length : deny.length;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={entry.hint}
              onClick={() => setTab(entry.id)}
              className="relative -mb-px flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: active ? "var(--color-steel)" : "var(--color-warm-gray)",
                borderBottom: active ? "2px solid var(--color-steel)" : "2px solid transparent",
              }}
            >
              <Icon className="size-3.5" />
              {entry.label}
              <span
                className="rounded-full px-1.5 text-[10px]"
                style={{ backgroundColor: "var(--color-surface)", color: "var(--color-warm-gray)" }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {loading ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Loading Module governance…
          </p>
        ) : error && view === null ? (
          // The policy never loaded. Editing an EMPTY set here would send an
          // overlay that replaces a policy nobody has seen (ADR-263), so the
          // fields stay away until a read succeeds.
          <p role="alert" className="break-words text-xs text-red-600">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-2 underline"
              style={{ color: "var(--color-steel)" }}
            >
              Retry
            </button>
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule, index) => (
              <li
                key={`${tab}-${index}`}
                className="space-y-1.5 rounded-md border p-2.5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center gap-2">
                  {tab === "deny" ? (
                    <Ban className="size-3.5 shrink-0 text-red-600" />
                  ) : (
                    <Check className="size-3.5 shrink-0" style={{ color: "var(--color-steel)" }} />
                  )}
                  <input
                    value={rule.action}
                    aria-label={`${tab === "deny" ? "Denied" : "Allowed"} action`}
                    placeholder="books.write.model"
                    onChange={(event) =>
                      edit(
                        rules.map((entry, i) =>
                          i === index ? { ...entry, action: event.target.value } : entry,
                        ),
                      )
                    }
                    onBlur={() => {
                      if (draft) void persist(draft);
                    }}
                    className="h-7 flex-1 rounded border px-2 font-mono text-xs"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => void persist(edit(rules.filter((_, i) => i !== index)))}
                    className="rounded p-1 hover:bg-[var(--color-surface)]"
                    style={{ color: "var(--color-warm-gray)" }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {/* The reason is quoted verbatim when this rule refuses an action,
                    so the user reads the same sentence here and in the refusal. */}
                <input
                  value={rule.reason}
                  aria-label="Reason"
                  title="Quoted back when this rule refuses something"
                  placeholder="Why"
                  onChange={(event) =>
                    edit(
                      rules.map((entry, i) =>
                        i === index ? { ...entry, reason: event.target.value } : entry,
                      ),
                    )
                  }
                  onBlur={() => {
                    if (draft) void persist(draft);
                  }}
                  className="ml-5 h-7 w-[calc(100%-1.25rem)] rounded border px-2 text-xs"
                  style={inputStyle}
                />
              </li>
            ))}
            {rules.length === 0 ? (
              <li
                className="text-xs"
                title="An empty policy is not a default-deny — nothing listed here means nothing is blocked"
                style={{ color: "var(--color-warm-gray)" }}
              >
                {tab === "deny" ? "Nothing denied." : "Nothing explicitly allowed."}
              </li>
            ) : null}
            <li>
              <button
                type="button"
                onClick={() => edit([...rules, { action: "", reason: "" }])}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs font-medium hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
              >
                <Plus className="size-3.5" />
                Add {tab === "deny" ? "denied" : "allowed"} action
              </button>
            </li>
            {unsaved ? (
              <li className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                Not saved yet — a rule needs an action and a reason.
              </li>
            ) : null}
            {error ? (
              <li role="alert" className="break-words text-xs text-red-600">
                {error}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="ml-2 underline"
                  style={{ color: "var(--color-steel)" }}
                >
                  Retry
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}
