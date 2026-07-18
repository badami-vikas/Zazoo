import { useState } from "react";
import { CheckCircle, Download, Loader, Search, ShieldCheck } from "lucide-react";
import { PILOT_WORKSPACE, trpc } from "../lib/trpc";

type PackageRow = Awaited<ReturnType<typeof trpc.packages.list.query>>["items"][number];
type ModuleManifest = NonNullable<NonNullable<PackageRow["manifest"]>["module"]>;
type CommonsNeed = NonNullable<ModuleManifest["commonsNeeds"]>[number];
type CommonsSummary = Awaited<ReturnType<typeof trpc.commons.list.query>>["items"][number];
type CommonsDetail = Awaited<ReturnType<typeof trpc.commons.get.query>>;

export function CommonsCapabilityPanel({
  modulePackageName,
  need,
  installed,
  onInstalled,
}: {
  modulePackageName: string;
  need: CommonsNeed;
  installed: PackageRow | undefined;
  onInstalled: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommonsSummary[] | null>(null);
  const [detail, setDetail] = useState<CommonsDetail | null>(null);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function searchCommons() {
    setSearching(true);
    setMessage(null);
    setDetail(null);
    try {
      const input: Parameters<typeof trpc.commons.list.query>[0] = {
        kind: need.kind,
        tag: need.tags[0],
        limit: 20,
        offset: 0,
      };
      if (query.trim()) input.search = query.trim();
      const response = await trpc.commons.list.query(input);
      setResults(response.items);
    } catch (error) {
      setMessage(`Commons search failed: ${String(error)}`);
    } finally {
      setSearching(false);
    }
  }

  async function inspectPackage(name: string) {
    setMessage(null);
    try {
      setDetail(await trpc.commons.get.query({ name }));
    } catch (error) {
      setMessage(`Could not inspect Commons package: ${String(error)}`);
    }
  }

  async function install() {
    if (!detail) return;
    setInstalling(true);
    setMessage(null);
    try {
      const proposed = await trpc.commons.installPropose.mutate({
        workspaceId: PILOT_WORKSPACE,
        name: detail.latest.name,
        version: detail.latest.version,
        modulePackageName,
        agentId: need.agentId,
        needId: need.id,
      });
      if (proposed.installation.state === "available" && proposed.installation.status === "installed") {
        setMessage("Already installed and attached to the owning Module Agent.");
        onInstalled();
        return;
      }
      if (proposed.installation.state === "promoted" && proposed.installation.status === "installed") {
        await trpc.packages.promote.mutate({
          workspaceId: PILOT_WORKSPACE,
          installationId: proposed.installation.id,
        });
        setMessage("Installed through governance and attached to the owning Module Agent.");
        onInstalled();
        return;
      }
      const result = await trpc.packages.install.mutate({
        workspaceId: PILOT_WORKSPACE,
        installationId: proposed.installation.id,
        todayKey: new Date().toISOString().slice(0, 10),
      });
      if (result.installed) {
        await trpc.packages.promote.mutate({
          workspaceId: PILOT_WORKSPACE,
          installationId: proposed.installation.id,
        });
        setMessage("Installed through governance and attached to the owning Module Agent.");
        onInstalled();
      } else {
        setMessage("Install is awaiting the required approval.");
      }
    } catch (error) {
      setMessage(`Install blocked: ${String(error)}`);
    } finally {
      setInstalling(false);
    }
  }

  if (installed) {
    return (
      <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--color-steel-light)" }}>
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--color-steel)" }}>
          <CheckCircle className="h-4 w-4" />
          {need.title} installed
        </div>
        <p className="mt-1 break-all text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {installed.packageName} v{installed.packageVersion} · {installed.moduleAttachment?.contentHash}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--color-border)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>{need.title}</p>
        <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>{need.description}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded border px-2.5 py-2" style={{ borderColor: "var(--color-border)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--color-warm-gray)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchCommons();
            }}
            placeholder="Refine this Module need"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            aria-label={`Search Commons for ${need.title}`}
          />
        </label>
        <button
          type="button"
          onClick={() => void searchCommons()}
          disabled={searching}
          className="inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-steel)", color: "white" }}
        >
          {searching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search Commons
        </button>
      </div>

      {results && (
        results.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            No signed Commons capability currently satisfies this need.
          </p>
        ) : (
          <ul className="divide-y rounded border" style={{ borderColor: "var(--color-border)" }}>
            {results.map((result) => (
              <li key={result.name} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--color-navy)" }}>{result.name}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>{result.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void inspectPackage(result.name)}
                  className="shrink-0 rounded border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}
                >
                  Inspect
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {detail && (
        <div className="rounded border p-3 space-y-3" style={{ borderColor: "var(--color-steel-light)" }}>
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--color-steel)" }} />
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                {detail.latest.name} v{detail.latest.version}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>{detail.latest.summary}</p>
            </div>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-medium">Source</dt>
              <dd className="break-all" style={{ color: "var(--color-warm-gray)" }}>
                {detail.latest.provenance.sourceRepository}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Inspected commit</dt>
              <dd className="break-all" style={{ color: "var(--color-warm-gray)" }}>
                {detail.latest.provenance.inspectedCommit}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Licenses</dt>
              <dd style={{ color: "var(--color-warm-gray)" }}>
                source {detail.latest.provenance.repositoryLicense} · capability {detail.latest.provenance.artifactLicense}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Content hash</dt>
              <dd className="break-all" style={{ color: "var(--color-warm-gray)" }}>{detail.latest.integrity.value}</dd>
            </div>
          </dl>
          <div>
            <p className="text-xs font-medium">
              Security scan: {detail.latest.securityScan.status} · {detail.latest.securityScan.riskBand} risk
            </p>
            <ul className="mt-1 space-y-1">
              {detail.latest.securityScan.checks.map((check) => (
                <li key={check.id} className="text-xs" style={{ color: check.status === "fail" ? "#b91c1c" : "var(--color-warm-gray)" }}>
                  {check.status.toUpperCase()} · {check.id} — {check.detail}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => void install()}
            disabled={installing || detail.latest.securityScan.status !== "passed"}
            className="inline-flex w-full items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium disabled:opacity-50 sm:w-auto"
            style={{ backgroundColor: "var(--color-steel)", color: "white" }}
          >
            {installing ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Install for {need.title}
          </button>
        </div>
      )}

      {message && <p className="text-xs break-words" style={{ color: "var(--color-warm-gray)" }}>{message}</p>}
    </div>
  );
}
