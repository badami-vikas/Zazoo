// Recon — zero-cost, no-AI, deterministic pre-meeting background check.
//
// Two-phase contract (see app/api/*):
//   1. resolveIdentities(input)  → ranked candidate identities for human verification
//   2. buildReport(identity)     → detailed person + company report, every fact provenanced
//
// SEARCH-LED ARCHITECTURE (recall-first). Most subjects are NOT famous (no
// Wikipedia), NOT engineers (no GitHub), and do NOT file with the SEC (no EDGAR),
// so registry-only lookups return nothing for the median person. General web
// search is the connective tissue that finds where a normal person actually lives
// online; structured sources then CONFIRM what search discovers.
//
//   Stage A — DISCOVER   self-hosted SearXNG metasearch → footprint (LinkedIn
//                        snippet, company team page, personal site, socials, news)
//   Stage B — EXPAND     extract LinkedIn title/employer, JSON-LD/Person, socials,
//                        press; fold discovered domain/github into context
//   Stage C — ROUTE      type-aware registries: FINRA BrokerCheck (+disclosures),
//                        OpenAlex, EDGAR, IAPD, OpenCorporates/Patents deep-links,
//                        CourtListener, USAspending, SoS/UCC, news
//
// LinkedIn is NEVER fetched — only the public SERP snippet it exposes is read.
// No AI/LLM. No paid sources. No bulk downloads — every call is keyed off the single input.

import { resolveMx } from 'dns/promises';
import { promises as fs } from 'fs';
import path from 'path';
import { fetchRendered, solverConfigured } from './browser';
import { canonicalSocialUrl } from './url-canon';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type IdentityKind = 'person' | 'company' | 'fund';

export interface ReconInput {
  name?: string;
  email?: string;
  company?: string;
  domain?: string;
  github?: string;
  /** 2-letter US state for SoS / UCC deep-links (optional). */
  state?: string;
  /** City / region — sharpens web-search discovery for non-famous subjects. */
  location?: string;
  /** Known username/handle to seed cross-platform account enumeration. */
  handle?: string;
  /** Cross-platform username scan breadth. Default 'curated' (~40 high-signal sites). */
  usernameScan?: 'off' | 'curated' | 'full';
  /**
   * Confirmed LinkedIn profile URL (analyst-supplied ground truth).
   * Used to boost matching candidates and anchor enricher output.
   */
  linkedin?: string;
}

export interface IdentityIdentifiers {
  name?: string;
  company?: string;
  domain?: string;
  wikidataQid?: string;
  githubLogin?: string;
  secCik?: string;
}

export interface Identity {
  id: string;
  kind: IdentityKind;
  displayName: string;
  summary: string;
  confidence: number; // 0..1
  evidence: string[];
  identifiers: IdentityIdentifiers;
  sources: string[];
}

export interface StepLog {
  step: string;
  input: string;
  output: string;
  durationMs: number;
  ok: boolean;
}

export interface Field {
  label: string;
  value: string;
  tier: 'A' | 'B' | 'C';
  source: string;
  url?: string;
  /** 'signal' fields are risk/credit/health flags → mapped to a Bridge Signal. */
  kind?: 'fact' | 'signal';
}

export interface ReportSection {
  title: string;
  fields: Field[];
}

export interface SubjectReport {
  kind: IdentityKind;
  name: string;
  sections: ReportSection[];
}

export interface ReconReport {
  identity: Identity;
  generatedAt: string;
  person?: SubjectReport;
  company?: SubjectReport;
  signals: Field[];
  steps: StepLog[];
  coverage: Array<{ source: string; ok: boolean; note: string }>;
  /** Set when a person search discovers a company — the UI can offer to run company research. */
  companySuggestion?: { name: string };
}

interface SourceContribution {
  source: string;
  personFields: Field[];
  companyFields: Field[];
  signals: Field[];
  steps: StepLog[];
  identifiers?: Partial<IdentityIdentifiers>;
}

