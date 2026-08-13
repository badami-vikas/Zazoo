import { useEffect, useState } from "react";
import { ShieldCheck, WifiOff, RefreshCw, Github, ExternalLink } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

type GithubStatus = Awaited<ReturnType<typeof trpc.devpilot.github.status.query>>;

/**
 * DevPilot's GitHub connection panel — a fine-grained Personal Access Token
 * paste flow (no OAuth app registration or callback route: a PAT has no
 * consent redirect). Mirrors GoogleIntegrationPanel's "credential/consent
 * panel, no Database rows" shape (see ui-conformance.test.mjs EXEMPT).
 */
export function GithubIntegrationPanel() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4200);
  };

  async function refresh() {
    setStatus(await trpc.devpilot.github.status.query({ organizationId: PILOT_ORGANIZATION }));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function connect() {
    if (!pat.trim()) {
      flash("Paste a fine-grained Personal Access Token first.");
      return;
    }
    setBusy("connect");
    try {
      const result = await trpc.devpilot.github.connect.mutate({
        organizationId: PILOT_ORGANIZATION,
        personalAccessToken: pat.trim(),
      });
      setPat("");
      flash(`Connected as ${result.login} — token stored in the local plane.`);
      await refresh();
    } catch (error) {
      flash(`Connect failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await trpc.devpilot.github.disconnect.mutate({ organizationId: PILOT_ORGANIZATION });
      flash("Disconnected — local token deleted.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runSyncNow() {
    setBusy("sync");
    try {
      const result = await trpc.devpilot.sync.run.mutate({ organizationId: PILOT_ORGANIZATION });
      const summary = result as {
        reposSeen?: number;
        trackedRepoCount?: number;
        pullsSynced?: number;
        issuesSynced?: number;
      } | undefined;
      flash(
        `Synced — ${summary?.reposSeen ?? 0} repos seen, ${summary?.trackedRepoCount ?? 0} tracked, ` +
          `${summary?.pullsSynced ?? 0} pull requests, ${summary?.issuesSynced ?? 0} issues.`,
      );
    } catch (error) {
      flash(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Github className="h-5 w-5" style={{ color: "var(--color-navy)" }} />
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-navy)" }}>
          GitHub — DevPilot tracker
        </h1>
      </div>

      {toast && (
        <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
          {toast}
        </div>
      )}

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
        {status?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-navy)" }}>
              <ShieldCheck className="h-4 w-4 text-green-600" />
              Connected — {status.kind} token ending in <code>{status.last4}</code>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runSyncNow()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Run sync now
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <WifiOff className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              Paste a fine-grained Personal Access Token, scoped read-only to the repos you want tracked
              (Metadata, Contents, Pull requests, Issues). Stored encrypted in the local plane — never sent
              anywhere except GitHub's own API.
            </p>
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
              style={{ color: "var(--color-navy)" }}
            >
              Create a token on GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <input
              type="password"
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              placeholder="github_pat_…"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy !== null}
              className="rounded-md px-3 py-1.5 text-sm text-white"
              style={{ backgroundColor: "var(--color-navy)" }}
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GithubIntegrationPanel;
