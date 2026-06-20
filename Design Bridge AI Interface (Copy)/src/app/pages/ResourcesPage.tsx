import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { BookOpen, Search, ExternalLink, Pin, PinOff, Star, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { usePinnedTools } from '../Layout';
import { loadCanonicalResources, type PeopleSource } from '../data/db';
import { resources as localResources, type NetworkResource } from '../data/resources.generated';
import { listCaptures, getBlobUrl, type MediaCaptureRecord } from '../data/localMedia';

// Local captures strip — photos/videos from the Camera tool, stored on THIS device only
// (never cloud). Browsable here; committed ones carry a Touchpoint + ledger id.
function LocalCapturesStrip() {
  const [items, setItems] = useState<MediaCaptureRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const all = await listCaptures();
      const visible = all.filter(r => r.status !== 'archived');
      setItems(visible);
      const next: Record<string, string> = {};
      for (const r of visible) next[r.id] = r.thumbnailDataUrl || (await getBlobUrl(r.id)) || '';
      setUrls(next);
    })();
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="mx-4 mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Captures</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{items.length} · local-only</span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Photos &amp; videos stored on this device — never the cloud</span>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {items.map(r => (
          <div key={r.id} className="rounded-lg overflow-hidden border relative" style={{ borderColor: 'var(--color-border)' }} title={`${r.kind} · ${r.status}`}>
            {urls[r.id] && (r.kind === 'photo'
              ? <img src={urls[r.id]} alt="capture" className="w-full h-20 object-cover" />
              : <video src={urls[r.id]} className="w-full h-20 object-cover bg-black" />)}
            <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded text-white" style={{ backgroundColor: r.status === 'committed' ? 'var(--success)' : 'rgba(0,0,0,0.6)' }}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Resources Tool — a curated, filterable, EDITABLE table of learning resources (books / podcasts /
// vlogs) for acquisition entrepreneurs. Each row links out to its source. Lives at /resources,
// opened from the Tools page or a sidebar pin (data/tools.ts id 'resources'). Reads the canonical
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

export function ResourcesPage() {
  const { isPinned, togglePin } = usePinnedTools();
  const pinned = isPinned('resources');
  const [rows, setRows] = useState<NetworkResource[]>(localResources);
  const [source, setSource] = useState<PeopleSource>('local');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');

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
      {/* Header — tool path + pin */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-12 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/tools" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Tools</Link>
            <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
            <span className="bg-[var(--color-surface)] text-[var(--color-navy)] px-2.5 py-1 rounded text-xs font-semibold shadow-sm inline-flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} /> Resources
            </span>
          </div>
          <button
            onClick={() => togglePin('resources')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold border rounded-lg shadow-sm transition-colors hover:bg-[var(--color-surface)]"
            style={{ borderColor: 'var(--color-border)', color: pinned ? 'var(--color-steel)' : 'var(--color-navy-mid)', backgroundColor: 'white' }}
            title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {pinned ? 'Pinned' : 'Pin to sidebar'}
          </button>
        </div>

        {/* Toolbar — add entry + search + type filter pills + count */}
        <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
          <button onClick={addEntry} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg text-white shadow-sm transition-transform active:scale-95" style={{ backgroundColor: 'var(--color-steel)' }}>
            <Plus className="w-3.5 h-3.5" /> Add entry
          </button>
          <div className="relative shrink flex-1 max-w-[320px] min-w-[160px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search resources…" className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm outline-none shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {TYPE_FILTERS.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className="text-sm px-3 py-1.5 rounded-full border transition-colors" style={{ borderColor: typeFilter === t ? 'var(--color-steel)' : 'var(--color-border)', backgroundColor: typeFilter === t ? 'var(--color-steel)' : 'white', color: typeFilter === t ? 'white' : 'var(--color-navy-mid)' }}>
                {t} <span className="opacity-70">{counts[t]}</span>
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs" style={{ color: 'var(--color-warm-gray)' }}>
            {filtered.length} of {merged.length} · {source === 'supabase' ? 'live store' : 'local seed'} · edits saved locally
          </span>
        </div>
      </div>

      {/* Table — every cell click-to-edit; added rows can be deleted */}
      <div className="flex-1 overflow-auto bg-white">
        <LocalCapturesStrip />
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