interface ReportCtx {
  kind: IdentityKind;
  name?: string;
  company?: string;
  domain?: string;
  email?: string;
  state?: string;
  location?: string;
  handle?: string;
  handles?: string[];
  usernameScan?: 'off' | 'curated' | 'full';
  identifiers: IdentityIdentifiers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config — SEC requires a descriptive User-Agent with a contact email or it blocks.
// ─────────────────────────────────────────────────────────────────────────────

export const SEC_UA = 'Bridge Recon - Vikas Badami badami@wustl.edu';

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': SEC_UA,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const tok = process.env.GITHUB_TOKEN;
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers (server-side only — these set User-Agent, which browsers cannot)
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult<T> {
  ok: boolean;
  status: number;
  ms: number;
  data: T | null;
  raw: string;
  error?: string;
}

async function fetchJSON<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<FetchResult<T>> {
  const { timeoutMs = 15000, headers, ...rest } = init;
  const t = Date.now();
  try {
    const r = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': SEC_UA, Accept: 'application/json', ...(headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    let data: T | null = null;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      /* non-JSON (often a bot wall) — leave null, raw retained for the log */
    }
    return { ok: r.ok, status: r.status, ms: Date.now() - t, data, raw, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, data: null, raw: '', error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<FetchResult<string>> {
  const { timeoutMs = 15000, headers, ...rest } = init;
  const t = Date.now();
  try {
    const r = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': SEC_UA, ...(headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    return { ok: r.ok, status: r.status, ms: Date.now() - t, data: raw, raw, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, data: null, raw: '', error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

function step(name: string, input: string, r: { ok: boolean; ms: number; status?: number; error?: string }, output: string): StepLog {
  return {
    step: name,
    input,
    output: r.ok ? output : `Error${r.status ? ` ${r.status}` : ''}: ${r.error ?? 'failed'} — ${output}`.trim(),
    durationMs: r.ms,
    ok: r.ok,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────

const FREE_EMAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'aol.com']);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|lp|llp|company|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function domainFromEmail(email?: string): string | undefined {
  const d = email?.split('@')[1]?.trim().toLowerCase();
  return d && !FREE_EMAIL.has(d) ? d : undefined;
}

function hostFromUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function inferKind(text: string): IdentityKind {
  const s = ` ${text.toLowerCase()} `;
  if (/\b(capital|ventures?|fund|partners|management|advisors?|asset)\b/.test(s)) return 'fund';
  if (/\b(inc|llc|ltd|corp|co|holdings|labs|technologies|systems|group|company|foundation|institute)\b/.test(s)) return 'company';
  return 'person';
}

function looksLikeCompany(s: string): boolean {
  return inferKind(s) !== 'person';
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 3 — Wikidata / Wikipedia
// ─────────────────────────────────────────────────────────────────────────────

interface WdSearch {
  search?: Array<{ id: string; label?: string; description?: string }>;
}

async function wikidataCandidates(q: string): Promise<{ cands: Identity[]; steps: StepLog[] }> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&type=item&limit=8`;
  const r = await fetchJSON<WdSearch>(url, { headers: { 'Api-User-Agent': SEC_UA } });
  const hits = r.data?.search ?? [];
  const cands: Identity[] = hits.map((s) => ({
    id: `wd:${s.id}`,
    kind: inferKind(s.description ?? ''),
    displayName: s.label ?? q,
    summary: s.description ?? '',
    confidence: 0.5,
    evidence: [`Wikidata ${s.id}: ${s.description ?? 'no description'}`],
    identifiers: { wikidataQid: s.id, name: s.label },
    sources: ['Wikidata'],
  }));
  return { cands, steps: [step('Wikidata search', q, r, `${hits.length} entit${hits.length === 1 ? 'y' : 'ies'}`)] };
}

async function wikidataEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Wikidata', personFields: [], companyFields: [], signals: [], steps: [] };
  let qid = ctx.identifiers.wikidataQid;
  if (!qid && ctx.name) {
    const c = await wikidataCandidates(ctx.name);
    out.steps.push(...c.steps);
    qid = c.cands[0]?.identifiers.wikidataQid;
  }
  if (!qid) {
    out.steps.push({ step: 'Wikidata enrich', input: ctx.name ?? '(none)', output: 'No Wikidata entity resolved', durationMs: 0, ok: false });
    return out;
  }

  const r = await fetchJSON<{ entities?: Record<string, WdEntity> }>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
    headers: { 'Api-User-Agent': SEC_UA },
  });
  const ent = r.data?.entities?.[qid];
  const into = ctx.kind === 'person' ? out.personFields : out.companyFields;
  if (ent) {
    const desc = ent.descriptions?.en?.value;
    if (desc) into.push({ label: 'Wikidata summary', value: desc, tier: 'A', source: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}` });
    const site = claimString(ent, 'P856'); // official website
    if (site) into.push({ label: 'Official website', value: site, tier: 'B', source: 'Wikidata', url: site });
    const inception = claimTime(ent, 'P571'); // inception (company)
    if (inception) out.companyFields.push({ label: 'Founded', value: inception, tier: 'B', source: 'Wikidata' });
    if (site) out.identifiers = { domain: hostFromUrl(site) };

    // Wikipedia summary for a clean bio paragraph (one extra call).
    const enTitle = ent.sitelinks?.enwiki?.title;
    if (enTitle) {
      const w = await fetchJSON<{ extract?: string; content_urls?: { desktop?: { page?: string } } }>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle)}`,
        { headers: { 'Api-User-Agent': SEC_UA } },
      );
      if (w.data?.extract) {
        into.push({ label: 'Wikipedia', value: w.data.extract, tier: 'A', source: 'Wikipedia', url: w.data.content_urls?.desktop?.page });
      }
      out.steps.push(step('Wikipedia summary', enTitle, w, w.data?.extract ? 'extract found' : 'no extract'));
    }
  }
  out.steps.push(step('Wikidata enrich', qid, r, ent ? 'entity parsed' : 'no entity'));
  return out;
}

interface WdEntity {
  descriptions?: { en?: { value: string } };
  sitelinks?: { enwiki?: { title: string } };
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
}

function claimString(ent: WdEntity, prop: string): string | undefined {
  const v = ent.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'string' ? v : undefined;
}

function claimTime(ent: WdEntity, prop: string): string | undefined {
  const v = ent.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
  const t = v?.time; // e.g. "+2009-00-00T00:00:00Z"
  const m = t?.match(/([0-9]{4})/);
  return m ? m[1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 4 — GitHub REST API
// ─────────────────────────────────────────────────────────────────────────────

interface GhUser {
  login: string;
  name?: string | null;
  company?: string | null;
  blog?: string | null;
  location?: string | null;
  bio?: string | null;
  public_repos?: number;
  followers?: number;
  created_at?: string;
  html_url?: string;
  type?: string;
}

async function githubCandidates(name: string): Promise<{ cands: Identity[]; steps: StepLog[] }> {
  const r = await fetchJSON<{ items?: Array<{ login: string }> }>(
    `https://api.github.com/search/users?q=${encodeURIComponent(name + ' type:user')}&per_page=5`,
    { headers: ghHeaders() },
  );
  const items = (r.data?.items ?? []).slice(0, 3);
  const details = await Promise.all(items.map((i) => fetchJSON<GhUser>(`https://api.github.com/users/${i.login}`, { headers: ghHeaders() })));
  const cands: Identity[] = [];
  for (const d of details) {
    const u = d.data;
    if (!u) continue;
    cands.push({
      id: `gh:${u.login}`,
      kind: 'person',
      displayName: u.name || u.login,
      summary: [u.bio, u.company].filter(Boolean).join(' · '),
      confidence: 0.4,
      evidence: [`GitHub @${u.login}${u.company ? ` at ${u.company}` : ''}`],
      identifiers: {
        githubLogin: u.login,
        name: u.name ?? undefined,
        company: u.company ?? undefined,
        domain: hostFromUrl(u.blog ?? undefined),
      },
      sources: ['GitHub'],
    });
  }
  return { cands, steps: [step('GitHub user search', name, r, `${items.length} candidate user(s)`)] };
}

async function githubEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'GitHub', personFields: [], companyFields: [], signals: [], steps: [] };
  let login = ctx.identifiers.githubLogin;
  if (!login && ctx.kind === 'person' && ctx.name) {
    const c = await githubCandidates(ctx.name);
    out.steps.push(...c.steps);
    login = c.cands[0]?.identifiers.githubLogin;
  }
  if (!login) {
    out.steps.push({ step: 'GitHub enrich', input: ctx.name ?? '(none)', output: 'No GitHub login resolved', durationMs: 0, ok: false });
    return out;
  }

  const ur = await fetchJSON<GhUser>(`https://api.github.com/users/${login}`, { headers: ghHeaders() });
  const u = ur.data;
  out.steps.push(step('GitHub user', login, ur, u ? `@${u.login}` : 'not found'));
  if (!u) return out;

  const isOrg = u.type === 'Organization';
  const into = isOrg ? out.companyFields : out.personFields;
  into.push({ label: 'GitHub', value: `@${u.login}${u.name ? ` (${u.name})` : ''}`, tier: 'B', source: 'GitHub', url: u.html_url });
  if (u.bio) into.push({ label: 'Bio', value: u.bio, tier: 'A', source: 'GitHub' });
  if (u.company) out.companyFields.push({ label: 'Affiliated company', value: u.company, tier: 'A', source: 'GitHub' });
  if (u.location) into.push({ label: 'Location', value: u.location, tier: 'C', source: 'GitHub' });
  if (typeof u.public_repos === 'number') into.push({ label: 'Public repos', value: String(u.public_repos), tier: 'B', source: 'GitHub' });
  if (typeof u.followers === 'number') into.push({ label: 'Followers', value: String(u.followers), tier: 'C', source: 'GitHub' });
  if (u.created_at) into.push({ label: 'On GitHub since', value: u.created_at.slice(0, 10), tier: 'C', source: 'GitHub' });
  if (u.blog) out.identifiers = { domain: hostFromUrl(u.blog) };

  // Top languages = a deterministic tech-stack proxy.
  const rr = await fetchJSON<Array<{ language?: string | null; stargazers_count?: number; fork?: boolean }>>(
    `https://api.github.com/users/${login}/repos?per_page=100&sort=updated`,
    { headers: ghHeaders() },
  );
  if (rr.data) {
    const langs = new Map<string, number>();
    for (const repo of rr.data) {
      if (repo.fork || !repo.language) continue;
      langs.set(repo.language, (langs.get(repo.language) ?? 0) + 1);
    }
    const top = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${l} (${n})`).join(', ');
    if (top) into.push({ label: 'Top languages', value: top, tier: 'B', source: 'GitHub' });
  }
  out.steps.push(step('GitHub repos', login, rr, rr.data ? `${rr.data.length} repos scanned` : 'no repos'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 1 — SEC EDGAR (full-text search + submissions API)
// ─────────────────────────────────────────────────────────────────────────────

interface Efts {
  hits?: { total?: { value?: number }; hits?: Array<{ _source?: { display_names?: string[]; file_type?: string; file_date?: string } }> };
}

function parseEdgarDisplay(dn: string): { name: string; cik?: string } {
  const m = dn.match(/^(.*?)\s*\(CIK\s+(\d+)\)/i);
  return m ? { name: m[1].trim(), cik: m[2] } : { name: dn.trim() };
}

async function secEdgarCandidates(q: string): Promise<{ cands: Identity[]; steps: StepLog[] }> {
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&forms=D`;
  const r = await fetchJSON<Efts>(url, { headers: { 'User-Agent': SEC_UA } });
  const hits = r.data?.hits?.hits ?? [];
  const seen = new Set<string>();
  const cands: Identity[] = [];
  for (const h of hits) {
    for (const dn of h._source?.display_names ?? []) {
      const { name, cik } = parseEdgarDisplay(dn);
      const key = cik ?? norm(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      cands.push({
        id: `sec:${cik ?? slug(name)}`,
        kind: inferKind(name),
        displayName: name,
        summary: `SEC Form D filer${h._source?.file_date ? ` (${h._source.file_date})` : ''}`,
        confidence: 0.55,
        evidence: [`SEC EDGAR Form D filer${cik ? ` — CIK ${cik}` : ''}`],
        identifiers: { secCik: cik, name, company: name },
        sources: ['SEC EDGAR'],
      });
    }
  }
  return { cands, steps: [step('SEC EDGAR full-text (Form D)', q, r, `${hits.length} filing hit(s), ${cands.length} entit(ies)`)] };
}

interface SecSubmissions {
  name?: string;
  sicDescription?: string;
  stateOfIncorporation?: string;
  formerNames?: Array<{ name: string }>;
  addresses?: { business?: { city?: string; stateOrCountry?: string } };
  filings?: { recent?: { form?: string[]; filingDate?: string[] } };
}

async function secEdgarEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'SEC EDGAR', personFields: [], companyFields: [], signals: [], steps: [] };
  let cik = ctx.identifiers.secCik;
  if (!cik) {
    const q = ctx.company ?? ctx.name;
    if (q) {
      const c = await secEdgarCandidates(q);
      out.steps.push(...c.steps);
      cik = c.cands[0]?.identifiers.secCik;
    }
  }
  if (!cik) {
    out.steps.push({ step: 'SEC EDGAR submissions', input: ctx.company ?? ctx.name ?? '(none)', output: 'No CIK resolved (no SEC filings found)', durationMs: 0, ok: false });
    return out;
  }

  const cik10 = cik.padStart(10, '0');
  const r = await fetchJSON<SecSubmissions>(`https://data.sec.gov/submissions/CIK${cik10}.json`, { headers: { 'User-Agent': SEC_UA } });
  const s = r.data;
  if (s) {
    if (s.name) out.companyFields.push({ label: 'SEC registrant', value: s.name, tier: 'A', source: 'SEC EDGAR', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}` });
    if (s.sicDescription) out.companyFields.push({ label: 'Industry (SIC)', value: s.sicDescription, tier: 'B', source: 'SEC EDGAR' });
    if (s.stateOfIncorporation) out.companyFields.push({ label: 'State of incorporation', value: s.stateOfIncorporation, tier: 'A', source: 'SEC EDGAR' });
    const biz = s.addresses?.business;
    if (biz?.city) out.companyFields.push({ label: 'HQ', value: [biz.city, biz.stateOrCountry].filter(Boolean).join(', '), tier: 'B', source: 'SEC EDGAR' });
    if (s.formerNames?.length) out.companyFields.push({ label: 'Former names', value: s.formerNames.map((f) => f.name).join('; '), tier: 'C', source: 'SEC EDGAR' });

    const forms = s.filings?.recent?.form ?? [];
    const dates = s.filings?.recent?.filingDate ?? [];
    const formD = forms.map((f, i) => ({ f, d: dates[i] })).filter((x) => x.f === 'D' || x.f === 'D/A');
    if (formD.length) {
      out.companyFields.push({
        label: 'Form D raises (private funding filed)',
        value: `${formD.length} filing(s); latest ${formD[0].d ?? 'n/a'}`,
        tier: 'A',
        source: 'SEC EDGAR',
      });
    }
    out.companyFields.push({ label: 'Total SEC filings', value: String(forms.length), tier: 'C', source: 'SEC EDGAR' });
  }
  out.steps.push(step('SEC EDGAR submissions', `CIK ${cik10}`, r, s?.name ?? 'no submission record'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 2 — SEC Form ADV / IAPD (investment advisers)
// ─────────────────────────────────────────────────────────────────────────────

interface IapdFirm {
  hits?: { hits?: Array<{ _source?: { firm_name?: string; firm_crd_nb?: string | number; firm_ia_full_address?: string } }> };
}

async function secAdvEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'SEC Form ADV / IAPD', personFields: [], companyFields: [], signals: [], steps: [] };
  const q = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (!q) {
    out.steps.push({ step: 'IAPD firm search', input: '(none)', output: 'Skipped — no firm/fund name', durationMs: 0, ok: false });
    return out;
  }
  const url = `https://api.adviserinfo.sec.gov/search/firm?query=${encodeURIComponent(q)}&includeMeta=true`;
  const r = await fetchJSON<IapdFirm>(url, { headers: { Accept: 'application/json' } });
  const hit = r.data?.hits?.hits?.[0]?._source;
  if (hit) {
    const name = hit.firm_name ?? q;
    out.companyFields.push({ label: 'Registered investment adviser', value: `${name}${hit.firm_crd_nb ? ` (CRD ${hit.firm_crd_nb})` : ''}`, tier: 'A', source: 'IAPD' });
    if (hit.firm_ia_full_address) out.companyFields.push({ label: 'RIA address', value: hit.firm_ia_full_address, tier: 'C', source: 'IAPD' });
    out.companyFields.push({ label: 'Form ADV', value: 'Filed — see full ADV for AUM, owners, custody', tier: 'B', source: 'IAPD', url: hit.firm_crd_nb ? `https://adviserinfo.sec.gov/firm/summary/${hit.firm_crd_nb}` : undefined });
  }
  out.steps.push(step('IAPD firm search', q, r, hit ? hit.firm_name ?? 'firm found' : r.data ? 'no RIA match' : 'non-JSON / bot wall (deferred)'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 5 — USAspending.gov (federal contracts → B2G traction)
// ─────────────────────────────────────────────────────────────────────────────

interface UsaSpend {
  results?: Array<{ 'Award Amount'?: number; 'Awarding Agency'?: string; 'Recipient Name'?: string }>;
}

async function usaspendingEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'USAspending.gov', personFields: [], companyFields: [], signals: [], steps: [] };
  const q = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (!q) {
    out.steps.push({ step: 'USAspending awards', input: '(none)', output: 'Skipped — no company name', durationMs: 0, ok: false });
    return out;
  }
  const body = {
    filters: { recipient_search_text: [q], award_type_codes: ['A', 'B', 'C', 'D'] },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Period of Performance Start Date'],
    page: 1,
    limit: 10,
    sort: 'Award Amount',
    order: 'desc',
  };
  const r = await fetchJSON<UsaSpend>('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const results = r.data?.results ?? [];
  if (results.length) {
    const total = results.reduce((a, x) => a + (x['Award Amount'] ?? 0), 0);
    out.companyFields.push({ label: 'Federal contracts', value: `${results.length}+ awards; top-10 total ≈ $${Math.round(total).toLocaleString('en-US')}`, tier: 'C', source: 'USAspending' });
    const top = results[0];
    if (top) out.companyFields.push({ label: 'Largest federal award', value: `$${Math.round(top['Award Amount'] ?? 0).toLocaleString('en-US')} — ${top['Awarding Agency'] ?? 'agency n/a'}`, tier: 'C', source: 'USAspending' });
  }
  out.steps.push(step('USAspending awards', q, r, `${results.length} award(s)`));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 7 — Schema.org / JSON-LD on the company website
// ─────────────────────────────────────────────────────────────────────────────

function flattenLd(json: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out.push(o);
      if (o['@graph']) visit(o['@graph']);
    }
  };
  visit(json);
  return out;
}

async function jsonldEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Company JSON-LD', personFields: [], companyFields: [], signals: [], steps: [] };
  const domain = ctx.domain;
  if (!domain) {
    out.steps.push({ step: 'Company JSON-LD', input: '(no domain)', output: 'Skipped — no company domain (provide one or an email)', durationMs: 0, ok: false });
    return out;
  }
  const url = `https://${domain}/`;
  const r = await fetchText(url, { headers: { Accept: 'text/html' } });
  // Helpers to extract <meta> content regardless of attribute order
  function metaContent(html: string, attr: string, attrType: 'property' | 'name'): string | undefined {
    const a = new RegExp(`<meta[^>]+${attrType}=["']${attr}["'][^>]+content=["']([^"']{1,500})["']`, 'i');
    const b = new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+${attrType}=["']${attr}["']`, 'i');
    return (html.match(a) ?? html.match(b))?.[1]?.trim();
  }

  let parsed = 0;
  if (r.data) {
    const html = r.data;
    const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const b of blocks) {
      let json: unknown;
      try {
        json = JSON.parse(b[1].trim());
      } catch {
        continue;
      }
      for (const n of flattenLd(json)) {
        const type = String(n['@type'] ?? '').toLowerCase();
        if (/organization|corporation|localbusiness/.test(type)) {
          parsed++;
          if (typeof n.name === 'string') out.companyFields.push({ label: 'Site name', value: n.name, tier: 'B', source: 'JSON-LD', url });
          if (typeof n.description === 'string') out.companyFields.push({ label: 'Site description', value: n.description, tier: 'A', source: 'JSON-LD' });
          const same = (Array.isArray(n.sameAs) ? n.sameAs.filter((x): x is string => typeof x === 'string') : [])
            .map((u) => canonicalSocialUrl(u) ?? u);
          if (same.length) out.companyFields.push({ label: 'Social profiles', value: same.join(' | '), tier: 'B', source: 'JSON-LD' });
          const gh = same.find((s) => /github\.com/i.test(s));
          if (gh) out.identifiers = { githubLogin: gh.replace(/.*github\.com\//i, '').split('/')[0] };
        }
        if (/person/.test(type)) {
          parsed++;
          if (typeof n.jobTitle === 'string') out.personFields.push({ label: 'Title (site)', value: n.jobTitle, tier: 'A', source: 'JSON-LD', url });
          if (typeof n.name === 'string') out.personFields.push({ label: 'Name (site)', value: n.name, tier: 'C', source: 'JSON-LD' });
          const same = (Array.isArray(n.sameAs) ? n.sameAs.filter((x): x is string => typeof x === 'string') : [])
            .map((u) => canonicalSocialUrl(u) ?? u);
          if (same.length) out.personFields.push({ label: 'Profiles (site)', value: same.join(' | '), tier: 'B', source: 'JSON-LD' });
        }
      }
    }

    // OG / meta tags — more widely present than JSON-LD structured data
    const ogTitle = metaContent(html, 'og:title', 'property');
    const ogDesc = metaContent(html, 'og:description', 'property') ?? metaContent(html, 'description', 'name');
    const metaAuthor = metaContent(html, 'author', 'name');
    if (ogTitle && !parsed) out.companyFields.push({ label: 'Site name', value: ogTitle, tier: 'C', source: 'JSON-LD', url });
    if (ogDesc && !parsed) out.companyFields.push({ label: 'Site description', value: ogDesc, tier: 'B', source: 'JSON-LD' });
    if (metaAuthor) out.personFields.push({ label: 'Name (site)', value: metaAuthor, tier: 'C', source: 'JSON-LD', url });

    // rel="me" links — IndieWeb / Mastodon identity claims (high-trust self-declarations)
    const relMeLinks = [...html.matchAll(/<(?:link|a)[^>]+rel=["'][^"']*\bme\b[^"']*["'][^>]+href=["']([^"']{5,300})["']/gi)]
      .map((m) => canonicalSocialUrl(m[1]))
      .filter((u): u is string => u !== null);
    for (const u of [...new Set(relMeLinks)]) {
      out.personFields.push({ label: 'Identity claim', value: u, tier: 'A', source: 'JSON-LD', url: u });
    }

    // Social profile links anywhere in the HTML — canonical form only, deduplicated
    const hrefLinks = [...html.matchAll(/href=["']([^"']{8,300})["']/gi)]
      .map((m) => m[1])
      .filter((u) => !/^(?:#|mailto:|javascript:|tel:|\/(?!\/))/.test(u))
      .map((u) => canonicalSocialUrl(u))
      .filter((u): u is string => u !== null);
    const uniqueSocialLinks = [...new Set(hrefLinks)];
    if (uniqueSocialLinks.length) {
      out.companyFields.push({ label: 'Social links (site)', value: uniqueSocialLinks.join(' | '), tier: 'B', source: 'JSON-LD', url });
    }

    // mailto: addresses on the page — a high-value contact fact for normal subjects.
    const mails = [...new Set([...html.matchAll(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) => m[1].toLowerCase()))].slice(0, 3);
    if (mails.length) out.companyFields.push({ label: 'Emails on site', value: mails.join(', '), tier: 'B', source: 'Site' });
    // Tech-stack fingerprint from the same HTML (no extra fetch).
    const tech = detectTech(html);
    if (tech.length) out.companyFields.push({ label: 'Tech stack (detected)', value: tech.join(', '), tier: 'C', source: 'Site fingerprint' });
  }
  out.steps.push(step('Company JSON-LD', url, r, `${parsed} schema node(s) parsed`));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 8 — RECAP / CourtListener (litigation → Signal)
// ─────────────────────────────────────────────────────────────────────────────

interface ClSearch {
  count?: number;
  results?: Array<{ caseName?: string; dateFiled?: string; absolute_url?: string }>;
}

async function courtlistenerEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'CourtListener', personFields: [], companyFields: [], signals: [], steps: [] };
  const headers: Record<string, string> = { Accept: 'application/json' };
  const tok = process.env.COURTLISTENER_TOKEN;
  if (tok) headers.Authorization = `Token ${tok}`;

  const targets: Array<{ q: string; subject: 'person' | 'company' }> = [];
  if (ctx.name) targets.push({ q: ctx.name, subject: ctx.kind === 'person' ? 'person' : 'company' });
  if (ctx.company && ctx.company !== ctx.name) targets.push({ q: ctx.company, subject: 'company' });

  for (const t of targets) {
    const url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(`"${t.q}"`)}&order_by=dateFiled desc`;
    const r = await fetchJSON<ClSearch>(url, { headers });
    const count = r.data?.count ?? 0;
    const top = r.data?.results?.[0];
    if (count > 0) {
      out.signals.push({
        label: `Litigation — ${t.q}`,
        value: `${count} matching case(s)${top?.caseName ? `; most recent: ${top.caseName}${top.dateFiled ? ` (${top.dateFiled})` : ''}` : ''}`,
        tier: 'B',
        source: 'CourtListener',
        url: top?.absolute_url ? `https://www.courtlistener.com${top.absolute_url}` : 'https://www.courtlistener.com',
        kind: 'signal',
      });
    }
    out.steps.push(step(`CourtListener (${t.subject})`, t.q, r, `${count} case(s)`));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 10 — News (GDELT 2.0 Doc API + Google News RSS)
// ─────────────────────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function newsEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'News', personFields: [], companyFields: [], signals: [], steps: [] };
  const q = ctx.company ?? ctx.name;
  if (!q) {
    out.steps.push({ step: 'News', input: '(none)', output: 'Skipped — no query', durationMs: 0, ok: false });
    return out;
  }
  const into = ctx.kind === 'person' ? out.personFields : out.companyFields;
  const seen = new Set<string>();
  const MAX_NEWS = 3;
  const newsCount = () => into.filter((f) => f.label === 'Recent news').length;

  // 90-day window — single fetch, pick top MAX_NEWS non-overlapping articles by date.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);

  // GDELT 2.0 Doc API (durable; no auth; 90-day window; date-desc)
  const g = await fetchJSON<{ articles?: Array<{ title?: string; url?: string; seendate?: string }> }>(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=25&sort=DateDesc&startdatetime=${sinceStr}`,
  );
  for (const a of g.data?.articles ?? []) {
    if (!a.title || newsCount() >= MAX_NEWS) break;
    const k = norm(a.title);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push({ label: 'Recent news', value: a.title, tier: 'A', source: 'GDELT, Google News', url: a.url });
  }
  out.steps.push(step('GDELT news (90d)', q, g, `${g.data?.articles?.length ?? 0} article(s), kept ${newsCount()}`));

  // Google News RSS — supplement if GDELT came up short
  if (newsCount() < MAX_NEWS) {
    const rss = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { Accept: 'application/rss+xml' },
    });
    if (rss.data) {
      const items = [...rss.data.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15);
      for (const it of items) {
        if (newsCount() >= MAX_NEWS) break;
        const title = decodeXml(it[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
        const link = it[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
        const pubDate = it[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
        if (!title) continue;
        // Skip if older than 90 days
        if (pubDate) {
          const d = new Date(pubDate);
          if (!isNaN(d.getTime()) && d < since) continue;
        }
        const k = norm(title);
        if (seen.has(k)) continue;
        seen.add(k);
        into.push({ label: 'Recent news', value: title, tier: 'A', source: 'Google News', url: link });
      }
    }
    out.steps.push(step('Google News RSS (90d)', q, rss, rss.data ? `supplemented → ${newsCount()} total` : 'failed'));
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources 6 & 9 — State SoS registry & State UCC (deep-link + manual follow-up)
//
// These portals are per-state, frequently CAPTCHA-gated, and have no universal free
// JSON API. Per the plan we route around them: deterministically emit the correct
// state search URL and flag for manual follow-up. No fabricated registry rows.
// ─────────────────────────────────────────────────────────────────────────────

const SOS_SEARCH: Record<string, string> = {
  DE: 'https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx',
  CA: 'https://bizfileonline.sos.ca.gov/search/business',
  NY: 'https://apps.dos.ny.gov/publicInquiry/',
  TX: 'https://mycpa.cpa.state.tx.us/coa/',
  FL: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
  MA: 'https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx',
  WA: 'https://ccfs.sos.wa.gov/#/',
  CO: 'https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do',
};

const UCC_SEARCH: Record<string, string> = {
  DE: 'https://icis.corp.delaware.gov/Ecorp/UccFiling/UccSearch.aspx',
  CA: 'https://bizfileonline.sos.ca.gov/search/ucc',
  NY: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
  TX: 'https://www.sos.state.tx.us/ucc/index.shtml',
  FL: 'https://www.floridaucc.com/uccweb/SearchType.aspx',
  WA: 'https://www.dol.wa.gov/business/ucc/',
};

function stateSosEnrich(ctx: ReportCtx): SourceContribution {
  const out: SourceContribution = { source: 'State SoS registry', personFields: [], companyFields: [], signals: [], steps: [] };
  const company = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (!company) {
    out.steps.push({ step: 'State SoS', input: '(none)', output: 'Skipped — no company', durationMs: 0, ok: false });
    return out;
  }
  const st = (ctx.state ?? '').toUpperCase();
  const link = SOS_SEARCH[st] ?? 'https://www.nass.org/business-services/state-business-resources';
  out.companyFields.push({
    label: 'Registry status check (manual)',
    value: `Search "${company}"${st ? ` in ${st}` : ' (state unknown — pick from list)'} for incorporation status & officers`,
    tier: 'A',
    source: 'State SoS',
    url: link,
  });
  out.steps.push({ step: 'State SoS', input: `${company} / ${st || '?'}`, output: 'Deep-link emitted (manual follow-up; portals are CAPTCHA-gated)', durationMs: 0, ok: true });
  return out;
}

function uccEnrich(ctx: ReportCtx): SourceContribution {
  const out: SourceContribution = { source: 'State UCC', personFields: [], companyFields: [], signals: [], steps: [] };
  const company = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (!company) {
    out.steps.push({ step: 'State UCC', input: '(none)', output: 'Skipped — no company', durationMs: 0, ok: false });
    return out;
  }
  const st = (ctx.state ?? '').toUpperCase();
  const link = UCC_SEARCH[st] ?? 'https://www.nass.org/business-services/state-business-resources';
  out.signals.push({
    label: 'Secured-debt (UCC) check — credit signal',
    value: `Search UCC liens for "${company}"${st ? ` in ${st}` : ' (state unknown)'} — reveals lenders & secured debt`,
    tier: 'B',
    source: 'State UCC',
    url: link,
    kind: 'signal',
  });
  out.steps.push({ step: 'State UCC', input: `${company} / ${st || '?'}`, output: 'Deep-link emitted (manual follow-up)', durationMs: 0, ok: true });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage A — Search-led DISCOVERY via self-hosted SearXNG (the recall layer)
//
// We use a self-hosted SearXNG metasearch instance (SEARXNG_URL) so there is no
// API key, no per-query cost, and no ToS-violating scraping of google.com. It
// aggregates Google/Bing/DDG/etc. results and returns JSON. LinkedIn is never
// fetched — only the public SERP snippet it exposes is read.
// ─────────────────────────────────────────────────────────────────────────────

export const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888';

type HitClass = 'linkedin_person' | 'linkedin_company' | 'company_site' | 'personal_site' | 'social' | 'news' | 'registry' | 'other';

interface ClassifiedHit {
  url: string;
  host: string;
  title: string;
  snippet: string;
  cls: HitClass;
  engine?: string;
}

const SOCIAL_HOSTS = /(?:^|\.)(twitter\.com|x\.com|github\.com|medium\.com|substack\.com|youtube\.com|crunchbase\.com|angel\.co|wellfound\.com|facebook\.com|instagram\.com|threads\.net|bsky\.app)$/i;
const NEWS_HOSTS = /(?:^|\.)(techcrunch\.com|forbes\.com|bloomberg\.com|reuters\.com|wsj\.com|nytimes\.com|businessinsider\.com|axios\.com|theinformation\.com|fortune\.com|cnbc\.com|prnewswire\.com|businesswire\.com|venturebeat\.com)$/i;
const REGISTRY_HOSTS = /(?:^|\.)(sec\.gov|finra\.org|courtlistener\.com|opencorporates\.com|patents\.google\.com)$/i;

function classifyHit(host: string, url: string, companyDomain?: string): HitClass {
  if (/(?:^|\.)linkedin\.com$/i.test(host)) return /\/company\//i.test(url) ? 'linkedin_company' : /\/in\//i.test(url) ? 'linkedin_person' : 'social';
  if (companyDomain && (host === companyDomain || host.endsWith(`.${companyDomain}`))) return 'company_site';
  if (REGISTRY_HOSTS.test(host) || /(?:^|\.)sos\.[a-z]{2}\.gov$/i.test(host)) return 'registry';
  if (NEWS_HOSTS.test(host)) return 'news';
  if (SOCIAL_HOSTS.test(host)) return 'social';
  return 'other';
}

async function searxng(query: string): Promise<FetchResult<{ results?: Array<{ title?: string; url?: string; content?: string; engine?: string }> }>> {
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0`;
  return fetchJSON(url, { headers: { Accept: 'application/json' }, timeoutMs: 12000 });
}

async function discover(input: ReconInput, ctx?: ReportCtx): Promise<{ hits: ClassifiedHit[]; steps: StepLog[] }> {
  const name = input.name || ctx?.name;
  const company = input.company || ctx?.company;
  const loc = input.location || ctx?.location || '';
  const companyDomain = ctx?.domain || domainFromEmail(input.email) || (input.domain ? hostFromUrl(input.domain) : undefined);

  const queries: string[] = [];
  if (name) {
    queries.push([`"${name}"`, company ? `"${company}"` : '', loc].filter(Boolean).join(' '));
    queries.push(`"${name}" ${company ?? ''} (founder OR partner OR investor OR CEO OR principal) LinkedIn`.replace(/\s+/g, ' ').trim());
    queries.push(`"${name}" ${company ?? ''} (interview OR podcast OR profile OR bio)`.replace(/\s+/g, ' ').trim());
  }
  if (company) {
    queries.push(`"${company}" (team OR about OR leadership OR founders)`);
    queries.push(`"${company}" (funding OR raised OR Series OR acquisition)`);
  }

  const steps: StepLog[] = [];
  const byUrl = new Map<string, ClassifiedHit>();
  const responses = await Promise.all(queries.map((qq) => searxng(qq)));
  responses.forEach((r, i) => {
    const results = r.data?.results ?? [];
    for (const res of results.slice(0, 10)) {
      const u = res.url;
      const host = hostFromUrl(u);
      if (!u || !host || byUrl.has(u)) continue;
      byUrl.set(u, { url: u, host, title: res.title ?? '', snippet: res.content ?? '', cls: classifyHit(host, u, companyDomain), engine: res.engine });
    }
    steps.push(step('Web search (SearXNG)', queries[i], r, r.data ? `${results.length} result(s)` : 'no JSON — is SearXNG up with `formats: [json]` enabled?'));
  });

  const order: Record<HitClass, number> = { linkedin_person: 0, company_site: 1, linkedin_company: 2, personal_site: 3, news: 4, social: 5, registry: 6, other: 7 };
  const hits = [...byUrl.values()].sort((a, b) => order[a.cls] - order[b.cls]);
  return { hits, steps };
}

/** Stage A → candidates: a normal person with only a LinkedIn presence still resolves. */
function discoveryCandidates(hits: ClassifiedHit[], input: ReconInput): Identity[] {
  const cands: Identity[] = [];
  for (const h of hits.filter((x) => x.cls === 'linkedin_person').slice(0, 3)) {
    const dn = h.title.replace(/\s*[|\-–·].*$/, '').trim() || input.name || h.title;
    cands.push({
      id: `web:${slug(h.url)}`,
      kind: 'person',
      displayName: dn,
      summary: h.snippet.slice(0, 200),
      confidence: 0.5,
      evidence: [`LinkedIn public snippet: ${h.title}`],
      identifiers: { name: dn },
      sources: ['Web (LinkedIn)'],
    });
  }
  for (const h of hits.filter((x) => x.cls === 'company_site' || x.cls === 'linkedin_company').slice(0, 2)) {
    const dn = input.company || h.title.replace(/\s*[|\-–·].*$/, '').trim();
    if (!dn) continue;
    cands.push({
      id: `web:${slug(h.url)}`,
      kind: inferKind(dn),
      displayName: dn,
      summary: h.snippet.slice(0, 200),
      confidence: 0.45,
      evidence: [`Web: ${h.host}`],
      identifiers: { name: dn, company: dn, domain: h.cls === 'company_site' ? h.host : undefined },
      sources: ['Web'],
    });
  }
  return cands;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage B — EXPAND the discovered footprint into facts (no LinkedIn fetch)
// ─────────────────────────────────────────────────────────────────────────────

function webFootprintEnrich(ctx: ReportCtx, hits: ClassifiedHit[]): SourceContribution {
  const out: SourceContribution = { source: 'Web footprint', personFields: [], companyFields: [], signals: [], steps: [] };
  if (!hits.length) {
    out.steps.push({ step: 'Web footprint', input: '(none)', output: 'No discovery hits (SearXNG returned nothing — check SEARXNG_URL)', durationMs: 0, ok: false });
    return out;
  }
  const li = hits.find((h) => h.cls === 'linkedin_person');
  if (li) {
    out.personFields.push({ label: 'LinkedIn (public snippet)', value: li.snippet || li.title, tier: 'A', source: 'Web (LinkedIn)', url: li.url });
    const m = (li.snippet || li.title).match(/^([^·|]+?)\s+(?:at|@|-)\s+([^·|]+)/i);
    if (m) {
      out.personFields.push({ label: 'Title', value: m[1].trim(), tier: 'A', source: 'Web (LinkedIn)' });
      out.companyFields.push({ label: 'Employer', value: m[2].trim().replace(/\s*\|.*$/, ''), tier: 'A', source: 'Web (LinkedIn)' });
    }
  }
  const socials = hits.filter((h) => h.cls === 'social' || h.cls === 'linkedin_company').slice(0, 8);
  if (socials.length) {
    (ctx.kind === 'person' ? out.personFields : out.companyFields).push({ label: 'Social / web profiles', value: socials.map((s) => s.url).join(' | '), tier: 'B', source: 'Web' });
  }
  const news = hits.filter((h) => h.cls === 'news').slice(0, 5);
  for (const n of news) {
    (ctx.kind === 'person' ? out.personFields : out.companyFields).push({ label: 'Press / news', value: n.title, tier: 'B', source: n.host, url: n.url });
  }
  const sites = hits.filter((h) => h.cls === 'company_site' || h.cls === 'other').slice(0, 4);
  if (sites.length) out.companyFields.push({ label: 'Other web hits', value: sites.map((s) => `${s.title || s.host} (${s.url})`).join(' | '), tier: 'C', source: 'Web' });

  out.steps.push({ step: 'Web footprint', input: `${hits.length} hits`, output: `LinkedIn:${li ? 'yes' : 'no'} social:${socials.length} news:${news.length}`, durationMs: 0, ok: true });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Company team-page enricher — scrapes /team, /about, /people on the known company
// domain to find the person's title, work email, bio, and LinkedIn URL. These are
// almost always rendered server-side (no JS needed) and sitting in plain sight.
// ─────────────────────────────────────────────────────────────────────────────

async function companyTeamEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Company site', personFields: [], companyFields: [], signals: [], steps: [] };
  if (!ctx.domain || ctx.kind !== 'person' || !ctx.name) return out;

  const domain = ctx.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const personTokens = norm(ctx.name).split(/\s+/).filter((t) => t.length > 2);

  // Paths to try in order
  const paths = ['/team', '/about', '/people', '/our-team', '/leadership', '/about-us', '/team.html', '/staff'];

  let html = '';
  let foundPath = '';
  for (const p of paths) {
    const r = await fetchText(`https://${domain}${p}`, { timeoutMs: 8000 });
    if (r.ok && r.data && r.data.length > 500) {
      const lower = r.data.toLowerCase();
      // Only keep if the page mentions the person's name tokens
      const nameHits = personTokens.filter((t) => lower.includes(t)).length;
      if (nameHits >= Math.min(2, personTokens.length)) {
        html = r.data;
        foundPath = p;
        out.steps.push(step('Company team page', `https://${domain}${p}`, r, `Found — ${r.data.length} bytes, name tokens matched`));
        break;
      }
    }
    out.steps.push(step('Company team page', `https://${domain}${p}`, r, r.ok ? 'page exists but name not found' : 'not found'));
  }

  if (!html) return out;

  // Strip tags for text extraction
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');

  // Find the window of text around the person's name (±400 chars)
  const lowerText = text.toLowerCase();
  const namePattern = personTokens.slice(0, 2).join('[\\s\\S]{0,20}');
  const nameMatch = new RegExp(namePattern, 'i').exec(text);
  const window = nameMatch
    ? text.slice(Math.max(0, nameMatch.index - 100), nameMatch.index + 400)
    : text.slice(0, 800);

  // Extract work email — look in window first, then whole page
  const emailRe = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
  const allEmails = [...(window.match(emailRe) ?? []), ...(text.match(emailRe) ?? [])];
  const workEmail = allEmails.find((e) => {
    const d = e.split('@')[1]?.toLowerCase();
    return d && d.includes(domain.replace(/^www\./, '')) && !FREE_EMAIL.has(d);
  });
  if (workEmail) {
    out.personFields.push({ label: 'Work email (company page)', value: workEmail, tier: 'A', source: 'Company site', url: `https://${foundPath ? domain + foundPath : domain}` });
  }

  // Extract LinkedIn URL from page
  const liRe = /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-z0-9\-_%]+)/gi;
  const liMatches = [...html.matchAll(liRe)];
  const liInWindow = liMatches.find((m) => {
    // Prefer handles that look like the person's name
    const h = m[1].toLowerCase();
    return personTokens.some((t) => h.includes(t));
  }) ?? liMatches[0];
  if (liInWindow) {
    const liUrl = liInWindow[0].replace(/\/$/, '');
    out.personFields.push({ label: 'LinkedIn (company page)', value: `/${liInWindow[1]}`, tier: 'A', source: 'Company site', url: liUrl });
  }

  // Extract title — heuristic: short sentence (≤8 words) near the name, looks like a role
  const roleRe = /(?:CEO|CTO|CFO|COO|Founder|Co-Founder|Director|VP|Head|Lead|Manager|Engineer|Partner|Analyst|Advisor|President|Officer|Consultant)[^.]{0,60}/i;
  const titleMatch = roleRe.exec(window);
  if (titleMatch) {
    out.personFields.push({ label: 'Title (company page)', value: titleMatch[0].trim().replace(/\s+/g, ' '), tier: 'A', source: 'Company site', url: `https://${domain}${foundPath}` });
  }

  // Extract a short bio — first sentence that contains the person's last name token
  const lastToken = personTokens[personTokens.length - 1];
  const bioSentences = window.split(/\.(?:\s|$)/).filter((s) => s.toLowerCase().includes(lastToken) && s.trim().length > 30 && s.trim().length < 300);
  if (bioSentences.length) {
    out.personFields.push({ label: 'Bio (company page)', value: bioSentences[0].trim() + '.', tier: 'B', source: 'Company site', url: `https://${domain}${foundPath}` });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — FINRA BrokerCheck (individuals + firms; disclosures → credit/conduct Signal)
// Public JSON API behind brokercheck.finra.org. Far broader than EDGAR ADV for the
// VC/GP/LP world — captures anyone ever registered in securities.
// ─────────────────────────────────────────────────────────────────────────────

const sv = (v: unknown): string => (v == null ? '' : String(v));

interface FinraResp {
  hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
}

async function finraEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'FINRA BrokerCheck', personFields: [], companyFields: [], signals: [], steps: [] };
  const headers = { Accept: 'application/json', Referer: 'https://brokercheck.finra.org/' };

  if (ctx.kind === 'person' && ctx.name) {
    const r = await fetchJSON<FinraResp>(`https://api.brokercheck.finra.org/search/individual?query=${encodeURIComponent(ctx.name)}&hits=3&wt=json`, { headers });
    const hit = r.data?.hits?.hits?.[0]?._source;
    if (hit) {
      const crd = sv(hit.ind_source_id || hit.ind_firm_crd_nb);
      const emp = Array.isArray(hit.ind_current_employments) ? (hit.ind_current_employments as Array<Record<string, unknown>>).map((e) => sv(e.firm_name)).filter(Boolean).join(', ') : '';
      out.personFields.push({
        label: 'FINRA registered (securities)',
        value: `${sv(hit.ind_firstname)} ${sv(hit.ind_lastname)}`.trim() + (crd ? ` (CRD ${crd})` : '') + (emp ? ` — ${emp}` : ''),
        tier: 'A',
        source: 'FINRA',
        url: crd ? `https://brokercheck.finra.org/individual/summary/${crd}` : undefined,
      });
      if (sv(hit.ind_bc_disclosure_fl) === 'Y' || sv(hit.ind_ia_disclosure_fl) === 'Y') {
        out.signals.push({ label: 'FINRA disclosure on record', value: `${ctx.name} has one or more BrokerCheck disclosures (regulatory / customer dispute / financial / criminal event). Review before meeting.`, tier: 'A', source: 'FINRA', url: crd ? `https://brokercheck.finra.org/individual/summary/${crd}` : undefined, kind: 'signal' });
      }
    }
    out.steps.push(step('FINRA individual', ctx.name, r, r.data?.hits?.hits?.length ? 'match' : r.data ? 'no match' : 'blocked/non-JSON'));
  }

  const firmQ = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (firmQ) {
    const r = await fetchJSON<FinraResp>(`https://api.brokercheck.finra.org/search/firm?query=${encodeURIComponent(firmQ)}&hits=3&wt=json`, { headers });
    const hit = r.data?.hits?.hits?.[0]?._source;
    if (hit) {
      const crd = sv(hit.firm_source_id || hit.firm_crd_nb);
      out.companyFields.push({ label: 'FINRA member firm', value: `${sv(hit.firm_name) || firmQ}${crd ? ` (CRD ${crd})` : ''}`, tier: 'A', source: 'FINRA', url: crd ? `https://brokercheck.finra.org/firm/summary/${crd}` : undefined });
      if (sv(hit.firm_bc_disclosure_fl) === 'Y' || sv(hit.firm_ia_disclosure_fl) === 'Y') {
        out.signals.push({ label: 'FINRA firm disclosure', value: `${sv(hit.firm_name) || firmQ} has BrokerCheck disclosure event(s) on record.`, tier: 'A', source: 'FINRA', url: crd ? `https://brokercheck.finra.org/firm/summary/${crd}` : undefined, kind: 'signal' });
      }
    }
    out.steps.push(step('FINRA firm', firmQ, r, r.data?.hits?.hits?.length ? 'match' : r.data ? 'no match' : 'blocked/non-JSON'));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — OpenAlex (free, keyless): academic footprint for technical/research founders
// ─────────────────────────────────────────────────────────────────────────────

async function openAlexEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'OpenAlex', personFields: [], companyFields: [], signals: [], steps: [] };
  if (ctx.kind !== 'person' || !ctx.name) {
    out.steps.push({ step: 'OpenAlex authors', input: ctx.name ?? '(none)', output: 'Skipped — person only', durationMs: 0, ok: false });
    return out;
  }
  const r = await fetchJSON<{ results?: Array<{ display_name?: string; works_count?: number; cited_by_count?: number; id?: string; last_known_institutions?: Array<{ display_name?: string }> }> }>(
    `https://api.openalex.org/authors?search=${encodeURIComponent(ctx.name)}&per_page=1&mailto=badami@wustl.edu`,
  );
  const a = r.data?.results?.[0];
  if (a && (a.works_count ?? 0) > 0) {
    const inst = a.last_known_institutions?.[0]?.display_name;
    out.personFields.push({ label: 'Academic profile', value: `${a.works_count} works, ${a.cited_by_count ?? 0} citations${inst ? ` — ${inst}` : ''}`, tier: 'B', source: 'OpenAlex', url: a.id });
  }
  out.steps.push(step('OpenAlex authors', ctx.name, r, a ? `${a.works_count ?? 0} works` : 'no author'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — ORCID (free, keyless): verified researcher ID + employment/affiliation
// ─────────────────────────────────────────────────────────────────────────────

interface OrcidResp {
  'expanded-result'?: Array<{ 'orcid-id'?: string; 'given-names'?: string; 'family-names'?: string; 'institution-name'?: string[] }>;
  'num-found'?: number;
}

async function orcidEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'ORCID', personFields: [], companyFields: [], signals: [], steps: [] };
  if (ctx.kind !== 'person' || !ctx.name) {
    out.steps.push({ step: 'ORCID search', input: ctx.name ?? '(none)', output: 'Skipped — person only', durationMs: 0, ok: false });
    return out;
  }
  const r = await fetchJSON<OrcidResp>(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(ctx.name)}&rows=1`, {
    headers: { Accept: 'application/json' },
  });
  const hit = r.data?.['expanded-result']?.[0];
  if (hit?.['orcid-id']) {
    const inst = (hit['institution-name'] ?? []).filter(Boolean).slice(0, 3).join(', ');
    out.personFields.push({
      label: 'ORCID (researcher ID)',
      value: `${hit['given-names'] ?? ''} ${hit['family-names'] ?? ''}`.trim() + (inst ? ` — ${inst}` : ''),
      tier: 'B',
      source: 'ORCID',
      url: `https://orcid.org/${hit['orcid-id']}`,
    });
  }
  out.steps.push(step('ORCID search', ctx.name, r, hit?.['orcid-id'] ? hit['orcid-id'] : `${r.data?.['num-found'] ?? 0} match(es)`));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — Semantic Scholar (free, keyless): citations, h-index, affiliations
// ─────────────────────────────────────────────────────────────────────────────

interface S2Resp {
  data?: Array<{ authorId?: string; name?: string; affiliations?: string[]; paperCount?: number; citationCount?: number; hIndex?: number; url?: string }>;
}

async function semanticScholarEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Semantic Scholar', personFields: [], companyFields: [], signals: [], steps: [] };
  if (ctx.kind !== 'person' || !ctx.name) {
    out.steps.push({ step: 'Semantic Scholar', input: ctx.name ?? '(none)', output: 'Skipped — person only', durationMs: 0, ok: false });
    return out;
  }
  const r = await fetchJSON<S2Resp>(
    `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(ctx.name)}&fields=name,affiliations,paperCount,citationCount,hIndex,url&limit=1`,
    { headers: { Accept: 'application/json' } },
  );
  const a = r.data?.data?.[0];
  if (a && ((a.paperCount ?? 0) > 0 || (a.citationCount ?? 0) > 0)) {
    const aff = (a.affiliations ?? []).filter(Boolean).slice(0, 2).join(', ');
    out.personFields.push({
      label: 'Research impact',
      value: `${a.paperCount ?? 0} papers, ${a.citationCount ?? 0} citations, h-index ${a.hIndex ?? '?'}${aff ? ` — ${aff}` : ''}`,
      tier: 'B',
      source: 'Semantic Scholar',
      url: a.url,
    });
  }
  out.steps.push(step('Semantic Scholar', ctx.name, r, a ? `${a.paperCount ?? 0} papers` : 'no author'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — Cross-platform username enumeration (WhatsMyName open dataset)
//
// Subsumes Sherlock / FindME / UserReCon / Lullar: given a handle, probe many
// platforms and report where an account exists. We use WhatsMyName's open JSON
// site list (URI pattern + existence rule) and run the checks ourselves — zero
// key, deterministic, no scraping of a walled service. Curated ~40 sites by
// default; 'full' runs the whole 700+ list on demand.
// ─────────────────────────────────────────────────────────────────────────────

interface WmnSite {
  name: string;
  uri_check: string;
  uri_pretty?: string;
  e_code?: number;
  e_string?: string;
  m_code?: number;
  m_string?: string;
  cat?: string;
}

const WMN_URL = 'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';
let WMN_CACHE: WmnSite[] | null = null;

// High-signal platforms for routine pre-meeting research (founders/GPs/operators).
const CURATED_SITES = new Set([
  'GitHub', 'GitLab', 'Twitter', 'X', 'Instagram', 'Facebook', 'Reddit', 'YouTube', 'TikTok',
  'Medium', 'Substack', 'Telegram', 'Keybase', 'Pinterest', 'Twitch', 'SoundCloud', 'Spotify',
  'PyPI', 'npm', 'Docker Hub', 'Stack Overflow', 'HackerNews', 'Patreon', 'Behance', 'Dribbble',
  'DeviantArt', 'Flickr', 'Vimeo', 'Gravatar', 'AngelList', 'Wellfound', 'ProductHunt', 'Replit',
  'Kaggle', 'HuggingFace', 'About.me', 'Linktree', 'Mastodon', 'Bluesky', 'Threads',
]);

async function wmnSites(mode: 'curated' | 'full'): Promise<WmnSite[]> {
  if (!WMN_CACHE) {
    const r = await fetchJSON<{ sites?: WmnSite[] }>(WMN_URL, { timeoutMs: 12000 });
    WMN_CACHE = r.data?.sites ?? [];
  }
  return mode === 'full' ? WMN_CACHE : WMN_CACHE.filter((s) => CURATED_SITES.has(s.name));
}

/** Bounded-concurrency map so a 40–700 site sweep doesn't open hundreds of sockets at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return ret;
}

async function usernameEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Username enumeration', personFields: [], companyFields: [], signals: [], steps: [] };
  const mode = ctx.usernameScan ?? 'curated';
  const handles = ctx.handles ?? [];
  if (mode === 'off' || !handles.length) {
    out.steps.push({ step: 'Username scan', input: handles.join(', ') || '(no handle)', output: mode === 'off' ? 'Disabled' : 'Skipped — no handle to probe', durationMs: 0, ok: false });
    return out;
  }
  const t0 = Date.now();
  const sites = await wmnSites(mode);
  if (!sites.length) {
    out.steps.push({ step: 'Username scan', input: handles.join(', '), output: 'Could not load WhatsMyName dataset', durationMs: Date.now() - t0, ok: false });
    return out;
  }
  const tasks = handles.flatMap((h) => sites.map((s) => ({ h, s })));
  const into = ctx.kind === 'person' ? out.personFields : out.companyFields;
  let found = 0;
  await mapLimit(tasks, 12, async ({ h, s }) => {
    if (!s.uri_check) return;
    const url = s.uri_check.replace(/\{account\}/g, encodeURIComponent(h));
    const r = await fetchText(url, { timeoutMs: 8000, headers: { Accept: 'text/html' } });
    // Full WhatsMyName algorithm: account EXISTS when the "exists" code+string match
    // AND the "missing" code/string do NOT — the m_* negative guard is what kills the
    // soft-404 / not-found pages (which often still echo the handle) that name
    // permutations otherwise trigger.
    const codeOk = s.e_code == null || r.status === s.e_code;
    const stringOk = !s.e_string || (r.data ? r.data.includes(s.e_string) : false);
    const missingByCode = s.m_code != null && r.status === s.m_code;
    const missingByString = !!s.m_string && (r.data ? r.data.includes(s.m_string) : false);
    const handleOnPage = r.data ? r.data.toLowerCase().includes(h.toLowerCase()) : false;
    if (r.status > 0 && codeOk && stringOk && handleOnPage && !missingByCode && !missingByString) {
      found++;
      into.push({ label: `Account — ${s.name}`, value: `@${h}`, tier: 'B', source: 'WhatsMyName', url: (s.uri_pretty || s.uri_check).replace(/\{account\}/g, h) });
    }
  });
  out.steps.push({ step: `Username scan (${mode})`, input: handles.join(', '), output: `${found} account(s) across ${sites.length} site(s) × ${handles.length} handle(s)`, durationMs: Date.now() - t0, ok: true });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — Social Searcher (OPTIONAL, keyed): public social mentions/profiles.
// Off unless SOCIAL_SEARCHER_KEY is set (free tier has a tiny quota).
// ─────────────────────────────────────────────────────────────────────────────

async function socialSearcherEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Social Searcher', personFields: [], companyFields: [], signals: [], steps: [] };
  const key = process.env.SOCIAL_SEARCHER_KEY;
  const q = ctx.name ?? ctx.company;
  if (!key) {
    out.steps.push({ step: 'Social Searcher', input: q ?? '(none)', output: 'Skipped — set SOCIAL_SEARCHER_KEY to enable', durationMs: 0, ok: false });
    return out;
  }
  if (!q) {
    out.steps.push({ step: 'Social Searcher', input: '(none)', output: 'Skipped — no query', durationMs: 0, ok: false });
    return out;
  }
  const r = await fetchJSON<{ posts?: Array<{ network?: string; text?: string; url?: string; user?: { name?: string; url?: string } }> }>(
    `https://api.social-searcher.com/v2/search?q=${encodeURIComponent(`"${q}"`)}&key=${key}&limit=10`,
  );
  const posts = r.data?.posts ?? [];
  const into = ctx.kind === 'person' ? out.personFields : out.companyFields;
  if (posts.length) {
    const networks = [...new Set(posts.map((p) => p.network).filter(Boolean))];
    if (networks.length) into.push({ label: 'Social mentions (networks)', value: networks.join(', '), tier: 'C', source: 'Social Searcher' });
    const sample = posts.find((p) => p.url);
    if (sample) into.push({ label: 'Recent social post', value: (sample.text ?? '').slice(0, 120) || sample.network || 'post', tier: 'C', source: `Social Searcher / ${sample.network ?? ''}`, url: sample.url });
  }
  out.steps.push(step('Social Searcher', q, r, `${posts.length} post(s)`));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expansion — Interpol Red Notices (FREE, selective API): wanted-persons screen.
// Replaces the now-keyed OpenSanctions. The list-based sanctions sources (OFAC SDN,
// EU/UK consolidated, World Bank debarred) are bulk files → deferred to a cached
// reference-list refresh (see EXPANSION.md), the alternative to per-query bulk.
// ─────────────────────────────────────────────────────────────────────────────

interface InterpolNotice {
  forename?: string;
  name?: string;
  date_of_birth?: string;
  nationalities?: string[];
  entity_id?: string;
}

async function interpolEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Interpol Red Notices', personFields: [], companyFields: [], signals: [], steps: [] };
  if (ctx.kind !== 'person' || !ctx.name) {
    out.steps.push({ step: 'Interpol Red Notices', input: ctx.name ?? '(none)', output: 'Skipped — person only', durationMs: 0, ok: false });
    return out;
  }
  const parts = ctx.name.trim().split(/\s+/);
  const forename = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const family = parts[parts.length - 1];
  const url = `https://ws-public.interpol.int/notices/v1/red?name=${encodeURIComponent(family)}${forename ? `&forename=${encodeURIComponent(forename)}` : ''}&resultPerPage=5`;
  const r = await fetchJSON<{ total?: number; _embedded?: { notices?: InterpolNotice[] } }>(url, { headers: { Accept: 'application/json' }, timeoutMs: 12000 });
  const notices = r.data?._embedded?.notices ?? [];
  if (notices.length) {
    const n = notices[0];
    const who = [n.forename, n.name].filter(Boolean).join(' ');
    out.signals.push({
      label: 'Interpol Red Notice — name match, review',
      value: `${who}${n.nationalities?.length ? ` (${n.nationalities.join(', ')})` : ''}${n.date_of_birth ? `, DOB ${n.date_of_birth}` : ''} — ${r.data?.total ?? notices.length} notice(s) match this name`,
      tier: 'A',
      source: 'Interpol',
      url: 'https://www.interpol.int/How-we-work/Notices/View-Red-Notices',
      kind: 'signal',
    });
  }
  out.steps.push(step('Interpol Red Notices', ctx.name, r, notices.length ? `${r.data?.total ?? notices.length} match(es)` : 'no match'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expansion Phase 1 — Email pattern inference + MX confirmation (Hunter-lite).
// Derive likely corporate emails and confirm the domain accepts mail (MX exists).
// SMTP RCPT delivery-verification is deferred to Phase 3 (flaky / catch-all).
// ─────────────────────────────────────────────────────────────────────────────

async function emailInferEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Email inference', personFields: [], companyFields: [], signals: [], steps: [] };
  if (ctx.kind !== 'person' || !ctx.name || !ctx.domain) {
    out.steps.push({ step: 'Email inference', input: `${ctx.name ?? '?'} @ ${ctx.domain ?? '?'}`, output: 'Skipped — need person name + company domain', durationMs: 0, ok: false });
    return out;
  }
  const t0 = Date.now();
  let mx: string | undefined;
  try {
    const recs = await resolveMx(ctx.domain);
    mx = recs.sort((a, b) => a.priority - b.priority)[0]?.exchange;
  } catch {
    /* no MX / NXDOMAIN — leave undefined */
  }
  const parts = ctx.name.toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z]/g, '')).filter(Boolean);
  if (mx && parts.length >= 2) {
    const [f, l] = [parts[0], parts[parts.length - 1]];
    const pats = [`${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}`, `${f}_${l}`, `${f[0]}.${l}`];
    const emails = [...new Set(pats)].map((p) => `${p}@${ctx.domain}`);
    out.personFields.push({ label: 'Likely email patterns (MX confirmed, unverified)', value: emails.slice(0, 4).join(', '), tier: 'B', source: 'Email inference' });
    out.personFields.push({ label: 'Mail provider (MX)', value: mx, tier: 'C', source: 'DNS' });
  }
  out.steps.push({ step: 'Email inference', input: `${ctx.name} @ ${ctx.domain}`, output: mx ? `MX ${mx}; patterns emitted (no SMTP verify — Phase 3)` : 'no MX record', durationMs: Date.now() - t0, ok: !!mx });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expansion Phase 1 — Free social-mention layer (Reddit JSON + HN Algolia).
