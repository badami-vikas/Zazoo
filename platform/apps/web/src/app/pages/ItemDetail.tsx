import { useState, useEffect, useRef, type ReactNode, type ElementType } from 'react';
import {
  ChevronRight, ChevronDown, Link as LinkIcon, Building2, MapPin, FileText, Image as ImageIcon,
  FileSpreadsheet, Users, Edit2, Download, Share2, MoreHorizontal, Eye, Lock, Globe2,
  Mail, Phone, Globe, Github, Linkedin, Instagram, Twitter, Plus, X as XIcon, Quote,
  Network as NetworkIcon, Target, Repeat, ShieldCheck, Check, CircleSlash, Info,
  type LucideIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { AssociationsMap } from '../components/AssociationsMap';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { useInitiatives } from '../data/initiatives';
import { people, companies, threads, type NetworkPerson } from '../data/network';

type Tier = 'public' | 'private';
type Filter = 'all' | Tier;

const heading = 'text-2xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4';

function EditableText({ text, base, onSave, className, multiline = false, as: Component = 'div' }: {
  text: string; base?: string; onSave: (v: string) => void; className?: string; multiline?: boolean; as?: ElementType;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(text);
  const edited = base !== undefined && text !== base;
  useEffect(() => { setVal(text); }, [text]);
  if (isEditing) {
    const save = () => { if (val.trim() !== '') onSave(val); setIsEditing(false); };
    const cancel = () => { setVal(text); setIsEditing(false); };
    return multiline
      ? <textarea autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Escape') cancel(); }} className={clsx('w-full bg-white border border-[var(--color-steel)] rounded p-1.5 outline-none shadow-sm resize-none', className)} rows={3} />
      : <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }} className={clsx('bg-white border border-[var(--color-steel)] rounded p-1 outline-none shadow-sm max-w-full', className)} />;
  }
  return (
    <div className="group relative inline-flex items-start w-fit max-w-full cursor-text" onDoubleClick={() => setIsEditing(true)} title="Double-click to edit">
      <Component className={clsx('pr-6 border border-transparent hover:border-dashed hover:border-[var(--color-border)] rounded transition-colors', className)}>{text}</Component>
      {edited && (
        <span className="pointer-events-none absolute right-0 top-0 -translate-y-1/2 translate-x-1/4 select-none rounded-sm border px-1 py-px text-[9px] font-semibold uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-warm-gray)', background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>edited</span>
      )}
    </div>
  );
};

// editable multi-select tags (was "Expertise" → now "Tags")
function TagEditor({ seed }: { seed: string[] }) {
  const [tags, setTags] = useState(seed);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !tags.includes(v)) setTags([...tags, v]); setDraft(''); setAdding(false); };
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {tags.map(t => (
        <span key={t} className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, transparent)', color: 'var(--color-steel)' }}>
          {t}<button onClick={() => setTags(tags.filter(x => x !== t))} className="opacity-0 group-hover:opacity-100"><XIcon className="w-3 h-3" /></button>
        </span>
      ))}
      {adding
        ? <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={add} onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setDraft(''); setAdding(false); } }} placeholder="Add tag…" className="px-3 py-1.5 rounded-full text-sm border border-[var(--color-steel)] outline-none" />
        : <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] hover:border-[var(--color-steel)]" style={{ borderColor: 'var(--color-border)' }}><Plus className="w-3.5 h-3.5" /> Add</button>}
    </div>
  );
}

