/**
 * ModuleIntelligenceEntryPage — one Skill, Automation or Integration on a page of its
 * own, editable (TASK-114, user directive 2026-09-11).
 *
 * ONE PAGE FOR THREE KINDS, deliberately. The fields, their labels and which of
 * them are locked all come from `moduleIntelligence.get`; the page renders
 * whatever rows it is handed. Three near-identical pages would be three places
 * for the editability rules to drift, which is the defect this task was filed
 * against in the first place.
 *
 * AGENTS ARE NOT HERE. An Agent has its own page already — `AgentDetailPage`,
 * with the ADR-250 room rig — and canon puts Skills UNDER the Agent that
 * consumes them, so a Skill's page is reached from its Agent. This page is what
 * that link opens.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Cable, Wrench, Zap } from "lucide-react";
import { Link, useParams } from "react-router";
import {
  ModuleIntelligenceFields,
  type IntelligenceView,
} from "../components/shared/ModuleIntelligenceFields";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

const KINDS = {
  skill: { label: "Skill", icon: Wrench },
  automation: { label: "Automation", icon: Zap },
  integration: { label: "Integration", icon: Cable },
} as const;

type PageKind = keyof typeof KINDS;

export function ModuleIntelligenceEntryPage() {
  const { moduleName = "", kind = "", entryId = "" } = useParams();
  const [view, setView] = useState<IntelligenceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    setError(null);
    trpc.moduleIntelligence.get
      .query({ organizationId: PILOT_ORGANIZATION, moduleName })
      .then((result) => { if (active) setView(result); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [moduleName]);

  useEffect(load, [load]);

  const known = kind in KINDS ? KINDS[kind as PageKind] : null;
  const entry = view?.entries.find((entry) => entry.kind === kind && entry.id === entryId) ?? null;
  const Icon = known?.icon ?? Wrench;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-white">
      <div className="mx-auto w-full max-w-3xl p-4">
        <Link
          to={`/module/${encodeURIComponent(moduleName)}`}
          className="mb-4 inline-flex items-center gap-1.5 text-xs no-underline"
          style={{ color: "var(--color-warm-gray)" }}
        >
          <ArrowLeft className="size-3.5" />
          {view?.displayName ?? moduleName}
        </Link>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 p-4 text-sm text-red-600">{error}</p>
        ) : !known ? (
          <Empty text={`“${kind}” is not an intelligence entry kind.`} />
        ) : view === null ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading…</p>
        ) : entry === null ? (
          <Empty
            text={`${view.displayName} declares no ${known.label} “${entryId}”. It may have been removed with its Module.`}
          />
        ) : (
          <>
            <header className="mb-6 flex items-start gap-3">
              <Icon className="mt-1 size-5 shrink-0" style={{ color: "var(--color-steel)" }} />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-medium" style={{ color: "var(--color-navy)" }}>
                  {entry.label}
                </h1>
                <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {known.label} · {entry.id}
                </p>
              </div>
            </header>
            <ModuleIntelligenceFields
              moduleName={moduleName}
              entry={entry}
              view={view}
              onChanged={setView}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg border border-dashed p-4 text-xs"
      style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
    >
      {text}
    </div>
  );
}