// Routes around the licensed Twitter/X firehose that paid social-listening sells.
// Phase 2 extends it keylessly with Bluesky (public AppView) + Mastodon (best-effort).
// ─────────────────────────────────────────────────────────────────────────────

// Phase 2 — Bluesky public AppView. Keyless actor search at public.api.bsky.app
// answers "does a matching profile exist" (handle + display name + bio). Bluesky is
// where much of the VC/tech/founder world migrated, so it is high-signal for Recon.
// NB: feed.searchPosts is auth-walled (403) on the public AppView, so we use actor
// search only — no always-failing step.
const BSKY_APPVIEW = 'https://public.api.bsky.app';

interface BskyActor {
  did?: string;
  handle?: string;
  displayName?: string;
  description?: string;
}

async function blueskyEnrich(ctx: ReportCtx, into: Field[]): Promise<StepLog[]> {
  const q = ctx.name ?? ctx.company;
  if (!q) return [{ step: 'Bluesky search', input: '(none)', output: 'Skipped — no query', durationMs: 0, ok: false }];

  const ar = await fetchJSON<{ actors?: BskyActor[] }>(
    `${BSKY_APPVIEW}/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(q)}&limit=5`,
    { timeoutMs: 10000 },
  );
  const actors = ar.data?.actors ?? [];
  // Actor relevance ranking is fuzzy — surfacing an unrelated person is misleading.
  // Prefer an exact-ish name match (displayName equals the query, else handle/displayName
  // contains it); only fall back to top-1 when nothing matches.
  const nq = norm(q);
  const exact = actors.find((a) => a.displayName && norm(a.displayName) === nq);
  const partial = actors.find((a) => (a.displayName && norm(a.displayName).includes(nq)) || (a.handle && a.handle.toLowerCase().includes(nq.replace(/\s+/g, ''))));
  const pick = exact ?? partial ?? actors[0];
  const matched = pick === exact || pick === partial;
  if (pick?.handle) {
    into.push({
      label: matched ? 'Bluesky profile' : 'Bluesky profile (closest match — verify)',
      value: `@${pick.handle}${pick.displayName ? ` (${pick.displayName})` : ''}${pick.description ? ` — ${pick.description.slice(0, 80)}` : ''}`,
      tier: matched ? 'B' : 'C',
      source: 'Bluesky',
      url: `https://bsky.app/profile/${pick.handle}`,
    });
  }
  return [step('Bluesky actor search', q, ar, `${actors.length} profile(s)${pick && matched ? ` — matched @${pick.handle}` : ''}`)];
}

