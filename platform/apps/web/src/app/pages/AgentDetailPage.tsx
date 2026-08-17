/**
 * AgentDetailPage — one governed Agent, opened from its card on Intelligence.
 *
 * Everything on this page is manifest-sourced (`modules.list`) and read-only:
 * the Agent's capability, its plane, the Skills it consumes, the Automations
 * that start Runs on it, and the Module that provides it. Canon: Skills are
 * never free-standing, so they are listed HERE, under the Agent allowed to
 * invoke them, and never anywhere else.
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

type ModuleRow = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

export function AgentDetailPage() {
  const { moduleName = "", agentId = "" } = useParams();
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which room the Agent is shown in. Presentation only — nothing here claims
  // the Agent is actually running; binding this to live Run state is the next
  // step, not something to fake now.
  const [pose, setPose] = useState<PoseKey>("working");

  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => { if (active) setRows(result.items); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);

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

            <Section icon={Wrench} title={`Skills (${found.skills.length})`}>
              {found.skills.length === 0 ? (
                <Empty text="This Agent declares no Skills." />
              ) : (
                <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                  {found.skills.map(({ id, capability }) => (
                    <li key={id} className="p-3">
                      <p className="text-sm" style={{ color: "var(--color-navy)" }}>{capability?.name ?? id}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                        {capability
                          ? `Skill capability ${id}`
                          : `Declared as “${id}”; the Module ships no Skill capability under that id.`}
                      </p>
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
                      <p className="text-sm" style={{ color: "var(--color-navy)" }}>{a.name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                        Trigger: {a.trigger}
                      </p>
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
