'use client';

import { useState } from 'react';
import type { HNIProfile, Signal, Field } from '@/lib/hni';
import type { DonorCard, FoundationCard } from '@/lib/discovery';
import { NTEE_LABELS } from '@/lib/discovery';

// ── Constants ─────────────────────────────────────────────────────────────────

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const STATE_NAMES: Record<string, string> = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

const CAUSE_OPTIONS = [
  { code: 'T', label: 'Philanthropy & Foundations' },
  { code: 'B', label: 'Education' },
  { code: 'E', label: 'Health Care' },
  { code: 'C', label: 'Environment' },
  { code: 'P', label: 'Human Services' },
  { code: 'A', label: 'Arts & Culture' },
  { code: 'Q', label: 'International Affairs' },
  { code: 'R', label: 'Civil Rights' },
  { code: 'G', label: 'Medical Research' },
  { code: 'U', label: 'Science & Technology' },
  { code: 'O', label: 'Youth Development' },
  { code: 'K', label: 'Food & Agriculture' },
  { code: 'L', label: 'Housing' },
  { code: 'X', label: 'Religion' },
];

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt$(n: number | undefined): string {
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(s: string | undefined): string {
  if (!s) return '—';
  return s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').slice(0, 10);
}

// ── Small components ──────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 'A' | 'B' | 'C' }) {
  return <span className={`tier tier-${tier}`}>{tier}</span>;
}

function CausePill({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, padding: '2px 8px',
      borderRadius: 999, background: '#1a1a3a', color: '#a5b4fc',
      border: '1px solid #3730a3', marginRight: 4, marginBottom: 4,
    }}>{label}</span>
  );
}

function AssetHistory({ history }: { history: { year: number; assets: number }[] }) {
  const max = Math.max(...history.map(h => h.assets));
  if (!max) return null;
  return (
    <div>
      <div className="fh-bar-wrap">
        {[...history].reverse().map(h => (
          <div key={h.year} className="fh-bar" style={{ height: `${Math.max(6, (h.assets / max) * 60)}px` }} title={`${h.year}: ${fmt$(h.assets)}`} />
        ))}
      </div>
      <div className="fh-labels">
        {[...history].reverse().map(h => <div key={h.year} className="fh-lbl">{h.year}</div>)}
      </div>
    </div>
  );
}

// ── Discovery cards ───────────────────────────────────────────────────────────

function DonorResultCard({ card, onProfile }: { card: DonorCard; onProfile: (name: string, state: string, company: string) => void }) {
  return (
    <div className="result-card">
      <div className="result-card-header">
        <div>
          <div className="result-name">{card.name}</div>
          {card.employer && <div className="result-sub">{card.employer} · {card.state}</div>}
        </div>
        <div className="result-amount">{fmt$(card.totalAmount)}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {card.contributionCount} FEC contribution{card.contributionCount !== 1 ? 's' : ''}
      </div>
      {card.causes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {card.causes.map(c => <CausePill key={c} label={c} />)}
        </div>
      )}
      {card.topRecipients.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          → {card.topRecipients.slice(0, 3).join(' · ')}
        </div>
      )}
      {Object.keys(card.decades ?? {}).length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {['2000s', '2010s', '2020s'].filter(d => card.decades[d]).map(d => (
            <span key={d} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#0f2a1a', color: '#4ade80', border: '1px solid #166534' }}>
              {d} {fmt$(card.decades[d])}
            </span>
          ))}
        </div>
      )}
      <button className="btn" style={{ fontSize: 12, padding: '6px 14px' }}
        onClick={() => onProfile(card.name, card.state, card.employer)}>
        Full Profile →
      </button>
    </div>
  );
}

