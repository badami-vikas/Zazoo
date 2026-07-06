// Calendar — a native, pinnable Tool that renders the user's Google Calendar and lets
// them create / modify / delete events that round-trip to Google through the governed
// pipeline (propose → approve → egress). The calendar is a time-axis PROJECTION over the
// graph; for now its single source is Google Calendar (conference / rituals / initiatives
// are future adapters that emit the same CalendarEvent shape — the surface won't change).
//
// Rendering is a fully in-house view built on date-fns + the Bridge design tokens (free,
// modifiable, design-system-native) behind a small view boundary — react-big-calendar
// remains a documented swap-in if ever needed.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router';
import {
  ChevronRight, ChevronLeft, Plus, Pin, PinOff, Calendar as CalendarIcon, Clock, MapPin,
  Users, Trash2, Pencil, X, RefreshCw, Cable, ShieldCheck,
} from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, addMonths, addWeeks,
  addDays, format, isSameDay, isSameMonth, isToday, parseISO, startOfDay, differenceInMinutes,
} from 'date-fns';
import { usePinnedTools } from '../Layout';
import { toolById } from '../data/tools';
import {
  API_ENABLED, apiListCalendarEvents, apiProposeCalendarWrite, apiApproveProposal,
  type CalendarEventDTO, type CalendarWriteAction,
} from '../data/api';

type View = 'month' | 'week' | 'day' | 'agenda';

// ── Demo seed (API off) — all dummy_-prefixed so it's greppable, never mistaken for real ──
function dummySeed(): CalendarEventDTO[] {
  const base = startOfDay(new Date());
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = addDays(base, dayOffset); d.setHours(h, m, 0, 0); return d.toISOString();
  };
  return [
    { eventId: 'dummy_evt_standup', summary: 'dummy_ Daily Standup', start: at(0, 9), end: at(0, 9, 30),
      organizer: { email: 'dummy_self@example.com' }, attendees: [{ email: 'dummy_team@example.com' }], location: 'dummy_ Meet' },
    { eventId: 'dummy_evt_lunch', summary: 'dummy_ Lunch with Alex', start: at(0, 12, 30), end: at(0, 13, 30),
      organizer: { email: 'dummy_self@example.com' }, attendees: [{ email: 'dummy_alex@example.com' }], location: 'dummy_ Cafe' },
    { eventId: 'dummy_evt_review', summary: 'dummy_ Portfolio Review', start: at(1, 15), end: at(1, 16),
      organizer: { email: 'dummy_self@example.com' }, attendees: [], description: 'dummy_ quarterly check' },
    { eventId: 'dummy_evt_call', summary: 'dummy_ Intro call — Founder', start: at(2, 11), end: at(2, 11, 45),
      organizer: { email: 'dummy_self@example.com' }, attendees: [{ email: 'dummy_founder@example.com' }] },
    { eventId: 'dummy_evt_dinner', summary: 'dummy_ Dinner — LP', start: at(4, 19), end: at(4, 21),
      organizer: { email: 'dummy_self@example.com' }, attendees: [{ email: 'dummy_lp@example.com' }], location: 'dummy_ Bistro' },
  ];
}

// ── Event time helpers ─────────────────────────────────────────────────────────
const isAllDay = (e: CalendarEventDTO) => !e.start.includes('T');
const evStart = (e: CalendarEventDTO) => parseISO(e.start);
const evEnd = (e: CalendarEventDTO) => (e.end ? parseISO(e.end) : parseISO(e.start));
const STEEL = 'var(--color-steel)';

// datetime-local <-> ISO
const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
const fromLocalInput = (s: string) => new Date(s).toISOString();

interface FormState {
  eventId?: string; // present => edit
  summary: string;
  start: string;    // datetime-local
  end: string;      // datetime-local
  location: string;
  description: string;
  attendees: string; // comma-separated emails
}

