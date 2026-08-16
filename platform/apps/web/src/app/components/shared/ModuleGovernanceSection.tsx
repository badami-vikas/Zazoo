/**
 * ModuleGovernanceSection — the standard per-Module "Governance" section
 * (ADR-248, AP-159). Sits directly BELOW the Intelligence Section on every
 * Module surface and shows the `allow`/`deny` policy declared in that Module's
 * manifest.
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
 * Honest empty states throughout (UI-RULES §6a, present-not-absent): a Module
 * with no declared policy renders a plain note saying so and is never filtered
 * out of the layout. An empty policy denies nothing — it is not a default-deny,
 * and the copy says that rather than implying a boundary that does not exist.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ShieldCheck, Check, Ban, ArrowUpRight } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];
type GovernanceTab = "allow" | "deny";

const TABS: { id: GovernanceTab; label: string; icon: typeof Check }[] = [
  { id: "allow", label: "Allowed", icon: Check },
  { id: "deny", label: "Denied", icon: Ban },
];

export function ModuleGovernanceSection({
  moduleName,
  title = "Governance",
}: {
  moduleName: string;
  title?: string;
}) {
  const [pkg, setPkg] = useState<ModuleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GovernanceTab>("deny");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPkg(null);
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((res) => {
        if (!active) return;
        setPkg(res.items.find((item) => item.moduleName === moduleName) ?? null);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [moduleName]);

  const governance = pkg?.manifest?.governance;
  const allow = useMemo(() => governance?.allow ?? [], [governance]);
  const deny = useMemo(() => governance?.deny ?? [], [governance]);
  const rules = tab === "allow" ? allow : deny;
  const declared = allow.length + deny.length > 0;

  const moduleDetailPath = `/module/${moduleName}`;

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
          {governance?.userEdited ? (
            <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
              edited by you
            </span>
          ) : declared ? (
            <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
              seeded
            </span>
          ) : null}
        </div>
        <Link
          to={moduleDetailPath}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-[var(--color-surface)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
        >
          Edit in Module Detail
          <ArrowUpRight className="size-3.5" />
        </Link>
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
        ) : error ? (
          <p role="alert" className="break-words text-xs text-red-600">
            {error}
          </p>
        ) : pkg === null ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            This Module has no installed package yet, so it declares no governance policy.
          </p>
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