function FoundationResultCard({ card, onProfile }: { card: FoundationCard; onProfile: (name: string, state: string, company: string) => void }) {
  return (
    <div className="result-card">
      <div className="result-card-header">
        <div style={{ flex: 1 }}>
          <div className="result-name" style={{ fontSize: 14 }}>{card.foundationName}</div>
          <div className="result-sub">{card.city}{card.city && card.state ? ', ' : ''}{card.state}</div>
        </div>
        <div className="result-amount">{fmt$(card.assets)}</div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <CausePill label={card.cause} />
        {card.nteeCode && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>NTEE {card.nteeCode}</span>}
      </div>
      {card.mission && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          {card.mission.slice(0, 120)}{card.mission.length > 120 ? '…' : ''}
        </div>
      )}
      {Object.keys(card.decadeAssets ?? {}).length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {['2000s', '2010s', '2020s'].filter(d => card.decadeAssets[d]).map(d => (
            <span key={d} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#0a1f2e', color: '#38bdf8', border: '1px solid #0369a1' }}>
              {d} {fmt$(card.decadeAssets[d])}
            </span>
          ))}
        </div>
      )}
      {card.principalOfficer ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Officer: </span>
            <span style={{ fontWeight: 600 }}>{card.principalOfficer}</span>
          </div>
          <button className="btn" style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => onProfile(card.principalOfficer, card.state, card.foundationName)}>
            Profile →
          </button>
        </div>
      ) : (
        <a href={`https://projects.propublica.org/nonprofits/organizations/${card.ein}`} target="_blank"
          style={{ fontSize: 12, color: 'var(--accent2)' }}>View on ProPublica →</a>
      )}
    </div>
  );
}

// ── Profile sub-components ────────────────────────────────────────────────────

