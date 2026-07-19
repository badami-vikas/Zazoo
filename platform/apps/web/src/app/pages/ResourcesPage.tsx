import { useState, useEffect, useMemo } from 'react';
import { BookOpen, ExternalLink, Star, Plus, Trash2, Download } from 'lucide-react';
import { Link } from 'react-router';
import { Header } from '../components/shared/Header';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { CollapsibleInsights } from '../components/shared/CollapsibleInsights';
import { exportRowsToCsv } from '../lib/exportTable';
import { loadCanonicalResources, type PeopleSource } from '../data/db';
import { resources as localResources, type NetworkResource } from '../data/resources.generated';

// Resources Page — a curated, filterable, EDITABLE table of learning resources (books / podcasts /
// vlogs) for acquisition entrepreneurs. Each row links out to its source. Reads the canonical
// tier (resources_canonical) when reachable; else the local seed. Edits, manually-added rows, and
// notes are the user's private layer — persisted to localStorage, never written back to the store.
const TYPE_FILTERS = ['All', 'Books', 'Podcasts', 'Vlogs'] as const;
type TypeFilter = typeof TYPE_FILTERS[number];

const matchesType = (r: NetworkResource, f: TypeFilter) =>
  f === 'All' ? true
    : f === 'Books' ? /book/i.test(r.type || '')
    : f === 'Podcasts' ? /podcast/i.test(r.type || '')
    : /vlog|video/i.test(r.type || '');

const EDITS_KEY = 'bridge.resourceEdits.v1';   // { [id]: { field: value } }  (tags stored as string[])
const ADDED_KEY = 'bridge.resourceAdded.v1';   // NetworkResource[]
const loadJSON = <T,>(k: string, fb: T): T => { try { return JSON.parse(localStorage.getItem(k) || '') as T; } catch { return fb; } };

// Click-to-edit cell. Renders text; on click becomes an input/textarea; saves on blur/Enter.
function EditableCell({ value, onSave, placeholder, multiline, className }: { value: string; onSave: (v: string) => void; placeholder?: string; multiline?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  if (editing) {
    const save = () => { onSave(draft); setEditing(false); };
    return multiline
      ? <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} rows={2} className="w-full bg-white border border-[var(--color-steel)] rounded p-1 text-sm outline-none resize-none" />
      : <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} className="w-full bg-white border border-[var(--color-steel)] rounded p-1 text-sm outline-none" />;
  }
  return (
    <div onClick={() => setEditing(true)} className={`cursor-text rounded px-1 -mx-1 hover:bg-[color-mix(in_srgb,var(--color-steel)_8%,transparent)] min-h-[20px] ${className || ''}`} title="Click to edit">
      {value || <span style={{ color: 'var(--color-warm-gray)' }}>{placeholder || '—'}</span>}
    </div>
  );
}

