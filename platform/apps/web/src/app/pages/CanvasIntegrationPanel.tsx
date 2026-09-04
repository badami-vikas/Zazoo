import { useEffect, useState } from "react";
import { ShieldCheck, WifiOff, RefreshCw, GraduationCap, ExternalLink } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

type CanvasStatus = Awaited<ReturnType<typeof trpc.academics.canvas.status.query>>;

/**
 * Academics' Canvas LMS connection panel — an access-token paste flow (Canvas
 * Account → Settings → New Access Token; no OAuth app registration for a
 * single-user connector), plus the instance domain since Canvas is
 * per-institution. Mirrors GithubIntegrationPanel's "credential/consent
 * panel, no Database rows" shape (see ui-conformance.test.mjs EXEMPT).
 */
export function CanvasIntegrationPanel() {
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4200);
  };

  async function refresh() {
    setStatus(await trpc.academics.canvas.status.query({ organizationId: PILOT_ORGANIZATION }));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function connect() {
    if (!domain.trim() || !token.trim()) {
      flash("Enter your Canvas domain and paste an access token first.");
      return;
    }
    setBusy("connect");
    try {
      const result = await trpc.academics.canvas.connect.mutate({
        organizationId: PILOT_ORGANIZATION,
        canvasDomain: domain.trim(),
        accessToken: token.trim(),
      });
      setToken("");
      flash(`Connected as ${result.name} on ${result.host} — token stored in the local plane.`);
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
      await trpc.academics.canvas.disconnect.mutate({ organizationId: PILOT_ORGANIZATION });
      flash("Disconnected — local token deleted.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runSyncNow() {
    setBusy("sync");
    try {
      const result = await trpc.academics.canvas.sync.mutate({ organizationId: PILOT_ORGANIZATION });
      const summary = result as {
        coursesSeen?: number;
        subjectsCreated?: number;
        assignmentsSynced?: number;
        assignmentsCreated?: number;
        documentsSynced?: number;
        documentsCreated?: number;
      } | undefined;
      flash(
        `Synced — ${summary?.coursesSeen ?? 0} courses (${summary?.subjectsCreated ?? 0} new Subjects), ` +
          `${summary?.assignmentsSynced ?? 0} assignments (${summary?.assignmentsCreated ?? 0} new), ` +
          `${summary?.documentsSynced ?? 0} documents (${summary?.documentsCreated ?? 0} new) — see the Documents page to summarize.`,
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
        <GraduationCap className="h-5 w-5" style={{ color: "var(--color-navy)" }} />
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-navy)" }}>
          Canvas LMS — Academics sync
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
              Connected to {status.host} — token ending in <code>{status.last4}</code>
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
                Sync now
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
              Enter your institution&apos;s Canvas domain and paste an access token (Canvas → Account →
              Settings → New Access Token). Read-only: courses become Subjects and assignments sync with
              due dates and grades. Stored encrypted in the local plane — never sent anywhere except your
              own Canvas instance.
            </p>
            <a
              href="https://community.canvaslms.com/t5/Canvas-Basics-Guide/How-do-I-manage-API-access-tokens-in-my-user-account/ta-p/615312"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
              style={{ color: "var(--color-navy)" }}
            >
              How to create a Canvas access token <ExternalLink className="h-3 w-3" />
            </a>
            <input
              type="text"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="yourschool.instructure.com"
              aria-label="Canvas instance domain"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Access token, e.g. 1234~…"
              aria-label="Canvas access token"
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

export default CanvasIntegrationPanel;
