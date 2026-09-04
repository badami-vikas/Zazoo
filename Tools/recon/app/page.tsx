'use client';

import { useEffect, useState } from 'react';
import type { Identity, IdentityIdentifiers, ReconInput, ReconReport, StepLog, Field, SubjectReport } from '@/lib/recon';
import { mapReportToCapture, addToBridge } from '@/lib/bridge';
import { canonicalSocialUrl } from '@/lib/url-canon';

type Phase = 'input' | 'verify' | 'report';

interface StoreStatus {
  stagingCount: number;
  permanentCount: number;
  subjectCount: number;
  threshold: number;
  needsApproval: boolean;
}

// Normalise a name for token-overlap checks (mirrors recon.ts `norm`)
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/** Returns true when a candidate's name shares no tokens with the query — likely wrong entity. */
function nameMismatch(queryName: string, candidateName: string): boolean {
  const q = normName(queryName).split(/\s+/).filter((t) => t.length > 2);
  if (!q.length) return false;
  const c = new Set(normName(candidateName).split(/\s+/));
  return q.every((t) => !c.has(t));
}

interface StagingRow {
  id: string;
  subjectName: string;
  scope: 'person' | 'company' | 'signal';
  tier: string;
  source: string;
  label: string;
  value: string;
  url?: string;
  eid: string;
  confidence: number;
  discoveredAt?: string;
  verificationState?: 'found' | 'probable' | 'verified' | 'rejected';
}

function eidStyle(eid: string): { background: string; color: string; border: string } {
  if (eid === '?') return { background: 'transparent', color: '#6e7681', border: '1px solid #30363d' };
  if (eid.endsWith('-co')) return { background: '#1a0d2e', color: '#8957e5', border: '1px solid #8957e5' };
  if (eid.endsWith('-1')) return { background: '#071d38', color: '#1f6feb', border: '1px solid #1f6feb' };
  if (eid.endsWith('-2')) return { background: '#2d1f00', color: '#e09b31', border: '1px solid #e09b31' };
  if (eid.endsWith('-3')) return { background: '#1e0f3d', color: '#bc8cff', border: '1px solid #bc8cff' };
  if (eid.endsWith('-4')) return { background: '#2d0f0e', color: '#f85149', border: '1px solid #f85149' };
  // custom firm names (coinbase, a16z, stripe…) — purple
  return { background: '#1a0d2e', color: '#8957e5', border: '1px solid #8957e5' };
}

