import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Table, LayoutGrid, Columns3, Trello, Calendar, Map as MapIcon, Network as NetworkIcon,
  Search, Filter, Plus, ChevronDown, ChevronLeft, ChevronRight, X, Eye, EyeOff, Check,
  Radio, UsersRound, Building2, Sparkles, MoreVertical, GripVertical, ExternalLink, CheckSquare, Tag,
  Upload, Wrench, Users, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useOutletContext, Link, useNavigate } from 'react-router';
import clsx from 'clsx';
import { Header } from './Header';
import { SignalsView } from './SignalsView';
const PeopleMapView = lazy(() => import('./PeopleMapView').then(m => ({ default: m.PeopleMapView })));
import { ListPillRow } from './ListPillRow';
import { GlideTable } from './GlideTable';
import { people as realPeople, companies as realCompanies, totalConnections, type NetworkPerson } from '../data/network';
import { loadCanonicalPeople, loadCanonicalCommunities, loadWorkspaceLists, type PeopleSource, type WorkspaceList } from '../data/db';
import { useCapturedPeople } from '../data/toolCaptures';
import { tools, toolById } from '../data/tools';

interface DataEngineContext {
  highlightedRowId: string | null;
  setHighlightedRowId: (id: string | null) => void;
}

// ── Field definitions per tab. defaultVisible = shown before the user toggles. ────
type FieldKind = 'insight' | 'text' | 'warmth' | 'ring' | 'pill' | 'trust' | 'link' | 'list' | 'number';
interface FieldDef { id: string; label: string; kind: FieldKind; defaultVisible?: boolean; width?: string; locked?: boolean; toolId?: string; }

const PEOPLE_FIELDS: FieldDef[] = [
  { id: 'newsInsight', label: 'NEWS & INSIGHT', kind: 'insight', defaultVisible: true, width: 360 as any },
  { id: 'company', label: 'COMPANY', kind: 'text', width: 200 as any },
  { id: 'position', label: 'POSITION', kind: 'text', width: 220 as any },
  { id: 'location', label: 'LOCATION', kind: 'text', defaultVisible: true, width: 200 as any },
  { id: 'email', label: 'EMAIL', kind: 'text', width: 220 as any },
  { id: 'warmth', label: 'WARMTH', kind: 'warmth', width: 140 as any },
  { id: 'ring', label: 'RING', kind: 'ring', width: 140 as any },
  { id: 'reciprocity', label: 'RECIPROCITY', kind: 'pill', width: 160 as any },
  { id: 'trust', label: 'TRUST DEPTH', kind: 'trust', width: 150 as any },
  { id: 'lastConnected', label: 'LAST CONNECTED', kind: 'text', width: 150 as any },
  { id: 'url', label: 'LINKEDIN', kind: 'link', width: 180 as any },
];
// Every company is a community (no separate companies toggle).
const COMMUNITY_FIELDS: FieldDef[] = [
  { id: 'newsInsight', label: 'NEWS & INSIGHT', kind: 'insight', defaultVisible: true, width: 360 as any },
  { id: 'communityType', label: 'COMMUNITY TYPE', kind: 'text', defaultVisible: true, width: 160 as any, locked: true },
  { id: 'locationDisplay', label: 'LOCATION', kind: 'text', defaultVisible: true, width: 200 as any },
  { id: 'visibility', label: 'VISIBILITY', kind: 'text', defaultVisible: true, width: 120 as any, locked: true },
  { id: 'members', label: 'MEMBERS', kind: 'text', width: 140 as any, locked: true },
  { id: 'sampleRoles', label: 'COMMON ROLES', kind: 'list', width: 280 as any },
  { id: 'samplePeople', label: 'PEOPLE', kind: 'list', width: 280 as any },
];

// Community Type — selectable options (extensible). Defaults to Company (our data is companies).
export const COMMUNITY_TYPES = ['Company', 'NGO', 'Informal group'];

// Communities = companies (canonical). A community WITH a website is public (global); else local (#20).
function mapCommunity(c: any, i: number) {
  const website = i % 3 !== 0 ? `https://${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example` : '';
  return {
    ...c,
    communityType: 'Company',
    website,
    visibility: website ? 'Public' : 'Local',
    members: `${c.connections} ${c.connections === 1 ? 'member' : 'members'}`,
    newsInsight: `${c.connections} ${c.connections === 1 ? 'person' : 'people'} you know${c.sampleRoles?.[0] ? ` · ${c.sampleRoles[0]}` : ''}.`,
  };
}

// ── Saved lists (session-only). A list is either a filter list (optionally inheriting
//    from another list + word/field filters) or a merge (union of other lists). ──────
type WordFilter = { mode: 'and' | 'or'; terms: string[] };
type FilterList = { name: string; kind?: 'filter'; inheritsFrom?: string; filters: { field: string; value: string }[]; query: string; wordFilter?: WordFilter };
type MergeList = { name: string; kind: 'merge'; sources: string[] };
export type SavedList = FilterList | MergeList;