export function CalendarPage() {
  const { isPinned, togglePin } = usePinnedTools();
  const tool = toolById('calendar');
  const pinned = tool ? isPinned(tool.id) : false;

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEventDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'demo'>(API_ENABLED ? 'live' : 'demo');
  const [selected, setSelected] = useState<CalendarEventDTO | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The visible period — drives timeMin/timeMax so navigating to a past/future period
  // loads exactly its events instead of relying on the 250-result cap to cover them
  // (Google's events.list defaults timeMin to now and has no upper bound otherwise).
  const rangeStart = useMemo(() => {
    if (view === 'month') return startOfWeek(startOfMonth(cursor));
    if (view === 'week') return startOfWeek(cursor);
    if (view === 'day') return startOfDay(cursor);
    return startOfDay(new Date()); // agenda = upcoming
  }, [view, cursor]);

  const rangeEnd = useMemo(() => {
    if (view === 'month') return endOfWeek(endOfMonth(cursor));
    if (view === 'week') return endOfWeek(cursor);
    if (view === 'day') return addDays(startOfDay(cursor), 1);
    return addDays(startOfDay(new Date()), 90); // agenda = upcoming 90 days
  }, [view, cursor]);

  const reload = useCallback(async (timeMin?: string, timeMax?: string) => {
    if (!API_ENABLED) { setEvents(dummySeed()); setMode('demo'); return; }
    setLoading(true); setError(null);
    try {
      const evs = await apiListCalendarEvents({
        maxResults: 250,
        ...(timeMin ? { timeMin } : {}),
        ...(timeMax ? { timeMax } : {}),
      });
      setEvents(evs ?? []); setMode('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Google Calendar');
      setEvents([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(rangeStart.toISOString(), rangeEnd.toISOString()); }, [reload, rangeStart, rangeEnd]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Governed write: propose → approve (the Save click IS the human approval) → refresh.
  async function commitWrite(action: CalendarWriteAction, envelope: Record<string, unknown>, label: string) {
    setBusy(true); setError(null);
    try {
      if (API_ENABLED) {
        const p = await apiProposeCalendarWrite(action, envelope);
        if (!p?.id) throw new Error('proposal not created');
        const res = await apiApproveProposal(p.id);
        await reload(rangeStart.toISOString(), rangeEnd.toISOString());
        setToast(`${label} · ${res?.sent ? 'synced to Google' : 'queued'} · audited in Approvals`);
      } else {
        // Demo mode: mutate local dummy_ state so the UI is fully demoable with no backend.
        setEvents(prev => {
          if (action === 'delete') return prev.filter(e => e.eventId !== envelope.eventId);
          if (action === 'update') return prev.map(e => e.eventId === envelope.eventId ? { ...e, ...(envelope as Partial<CalendarEventDTO>) } : e);
          const ne = { ...(envelope as unknown as CalendarEventDTO), eventId: `dummy_evt_${Date.now()}`, organizer: { email: 'dummy_self@example.com' }, attendees: [] };
          return [...prev, ne];
        });
        setToast(`${label} · demo only — connect Google in Integrations to sync`);
      }
      setForm(null); setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Write failed');
    } finally { setBusy(false); }
  }

  function openCreate(day?: Date) {
    const start = day ? (() => { const d = new Date(day); d.setHours(9, 0, 0, 0); return d; })() : (() => { const d = new Date(); d.setMinutes(0, 0, 0); return addDays(d, 0); })();
    const end = new Date(start); end.setHours(start.getHours() + 1);
    setForm({ summary: '', start: toLocalInput(start), end: toLocalInput(end), location: '', description: '', attendees: '' });
  }
  function openEdit(e: CalendarEventDTO) {
    setForm({
      eventId: e.eventId, summary: e.summary,
      start: toLocalInput(evStart(e)), end: toLocalInput(evEnd(e)),
      location: e.location ?? '', description: e.description ?? '',
      attendees: e.attendees.map(a => a.email).join(', '),
    });
    setSelected(null);
  }

  function submitForm() {
    if (!form) return;
    const attendees = form.attendees.split(',').map(s => s.trim()).filter(Boolean);
    const base = {
      summary: form.summary.trim() || '(no title)',
      start: fromLocalInput(form.start),
      end: fromLocalInput(form.end),
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(attendees.length ? { attendees } : {}),
    };
    if (form.eventId) {
      void commitWrite('update', { eventId: form.eventId, ...base }, `Updated “${base.summary}”`);
    } else {
      void commitWrite('create', base, `Created “${base.summary}”`);
    }
  }

  function deleteEvent(e: CalendarEventDTO) {
    void commitWrite('delete', { eventId: e.eventId, summary: e.summary }, `Deleted “${e.summary}”`);
  }

  // ── Period navigation ──────────────────────────────────────────────────────
  const go = (dir: -1 | 1) => setCursor(c => view === 'month' ? addMonths(c, dir) : view === 'week' ? addWeeks(c, dir) : addDays(c, dir));
  const title = useMemo(() => {
    if (view === 'month') return format(cursor, 'MMMM yyyy');
    if (view === 'agenda') return 'Upcoming';
    if (view === 'week') {
      const s = startOfWeek(cursor); const e = endOfWeek(cursor);
      return `${format(s, 'MMM d')} – ${format(e, isSameMonth(s, e) ? 'd, yyyy' : 'MMM d, yyyy')}`;
    }
    return format(cursor, 'EEEE, MMMM d, yyyy');
  }, [view, cursor]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Header — tool path + Pin (mirrors every tool) */}
      <div className="h-11 flex items-center justify-between px-6 border-b shrink-0 bg-white z-20 gap-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Link to="/tools" className="shrink-0 transition-colors" style={{ color: 'var(--color-navy-mid)' }}>Tools</Link>
          <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
          <span className="px-2.5 py-0.5 rounded text-xs font-semibold truncate" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)' }}>Calendar</span>
        </div>
        {tool && (
          <button onClick={() => togglePin(tool.id)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all active:scale-95 shrink-0"
            style={pinned
              ? { backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--color-steel) 25%, transparent)', color: STEEL }
              : { backgroundColor: 'white', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {pinned ? 'Pinned' : 'Pin to sidebar'}
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0 bg-white gap-3 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date())} className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all active:scale-95"
            style={{ backgroundColor: 'white', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>Today</button>
          <div className="flex items-center">
            <button onClick={() => go(-1)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors" aria-label="Previous"><ChevronLeft className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
            <button onClick={() => go(1)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors" aria-label="Next"><ChevronRight className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
          </div>
          <h1 className="text-base font-semibold ml-1" style={{ color: 'var(--color-navy)' }}>{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ModePill mode={mode} loading={loading} onRefresh={() => void reload(rangeStart.toISOString(), rangeEnd.toISOString())} />
          <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {(['month', 'week', 'day', 'agenda'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} className="text-xs font-semibold px-3 py-1.5 capitalize transition-colors"
                style={view === v ? { backgroundColor: STEEL, color: 'white' } : { backgroundColor: 'white', color: 'var(--color-navy-mid)' }}>{v}</button>
            ))}
          </div>
          <button onClick={() => openCreate(view === 'day' ? cursor : undefined)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
            style={{ backgroundColor: STEEL, color: 'white' }}><Plus className="w-3.5 h-3.5" /> New event</button>
        </div>
      </div>

      {/* Governance note */}
      <div className="px-6 py-1.5 text-[11px] flex items-center gap-1.5 border-b shrink-0" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)', backgroundColor: 'var(--color-background)' }}>
        <ShieldCheck className="w-3 h-3" /> Every create / edit / delete is drafted, approved, and synced to Google through the governed pipeline — append-only audited in Approvals.
      </div>

      {error && (
        <div className="px-6 py-2 text-xs flex items-center gap-2 border-b shrink-0" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)', color: 'var(--danger)' }}>
          <Cable className="w-3.5 h-3.5" /> {error} — connect Google in <Link to="/integration/google" className="underline font-semibold">Integrations</Link>.
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {view === 'month' && <MonthView cursor={cursor} events={events} onDay={openCreate} onEvent={setSelected} />}
        {(view === 'week' || view === 'day') && <TimeGridView days={view === 'day' ? [cursor] : eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) })} events={events} onEvent={setSelected} onSlot={openCreate} />}
        {view === 'agenda' && <AgendaView events={events} onEvent={setSelected} />}
      </div>

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-xs font-medium flex items-center gap-2 z-50" style={{ backgroundColor: 'var(--color-navy)', color: 'white' }}>
          <ShieldCheck className="w-3.5 h-3.5" /> {toast}
        </div>
      )}

      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} onEdit={() => openEdit(selected)} onDelete={() => deleteEvent(selected)} busy={busy} />}
      {form && <EventForm form={form} setForm={setForm} onSubmit={submitForm} onClose={() => setForm(null)} busy={busy} mode={mode} />}
    </div>
  );
}

// ── Mode pill ────────────────────────────────────────────────────────────────
function ModePill({ mode, loading, onRefresh }: { mode: 'live' | 'demo'; loading: boolean; onRefresh: () => void }) {
  return (
    <button onClick={onRefresh} title="Refresh from Google" className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all active:scale-95"
      style={{ backgroundColor: 'white', borderColor: 'var(--color-border)', color: mode === 'live' ? 'var(--success)' : 'var(--color-warm-gray)' }}>
      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
      {mode === 'live' ? 'Live · Google' : 'Demo'}
    </button>
  );
}

// ── Month view ───────────────────────────────────────────────────────────────
function MonthView({ cursor, events, onDay, onEvent }: { cursor: Date; events: CalendarEventDTO[]; onDay: (d: Date) => void; onEvent: (e: CalendarEventDTO) => void }) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) });
  const byDay = (d: Date) => events.filter(e => isSameDay(evStart(e), d)).sort((a, b) => evStart(a).getTime() - evStart(b).getTime());
  return (
    <div className="min-h-full flex flex-col">
      <div className="grid grid-cols-7 border-b sticky top-0 bg-white z-10" style={{ borderColor: 'var(--color-border)' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: 'minmax(7rem, 1fr)' }}>
        {days.map((d, i) => {
          const dayEvents = byDay(d);
          const out = !isSameMonth(d, cursor);
          return (
            <div key={i} onClick={() => onDay(d)} className="border-b border-r p-1.5 cursor-pointer transition-colors hover:bg-[var(--color-surface)] group"
              style={{ borderColor: 'var(--color-border)', backgroundColor: out ? 'var(--color-background)' : 'white' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full"
                  style={isToday(d) ? { backgroundColor: STEEL, color: 'white' } : { color: out ? 'var(--color-warm-gray)' : 'var(--color-navy)' }}>{format(d, 'd')}</span>
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-warm-gray)' }} />
              </div>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map(e => (
                  <button key={e.eventId} onClick={(ev) => { ev.stopPropagation(); onEvent(e); }}
                    className="text-left text-[11px] px-1.5 py-0.5 rounded truncate transition-all hover:brightness-95"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-navy)' }}>
                    {!isAllDay(e) && <span className="font-semibold mr-1" style={{ color: STEEL }}>{format(evStart(e), 'HH:mm')}</span>}
                    {e.summary}
                  </button>
                ))}
                {dayEvents.length > 3 && <span className="text-[10px] px-1.5" style={{ color: 'var(--color-warm-gray)' }}>+{dayEvents.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week / Day time grid ─────────────────────────────────────────────────────
const HOUR_PX = 44;
function TimeGridView({ days, events, onEvent, onSlot }: { days: Date[]; events: CalendarEventDTO[]; onEvent: (e: CalendarEventDTO) => void; onSlot: (d: Date) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const timed = (d: Date) => events.filter(e => isSameDay(evStart(e), d) && !isAllDay(e));
  const allday = (d: Date) => events.filter(e => isSameDay(evStart(e), d) && isAllDay(e));
  return (
    <div className="min-h-full">
      {/* day headers */}
      <div className="grid sticky top-0 bg-white z-10 border-b" style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)`, borderColor: 'var(--color-border)' }}>
        <div />
        {days.map((d, i) => (
          <div key={i} className="px-2 py-2 text-center border-l" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{format(d, 'EEE')}</div>
            <div className="text-sm font-semibold w-7 h-7 mx-auto flex items-center justify-center rounded-full" style={isToday(d) ? { backgroundColor: STEEL, color: 'white' } : { color: 'var(--color-navy)' }}>{format(d, 'd')}</div>
            <div className="flex flex-col gap-0.5 mt-1">
              {allday(d).map(e => (
                <button key={e.eventId} onClick={() => onEvent(e)} className="text-[10px] px-1 py-0.5 rounded truncate" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 16%, transparent)', color: 'var(--color-navy)' }}>{e.summary}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* grid */}
      <div className="grid" style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}>
        {/* hour gutter — labels absolutely positioned ON each gridline (no flow drift) */}
        <div className="relative" style={{ height: 24 * HOUR_PX }}>
          {hours.map(h => h === 0 ? null : (
            <span key={h} className="absolute right-2 text-[10px]" style={{ top: h * HOUR_PX - 6, color: 'var(--color-warm-gray)' }}>
              {format(new Date(2000, 0, 1, h), 'HH:mm')}
            </span>
          ))}
        </div>
        {days.map((d, di) => {
          const lanes = packLanes(timed(d));
          return (
            <div key={di} className="relative border-l" style={{ borderColor: 'var(--color-border)' }}>
              {hours.map(h => (
                <div key={h} onClick={() => { const nd = new Date(d); nd.setHours(h, 0, 0, 0); onSlot(nd); }}
                  style={{ height: HOUR_PX }} className="border-b cursor-pointer hover:bg-[var(--color-surface)]/60 transition-colors" />
              ))}
              {lanes.map(({ e, col, cols }) => {
                const s = evStart(e); const en = evEnd(e);
                const top = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR_PX;
                const height = Math.max(differenceInMinutes(en, s) / 60 * HOUR_PX, 18);
                const width = 100 / cols;
                return (
                  <button key={e.eventId} onClick={() => onEvent(e)} title={e.summary}
                    className="absolute rounded px-1.5 py-0.5 text-left text-[11px] overflow-hidden border transition-all hover:brightness-95 hover:z-10"
                    style={{ top, height, left: `calc(${col * width}% + 2px)`, width: `calc(${width}% - 4px)`,
                      backgroundColor: 'color-mix(in srgb, var(--color-steel) 16%, white)', borderColor: 'color-mix(in srgb, var(--color-steel) 35%, transparent)', color: 'var(--color-navy)' }}>
                    <span className="font-semibold block truncate">{e.summary}</span>
                    <span className="block truncate" style={{ color: 'var(--color-navy-mid)' }}>{format(s, 'HH:mm')}–{format(en, 'HH:mm')}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Greedy lane packing for overlapping events within one day column.
function packLanes(dayEvents: CalendarEventDTO[]): { e: CalendarEventDTO; col: number; cols: number }[] {
  const sorted = [...dayEvents].sort((a, b) => evStart(a).getTime() - evStart(b).getTime());
  const result: { e: CalendarEventDTO; col: number; cols: number }[] = [];
  let cluster: CalendarEventDTO[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const colEnds: number[] = [];
    const placed = cluster.map(e => {
      const s = evStart(e).getTime(); const en = evEnd(e).getTime();
      let col = colEnds.findIndex(end => end <= s);
      if (col === -1) { col = colEnds.length; colEnds.push(en); } else { colEnds[col] = en; }
      return { e, col };
    });
    const cols = colEnds.length || 1;
    placed.forEach(p => result.push({ ...p, cols }));
    cluster = [];
  };
  for (const e of sorted) {
    const s = evStart(e).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, evEnd(e).getTime());
  }
  if (cluster.length) flush();
  return result;
}

// ── Agenda view ──────────────────────────────────────────────────────────────
function AgendaView({ events, onEvent }: { events: CalendarEventDTO[]; onEvent: (e: CalendarEventDTO) => void }) {
  const upcoming = [...events].sort((a, b) => evStart(a).getTime() - evStart(b).getTime());
  const groups = useMemo(() => {
    const m = new Map<string, CalendarEventDTO[]>();
    for (const e of upcoming) {
      const k = format(startOfDay(evStart(e)), 'yyyy-MM-dd');
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return [...m.entries()];
  }, [upcoming]);
  if (!groups.length) return <Empty />;
  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
      {groups.map(([k, evs]) => {
        const d = parseISO(k);
        return (
          <div key={k}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold" style={{ color: isToday(d) ? STEEL : 'var(--color-navy)' }}>{format(d, 'EEEE, MMMM d')}</span>
              {isToday(d) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: STEEL, color: 'white' }}>Today</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              {evs.map(e => (
                <button key={e.eventId} onClick={() => onEvent(e)} className="flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:shadow-sm bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: STEEL }} />
                  <div className="text-xs font-mono w-24 shrink-0" style={{ color: 'var(--color-navy-mid)' }}>{isAllDay(e) ? 'All day' : `${format(evStart(e), 'HH:mm')}–${format(evEnd(e), 'HH:mm')}`}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-navy)' }}>{e.summary}</div>
                    {e.location && <div className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--color-warm-gray)' }}><MapPin className="w-3 h-3" /> {e.location}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-6" style={{ color: 'var(--color-warm-gray)' }}>
      <CalendarIcon className="w-10 h-10 mb-3" />
      <p className="text-sm font-medium" style={{ color: 'var(--color-navy-mid)' }}>No events</p>
      <p className="text-xs mt-1">Create one, or sync your Google Calendar.</p>
    </div>
  );
}

// ── Event detail drawer ──────────────────────────────────────────────────────
function EventDetail({ event, onClose, onEdit, onDelete, busy }: { event: CalendarEventDTO; onClose: () => void; onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <>
      <div className="absolute inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="absolute top-0 right-0 h-full w-full max-w-sm bg-white z-50 shadow-xl flex flex-col border-l" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 h-12 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Event</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface)]"><X className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-navy)' }}>{event.summary}</h2>
          <Row icon={Clock} text={isAllDay(event) ? `${format(evStart(event), 'EEE, MMM d')} · All day` : `${format(evStart(event), 'EEE, MMM d · HH:mm')} – ${format(evEnd(event), 'HH:mm')}`} />
          {event.location && <Row icon={MapPin} text={event.location} />}
          {event.attendees.length > 0 && <Row icon={Users} text={event.attendees.map(a => a.name || a.email).join(', ')} />}
          {event.description && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-navy-mid)' }}>{event.description}</p>}
        </div>
        <div className="flex items-center gap-2 p-4 border-t shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onEdit} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-50" style={{ backgroundColor: STEEL, color: 'white' }}><Pencil className="w-3.5 h-3.5" /> Edit</button>
          <button onClick={onDelete} disabled={busy} className="flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-all active:scale-95 disabled:opacity-50" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)', color: 'var(--danger)', backgroundColor: 'white' }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </div>
      </div>
    </>
  );
}
function Row({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}><Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} /><span>{text}</span></div>;
}

// ── Create / edit form ───────────────────────────────────────────────────────
function EventForm({ form, setForm, onSubmit, onClose, busy, mode }: { form: FormState; setForm: (f: FormState) => void; onSubmit: () => void; onClose: () => void; busy: boolean; mode: 'live' | 'demo' }) {
  const set = (k: keyof FormState, v: string) => setForm({ ...form, [k]: v });
  const editing = Boolean(form.eventId);
  return (
    <>
      <div className="absolute inset-0 bg-black/30 z-40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90%]" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 h-12 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{editing ? 'Edit event' : 'New event'}</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface)]"><X className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
          </div>
          <div className="flex-1 overflow-auto p-5 flex flex-col gap-3">
            <Field label="Title"><input autoFocus value={form.summary} onChange={e => set('summary', e.target.value)} placeholder="Event title" className="w-full" style={inp} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts"><input type="datetime-local" value={form.start} onChange={e => set('start', e.target.value)} className="w-full" style={inp} /></Field>
              <Field label="Ends"><input type="datetime-local" value={form.end} onChange={e => set('end', e.target.value)} className="w-full" style={inp} /></Field>
            </div>
            <Field label="Location"><input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Add location" className="w-full" style={inp} /></Field>
            <Field label="Guests (comma-separated emails)"><input value={form.attendees} onChange={e => set('attendees', e.target.value)} placeholder="a@x.com, b@y.com" className="w-full" style={inp} /></Field>
            <Field label="Description"><textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="Notes" className="w-full resize-none" style={inp} /></Field>
          </div>
          <div className="flex items-center justify-between gap-2 p-4 border-t shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-warm-gray)' }}><ShieldCheck className="w-3 h-3" /> {mode === 'live' ? 'Drafts → approves → syncs to Google' : 'Demo — not synced'}</span>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>Cancel</button>
              <button onClick={onSubmit} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5" style={{ backgroundColor: STEEL, color: 'white' }}>
                {busy && <RefreshCw className="w-3 h-3 animate-spin" />}{editing ? 'Save changes' : 'Create event'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
const inp: React.CSSProperties = { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--color-navy)', outline: 'none' };
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{label}</span>{children}</label>;
}
