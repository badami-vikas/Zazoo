import { useEffect, useState } from "react";
import { ArrowRight, Boxes, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type InstalledModule = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

export function HomePage() {
  const [modules, setModules] = useState<InstalledModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (!active) return;
        setModules(
          result.items.filter(
            (item) =>
              item.state === "available" &&
              item.status === "installed" &&
              item.manifest.module !== undefined &&
              item.moduleAttachment === undefined,
          ),
        );
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setModules([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-steel)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Living Software
          </div>
          <h1
            style={{
              color: "var(--color-navy)",
              fontFamily: "var(--font-editorial)",
              fontSize: "34px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Your installed Modules
          </h1>
          <p style={{ color: "var(--color-warm-gray)", maxWidth: 640 }}>
            Open a Module to work with its real Records, Agents, Automations, Integrations, Files, and Results.
          </p>
        </div>

        {modules === null && !error ? (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--color-border)" }}>
            Loading installed Modules...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            Installed Modules could not be loaded: {error}
          </div>
        ) : null}

        {modules && modules.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {modules.map((item) => {
              const module = item.manifest.module!;
              return (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border bg-white p-5"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ backgroundColor: "color-mix(in srgb, var(--color-steel) 12%, transparent)" }}
                    >
                      <Boxes className="h-5 w-5" style={{ color: "var(--color-steel)" }} />
                    </div>
                    <div>
                      <h2 className="font-semibold" style={{ color: "var(--color-navy)" }}>{module.displayName}</h2>
                      <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Version {item.moduleVersion}</p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-navy-mid)" }}>
                    {item.manifest.description}
                  </p>
                  <Link
                    to={`/module/${item.moduleName}`}
                    className="inline-flex items-center gap-1.5 self-start text-sm font-semibold"
                    style={{ color: "var(--color-steel)" }}
                  >
                    Open Module <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : null}

        {modules && modules.length === 0 && !error ? (
          <div
            className="rounded-xl border border-dashed p-10 text-center"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No Modules are installed yet. Install a trusted Module from Settings.
          </div>
        ) : null}
      </div>
    </div>
  );
}
