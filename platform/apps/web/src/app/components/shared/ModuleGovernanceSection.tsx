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
 * component renders that same declaration. Rendering is the smaller half — a
 * Governance Section that ONLY displayed policy would reproduce exactly the
 * prose-nobody-enforces failure it exists to end.
 *
 * WHAT CHANGED (TASK-088). This Section used to read the manifest through
 * `modules.list` and offer an "Edit in Module Detail" link — to a Page deleted
 * on 2026-08-10, so the button redirected the user back to the surface they
 * were already on. Manifests are immutable (ADR-178) and there was nothing to
 * edit. It now reads `moduleGovernance.get`, which returns the RESOLVED policy
 * (the user's overlay resolved over the manifest's declared default), and edits
 * in place through `moduleGovernance.set` — the same policy the engine enforces.
 * "Interactive-looking UI must perform a governed action": this one does.
 *
 * Honest empty states throughout (present-not-absent): a Module with no declared
 * policy renders a plain note saying so and is never filtered out of the layout.
 * An empty policy denies nothing — it is not a default-deny, and the copy says
 * that rather than implying a boundary that does not exist.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Check, Ban, Pencil, Plus, Trash2, RotateCcw } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

type GovernanceView = Awaited<ReturnType<typeof trpc.moduleGovernance.get.query>>;
type GovernanceRule = { action: string; reason: string };
type GovernanceTab = "allow" | "deny";
type Draft = { allow: GovernanceRule[]; deny: GovernanceRule[] };

const TABS: { id: GovernanceTab; label: string; icon: typeof Check }[] = [
  { id: "allow", label: "Allowed", icon: Check },
  { id: "deny", label: "Denied", icon: Ban },
];

const inputStyle = {
  borderColor: "var(--color-border)",
  color: "var(--color-navy)",
  backgroundColor: "var(--color-background)",
} as const;

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
  const editing = draft !== null;

  const editRules = (next: GovernanceRule[]) =>
    setDraft((current) => ({ ...(current ?? { allow, deny }), [tab]: next }) as Draft);

  /** The server has the last word on what changed (ADR-247): every mutation
   * re-reads the resolved policy from the response rather than echoing input. */
  const commit = async (operation: Promise<GovernanceView>) => {
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

  const save = () => {
    const body = draft ?? { allow, deny };
    const blank = [...body.allow, ...body.deny].some(
      (rule) => rule.action.trim().length === 0 || rule.reason.trim().length === 0,
    );
    if (blank) {
      // Same contract the manifest parser and the API enforce: a rule that
      // cannot explain itself is a rule the user cannot audit later.
      setError("Every rule needs an action and a reason — the reason is what a refusal quotes back.");
      return;
    }
    return commit(
      trpc.moduleGovernance.set.mutate({
        organizationId: PILOT_ORGANIZATION,
        moduleName,
        allow: body.allow.map((rule) => ({ action: rule.action.trim(), reason: rule.reason.trim() })),
        deny: body.deny.map((rule) => ({ action: rule.action.trim(), reason: rule.reason.trim() })),
      }),
    );
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
          {view?.userEdited ? (
            <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
              edited by you
            </span>
          ) : declared ? (
            <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
              seeded
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                disabled={saving}
                className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium disabled:opacity-50 hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--color-steel)" }}
              >
                {saving ? "Saving…" : "Save policy"}
              </button>
            </>
          ) : (
            <>
              {view?.userEdited ? (
                <button
                  type="button"
                  onClick={() =>
                    commit(
                      trpc.moduleGovernance.reset.mutate({
                        organizationId: PILOT_ORGANIZATION,
                        moduleName,
                      }),
                    )
                  }
                  disabled={saving || loading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:opacity-50 hover:bg-[var(--color-surface)]"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                  title="Drop your overlay and go back to the policy this Module declared"
                >
                  <RotateCcw className="size-3.5" />
                  Restore declared
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDraft({ allow, deny })}
                disabled={loading || error !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:opacity-50 hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
              >
                <Pencil className="size-3.5" />
                Edit policy
              </button>
            </>
          )}
        </div>
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
        ) : error && !editing ? (
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
        ) : editing ? (
          <ul className="space-y-2">
            {rules.map((rule, index) => (
              <li
                key={`${tab}-edit-${index}`}
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
                      editRules(
                        rules.map((entry, i) =>
                          i === index ? { ...entry, action: event.target.value } : entry,
                        ),
                      )
                    }
                    className="h-7 flex-1 rounded border px-2 font-mono text-xs"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => editRules(rules.filter((_, i) => i !== index))}
                    className="rounded p-1 hover:bg-[var(--color-surface)]"
                    style={{ color: "var(--color-warm-gray)" }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <input
                  value={rule.reason}
                  aria-label="Reason"
                  placeholder="Why — this sentence is quoted back when the rule refuses something"
                  onChange={(event) =>
                    editRules(
                      rules.map((entry, i) =>
                        i === index ? { ...entry, reason: event.target.value } : entry,
                      ),
                    )
                  }
                  className="ml-5 h-7 w-[calc(100%-1.25rem)] rounded border px-2 text-xs"
                  style={inputStyle}
                />
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => editRules([...rules, { action: "", reason: "" }])}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs font-medium hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
              >
                <Plus className="size-3.5" />
                Add {tab === "deny" ? "denied" : "allowed"} action
              </button>
            </li>
            {error ? (
              <li role="alert" className="break-words text-xs text-red-600">
                {error}
              </li>
            ) : null}
          </ul>
        ) : !declared ? (
          // Present-not-absent: say what is true rather than hiding the Section.
          // "Nothing declared" must not read as "nothing permitted".
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            No governance policy declared for this Module. Nothing is denied — an empty policy is not
            a default-deny.
          </p>
        ) : rules.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            {tab === "deny"
              ? "Nothing is denied for this Module."
              : "Nothing is explicitly allowed; unlisted actions are not blocked by this policy."}
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={`${tab}-${rule.action}`}
                className="rounded-md border p-2.5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center gap-2">
                  {tab === "deny" ? (
                    <Ban className="size-3.5 shrink-0 text-red-600" />
                  ) : (
                    <Check className="size-3.5 shrink-0" style={{ color: "var(--color-steel)" }} />
                  )}
                  <code className="text-xs font-medium" style={{ color: "var(--color-navy)" }}>
                    {rule.action}
                  </code>
                </div>
                {/* The reason is quoted verbatim when this rule refuses an action,
                    so the user reads the same sentence here and in the refusal. */}
                <p className="mt-1 pl-5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {rule.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
        {tab === "deny" && deny.length > 0 ? (
          <p className="mt-2 text-[11px]" style={{ color: "var(--color-warm-gray)" }}>
            A denial always wins over an allow.
          </p>
        ) : null}
      </div>
    </section>
  );
}