function ContactCard({ person, fv, setField }: { person?: NetworkPerson; fv: (f: string, b: string) => string; setField: (f: string, v: string) => void }) {
  const email = person?.email || '';
  const linkedin = person?.url || '';
  const liHandle = linkedin ? linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\//, '').replace(/\/$/, '') : '';
  const items = [
    { icon: Mail, label: 'Email', base: email },
    { icon: Linkedin, label: 'LinkedIn', base: liHandle },
    { icon: Phone, label: 'Phone', base: '' },
    { icon: Globe, label: 'Website', base: person?.websiteUrl || '' },
    { icon: Github, label: 'GitHub', base: person?.githubHandle || '' },
    { icon: Instagram, label: 'Instagram', base: person?.instagramHandle || '' },
    { icon: Twitter, label: 'X', base: person?.twitterHandle || '' },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {items.map(it => {
        const val = fv(`contact.${it.label}`, it.base);
        return (
          <div key={it.label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-white" style={{ borderColor: 'var(--color-border)' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-surface)' }}><it.icon className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>{it.label}</div>
              <EditableText text={val || `Add ${it.label.toLowerCase()}`} onSave={(v: string) => setField(`contact.${it.label}`, v)} className="text-sm" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusTag({ label, tone }: { label: string; tone: string }) {
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>{label}</span>;
}

// Generic small table — so an entity's Automations / initiatives / connections render as columns, not cards.
function MiniTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: 'var(--color-surface)' }}>
            {columns.map(c => <th key={c} className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: 'var(--color-warm-gray)', borderColor: 'var(--color-border)' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[var(--color-surface)]/40 transition-colors">
              {r.map((cell, j) => <td key={j} className="px-4 py-2.5 border-b align-middle" style={{ borderColor: 'var(--color-border)', color: j === 0 ? 'var(--color-navy)' : 'var(--color-navy-mid)', fontWeight: j === 0 ? 600 : 400 }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// was "Testimonials" → now "Opinions". No real opinions have been recorded for this person yet —
// an honest empty state, no fabricated quotes.
function Opinions() {
  const data: Array<{ quote: string; author: string; role: string }> = [];
  if (data.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed rounded-xl text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
        No opinions recorded yet.
      </div>
    );
  }
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {data.map((t, i) => (
        <div key={i} className="p-5 rounded-xl border bg-white shadow-sm flex flex-col gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <Quote className="w-5 h-5" style={{ color: 'var(--color-steel-light)' }} />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-navy)' }}>{t.quote}</p>
          <div className="mt-auto"><div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{t.author}</div><div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{t.role}</div></div>
        </div>
      ))}
    </div>
  );
}

// Associations now render via <AssociationsMap/> — one global map (data/associations.ts) re-centered
// on the selected entity, with table (1st/2nd/3rd+ degree) and graph views. (UnifiedGraph retired.)

function ListSection({ rows }: { rows: { title: string; meta: string; tag?: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white hover:border-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex-1"><div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{r.title}</div><div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{r.meta}</div></div>
          {r.tag && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{r.tag}</span>}
        </div>
      ))}
    </div>
  );
}

// Editable Boundaries + strong governance requirement (agents check boundaries first)
function Boundaries({ entityName }: { entityName: string }) {
  const [allowed, setAllowed] = useState(['Reconnect outreach (with approval)', 'Read canonical / public facts', 'Suggest introductions (sender-approved draft)']);
  const [denied, setDenied] = useState(['Auto-send any message', 'Share private notes or warmth', 'Contact outside the trusted network']);
  const Col = ({ title, items, setItems, tone, Icon }: {
    title: string; items: string[]; setItems: (v: string[]) => void; tone: string; Icon: LucideIcon;
  }) => {
    const [draft, setDraft] = useState('');
    return (
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: `color-mix(in srgb, ${tone} 30%, var(--color-border))` }}>
        <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: `color-mix(in srgb, ${tone} 8%, transparent)` }}>
          <Icon className="w-4 h-4" style={{ color: tone }} /><span className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>{title}</span>
        </div>
        <div className="p-2">
          {items.map((a: string, i: number) => (
            <div key={i} className="group flex items-start gap-2 px-2 py-2 text-sm" style={{ color: 'var(--color-navy)' }}>
              <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: tone }} />
              <EditableText text={a} onSave={(v: string) => setItems(items.map((x: string, j: number) => (j === i ? v : x)))} className="flex-1 text-sm" />
              <button onClick={() => setItems(items.filter((_: string, j: number) => j !== i))} className="opacity-0 group-hover:opacity-100 text-[var(--color-warm-gray)] hover:text-[var(--danger)]" title="Remove rule"><XIcon className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 px-2 pt-1">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { setItems([...items, draft.trim()]); setDraft(''); } }} placeholder="Add rule…" className="flex-1 text-sm px-2 py-1.5 rounded-md border outline-none" style={{ borderColor: 'var(--color-border)' }} />
            <button onClick={() => { if (draft.trim()) { setItems([...items, draft.trim()]); setDraft(''); } }} className="p-1.5 rounded-md" style={{ color: 'var(--color-steel)' }}><Plus className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 px-1">
        <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--color-navy-mid)' }}>Enforced on every agent action</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="w-3 h-3 cursor-help" style={{ color: 'var(--color-warm-gray)' }} />
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--color-navy)] text-white max-w-[220px]">
            Agents must pass a boundary check on {entityName} before acting. Violations are blocked and logged — no exceptions.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Col title="Allowed" items={allowed} setItems={setAllowed} tone="var(--success)" Icon={Check} />
        <Col title="Not allowed" items={denied} setItems={setDenied} tone="var(--danger)" Icon={CircleSlash} />
      </div>
    </div>
  );
}

const visMeta: Record<Filter, { label: string; icon: LucideIcon }> = {
  all: { label: 'All', icon: Eye }, public: { label: 'Public', icon: Globe2 }, private: { label: 'Private', icon: Lock },
};

export function ItemDetail() {
  const { id } = useParams();
  const initialName = id ? decodeURIComponent(id) : 'Marcus Webb';
  const person = people.find(p => p.name === initialName);
  const community = !person ? companies.find(c => c.name === initialName) : undefined;
  const isCommunity = !!community;

  const [filter, setFilter] = useState<Filter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('about');
  const scrollRef = useRef<HTMLDivElement>(null);

  const name = initialName;
  const bio = isCommunity
    ? `${community!.connections} people you know in this community${community!.sampleRoles?.[0] ? ` - common role: ${community!.sampleRoles[0]}` : ''}.`
    : person ? (person.bio || (person.position && person.company ? `${person.position} at ${person.company}.` : person.newsInsight || `${person.firstName}'s profile.`))
      : 'No profile found.';
  const subtitle = isCommunity ? `${community!.connections} members` : (person?.company || '');
  const location = person?.location || '';

  // Local profile edits — every field editable, persisted to localStorage per entity (no backend write).
  const EDITS_KEY = 'bridge.profileEdits.v1';
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    try { return (JSON.parse(localStorage.getItem(EDITS_KEY) || '{}')[initialName]) || {}; } catch { return {}; }
  });
  const setField = (field: string, value: string) => setEdits(prev => {
    const next = { ...prev, [field]: value };
    try { const all = JSON.parse(localStorage.getItem(EDITS_KEY) || '{}'); all[initialName] = next; localStorage.setItem(EDITS_KEY, JSON.stringify(all)); } catch {}
    return next;
  });
  const fv = (field: string, base: string) => (edits[field] !== undefined ? edits[field] : base);
  const initiatives = useInitiatives();
  const [files, setFiles] = useState<{ name: string; type: string; size: string }[]>([{ name: 'Initiative brief.pdf', type: 'PDF', size: '0.4 MB' }]);
  const addFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    const next = Array.from(list).map(f => ({ name: f.name, type: (f.name.split('.').pop() || 'file').toUpperCase(), size: `${Math.max(1, Math.round(f.size / 1024))} KB` }));
    setFiles(prev => [...next, ...prev]);
  };

  // Sections — tagged public/private; filter shows All / Public / Private. Page is seamless.
  type Sec = { id: string; label: string; tier: Tier; person?: boolean; community?: boolean };
  const allSections: Sec[] = [
    { id: 'about', label: 'About', tier: 'public' },
    { id: 'contact', label: 'Contact', tier: 'public', person: true },
    { id: 'education', label: 'Education & Work History', tier: 'public', person: true },
    { id: 'relationship', label: 'Relationship', tier: 'private', person: true },
    { id: 'opinions', label: 'Opinions', tier: 'public' },
    { id: 'associations', label: 'Associations', tier: 'public' },
    { id: 'initiatives', label: 'Initiatives', tier: 'private' },
    { id: 'automations', label: 'Automations', tier: 'private' },
    { id: 'timeline', label: 'Timeline', tier: 'private' },
    { id: 'files', label: 'Files & Media', tier: 'private' },
    { id: 'boundaries', label: 'Boundaries', tier: 'private' },
  ];
  const sections = allSections.filter(s =>
    (filter === 'all' || s.tier === filter) &&
    (isCommunity ? !s.person : true)
  );

  // scrollspy: highlight the section in view; clicking nav scrolls to it
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (vis) setActive(vis.target.id);
    }, { root, rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.25, 0.5] });
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [filter, isCommunity, initialName]);

  const goTo = (sid: string) => { document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const myThreads = threads.filter(t => t.with === name || t.to === name || t.from === name);

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden relative">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-12 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">{isCommunity ? 'Communities' : 'People'}</Link>
            <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
            <div className="bg-[var(--color-surface)] text-[var(--color-navy)] px-2.5 py-1 rounded text-xs font-semibold shadow-sm">{name}</div>
          </div>

          <div className="flex items-center gap-2">
            {/* All / Public / Private filter */}
            <div className="relative">
              <button onClick={() => { setFilterOpen(o => !o); setMenuOpen(false); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold border rounded-lg shadow-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
                {(() => { const I = visMeta[filter].icon; return <I className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />; })()}
                {visMeta[filter].label}
                <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
              </button>
              <AnimatePresence>{filterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="absolute top-full right-0 mt-1 w-44 border rounded-xl shadow-lg z-50 py-1" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    {(['all', 'public', 'private'] as Filter[]).map(f => { const I = visMeta[f].icon; return (
                      <button key={f} onClick={() => { setFilter(f); setFilterOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm" style={{ backgroundColor: filter === f ? 'var(--color-surface)' : 'transparent', color: filter === f ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                        <I className="w-4 h-4" /> {visMeta[f].label}
                        <span className="ml-auto text-xs" style={{ color: 'var(--color-warm-gray)' }}>{f === 'all' ? 'everything' : f === 'public' ? 'shared facts' : 'only you'}</span>
                      </button>
                    ); })}
                  </motion.div>
                </>
              )}</AnimatePresence>
            </div>

            {/* 3-dots: share public profile + download */}
            <div className="relative">
              <button onClick={() => { setMenuOpen(o => !o); setFilterOpen(false); }} className="p-2 rounded-lg border shadow-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}><MoreHorizontal className="w-4 h-4" /></button>
              <AnimatePresence>{menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="absolute top-full right-0 mt-1 w-52 border rounded-xl shadow-lg z-50 py-1" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                    <button onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}><Share2 className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Share public profile</button>
                    <button onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}><Download className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Download</button>
                  </motion.div>
                </>
              )}</AnimatePresence>
            </div>
          </div>
        </div>

        {/* Scrollspy nav (click → scroll to section) */}
        <div className="flex items-center gap-1 px-4 overflow-x-auto scrollbar-hide">
          {sections.map(s => (
            <button key={s.id} onClick={() => goTo(s.id)} className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors" style={{ color: active === s.id ? 'var(--color-navy)' : 'var(--color-navy-mid)', borderColor: active === s.id ? 'var(--color-steel)' : 'transparent' }}>
              {s.label}
              {s.tier === 'private' && <Lock className="w-3 h-3" style={{ color: 'var(--color-warm-gray)' }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Body — one continuous scroll */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-white scroll-smooth">
        <div className="max-w-5xl mx-auto w-full px-8 py-10 pb-40 flex flex-col gap-14">
          {/* Identity */}
          <div className="flex gap-6 items-start">
            <div className="w-20 h-20 rounded-full bg-[var(--color-surface)] shadow-inner flex items-center justify-center border border-[var(--color-border)]">
              {isCommunity ? <Building2 className="w-8 h-8" style={{ color: 'var(--color-warm-gray)' }} /> : <span className="text-3xl font-semibold text-[var(--color-warm-gray)]">{name.charAt(0)}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <EditableText as="h1" text={fv('name', name)} base={name} onSave={(v: string) => setField('name', v)} className="text-4xl font-bold text-[var(--color-navy)] mb-2 tracking-tight break-words" />
              <div className="flex gap-4 text-sm text-[var(--color-navy-mid)] font-medium flex-wrap">
                <span className="flex items-center gap-1.5">{isCommunity ? <Users className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}<EditableText text={fv('subtitle', subtitle || '—')} base={subtitle || '—'} onSave={(v: string) => setField('subtitle', v)} className="text-sm" /></span>
                {!isCommunity && (() => {
                  const rawLoc = fv('location', location || '—') as string;
                  const isApprox = rawLoc.startsWith('~');
                  const displayLoc = isApprox ? rawLoc.slice(1) : rawLoc;
                  return (
                    <span className="flex items-center gap-1.5" title={isApprox ? 'Approximate — based on company HQ' : undefined}>
                      <MapPin className="w-4 h-4" />
                      <EditableText text={displayLoc} onSave={(v: string) => setField('location', v)} className="text-sm" />
                      {isApprox && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warm-gray) 12%, transparent)', color: 'var(--color-warm-gray)' }}>approx</span>}
                    </span>
                  );
                })()}
              </div>
              <div className="mt-3"><TagEditor seed={isCommunity ? ['Sector', 'Region'] : ['Investor', 'Operator', 'Mentor']} /></div>
            </div>
          </div>

          {sections.map(s => (
            <section key={s.id} id={s.id} className="scroll-mt-4">
              <h2 className={heading}>{s.label}</h2>
              {s.id === 'about' && (
                <div className="flex flex-col gap-5">
                  <EditableText multiline text={fv('bio', bio)} base={bio} onSave={(v: string) => setField('bio', v)} className="text-[var(--color-navy-mid)] text-lg leading-relaxed max-w-3xl" />
                  {person?.skills && person.skills.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-warm-gray)' }}>Skills</div>
                      <div className="flex flex-wrap gap-2">
                        {person.skills.map(s => (
                          <span key={s} className="px-3 py-1 rounded-full text-sm font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, transparent)', color: 'var(--color-steel)' }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {s.id === 'contact' && <ContactCard person={person} fv={fv} setField={setField} />}
              {s.id === 'education' && (
                <div className="flex flex-col gap-6">
                  {person?.education && person.education.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-warm-gray)' }}>Education</div>
                      <div className="flex flex-col gap-2">
                        {person.education.map((e, i) => (
                          <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-white" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: 'var(--color-surface)' }}><Building2 className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></div>
                            <div>
                              <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{e.institution}</div>
                              {(e.degree || e.field) && <div className="text-xs mt-0.5" style={{ color: 'var(--color-navy-mid)' }}>{[e.degree, e.field].filter(Boolean).join(' · ')}</div>}
                              {e.year && <div className="text-xs mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{e.year}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {person?.previousCompanies && person.previousCompanies.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-warm-gray)' }}>Work History</div>
                      <div className="flex flex-col gap-2">
                        {person.previousCompanies.map((c, i) => (
                          <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-white" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: 'var(--color-surface)' }}><Building2 className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /></div>
                            <div>
                              <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{c.name}</div>
                              {c.title && <div className="text-xs mt-0.5" style={{ color: 'var(--color-navy-mid)' }}>{c.title}</div>}
                              {c.period && <div className="text-xs mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{c.period}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!person?.education?.length && !person?.previousCompanies?.length && (
                    <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>No education or work history captured yet — run an enrichment to populate this section.</p>
                  )}
                </div>
              )}
              {s.id === 'relationship' && (
                <div className="grid sm:grid-cols-3 gap-3">
                  {([['Warmth', 'warmth', warmthLabel(person?.warmth)], ['Orbit', 'orbit', `${person?.ring || 'Active'} ring`], ['Last touchpoint', 'lastTouch', person?.connectedOn || '—']] as [string, string, string][]).map(([k, key, v]) => (
                    <div key={k} className="rounded-xl border px-4 py-3 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-warm-gray)' }}>{k}</div>
                      <EditableText text={fv(key, v)} base={v} onSave={(val: string) => setField(key, val)} className="text-sm font-semibold" />
                    </div>
                  ))}
                  <div className="sm:col-span-3 rounded-xl border px-4 py-3 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-warm-gray)' }}>Private note</div>
                    <EditableText multiline text={fv('privateNote', 'Add a private note — only you can see this.')} onSave={(val: string) => setField('privateNote', val)} className="text-sm text-[var(--color-navy-mid)]" />
                  </div>
                  {/* F4b — per-relationship visibility (schema: people.visibility; default from workspace_settings.default_visibility). Moved here from the orphaned PersonTiers.tsx when ItemDetail's inline two-tier view superseded it. */}
                  <div className="sm:col-span-3 rounded-xl border px-4 py-3 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Eye className="w-3.5 h-3.5" style={{ color: 'var(--color-navy-mid)' }} />
                      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-navy-mid)' }}>Who can see this relationship</span>
                    </div>
                    <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                      {([
                        ['private', Lock, 'Only you', 'No one else can see this relationship or its notes.'],
                        ['team', Users, 'Your team', 'Everyone on your team can see this relationship.'],
                        ['workspace', Globe, 'Whole organization', 'Everyone in the organization can see this relationship.'],
                      ] as [string, LucideIcon, string, string][]).map(([v, VIcon, vLabel]) => {
                        const active = fv('visibility', 'team') === v;
                        return (
                          <button
                            key={v}
                            onClick={() => setField('visibility', v)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors"
                            style={{ backgroundColor: active ? 'white' : 'transparent', color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
                          >
                            <VIcon className="w-3.5 h-3.5" /> {vLabel}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-navy-mid)' }}>
                        {{ private: 'No one else can see this relationship or its notes.', team: 'Everyone on your team can see this relationship.', workspace: 'Everyone in the organization can see this relationship.' }[fv('visibility', 'team')]}
                      </span>
                      {fv('visibility', 'team') === 'team' && (
                        <span className="text-[11px] font-medium shrink-0 ml-2" style={{ color: 'var(--color-warm-gray)' }}>organization default</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {s.id === 'opinions' && <Opinions />}
              {s.id === 'associations' && <AssociationsMap center={name} isCommunity={isCommunity} />}
              {s.id === 'initiatives' && (
                initiatives.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>No initiatives yet — create one from Work.</p>
                ) : (
                  <MiniTable
                    columns={['Initiative', 'Goal', 'Status']}
                    rows={initiatives.map(it => [it.name, it.goal || '—', <StatusTag label={it.status} tone={it.status === 'Active' ? 'var(--success)' : it.status === 'Completed' ? 'var(--color-steel)' : 'var(--warning)'} />])}
                  />
                )
              )}
              {s.id === 'automations' && (
                <MiniTable
                  columns={['Automation', 'Trigger', 'Last run', 'Status']}
                  rows={[
                    ['Monthly check-in', 'First Monday each month', '12 days ago', <StatusTag label="On" tone="var(--success)" />],
                    ['Dormant reconnect', 'Trust high · warmth cooling', 'On signal', <StatusTag label="Paused" tone="var(--warning)" />],
                  ]}
                />
              )}
              {s.id === 'timeline' && (
                <div className="flex flex-col gap-3">
                  {person?.connectedOn && (
                    <div className="flex items-center gap-4 px-4 py-3 rounded-xl border bg-white shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--info) 12%, transparent)' }}><Linkedin className="w-4 h-4" style={{ color: 'var(--info)' }} /></div>
                      <div className="flex-1"><div className="font-semibold text-sm" style={{ color: 'var(--color-navy)' }}>Connected on LinkedIn</div></div>
                      <div className="text-xs font-medium" style={{ color: 'var(--color-warm-gray)' }}>{person.connectedOn}</div>
                    </div>
                  )}
                  {myThreads.length > 0 ? myThreads.map(th => (
                    <div key={th.id} className="rounded-xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: th.direction === 'OUTGOING' ? 'color-mix(in srgb, var(--color-steel) 14%, transparent)' : 'color-mix(in srgb, var(--color-sage) 18%, transparent)', color: th.direction === 'OUTGOING' ? 'var(--color-steel)' : 'var(--color-sage)' }}>{th.direction === 'OUTGOING' ? 'You → them' : 'Them → you'}</span>
                        <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{th.sentAt}</span>
                      </div>
                      <p className="px-4 py-3 text-sm leading-relaxed" style={{ color: 'var(--color-navy)' }}>{th.message}</p>
                    </div>
                  )) : !person?.connectedOn && <div className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>No touchpoints yet.</div>}
                </div>
              )}
              {s.id === 'files' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {files.map((f, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-4 p-4 rounded-xl border bg-white cursor-pointer shadow-sm hover:border-[var(--color-steel)] hover:shadow-md transition-all" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-surface)' }}>{/xls/i.test(f.type) ? <FileSpreadsheet className="w-6 h-6" style={{ color: 'var(--color-steel)' }} /> : <FileText className="w-6 h-6" style={{ color: 'var(--color-steel)' }} />}</div>
                      <div className="flex flex-col overflow-hidden w-full"><span className="font-semibold text-[var(--color-navy)] text-sm truncate">{f.name}</span><div className="flex items-center gap-2 mt-1 text-xs font-medium text-[var(--color-navy-mid)]"><span className="uppercase">{f.type}</span><span className="w-1 h-1 rounded-full bg-[var(--color-border)]" /><span>{f.size}</span></div></div>
                    </motion.div>
                  ))}
                  <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] hover:border-[var(--color-steel)]/50 cursor-pointer min-h-[100px] transition-colors" title="Upload a file (stored locally in this prototype)">
                    <Plus className="w-6 h-6 mb-2" /><span className="text-sm font-medium">Upload File</span>
                    <input type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.currentTarget.value = ''; }} />
                  </label>
                </div>
              )}
              {s.id === 'boundaries' && <Boundaries entityName={name} />}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function warmthLabel(n?: number) {
  const w = n ?? 64;
  return w >= 80 ? 'Hot' : w >= 62 ? 'Warm' : w >= 50 ? 'Cooling' : 'Dormant';
}
