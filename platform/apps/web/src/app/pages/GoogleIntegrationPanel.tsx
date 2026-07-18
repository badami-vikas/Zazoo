import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import clsx from 'clsx';
import {
  ChevronRight, BookOpen, Mail, Calendar as CalendarIcon, CheckCircle, WifiOff, ShieldCheck,
  RefreshCw, Send, ArrowRight, Lock, Globe, Inbox,
} from 'lucide-react';
import {
  API_ENABLED, apiIntegrationList, apiConnectGoogle, apiDisconnectGoogle, apiSyncGmail, apiSyncCalendar, apiProposeSend,
  type IntegrationListResult, type IntakeResult,
} from '../data/api';

// The REAL Gmail + Google Calendar integration panel. Wired to the platform: the
// prototype triggers, the platform executes through the gate. Reads feed the graph
// by approval; writes are draft-then-approve. (Mock integrations keep the old UI.)
export function GoogleIntegrationPanel() {
  const [params] = useSearchParams();
  const [data, setData] = useState<IntegrationListResult | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sync, setSync] = useState<IntakeResult | null>(null);
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' });
  const awaitingDesktopOAuth = useRef(false);
  const desktopOAuthExpiresAt = useRef(0);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  async function refresh() {
    const r = await apiIntegrationList();
    setData(r);
  }

  useEffect(() => {
    if (params.get('connected')) flash('Google connected — tokens stored in the local plane.');
    const err = params.get('error');
    if (err) flash(`Connect failed: ${err}`);
    void refresh();
    const refreshAfterDesktopOAuth = () => {
      if (!awaitingDesktopOAuth.current) return;
      void apiIntegrationList()
        .then((result) => {
          setData(result);
          if (result?.connection.connected) {
            awaitingDesktopOAuth.current = false;
            flash('Google connected — tokens stored in the local plane.');
          } else if (Date.now() >= desktopOAuthExpiresAt.current) {
            awaitingDesktopOAuth.current = false;
            flash('Google authorization expired before the connection completed.');
          } else {
            flash('Google authorization is still pending in the system browser.');
          }
        })
        .catch((error: unknown) => {
          flash(`Could not refresh Google connection status: ${error instanceof Error ? error.message : String(error)}`);
        });
    };
    window.addEventListener('focus', refreshAfterDesktopOAuth);
    return () => window.removeEventListener('focus', refreshAfterDesktopOAuth);
  }, []);

  async function connect() {
    setBusy('connect');
    try {
      const r = await apiConnectGoogle();
      if (r?.url) {
        if (window.__BRIDGE_DESKTOP__ && window.__TAURI_INTERNALS__?.invoke) {
          awaitingDesktopOAuth.current = true;
          desktopOAuthExpiresAt.current = Date.now() + 10 * 60 * 1000;
          await window.__TAURI_INTERNALS__.invoke('open_google_oauth', { url: r.url });
          flash('Continue the Google connection in your system browser, then return to Bridge.');
        } else {
          window.location.assign(r.url);
        }
        return;
      }
      if (r?.error === 'oauth_not_configured') flash('Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the API to connect.');
      else flash('Connect a platform API first (set VITE_API_URL).');
    } catch (error) {
      awaitingDesktopOAuth.current = false;
      desktopOAuthExpiresAt.current = 0;
      flash(`Could not open Google authorization: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(null); }
  }

  async function disconnect() {
    setBusy('disconnect');
    try { await apiDisconnectGoogle(); await refresh(); flash('Disconnected — local token deleted.'); }
    finally { setBusy(null); }
  }

  async function runSync(kind: 'gmail' | 'calendar') {
    setBusy(kind);
    try {
      const res = kind === 'gmail' ? await apiSyncGmail(25) : await apiSyncCalendar(25);
      if (res) { setSync(res); flash(`Sourced ${res.sourced} · ${res.proposals.length} proposals awaiting approval.`); }
      else flash('Connect a platform API first (set VITE_API_URL).');
      await refresh();
    } catch (e) { flash(`Sync failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function proposeSend() {
    if (!draft.to.trim()) { flash('Add a recipient first.'); return; }
    setBusy('send');
    try {
      const r = await apiProposeSend('email', { to: [draft.to.trim()], subject: draft.subject, bodyText: draft.body });
      if (r) flash('Draft composed → pending in Approvals (external send needs your ≥ L2 approval).');
      else flash('Connect a platform API first (set VITE_API_URL).');
    } catch (e) { flash(`Draft failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  const connected = data?.connection.connected ?? false;
  const statusColor = connected
    ? 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/30'
    : 'text-[var(--color-warm-gray)] bg-[var(--color-surface)] border-[var(--color-border)]';
  const StatusIcon = connected ? CheckCircle : WifiOff;

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Breadcrumb */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--warning)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)]">Intelligence</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)]">Integrations</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--warning)]/10 text-[var(--warning)] px-2.5 py-0.5 rounded text-xs font-semibold">Gmail + Google Calendar</span>
        </div>
        <div className="h-11 flex items-center justify-between px-6">
          <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', statusColor)}>
            <StatusIcon className="w-3 h-3" />{connected ? 'Connected' : 'Not connected'}
          </span>
          <div className="flex items-center gap-2">
            {connected ? (
              <button onClick={disconnect} disabled={busy === 'disconnect'}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--danger)] border border-[var(--danger)]/30 px-3 py-1.5 rounded-lg hover:bg-[var(--danger)]/10 disabled:opacity-50">
                Disconnect
              </button>
            ) : (
              <button onClick={connect} disabled={busy === 'connect'}
                className="flex items-center gap-1.5 bg-[var(--warning)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50">
                <Globe className="w-3.5 h-3.5" /> Connect Google
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-8 py-10 flex flex-col gap-8 pb-32">

          {/* Hero */}
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-xl bg-[var(--warning)]/10 border border-[var(--warning)]/30 flex items-center justify-center shrink-0">
              <Mail className="w-7 h-7 text-[var(--warning)]" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-[var(--color-navy)] mb-1">Gmail + Google Calendar</h1>
              <p className="text-[var(--color-navy-mid)] text-sm max-w-2xl">
                Real OAuth, read <span className="font-semibold">and</span> write. Emails &amp; meetings become
                {' '}<span className="font-semibold">Touchpoints, Memories &amp; Signals</span> — sourced through the gate, fed to the graph
                {' '}by your approval. Sending is draft-then-approve. Bodies &amp; tokens live in the local plane; nothing private crosses to the cloud.
              </p>
            </div>
          </div>

          {!API_ENABLED && (
            <Banner tone="warn">
              The platform API isn’t connected. Set <code className="font-mono">VITE_API_URL</code> (e.g. http://localhost:4000) to enable real OAuth, sync, and send.
            </Banner>
          )}
          {data && !data.oauthConfigured && (
            <Banner tone="warn">
              Demo gateway active ({data.gatewayKind}). Set <code className="font-mono">GOOGLE_CLIENT_ID</code> / <code className="font-mono">GOOGLE_CLIENT_SECRET</code> on
              the API to connect a real Google account. Until then, no real Gmail/Calendar data is synced.
            </Banner>
          )}

          {/* Connection */}
          <Card title="Connection" icon={Lock}>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <Row k="Status" v={connected ? 'Connected' : 'Not connected'} />
              <Row k="Gateway" v={data ? (data.gatewayKind === 'google' ? 'googleapis (real)' : 'fake (demo)') : '—'} />
              <Row k="Token store" v="Local plane (pglite) — never Supabase" />
              <Row k="Connected at" v={data?.connection.connectedAt ?? '—'} />
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide mb-2">Granted scopes</div>
              <div className="flex flex-wrap gap-1.5">
                {(data?.connection.scopes ?? []).length === 0 && <span className="text-xs text-[var(--color-warm-gray)]">None yet</span>}
                {(data?.connection.scopes ?? []).map((s) => (
                  <span key={s} className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-navy-mid)]">
                    {s.replace('https://www.googleapis.com/auth/', '')}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          {/* READ pipeline */}
          <Card title="Read · source → propose (by approval)" icon={Inbox}>
            <p className="text-sm text-[var(--color-navy-mid)] mb-4">
              An egress agent sources threads &amp; events through the gate; bodies land in the local plane. Matches become
              {' '}Touchpoint/Memory proposals; uncertain matches file a <span className="font-medium">possible-duplicate Signal</span> (never auto-linked).
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => runSync('gmail')} disabled={!!busy}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[var(--color-navy)] px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                <RefreshCw className={clsx('w-3.5 h-3.5', busy === 'gmail' && 'animate-spin')} /> Sync Gmail
              </button>
              <button onClick={() => runSync('calendar')} disabled={!!busy}
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-navy)] border border-[var(--color-border)] px-3 py-2 rounded-lg hover:bg-[var(--color-surface)] disabled:opacity-50">
                <CalendarIcon className="w-3.5 h-3.5" /> Sync Calendar
              </button>
            </div>
            {sync && (
              <div className="mt-4 border border-[var(--color-border)] rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-[var(--color-surface)]/60 text-xs font-semibold text-[var(--color-navy-mid)] flex items-center justify-between">
                  <span>Sourced {sync.sourced} from {sync.source} · {sync.proposals.length} proposals</span>
                  <Link to="/approvals" className="text-[var(--color-steel)] hover:underline flex items-center gap-1">Review in Approvals <ArrowRight className="w-3 h-3" /></Link>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {sync.proposals.length === 0 && <div className="px-4 py-3 text-xs text-[var(--color-warm-gray)]">Nothing new — already intaken (idempotent).</div>}
                  {sync.proposals.map((p) => (
                    <div key={p.proposalId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <MatchBadge match={p.match} />
                      <span className="text-[var(--color-navy)] font-medium">{p.resource}</span>
                      <span className="text-xs text-[var(--color-warm-gray)] capitalize ml-auto">{p.resourceType} · {p.status.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* WRITE pipeline */}
          <Card title="Write · draft → approve → Gmail draft" icon={Send}>
            <p className="text-sm text-[var(--color-navy-mid)] mb-4">
              Composing is safe. The proposal lands in <Link to="/approvals" className="text-[var(--color-steel)] hover:underline">Approvals</Link>;
              {' '}on your approval (≥ L2) Bridge writes a <span className="font-medium">Gmail draft</span> — it never auto-sends, you press Send in Gmail.
              {' '}Agents can never reach Gmail on their own.
            </p>
            <div className="grid gap-2 max-w-xl">
              <input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="recipient@example.com"
                className="text-sm px-3 py-2 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-steel-light)]" />
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject"
                className="text-sm px-3 py-2 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-steel-light)]" />
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Write the draft…" rows={3}
                className="text-sm px-3 py-2 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-steel-light)] resize-none" />
              <button onClick={proposeSend} disabled={!!busy}
                className="self-start flex items-center gap-1.5 text-xs font-semibold text-white bg-[var(--warning)] px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Propose send (draft)
              </button>
            </div>
          </Card>

          {/* Governance */}
          {data && (
            <Card title="Governance · the gate" icon={ShieldCheck}>
              <div className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide mb-2">Capabilities</div>
              <div className="flex flex-col gap-1.5 mb-5">
                {data.manifest.capabilities.map((c) => (
                  <div key={`${c.resourceType}:${c.action}`} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-[var(--color-navy)]">{c.resourceType}:{c.action}</span>
                    <span className="text-xs text-[var(--color-warm-gray)]">scope={c.dataScope}</span>
                    {c.egress && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)]">egress · human-approved</span>}
                  </div>
                ))}
              </div>
              <div className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide mb-2">Output contract</div>
              <div className="flex flex-col gap-1.5">
                {data.manifest.output_contract.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-[var(--color-navy-mid)]">{o.from}</span>
                    <ArrowRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
                    <span className="font-semibold text-[var(--color-navy)]">{o.to}</span>
                    {o.note && <span className="text-xs text-[var(--color-warm-gray)]">— {o.note}</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-[var(--color-navy)] text-white text-sm shadow-lg max-w-md text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
        <Icon className="w-4 h-4 text-[var(--color-navy-mid)]" />
        <span className="font-semibold text-[var(--color-navy)] text-sm">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide w-28 shrink-0">{k}</span>
      <span className="text-sm text-[var(--color-navy-mid)] truncate">{v}</span>
    </div>
  );
}

function MatchBadge({ match }: { match: 'linked' | 'new' | 'ambiguous' }) {
  const map = {
    linked: ['Linked', 'text-[var(--success)] bg-[var(--success)]/10'],
    new: ['New', 'text-[var(--color-steel)] bg-[var(--color-steel)]/10'],
    ambiguous: ['Signal', 'text-[var(--warning)] bg-[var(--warning)]/10'],
  } as const;
  const [label, cls] = map[match];
  return <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded', cls)}>{label}</span>;
}

function Banner({ tone, children }: { tone: 'warn'; children: React.ReactNode }) {
  return (
    <div className={clsx('text-sm rounded-lg px-4 py-3 border', tone === 'warn' && 'bg-[var(--warning)]/10 border-[var(--warning)]/30 text-[var(--color-navy)]')}>
      {children}
    </div>
  );
}
