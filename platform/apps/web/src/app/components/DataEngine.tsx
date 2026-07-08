import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Table, LayoutGrid, Columns3, Trello, Calendar, Map as MapIcon, Network as NetworkIcon,
  Search, Filter, Plus, ChevronDown, ChevronLeft, ChevronRight, X, Eye, EyeOff, Check,
  Radio, UsersRound, Building2, Sparkles, MoreVertical, GripVertical, ExternalLink, CheckSquare, Tag,
  Upload, Wrench, Users, Trash2, Download, Rows3, Copy, Link2,
} from 'lucide-react';
import { exportRowsToCsv } from '../lib/exportTable';
import { csvToRecords } from '../lib/csvImport';
import { COLUMN_TYPES, INLINE_TYPES, POPOVER_TYPES, type ColumnType } from '../lib/columnTypes';
import { usePersistentState } from '../lib/persist';
import { motion, AnimatePresence } from 'motion/react';
import { useOutletContext, Link, useNavigate } from 'react-router';
import clsx from 'clsx';
import { Header } from './shared/Header';
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
interface FieldDef { id: string; label: string; kind: FieldKind; defaultVisible?: boolean; width?: string; locked?: boolean; toolId?: string; columnType?: ColumnType; options?: string[]; }

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
type FilterOp = 'contains' | 'is' | 'is_not' | 'is_empty' | 'is_not_empty' | 'starts_with';
type WordFilter = { mode: 'and' | 'or'; terms: string[] };
type FilterList = { name: string; kind?: 'filter'; inheritsFrom?: string; filters: { field: string; value: string; op?: FilterOp }[]; query: string; wordFilter?: WordFilter };
type MergeList = { name: string; kind: 'merge'; sources: string[] };
type IdsList = { name: string; kind: 'ids'; ids: string[] };
export type SavedList = FilterList | MergeList | IdsList;