// Phase 2 — Mastodon (best-effort, keyless). The fediverse has no global index;
// mastodon.social's public v2 account search answers "does a matching account exist"
// on the largest instance. Many instances now auth-wall this, so it degrades
// gracefully (403/401 → logged no-data), matching the Interpol/Aleph pattern.
async function mastodonEnrich(ctx: ReportCtx, into: Field[]): Promise<StepLog[]> {
  const q = ctx.name ?? ctx.company;
  if (!q) return [{ step: 'Mastodon search', input: '(none)', output: 'Skipped — no query', durationMs: 0, ok: false }];
  const instance = process.env.MASTODON_INSTANCE || 'mastodon.social';
  const r = await fetchJSON<Array<{ acct?: string; display_name?: string; url?: string; followers_count?: number }>>(
    `https://${instance}/api/v2/search?q=${encodeURIComponent(q)}&type=accounts&limit=3`,
    { timeoutMs: 10000 },
  );
  // v2 search returns {accounts:[…]} when authed, or a bare array on some builds; handle both.
  const accounts = Array.isArray(r.data) ? r.data : ((r.data as { accounts?: Array<{ acct?: string; display_name?: string; url?: string }> } | null)?.accounts ?? []);
  const a = accounts[0];
  if (a?.url) {
    into.push({ label: 'Mastodon profile', value: `@${a.acct ?? '?'}${a.display_name ? ` (${a.display_name})` : ''} on ${instance}`, tier: 'C', source: 'Mastodon', url: a.url });
  }
  return [step('Mastodon search', `${q} @ ${instance}`, r, accounts.length ? `${accounts.length} account(s)` : r.data ? 'no account match' : 'auth-walled / no data (set MASTODON_INSTANCE)')];
}