function CompliancePill({ value }: { value: string }) {
  const cls = value === 'Clean' || value === 'No' ? 'clean' : value === 'Hit' || value === 'Yes' ? 'hit' : 'unknown';
  return <div className={`comp-val ${cls}`}>{value}</div>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

type DiscoveryTab = 'state' | 'cause';
type AppView = 'discover' | 'profile';
type Status = 'idle' | 'running' | 'done' | 'error';

export default function Home() {
  // Discovery state
  const [tab, setTab] = useState<DiscoveryTab>('state');
  const [stateCode, setStateCode] = useState('CA');
  const [nteeCode, setNteeCode] = useState('T');
  const [causeStateCode, setCauseStateCode] = useState('');
  const [discStatus, setDiscStatus] = useState<Status>('idle');
  const [discError, setDiscError] = useState('');
  const [donorResults, setDonorResults] = useState<DonorCard[]>([]);
  const [foundationResults, setFoundationResults] = useState<FoundationCard[]>([]);

  // Profile state
  const [view, setView] = useState<AppView>('discover');
  const [profStatus, setProfStatus] = useState<Status>('idle');
  const [profError, setProfError] = useState('');
  const [profile, setProfile] = useState<HNIProfile | null>(null);
  const [profName, setProfName] = useState('');

  // ── Discovery handlers ──────────────────────────────────────────────────────

  async function runStateDiscover(e: React.FormEvent) {
    e.preventDefault();
    setDiscStatus('running');
    setDiscError('');
    setDonorResults([]);
    try {
      const r = await fetch(`/api/discover/state?state=${encodeURIComponent(stateCode)}`);
      if (!r.ok) throw new Error(await r.text());
      setDonorResults(await r.json() as DonorCard[]);
      setDiscStatus('done');
    } catch (err) {
      setDiscError(String(err));
      setDiscStatus('error');
    }
  }

  async function runCauseDiscover(e: React.FormEvent) {
    e.preventDefault();
    setDiscStatus('running');
    setDiscError('');
    setFoundationResults([]);
    try {
      const qs = new URLSearchParams({ ntee: nteeCode });
      if (causeStateCode) qs.set('state', causeStateCode);
      const r = await fetch(`/api/discover/cause?${qs}`);
      if (!r.ok) throw new Error(await r.text());
      setFoundationResults(await r.json() as FoundationCard[]);
      setDiscStatus('done');
    } catch (err) {
      setDiscError(String(err));
      setDiscStatus('error');
    }
  }

  // ── Profile handler ─────────────────────────────────────────────────────────

  async function openProfile(name: string, state: string, company: string) {
    setProfName(name);
    setView('profile');
    setProfStatus('running');
    setProfError('');
    setProfile(null);
    try {
      const r = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), state: state || undefined, company: company || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      setProfile(await r.json() as HNIProfile);
      setProfStatus('done');
    } catch (err) {
      setProfError(String(err));
      setProfStatus('error');
    }
  }

  function backToDiscover() {
    setView('discover');
    setProfile(null);
    setProfStatus('idle');
  }

  // ── Profile accessors ───────────────────────────────────────────────────────

  const id = profile?.identity;
  const wealth = profile?.wealth;
  const pol = profile?.political;
  const found = profile?.foundations;
  const sec = profile?.securities;
  const reg = profile?.registration;
  const news = profile?.news;
  const comp = profile?.compliance;
  const signals = profile?.signals ?? [];
  const fields = profile?.fields ?? [];
  const steps = profile?.steps ?? [];
  const demCnt = pol?.contributions?.filter(c => ['ACTBLUE','DEMOCRAT'].some(k => c.committee.toUpperCase().includes(k))).reduce((s, c) => s + c.amount, 0) ?? 0;
  const repCnt = pol?.contributions?.filter(c => ['WINRED','REPUBLICAN'].some(k => c.committee.toUpperCase().includes(k))).reduce((s, c) => s + c.amount, 0) ?? 0;
  const totalPol = demCnt + repCnt;
  const demPct = totalPol ? Math.round((demCnt / totalPol) * 100) : 50;

  // ── Render: Discovery ───────────────────────────────────────────────────────

  if (view === 'discover') return (
    <>
      <div className="nav">
        <div className="nav-logo">HNI <span>Finder</span></div>
        <div className="nav-tag">Free sources only</div>
        <div className="nav-tag">FEC · 990-PF · EDGAR · FINRA</div>
      </div>

      {/* Mode tabs */}
      <div className="tab-row">
        <button className={`tab-btn${tab === 'state' ? ' active' : ''}`} onClick={() => { setTab('state'); setDiscStatus('idle'); setDiscError(''); }}>
          📍 By State
        </button>
        <button className={`tab-btn${tab === 'cause' ? ' active' : ''}`} onClick={() => { setTab('cause'); setDiscStatus('idle'); setDiscError(''); }}>
          🎯 By Cause
        </button>
      </div>

      {/* Filter form */}
      <div className="search-box">
        {tab === 'state' ? (
          <>
            <h2>Top political donors by state</h2>
            <form onSubmit={runStateDiscover}>
              <div className="form-grid">
                <div className="field">
                  <label>US State</label>
                  <select value={stateCode} onChange={e => setStateCode(e.target.value)} disabled={discStatus === 'running'}>
                    {US_STATES.map(s => <option key={s} value={s}>{STATE_NAMES[s] ?? s}</option>)}
                  </select>
                </div>
              </div>
              <div className="btn-row">
                <button type="submit" className="btn" disabled={discStatus === 'running'}>
                  {discStatus === 'running' ? 'Loading…' : 'Find HNI Donors'}
                </button>
                {discStatus === 'running' && <span className="status running">Querying FEC OpenData…</span>}
                {discStatus === 'error' && <span className="status err">{discError}</span>}
              </div>
            </form>
          </>
        ) : (
          <>
            <h2>Foundations & donors by cause</h2>
            <form onSubmit={runCauseDiscover}>
              <div className="form-grid">
                <div className="field">
                  <label>Cause / NTEE category</label>
                  <select value={nteeCode} onChange={e => setNteeCode(e.target.value)} disabled={discStatus === 'running'}>
                    {CAUSE_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>State (optional)</label>
                  <select value={causeStateCode} onChange={e => setCauseStateCode(e.target.value)} disabled={discStatus === 'running'}>
                    <option value="">All states</option>
                    {US_STATES.map(s => <option key={s} value={s}>{STATE_NAMES[s] ?? s}</option>)}
                  </select>
                </div>
              </div>
              <div className="btn-row">
                <button type="submit" className="btn" disabled={discStatus === 'running'}>
                  {discStatus === 'running' ? 'Loading…' : 'Find Foundations'}
                </button>
                {discStatus === 'running' && <span className="status running">Querying IRS 990-PF via ProPublica…</span>}
                {discStatus === 'error' && <span className="status err">{discError}</span>}
              </div>
            </form>
          </>
        )}
      </div>

      {/* Results */}
      {discStatus === 'done' && tab === 'state' && (
        <>
          <div className="results-header">
            <span>{donorResults.length} donors found in {STATE_NAMES[stateCode] ?? stateCode}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>FEC 2024 cycle · top by total contribution</span>
          </div>
          {donorResults.length === 0
            ? <div className="empty-state">No results — try a larger state or different cycle.</div>
            : <div className="results-grid">
                {donorResults.map((card, i) => (
                  <DonorResultCard key={i} card={card} onProfile={openProfile} />
                ))}
              </div>
          }
        </>
      )}

      {discStatus === 'done' && tab === 'cause' && (
        <>
          <div className="results-header">
            <span>{foundationResults.length} foundations · {NTEE_LABELS[nteeCode] ?? nteeCode}{causeStateCode ? ` · ${STATE_NAMES[causeStateCode] ?? causeStateCode}` : ''}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>IRS 990-PF via ProPublica · sorted by assets</span>
          </div>
          {foundationResults.length === 0
            ? <div className="empty-state">No results — try a different cause or remove the state filter.</div>
            : <div className="results-grid">
                {foundationResults.map((card, i) => (
                  <FoundationResultCard key={i} card={card} onProfile={openProfile} />
                ))}
              </div>
          }
        </>
      )}

      {discStatus === 'idle' && (
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, marginBottom: 6 }}>
            {tab === 'state'
              ? 'Pick a state and discover top HNI political donors + their causes'
              : 'Pick a cause to find the foundations and HNIs who fund it'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Click &ldquo;Full Profile&rdquo; on any result to run the 9-source deep enrichment
          </div>
        </div>
      )}
    </>
  );

  // ── Render: Profile ─────────────────────────────────────────────────────────

  return (
    <>
      <div className="nav">
        <div className="nav-logo">HNI <span>Finder</span></div>
        <div className="nav-tag">Free sources only</div>
        <button className="btn ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={backToDiscover}>
          ← Back to discovery
        </button>
      </div>

      {profStatus === 'running' && (
        <div className="search-box">
          <div style={{ fontSize: 15, marginBottom: 6 }}>Building profile for <strong>{profName}</strong>…</div>
          <div className="status running">Querying FEC · 990-PF · EDGAR · FINRA · OpenSanctions · CourtListener · GDELT · Wikidata…</div>
        </div>
      )}
      {profStatus === 'error' && (
        <div className="search-box"><div className="status err">{profError}</div></div>
      )}

      {profile && (
        <div className="profile">
          {/* Header */}
          <div className="section">
            <div className="sec-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{id?.fullName ?? profName}</div>
                {id?.description && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, maxWidth: 640 }}>{id.description.slice(0, 220)}{id.description.length > 220 ? '…' : ''}</div>}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {id?.dob && <span className="tier tier-A">DOB {id.dob.slice(0, 10)}</span>}
                  {id?.age && <span className="tier tier-A">Age {id.age}</span>}
                  {id?.citizenship && <span className="tier tier-B">{id.citizenship}</span>}
                  {id?.wikidataQid && <a className="tier tier-B" href={`https://www.wikidata.org/wiki/${id.wikidataQid}`} target="_blank">Wikidata {id.wikidataQid}</a>}
                </div>
              </div>
            </div>
          </div>

          {/* Wealth */}
          {(wealth?.netWorthEstimate || wealth?.accreditedInvestor) && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">💰</span><span className="sec-title">Wealth</span></div>
              <div className="sec-body">
                <div className="wealth-grid">
                  {wealth.netWorthEstimate && (
                    <div className="wealth-card">
                      <div className="wealth-label">Estimated net worth</div>
                      <div className="wealth-val">{wealth.netWorthEstimate}</div>
                      {wealth.netWorthRank && <div className="wealth-sub">Global rank {wealth.netWorthRank}</div>}
                    </div>
                  )}
                  {wealth.accreditedInvestor && (
                    <div className="wealth-card">
                      <div className="wealth-label">Investor classification</div>
                      <div className="wealth-val" style={{ fontSize: 16 }}>
                        {wealth.accreditedInvestor !== 'Unknown' && <div>Accredited: <span style={{ color: wealth.accreditedInvestor === 'Yes' ? 'var(--good)' : 'var(--warn)' }}>{wealth.accreditedInvestor}</span></div>}
                        {wealth.qualifiedPurchaser !== 'Unknown' && <div>QP: <span style={{ color: wealth.qualifiedPurchaser === 'Yes' ? 'var(--good)' : 'var(--warn)' }}>{wealth.qualifiedPurchaser}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Signals */}
          {signals.length > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">⚡</span><span className="sec-title">Signals</span><span className="sec-count">{signals.length}</span></div>
              <div className="sec-body">
                {signals.map((s: Signal, i) => (
                  <div key={i} className="signal">
                    <TierBadge tier={s.tier} />
                    <div className="signal-body">
                      <div className="signal-label">{s.url ? <a href={s.url} target="_blank">{s.label}</a> : s.label}</div>
                      <div className="signal-detail">{s.detail}</div>
                      <div className="signal-source">{s.source}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Foundations */}
          {(found?.foundations?.length ?? 0) > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">🏛</span><span className="sec-title">Foundations (IRS 990-PF)</span><span className="sec-count">{found!.foundations.length}</span></div>
              <div className="sec-body">
                {found!.foundations.map(f => (
                  <div key={f.ein} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                      <div>
                        <a href={`https://projects.propublica.org/nonprofits/organizations/${f.ein}`} target="_blank" style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</a>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>EIN {f.ein} · {f.city}, {f.state}</div>
                      </div>
                      <span className="tier tier-A">IRS 990-PF</span>
                    </div>
                    <div className="kv-table">
                      {f.totalAssets && <div className="kv-row"><div className="kv-k">Total assets ({f.taxYear})</div><div className="kv-v" style={{ fontWeight: 600 }}>{fmt$(f.totalAssets)}</div></div>}
                      {f.totalRevenue && <div className="kv-row"><div className="kv-k">Total revenue</div><div className="kv-v">{fmt$(f.totalRevenue)}</div></div>}
                      {f.grantsPaid && <div className="kv-row"><div className="kv-k">Grants paid</div><div className="kv-v">{fmt$(f.grantsPaid)}</div></div>}
                    </div>
                    {f.filingHistory.length > 1 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>Asset trend</div>
                        <AssetHistory history={f.filingHistory} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Political */}
          {pol && pol.contributionCount > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">🗳</span><span className="sec-title">Political Contributions (FEC)</span></div>
              <div className="sec-body">
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Total matched</div><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent2)' }}>{fmt$(pol.totalContributions)}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{pol.contributionCount} contributions</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Ideology</div><div style={{ fontSize: 14, marginTop: 4 }}>{pol.ideology}</div></div>
                </div>
                {totalPol > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>D ← → R</div>
                    <div className="pol-bar" style={{ display: 'flex' }}>
                      <div className="pol-fill-d" style={{ width: `${demPct}%` }} />
                      <div className="pol-fill-r" style={{ width: `${100 - demPct}%` }} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Top recipients</div>
                <table className="tbl">
                  <thead><tr><th>Committee</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {pol.topRecipients.slice(0, 8).map((r, i) => (
                      <tr key={i}><td>{r.name}</td><td style={{ textAlign: 'right' }}>{fmt$(r.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* EDGAR */}
          {(sec?.filings?.length ?? 0) > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">📋</span><span className="sec-title">SEC EDGAR Filings</span><span className="sec-count">{sec!.filings.length}</span></div>
              <div className="sec-body">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Form</th><th>Entity</th></tr></thead>
                  <tbody>
                    {sec!.filings.slice(0, 12).map((f, i) => (
                      <tr key={i}><td>{f.date}</td><td><span className="tier tier-A">{f.form}</span></td><td>{f.entity}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Registration */}
          {(reg?.finra || reg?.iapd) && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">🔖</span><span className="sec-title">Registration (FINRA / IAPD)</span></div>
              <div className="sec-body">
                {reg.finra && (
                  <div className="kv-table" style={{ marginBottom: 12 }}>
                    <div className="kv-row"><div className="kv-k">FINRA CRD</div><div className="kv-v"><a href={reg.finra.url} target="_blank">{reg.finra.crd}</a></div></div>
                    <div className="kv-row"><div className="kv-k">Firm</div><div className="kv-v">{reg.finra.firm ?? '—'}</div></div>
                    <div className="kv-row"><div className="kv-k">Disclosures</div><div className="kv-v" style={{ color: reg.finra.disclosures ? 'var(--bad)' : 'var(--good)' }}>{reg.finra.disclosures ? `${reg.finra.disclosures} on record` : 'None'}</div></div>
                  </div>
                )}
                {reg.iapd && (
                  <div className="kv-table">
                    <div className="kv-row"><div className="kv-k">IAPD</div><div className="kv-v"><a href={reg.iapd.url} target="_blank">{reg.iapd.name}</a></div></div>
                    <div className="kv-row"><div className="kv-k">Firm</div><div className="kv-v">{reg.iapd.firm ?? '—'}</div></div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compliance */}
          {comp && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">🛡</span><span className="sec-title">Compliance & Risk</span></div>
              <div className="sec-body">
                <div className="comp-grid" style={{ marginBottom: 16 }}>
                  <div className="comp-card"><div className="comp-label">OFAC</div><CompliancePill value={comp.ofac} /></div>
                  <div className="comp-card"><div className="comp-label">PEP</div><CompliancePill value={comp.pep} /></div>
                  <div className="comp-card"><div className="comp-label">Watchlists</div><CompliancePill value={comp.watchlists} /></div>
                </div>
                {comp.litigation.count > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--warn)' }}>{comp.litigation.count} federal case(s) — verify parties</div>
                )}
              </div>
            </div>
          )}

          {/* News */}
          {(news?.items?.length ?? 0) > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">📰</span><span className="sec-title">News (GDELT, last 180 days)</span><span className="sec-count">{news!.items.length}</span></div>
              <div className="sec-body">
                {news!.items.map((item, i) => (
                  <div key={i} className="news-item">
                    <div className="news-date">{fmtDate(item.date)} · {item.domain}</div>
                    <div className="news-title">{item.url ? <a href={item.url} target="_blank">{item.title}</a> : item.title}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All fields */}
          {fields.length > 0 && (
            <div className="section">
              <div className="sec-head"><span className="sec-icon">📊</span><span className="sec-title">All extracted fields</span><span className="sec-count">{fields.length}</span></div>
              <div className="sec-body">
                <table className="tbl">
                  <thead><tr><th>Tier</th><th>Field</th><th>Value</th><th>Source</th></tr></thead>
                  <tbody>
                    {fields.map((f: Field, i) => (
                      <tr key={i}>
                        <td><TierBadge tier={f.tier} /></td>
                        <td style={{ color: 'var(--muted)' }}>{f.label}</td>
                        <td>{f.url ? <a href={f.url} target="_blank">{f.value}</a> : f.value}</td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step log */}
          <div className="section">
            <div className="sec-body">
              <details>
                <summary>Step log ({steps.length} sources queried)</summary>
                <div style={{ marginTop: 8 }}>
                  {steps.map((s, i) => (
                    <div key={i} className="step">
                      <span className={s.ok ? 'ok' : 'no'}>{s.ok ? '✓' : '✗'}</span>
                      <span>{s.label}</span>
                      {s.detail && <span className="step-detail">{s.detail}</span>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