// Free-text search across a row's human-readable fields (people + community shapes).
function matchesText(row: any, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  const hay = [
    row.name, row.newsInsight, row.company, row.position, row.email, row.location, row.locationDisplay,
    Array.isArray(row.sampleRoles) ? row.sampleRoles.join(' ') : '',
    Array.isArray(row.samplePeople) ? row.samplePeople.join(' ') : '',
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(v);
}

// "founder, ceo"  → OR over [founder, ceo].  "olin AND professor" → AND over [olin, professor].
function parseWordFilter(input: string): WordFilter | undefined {
  const s = input.trim();
  if (!s) return undefined;
  if (/\band\b/i.test(s)) {
    const terms = s.split(/\band\b/i).map(t => t.trim()).filter(Boolean);
    return terms.length ? { mode: 'and', terms } : undefined;
  }
  const terms = s.split(',').map(t => t.trim()).filter(Boolean);
  return terms.length ? { mode: 'or', terms } : undefined;
}

// Parse "04 Apr 2026" → epoch ms (0 when unparseable) so "Recent" can sort by recency.
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseConnected(s?: string): number {
  if (!s) return 0;
  const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/.exec(s);
  if (!m) return 0;
  const mo = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? 0;
  return new Date(+m[3], mo, +m[1]).getTime();
}

// Base list pills → an actual transform over the current rows. These make the preset
// pills (Founders, Investors, …) functional instead of decorative.
type ListPreset = (rows: any[]) => any[];
const topSlice = (rows: any[], key: (r: any) => number) =>
  [...rows].sort((a, b) => key(b) - key(a)).slice(0, Math.max(1, Math.ceil(rows.length * 0.25)));
const PEOPLE_PRESETS: Record<string, ListPreset> = {
  Founders: rs => rs.filter(r => /\b(co-?)?founder\b/i.test(r.position || '')),
  Investors: rs => rs.filter(r => /(investor|venture|capital|\bvc\b|angel|general partner|managing partner|\bgp\b|\blp\b)/i.test(`${r.position || ''} ${r.company || ''}`)),
  Recent: rs => topSlice(rs, r => parseConnected(r.connectedOn || r.lastConnected)),
  'Has email': rs => rs.filter(r => !!String(r.email || '').trim()),
};
const COMMUNITY_PRESETS: Record<string, ListPreset> = {
  'Most connected': rs => topSlice(rs, r => r.connections || 0),
  Startups: rs => rs.filter(r => (r.connections || 0) > 0 && (r.connections || 0) <= 12),
  Enterprise: rs => rs.filter(r => (r.connections || 0) >= 40),
  WashU: rs => rs.filter(r => /washington university|wash ?u|wustl|olin/i.test(`${r.name || ''} ${(r.samplePeople || []).join(' ')} ${(r.sampleRoles || []).join(' ')}`)),
};

export function DataEngine() {
  const { highlightedRowId, setHighlightedRowId } = useOutletContext<DataEngineContext>();
  const [activeTab, setActiveTab] = useState('People');
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [activeView, setActiveView] = useState('table');
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const toggleSort = (id: string) => setSort(s => (s && s.id === id) ? (s.dir === 'asc' ? { id, dir: 'desc' } : null) : { id, dir: 'asc' });

  // Community type inline editing — overrides keyed by community id, persisted in session.
  const [communityTypeOverrides, setCommunityTypeOverrides] = useState<Record<string, string>>({});
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [typePopover, setTypePopover] = useState<{ row: any; x: number; y: number } | null>(null);
  const [newTypeInput, setNewTypeInput] = useState('');
  const allCommunityTypes = useMemo(() => [...COMMUNITY_TYPES, ...customTypes], [customTypes]);

  // Local table state (prototype, session-only): added rows, per-cell edits, custom columns, saved lists.
  const [addedRows, setAddedRows] = useState<Record<string, any[]>>({});
  const [cellOverrides, setCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [customFields, setCustomFields] = useState<Record<string, FieldDef[]>>({});
  const [savedLists, setSavedLists] = useState<Record<string, SavedList[]>>({});
  const addedCounter = useRef(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColName, setAddColName] = useState('');
  const [addColMode, setAddColMode] = useState<'manual' | 'tool'>('manual');
  const [addColTool, setAddColTool] = useState<string>(tools[0]?.id ?? '');
  const [manageOpen, setManageOpen] = useState(false);
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [listWords, setListWords] = useState('');
  const [listBase, setListBase] = useState('current');
  const [pillMenu, setPillMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [selectedRowIdx, setSelectedRowIdx] = useState<number[]>([]);

  // People come from the canonical tier in Supabase when reachable; else local CSV-derived data.
  const [peopleRows, setPeopleRows] = useState<NetworkPerson[]>(realPeople);
  const [peopleSource, setPeopleSource] = useState<PeopleSource>('local');
  const capturedPeople = useCapturedPeople();  // approved tool captures, reactive
  const [companyRows, setCompanyRows] = useState<any[]>(realCompanies);
  const [communitySource, setCommunitySource] = useState<PeopleSource>('local');
  const [workspaceLists, setWorkspaceLists] = useState<WorkspaceList[]>([]);
  useEffect(() => {
    let alive = true;
    loadCanonicalPeople().then(({ rows, source }) => { if (alive) { setPeopleRows(rows); setPeopleSource(source); } });
    loadCanonicalCommunities().then(({ rows, source }) => { if (alive) { setCompanyRows(rows); setCommunitySource(source); } });
    loadWorkspaceLists().then(lists => { if (alive) setWorkspaceLists(lists); });
    return () => { alive = false; };
  }, []);

  const headerTabs = [
    { id: 'Signals', icon: Radio },
    { id: 'People', icon: UsersRound },
    { id: 'Communities', icon: Building2 },
  ];
  const views = [
    { id: 'table', icon: Table, label: 'Table' },
    { id: 'gallery', icon: LayoutGrid, label: 'Gallery' },
    { id: 'kanban', icon: Trello, label: 'Kanban' },
    { id: 'calendar', icon: Calendar, label: 'Calendar' },
    { id: 'map', icon: MapIcon, label: 'Map' },
    { id: 'network', icon: NetworkIcon, label: 'Network' },
  ];

  // Base fields + any user-added custom columns for this tab.
  const fields = useMemo<FieldDef[]>(() => [...(activeTab === 'People' ? PEOPLE_FIELDS : COMMUNITY_FIELDS), ...(customFields[activeTab] || [])], [activeTab, customFields]);
  // Apply community type overrides so edited values show immediately in the grid.
  const communityDataWithOverrides = useMemo(
    () => companyRows.map(mapCommunity).map(c => ({ ...c, communityType: communityTypeOverrides[c.id] ?? c.communityType })),
    [companyRows, communityTypeOverrides],
  );
  // rawData = canonical rows + locally-added rows, with per-cell edits applied + custom/tool columns computed.
  const rawData = useMemo<any[]>(() => {
    // Captured People (approved tool captures) ride on top of the canonical/CSV rows.
    const base = activeTab === 'People' ? [...capturedPeople, ...peopleRows] : communityDataWithOverrides;
    const cfs = customFields[activeTab] || [];
    return [...base, ...(addedRows[activeTab] || [])].map(r => {
      let row: any = r;
      const ov = cellOverrides[r.id];
      if (ov) row = { ...row, ...ov };
      for (const cf of cfs) {
        const tid = (cf as any).toolId;
        if (tid) row = { ...row, [cf.id]: row[cf.id] ?? `⚙ ${toolById(tid)?.name || 'Tool'}` };
        else if (row[cf.id] === undefined) row = { ...row, [cf.id]: '' };
      }
      return row;
    }).filter((r: any) => !deletedIds.has(r.id));
  }, [activeTab, peopleRows, capturedPeople, communityDataWithOverrides, addedRows, cellOverrides, customFields, deletedIds]);
  const source: PeopleSource = activeTab === 'People' ? peopleSource : communitySource;

  // ── local table mutations (prototype, session-only) ──────────────────────────────
  const editableKinds = new Set(['text', 'insight', 'list', 'number']);
  const addRow = () => {
    const id = `new-${activeTab}-${++addedCounter.current}`;
    setAddedRows(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { id, name: `New ${activeTab === 'People' ? 'connection' : 'community'}` }] }));
  };
  const editCell = (row: any, fieldId: string, value: string) =>
    setCellOverrides(prev => ({ ...prev, [row.id]: { ...(prev[row.id] || {}), [fieldId]: value } }));
  const deleteSelectedRows = () => {
    const ids = selectedRowIdx.map(i => pageData[i]?.id).filter(Boolean) as string[];
    if (!ids.length) return;
    const addedSet = new Set((addedRows[activeTab] || []).map(r => r.id));
    setAddedRows(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter(r => !ids.includes(r.id)) }));
    setDeletedIds(prev => { const n = new Set(prev); ids.forEach(id => { if (!addedSet.has(id)) n.add(id); }); return n; });
    setSelecting(false); setSelectedCount(0); setSelectedRowIdx([]);
  };
  const addColumn = () => {
    const label = addColName.trim(); if (!label) return;
    const fid = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${++addedCounter.current}`;
    const field: any = { id: fid, label: label.toUpperCase(), kind: 'text', defaultVisible: true, width: 180, custom: true };
    if (addColMode === 'tool') field.toolId = addColTool;
    setCustomFields(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), field] }));
    setAddColName(''); setAddColOpen(false); setOverflowOpen(false);
  };
  const saveCurrentAsList = () => {
    const nm = newListName.trim(); if (!nm) return;
    const wordFilter = parseWordFilter(listWords);
    // 'current' → bake the live search + row filters in; otherwise inherit the chosen list.
    const item: SavedList = listBase === 'current'
      ? { name: nm, kind: 'filter', filters: rowFilters.filter(f => f.value), query, wordFilter }
      : { name: nm, kind: 'filter', inheritsFrom: listBase, filters: [], query: '', wordFilter };
    setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), item] }));
    setSelectedList(nm); setNewListName(''); setListWords(''); setListBase('current'); setAddListOpen(false);
  };
  const uploadList = (filename: string) => {
    setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { name: filename, kind: 'filter', filters: [], query: '' }] }));
    setSelectedList(filename); setAddListOpen(false);
  };
  // Merge two lists into a new union list (everyone in either source).
  const mergeLists = (a: string, b: string) => {
    let name = `${a} + ${b}`;
    const taken = new Set((savedLists[activeTab] || []).map(l => l.name));
    if (taken.has(name)) { let n = 2; while (taken.has(`${name} (${n})`)) n++; name = `${name} (${n})`; }
    setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { name, kind: 'merge', sources: [a, b] }] }));
    setSelectedList(name); setPillMenu(null);
  };
  const deleteList = (name: string) => {
    setSavedLists(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter(l => l.name !== name) }));
    setSelectedList(s => (s === name ? null : s));
    setPillMenu(null);
  };
  const isSavedList = (name: string) => (savedLists[activeTab] || []).some(l => l.name === name);

  // Column visibility per tab — all columns on by default; user can toggle off.
  const [colVisible, setColVisible] = useState<Record<string, Record<string, boolean>>>({});
  const visForTab = (tab: string, fs: FieldDef[]) =>
    colVisible[tab] ?? Object.fromEntries(fs.map(f => [f.id, true]));
  const vis = visForTab(activeTab, fields);
  const visibleFields = fields.filter(f => vis[f.id]);
  const toggleCol = (id: string) =>
    setColVisible(prev => ({ ...prev, [activeTab]: { ...visForTab(activeTab, fields), [id]: !vis[id] } }));

  // Row filters: list of {field, value} (contains, case-insensitive) + the search query.
  const [rowFilters, setRowFilters] = useState<{ field: string; value: string }[]>([]);
  const addFilter = (field: string) => setRowFilters(f => [...f, { field, value: '' }]);
  const setFilterValue = (i: number, value: string) => setRowFilters(f => f.map((x, j) => j === i ? { ...x, value } : x));
  const removeFilter = (i: number) => setRowFilters(f => f.filter((_, j) => j !== i));

  useEffect(() => { setSelectedList(null); setCurrentPage(1); setRowFilters([]); setQuery(''); setSort(null); setSelecting(false); setSelectedCount(0); setPillMenu(null); }, [activeTab]);
  useEffect(() => { setCurrentPage(1); }, [query, rowFilters, selectedList]);

  const baseListPills = activeTab === 'People'
    ? ['Founders', 'Investors', 'Recent', 'Has email', ...workspaceLists.map(l => l.name)]
    : ['Most connected', 'Startups', 'Enterprise', 'WashU'];
  const listPills = [...baseListPills, ...((savedLists[activeTab] || []).map(l => l.name))];

  const filtered = useMemo(() => {
    const wsPresets: Record<string, (rows: any[]) => any[]> = {};
    for (const wl of workspaceLists) {
      wsPresets[wl.name] = (rs: any[]) => rs.filter(r => wl.memberIds.has(r.id));
    }
    const presets = activeTab === 'People' ? { ...PEOPLE_PRESETS, ...wsPresets } : COMMUNITY_PRESETS;
    const lists = savedLists[activeTab] || [];

    const applyFilterDefs = (rows: any[], q: string, defs: { field: string; value: string }[], wf?: WordFilter) =>
      rows.filter(row => {
        if (q && !matchesText(row, q)) return false;
        for (const f of defs) {
          if (!f.value) continue;
          const cell = Array.isArray(row[f.field]) ? row[f.field].join(' ') : String(row[f.field] ?? '');
          if (!cell.toLowerCase().includes(f.value.toLowerCase())) return false;
        }
        if (wf && wf.terms.length) {
          const ok = wf.mode === 'and' ? wf.terms.every(t => matchesText(row, t)) : wf.terms.some(t => matchesText(row, t));
          if (!ok) return false;
        }
        return true;
      });

    // Resolve a list name → the rows it contains, drawn from `rows`. Recurses for
    // inheritance + merges; `seen` guards against cyclic references.
    const resolveList = (name: string, rows: any[], seen: Set<string>): any[] => {
      if (seen.has(name)) return rows;
      seen.add(name);
      const preset = presets[name];
      if (preset) return preset(rows);
      const sl = lists.find(l => l.name === name);
      if (!sl) return rows;
      if (sl.kind === 'merge') {
        const ids = new Set<string>(); const out: any[] = [];
        for (const src of sl.sources)
          for (const r of resolveList(src, rows, new Set(seen)))
            if (!ids.has(r.id)) { ids.add(r.id); out.push(r); }
        return out;
      }
      const base = sl.inheritsFrom ? resolveList(sl.inheritsFrom, rows, new Set(seen)) : rows;
      return applyFilterDefs(base, sl.query || '', sl.filters || [], sl.wordFilter);
    };

    // Live toolbar search + row filters always apply; the selected pill narrows further.
    let rows = applyFilterDefs(rawData, query, rowFilters);
    if (selectedList) rows = resolveList(selectedList, rows, new Set());
    return rows;
  }, [rawData, query, rowFilters, savedLists, selectedList, activeTab, workspaceLists]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.id], bv = b[sort.id];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const pageData = sorted.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const handlePrevPage = () => setCurrentPage(p => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage(p => Math.min(totalPages, p + 1));

  const ActiveViewIcon = views.find(v => v.id === activeView)?.icon || Table;
  const ActiveViewLabel = views.find(v => v.id === activeView)?.label || 'Table';

  // No naked scores — qualitative state only.
  const warmthState = (n: number) => n >= 80 ? { label: 'Hot', token: 'var(--color-steel)' } : n >= 62 ? { label: 'Warm', token: 'var(--color-sage)' } : n >= 50 ? { label: 'Cooling', token: 'var(--color-amber-soft, var(--warning))' } : { label: 'Dormant', token: 'var(--color-warm-gray)' };
  const trustState = (n: number) => n >= 85 ? { label: 'Deep', token: 'var(--color-steel)' } : n >= 65 ? { label: 'Solid', token: 'var(--color-steel-light)' } : n >= 50 ? { label: 'Building', token: 'var(--color-sage)' } : { label: 'Newer', token: 'var(--color-warm-gray)' };

  const renderCell = (row: any, f: FieldDef) => {
    const val = row[f.id];
    switch (f.kind) {
      case 'insight': return <span className="text-sm block truncate" style={{ color: 'var(--color-navy-mid)' }}>{val || '—'}</span>;
      case 'warmth': { const w = warmthState(val); return <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: w.token }} />{w.label}</span>; }
      case 'trust': { const t = trustState(val); return <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.token }} />{t.label}</span>; }
      case 'ring': return <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: val === 'Inner' ? 'var(--color-steel)' : val === 'Active' ? 'var(--color-sage)' : 'var(--color-amber-soft, var(--warning))' }} />{val}</span>;
      case 'pill': return <span className="text-sm px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{val}</span>;
      case 'list': return <span className="text-sm truncate block" style={{ color: 'var(--color-navy-mid)' }}>{Array.isArray(val) ? val.join(', ') : val}</span>;
      case 'number': return <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{val}</span>;
      case 'link': return val ? <a href={val} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-sm inline-flex items-center gap-1 truncate" style={{ color: 'var(--color-steel)' }}>Profile <ExternalLink className="w-3 h-3" /></a> : <span style={{ color: 'var(--color-warm-gray)' }}>—</span>;
      default: return <span className="text-sm truncate block" style={{ color: 'var(--color-navy-mid)' }}>{val || '—'}</span>;
    }
  };

  const noun = activeTab === 'People' ? 'connections' : 'communities';

  const toolbarBtn = "shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-[var(--color-navy-mid)] bg-white border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors shadow-sm whitespace-nowrap";

  return (
    <div className="@container flex-1 flex flex-col h-full bg-[#FAF9F5] overflow-hidden border-r border-[var(--color-border)] w-full relative min-w-0">
      <Header tabs={headerTabs} activeTab={activeTab} onTabChange={setActiveTab} indicatorId="networkSegmentIndicator" />
      {activeTab !== 'Signals' && <ListPillRow pills={listPills} selected={selectedList} onSelect={setSelectedList} onAddList={() => setAddListOpen(true)} onPillContextMenu={(name, e) => setPillMenu({ name, x: e.clientX, y: e.clientY })} />}

      {/* Toolbar — table/gallery views only; the Signals surface is self-contained */}
      {activeTab !== 'Signals' && (
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] shrink-0 bg-white shadow-sm z-20 w-full">
        {/* View dropdown */}
        <div className="relative shrink-0">
          <button title="Switch view — table, gallery, kanban…" onClick={() => setViewDropdownOpen(o => !o)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner transition-colors hover:bg-[var(--color-border)]/40" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
            <ActiveViewIcon className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
            <span className="@[500px]:inline hidden">{ActiveViewLabel}</span>
            <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
          </button>
          <AnimatePresence>
            {viewDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setViewDropdownOpen(false)} />
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute top-full left-0 mt-1 w-44 border rounded-xl shadow-lg z-50 overflow-hidden py-1" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                  {views.map(v => (
                    <button key={v.id} onClick={() => { setActiveView(v.id); setViewDropdownOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium" style={{ backgroundColor: activeView === v.id ? 'var(--color-surface)' : 'transparent', color: activeView === v.id ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                      <v.icon className="w-4 h-4" style={{ color: activeView === v.id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                      {v.label}
                      {activeView === v.id && <Check className="w-3.5 h-3.5 ml-auto" />}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="w-px h-6 shrink-0 hidden @[400px]:block" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* Search (row filter) */}
        <div className="relative shrink flex-1 max-w-[360px] min-w-[32px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${noun}…`} className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm outline-none shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} />
        </div>

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {/* Filter (row filter) */}
          <div className="relative">
            <button title="Filter rows" onClick={() => { setFilterMenuOpen(o => !o); setColMenuOpen(false); }} className={clsx(toolbarBtn, (filterMenuOpen || rowFilters.length) && '!bg-[var(--color-surface)]')}>
              <Filter className="w-3.5 h-3.5 text-[var(--color-warm-gray)]" /> <span className="@[600px]:inline hidden">Filter</span>
              {rowFilters.length > 0 && <span className="text-xs font-bold px-1.5 rounded-full" style={{ backgroundColor: 'var(--color-steel)', color: 'white' }}>{rowFilters.length}</span>}
            </button>
            <AnimatePresence>
              {filterMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFilterMenuOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute top-full right-0 mt-1 w-72 border rounded-xl shadow-lg z-50 p-3 flex flex-col gap-2" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Filter rows where…</div>
                    {rowFilters.length === 0 && <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No filters. Add one below.</div>}
                    {rowFilters.map((rf, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium px-2 py-1.5 rounded-md whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{fields.find(f => f.id === rf.field)?.label.toLowerCase()}</span>
                        <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>contains</span>
                        <input autoFocus value={rf.value} onChange={e => setFilterValue(i, e.target.value)} className="flex-1 min-w-0 px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                        <button onClick={() => removeFilter(i)} className="p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--danger)]"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Add filter on</div>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.map(f => (
                          <button key={f.id} onClick={() => addFilter(f.id)} className="text-xs px-2 py-1 rounded-md border hover:border-[var(--color-steel)] hover:text-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>+ {f.label.toLowerCase()}</button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Overflow (3-dots) — Columns · Add column · Manage access */}
          <div className="relative">
            <button onClick={() => { setOverflowOpen(o => !o); setColMenuOpen(false); setFilterMenuOpen(false); }} className={clsx(toolbarBtn, overflowOpen && '!bg-[var(--color-surface)]')} title="Columns, add column, manage access">
              <MoreVertical className="w-4 h-4 text-[var(--color-warm-gray)]" />
            </button>
            <AnimatePresence>
              {overflowOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setOverflowOpen(false); setAddColOpen(false); setManageOpen(false); }} />
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute top-full right-0 mt-1 w-72 border rounded-xl shadow-lg z-50 overflow-hidden" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    {activeView === 'table' && (
                      <button onClick={() => { setSelecting(s => !s); setOverflowOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface)] border-b transition-colors" style={{ color: selecting ? 'var(--color-steel)' : 'var(--color-navy)', borderColor: 'var(--color-border)' }}>
                        <CheckSquare className="w-4 h-4" style={{ color: selecting ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} /> {selecting ? 'Exit select mode' : 'Select rows'}
                      </button>
                    )}
                    {/* Columns */}
                    <div className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wider flex items-center justify-between" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
                      <span className="flex items-center gap-1.5"><Columns3 className="w-3.5 h-3.5" /> Columns</span><span>{visibleFields.length} shown</span>
                    </div>
                    <div className="max-h-52 overflow-y-auto py-1">
                      <div className="flex items-center gap-2 px-3 py-1.5 text-sm" style={{ color: 'var(--color-warm-gray)' }}><Check className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Name <span className="ml-auto text-xs">always</span></div>
                      {fields.map(f => (
                        <button key={f.id} onClick={() => toggleCol(f.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-surface)] transition-colors" style={{ color: 'var(--color-navy)' }}>
                          {vis[f.id] ? <Eye className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> : <EyeOff className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />}
                          <span className="capitalize truncate">{f.label.toLowerCase()}</span>
                          {(f as any).toolId && <Wrench className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />}
                          <span className="ml-auto w-9 h-5 rounded-full relative shrink-0" style={{ backgroundColor: vis[f.id] ? 'var(--color-steel)' : 'var(--color-border)' }}><span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ transform: vis[f.id] ? 'translateX(16px)' : 'none' }} /></span>
                        </button>
                      ))}
                    </div>
                    {/* Add column */}
                    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      {!addColOpen ? (
                        <button onClick={() => setAddColOpen(true)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}><Plus className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Add column</button>
                      ) : (
                        <div className="p-3 flex flex-col gap-2">
                          <input autoFocus value={addColName} onChange={e => setAddColName(e.target.value)} placeholder="Column name" className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                          <div className="flex gap-1.5">
                            {(['manual', 'tool'] as const).map(m => (
                              <button key={m} onClick={() => setAddColMode(m)} className="flex-1 text-xs px-2 py-1.5 rounded-md border capitalize" style={{ borderColor: addColMode === m ? 'var(--color-steel)' : 'var(--color-border)', color: addColMode === m ? 'var(--color-steel)' : 'var(--color-navy-mid)', backgroundColor: addColMode === m ? 'color-mix(in srgb, var(--color-steel) 8%, transparent)' : 'white' }}>{m === 'manual' ? 'Manual data' : 'From a tool'}</button>
                            ))}
                          </div>
                          {addColMode === 'tool' && (
                            <select value={addColTool} onChange={e => setAddColTool(e.target.value)} className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                              {tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          )}
                          <div className="flex gap-1.5">
                            <button onClick={addColumn} disabled={!addColName.trim()} className="flex-1 text-sm font-semibold px-2 py-1.5 rounded-md text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>Add</button>
                            <button onClick={() => { setAddColOpen(false); setAddColName(''); }} className="px-2 py-1.5 text-sm" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Manage access */}
                    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <button onClick={() => setManageOpen(m => !m)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}><Users className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Manage access <ChevronDown className={clsx('w-3.5 h-3.5 ml-auto transition-transform', manageOpen && 'rotate-180')} style={{ color: 'var(--color-warm-gray)' }} /></button>
                      {manageOpen && (
                        <div className="px-3 pb-3 flex flex-col gap-1.5">
                          {[['You', 'Owner'], ['Bridge Pilot', 'Member'], ['Outreach Agent', 'Agent · read']].map(([who, role]) => (
                            <div key={who} className="flex items-center gap-2 text-sm">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{who.charAt(0)}</div>
                              <span style={{ color: 'var(--color-navy)' }}>{who}</span>
                              <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{role}</span>
                            </div>
                          ))}
                          <button className="mt-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-steel)' }}><Plus className="w-3 h-3" /> Invite to this list</button>
                          <p className="text-[11px] mt-1" style={{ color: 'var(--color-warm-gray)' }}>Access changes are written to the governance ledger.</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

        </div>
      </div>
      )}

      {/* Selection bar — only when selecting. Glide's header checkbox = Select all. */}
      {activeView === 'table' && selecting && (
        <div className="flex items-center gap-3 px-4 py-2 border-b text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 6%, transparent)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{selectedCount} selected</span>
          <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· use the header checkbox to select all</span>
          {selectedCount > 0 && (
            <>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-transform active:scale-95" style={{ backgroundColor: 'var(--color-steel)' }}>
                <Sparkles className="w-3.5 h-3.5" /> Enrich {selectedCount} with AI
              </button>
              <button onClick={deleteSelectedRows} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border shadow-sm transition-transform active:scale-95" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)', backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
                <Trash2 className="w-3.5 h-3.5" /> Delete {selectedCount}
              </button>
            </>
          )}
          <button onClick={() => setSelecting(false)} className="ml-auto text-xs font-semibold" style={{ color: 'var(--color-navy-mid)' }}>Cancel</button>
        </div>
      )}

      {(rowFilters.some(f => f.value) || query) && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-[var(--color-surface)]/40 text-xs flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
          {query && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>"{query}" <button onClick={() => setQuery('')}><X className="w-3 h-3" /></button></span>}
          {rowFilters.filter(f => f.value).map((f, i) => <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{fields.find(x => x.id === f.field)?.label.toLowerCase()}: {f.value}</span>)}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden relative bg-white flex flex-col">
        <AnimatePresence mode="wait">
          {activeTab === 'Signals' ? (
            <motion.div key="signals" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-background)' }}>
              <SignalsView selectedList={selectedList} />
            </motion.div>
          ) : activeView === 'table' ? (
            <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col flex-1 h-full overflow-hidden">
              <div className="flex-1 min-h-0">
                {sorted.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>No {noun} match your filters.</div>
                ) : (
                  <GlideTable
                    key={`${activeTab}-${currentPage}`}
                    rows={pageData}
                    fields={visibleFields.map(f => ({ id: f.id, label: f.label, width: (f as any).width, editable: !(f as any).toolId && !(f as any).locked && editableKinds.has(f.kind) }))}
                    rowHeight={34}
                    sort={sort}
                    onSort={toggleSort}
                    onOpen={(row) => navigate(`/item/${encodeURIComponent(row.name)}`)}
                    selectable={selecting}
                    onSelectedRowsChange={(n, idx) => { setSelectedCount(n); setSelectedRowIdx(idx); }}
                    onCellEdit={(row, fieldId, pos) => {
                      if (activeTab === 'Communities' && fieldId === 'communityType') {
                        setNewTypeInput('');
                        setTypePopover({ row, x: pos.x, y: pos.y });
                      }
                    }}
                    onCellEdited={editCell}
                  />
                )}
              </div>
            </motion.div>
          ) : activeView === 'gallery' ? (
            <motion.div key="gallery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 @[600px]:grid-cols-2 @[900px]:grid-cols-3 @[1200px]:grid-cols-4 gap-3">
                {pageData.map(row => (
                  <Link key={row.id} to={`/item/${encodeURIComponent(row.name)}`} className="block p-4 rounded-xl border bg-white hover:border-[var(--color-steel)] hover:shadow-md transition-all" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{(row.name || '?').charAt(0)}</div>
                      <div className="font-semibold text-sm truncate" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{row.name}</div>
                    </div>
                    <div className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--color-navy-mid)' }}>{row.newsInsight}</div>
                  </Link>
                ))}
              </div>
            </motion.div>
          ) : activeView === 'kanban' ? (
            <motion.div key="kanban" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-x-auto p-5">
              <div className="flex gap-4 min-w-max h-full">
                {(activeTab === 'Companies' ? ['Most connected', 'Mid', 'Long tail'] : ['Inner', 'Close', 'Warm', 'Extended', 'Active']).map(col => {
                  const cards = filtered.filter(r => activeTab === 'Companies' ? (col === 'Most connected' ? r.connections >= 50 : col === 'Mid' ? r.connections >= 15 && r.connections < 50 : r.connections < 15) : r.ring === col).slice(0, 25);
                  if (activeTab !== 'Companies' && cards.length === 0) return null;
                  return (
                    <div key={col} className="w-64 shrink-0 flex flex-col">
                      <div className="flex items-center justify-between px-2 py-2 mb-2"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-navy-mid)' }}>{col}</span><span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{cards.length}</span></div>
                      <div className="flex flex-col gap-2">
                        {cards.map(row => (
                          <Link key={row.id} to={`/item/${encodeURIComponent(row.name)}`} className="block p-3 rounded-lg border bg-white hover:border-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="font-semibold text-sm mb-0.5 truncate" style={{ color: 'var(--color-navy)' }}>{row.name}</div>
                            <div className="text-xs line-clamp-2" style={{ color: 'var(--color-warm-gray)' }}>{row.newsInsight}</div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : activeView === 'map' ? (
            <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col h-full overflow-hidden">
              <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>Loading map…</div>}>
                <PeopleMapView rows={filtered} />
              </Suspense>
            </motion.div>
          ) : (
            <motion.div key="placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center text-[var(--color-warm-gray)] bg-[var(--color-surface)]/40 p-6 text-center">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border flex items-center justify-center mb-4" style={{ borderColor: 'var(--color-border)' }}><ActiveViewIcon className="w-8 h-8" /></div>
              <h3 className="text-lg font-semibold capitalize" style={{ color: 'var(--color-navy)' }}>{ActiveViewLabel} view</h3>
              <p className="text-sm max-w-sm mt-2">The {ActiveViewLabel.toLowerCase()} view is coming next. Table, Gallery, and Kanban are live — switch from the view menu.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer — hidden on Signals + Map (self-contained surfaces) */}
      {activeTab !== 'Signals' && activeView !== 'map' && (
      <div className="h-12 border-t border-[var(--color-border)] flex items-center justify-between px-4 bg-white shrink-0 z-10 w-full shadow-[0_-2px_10px_rgba(0,0,0,0.02)]">
        {activeView === 'table' && (
          <button title="Add a new row (locally editable)" onClick={addRow} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border shadow-sm transition-all hover:bg-[var(--color-surface)] active:scale-95" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
            <Plus className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} /> Add row
          </button>
        )}
        <div className="flex items-center gap-1 border border-[var(--color-border)] p-1 rounded-lg bg-[var(--color-surface)] shadow-inner ml-auto">
          <button onClick={handlePrevPage} disabled={currentPage === 1} className="p-1.5 rounded-md text-[var(--color-navy-mid)] hover:bg-white disabled:opacity-50 transition-all"><ChevronLeft className="w-4 h-4" /></button>
          <div className="flex items-center px-1 gap-0.5 text-sm font-medium">
            {(() => {
              const pages: number[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else if (currentPage <= 4) {
                pages.push(1, 2, 3, 4, 5, -1, totalPages);
              } else if (currentPage >= totalPages - 3) {
                pages.push(1, -1, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
              } else {
                pages.push(1, -1, currentPage - 1, currentPage, currentPage + 1, -2, totalPages);
              }
              return pages.map((p, i) =>
                p < 0
                  ? <span key={`ellipsis-${i}`} className="w-7 flex items-center justify-center text-xs" style={{ color: 'var(--color-warm-gray)' }}>…</span>
                  : <button key={p} onClick={() => setCurrentPage(p)} className="w-7 h-7 flex items-center justify-center rounded-md transition-all text-sm" style={{ backgroundColor: currentPage === p ? 'var(--color-steel)' : 'transparent', color: currentPage === p ? 'white' : 'var(--color-navy-mid)' }}>{p}</button>
              );
            })()}
          </div>
          <button onClick={handleNextPage} disabled={currentPage === totalPages} className="p-1.5 rounded-md text-[var(--color-navy-mid)] hover:bg-white disabled:opacity-50 transition-all"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      )}

      {/* Community type inline edit popover */}
      <AnimatePresence>
        {typePopover && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setTypePopover(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[61] min-w-[200px] rounded-xl border shadow-xl overflow-hidden"
              style={{
                left: Math.min(typePopover.x, window.innerWidth - 220),
                top: Math.min(typePopover.y + 8, window.innerHeight - 260),
                backgroundColor: 'white',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
                <Tag className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Community type</span>
              </div>
              <div className="py-1">
                {allCommunityTypes.map(t => {
                  const current = communityTypeOverrides[typePopover.row.id] ?? typePopover.row.communityType;
                  const active = current === t;
                  return (
                    <button
                      key={t}
                      onClick={() => {
                        setCommunityTypeOverrides(prev => ({ ...prev, [typePopover.row.id]: t }));
                        setTypePopover(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                      style={{ color: active ? 'var(--color-steel)' : 'var(--color-navy-mid)', fontWeight: active ? 600 : 400 }}
                    >
                      {active && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} />}
                      {!active && <span className="w-3.5 shrink-0" />}
                      {t}
                    </button>
                  );
                })}
              </div>
              <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = newTypeInput.trim();
                    if (v && !allCommunityTypes.includes(v)) {
                      setCustomTypes(p => [...p, v]);
                      setCommunityTypeOverrides(prev => ({ ...prev, [typePopover.row.id]: v }));
                      setTypePopover(null);
                    } else if (v && allCommunityTypes.includes(v)) {
                      setCommunityTypeOverrides(prev => ({ ...prev, [typePopover.row.id]: v }));
                      setTypePopover(null);
                    }
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    autoFocus
                    value={newTypeInput}
                    onChange={e => setNewTypeInput(e.target.value)}
                    placeholder="Add type…"
                    className="flex-1 min-w-0 px-2 py-1.5 border rounded-md text-sm outline-none"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                  />
                  <button
                    type="submit"
                    disabled={!newTypeInput.trim()}
                    className="px-2 py-1.5 rounded-md text-sm font-semibold disabled:opacity-40 transition-colors"
                    style={{ backgroundColor: 'var(--color-steel)', color: 'white' }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* List pill right-click menu — merge with another list (union), or delete a saved list */}
      <AnimatePresence>
        {pillMenu && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPillMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPillMenu(null); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[61] w-56 rounded-xl border shadow-xl overflow-hidden"
              style={{ left: Math.min(pillMenu.x, window.innerWidth - 236), top: Math.min(pillMenu.y, window.innerHeight - 320), backgroundColor: 'white', borderColor: 'var(--color-border)' }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Merge "{pillMenu.name}" with…</span>
              </div>
              <div className="py-1 max-h-52 overflow-y-auto">
                {listPills.filter(p => p !== pillMenu.name).length === 0 && (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>No other list to merge with.</div>
                )}
                {listPills.filter(p => p !== pillMenu.name).map(p => (
                  <button key={p} onClick={() => mergeLists(pillMenu.name, p)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors" style={{ color: 'var(--color-navy-mid)' }}>
                    <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} /> {p}
                  </button>
                ))}
              </div>
              {isSavedList(pillMenu.name) && (
                <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <button onClick={() => deleteList(pillMenu.name)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors" style={{ color: 'var(--danger)' }}>
                    <Trash2 className="w-3.5 h-3.5 shrink-0" /> Delete list
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add-list modal — upload new data OR build a list from the current view */}
      {addListOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 px-4" onClick={() => setAddListOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-[420px] max-w-full rounded-2xl border bg-white shadow-2xl overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-base font-bold" style={{ color: 'var(--color-navy)' }}>New list</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>Upload new data, or build a list from your current view.</p>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer hover:border-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 12%, transparent)' }}><Upload className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /></div>
                <div className="min-w-0"><div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Upload new data</div><div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>CSV / XLSX — parsed locally into a new list</div></div>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadList(f.name); }} />
              </label>
              <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-sage) 20%, transparent)' }}><Filter className="w-4 h-4" style={{ color: 'var(--color-sage)' }} /></div>
                  <div className="min-w-0"><div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Build from current view</div><div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{filtered.length} {noun} match your search + filters</div></div>
                </div>
                <select value={listBase} onChange={e => setListBase(e.target.value)} className="w-full mb-2 px-2 py-1.5 border rounded-md text-sm outline-none bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  <option value="current">Start from: current view</option>
                  {listPills.map(p => <option key={p} value={p}>Start from: {p}</option>)}
                </select>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {listBase === 'current' ? (
                    <>
                      {query && <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>search: "{query}"</span>}
                      {rowFilters.filter(f => f.value).map((f, i) => <span key={i} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{fields.find(x => x.id === f.field)?.label.toLowerCase()}: {f.value}</span>)}
                      {!query && !rowFilters.some(f => f.value) && <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No filters — the full list</span>}
                    </>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>inherits "{listBase}"</span>
                  )}
                </div>
                {/* Word filter — keep only rows containing these words. */}
                <input value={listWords} onChange={e => setListWords(e.target.value)} placeholder="Filter by words — e.g. founder, investor (or: olin AND professor)" className="w-full mb-1 px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                <p className="text-[11px] mb-2.5" style={{ color: 'var(--color-warm-gray)' }}>
                  {(() => { const wf = parseWordFilter(listWords); return wf ? `Keeps rows containing ${wf.mode === 'and' ? 'all' : 'any'} of: ${wf.terms.join(', ')}` : 'Comma-separated = any word · use AND to require all'; })()}
                </p>
                <div className="flex gap-1.5">
                  <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name" className="flex-1 min-w-0 px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                  <button onClick={saveCurrentAsList} disabled={!newListName.trim()} className="px-3 py-1.5 rounded-md text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>Create</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