// `embedded` = rendered inside another shell-v2 page (KnowledgeBase tab) — skip the page-level
// centered Header so the host page's toggle stays the identity element.
export function ResourcesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<NetworkResource[]>(localResources);
  const [source, setSource] = useState<PeopleSource>('local');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);

  // Private editing layer (localStorage).
  const [edits, setEdits] = useState<Record<string, Record<string, any>>>(() => loadJSON(EDITS_KEY, {}));
  const [added, setAdded] = useState<NetworkResource[]>(() => loadJSON(ADDED_KEY, []));
  useEffect(() => { try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); } catch {} }, [edits]);
  useEffect(() => { try { localStorage.setItem(ADDED_KEY, JSON.stringify(added)); } catch {} }, [added]);

  useEffect(() => {
    let alive = true;
    loadCanonicalResources().then(({ rows, source }) => { if (alive) { setRows(rows); setSource(source); } });
    return () => { alive = false; };
  }, []);

  const setField = (id: string, field: string, value: any) =>
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));

  const addEntry = () => {
    const id = `new-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    setAdded(prev => [{ id, name: 'New resource', type: 'Book', url: '', description: '', newsInsight: '', tags: [], dateAdded: today }, ...prev]);
    setTypeFilter('All');
  };
  const deleteAdded = (id: string) => setAdded(prev => prev.filter(r => r.id !== id));

  // Merge canonical + manually-added, then apply the per-row edits overlay.
  const merged = useMemo<NetworkResource[]>(
    () => [...added, ...rows].map(r => ({ ...r, ...(edits[r.id] || {}) })),
    [added, rows, edits],
  );

  const counts = useMemo(() => ({
    All: merged.length,
    Books: merged.filter(r => matchesType(r, 'Books')).length,
    Podcasts: merged.filter(r => matchesType(r, 'Podcasts')).length,
    Vlogs: merged.filter(r => matchesType(r, 'Vlogs')).length,
  }), [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter(r => {
      if (!matchesType(r, typeFilter)) return false;
      if (!q) return true;
      const hay = [r.name, r.fullTitle, r.description, r.author, r.host, r.source, r.notes, (r.tags || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [merged, typeFilter, query]);

  const th = 'font-semibold uppercase tracking-wider text-[11px] px-2 py-2.5 text-left';

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {!embedded && <Header tabs={[{ id: 'Resources', icon: BookOpen }]} activeTab="Resources" onTabChange={() => {}} />}

      <StandardToolbar
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen(o => !o)}
        search={query}
        onSearchChange={setQuery}
        onFilterClick={() => setFilterOpen(o => !o)}
        filterCount={typeFilter === 'All' ? 0 : 1}
        filterOpen={filterOpen}
        filterPanel={
          <div className="absolute top-full right-0 mt-1 w-44 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
            {TYPE_FILTERS.map(t => (
              <button key={t} onClick={() => { setTypeFilter(t); setFilterOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm"
                style={{ color: typeFilter === t ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                {t} <span className="opacity-60">{counts[t]}</span>
              </button>
            ))}
          </div>
        }
        customActions={
          <>
            <button onClick={addEntry} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg text-white shadow-sm transition-transform active:scale-95" style={{ backgroundColor: 'var(--color-steel)' }}>
              <Plus className="w-3.5 h-3.5" /> Add entry
            </button>
            <button
              onClick={() => exportRowsToCsv(
                filtered,
                [
                  { id: 'type', label: 'Type' },
                  { id: 'author', label: 'Author / Host' },
                  { id: 'tags', label: 'Topics' },
                  { id: 'rating', label: 'Rating' },
                  { id: 'yearPublished', label: 'Year' },
                  { id: 'notes', label: 'Notes' },
                  { id: 'url', label: 'URL' },
                ],
                'resources-export.csv',
              )}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border shadow-sm transition-colors hover:bg-[var(--color-surface)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}
              title="Export visible rows to CSV"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </>
        }
        moreMenu={!embedded ? <Link to="/settings" className="block px-3 py-2 text-xs hover:bg-black/5">Open Settings</Link> : undefined}
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        filters={typeFilter === 'All' ? [] : [{ id: 'type', label: `Type: ${typeFilter}` }]}
        onRemoveFilter={() => setTypeFilter('All')}
        onClearFilters={() => setTypeFilter('All')}
        metrics={[
          { id: 'shown', label: 'Shown', value: `${filtered.length}`, hint: `of ${merged.length} · ${source === 'supabase' ? 'live store' : 'local seed'} · edits saved locally` },
          { id: 'books', label: 'Books', value: String(counts.Books) },
          { id: 'podcasts', label: 'Podcasts', value: String(counts.Podcasts) },
          { id: 'vlogs', label: 'Vlogs', value: String(counts.Vlogs) },
        ]}
      />

      {/* Table — every cell click-to-edit; added rows can be deleted */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface)]" style={{ color: 'var(--color-warm-gray)' }}>
            <tr>
              <th className={th + ' w-[44px]'}></th>
              <th className={th}>Title</th>
              <th className={th + ' w-[120px]'}>Type</th>
              <th className={th + ' w-[170px]'}>Author / Host</th>
              <th className={th + ' w-[200px]'}>Topics</th>
              <th className={th + ' w-[80px]'}>Rating</th>
              <th className={th + ' w-[64px]'}>Year</th>
              <th className={th + ' w-[240px]'}>Notes</th>
              <th className={th + ' w-[70px]'}>Open</th>
              <th className={th + ' w-[40px]'}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isAdded = r.id.startsWith('new-');
              return (
                <tr key={r.id} className="border-b align-top hover:bg-[color-mix(in_srgb,var(--color-steel)_4%,transparent)] transition-colors" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-2.5">
                    {r.coverImageUrl
                      ? <img src={r.coverImageUrl} alt="" loading="lazy" className="w-8 h-11 object-cover rounded shadow-sm" />
                      : <div className="w-8 h-11 rounded bg-[var(--color-surface)] flex items-center justify-center"><BookOpen className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></div>}
                  </td>
                  <td className="px-2 py-2.5 max-w-[360px]">
                    <EditableCell value={r.name} onSave={v => setField(r.id, 'name', v)} className="font-semibold text-[var(--color-navy)]" />
                    <EditableCell value={r.description || ''} onSave={v => setField(r.id, 'description', v)} placeholder="Add a description…" multiline className="text-xs text-[var(--color-warm-gray)] mt-0.5" />
                  </td>
                  <td className="px-2 py-2.5"><EditableCell value={r.type || ''} onSave={v => setField(r.id, 'type', v)} placeholder="Type" /></td>
                  <td className="px-2 py-2.5"><EditableCell value={r.author || r.host || ''} onSave={v => setField(r.id, 'author', v)} placeholder="Author / host" className="text-[var(--color-navy-mid)]" /></td>
                  <td className="px-2 py-2.5">
                    <EditableCell value={(r.tags || []).join(', ')} onSave={v => setField(r.id, 'tags', v.split(',').map(s => s.trim()).filter(Boolean))} placeholder="Comma-separated topics" className="text-xs text-[var(--color-navy-mid)]" />
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 shrink-0" style={{ color: 'var(--color-steel)' }} /><EditableCell value={r.rating != null ? String(r.rating) : ''} onSave={v => setField(r.id, 'rating', v.trim() === '' ? undefined : (Number(v) || v))} placeholder="—" className="text-[var(--color-navy-mid)]" /></span>
                  </td>
                  <td className="px-2 py-2.5"><EditableCell value={r.yearPublished || ''} onSave={v => setField(r.id, 'yearPublished', v)} className="text-[var(--color-navy-mid)]" /></td>
                  <td className="px-2 py-2.5"><EditableCell value={r.notes || ''} onSave={v => setField(r.id, 'notes', v)} placeholder="Add a note…" multiline className="text-[var(--color-navy-mid)]" /></td>
                  <td className="px-2 py-2.5">
                    {isAdded
                      ? <EditableCell value={r.url || ''} onSave={v => setField(r.id, 'url', v)} placeholder="URL" className="text-xs text-[var(--color-steel)]" />
                      : r.url
                        ? <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-steel)' }}>Open <ExternalLink className="w-3 h-3" /></a>
                        : <span style={{ color: 'var(--color-warm-gray)' }}>—</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    {isAdded && <button onClick={() => deleteAdded(r.id)} title="Delete entry" className="p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--danger)]"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-16 text-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>No resources match your filters. Use <span className="font-semibold">Add entry</span> to create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