function host(u: string): string {
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

// ── Confidence scores (mirrors store.ts sourceConfidence — client-side copy) ──
function fieldConfidence(source: string, tier: string): number {
  const map: Record<string, number> = {
    'OFAC': 0.99, 'SEC EDGAR': 0.97, 'FINRA': 0.96, 'IAPD': 0.96,
    'USAspending': 0.94, 'Wikipedia': 0.93, 'Wikidata': 0.91,
    'State SoS': 0.89, 'State UCC': 0.87, 'CourtListener': 0.85, 'DNS': 0.85,
    'JSON-LD': 0.83, 'Web (LinkedIn)': 0.83, 'LinkedIn': 0.83, 'GitHub': 0.81,
    'Greenhouse': 0.80, 'Site fingerprint': 0.78, 'OpenAlex': 0.77, 'ORCID': 0.77,
    'Semantic Scholar': 0.75, 'WhatsMyName': 0.75, 'reuters.com': 0.75,
    'nytimes.com': 0.73, 'wsj.com': 0.73, 'HN': 0.72, 'Email inference': 0.70,
    'GDELT, Google News': 0.70, 'Google News': 0.70, 'Web': 0.68,
    'businesswire.com': 0.68, 'forbes.com': 0.66, 'cnbc.com': 0.66,
    'techcrunch.com': 0.65, 'Google Patents': 0.40, 'Google Scholar': 0.40,
    'OpenCorporates': 0.42,
  };
  if (map[source] !== undefined) return map[source];
  if (tier === 'A') return 0.80;
  if (tier === 'B') return 0.60;
  return 0.35;
}

function platformUrl(platform: string, handle: string): string | null {
  const p = platform.toLowerCase().replace(/[\s.\-]/g, '');
  const h = handle.replace(/^@/, '');
  if (!h || h.length < 2) return null;
  const routes: Record<string, string> = {
    github: `https://github.com/${h}`,
    twitter: `https://twitter.com/${h}`,
    x: `https://twitter.com/${h}`,
    instagram: `https://instagram.com/${h}`,
    linkedin: `https://linkedin.com/in/${h}`,
    huggingface: `https://huggingface.co/${h}`,
    kaggle: `https://kaggle.com/${h}`,
    youtube: `https://youtube.com/@${h}`,
    tiktok: `https://tiktok.com/@${h}`,
    twitch: `https://twitch.tv/${h}`,
    soundcloud: `https://soundcloud.com/${h}`,
    flickr: `https://flickr.com/people/${h}`,
    vimeo: `https://vimeo.com/${h}`,
    reddit: `https://reddit.com/u/${h}`,
    producthunt: `https://producthunt.com/@${h}`,
    medium: `https://medium.com/@${h}`,
    devto: `https://dev.to/${h}`,
    substack: `https://${h}.substack.com`,
    patreon: `https://patreon.com/${h}`,
    keybase: `https://keybase.io/${h}`,
  };
  return routes[p] ?? null;
}

type RichField = Omit<Field, 'kind'> & { kind?: 'fact' | 'signal' | 'news-merged' | 'accounts-merged' };

function isPointerOnly(f: Field): boolean {
  if (f.tier !== 'C') return false;
  const searchUrls = ['scholar.google.com/scholar?', 'patents.google.com/?inventor', 'opencorporates.com/officers?q='];
  return searchUrls.some((p) => (f.url ?? '').includes(p)) ||
    f.value.toLowerCase().startsWith('search ') ||
    f.value.toLowerCase().includes('no api');
}

function preprocessSection(fields: Field[]): RichField[] {
  const filtered = fields.filter((f) => !isPointerOnly(f));
  const newsFields = filtered.filter((f) => f.source.includes('News') || f.source === 'HN');
  const accountFields = filtered.filter(
    (f) => f.source === 'WhatsMyName' || f.label.startsWith('Account —'),
  );
  const other = filtered.filter((f) => !newsFields.includes(f) && !accountFields.includes(f));

  const result: RichField[] = [...other];

  const topNews = newsFields.slice(0, 3); // cap at 3 most recent (source order = date-desc from GDELT)
  if (topNews.length > 1) {
    result.push({
      label: `Recent news (${topNews.length} items)`,
      value: topNews.map((f) => f.value).join(' · '),
      tier: 'B',
      source: [...new Set(topNews.map((f) => f.source))].join(', '),
      kind: 'news-merged',
    });
  } else if (topNews.length === 1) {
    result.push(topNews[0]);
  }

  if (accountFields.length > 1) {
    const handles = accountFields.map((f) => {
      const plat = f.label.startsWith('Account —') ? f.label.replace('Account — ', '').trim() : f.source;
      return `${plat}: ${f.value}`;
    });
    result.push({
      label: `Social accounts (${accountFields.length})`,
      value: handles.join(' · '),
      tier: 'B',
      source: 'WhatsMyName',
      kind: 'accounts-merged',
    });
  } else if (accountFields.length === 1) {
    result.push(accountFields[0]);
  }

  return result;
}

interface PersonSummary {
  name: string;
  avgConf: number;
  targetEid: string;
  bio?: StagingRow;
  linkedin?: StagingRow;
  github?: StagingRow;
  newsRows: StagingRow[];
  accountRows: StagingRow[];
  activityRows: StagingRow[];
  signals: StagingRow[];
  collisionEids: string[];
  allRowIds: string[];
}

function buildPersonSummaries(rows: StagingRow[]): PersonSummary[] {
  const groups = new Map<string, StagingRow[]>();
  for (const r of rows) {
    if (!groups.has(r.subjectName)) groups.set(r.subjectName, []);
    groups.get(r.subjectName)!.push(r);
  }
  return [...groups.entries()].map(([name, subRows]) => {
    const targetRows = subRows.filter((r) => r.eid.endsWith('-1'));
    const avgConf = targetRows.length
      ? Math.round(targetRows.reduce((s, r) => s + (r.confidence ?? 0.5), 0) / targetRows.length * 100)
      : 50;
    const find = (pred: (r: StagingRow) => boolean) => subRows.find(pred);
    return {
      name,
      avgConf,
      targetEid: targetRows[0]?.eid ?? '?',
      bio: find((r) => (r.source === 'Wikipedia' || r.source === 'Wikidata') && r.scope === 'person'),
      linkedin: find((r) => r.source.includes('LinkedIn') && !!r.url),
      github: find((r) => r.source === 'GitHub' && !!r.url),
      newsRows: subRows
        .filter((r) => r.source.includes('News') || (r.source === 'HN' && r.scope === 'person'))
        .sort((a, b) => (b.discoveredAt ?? '').localeCompare(a.discoveredAt ?? ''))
        .slice(0, 3),
      accountRows: subRows.filter((r) =>
        r.source === 'WhatsMyName' || r.label.startsWith('Account —') || r.label.startsWith('Social accounts'),
      ),
      activityRows: subRows.filter((r) =>
        ['HN', 'Reddit', 'Twitter mentions', 'Mastodon', 'Bluesky'].includes(r.source) ||
        ['Hacker News', 'Reddit mention', 'Blog post', 'Article', 'Social link'].some((l) => r.label.startsWith(l)) ||
        (r.label === 'Social links (site)') ||
        (r.url && /\/(p|reel|reels|video|watch|post|status|shorts)\//.test(r.url)),
      ).slice(0, 6),
      signals: subRows.filter((r) => r.scope === 'signal'),
      collisionEids: [...new Set(
        subRows.map((r) => r.eid).filter((e) => e !== '?' && !e.endsWith('-1') && !e.endsWith('-co')),
      )],
      allRowIds: subRows.map((r) => r.id),
    };
  });
}

/** Validate that a URL actually looks like a direct profile URL for the given platform. */
function isValidProfileUrl(platform: string, url: string, handle: string): boolean {
  try {
    const u = new URL(url);
    const h = handle.replace(/^@/, '').toLowerCase();
    const p = platform.toLowerCase().replace(/[\s.\-]/g, '');
    // Strip query params for path check
    const path = u.pathname.replace(/\/$/, '').toLowerCase();
    const expectedSuffix = `/${h}`;
    switch (p) {
      case 'github':
        return u.hostname === 'github.com' && path === expectedSuffix && /^[a-z0-9-]+$/.test(h) && h.length <= 39;
      case 'twitter': case 'x':
        return (u.hostname === 'twitter.com' || u.hostname === 'x.com') && path === expectedSuffix && /^[a-z0-9_]{1,15}$/.test(h);
      case 'instagram':
        return u.hostname.includes('instagram.com') && path === expectedSuffix && /^[a-z0-9._]{1,30}$/.test(h);
      case 'linkedin':
        return u.hostname.includes('linkedin.com') && u.pathname.startsWith('/in/') && u.pathname.length > 4;
      case 'tiktok':
        return u.hostname.includes('tiktok.com') && /^[a-z0-9._-]{2,24}$/.test(h);
      case 'youtube':
        return u.hostname === 'youtube.com' && /^[a-z0-9_-]{3,30}$/.test(h);
      case 'reddit':
        return u.hostname === 'reddit.com' && /^\/(u|user)\//.test(u.pathname) && /^[a-z0-9_-]{3,20}$/.test(h);
      case 'kaggle':
        return u.hostname === 'www.kaggle.com' && path === expectedSuffix && /^[a-z0-9-]{2,40}$/.test(h);
      case 'huggingface':
        return u.hostname === 'huggingface.co' && path === expectedSuffix && /^[a-z0-9-]{2,40}$/.test(h);
      case 'github sponsors': case 'githubsponsors':
        return u.hostname === 'github.com' && u.pathname.startsWith('/sponsors/');
      default:
        // Generic: URL must start with http and contain the handle somewhere in the path
        return url.startsWith('http') && !url.includes('?') && (path.includes(h) || path.includes(encodeURIComponent(h)));
    }
  } catch {
    return false;
  }
}

function parseAccounts(rows: StagingRow[]): Array<{ platform: string; handle: string; url: string | null }> {
  const raw: Array<{ platform: string; handle: string; url: string | null }> = [];
  for (const r of rows) {
    if (r.label.startsWith('Social accounts')) {
      r.value.split(' · ').filter(Boolean).forEach((part) => {
        const idx = part.indexOf(':');
        if (idx === -1) return;
        const plat = part.slice(0, idx).trim();
        const handle = part.slice(idx + 1).trim().replace(/^@/, '');
        raw.push({ platform: plat, handle, url: platformUrl(plat, handle) });
      });
    } else if (r.label.startsWith('Account —')) {
      const plat = r.label.replace('Account — ', '').trim();
      const handle = r.value.replace(/^@/, '');
      let rawUrl = r.url ?? platformUrl(plat, handle);
      // Normalise to canonical form — strips query params, unifies http/https, mobile subdomains, etc.
      const canonical = rawUrl ? (canonicalSocialUrl(rawUrl) ?? rawUrl) : rawUrl;
      raw.push({ platform: plat, handle, url: canonical ?? null });
    }
  }

  // Validate URLs and dedup by canonical URL (not just platform — same profile via http vs https is one entry)
  const seenUrls = new Set<string>();
  const seenPlatforms = new Set<string>();
  return raw.filter(({ platform, handle, url }) => {
    if (!url) return false;
    if (!isValidProfileUrl(platform, url, handle)) return false;
    const canonKey = url.toLowerCase();
    if (seenUrls.has(canonKey)) return false;
    seenUrls.add(canonKey);
    // Still enforce one-per-platform, but prefer the canonical URL's entry
    const platKey = platform.toLowerCase();
    if (seenPlatforms.has(platKey)) return false;
    seenPlatforms.add(platKey);
    return true;
  });
}

// Union several confirmed profiles of the SAME person into one subject for the report.
function composeIdentity(parts: Identity[]): Identity {
  const identifiers = parts.reduce(
    (acc, p) => ({ ...acc, ...Object.fromEntries(Object.entries(p.identifiers).filter(([, v]) => v)) }),
    {} as IdentityIdentifiers,
  );
  const primary = parts.find((p) => p.kind === 'person') ?? parts[0];
  return {
    id: 'composite:' + parts.map((p) => p.id).join('+'),
    kind: primary.kind,
    displayName: parts.find((p) => p.identifiers.name)?.displayName || primary.displayName,
    summary: [...new Set(parts.map((p) => p.summary).filter(Boolean))].join(' · '),
    confidence: Math.max(...parts.map((p) => p.confidence)),
    evidence: [...new Set(parts.flatMap((p) => p.evidence))],
    identifiers,
    sources: [...new Set(parts.flatMap((p) => p.sources))],
  };
}

interface ManualForm {
  name: string;
  company: string;
  linkedin: string;
  github: string;
  domain: string;
  orcid: string;
}
const EMPTY_MANUAL: ManualForm = { name: '', company: '', linkedin: '', github: '', domain: '', orcid: '' };

function manualToIdentity(m: ManualForm): Identity | null {
  const has = Object.values(m).some((v) => v.trim());
  if (!has) return null;
  const dn = m.name.trim() || m.company.trim() || m.linkedin.trim() || 'Manual profile';
  const evidence: string[] = ['Manually entered by analyst'];
  if (m.linkedin.trim()) evidence.push(`LinkedIn: ${m.linkedin.trim()}`);
  if (m.orcid.trim()) evidence.push(`ORCID: ${m.orcid.trim()}`);
  return {
    id: 'manual:' + Math.abs([...dn].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36),
    kind: m.name.trim() ? 'person' : 'company',
    displayName: dn,
    summary: 'Analyst-supplied profile',
    confidence: 0.9,
    evidence,
    identifiers: {
      name: m.name.trim() || undefined,
      company: m.company.trim() || undefined,
      domain: m.domain.trim() ? host(m.domain.trim()) : undefined,
      githubLogin: m.github.trim() ? m.github.trim().replace(/.*github\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0] : undefined,
    },
    sources: ['Manual'],
  };
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>('input');
  const [input, setInput] = useState<ReconInput>({});
  const [candidates, setCandidates] = useState<Identity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ReconReport | null>(null);
  const [resolveSteps, setResolveSteps] = useState<StepLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [intakeMsg, setIntakeMsg] = useState('');
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [storeMsg, setStoreMsg] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
  const [companySuggestion, setCompanySuggestion] = useState<{ name: string } | null>(null);
  const [target, setTarget] = useState<'person' | 'company' | 'both'>('person');

  useEffect(() => {
    fetch('/api/store/status').then((r) => r.json()).then(setStore).catch(() => {});
  }, []);

  function set<K extends keyof ReconInput>(k: K, v: string) {
    setInput((p) => ({ ...p, [k]: v || undefined }));
  }
  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runResolve() {
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getTargetedInput()) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'resolve failed');
      const cands: Identity[] = data.candidates ?? [];
      setCandidates(cands);
      setResolveSteps(data.steps ?? []);
      setSelectedIds(new Set(cands[0] ? [cands[0].id] : [])); // default: top match
      setPhase('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'resolve failed');
    } finally {
      setBusy(false);
    }
  }

  function addManual() {
    const id = manualToIdentity(manual);
    if (!id) return;
    setCandidates((prev) => [id, ...prev]);
    setSelectedIds((prev) => new Set([...prev, id.id]));
    setManual(EMPTY_MANUAL);
    setManualOpen(false);
  }

  async function runCheck() {
    const parts = candidates.filter((c) => selectedIds.has(c.id));
    if (!parts.length) return;
    const identity = parts.length > 1 ? composeIdentity(parts) : parts[0];
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/background-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, input: getTargetedInput() }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'background-check failed');
      setReport(data as ReconReport);
      if (data.store) setStore(data.store as StoreStatus);
      if (data.companySuggestion) setCompanySuggestion(data.companySuggestion as { name: string });
      setPhase('report');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'background-check failed');
    } finally {
      setBusy(false);
    }
  }

  async function flagField(subjectKey: string, scope: string, label: string, value: string, source: string) {
    await fetch('/api/store/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectKey, scope, label, value, source }),
    });
  }

  async function runCompanyResearch() {
    if (!companySuggestion) return;
    setCompanySuggestion(null);
    setBusy(true);
    try {
      // Resolve the company as a new identity then run background check
      const r = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: companySuggestion.name }) });
      const d = await r.json();
      const cand: Identity = d.candidates?.[0] ?? { id: `co:${companySuggestion.name}`, kind: 'company', displayName: companySuggestion.name, summary: '', confidence: 0.5, evidence: [], identifiers: { company: companySuggestion.name }, sources: ['Derived'] };
      const cr = await fetch('/api/background-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: cand, input: { company: companySuggestion.name } }) });
      const cd = await cr.json();
      setReport(cd as ReconReport);
      if (cd.store) setStore(cd.store as StoreStatus);
      setPhase('report');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'company research failed');
    } finally {
      setBusy(false);
    }
  }

  async function pushBridge() {
    if (!report) return;
    const res = await addToBridge(mapReportToCapture(report));
    setIntakeMsg(res.ok ? `Quarantined for Bridge review (via ${res.sink}).` : `Intake failed: ${res.error}`);
  }

  async function approveStore() {
    setStoreMsg('Committing…');
    const r = await fetch('/api/store/promote', { method: 'POST' });
    const d = await r.json();
    setStore(d as StoreStatus);
    setStoreMsg(`Committed ${d.promoted} row(s) to permanent DB${d.skipped ? `, ${d.skipped} duplicate(s) skipped` : ''}.`);
  }
  async function discardStore() {
    setStoreMsg('Discarding…');
    const r = await fetch('/api/store/discard', { method: 'POST' });
    const d = await r.json();
    setStore(d as StoreStatus);
    setStoreMsg('Staging cleared — nothing committed.');
  }

  function reset() {
    setPhase('input');
    setCandidates([]);
    setSelectedIds(new Set());
    setReport(null);
    setError('');
    setIntakeMsg('');
  }

  function getTargetedInput(): ReconInput {
    const { name, email, github, linkedin, handle, location, usernameScan, depth } = input;
    const { company, domain, state, depth: _d } = input;
    if (target === 'person') return { name, email, github, linkedin, handle, location, usernameScan, depth };
    if (target === 'company') return { company, domain, state, depth };
    return input;
  }

  const selectedCount = selectedIds.size;

  return (
    <>
      <h1>Recon</h1>
      <div className="muted small">Zero-cost, deterministic pre-meeting background check · search-led web discovery + free registries · no AI · draft-then-approve into Bridge</div>

      {store && <StoreBar store={store} msg={storeMsg} onApprove={approveStore} onDiscard={discardStore} />}

      {error && <div className="panel" style={{ borderColor: 'var(--bad)' }}><span className="no">⚠ {error}</span></div>}

      {phase === 'input' && (
        <div className="panel">
          {/* Target toggle */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Researching:</span>
            {(['person', 'company', 'both'] as const).map((t) => (
              <label key={t} className="muted small" style={{ cursor: 'pointer', padding: '3px 12px', borderRadius: 4, background: target === t ? 'var(--accent)' : 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="radio" name="target" value={t} checked={target === t} onChange={() => setTarget(t)} style={{ display: 'none' }} />
                {t === 'person' ? 'Person' : t === 'company' ? 'Company' : 'Person + Company'}
              </label>
            ))}
          </div>

          {/* Person fields */}
          {target !== 'company' && (
            <>
              {target === 'both' && <div className="muted small" style={{ marginBottom: 8, fontWeight: 600 }}>Person</div>}
              <div className="grid">
                <div className="field"><label>Name</label><input value={input.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Jane Founder" /></div>
                <div className="field"><label>Email <span className="muted">(optional)</span></label><input value={input.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="jane@acme.com" /></div>
                <div className="field"><label>GitHub <span className="muted">(optional)</span></label><input value={input.github ?? ''} onChange={(e) => set('github', e.target.value)} placeholder="janedev" /></div>
                <div className="field"><label>Username / handle <span className="muted">(optional)</span></label><input value={input.handle ?? ''} onChange={(e) => set('handle', e.target.value)} placeholder="janedoe" /></div>
                <div className="field"><label>City / region <span className="muted">(optional)</span></label><input value={input.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="San Francisco" /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label>LinkedIn URL <span className="muted">(optional — boosts accuracy)</span></label><input value={input.linkedin ?? ''} onChange={(e) => set('linkedin', e.target.value)} placeholder="https://linkedin.com/in/janefoo" /></div>
              </div>
              <label className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <input type="checkbox" checked={input.usernameScan === 'full'} onChange={(e) => setInput((p) => ({ ...p, usernameScan: e.target.checked ? 'full' : 'curated' }))} />
                Deep username scan — probe the full 700+ platform list (slower; default is ~40 high-signal sites)
              </label>
            </>
          )}

          {/* Divider in "both" mode */}
          {target === 'both' && <div style={{ borderTop: '1px solid var(--line)', margin: '18px 0' }} />}

          {/* Company fields */}
          {target !== 'person' && (
            <>
              {target === 'both' && <div className="muted small" style={{ marginBottom: 8, fontWeight: 600 }}>Company / fund</div>}
              <div className="grid">
                <div className="field"><label>Company / fund</label><input value={input.company ?? ''} onChange={(e) => set('company', e.target.value)} placeholder="e.g. Acme Capital" /></div>
                <div className="field"><label>Domain <span className="muted">(optional)</span></label><input value={input.domain ?? ''} onChange={(e) => set('domain', e.target.value)} placeholder="acme.com" /></div>
                <div className="field"><label>US state <span className="muted">(optional — SoS/UCC)</span></label><input value={input.state ?? ''} onChange={(e) => set('state', e.target.value)} placeholder="DE" maxLength={2} /></div>
              </div>
            </>
          )}

          {/* Depth selector */}
          <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted small" style={{ marginRight: 4 }}>Research depth:</span>
            {(['basic', 'advanced', 'deep'] as const).map((d) => (
              <label key={d} className="muted small" style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', padding: '3px 10px', borderRadius: 4, background: (input.depth ?? 'basic') === d ? 'var(--accent)' : 'var(--surface)', border: '1px solid var(--border)' }}>
                <input type="radio" name="depth" value={d} checked={(input.depth ?? 'basic') === d} onChange={() => setInput((p) => ({ ...p, depth: d }))} style={{ display: 'none' }} />
                {d === 'basic' ? '⚡ Basic' : d === 'advanced' ? '🔍 Advanced' : '🕵️ Deep'}
              </label>
            ))}
            <span className="muted small" style={{ marginLeft: 4 }}>
              {(input.depth ?? 'basic') === 'basic' ? '~30s · zero-key REST' : (input.depth ?? 'basic') === 'advanced' ? '~90s · specialist registries' : '~3min · bulk + browser'}
            </span>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              disabled={busy || (target === 'person' && !input.name) || (target === 'company' && !input.company) || (target === 'both' && !input.name && !input.company)}
              onClick={runResolve}
            >
              {busy ? 'Resolving…' : 'Find identities →'}
            </button>
          </div>
        </div>
      )}

      {phase === 'verify' && (
        <div className="panel">
          <h2>Verify identity</h2>
          <div className="muted small">Tick <strong>every</strong> profile that is the <strong>same person</strong> — they&apos;ll be merged into one subject. If the right one isn&apos;t here, add it manually or refine your search.</div>

          {candidates.length === 0 && <div className="muted" style={{ marginTop: 10 }}>No candidates found. Add the profile manually or refine below.</div>}

          {candidates.map((c) => {
            const isCompanyKind = c.kind !== 'person';
            const mismatch = input.name ? nameMismatch(input.name, c.displayName) : false;
            const kindColor = isCompanyKind ? '#8957e5' : '#3fb950';
            return (
              <label key={c.id} className={`cand ${selectedIds.has(c.id) ? 'sel' : ''}`} style={{ cursor: 'pointer', opacity: mismatch ? 0.6 : 1 }}>
                <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggle(c.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{c.displayName}</strong>
                    <span className="tag" style={{ background: kindColor + '22', color: kindColor }}>{c.kind}</span>
                    <span className="conf">conf {(c.confidence * 100).toFixed(0)}%</span>
                    {isCompanyKind && input.name && <span style={{ fontSize: 10, color: '#e09b31', fontWeight: 600 }}>⚠ company result for person search</span>}
                    {mismatch && !isCompanyKind && <span style={{ fontSize: 10, color: '#da3633', fontWeight: 600 }}>⚠ name mismatch</span>}
                  </div>
                  {c.summary && <div className="small" style={{ marginTop: 3 }}>{c.summary}</div>}
                  <div className="muted small" style={{ marginTop: 4 }}>{c.evidence.join(' · ')}</div>
                  <div className="muted small">sources: {c.sources.join(', ')}</div>
                </div>
              </label>
            );
          })}

          <div style={{ marginTop: 12 }}>
            <button className="secondary" onClick={() => setManualOpen((v) => !v)}>{manualOpen ? '− Cancel manual entry' : '+ Add the correct profile manually'}</button>
          </div>
          {manualOpen && (
            <div className="panel" style={{ marginTop: 10 }}>
              <div className="muted small" style={{ marginBottom: 8 }}>Supply what you already know. Name + company/domain drive the deepest report.</div>
              <div className="grid">
                <div className="field"><label>Name</label><input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Jane Founder" /></div>
                <div className="field"><label>Company</label><input value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} placeholder="Acme Capital" /></div>
                <div className="field"><label>LinkedIn URL</label><input value={manual.linkedin} onChange={(e) => setManual({ ...manual, linkedin: e.target.value })} placeholder="linkedin.com/in/…" /></div>
                <div className="field"><label>GitHub</label><input value={manual.github} onChange={(e) => setManual({ ...manual, github: e.target.value })} placeholder="janedev" /></div>
                <div className="field"><label>Domain</label><input value={manual.domain} onChange={(e) => setManual({ ...manual, domain: e.target.value })} placeholder="acme.com" /></div>
                <div className="field"><label>ORCID</label><input value={manual.orcid} onChange={(e) => setManual({ ...manual, orcid: e.target.value })} placeholder="0000-0000-0000-0000" /></div>
              </div>
              <div style={{ marginTop: 10 }}><button onClick={addManual}>Add this profile →</button></div>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => setPhase('input')}>← None match — refine search</button>
            <button className="secondary" onClick={reset}>Start over</button>
            <button disabled={busy || selectedCount === 0} onClick={runCheck}>
              {busy ? 'Researching…' : selectedCount > 1 ? `Run check on ${selectedCount} merged profiles →` : 'Run background check →'}
            </button>
          </div>
          <StepLogView title="Resolution log" steps={resolveSteps} />
        </div>
      )}

      {phase === 'report' && report && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>{report.identity.displayName} <span className="tag">{report.identity.kind}</span></h2>
            <span className="muted small">{new Date(report.generatedAt).toLocaleString()}</span>
          </div>

          {report.signals.length > 0 && (
            <>
              <h3>Signals (risk / credit / health)</h3>
              {report.signals.map((s, i) => <SignalView key={i} f={s} />)}
            </>
          )}

          {companySuggestion && (
            <div className="panel" style={{ borderColor: '#8957e5', background: '#0e0a1f', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="small"><strong>Company identified:</strong> {companySuggestion.name}</span>
                <button onClick={runCompanyResearch} disabled={busy} style={{ fontSize: 11 }}>Research {companySuggestion.name} →</button>
                <button className="secondary" style={{ fontSize: 11 }} onClick={() => setCompanySuggestion(null)}>Dismiss</button>
              </div>
            </div>
          )}

          {report.person && <SubjectView sub={report.person} subjectKey={normName(report.identity.displayName)} onFlag={flagField} />}
          {report.company && <SubjectView sub={report.company} subjectKey={normName(report.identity.displayName)} onFlag={flagField} />}

          <h3>Source coverage</h3>
          {report.coverage.map((c, i) => (
            <div key={i} className="small step"><span className={c.ok ? 'ok' : 'no'}>{c.ok ? '●' : '○'}</span> <strong>{c.source}</strong> — <span className="muted">{c.note}</span></div>
          ))}

          <StepLogView title="Full step log (provenance)" steps={report.steps} />

          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="secondary" onClick={reset}>New search</button>
            <button onClick={pushBridge}>Add to Bridge (quarantined)</button>
            {intakeMsg && <span className="muted small">{intakeMsg}</span>}
          </div>
        </div>
      )}
    </>
  );
}

function StoreBar({ store, msg, onApprove, onDiscard }: { store: StoreStatus; msg: string; onApprove: () => void; onDiscard: () => void }) {
  const subjectCount = store.subjectCount ?? 0;
  const [viewRows, setViewRows] = useState(false);
  return (
    <div className="panel" style={{ borderColor: store.needsApproval ? 'var(--warn)' : 'var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="small">
          <strong>Global DB</strong> · <strong>{subjectCount}</strong> subject{subjectCount !== 1 ? 's' : ''} staged · permanent <strong>{store.permanentCount}</strong>
          {subjectCount > 0 && (
            <button className="secondary" style={{ marginTop: 8, fontSize: 11, display: 'block' }} onClick={() => setViewRows((v) => !v)}>
              {viewRows ? 'Hide subjects' : `View ${subjectCount} subject${subjectCount !== 1 ? 's' : ''} →`}
            </button>
          )}
        </div>
        {store.needsApproval && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="no small">⚠ {subjectCount} subject{subjectCount !== 1 ? 's' : ''} staged — approval required</span>
            <button onClick={onApprove}>Approve → commit</button>
            <button className="secondary" onClick={onDiscard}>Discard</button>
          </div>
        )}
      </div>
      {msg && <div className="muted small" style={{ marginTop: 8 }}>{msg}</div>}
      {viewRows && <StagingViewer />}
    </div>
  );
}

function StagingViewer() {
  const [rows, setRows] = useState<StagingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entityId, setEntityId] = useState('');
  const [entityLabel, setEntityLabel] = useState('');
  const [tagMsg, setTagMsg] = useState('');
  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/store/rows');
      setRows(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleRows(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleAll() {
    setSelected((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function submitTag() {
    if (!entityId.trim() || selected.size < 2) return;
    setTagMsg('Saving…');
    const r = await fetch('/api/store/entity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: [...selected], entityId, entityLabel, analystId: 'analyst' }),
    });
    if (r.ok) {
      setTagMsg(`Tagged ${selected.size} rows as "${entityId.trim()}"`);
      setSelected(new Set()); setEntityId(''); setEntityLabel('');
      load();
    } else {
      const d = await r.json();
      setTagMsg(`Error: ${d.error}`);
    }
  }

  if (loading) return <div className="muted small" style={{ marginTop: 12 }}>Loading staging rows…</div>;

  const summaries = buildPersonSummaries(rows);
  const scopeColor = (sc: string) => sc === 'person' ? '#388bfd' : sc === 'company' ? '#8957e5' : '#da3633';
  const tierColor = (t: string) => t === 'A' ? '#3fb950' : t === 'B' ? '#d29922' : '#6e7681';

  return (
    <div style={{ marginTop: 12 }}>
      {selected.size >= 2 && (
        <div className="panel" style={{ marginBottom: 10, background: '#0d1117', borderColor: 'var(--accent)' }}>
          <div className="small" style={{ marginBottom: 6 }}>
            <strong>Tag {selected.size} selected rows as one entity</strong>
            <span className="muted"> · rows belong to the same real-world person or firm</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, flex: '1 1 160px' }}>
              <label style={{ fontSize: 11 }}>Entity ID <span className="muted">(slug, e.g. andrew-ng-2)</span></label>
              <input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="andrew-ng-2" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} />
            </div>
            <div className="field" style={{ margin: 0, flex: '2 1 220px' }}>
              <label style={{ fontSize: 11 }}>Entity label <span className="muted">(human-readable)</span></label>
              <input value={entityLabel} onChange={(e) => setEntityLabel(e.target.value)} placeholder="Andrew Ng — Monash Malaysia academic" style={{ fontSize: 12 }} />
            </div>
            <button disabled={!entityId.trim()} onClick={submitTag} style={{ alignSelf: 'flex-end' }}>Confirm tag →</button>
          </div>
          {tagMsg && <div className="muted small" style={{ marginTop: 6 }}>{tagMsg}</div>}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <span className="muted small">{summaries.length} subject{summaries.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: '#0d1117' }}>
                <th style={{ padding: '5px 8px', width: 24 }} />
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>Person</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Conf / State</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Entity</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Bio / Wikipedia</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>LinkedIn</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>GitHub</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>News</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Accounts</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Social activity</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>Signals</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const isAnySelected = s.allRowIds.some((id) => selected.has(id));
                const es = eidStyle(s.targetEid);
                const cc = s.avgConf >= 80 ? '#3fb950' : s.avgConf >= 60 ? '#d29922' : '#6e7681';
                const accounts = parseAccounts(s.accountRows);
                return (
                  <tr key={s.name} style={{ borderBottom: '0.5px solid var(--line)', background: isAnySelected ? '#0d1f38' : 'transparent', verticalAlign: 'top' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <input type="checkbox" checked={isAnySelected} onChange={() => toggleRows(s.allRowIds)} title={`Select all ${s.allRowIds.length} rows for ${s.name}`} />
                    </td>
                    <td style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.name}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: cc, fontWeight: 700 }}>{s.avgConf}%</span>
                      {(() => {
                        const stateRow = s.allRowIds.length ? rows.find((r) => s.allRowIds.includes(r.id) && r.verificationState) : undefined;
                        const vs = stateRow?.verificationState;
                        if (!vs || vs === 'found') return null;
                        const [bg, fg, label] = vs === 'verified' ? ['#071d38', '#388bfd', '✓ verified']
                          : vs === 'probable' ? ['#1a2d1a', '#3fb950', '~ probable']
                          : ['#2d0f0e', '#f85149', '✗ rejected'];
                        return <span style={{ marginLeft: 5, fontSize: 9, background: bg, color: fg, border: `1px solid ${fg}`, borderRadius: 4, padding: '1px 4px' }}>{label}</span>;
                      })()}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ ...es, padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, display: 'inline-block' }}>{s.targetEid}</span>
                      {s.collisionEids.length > 0 && (
                        <div style={{ marginTop: 3, fontSize: 10, color: '#e09b31' }}>+{s.collisionEids.join(', ')}</div>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: 180 }}>
                      {s.bio
                        ? <a href={s.bio.url} target="_blank" rel="noreferrer" style={{ color: '#388bfd', fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={s.bio.value}>{s.bio.value}</a>
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {s.linkedin
                        ? <a href={s.linkedin.url} target="_blank" rel="noreferrer" style={{ color: '#0a66c2', fontSize: 11, whiteSpace: 'nowrap' }}>LinkedIn ↗</a>
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {s.github
                        ? <a href={s.github.url} target="_blank" rel="noreferrer" style={{ color: '#388bfd', fontSize: 11, whiteSpace: 'nowrap' }}>@{s.github.value.replace(/^@/, '')} ↗</a>
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: 200 }}>
                      {s.newsRows.length > 0
                        ? (
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#388bfd', whiteSpace: 'nowrap' }}>{s.newsRows.length} headline{s.newsRows.length > 1 ? 's' : ''}</summary>
                            <div style={{ paddingTop: 4 }}>
                              {s.newsRows.map((n, i) => (
                                <div key={i} style={{ marginBottom: 3 }}>
                                  {n.url
                                    ? <a href={n.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#388bfd', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }} title={n.value}>{n.value}</a>
                                    : <span style={{ fontSize: 10, color: 'var(--muted)' }}>{n.value}</span>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: 220 }}>
                      {accounts.length > 0
                        ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {accounts.slice(0, 8).map((a, i) => (
                              a.url
                                ? <a key={i} href={a.url} target="_blank" rel="noreferrer" title={`${a.platform}: ${a.handle}`} style={{ fontSize: 10, color: '#388bfd', background: '#071d38', padding: '1px 5px', borderRadius: 4, display: 'inline-block', whiteSpace: 'nowrap' }}>{a.platform}</a>
                                : <span key={i} title={`${a.platform}: ${a.handle}`} style={{ fontSize: 10, color: 'var(--muted)', background: '#0d1117', padding: '1px 5px', borderRadius: 4, display: 'inline-block', whiteSpace: 'nowrap' }}>{a.platform}</span>
                            ))}
                            {accounts.length > 8 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>+{accounts.length - 8}</span>}
                          </div>
                        )
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: 200 }}>
                      {s.activityRows.length > 0
                        ? (
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#e09b31', whiteSpace: 'nowrap' }}>
                              {s.activityRows.length} item{s.activityRows.length !== 1 ? 's' : ''}
                            </summary>
                            <div style={{ paddingTop: 4 }}>
                              {s.activityRows.map((a, i) => {
                                const icon = a.source === 'HN' ? '▲' : a.source === 'Reddit' ? '●' : a.source === 'Mastodon' ? '🐘' : a.source === 'Bluesky' ? '☁' : '◈';
                                return (
                                  <div key={i} style={{ marginBottom: 3, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                                    <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
                                    {a.url
                                      ? <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#e09b31', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={a.value}>{a.value}</a>
                                      : <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={a.value}>{a.value}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {s.signals.length > 0
                        ? s.signals.map((sig, i) => (
                          <div key={i} style={{ fontSize: 10, marginBottom: 2 }}>
                            {sig.url
                              ? <a href={sig.url} target="_blank" rel="noreferrer" style={{ color: '#da3633' }}>⚑ {sig.label}</a>
                              : <span style={{ color: '#da3633' }}>⚑ {sig.label}</span>}
                          </div>
                        ))
                        : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      {selected.size === 1 && (
        <div className="muted small" style={{ marginTop: 6 }}>Select one more to tag as same entity.</div>
      )}
      {selected.size === 0 && rows.length > 0 && (
        <div className="muted small" style={{ marginTop: 6 }}>Check a person row to select all their data.</div>
      )}
    </div>
  );
}

function SubjectView({ sub, subjectKey, onFlag }: {
  sub: SubjectReport;
  subjectKey?: string;
  onFlag?: (subjectKey: string, scope: string, label: string, value: string, source: string) => void;
}) {
  const scope = sub.kind === 'person' ? 'person' : 'company';
  return (
    <>
      <h3>{sub.kind === 'person' ? 'Person' : 'Company / fund'} — {sub.name}</h3>
      {sub.sections.map((sec) => {
        const fields = preprocessSection(sec.fields);
        if (!fields.length) return null;
        return (
          <div key={sec.title}>
            <div className="muted small" style={{ margin: '10px 0 2px' }}>{sec.title}</div>
            {fields.map((f, i) => (
              <FieldView
                key={i}
                f={f}
                onFlag={subjectKey && onFlag
                  ? () => onFlag(subjectKey, scope, f.label, f.value, f.source ?? '')
                  : undefined}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function FieldView({ f, onFlag }: { f: RichField; onFlag?: () => void }) {
  const [flagged, setFlagged] = useState(false);
  const conf = fieldConfidence(f.source ?? '', f.tier ?? 'C');
  const cc = conf >= 0.80 ? '#3fb950' : conf >= 0.60 ? '#d29922' : '#6e7681';
  const badge = <span style={{ marginLeft: 6, fontSize: 10, color: cc, fontWeight: 700 }}>{Math.round(conf * 100)}%</span>;
  const flagBtn = onFlag ? (
    <button
      onClick={() => { onFlag(); setFlagged(true); }}
      title={flagged ? 'Flagged as inaccurate' : 'Flag as inaccurate'}
      style={{ marginLeft: 8, fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: flagged ? '#da3633' : 'var(--muted)', padding: 0, lineHeight: 1 }}
    >
      {flagged ? '🚩' : '⚑'}
    </button>
  ) : null;

  // Merged accounts → linked platform chips
  if (f.kind === 'accounts-merged' || (f.label.startsWith('Social accounts') && f.value.includes(':'))) {
    const parts = f.value.split(' · ').filter(Boolean);
    return (
      <div className="kv">
        <div className="k">{f.label}</div>
        <div className="v">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {parts.map((part, i) => {
              const idx = part.indexOf(':');
              if (idx === -1) return <span key={i} className="tag">{part}</span>;
              const plat = part.slice(0, idx).trim();
              const handle = part.slice(idx + 1).trim();
              const url = platformUrl(plat, handle);
              return url
                ? <a key={i} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, background: '#071d38', color: '#388bfd', padding: '2px 6px', borderRadius: 4 }}>{plat}: @{handle}</a>
                : <span key={i} style={{ fontSize: 11, background: '#0d1117', color: 'var(--muted)', padding: '2px 6px', borderRadius: 4 }}>{plat}: @{handle}</span>;
            })}
          </div>
          <span className="muted small"> · {f.source}</span>{badge}{flagBtn}
        </div>
      </div>
    );
  }

  // Merged news → expandable list
  if (f.kind === 'news-merged') {
    const headlines = f.value.split(' · ').filter(Boolean);
    return (
      <div className="kv">
        <div className="k">{f.label}</div>
        <div className="v">
          <details>
            <summary style={{ cursor: 'pointer', color: '#388bfd' }}>{headlines.length} headlines</summary>
            <div style={{ paddingTop: 4 }}>
              {headlines.map((h, i) => <div key={i} className="small" style={{ marginBottom: 3 }}>• {h}</div>)}
            </div>
          </details>
          <span className="muted small"> · {f.source}</span>{badge}{flagBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="kv">
      <div className="k">{f.label}</div>
      <div className="v">
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.value}</a> : f.value}
        <span className="muted small"> · {f.source}</span>{badge}{flagBtn}
      </div>
    </div>
  );
}

function SignalView({ f }: { f: Field }) {
  const conf = fieldConfidence(f.source ?? '', f.tier ?? 'A');
  const cc = conf >= 0.80 ? '#3fb950' : conf >= 0.60 ? '#d29922' : '#6e7681';
  return (
    <div className="sig">
      <strong>{f.label}</strong>
      <div className="small">
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.value}</a> : f.value}
        <span className="muted"> · {f.source}</span>
        <span style={{ marginLeft: 6, fontSize: 10, color: cc, fontWeight: 700 }}>{Math.round(conf * 100)}%</span>
      </div>
    </div>
  );
}

function StepLogView({ title, steps }: { title: string; steps: StepLog[] }) {
  if (!steps.length) return null;
  return (
    <details style={{ marginTop: 14 }}>
      <summary>{title} ({steps.length})</summary>
      {steps.map((s, i) => (
        <div key={i} className="step">
          <span className={s.ok ? 'ok' : 'no'}>{s.ok ? '✓' : '✗'}</span> <strong>{s.step}</strong> <span className="muted">({s.durationMs}ms)</span>
          <div className="muted">in: {s.input}</div>
          <div>out: {s.output}</div>
        </div>
      ))}
    </details>
  );
}
