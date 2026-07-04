import { useCallback, useEffect, useState } from 'react';
import { Briefcase, Mail, Ban, RefreshCw, Plus } from 'lucide-react';
import { dummy_dealCandidates, formatMoney, TRIAGE_COLUMNS, type DealCandidate } from '../data/dealpilot';
import {
  API_ENABLED,
  apiDealPilotCommit,
  apiDealPilotList,
  apiDealPilotSource,
  type DealPilotCapturePreview,
} from '../data/api';

// A quarantined-but-not-yet-committed listing (capture ≠ commit). Only the sourcing skill's
// light manifest is available client-side — id + a preview, never the full payload.
interface PendingCapture {
  captureId: string;
  preview: DealPilotCapturePreview;
}

function toDealCandidate(row: { id: string; profile: DealPilotCapturePreview; fit: { score: number; triage: DealCandidate['triage']; reasons: string[] } }): DealCandidate {
  return {
    id: row.id,
    name: row.profile.name ?? '(unnamed listing)',
    industry: row.profile.industry ?? '—',
    geo: row.profile.geo ?? '—',
    askPrice: row.profile.askPrice,
    revenue: row.profile.revenue,
    sde: row.profile.sde,
    source: 'bizbuysell', // only live connector wired so far (BusinessBroker.net blocked by robots.txt)
    triage: row.fit.triage,
    score: row.fit.score,
    reasons: row.fit.reasons,
  };
}

function DealCard({ deal }: { deal: DealCandidate }) {
  return (
    <div
      className="rounded-xl border bg-white p-3 flex flex-col gap-2"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm" style={{ color: 'var(--color-navy)' }}>{deal.name}</div>
        <div
          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-navy) 8%, white)', color: 'var(--color-navy)' }}
          title="ThesisFit score"
        >
          {Math.round(deal.score * 100)}%
        </div>
      </div>
      <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{deal.industry} · {deal.geo}</div>
      <div className="flex gap-3 text-xs" style={{ color: 'var(--color-navy)' }}>
        <span title="Asking price">Ask {formatMoney(deal.askPrice)}</span>
        <span title="Gross revenue">Rev {formatMoney(deal.revenue)}</span>
        <span title="Seller discretionary earnings">SDE {formatMoney(deal.sde)}</span>
      </div>
      <ul className="text-[11px] list-disc list-inside" style={{ color: 'var(--color-warm-gray)' }}>
        {deal.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
        via {deal.source === 'bizbuysell' ? 'BizBuySell alert' : 'BusinessBroker.net'}
      </div>
    </div>
  );
}

function ConnectorStatus() {
  return (
    <div className="flex items-stretch rounded-xl border overflow-hidden shrink-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 pl-3 pr-3.5 py-1.5 bg-white" title="Sources from the user's own Gmail via the governed Google integration">
        <Mail className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} />
        <div className="leading-tight">
          <div className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>BizBuySell</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>alert-email connector</div>
        </div>
      </div>
      <div className="w-px" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="flex items-center gap-2 pl-3 pr-3.5 py-1.5 bg-white" title="Live fetch blocked: robots.txt disallows the listing/search paths; no partner feed yet">
        <Ban className="w-4 h-4 shrink-0" style={{ color: 'var(--danger)' }} />
        <div className="leading-tight">
          <div className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>BusinessBroker.net</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>blocked — needs partner feed</div>
        </div>
      </div>
    </div>
  );
}

/** The quarantine inbox: sourced-but-uncommitted listings, each needing a human "Add". */
function PendingInbox({ pending, onAdd, adding }: { pending: PendingCapture[]; onAdd: (id: string) => void; adding: string | null }) {
  if (pending.length === 0) return null;
  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--warning) 6%, white)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-navy)' }}>
        Quarantined — {pending.length} sourced, not yet added
      </div>
      <div className="flex flex-col gap-2">
        {pending.map((p) => (
          <div key={p.captureId} className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-xs" style={{ color: 'var(--color-navy)' }}>
              {p.preview.name ?? '(unnamed listing)'}
              <span style={{ color: 'var(--color-warm-gray)' }}> · {p.preview.industry ?? '—'} · {p.preview.geo ?? '—'}</span>
            </div>
            <button
              onClick={() => onAdd(p.captureId)}
              disabled={adding === p.captureId}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-navy)', color: 'white' }}
            >
              <Plus className="w-3 h-3" /> {adding === p.captureId ? 'Adding…' : 'Add'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DealPilotPage() {
  const [deals, setDeals] = useState<DealCandidate[]>(dummy_dealCandidates);
  const [pending, setPending] = useState<PendingCapture[]>([]);
  const [sourcing, setSourcing] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!API_ENABLED) return;
    const rows = await apiDealPilotList();
    if (rows) setDeals(rows.map(toDealCandidate));
  }, []);

  useEffect(() => {
    if (API_ENABLED) refreshList();
  }, [refreshList]);

  const handleSource = useCallback(async () => {
    if (!API_ENABLED) return;
    setSourcing(true);
    setError(null);
    try {
      const result = await apiDealPilotSource();
      if (result) {
        setPending((prev) => [
          ...prev,
          ...result.captureIds.map((captureId, i) => ({ captureId, preview: result.sample[i] ?? {} })),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to source listings');
    } finally {
      setSourcing(false);
    }
  }, []);

  const handleAdd = useCallback(async (captureId: string) => {
    setAdding(captureId);
    setError(null);
    try {
      const ok = await apiDealPilotCommit(captureId);
      if (ok) {
        setPending((prev) => prev.filter((p) => p.captureId !== captureId));
        await refreshList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add listing');
    } finally {
      setAdding(null);
    }
  }, [refreshList]);

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5" style={{ color: 'var(--color-navy)' }} />
          <div>
            <div className="font-bold text-lg" style={{ color: 'var(--color-navy)' }}>DealPilot</div>
            <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>
              Thesis-scored triage over sourced business-for-sale listings
              {!API_ENABLED && ' (demo data — connect the platform API for live sourcing)'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectorStatus />
          {API_ENABLED && (
            <button
              onClick={handleSource}
              disabled={sourcing}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg shrink-0 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-navy)', color: 'white' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sourcing ? 'animate-spin' : ''}`} />
              {sourcing ? 'Sourcing…' : 'Source new listings'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, white)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <PendingInbox pending={pending} onAdd={handleAdd} adding={adding} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TRIAGE_COLUMNS.map((col) => {
          const colDeals = deals.filter((d) => d.triage === col.id);
          return (
            <div key={col.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-navy)' }}>
                  {col.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>({colDeals.length})</span>
              </div>
              <div className="flex flex-col gap-3">
                {colDeals.map((deal) => <DealCard key={deal.id} deal={deal} />)}
                {colDeals.length === 0 && (
                  <div className="text-xs italic px-1" style={{ color: 'var(--color-warm-gray)' }}>No deals in this state.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
