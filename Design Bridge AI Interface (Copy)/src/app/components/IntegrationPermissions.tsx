// Integration Permissions — the governed scope editor for a social integration.
//
// view / grant / narrow each capability, wired to the tRPC `integration` router via
// data/integrations.ts. external:send + network_graph:full render as locked "always requires
// approval" rows — agent-floor DENY, never a standing grant. Offline (API OFF) it drives the
// in-memory governed mirror so the panel is fully interactive in the prototype.
import { useEffect, useMemo, useState } from 'react';
import { Shield, ShieldCheck, Lock, Plus, Minus, AlertTriangle, Loader2, Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import {
  SocialProvider,
  ScopeGrant,
  GrantableScope,
  APPROVAL_ONLY_SCOPES,
  getScopesClient,
  isFloorScopeError,
} from '../data/integrations';

const scopeKey = (resourceType: string, action: string) => `${resourceType}:${action}`;

export function IntegrationPermissions({ provider, integrationId }: { provider: SocialProvider; integrationId: string }) {
  const client = useMemo(() => getScopesClient(provider, integrationId), [provider, integrationId]);
  const [scopes, setScopes] = useState<ScopeGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // scopeKey or grant.id currently mutating
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    client
      .list()
      .then((s) => alive && setScopes(s))
      .catch(() => alive && setNotice({ kind: 'error', text: 'Could not load permissions.' }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [client]);

  const grantedKeys = useMemo(() => new Set(scopes.map((s) => scopeKey(s.resourceType, s.action))), [scopes]);
  const grantable = provider.grantableScopes;
  const ungranted = grantable.filter((g) => !grantedKeys.has(scopeKey(g.resourceType, g.action)));

  async function grant(g: GrantableScope) {
    const key = scopeKey(g.resourceType, g.action);
    setBusy(key);
    setNotice(null);
    try {
      const created = await client.grant(g.resourceType, g.action);
      setScopes((prev) => [...prev, created]);
    } catch (err) {
      setNotice(
        isFloorScopeError(err)
          ? { kind: 'error', text: `"${g.label}" always requires approval — it can't be a standing grant.` }
          : { kind: 'error', text: err instanceof Error ? err.message : 'Grant failed.' },
      );
    } finally {
      setBusy(null);
    }
  }

  async function revoke(grant: ScopeGrant) {
    setBusy(grant.id);
    setNotice(null);
    try {
      await client.revoke(grant.id);
      setScopes((prev) => prev.filter((s) => s.id !== grant.id));
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Revoke failed.' });
    } finally {
      setBusy(null);
    }
  }

  const labelFor = (s: ScopeGrant) =>
    grantable.find((g) => g.resourceType === s.resourceType && g.action === s.action)?.label ??
    scopeKey(s.resourceType, s.action);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-steel)]/10 border border-[var(--color-steel)]/30 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-[var(--color-steel)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[var(--color-navy)] text-sm">Permissions</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/30">
                <ShieldCheck className="w-3 h-3" /> Governed
              </span>
            </div>
            <p className="text-xs text-[var(--color-navy-mid)] mt-0.5 max-w-xl">
              What {provider.label} may do inside Bridge. Grants take effect immediately and are revocable. Egress
              (posting, sending, full-graph reads) can never be a standing grant — it is always reviewed per action.
            </p>
          </div>
        </div>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border shrink-0',
            client.live
              ? 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/30'
              : 'text-[var(--color-warm-gray)] bg-[var(--color-surface)] border-[var(--color-border)]',
          )}
          title={client.live ? 'Connected to the governed API' : 'Local preview — wire VITE_API_URL for the live store'}
        >
          {client.live ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {client.live ? 'Live API' : 'Local preview'}
        </span>
      </div>

      {notice && (
        <div
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium border',
            notice.kind === 'error'
              ? 'text-[var(--danger)] bg-[var(--danger)]/10 border-[var(--danger)]/30'
              : 'text-[var(--color-steel)] bg-[var(--color-steel)]/5 border-[var(--color-steel)]/20',
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {notice.text}
        </div>
      )}

      {/* OAuth scopes — platform-declared, informational */}
      <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
          <Lock className="w-4 h-4 text-[var(--color-navy-mid)]" />
          <span className="font-semibold text-[var(--color-navy)] text-sm">OAuth scopes granted at connect</span>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-2">
          {provider.oauthScopes.map((s) => (
            <span key={s} className="px-2.5 py-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-navy-mid)]">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Granted Bridge capabilities */}
      <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
          <span className="font-semibold text-[var(--color-navy)] text-sm">Granted in Bridge</span>
          <span className="ml-auto text-xs text-[var(--color-warm-gray)]">{scopes.length} active</span>
        </div>
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center text-[var(--color-warm-gray)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : scopes.length === 0 ? (
          <div className="px-5 py-6 text-xs text-[var(--color-warm-gray)]">No standing grants. {provider.label} can do nothing until you grant a capability below.</div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {scopes.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--success)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-navy)]">{labelFor(s)}</div>
                  <div className="text-xs font-mono text-[var(--color-warm-gray)]">{scopeKey(s.resourceType, s.action)}</div>
                </div>
                <button
                  onClick={() => revoke(s)}
                  disabled={busy === s.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
                >
                  {busy === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Minus className="w-3.5 h-3.5" />} Narrow
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant a capability */}
      {ungranted.length > 0 && (
        <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[var(--color-steel)]" />
            <span className="font-semibold text-[var(--color-navy)] text-sm">Grant a capability</span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {ungranted.map((g) => (
              <div key={scopeKey(g.resourceType, g.action)} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-navy)]">{g.label}</div>
                  <div className="text-xs text-[var(--color-navy-mid)]">{g.desc}</div>
                </div>
                <button
                  onClick={() => grant(g)}
                  disabled={busy === scopeKey(g.resourceType, g.action)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--color-steel)] border border-[var(--color-steel)]/30 rounded-lg hover:bg-[var(--color-steel)]/10 transition-colors disabled:opacity-50"
                >
                  {busy === scopeKey(g.resourceType, g.action) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Grant
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Always requires approval — locked, non-grantable */}
      <div className="bg-white border border-[var(--warning)]/30 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[var(--warning)]/30 bg-[var(--warning)]/5 flex items-center gap-2">
          <Lock className="w-4 h-4 text-[var(--warning)]" />
          <span className="font-semibold text-[var(--color-navy)] text-sm">Always requires approval</span>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-[var(--warning)]">Agent-floor DENY</span>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {APPROVAL_ONLY_SCOPES.map((g) => (
            <div key={scopeKey(g.resourceType, g.action)} className="flex items-center gap-3 px-5 py-3.5 opacity-90">
              <Lock className="w-3.5 h-3.5 text-[var(--warning)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-navy)]">{g.label}</div>
                <div className="text-xs text-[var(--color-navy-mid)]">{g.desc}</div>
                <div className="text-xs font-mono text-[var(--color-warm-gray)] mt-0.5">{scopeKey(g.resourceType, g.action)}</div>
              </div>
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--color-warm-gray)] border border-[var(--color-border)] rounded-lg cursor-not-allowed bg-[var(--color-surface)]">
                <Lock className="w-3.5 h-3.5" /> Per-action only
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
