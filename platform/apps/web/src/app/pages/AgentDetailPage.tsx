/**
 * AgentDetailPage — one governed Agent, opened from its card on Intelligence.
 *
 * The Agent's own fields are EDITABLE in place (TASK-114): its name and the
 * Skills it consumes are this Organization's to change; its capability, plane
 * and Runs route are the exceptions, and each says why on the row. Below that
 * sit the Skills it consumes and the Automations that start Runs on it — every
 * one of them a link to its own entry page. Canon: Skills are never
 * free-standing, so they are reached HERE, under the Agent allowed to invoke
 * them, and never from a nav entry of their own.
 *
 * The live companion rig sits top-right. It is cast from the Agent id and
 * carries no data — it is how you recognise this Agent, not a claim about it.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Wrench, Zap } from "lucide-react";
import { Link, useParams } from "react-router";
import { AgentRoom } from "../avatar/zazoo/AgentZazoo";
import { type PoseKey } from "../avatar/zazoo/ZazooWorld";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import { intelligenceEntryRoute } from "../components/shared/ModuleIntelligenceSection";
import { ModuleIntelligenceFields, type IntelligenceView } from "../components/shared/ModuleIntelligenceFields";

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

export function AgentDetailPage() {
  const { moduleName = "", agentId = "" } = useParams();
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which room the Agent is shown in. Presentation only — nothing here claims
  // the Agent is actually running; binding this to live Run state is the next
  // step, not something to fake now.
  const [pose, setPose] = useState<PoseKey>("working");
  const [intelligence, setIntelligence] = useState<IntelligenceView | null>(null);

  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => { if (active) setRows(result.items); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);

  // The editable half. Separate request, deliberately: the fields, their labels
  // and which of them are locked are the SERVER's answer (TASK-114), not
  // something this page derives from a manifest it happens to hold.
  useEffect(() => {
    if (!moduleName) return;
    let active = true;
    trpc.moduleIntelligence.get
      .query({ organizationId: PILOT_ORGANIZATION, moduleName })
      .then((result) => { if (active) setIntelligence(result); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [moduleName]);

  const found = useMemo(() => {
    const row = rows?.find((r) => r.moduleName === moduleName);
    const mod = row?.manifest?.module;
    const capabilities = row?.manifest?.capabilities ?? [];
    const agent = mod?.agents.find((a) => a.id === agentId);
    if (!row || !mod || !agent) return null;
    return {
      agent,
      mod,
      displayName: mod.displayName ?? row.manifest!.name,
      version: row.moduleVersion,
      // Skills live under the Agent that consumes them, so resolve the ids
      // against the Module's own Skill declarations rather than listing bare
      // strings the user cannot act on.
      skills: agent.skillIds.map((id) => ({
        id,
        capability:
          capabilities.find((c) => c.id === id && c.capabilityType === "skill") ?? null,
      })),
      automations: mod.automations.filter((a) => a.agentId === agent.id),
    };
  }, [rows, moduleName, agentId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-white">
      <div className="mx-auto w-full max-w-3xl p-4">
        <Link
          to="/intelligence"
          className="mb-4 inline-flex items-center gap-1.5 text-xs no-underline"
          style={{ color: "var(--color-warm-gray)" }}
        >
          <ArrowLeft className="size-3.5" />
          Intelligence
        </Link>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 p-4 text-sm text-red-600">
            Agent could not load: {error}
          </p>
        ) : rows === null ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading Agent…</p>
        ) : !found ? (
          <div
            className="rounded-lg border border-dashed p-4 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No installed Module declares an Agent “{agentId}”. It may have been removed with its Module.
          </div>
        ) : (
          <>
            {/* header: identity left, the Agent's own rig top-right */}
            <header className="mb-6 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-medium" style={{ color: "var(--color-navy)" }}>
                  {found.agent.name}
                </h1>
                <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {[
                    found.agent.capabilityId,
                    found.agent.plane ? `${found.agent.plane} plane` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                <Link
                  to={`/module/${encodeURIComponent(moduleName)}`}
                  className="mt-2 inline-block rounded border px-1.5 py-0.5 text-xs no-underline hover:bg-[var(--color-surface)]"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                  title={`Provided by ${found.displayName} v${found.version}`}
                >
                  {found.displayName}
                </Link>
                {found.agent.runRoute && (
                  <Link
                    to={found.agent.runRoute}
                    className="ml-2 mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium no-underline hover:bg-[var(--color-surface)]"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                  >
                    Runs
                  </Link>
                )}
              </div>
              {/* the Agent's own room, top-right: office while it works,
                  home when it is off duty. Both are the same authored scene. */}
              <div className="shrink-0">
                <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)", background: "#EFE7DA" }} aria-hidden>
                  <AgentRoom agentId={found.agent.id} pose={pose} scale={0.36} />
                </div>
                <div className="mt-2 flex justify-center gap-1.5">
                  {(["working", "sleeping"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPose(k)}
                      className="rounded-full border px-2.5 py-1 text-xs"
                      style={{
                        borderColor: k === pose ? "var(--color-steel)" : "var(--color-border)",
                        color: k === pose ? "var(--color-steel)" : "var(--color-warm-gray)",
                      }}
                    >
                      {k === "working" ? "Office" : "Home"}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            {(() => {
              const entry = intelligence?.entries.find(
                (entry) => entry.kind === "agent" && entry.id === found.agent.id,
              );
              return entry && intelligence ? (
                <Section icon={Bot} title="Details">
                  <ModuleIntelligenceFields
                    moduleName={moduleName}
                    entry={entry}
                    view={intelligence}
                    onChanged={(next) => {
                      setIntelligence(next);
                      // The Skills and Automations below read modules.list, so
                      // re-read it rather than leave the page half-updated.
                      trpc.modules.list
                        .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
                        .then((result) => setRows(result.items))
                        .catch((cause) => setError(String(cause)));
                    }}
                  />
                </Section>
              ) : null;
            })()}

            <Section icon={Wrench} title={`Skills (${found.skills.length})`}>
              {found.skills.length === 0 ? (
                <Empty text="This Agent declares no Skills." />
              ) : (
                <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                  {found.skills.map(({ id, capability }) => (
                    <li key={id} className="p-3">
                      {/* A Skill the Module does not ship has no page to open —
                          the row says so instead of linking nowhere. */}
                      {capability ? (
                        <Link to={intelligenceEntryRoute(moduleName, "skill", id)} className="block no-underline">
                          <p className="text-sm" style={{ color: "var(--color-navy)" }}>{capability.name}</p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            Skill capability {id}
                          </p>
                        </Link>
                      ) : (
                        <>
                          <p className="text-sm" style={{ color: "var(--color-navy)" }}>{id}</p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                            Declared as “{id}”; the Module ships no Skill capability under that id.
                          </p>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={Zap} title={`Automations (${found.automations.length})`}>
              {found.automations.length === 0 ? (
                <Empty text="No Automation starts a Run on this Agent." />
              ) : (
                <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                  {found.automations.map((a) => (
                    <li key={a.id} className="p-3">
                      <Link to={intelligenceEntryRoute(moduleName, "automation", a.id)} className="block no-underline">
                        <p className="text-sm" style={{ color: "var(--color-navy)" }}>{a.name}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                          Trigger: {a.trigger}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Bot; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4" style={{ color: "var(--color-steel)" }} />
        <h2 className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{title}</h2>
      </div>
      {children}
    </section>
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