async function socialMentionsEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Social mentions', personFields: [], companyFields: [], signals: [], steps: [] };
  const q = ctx.name ?? ctx.company;
  if (!q) {
    out.steps.push({ step: 'Social mentions', input: '(none)', output: 'Skipped — no query', durationMs: 0, ok: false });
    return out;
  }
  const into = ctx.kind === 'person' ? out.personFields : out.companyFields;

  const rd = await fetchJSON<{ data?: { children?: Array<{ data?: { title?: string; permalink?: string; subreddit?: string } }> } }>(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${q}"`)}&limit=8&sort=relevance`,
    { headers: { 'User-Agent': SEC_UA } },
  );
  let rc = 0;
  for (const c of rd.data?.data?.children ?? []) {
    const d = c.data;
    if (!d?.title || rc >= 3) break;
    rc++;
    into.push({ label: 'Reddit mention', value: `${d.title} (r/${d.subreddit ?? '?'})`, tier: 'C', source: 'Reddit', url: d.permalink ? `https://www.reddit.com${d.permalink}` : undefined });
  }
  out.steps.push(step('Reddit search', q, rd, `${rd.data?.data?.children?.length ?? 0} post(s)`));

  const hn = await fetchJSON<{ hits?: Array<{ title?: string; url?: string; objectID?: string }> }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=5`,
  );
  let hc = 0;
  for (const h of hn.data?.hits ?? []) {
    if (!h.title || hc >= 2) break;
    hc++;
    into.push({ label: 'Hacker News', value: h.title, tier: 'C', source: 'HN', url: h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : undefined) });
  }
  out.steps.push(step('Hacker News search', q, hn, `${hn.data?.hits?.length ?? 0} story(ies)`));

  // Phase 2 — keyless fediverse + Bluesky layer (parallel; each degrades on its own).
  const [bsky, masto] = await Promise.all([blueskyEnrich(ctx, into), mastodonEnrich(ctx, into)]);
  out.steps.push(...bsky, ...masto);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — HIBP breach exposure (keyed-optional). Have I Been Pwned's
// breach-by-account API requires a paid key (hibp-api-key); without it we skip
// gracefully. A breach hit is a security Signal (credential-hygiene / account-takeover
// risk for the subject), mapped to the Bridge Signal model.
// ─────────────────────────────────────────────────────────────────────────────

interface HibpBreach {
  Name?: string;
  BreachDate?: string;
  Domain?: string;
}

async function hibpEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'HIBP', personFields: [], companyFields: [], signals: [], steps: [] };
  const key = process.env.HIBP_API_KEY;
  const email = ctx.email;
  if (!key) {
    out.steps.push({ step: 'HIBP breach screen', input: email ?? '(no email)', output: 'Skipped — set HIBP_API_KEY to enable (paid)', durationMs: 0, ok: false });
    return out;
  }
  if (!email) {
    out.steps.push({ step: 'HIBP breach screen', input: '(none)', output: 'Skipped — need an email address', durationMs: 0, ok: false });
    return out;
  }
  // truncateResponse=true → names + dates only (no exposed-data classes), enough for a Signal.
  const r = await fetchJSON<HibpBreach[]>(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    { headers: { 'hibp-api-key': key, 'User-Agent': SEC_UA }, timeoutMs: 12000 },
  );
  // HIBP returns 404 (not ok) when the account is in zero breaches — that is a clean "no exposure".
  const breaches = r.data ?? [];
  if (r.status === 404) {
    out.steps.push({ step: 'HIBP breach screen', input: email, output: 'No breaches on record', durationMs: r.ms, ok: true });
    return out;
  }
  if (breaches.length) {
    const recent = [...breaches].sort((a, b) => (b.BreachDate ?? '').localeCompare(a.BreachDate ?? '')).slice(0, 5);
    out.signals.push({
      label: 'Breach exposure (HIBP) — security signal',
      value: `${email} appears in ${breaches.length} known breach(es); recent: ${recent.map((b) => `${b.Name}${b.BreachDate ? ` (${b.BreachDate.slice(0, 4)})` : ''}`).join(', ')}`,
      tier: 'B',
      source: 'HIBP',
      url: 'https://haveibeenpwned.com/',
      kind: 'signal',
    });
  }
  out.steps.push(step('HIBP breach screen', email, r, breaches.length ? `${breaches.length} breach(es)` : 'no breaches'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — OCCRP Aleph (free; anonymous for public collections, ALEPH_KEY for more).
// Investigative depth: leaks, registries, corporate networks, sanctions/PEP datasets.
// ─────────────────────────────────────────────────────────────────────────────

async function alephEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'OCCRP Aleph', personFields: [], companyFields: [], signals: [], steps: [] };
  const q = ctx.name ?? ctx.company;
  if (!q) {
    out.steps.push({ step: 'OCCRP Aleph', input: '(none)', output: 'Skipped — no name/company', durationMs: 0, ok: false });
    return out;
  }
  const base = process.env.ALEPH_URL || 'https://aleph.occrp.org';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.ALEPH_KEY;
  if (key) headers.Authorization = `ApiKey ${key}`;
  const r = await fetchJSON<{ total?: number; results?: Array<{ id?: string; schema?: string; collection?: { label?: string }; properties?: { name?: string[] }; links?: { ui?: string } }> }>(
    `${base}/api/2/entities?q=${encodeURIComponent(q)}&limit=5`,
    { headers, timeoutMs: 12000 },
  );
  const results = r.data?.results ?? [];
  if (results.length) {
    const top = results[0];
    const nm = top.properties?.name?.[0] ?? q;
    out.signals.push({
      label: 'OCCRP Aleph — investigative record, review',
      value: `${nm} — ${top.schema ?? 'entity'} in "${top.collection?.label ?? 'collection'}" (${r.data?.total ?? results.length} match(es))`,
      tier: 'B',
      source: 'OCCRP Aleph',
      url: top.links?.ui ?? `${base}/search?q=${encodeURIComponent(q)}`,
      kind: 'signal',
    });
  }
  out.steps.push(step('OCCRP Aleph', q, r, results.length ? `${r.data?.total ?? results.length} match(es)` : r.data ? 'no match' : 'auth/blocked'));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — OFAC SDN sanctions screen (free). Not per-query bulk: the list is
// downloaded ONCE, cached to data/ofac-sdn.json, refreshed weekly, and names are
// screened in-memory. This is the "cached reference-list" alternative to bulk.
// ─────────────────────────────────────────────────────────────────────────────

const OFAC_CACHE = path.join(process.cwd(), 'data', 'ofac-sdn.json');
const OFAC_CSV = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const OFAC_TTL_MS = 7 * 24 * 3600 * 1000;

interface SdnEntry {
  name: string;
  type: string;
  program: string;
}
let SDN_MEM: SdnEntry[] | null = null;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function parseSdn(csv: string): SdnEntry[] {
  const out: SdnEntry[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const name = (f[1] ?? '').trim();
    if (!name || name === '-0-') continue;
    out.push({ name, type: (f[2] ?? '').trim(), program: (f[3] ?? '').trim() });
  }
  return out;
}

async function loadSdn(): Promise<SdnEntry[]> {
  if (SDN_MEM) return SDN_MEM;
  try {
    const raw = await fs.readFile(OFAC_CACHE, 'utf8');
    const c = JSON.parse(raw) as { fetchedAt: string; entries: SdnEntry[] };
    if (c.entries?.length && Date.now() - new Date(c.fetchedAt).getTime() < OFAC_TTL_MS) {
      SDN_MEM = c.entries;
      return SDN_MEM;
    }
  } catch {
    /* no/stale cache → fetch fresh */
  }
  const r = await fetchText(OFAC_CSV, { timeoutMs: 20000 });
  if (!r.data) return SDN_MEM ?? [];
  const entries = parseSdn(r.data);
  SDN_MEM = entries;
  try {
    await fs.mkdir(path.dirname(OFAC_CACHE), { recursive: true });
    await fs.writeFile(OFAC_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), entries }));
  } catch {
    /* cache write best-effort */
  }
  return entries;
}

async function ofacEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'OFAC SDN', personFields: [], companyFields: [], signals: [], steps: [] };
  const targets: string[] = [];
  if (ctx.name) targets.push(ctx.name);
  const company = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (company && company !== ctx.name) targets.push(company);
  if (!targets.length) {
    out.steps.push({ step: 'OFAC SDN screen', input: '(none)', output: 'Skipped — no name/company', durationMs: 0, ok: false });
    return out;
  }
  const t0 = Date.now();
  const sdn = await loadSdn();
  if (!sdn.length) {
    out.steps.push({ step: 'OFAC SDN screen', input: targets.join(', '), output: 'SDN list unavailable (download failed)', durationMs: Date.now() - t0, ok: false });
    return out;
  }
  for (const q of targets) {
    const qn = norm(q);
    const qtokens = qn.split(' ').filter((t) => t.length > 2);
    if (!qtokens.length) continue;
    const match = sdn.find((e) => {
      const en = norm(e.name);
      return en === qn || (qtokens.length >= 2 && qtokens.every((t) => en.includes(t)));
    });
    if (match) {
      out.signals.push({
        label: 'OFAC SDN (US sanctions) — name match, review',
        value: `"${q}" ~ "${match.name}" — program ${match.program || 'n/a'} (${match.type || 'entity'})`,
        tier: 'A',
        source: 'OFAC',
        url: 'https://sanctionssearch.ofac.treas.gov/',
        kind: 'signal',
      });
    }
  }
  out.steps.push({ step: 'OFAC SDN screen', input: targets.join(', '), output: `screened vs ${sdn.length} SDN entries`, durationMs: Date.now() - t0, ok: true });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Company research — Hiring signals (Greenhouse + Lever public job boards, free JSON).
// Open roles = growth/momentum and a window into priorities, locations, and team shape.
// ─────────────────────────────────────────────────────────────────────────────

function slugCandidates(ctx: ReportCtx): string[] {
  const set = new Set<string>();
  const c = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (c) {
    set.add(c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    set.add(c.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|the)\b/g, '').replace(/[^a-z0-9]/g, ''));
  }
  if (ctx.domain) set.add(ctx.domain.split('.')[0].replace(/[^a-z0-9]/g, ''));
  return [...set].filter((s) => s.length >= 2).slice(0, 3);
}

async function hiringEnrich(ctx: ReportCtx): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Hiring signals', personFields: [], companyFields: [], signals: [], steps: [] };
  const company = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);
  if (!company) {
    out.steps.push({ step: 'Hiring signals', input: '(none)', output: 'Skipped — no company', durationMs: 0, ok: false });
    return out;
  }
  const slugs = slugCandidates(ctx);
  for (const slug of slugs) {
    const gh = await fetchJSON<{ jobs?: Array<{ title?: string; location?: { name?: string } }> }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { timeoutMs: 9000 });
    if (gh.ok && gh.data?.jobs?.length) {
      const jobs = gh.data.jobs;
      out.companyFields.push({ label: 'Open roles (Greenhouse)', value: `${jobs.length} posting(s); e.g. ${jobs.slice(0, 3).map((j) => j.title).filter(Boolean).join('; ')}`, tier: 'B', source: 'Greenhouse', url: `https://boards.greenhouse.io/${slug}` });
      out.steps.push(step('Greenhouse jobs', slug, gh, `${jobs.length} role(s)`));
      return out;
    }
    const lv = await fetchJSON<Array<{ text?: string; categories?: { location?: string; team?: string } }>>(`https://api.lever.co/v0/postings/${slug}?mode=json`, { timeoutMs: 9000 });
    if (lv.ok && Array.isArray(lv.data) && lv.data.length) {
      const jobs = lv.data;
      out.companyFields.push({ label: 'Open roles (Lever)', value: `${jobs.length} posting(s); e.g. ${jobs.slice(0, 3).map((j) => j.text).filter(Boolean).join('; ')}`, tier: 'B', source: 'Lever', url: `https://jobs.lever.co/${slug}` });
      out.steps.push(step('Lever jobs', slug, lv, `${jobs.length} role(s)`));
      return out;
    }
  }
  out.steps.push({ step: 'Hiring signals', input: slugs.join(', '), output: 'No Greenhouse/Lever board for slug candidates', durationMs: 0, ok: false });
  return out;
}