// ── View config as data (Notion-parity: each database/tab remembers its own view). ──
// Persisted per tab so switching People ↔ Communities never loses sort/filter/group/view.
type SortSpec = { id: string; dir: 'asc' | 'desc' };
interface ViewState {
  sorts: SortSpec[];
  rowFilters: { field: string; op: FilterOp; value: string }[];
  filterMatch: 'all' | 'any'; // AND vs OR across rowFilters
  groupBy: string | null;
  activeView: string;
}
const DEFAULT_VIEW_STATE: ViewState = { sorts: [], rowFilters: [], filterMatch: 'all', groupBy: null, activeView: 'table' };

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
  // apps/web's Layout doesn't provide an Outlet context (the prototype's did);
  // fall back to local state so the page works standalone.
  const outletCtx = useOutletContext<DataEngineContext | null>();
  const [localHighlighted, setLocalHighlighted] = useState<string | null>(null);
  const highlightedRowId = outletCtx?.highlightedRowId ?? localHighlighted;
  const setHighlightedRowId = outletCtx?.setHighlightedRowId ?? setLocalHighlighted;
  const [activeTab, setActiveTab] = useState('People');
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;
  const navigate = useNavigate();
  const [selecting, setSelecting] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);

  // ── Per-tab view config (sort/filter/group/view kind) — persisted, survives refresh
  //    and tab switches (each tab = its own "database" view, Notion-style). ──────────
  const [viewStates, setViewStates] = usePersistentState<Record<string, ViewState>>('bridge.table.viewState.v1', {});
  const viewState = viewStates[activeTab] ?? DEFAULT_VIEW_STATE;
  const updateViewState = (patch: Partial<ViewState>) =>
    setViewStates(prev => ({ ...prev, [activeTab]: { ...(prev[activeTab] ?? DEFAULT_VIEW_STATE), ...patch } }));
  const activeView = viewState.activeView;
  const setActiveView = (id: string) => updateViewState({ activeView: id });
  const sorts = viewState.sorts;
  const rowFilters = viewState.rowFilters;
  const filterMatch = viewState.filterMatch;
  const groupBy = viewState.groupBy;
  // Header click = make this column the sole/primary sort (cycle asc→desc→off).
  // Full multi-sort (multiple criteria at once) is managed via the Sort popover below.
  const toggleSort = (id: string) => {
    const existing = sorts.find(s => s.id === id);
    if (!existing) return updateViewState({ sorts: [{ id, dir: 'asc' }] });
    if (existing.dir === 'asc') return updateViewState({ sorts: [{ id, dir: 'desc' }] });
    return updateViewState({ sorts: [] });
  };
  const addSort = (id: string) => { if (!sorts.some(s => s.id === id)) updateViewState({ sorts: [...sorts, { id, dir: 'asc' }] }); };
  const removeSort = (id: string) => updateViewState({ sorts: sorts.filter(s => s.id !== id) });
  const setSortDir = (id: string, dir: 'asc' | 'desc') => updateViewState({ sorts: sorts.map(s => s.id === id ? { ...s, dir } : s) });

  // Community type inline editing — overrides keyed by community id. Persisted (localStorage)
  // so edits survive refresh — see [[table-persistence]] / known-issues 2026-07-03.
  const [communityTypeOverrides, setCommunityTypeOverrides] = usePersistentState<Record<string, string>>('bridge.table.communityTypeOverrides.v1', {});
  const [customTypes, setCustomTypes] = usePersistentState<string[]>('bridge.table.customTypes.v1', []);
  const [typePopover, setTypePopover] = useState<{ row: any; x: number; y: number } | null>(null);
  const [newTypeInput, setNewTypeInput] = useState('');
  const allCommunityTypes = useMemo(() => [...COMMUNITY_TYPES, ...customTypes], [customTypes]);

  // Local table state — added rows, per-cell edits, custom columns, saved lists, column
  // renames, soft-deletes. All persisted to localStorage (prototype-tier; swap for a
  // Supabase/API-backed port later behind the same usePersistentState call shape).
  const [addedRows, setAddedRows] = usePersistentState<Record<string, any[]>>('bridge.table.addedRows.v1', {});
  const [cellOverrides, setCellOverrides] = usePersistentState<Record<string, Record<string, string | string[] | boolean>>>('bridge.table.cellOverrides.v1', {});
  const [customFields, setCustomFields] = usePersistentState<Record<string, FieldDef[]>>('bridge.table.customFields.v1', {});
  const [savedLists, setSavedLists] = usePersistentState<Record<string, SavedList[]>>('bridge.table.savedLists.v1', {});
  const [columnLabelOverrides, setColumnLabelOverrides] = usePersistentState<Record<string, string>>('bridge.table.columnLabels.v1', {});
  const [renamingFieldId, setRenamingFieldId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const addedCounter = useRef(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColName, setAddColName] = useState('');
  const [addColMode, setAddColMode] = useState<'manual' | 'tool'>('manual');
  const [addColTool, setAddColTool] = useState<string>(tools[0]?.id ?? '');
  const [addColType, setAddColType] = useState<ColumnType>('text');
  const [addColOptions, setAddColOptions] = useState('');
  const [selectPopover, setSelectPopover] = useState<{ row: any; field: FieldDef; x: number; y: number } | null>(null);
  const [selectNewOpt, setSelectNewOpt] = useState('');
  const [datePopover, setDatePopover] = useState<{ row: any; field: FieldDef; x: number; y: number } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [listWords, setListWords] = useState('');
  const [listBase, setListBase] = useState('current');
  const [pillMenu, setPillMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ row: any; x: number; y: number } | null>(null);
  // Soft-deletes persisted as an array (JSON can't hold a Set); Set derived for lookups.
  const [deletedIdsArr, setDeletedIdsArr] = usePersistentState<string[]>('bridge.table.deletedIds.v1', []);
  const deletedIds = useMemo(() => new Set(deletedIdsArr), [deletedIdsArr]);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number[]>([]);
  const [density, setDensity] = useState<'compact' | 'standard' | 'tall'>('standard');
  const densityPx = density === 'compact' ? 28 : density === 'tall' ? 44 : 34;
  const cycleDensity = () => setDensity(d => d === 'compact' ? 'standard' : d === 'standard' ? 'tall' : 'compact');

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
  const fields = useMemo<FieldDef[]>(() => {
    const base = [...(activeTab === 'People' ? PEOPLE_FIELDS : COMMUNITY_FIELDS), ...(customFields[activeTab] || [])];
    // Renamed columns (Notion-parity): single injection point so every consumer
    // (columns menu, filter/sort/group pickers, GlideTable headers) sees the new label.
    return base.map(f => columnLabelOverrides[f.id] ? { ...f, label: columnLabelOverrides[f.id] } : f);
  }, [activeTab, customFields, columnLabelOverrides]);
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
    // Locally-added rows lead (not trail) so a fresh "Add row" is visible on page 1
    // without a sort active — trailing them put new rows on the LAST page instead.
    return [...(addedRows[activeTab] || []), ...base].map(r => {
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
    // Prepend (not append) + jump to page 1 so the new row is immediately visible —
    // appending put it on the LAST page under pagination, which looked like a no-op.
    setAddedRows(prev => ({ ...prev, [activeTab]: [{ id, name: `New ${activeTab === 'People' ? 'connection' : 'community'}` }, ...(prev[activeTab] || [])] }));
    setCurrentPage(1);
    setHighlightedRowId(id);
  };
  const editCell = (row: any, fieldId: string, value: string | string[] | boolean) =>
    setCellOverrides(prev => ({ ...prev, [row.id]: { ...(prev[row.id] || {}), [fieldId]: value } }));
  const deleteSelectedRows = () => {
    const ids = selectedRowIdx.map(i => pageData[i]?.id).filter(Boolean) as string[];
    if (!ids.length) return;
    const addedSet = new Set((addedRows[activeTab] || []).map(r => r.id));
    setAddedRows(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter(r => !ids.includes(r.id)) }));
    setDeletedIdsArr(prev => { const n = new Set(prev); ids.forEach(id => { if (!addedSet.has(id)) n.add(id); }); return Array.from(n); });
    setSelecting(false); setSelectedCount(0); setSelectedRowIdx([]);
  };
  const addColumn = () => {
    const label = addColName.trim(); if (!label) return;
    const fid = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${++addedCounter.current}`;
    const field: any = { id: fid, label: label.toUpperCase(), kind: 'text', defaultVisible: true, width: 180, custom: true };
    if (addColMode === 'tool') {
      field.toolId = addColTool;
    } else {
      field.columnType = addColType;
      if (addColType === 'select' || addColType === 'multiselect') {
        field.options = addColOptions.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    setCustomFields(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), field] }));
    setAddColName(''); setAddColType('text'); setAddColOptions(''); setAddColOpen(false); setOverflowOpen(false);
  };
  const saveCurrentAsList = () => {
    const nm = newListName.trim(); if (!nm) return;
    const wordFilter = parseWordFilter(listWords);
    // 'current' → bake the live search + row filters in; otherwise inherit the chosen list.
    const item: SavedList = listBase === 'current'
      ? { name: nm, kind: 'filter', filters: rowFilters.filter(f => f.value || f.op === 'is_empty' || f.op === 'is_not_empty'), query, wordFilter }
      : { name: nm, kind: 'filter', inheritsFrom: listBase, filters: [], query: '', wordFilter };
    setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), item] }));
    setSelectedList(nm); setNewListName(''); setListWords(''); setListBase('current'); setAddListOpen(false);
  };
  // Common aliases: header label → base field id. Case-insensitive matching applied below.
  const FIELD_ALIASES: Record<string, string> = {
    'full name': 'name', 'name': 'name',
    'company': 'company', 'organization': 'company',
    'title': 'position', 'position': 'position', 'role': 'position',
    'email': 'email', 'email address': 'email',
    'location': 'location', 'city': 'location',
    'linkedin': 'url', 'url': 'url', 'profile': 'url',
  };

  const importFile = async (file: File, listName?: string) => {
    const name = listName || file.name;
    // Non-CSV: fall back to empty filter list (xlsx parsing is a follow-up).
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { name, kind: 'filter' as const, filters: [], query: '' }] }));
      setSelectedList(name); setAddListOpen(false);
      return;
    }

    const text = await file.text();
    const { headers, records } = csvToRecords(text);
    if (headers.length === 0 || records.length === 0) {
      // Empty or header-only — create an empty list gracefully.
      setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { name, kind: 'ids' as const, ids: [] }] }));
      setSelectedList(name); setAddListOpen(false);
      return;
    }

    const baseFields = activeTab === 'People' ? PEOPLE_FIELDS : COMMUNITY_FIELDS;
    // Build header → fieldId map.
    const headerMap: Record<string, string> = {};
    const newCustomFieldDefs: FieldDef[] = [];
    for (const h of headers) {
      const lower = h.toLowerCase().trim();
      // Try alias table first.
      if (FIELD_ALIASES[lower]) { headerMap[h] = FIELD_ALIASES[lower]; continue; }
      // Try matching against base field ids or labels.
      const matched = baseFields.find(f => f.id.toLowerCase() === lower || f.label.toLowerCase() === lower);
      if (matched) { headerMap[h] = matched.id; continue; }
      // Unknown header → new custom text column (dedupe by label).
      const slug = lower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const fid = `custom_${slug}_${++addedCounter.current}`;
      headerMap[h] = fid;
      newCustomFieldDefs.push({ id: fid, label: h.toUpperCase(), kind: 'text', defaultVisible: true, width: 180 as any, columnType: 'text' });
    }

    // Dedupe new custom fields against existing ones by label.
    if (newCustomFieldDefs.length > 0) {
      setCustomFields(prev => {
        const existing = prev[activeTab] || [];
        const existingLabels = new Set(existing.map(f => f.label));
        const toAdd = newCustomFieldDefs.filter(f => !existingLabels.has(f.label));
        // Update headerMap entries whose fid collides with an existing field.
        for (const f of newCustomFieldDefs) {
          if (existingLabels.has(f.label)) {
            const existingField = existing.find(e => e.label === f.label);
            if (existingField) {
              // Remap the header to the existing field's id.
              for (const [h, fid] of Object.entries(headerMap)) {
                if (fid === f.id) headerMap[h] = existingField.id;
              }
            }
          }
        }
        return toAdd.length ? { ...prev, [activeTab]: [...existing, ...toAdd] } : prev;
      });
    }

    // Convert records → row objects.
    const importedRows = records.map((rec, idx) => {
      const row: Record<string, string> = { id: `import-${activeTab}-${++addedCounter.current}` };
      for (const [h, fid] of Object.entries(headerMap)) {
        const val = rec[h] ?? '';
        if (fid === 'name' && !row['name']) row['name'] = val;
        else row[fid] = val;
      }
      // Fallback name: first column value or generic label.
      if (!row['name']) row['name'] = rec[headers[0]] || `Imported ${activeTab === 'People' ? 'Person' : 'Community'} ${idx + 1}`;
      return row;
    });

    const ids = importedRows.map(r => r.id);
    setAddedRows(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), ...importedRows] }));
    setSavedLists(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { name, kind: 'ids' as const, ids }] }));
    setSelectedList(name);
    setAddListOpen(false);
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

  // ── Calendar view local state ────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Column visibility per tab — all columns on by default; user can toggle off. Persisted.
  const [colVisible, setColVisible] = usePersistentState<Record<string, Record<string, boolean>>>('bridge.table.colVisible.v1', {});
  const visForTab = (tab: string, fs: FieldDef[]) =>
    colVisible[tab] ?? Object.fromEntries(fs.map(f => [f.id, true]));
  const vis = visForTab(activeTab, fields);
  const visibleFields = fields.filter(f => vis[f.id]);
  const toggleCol = (id: string) =>
    setColVisible(prev => ({ ...prev, [activeTab]: { ...visForTab(activeTab, fields), [id]: !vis[id] } }));

  // Row filters: list of {field, op, value} + the search query. Now part of the
  // per-tab persisted ViewState (was session-only useState) — AND-ed or OR-ed per filterMatch.
  const addFilter = (field: string) => updateViewState({ rowFilters: [...rowFilters, { field, op: 'contains' as FilterOp, value: '' }] });
  const setFilterValue = (i: number, value: string) => updateViewState({ rowFilters: rowFilters.map((x, j) => j === i ? { ...x, value } : x) });
  const setFilterOp = (i: number, op: FilterOp) => updateViewState({ rowFilters: rowFilters.map((x, j) => j === i ? { ...x, op } : x) });
  const removeFilter = (i: number) => updateViewState({ rowFilters: rowFilters.filter((_, j) => j !== i) });
  const setFilterMatch = (m: 'all' | 'any') => updateViewState({ filterMatch: m });
  const setGroupBy = (field: string | null) => updateViewState({ groupBy: field });

  // Tab switch resets ephemeral search state only — sort/filter/group/view now live in
  // the per-tab ViewState and correctly persist across tab switches + refresh.
  useEffect(() => { setSelectedList(null); setCurrentPage(1); setQuery(''); setSelecting(false); setSelectedCount(0); setPillMenu(null); }, [activeTab]);
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

    // matchMode 'all' = every filter must pass (AND, prior behavior); 'any' = at least
    // one must pass (OR) — Notion-style "Where: All / Any of the following".
    const passesOne = (row: any, f: { field: string; op?: FilterOp; value: string }): boolean => {
      const op = f.op ?? 'contains';
      const cell = Array.isArray(row[f.field]) ? row[f.field].join(' ') : String(row[f.field] ?? '');
      const cellLow = cell.toLowerCase();
      const valLow = f.value.toLowerCase();
      if (op === 'is_empty') return cell.trim() === '';
      if (op === 'is_not_empty') return cell.trim() !== '';
      if (!f.value) return true; // no value typed yet — don't filter on it
      if (op === 'is') return cellLow === valLow;
      if (op === 'is_not') return cellLow !== valLow;
      if (op === 'starts_with') return cellLow.startsWith(valLow);
      return cellLow.includes(valLow); // 'contains' (default)
    };
    const applyFilterDefs = (
      rows: any[], q: string, defs: { field: string; op?: FilterOp; value: string }[], wf?: WordFilter, matchMode: 'all' | 'any' = 'all',
    ) =>
      rows.filter(row => {
        if (q && !matchesText(row, q)) return false;
        const active = defs.filter(f => f.op === 'is_empty' || f.op === 'is_not_empty' || !!f.value);
        if (active.length) {
          const ok = matchMode === 'any' ? active.some(f => passesOne(row, f)) : active.every(f => passesOne(row, f));
          if (!ok) return false;
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
      if (sl.kind === 'ids') {
        const idSet = new Set(sl.ids);
        return rows.filter(r => idSet.has(r.id));
      }
      const base = sl.inheritsFrom ? resolveList(sl.inheritsFrom, rows, new Set(seen)) : rows;
      return applyFilterDefs(base, sl.query || '', sl.filters || [], sl.wordFilter);
    };

    // Live toolbar search + row filters always apply; the selected pill narrows further.
    let rows = applyFilterDefs(rawData, query, rowFilters, undefined, filterMatch);
    if (selectedList) rows = resolveList(selectedList, rows, new Set());
    return rows;
  }, [rawData, query, rowFilters, filterMatch, savedLists, selectedList, activeTab, workspaceLists]);

  // Multi-sort: sorts[0] is primary, later entries break ties — Notion-style "then by".
  const sorted = useMemo(() => {
    if (!sorts.length) return filtered;
    const compareOne = (a: any, b: any, s: SortSpec): number => {
      const dir = s.dir === 'asc' ? 1 : -1;
      const av = a[s.id], bv = b[s.id];
      const isDateCol = s.id === 'lastConnected' || s.id === 'connectedOn';
      if (isDateCol) return (parseConnected(av) - parseConnected(bv)) * dir;
      const avn = Number(av), bvn = Number(bv);
      if (!isNaN(avn) && !isNaN(bvn) && av !== '' && bv !== '' && av != null && bv != null) return (avn - bvn) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    };
    return [...filtered].sort((a, b) => {
      for (const s of sorts) {
        const c = compareOne(a, b, s);
        if (c !== 0) return c;
      }
      return 0;
    });
  }, [filtered, sorts]);

  // Dynamic grouping (table view): buckets the full sorted set by a field's value —
  // Notion-style "Group by". Pagination is suspended while grouped (groups replace pages).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroupCollapsed = (key: string) => setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const groupedRows = useMemo(() => {
    if (!groupBy) return null;
    const buckets = new Map<string, any[]>();
    for (const row of sorted) {
      const raw = row[groupBy];
      const key = raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
        ? 'No value' : Array.isArray(raw) ? raw.join(', ') : String(raw);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
    return [...buckets.entries()].sort(([a], [b]) => a === 'No value' ? 1 : b === 'No value' ? -1 : a.localeCompare(b));
  }, [sorted, groupBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const pageData = sorted.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  // Column summary stats for the Notion-style calc strip (table view only).
  const colSummary = useMemo(() => {
    const total = sorted.length;
    return visibleFields.map(f => {
      const nums = sorted.map(r => {
        const v = r[f.id];
        return v !== null && v !== undefined && v !== '' ? Number(v) : NaN;
      }).filter(n => !isNaN(n));
      if (nums.length > 0) {
        const sum = nums.reduce((a, b) => a + b, 0);
        const avg = sum / nums.length;
        const fmtNum = (n: number) => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
        return { id: f.id, label: f.label, kind: 'numeric' as const, sum: fmtNum(sum), avg: fmtNum(avg) };
      }
      const filled = sorted.filter(r => {
        const v = r[f.id];
        return v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== '');
      }).length;
      return { id: f.id, label: f.label, kind: 'text' as const, filled, total };
    });
  }, [sorted, visibleFields]);
  // GlideTable column defs — shared by the flat table and each grouped section.
  const glideFields = useMemo(() => visibleFields.map(f => {
    const hasColType = !!f.columnType;
    // POPOVER_TYPES and checkbox are routed through onCellEdit — Glide must not inline-edit them.
    const isPopoverOrToggle = hasColType && (POPOVER_TYPES.includes(f.columnType!) || f.columnType === 'checkbox');
    const editable = hasColType
      ? (!isPopoverOrToggle && INLINE_TYPES.includes(f.columnType!))
      : (!f.toolId && !f.locked && editableKinds.has(f.kind));
    return { id: f.id, label: f.label, width: (f as any).width, editable };
  }), [visibleFields]);
  // Shared GlideTable event handlers — one flat table (ungrouped) or one per group
  // (grouped) all route through the same edit/open/select logic.
  const handleGlideCellEdit = (row: any, fieldId: string, pos: { x: number; y: number }) => {
    if (activeTab === 'Communities' && fieldId === 'communityType') {
      setNewTypeInput('');
      setTypePopover({ row, x: pos.x, y: pos.y });
      return;
    }
    const cf = (customFields[activeTab] || []).find(f => f.id === fieldId);
    if (cf?.columnType === 'select' || cf?.columnType === 'multiselect') {
      setSelectNewOpt('');
      setSelectPopover({ row, field: cf, x: pos.x, y: pos.y });
      return;
    }
    if (cf?.columnType === 'date') {
      setDatePopover({ row, field: cf, x: pos.x, y: pos.y });
      return;
    }
    if (cf?.columnType === 'checkbox') {
      const current = (cellOverrides[row.id]?.[fieldId] ?? row[fieldId]) as boolean | undefined;
      editCell(row, fieldId, !current);
      return;
    }
  };
  const handleGlideOpen = (row: any) => navigate(`/item/${encodeURIComponent(row.name)}`);
  const handleGlideRowMenu = (row: any, pos: { x: number; y: number }) => setRowMenu({ row, x: pos.x, y: pos.y });
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
      <Header tabs={headerTabs} activeTab={activeTab} onTabChange={setActiveTab} />
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

        {/* Data source badge — lets the user tell at a glance whether they're viewing live Supabase data or the local fallback. */}
        <span
          title={source === 'supabase' ? 'Loaded from Supabase' : 'Supabase unreachable — showing local fallback data'}
          className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{
            backgroundColor: `color-mix(in srgb, ${source === 'supabase' ? 'var(--success)' : 'var(--warning)'} 14%, transparent)`,
            color: source === 'supabase' ? 'var(--success)' : 'var(--warning)',
          }}
        >
          {source === 'supabase' ? 'Live · Supabase' : 'Local fallback'}
        </span>

        {/* Search (row filter) */}
        <div className="relative shrink flex-1 max-w-[360px] min-w-[32px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${noun}…`} className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm outline-none shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} />
        </div>

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {/* Density toggle */}
          <button
            title={`Row density: ${density} — click to cycle`}
            onClick={cycleDensity}
            className={clsx(toolbarBtn)}
          >
            <Rows3 className="w-3.5 h-3.5 text-[var(--color-warm-gray)]" />
            <span className="@[600px]:inline hidden capitalize">{density}</span>
          </button>

          {/* Export CSV */}
          <button
            title="Export visible rows to CSV"
            onClick={() => exportRowsToCsv(sorted, visibleFields, `${activeTab.toLowerCase()}-export.csv`)}
            className={clsx(toolbarBtn)}
          >
            <Download className="w-3.5 h-3.5 text-[var(--color-warm-gray)]" />
            <span className="@[600px]:inline hidden">Export</span>
          </button>

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
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Filter rows where…</div>
                      {rowFilters.length > 1 && (
                        <div className="flex rounded-md border overflow-hidden text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}>
                          {(['all', 'any'] as const).map(m => (
                            <button key={m} onClick={() => setFilterMatch(m)} className="px-2 py-1 capitalize" style={{ backgroundColor: filterMatch === m ? 'var(--color-steel)' : 'white', color: filterMatch === m ? 'white' : 'var(--color-navy-mid)' }}>{m}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    {rowFilters.length === 0 && <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No filters. Add one below.</div>}
                    {rowFilters.map((rf, i) => (
                      <div key={i} className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium px-2 py-1.5 rounded-md whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{fields.find(f => f.id === rf.field)?.label.toLowerCase()}</span>
                        <select
                          value={rf.op ?? 'contains'}
                          onChange={e => setFilterOp(i, e.target.value as FilterOp)}
                          className="text-xs px-1.5 py-1.5 border rounded-md outline-none"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}
                        >
                          <option value="contains">contains</option>
                          <option value="is">is</option>
                          <option value="is_not">is not</option>
                          <option value="starts_with">starts with</option>
                          <option value="is_empty">is empty</option>
                          <option value="is_not_empty">is not empty</option>
                        </select>
                        {rf.op !== 'is_empty' && rf.op !== 'is_not_empty' && (
                          <input autoFocus value={rf.value} onChange={e => setFilterValue(i, e.target.value)} className="flex-1 min-w-0 px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                        )}
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

          {/* Sort — multi-criteria (click a header still cycles the sole sort; this manages the list) */}
          {activeView === 'table' && (
          <div className="relative">
            <button title="Sort rows" onClick={() => { setSortMenuOpen(o => !o); setGroupMenuOpen(false); }} className={clsx(toolbarBtn, (sortMenuOpen || sorts.length) && '!bg-[var(--color-surface)]')}>
              <Rows3 className="w-3.5 h-3.5 text-[var(--color-warm-gray)] rotate-90" /> <span className="@[600px]:inline hidden">Sort</span>
              {sorts.length > 0 && <span className="text-xs font-bold px-1.5 rounded-full" style={{ backgroundColor: 'var(--color-steel)', color: 'white' }}>{sorts.length}</span>}
            </button>
            <AnimatePresence>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute top-full right-0 mt-1 w-72 border rounded-xl shadow-lg z-50 p-3 flex flex-col gap-2" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Sort by…</div>
                    {sorts.length === 0 && <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No sort. Add a field below — later ones break ties.</div>}
                    {sorts.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium px-2 py-1.5 rounded-md whitespace-nowrap flex-1" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{i > 0 && 'then '}{fields.find(f => f.id === s.id)?.label.toLowerCase()}</span>
                        <select value={s.dir} onChange={e => setSortDir(s.id, e.target.value as 'asc' | 'desc')} className="text-xs px-1.5 py-1.5 border rounded-md outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
                          <option value="asc">ascending</option>
                          <option value="desc">descending</option>
                        </select>
                        <button onClick={() => removeSort(s.id)} className="p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--danger)]"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Add sort on</div>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.filter(f => !sorts.some(s => s.id === f.id)).map(f => (
                          <button key={f.id} onClick={() => addSort(f.id)} className="text-xs px-2 py-1 rounded-md border hover:border-[var(--color-steel)] hover:text-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>+ {f.label.toLowerCase()}</button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          )}

          {/* Group by — collapsible sections; suspends pagination while active */}
          {activeView === 'table' && (
          <div className="relative">
            <button title="Group rows by a field" onClick={() => { setGroupMenuOpen(o => !o); setSortMenuOpen(false); }} className={clsx(toolbarBtn, (groupMenuOpen || groupBy) && '!bg-[var(--color-surface)]')}>
              <Rows3 className="w-3.5 h-3.5 text-[var(--color-warm-gray)]" /> <span className="@[600px]:inline hidden">{groupBy ? `Group: ${fields.find(f => f.id === groupBy)?.label.toLowerCase()}` : 'Group'}</span>
            </button>
            <AnimatePresence>
              {groupMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setGroupMenuOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute top-full right-0 mt-1 w-56 border rounded-xl shadow-lg z-50 overflow-hidden py-1" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    <button onClick={() => { setGroupBy(null); setGroupMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm" style={{ backgroundColor: !groupBy ? 'var(--color-surface)' : 'transparent', color: !groupBy ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                      None{!groupBy && <Check className="w-3.5 h-3.5 ml-auto" />}
                    </button>
                    {fields.map(f => (
                      <button key={f.id} onClick={() => { setGroupBy(f.id); setGroupMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm capitalize truncate" style={{ backgroundColor: groupBy === f.id ? 'var(--color-surface)' : 'transparent', color: groupBy === f.id ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                        {f.label.toLowerCase()}{groupBy === f.id && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          )}

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
                      {fields.map(f => renamingFieldId === f.id ? (
                        <div key={f.id} className="w-full flex items-center gap-1.5 px-3 py-1.5">
                          <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { const v = renameValue.trim(); setColumnLabelOverrides(prev => v ? { ...prev, [f.id]: v.toUpperCase() } : { ...prev, [f.id]: undefined as any }); setRenamingFieldId(null); }
                              if (e.key === 'Escape') setRenamingFieldId(null);
                            }}
                            className="flex-1 min-w-0 px-2 py-1 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-steel)' }} />
                          <button onClick={() => { const v = renameValue.trim(); setColumnLabelOverrides(prev => v ? { ...prev, [f.id]: v.toUpperCase() } : { ...prev, [f.id]: undefined as any }); setRenamingFieldId(null); }} className="p-1 rounded text-[var(--color-steel)]"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setRenamingFieldId(null)} className="p-1 rounded text-[var(--color-warm-gray)]"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div key={f.id} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-surface)] transition-colors group" style={{ color: 'var(--color-navy)' }}>
                          <button onClick={() => toggleCol(f.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                            {vis[f.id] ? <Eye className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> : <EyeOff className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />}
                            <span className="capitalize truncate">{f.label.toLowerCase()}</span>
                            {(f as any).toolId && <Wrench className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />}
                          </button>
                          <button title="Rename column" onClick={() => { setRenamingFieldId(f.id); setRenameValue(f.label); }} className="p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><Tag className="w-3.5 h-3.5" /></button>
                          <button onClick={() => toggleCol(f.id)} className="ml-1 w-9 h-5 rounded-full relative shrink-0" style={{ backgroundColor: vis[f.id] ? 'var(--color-steel)' : 'var(--color-border)' }}><span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ transform: vis[f.id] ? 'translateX(16px)' : 'none' }} /></button>
                        </div>
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
                          {addColMode === 'manual' && (
                            <>
                              <select
                                value={addColType}
                                onChange={e => { setAddColType(e.target.value as ColumnType); setAddColOptions(''); }}
                                className="px-2 py-1.5 border rounded-md text-sm outline-none"
                                style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}
                              >
                                {COLUMN_TYPES.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
                              </select>
                              {(addColType === 'select' || addColType === 'multiselect') && (
                                <input
                                  value={addColOptions}
                                  onChange={e => setAddColOptions(e.target.value)}
                                  placeholder="Options: Yes, No, Maybe…"
                                  className="px-2 py-1.5 border rounded-md text-sm outline-none"
                                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                                />
                              )}
                            </>
                          )}
                          {addColMode === 'tool' && (
                            <select value={addColTool} onChange={e => setAddColTool(e.target.value)} className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                              {tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          )}
                          <div className="flex gap-1.5">
                            <button onClick={addColumn} disabled={!addColName.trim()} className="flex-1 text-sm font-semibold px-2 py-1.5 rounded-md text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>Add</button>
                            <button onClick={() => { setAddColOpen(false); setAddColName(''); setAddColType('text'); setAddColOptions(''); }} className="px-2 py-1.5 text-sm" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
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

      {(rowFilters.some(f => f.value || f.op === 'is_empty' || f.op === 'is_not_empty') || query) && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-[var(--color-surface)]/40 text-xs flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
          {query && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>"{query}" <button onClick={() => setQuery('')}><X className="w-3 h-3" /></button></span>}
          {rowFilters.filter(f => f.value || f.op === 'is_empty' || f.op === 'is_not_empty').map((f, i) => <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{fields.find(x => x.id === f.field)?.label.toLowerCase()}{f.op && f.op !== 'contains' ? ` ${f.op.replace(/_/g, ' ')}` : ':'} {f.value}</span>)}
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
              <div className="flex-1 min-h-0" style={groupedRows ? { overflowY: 'auto' } : undefined}>
                {sorted.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>No {noun} match your filters.</div>
                ) : groupedRows ? (
                  // Grouped view: one collapsible section + bounded-height GlideTable per bucket.
                  // Groups over the FULL filtered/sorted set (pagination is suspended while grouped).
                  <div className="flex flex-col">
                    {groupedRows.map(([key, rows]) => {
                      const collapsed = collapsedGroups.has(key);
                      const sectionHeight = Math.min(rows.length, 8) * densityPx + 40;
                      return (
                        <div key={key} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                          <button onClick={() => toggleGroupCollapsed(key)} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-semibold sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)' }}>
                            <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', collapsed && '-rotate-90')} style={{ color: 'var(--color-warm-gray)' }} />
                            {key} <span className="text-xs font-normal" style={{ color: 'var(--color-warm-gray)' }}>{rows.length}</span>
                          </button>
                          {!collapsed && (
                            <div style={{ height: sectionHeight }}>
                              <GlideTable
                                key={`${activeTab}-group-${key}`}
                                rows={rows}
                                fields={glideFields}
                                rowHeight={densityPx}
                                sorts={sorts}
                                onSort={toggleSort}
                                onOpen={handleGlideOpen}
                                selectable={selecting}
                                onSelectedRowsChange={(n, idx) => { setSelectedCount(n); setSelectedRowIdx(idx); }}
                                onCellEdit={handleGlideCellEdit}
                                onCellEdited={editCell}
                                onRowMenu={handleGlideRowMenu}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <GlideTable
                    key={`${activeTab}-${currentPage}`}
                    rows={pageData}
                    fields={glideFields}
                    rowHeight={densityPx}
                    sorts={sorts}
                    onSort={toggleSort}
                    onOpen={handleGlideOpen}
                    selectable={selecting}
                    onSelectedRowsChange={(n, idx) => { setSelectedCount(n); setSelectedRowIdx(idx); }}
                    onCellEdit={handleGlideCellEdit}
                    onCellEdited={editCell}
                    onRowMenu={handleGlideRowMenu}
                  />
                )}
              </div>
              {/* Column summary / calc strip — Notion-style, above pagination */}
              {sorted.length > 0 && (
                <div className="shrink-0 overflow-x-auto border-t flex items-center gap-4 px-4 py-1.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <span className="text-xs font-semibold whitespace-nowrap shrink-0" style={{ color: 'var(--color-navy-mid)' }}>
                    {sorted.length} {noun}
                  </span>
                  {colSummary.map(s => (
                    <span key={s.id} className="text-xs whitespace-nowrap shrink-0" style={{ color: 'var(--color-warm-gray)' }}>
                      <span className="font-medium" style={{ color: 'var(--color-navy-mid)' }}>{s.label.toLowerCase()}</span>
                      {s.kind === 'numeric'
                        ? <> · Σ <span style={{ color: 'var(--color-navy)' }}>{s.sum}</span> · x̄ <span style={{ color: 'var(--color-navy)' }}>{s.avg}</span></>
                        : <> · <span style={{ color: 'var(--color-navy)' }}>{s.filled}/{s.total}</span> filled</>
                      }
                    </span>
                  ))}
                </div>
              )}
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
          ) : activeView === 'calendar' ? (
            <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-5">
              {(() => {
                const { year, month } = calMonth;
                const monthName = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();

                // Build a map: day-of-month → rows with a date in that day
                const dayMap: Record<number, any[]> = {};
                const noDateRows: any[] = [];
                for (const row of filtered) {
                  const raw = row.connectedOn || row.lastConnected;
                  let ts = raw ? parseConnected(raw) : 0;
                  if (!ts && raw) ts = Date.parse(raw) || 0;
                  if (!ts) { noDateRows.push(row); continue; }
                  const d = new Date(ts);
                  if (d.getFullYear() === year && d.getMonth() === month) {
                    const day = d.getDate();
                    if (!dayMap[day]) dayMap[day] = [];
                    dayMap[day].push(row);
                  }
                }

                // Cells: leading blanks + day cells
                const totalCells = firstDay + daysInMonth;
                const cells: (number | null)[] = [
                  ...Array(firstDay).fill(null),
                  ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                ];
                // Pad to complete the last week
                while (cells.length % 7 !== 0) cells.push(null);
                const weeks: (number | null)[][] = [];
                for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

                const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const isToday = (d: number) => {
                  const now = new Date();
                  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === d;
                };

                return (
                  <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full">
                    {/* Month header */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setCalMonth(({ year: y, month: m }) => m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 })}
                        className="p-1.5 rounded-lg border hover:bg-[var(--color-surface)] transition-colors"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <h2 className="flex-1 text-center text-base font-bold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>
                        {monthName} {year}
                      </h2>
                      <button
                        onClick={() => {
                          const now = new Date();
                          setCalMonth({ year: now.getFullYear(), month: now.getMonth() });
                        }}
                        className="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:bg-[var(--color-surface)] transition-colors"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                      >
                        Today
                      </button>
                      <button
                        onClick={() => setCalMonth(({ year: y, month: m }) => m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 })}
                        className="p-1.5 rounded-lg border hover:bg-[var(--color-surface)] transition-colors"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Day-of-week header row */}
                    <div className="grid grid-cols-7 border rounded-xl overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      {DAYS.map(d => (
                        <div key={d} className="px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wider border-b" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-warm-gray)', borderColor: 'var(--color-border)' }}>{d}</div>
                      ))}

                      {/* Week rows */}
                      {weeks.map((week, wi) =>
                        week.map((day, di) => {
                          const rows = day ? (dayMap[day] || []) : [];
                          const overflow = rows.length > 3 ? rows.length - 3 : 0;
                          const shown = rows.slice(0, 3);
                          const borderR = di < 6 ? '1px solid var(--color-border)' : 'none';
                          const borderB = wi < weeks.length - 1 ? '1px solid var(--color-border)' : 'none';
                          return (
                            <div
                              key={`${wi}-${di}`}
                              className="min-h-[88px] p-1.5 flex flex-col gap-0.5"
                              style={{ borderRight: borderR, borderBottom: borderB, backgroundColor: day ? 'white' : 'var(--color-surface)' }}
                            >
                              {day && (
                                <>
                                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-0.5 self-start ${isToday(day) ? 'text-white' : ''}`}
                                    style={{ backgroundColor: isToday(day) ? 'var(--color-steel)' : 'transparent', color: isToday(day) ? 'white' : 'var(--color-navy-mid)' }}>
                                    {day}
                                  </span>
                                  {shown.map(row => (
                                    <button
                                      key={row.id}
                                      onClick={() => navigate(`/item/${encodeURIComponent(row.name)}`)}
                                      className="w-full text-left text-[11px] font-medium px-1.5 py-0.5 rounded truncate hover:opacity-80 transition-opacity"
                                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 12%, transparent)', color: 'var(--color-navy)' }}
                                      title={row.name}
                                    >
                                      {row.name}
                                    </button>
                                  ))}
                                  {overflow > 0 && (
                                    <span className="text-[10px] px-1.5" style={{ color: 'var(--color-warm-gray)' }}>+{overflow} more</span>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* No-date tray */}
                    {noDateRows.length > 0 && (
                      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-warm-gray)' }}>No date — {noDateRows.length} {noun}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {noDateRows.slice(0, 30).map(row => (
                            <button
                              key={row.id}
                              onClick={() => navigate(`/item/${encodeURIComponent(row.name)}`)}
                              className="text-xs px-2 py-1 rounded-lg border bg-white hover:border-[var(--color-steel)] transition-colors truncate max-w-[160px]"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                              title={row.name}
                            >
                              {row.name}
                            </button>
                          ))}
                          {noDateRows.length > 30 && <span className="text-xs self-center" style={{ color: 'var(--color-warm-gray)' }}>+{noDateRows.length - 30} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          ) : activeView === 'network' ? (
            <motion.div key="network" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto p-5">
              {(() => {
                const CAP = 60;
                const capped = filtered.slice(0, CAP);
                const overflow = filtered.length - CAP;

                // Cluster by company (People) or communityType (Communities)
                const clusterKey = (row: any): string => {
                  if (activeTab === 'People') return row.company || 'Independent';
                  return row.communityType || 'Other';
                };
                const clusters = new Map<string, any[]>();
                for (const row of capped) {
                  const k = clusterKey(row);
                  if (!clusters.has(k)) clusters.set(k, []);
                  clusters.get(k)!.push(row);
                }
                // Sort clusters by size desc
                const sorted_clusters = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);

                return (
                  <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>
                        Network — {filtered.length} {noun}
                        {overflow > 0 && <span className="text-xs font-normal ml-2" style={{ color: 'var(--color-warm-gray)' }}>· showing first {CAP}, +{overflow} more</span>}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>
                        {sorted_clusters.length} {activeTab === 'People' ? 'companies' : 'types'} · click any node to open
                      </div>
                    </div>

                    {/* Cluster grid */}
                    <div className="flex flex-col gap-5">
                      {sorted_clusters.map(([label, members]) => (
                        <div key={label} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                          {/* Cluster hub bar */}
                          <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: 'var(--color-steel)', color: 'white' }}>
                              {label.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{label}</span>
                            <span className="ml-auto text-xs px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: 'white', color: 'var(--color-navy-mid)', border: '1px solid var(--color-border)' }}>
                              {members.length} {members.length === 1 ? (activeTab === 'People' ? 'person' : 'community') : noun}
                            </span>
                          </div>
                          {/* Member chips — flex wrap */}
                          <div className="p-3 flex flex-wrap gap-2 bg-white">
                            {members.map((row: any) => (
                              <button
                                key={row.id}
                                onClick={() => navigate(`/item/${encodeURIComponent(row.name)}`)}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium hover:border-[var(--color-steel)] hover:shadow-sm transition-all"
                                style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}
                                title={row.position || row.communityType || row.name}
                              >
                                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)' }}>
                                  {(row.name || '?').charAt(0)}
                                </span>
                                <span className="truncate max-w-[140px]">{row.name}</span>
                                {row.position && <span className="text-[10px] hidden sm:inline truncate max-w-[100px]" style={{ color: 'var(--color-warm-gray)' }}>{row.position}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {overflow > 0 && (
                      <p className="text-xs text-center pt-1" style={{ color: 'var(--color-warm-gray)' }}>
                        +{overflow} {noun} not shown — narrow the filter to see more.
                      </p>
                    )}
                  </div>
                );
              })()}
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
        {(activeView === 'table' || activeView === 'gallery' || activeView === 'kanban') && (
          <button title="Add a new row (locally editable, persists on this device)" onClick={addRow} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border shadow-sm transition-all hover:bg-[var(--color-surface)] active:scale-95" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
            <Plus className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} /> Add row
          </button>
        )}
        {/* Pagination is suspended while grouped — groups already show every matching row. */}
        {!groupedRows && (
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
        )}
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

      {/* Select / Multi-select popover for custom columns */}
      <AnimatePresence>
        {selectPopover && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setSelectPopover(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[61] min-w-[200px] rounded-xl border shadow-xl overflow-hidden"
              style={{
                left: Math.min(selectPopover.x, window.innerWidth - 220),
                top: Math.min(selectPopover.y + 8, window.innerHeight - 300),
                backgroundColor: 'white',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
                <Tag className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>
                  {selectPopover.field.label.toLowerCase()}
                </span>
              </div>
              <div className="py-1 max-h-48 overflow-y-auto">
                {(selectPopover.field.options || []).map(opt => {
                  const raw = cellOverrides[selectPopover.row.id]?.[selectPopover.field.id] ?? selectPopover.row[selectPopover.field.id];
                  const isMulti = selectPopover.field.columnType === 'multiselect';
                  const current: string[] = Array.isArray(raw) ? raw : (raw ? [String(raw)] : []);
                  const active = current.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        if (isMulti) {
                          const next = active ? current.filter(v => v !== opt) : [...current, opt];
                          editCell(selectPopover.row, selectPopover.field.id, next);
                          // Keep popover open for multi-select.
                        } else {
                          editCell(selectPopover.row, selectPopover.field.id, opt);
                          setSelectPopover(null);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                      style={{ color: active ? 'var(--color-steel)' : 'var(--color-navy-mid)', fontWeight: active ? 600 : 400 }}
                    >
                      {active
                        ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
                        : <span className="w-3.5 shrink-0" />}
                      {opt}
                    </button>
                  );
                })}
                {(selectPopover.field.options || []).length === 0 && (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>No options yet — add one below.</div>
                )}
              </div>
              <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = selectNewOpt.trim();
                    if (!v) return;
                    const fid = selectPopover.field.id;
                    // Append option to the field definition.
                    setCustomFields(prev => ({
                      ...prev,
                      [activeTab]: (prev[activeTab] || []).map(f =>
                        f.id === fid ? { ...f, options: [...(f.options || []), v] } : f
                      ),
                    }));
                    // Also select it immediately.
                    if (selectPopover.field.columnType === 'multiselect') {
                      const raw = cellOverrides[selectPopover.row.id]?.[fid] ?? selectPopover.row[fid];
                      const current: string[] = Array.isArray(raw) ? raw : (raw ? [String(raw)] : []);
                      editCell(selectPopover.row, fid, [...current, v]);
                    } else {
                      editCell(selectPopover.row, fid, v);
                      setSelectPopover(null);
                    }
                    setSelectNewOpt('');
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    autoFocus
                    value={selectNewOpt}
                    onChange={e => setSelectNewOpt(e.target.value)}
                    placeholder="Add option…"
                    className="flex-1 min-w-0 px-2 py-1.5 border rounded-md text-sm outline-none"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                  />
                  <button
                    type="submit"
                    disabled={!selectNewOpt.trim()}
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

      {/* Date popover for custom date columns */}
      <AnimatePresence>
        {datePopover && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setDatePopover(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[61] rounded-xl border shadow-xl overflow-hidden"
              style={{
                left: Math.min(datePopover.x, window.innerWidth - 240),
                top: Math.min(datePopover.y + 8, window.innerHeight - 120),
                backgroundColor: 'white',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>
                  {datePopover.field.label.toLowerCase()}
                </span>
              </div>
              <div className="px-3 py-3">
                <input
                  type="date"
                  autoFocus
                  defaultValue={(() => {
                    const raw = cellOverrides[datePopover.row.id]?.[datePopover.field.id] ?? datePopover.row[datePopover.field.id];
                    return typeof raw === 'string' ? raw : '';
                  })()}
                  onChange={e => {
                    editCell(datePopover.row, datePopover.field.id, e.target.value);
                    setDatePopover(null);
                  }}
                  className="px-2 py-1.5 border rounded-md text-sm outline-none w-full"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                />
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

      {/* Row right-click context menu */}
      <AnimatePresence>
        {rowMenu && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setRowMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRowMenu(null); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[61] w-52 rounded-xl border shadow-xl overflow-hidden"
              style={{ left: Math.min(rowMenu.x, window.innerWidth - 220), top: Math.min(rowMenu.y, window.innerHeight - 200), backgroundColor: 'white', borderColor: 'var(--color-border)' }}
            >
              <div className="px-3 py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider truncate block" style={{ color: 'var(--color-warm-gray)' }}>{rowMenu.row.name}</span>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { navigate(`/item/${encodeURIComponent(rowMenu.row.name)}`); setRowMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                  style={{ color: 'var(--color-navy-mid)' }}
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} /> Open
                </button>
                <button
                  onClick={() => {
                    const src = rowMenu.row;
                    const id = `new-${activeTab}-${++addedCounter.current}`;
                    const clone = { ...src, id, name: `${src.name} (copy)` };
                    setAddedRows(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), clone] }));
                    setRowMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                  style={{ color: 'var(--color-navy-mid)' }}
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} /> Duplicate
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/item/${encodeURIComponent(rowMenu.row.name)}`);
                    setRowMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                  style={{ color: 'var(--color-navy-mid)' }}
                >
                  <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} /> Copy link
                </button>
              </div>
              <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => {
                    const id = rowMenu.row.id as string;
                    if (id.startsWith('new-')) {
                      setAddedRows(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter(r => r.id !== id) }));
                    } else {
                      setDeletedIdsArr(prev => prev.includes(id) ? prev : [...prev, id]);
                    }
                    setRowMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface)] transition-colors"
                  style={{ color: 'var(--danger)' }}
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" /> Delete
                </button>
              </div>
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
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
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
