import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";

type GoogleInfo = Awaited<ReturnType<typeof trpc.google.list.query>>;

/**
 * Gmail + Google Calendar connection surface — connect (OAuth redirect), disconnect,
 * sync Gmail/Calendar (draft-only egress skills, per google-integration.md), and a
 * proposeSend smoke action. Maps to router.ts's `google.*` procedures, which are
 * workspace-IMPLICIT (no workspaceId param — see router.ts comment on the google router).
 */
export function GoogleIntegrationPanel() {
  const [info, setInfo] = useState<GoogleInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);

  function refresh() {
    trpc.google.list.query().then(setInfo).catch((e) => setError(String(e)));
  }

  useEffect(refresh, []);

  async function connect() {
    setError(null);
    setBusy("connect");
    try {
      const res = await trpc.google.connectUrl.mutate();
      if (res.url) {
        window.location.href = res.url;
      } else {
        setError("OAuth not configured");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy("disconnect");
    try {
      await trpc.google.disconnect.mutate();
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function syncGmail() {
    setError(null);
    setBusy("syncGmail");
    try {
      const res = await trpc.google.syncGmail.mutate({ maxResults: 10 });
      setLastResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function syncCalendar() {
    setError(null);
    setBusy("syncCalendar");
    try {
      const res = await trpc.google.syncCalendar.mutate({ maxResults: 10 });
      setLastResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!info) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Google Integration</h1>
        <Button size="sm" variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="text-sm space-y-1">
        <div>OAuth configured: {String(info.oauthConfigured)}</div>
        <div>Gateway kind: {info.gatewayKind}</div>
        <div>Integration ID: {info.integrationId}</div>
        <div>Connected: {String(Boolean(info.connection))}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={connect} disabled={busy !== null}>
          {busy === "connect" ? "Redirecting…" : "Connect Google"}
        </Button>
        <Button variant="destructive" onClick={disconnect} disabled={busy !== null}>
          {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
        </Button>
        <Button variant="outline" onClick={syncGmail} disabled={busy !== null}>
          {busy === "syncGmail" ? "Syncing…" : "Sync Gmail"}
        </Button>
        <Button variant="outline" onClick={syncCalendar} disabled={busy !== null}>
          {busy === "syncCalendar" ? "Syncing…" : "Sync Calendar"}
        </Button>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-1">Surfaces</h2>
        <ul className="text-sm text-muted-foreground list-disc pl-5">
          {info.surfaces.map((s) => (
            <li key={s.provider}>{s.name}</li>
          ))}
        </ul>
      </div>

      {lastResult != null && (
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      )}
    </div>
  );
}