// Lightweight tech-stack fingerprint from a page's HTML (Wappalyzer-style signatures).
function detectTech(html: string): string[] {
  const sigs: Array<[string, RegExp]> = [
    ['Next.js', /__NEXT_DATA__|\/_next\//],
    ['React', /data-reactroot|react(?:-dom)?(?:\.production)?\.min\.js/],
    ['Vue', /data-v-[0-9a-f]{8}|vue(?:\.runtime)?(?:\.global)?\.js/],
    ['Angular', /ng-version=|\bng-app\b/],
    ['Svelte', /svelte-[0-9a-z]{6}/],
    ['Gatsby', /___gatsby/],
    ['WordPress', /wp-content|wp-includes/],
    ['Shopify', /cdn\.shopify\.com|Shopify\.theme/],
    ['Webflow', /data-wf-page|webflow\.js/],
    ['Squarespace', /Static\.SQUARESPACE|squarespace\.com/],
    ['Wix', /static\.wixstatic\.com/],
    ['HubSpot', /hs-scripts\.com|js\.hs-analytics/],
    ['Segment', /cdn\.segment\.com/],
    ['Google Analytics', /googletagmanager\.com|google-analytics\.com|gtag\(/],
    ['Intercom', /widget\.intercom\.io|intercomSettings/],
    ['Stripe', /js\.stripe\.com/],
  ];
  return sigs.filter(([, re]) => re.test(html)).map(([n]) => n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C — Deep-links, GATED + VERIFIED (noise reduction).
//
// Instead of always emitting pointers, we (a) only show Patents/Scholar when the
// subject already shows a technical/academic signal, and (b) for OpenCorporates we
// actually fetch the public search page and parse the result count — so a link is
// shown as "✓ N matches" (verified, useful) or dropped entirely when there are 0.
// Links we cannot check for free (anti-bot) are clearly marked unverified pointers.
// Phase 3: a headless browser would let us verify the JS-rendered/anti-bot ones
// (Patents results, SoS/UCC) — deferred to keep this build zero-dependency.
// ─────────────────────────────────────────────────────────────────────────────

interface DeepLinkFlags {
  hasAcademic: boolean;
  isTechnical: boolean;
}

/** Parse an OpenCorporates search-results page for its match count. null = undetermined. */
function parseOcCount(html?: string | null): number | null {
  if (!html) return null;
  if (/no (?:companies|officers|results)\b|did not match|0 results/i.test(html)) return 0;
  const m = html.match(/of\s+([\d,]+)\s+(?:companies|officers|results)/i);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  return null; // couldn't determine (blocked / layout change) → treat as unverified
}

/** Fetch OpenCorporates via the browser sidecar (gets past Cloudflare) when configured,
 *  else plain fetch (which hits the CAPTCHA → unverified). */
async function ocFetch(url: string): Promise<{ html: string | null; via: string }> {
  if (solverConfigured()) {
    const s = await fetchRendered(url, 40000);
    if (s.ok && s.html) return { html: s.html, via: s.via };
  }
  const r = await fetchText(url, { timeoutMs: 9000, headers: { Accept: 'text/html' } });
  return { html: r.data, via: 'fetch' };
}

async function verifiedDeepLinks(ctx: ReportCtx, flags: DeepLinkFlags): Promise<SourceContribution> {
  const out: SourceContribution = { source: 'Registries (verified)', personFields: [], companyFields: [], signals: [], steps: [] };
  const company = ctx.company ?? (ctx.kind !== 'person' ? ctx.name : undefined);

  if (company) {
    const url = `https://opencorporates.com/companies?q=${encodeURIComponent(company)}`;
    const f = await ocFetch(url);
    const count = parseOcCount(f.html);
    if (count === null) out.companyFields.push({ label: 'OpenCorporates (unverified)', value: `Search "${company}" manually`, tier: 'C', source: 'OpenCorporates', url });
    else if (count > 0) out.companyFields.push({ label: 'OpenCorporates ✓', value: `${count} registry match(es) for "${company}"`, tier: 'B', source: 'OpenCorporates', url });
    // count === 0 → omit entirely (this is the noise removal)
    out.steps.push({ step: 'OpenCorporates verify (company)', input: company, output: count === null ? `unverified (${f.via}, could not parse)` : `${count} match(es) via ${f.via}`, durationMs: 0, ok: count !== null });
  }

  if (ctx.name && ctx.kind === 'person') {
    const url = `https://opencorporates.com/officers?q=${encodeURIComponent(ctx.name)}`;
    const f = await ocFetch(url);
    const count = parseOcCount(f.html);
    if (count === null) out.personFields.push({ label: 'OpenCorporates officer (unverified)', value: `Search "${ctx.name}" manually`, tier: 'C', source: 'OpenCorporates', url });
    else if (count > 0) out.personFields.push({ label: 'OpenCorporates officer ✓', value: `${count} officer/director record(s) for "${ctx.name}"`, tier: 'B', source: 'OpenCorporates', url });
    out.steps.push({ step: 'OpenCorporates verify (officer)', input: ctx.name, output: count === null ? `unverified (${f.via}, could not parse)` : `${count} record(s) via ${f.via}`, durationMs: 0, ok: count !== null });

    // Gated pointers — only when the subject already shows the relevant footprint.
    if (flags.isTechnical) {
      out.personFields.push({ label: 'Patents (inventor)', value: `Google Patents for "${ctx.name}" (unverified pointer)`, tier: 'C', source: 'Google Patents', url: `https://patents.google.com/?inventor=${encodeURIComponent(ctx.name)}` });
    }
    if (flags.hasAcademic) {
      out.personFields.push({ label: 'Google Scholar', value: `Publications for "${ctx.name}" (no API — manual)`, tier: 'C', source: 'Google Scholar', url: `https://scholar.google.com/scholar?q=${encodeURIComponent(`author:"${ctx.name}"`)}` });
    }
    out.steps.push({ step: 'Gated pointers', input: ctx.name, output: `patents:${flags.isTechnical ? 'shown' : 'hidden'} scholar:${flags.hasAcademic ? 'shown' : 'hidden'}`, durationMs: 0, ok: true });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Identity resolution (candidate generation for human verification)
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveIdentities(input: ReconInput): Promise<{ candidates: Identity[]; steps: StepLog[] }> {
  const q = (input.name || input.company || '').trim();
  const steps: StepLog[] = [];
  if (!q) return { candidates: [], steps };

  // Stage A (search-led discovery) runs alongside the structured candidate sources.
  const [disc, wd, gh, sec] = await Promise.all([
    discover(input),
    wikidataCandidates(q),
    !looksLikeCompany(q) ? githubCandidates(q) : Promise.resolve({ cands: [], steps: [] }),
    secEdgarCandidates(input.company || q),
  ]);
  steps.push(...disc.steps, ...wd.steps, ...gh.steps, ...sec.steps);

  const webCands = discoveryCandidates(disc.hits, input);
  let cands = mergeCandidates([...webCands, ...wd.cands, ...gh.cands, ...sec.cands]);
  cands = applyHints(cands, input);

  // Long-tail fallback: if NOTHING structured matched (the common case for normal
  // people), synthesize one candidate from the raw input so the user can still run a
  // discovery-driven report. Honestly flagged as unverified / low confidence.
  if (cands.length === 0) {
    const dn = input.name || input.company || q;
    cands.push({
      id: `input:${slug(dn)}`,
      kind: input.name ? 'person' : inferKind(dn),
      displayName: dn,
      summary: 'Unverified — built from your input; report relies on live web discovery.',
      confidence: 0.2,
      evidence: ['No structured source matched; proceeding on provided details'],
      identifiers: { name: input.name, company: input.company, domain: domainFromEmail(input.email) || (input.domain ? hostFromUrl(input.domain) : undefined) },
      sources: ['Input'],
    });
  }
  cands.sort((a, b) => b.confidence - a.confidence);
  return { candidates: cands.slice(0, 8), steps };
}

function foldInto(ex: Identity, c: Identity): void {
  ex.confidence = Math.min(0.97, ex.confidence + c.confidence * 0.5);
  ex.evidence = [...new Set([...ex.evidence, ...c.evidence])];
  ex.sources = [...new Set([...ex.sources, ...c.sources])];
  ex.identifiers = { ...c.identifiers, ...ex.identifiers };
  if (!ex.summary && c.summary) ex.summary = c.summary;
}

/** Strong identifiers that, when shared, mean two candidates are the same entity. */
function idKeys(c: Identity): string[] {
  const i = c.identifiers;
  const keys: string[] = [];
  if (i.githubLogin) keys.push(`gh:${i.githubLogin.toLowerCase()}`);
  if (i.wikidataQid) keys.push(`wd:${i.wikidataQid}`);
  if (i.secCik) keys.push(`cik:${i.secCik}`);
  const d = i.domain ? hostFromUrl(i.domain) : undefined;
  if (d) keys.push(`dom:${d}`);
  return keys;
}

function mergeCandidates(cands: Identity[]): Identity[] {
  // Pass 1 — merge by normalized display name.
  const byName = new Map<string, Identity>();
  for (const c of cands) {
    const key = norm(c.displayName) || c.id;
    const ex = byName.get(key);
    if (!ex) byName.set(key, { ...c, identifiers: { ...c.identifiers } });
    else foldInto(ex, c);
  }

  // Pass 2 — collapse entries that share a strong identifier (e.g. same GitHub
  // login or company domain) even when their display names differ. This catches
  // "Andrew Ng" (GitHub) vs "Andrew Yan-Tak Ng" (Wikidata) → one person.
  const merged: Identity[] = [];
  const byId = new Map<string, Identity>();
  for (const c of byName.values()) {
    const keys = idKeys(c);
    const hit = keys.map((k) => byId.get(k)).find(Boolean);
    if (hit) {
      foldInto(hit, c);
      for (const k of idKeys(hit)) byId.set(k, hit);
    } else {
      merged.push(c);
      for (const k of keys) byId.set(k, c);
    }
  }
  return merged;
}

function applyHints(cands: Identity[], input: ReconInput): Identity[] {
  const emailDomain = domainFromEmail(input.email) ?? (input.domain ? hostFromUrl(input.domain) : undefined);
  const companyNorm = input.company ? norm(input.company) : undefined;
  const ghHint = input.github?.toLowerCase();
  const liHandle = input.linkedin
    ? input.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '').toLowerCase()
    : undefined;

  for (const c of cands) {
    if (emailDomain && c.identifiers.domain && hostFromUrl(c.identifiers.domain) === emailDomain) {
      c.confidence = Math.min(0.98, c.confidence + 0.3);
      c.evidence.push(`Email/domain matches ${emailDomain}`);
    }
    if (companyNorm && (norm(c.displayName).includes(companyNorm) || (c.identifiers.company && norm(c.identifiers.company).includes(companyNorm)))) {
      c.confidence = Math.min(0.98, c.confidence + 0.2);
      c.evidence.push(`Matches provided company "${input.company}"`);
    }
    if (ghHint && c.identifiers.githubLogin?.toLowerCase() === ghHint) {
      c.confidence = Math.min(0.99, c.confidence + 0.3);
      c.evidence.push(`Matches provided GitHub @${ghHint}`);
    }
    if (liHandle && c.evidence.some((e) => e.toLowerCase().includes(liHandle))) {
      c.confidence = Math.min(0.99, c.confidence + 0.35);
      c.evidence.push(`Matches confirmed LinkedIn /${liHandle}`);
    }
  }

  // Name-mismatch penalty: when searching for a person, a candidate whose display
  // name shares no tokens with the query is very likely the wrong entity.
  if (input.name) {
    const qTokens = norm(input.name).split(/\s+/).filter((t) => t.length > 2);
    if (qTokens.length > 0) {
      for (const c of cands) {
        if (c.kind !== 'person') continue;
        const cTokens = new Set(norm(c.displayName).split(/\s+/));
        const overlap = qTokens.filter((t) => cTokens.has(t)).length;
        if (overlap === 0) {
          c.confidence = Math.min(c.confidence, 0.15);
          c.evidence.push('⚠ Name shares no tokens with search query');
        }
      }
    }
  }

  return cands;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Build the detailed report from a verified identity
// ─────────────────────────────────────────────────────────────────────────────

export async function buildReport(identity: Identity, input: ReconInput = {}): Promise<ReconReport> {
  const ctx: ReportCtx = {
    kind: identity.kind,
    name: identity.identifiers.name || identity.displayName,
    company: identity.identifiers.company || (identity.kind !== 'person' ? identity.displayName : input.company),
    domain: identity.identifiers.domain || domainFromEmail(input.email) || (input.domain ? hostFromUrl(input.domain) : undefined),
    email: input.email,
    state: input.state,
    location: input.location,
    handle: input.handle,
    usernameScan: input.usernameScan ?? 'curated',
    identifiers: { ...identity.identifiers },
  };

  // Derive candidate handles for cross-platform enumeration (manual handle wins,
  // then GitHub login, email local-part, and a couple of name permutations).
  const handleSet = new Set<string>();
  const cleanH = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/.*\//, '').replace(/[^a-z0-9._-]/g, '');
  if (input.handle) handleSet.add(cleanH(input.handle));
  if (ctx.identifiers.githubLogin) handleSet.add(cleanH(ctx.identifiers.githubLogin));
  const local = input.email?.split('@')[0];
  if (local) handleSet.add(cleanH(local));
  if (ctx.kind === 'person' && ctx.name) {
    const parts = ctx.name.toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (parts.length >= 2) {
      const [f, l] = [parts[0], parts[parts.length - 1]];
      handleSet.add(`${f}${l}`);
      handleSet.add(`${f}.${l}`);
      handleSet.add(`${f[0]}${l}`);
    }
  }
  ctx.handles = [...handleSet].filter((h) => h.length >= 3).slice(0, 3);

  // Stage A — discover the footprint FIRST. This is the recall layer: it finds the
  // company domain, social/github URLs, and the LinkedIn snippet that downstream
  // sources and the report depend on, especially for non-famous subjects.
  const disc = await discover(input, ctx);
  const site = disc.hits.find((h) => h.cls === 'company_site');
  if (site && !ctx.domain) ctx.domain = site.host;
  const ghHit = disc.hits.find((h) => /(?:^|\.)github\.com$/i.test(h.host) && /github\.com\/[^/]+$/.test(h.url));
  if (ghHit && !ctx.identifiers.githubLogin) ctx.identifiers.githubLogin = ghHit.url.replace(/.*github\.com\//i, '').split(/[/?#]/)[0];

  // Seed: EDGAR + JSON-LD can discover further identifiers (domain, github).
  const seed = await Promise.all([secEdgarEnrich(ctx), jsonldEnrich(ctx)]);
  for (const s of seed) {
    if (s.identifiers?.domain && !ctx.domain) ctx.domain = s.identifiers.domain;
    if (s.identifiers?.githubLogin && !ctx.identifiers.githubLogin) ctx.identifiers.githubLogin = s.identifiers.githubLogin;
  }

  // Stage B + C — expand footprint and route to type-aware registries.
  // Enrichers are separated by entity kind to avoid wasting calls on irrelevant sources.
  const footprint = webFootprintEnrich(ctx, disc.hits);

  const isPerson = ctx.kind === 'person';
  const isCompany = !isPerson;

  const rest = await Promise.all([
    // Common — relevant to every kind
    wikidataEnrich(ctx),
    newsEnrich(ctx),
    alephEnrich(ctx),
    interpolEnrich(ctx),
    ofacEnrich(ctx),
    courtlistenerEnrich(ctx),
    // Person-only
    ...(isPerson ? [
      githubEnrich(ctx),
      finraEnrich(ctx),
      openAlexEnrich(ctx),
      orcidEnrich(ctx),
      semanticScholarEnrich(ctx),
      usernameEnrich(ctx),
      socialSearcherEnrich(ctx),
      hibpEnrich(ctx),
      emailInferEnrich(ctx),
      socialMentionsEnrich(ctx),
      companyTeamEnrich(ctx),
    ] : []),
    // Company/fund-only
    ...(isCompany ? [
      secAdvEnrich(ctx),
      usaspendingEnrich(ctx),
      hiringEnrich(ctx),
      Promise.resolve(stateSosEnrich(ctx)),
      Promise.resolve(uccEnrich(ctx)),
    ] : []),
  ]);

  const discContrib: SourceContribution = { source: 'Web search (SearXNG)', personFields: [], companyFields: [], signals: [], steps: disc.steps };
  const base: SourceContribution[] = [discContrib, footprint, ...seed, ...rest];

  // Gate + verify deep-links using what the other sources actually found, so we
  // only surface pointers likely to yield data (noise reduction).
  const pSources = new Set(base.flatMap((c) => c.personFields).map((f) => f.source));
  const flags: DeepLinkFlags = {
    hasAcademic: ['OpenAlex', 'ORCID', 'Semantic Scholar'].some((s) => pSources.has(s)),
    isTechnical: pSources.has('GitHub') || ['OpenAlex', 'ORCID', 'Semantic Scholar'].some((s) => pSources.has(s)),
  };
  const links = await verifiedDeepLinks(ctx, flags);

  const all: SourceContribution[] = [...base, links];
  const personFields = applyMultiSignalBoost(all.flatMap((c) => c.personFields));
  const companyFields = applyMultiSignalBoost(all.flatMap((c) => c.companyFields));
  const signals = all.flatMap((c) => c.signals);
  const steps = all.flatMap((c) => c.steps);

  const report: ReconReport = {
    identity,
    generatedAt: new Date().toISOString(),
    signals,
    steps,
    coverage: all.map((c) => ({
      source: c.source,
      ok: c.steps.some((s) => s.ok),
      note: c.steps.map((s) => s.output).slice(-1)[0] ?? '',
    })),
  };

  // LinkedIn ground truth — inject as a confirmed Tier A person field if provided.
  if (input.linkedin && isPerson) {
    const liHandle = input.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '');
    const liUrl = `https://www.linkedin.com/in/${liHandle}`;
    personFields.unshift({ label: 'LinkedIn (analyst-confirmed)', value: liHandle, tier: 'A', source: 'Analyst input', url: liUrl });
  }

  const personName = identity.kind === 'person' ? identity.displayName : ctx.name ?? identity.displayName;
  if (personFields.length) report.person = { kind: 'person', name: personName, sections: groupByTier(personFields) };
  const companyName = ctx.company ?? (identity.kind !== 'person' ? identity.displayName : '');
  if (companyFields.length && companyName) {
    report.company = { kind: identity.kind === 'person' ? 'company' : identity.kind, name: companyName, sections: groupByTier(companyFields) };
  }

  // Surface company name so the UI can offer to run company research.
  if (isPerson && ctx.company) report.companySuggestion = { name: ctx.company };

  return report;
}

export function groupByTier(fields: Field[]): ReportSection[] {
  const tiers: Array<['A' | 'B' | 'C', string]> = [
    ['A', 'Tier A — decision-driving'],
    ['B', 'Tier B — useful context'],
    ['C', 'Tier C — color'],
  ];
  return tiers.map(([t, title]) => ({ title, fields: fields.filter((f) => f.tier === t) })).filter((s) => s.fields.length > 0);
}

/**
 * Dedup fields by (label, value) and boost tier when ≥2 distinct sources agree on the same fact.
 * C+C → B, B+anything → A. Source label becomes "X + Y" or "Multi-source (N)".
 */
export function applyMultiSignalBoost(fields: Field[]): Field[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim().slice(0, 200);
  type Key = string;
  const groups = new Map<Key, Field[]>();
  for (const f of fields) {
    const k = `${norm(f.label)}||${norm(f.value)}`;
    const g = groups.get(k);
    if (g) g.push(f); else groups.set(k, [f]);
  }
  const emitted = new Set<Key>();
  const out: Field[] = [];
  for (const f of fields) {
    const k = `${norm(f.label)}||${norm(f.value)}`;
    if (emitted.has(k)) continue;
    emitted.add(k);
    const group = groups.get(k)!;
    if (group.length < 2) { out.push(f); continue; }
    const sources = [...new Set(group.map((g) => g.source))];
    const topTier = group.some((g) => g.tier === 'A') ? 'A' : group.some((g) => g.tier === 'B') ? 'A' : 'B';
    const sourceLabel = sources.length <= 2 ? sources.join(' + ') : `Multi-source (${sources.length})`;
    out.push({ ...f, tier: topTier, source: sourceLabel });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache helpers — used by the background-check route to avoid re-fetching
// subjects already in the store.
// ─────────────────────────────────────────────────────────────────────────────

import type { StoreRow } from './store';

/** Canonical source labels produced by each enricher. */
export const ENRICHER_SOURCE_MAP: Record<string, string[]> = {
  wikidata:        ['Wikipedia', 'Wikidata'],
  github:          ['GitHub'],
  secAdv:          ['SEC EDGAR'],
  finra:           ['FINRA', 'IAPD'],
  openAlex:        ['OpenAlex'],
  orcid:           ['ORCID'],
  semanticScholar: ['Semantic Scholar'],
  username:        ['WhatsMyName'],
  ofac:            ['OFAC'],
  hibp:            ['HIBP'],
  emailInfer:      ['Email inference'],
  courtlistener:   ['CourtListener'],
  news:            ['GDELT, Google News', 'Google News'],
  usaspending:     ['USAspending'],
  stateSos:        ['State SoS'],
  ucc:             ['State UCC'],
  aleph:           ['Aleph'],
  interpol:        ['Interpol'],
  socialMentions:  ['HN', 'Twitter mentions', 'Mastodon'],
  socialSearcher:  ['Social Searcher'],
  hiring:          ['Lever', 'Greenhouse'],
  companyTeam:     ['Company site'],
};

/** Keys whose source labels are completely absent from coveredSources. */
export function getMissingEnricherKeys(coveredSources: Set<string>): string[] {
  return Object.entries(ENRICHER_SOURCE_MAP)
    .filter(([, labels]) => !labels.some((l) => coveredSources.has(l)))
    .map(([key]) => key);
}

/** Build a ReportCtx from a resolved identity + raw input (mirrors the ctx block in buildReport). */
export function createCtx(identity: Identity, input: ReconInput): ReportCtx {
  const ctx: ReportCtx = {
    kind: identity.kind,
    name: identity.identifiers.name || identity.displayName,
    company: identity.identifiers.company || (identity.kind !== 'person' ? identity.displayName : input.company),
    domain: identity.identifiers.domain || domainFromEmail(input.email) || (input.domain ? hostFromUrl(input.domain) : undefined),
    email: input.email,
    state: input.state,
    location: input.location,
    handle: input.handle,
    usernameScan: input.usernameScan ?? 'curated',
    identifiers: { ...identity.identifiers },
  };
  const handleSet = new Set<string>();
  const cleanH = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/.*\//, '').replace(/[^a-z0-9._-]/g, '');
  if (input.handle) handleSet.add(cleanH(input.handle));
  if (ctx.identifiers.githubLogin) handleSet.add(cleanH(ctx.identifiers.githubLogin));
  const local = input.email?.split('@')[0];
  if (local) handleSet.add(cleanH(local));
  if (ctx.kind === 'person' && ctx.name) {
    const parts = ctx.name.toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (parts.length >= 2) {
      const [f, l] = [parts[0], parts[parts.length - 1]];
      handleSet.add(`${f}${l}`);
      handleSet.add(`${f}.${l}`);
      handleSet.add(`${f[0]}${l}`);
    }
  }
  ctx.handles = [...handleSet].filter((h) => h.length >= 3).slice(0, 3);
  return ctx;
}

/** Run a subset of enrichers by key. Used for partial cache-refresh when new tools are added. */
export async function runEnrichersForKeys(keys: string[], ctx: ReportCtx): Promise<SourceContribution[]> {
  const dispatch: Record<string, (c: ReportCtx) => Promise<SourceContribution> | SourceContribution> = {
    wikidata:        wikidataEnrich,
    github:          githubEnrich,
    secAdv:          secAdvEnrich,
    finra:           finraEnrich,
    openAlex:        openAlexEnrich,
    orcid:           orcidEnrich,
    semanticScholar: semanticScholarEnrich,
    username:        usernameEnrich,
    socialSearcher:  socialSearcherEnrich,
    interpol:        interpolEnrich,
    aleph:           alephEnrich,
    ofac:            ofacEnrich,
    hibp:            hibpEnrich,
    emailInfer:      emailInferEnrich,
    socialMentions:  socialMentionsEnrich,
    hiring:          hiringEnrich,
    usaspending:     usaspendingEnrich,
    courtlistener:   courtlistenerEnrich,
    news:            newsEnrich,
    stateSos:        stateSosEnrich,
    ucc:             uccEnrich,
    companyTeam:     companyTeamEnrich,
  };
  return Promise.all(keys.filter((k) => dispatch[k]).map((k) => Promise.resolve(dispatch[k](ctx))));
}

/** Reconstruct a ReconReport from cached StoreRows (no network calls). */
export function buildReportFromRows(rows: StoreRow[], identity: Identity): ReconReport {
  const personFields: Field[] = rows
    .filter((r) => r.scope === 'person')
    .map((r) => ({ label: r.label, value: r.value, tier: r.tier as 'A' | 'B' | 'C', source: r.source, url: r.url }));
  const companyFields: Field[] = rows
    .filter((r) => r.scope === 'company')
    .map((r) => ({ label: r.label, value: r.value, tier: r.tier as 'A' | 'B' | 'C', source: r.source, url: r.url }));
  const signals: Field[] = rows
    .filter((r) => r.scope === 'signal')
    .map((r) => ({ label: r.label, value: r.value, tier: r.tier as 'A' | 'B' | 'C', source: r.source, url: r.url, kind: 'signal' as const }));
  const generatedAt = rows.reduce((m, r) => (r.discoveredAt > m ? r.discoveredAt : m), '');
  const coveredSources = [...new Set(rows.map((r) => r.source))];
  const report: ReconReport = {
    identity,
    generatedAt,
    signals,
    steps: [],
    coverage: coveredSources.map((source) => ({ source, ok: true, note: 'from cache' })),
  };
  const personName = identity.kind === 'person' ? identity.displayName : (identity.identifiers.name ?? identity.displayName);
  if (personFields.length) report.person = { kind: 'person', name: personName, sections: groupByTier(personFields) };
  const companyName = identity.identifiers.company ?? (identity.kind !== 'person' ? identity.displayName : '');
  if (companyFields.length && companyName) {
    report.company = { kind: identity.kind === 'person' ? 'company' : identity.kind, name: companyName, sections: groupByTier(companyFields) };
  }
  return report;
}
