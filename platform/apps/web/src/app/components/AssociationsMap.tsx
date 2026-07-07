import { useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Network as NetworkIcon, Table as TableIcon, Users, Target, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { buildAssociations, type AssocPerson } from '../data/associations';

const KIND: Record<string, string> = {
  self: 'var(--color-steel)',
  person: 'var(--color-navy-mid)',
  community: 'var(--color-sage)',
  initiative: 'var(--warning)',
};

const C = { x: 500, y: 320 };
const trunc = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface GNode { id: string; kind: 'self' | 'person' | 'community' | 'initiative'; label: string; rel: string; nav?: string; x: number; y: number; degree: number }

function ring<T extends { }>(items: T[], radius: number, startDeg: number): (T & { x: number; y: number })[] {
  const n = Math.max(1, items.length);
  return items.map((it, i) => {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    return { ...it, x: C.x + radius * Math.cos(a), y: C.y + radius * Math.sin(a) };
  });
}

export function AssociationsMap({ center, isCommunity = false }: { center: string; isCommunity?: boolean }) {
  const navigate = useNavigate();
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const res = useMemo(() => buildAssociations(center, isCommunity), [center, isCommunity]);

  // ── graph node + edge model (deterministic radial layout) ──────────────────────────────────────
  const { nodes, edges } = useMemo(() => {
    const homeHubs: GNode[] = res.communities.home.map(name => ({ id: 'cm_' + name, kind: 'community', label: name, rel: 'Your community', nav: name, x: 0, y: 0, degree: 1 }));
    const relHubs: GNode[] = res.communities.related.slice(0, 3).map(name => ({ id: 'cr_' + name, kind: 'community', label: name, rel: 'Role-adjacent community', nav: name, x: 0, y: 0, degree: 2 }));
    const onePeople: GNode[] = res.degrees.one.slice(0, 9).map(p => ({ id: p.id, kind: 'person', label: p.name, rel: p.rel, nav: p.name, x: 0, y: 0, degree: 1 }));
    const twoPeople: GNode[] = res.degrees.two.slice(0, 9).map(p => ({ id: p.id, kind: 'person', label: p.name, rel: p.rel, nav: p.name, x: 0, y: 0, degree: 2 }));
    const threePeople: GNode[] = res.degrees.three.slice(0, 7).map(p => ({ id: p.id, kind: 'person', label: p.name, rel: p.rel, nav: p.name, x: 0, y: 0, degree: 3 }));
    const inis: GNode[] = res.initiatives.slice(0, 2).map(it => ({ id: it.id, kind: 'initiative', label: it.name, rel: it.rel, x: 0, y: 0, degree: 1 }));

    const r1 = ring([...homeHubs, ...onePeople], 165, -90);
    const r2 = ring([...relHubs, ...twoPeople], 258, -78);
    const r3 = ring(threePeople, 332, -84);
    const r0 = ring(inis, 96, 90);

    const center0: GNode = { id: 'self', kind: 'self', label: res.centerLabel, rel: res.centerSubtitle, x: C.x, y: C.y, degree: 0 };
    const all: GNode[] = [center0, ...r1, ...r2, ...r3, ...r0];

    const edges = [
      ...r0.map(n => ({ id: 'e0_' + n.id, x2: n.x, y2: n.y, kind: 'overlay' })),
      ...r1.map(n => ({ id: 'e1_' + n.id, x2: n.x, y2: n.y, kind: 'one' })),
      ...r2.map(n => ({ id: 'e2_' + n.id, x2: n.x, y2: n.y, kind: 'two' })),
      ...r3.map(n => ({ id: 'e3_' + n.id, x2: n.x, y2: n.y, kind: 'three' })),
    ];
    return { nodes: all, edges };
  }, [res]);

  // ── pan + zoom ───────────────────────────────────────────────────────────────────────────────
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setT(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
    drag.current.x = e.clientX; drag.current.y = e.clientY;
  };
  const onUp = () => { drag.current = null; };
  const zoom = (f: number) => setT(p => ({ ...p, k: Math.min(2.4, Math.max(0.55, p.k * f)) }));
  const reset = () => setT({ x: 0, y: 0, k: 1 });
  const go = (nav?: string) => { if (nav && !drag.current?.moved) navigate(`/item/${encodeURIComponent(nav)}`); };

  const edgeStyle: Record<string, any> = {
    one: { stroke: 'var(--color-steel)', strokeWidth: 1.5, strokeOpacity: 0.5 },
    two: { stroke: '#B8B4A8', strokeWidth: 1.25, strokeDasharray: '5 4', strokeOpacity: 0.7 },
    three: { stroke: '#C9C4B8', strokeWidth: 1, strokeDasharray: '2 5', strokeOpacity: 0.6 },
    overlay: { stroke: 'var(--warning)', strokeWidth: 1.5, strokeOpacity: 0.5 },
  };
  const radius = (k: string) => (k === 'self' ? 30 : k === 'community' ? 17 : k === 'initiative' ? 15 : 13);

  return (
    <div className="flex flex-col gap-4">
      {/* header: centered-on + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>
          Centered on <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{res.centerLabel}</span>
          <span className="mx-1.5" style={{ color: 'var(--color-warm-gray)' }}>·</span>
          <span style={{ color: 'var(--color-warm-gray)' }}>{res.centerSubtitle}</span>
        </div>
        <div className="flex items-center p-1 rounded-lg border shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          {([['graph', NetworkIcon, 'Graph'], ['table', TableIcon, 'Table']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setView(id)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all"
              style={view === id ? { backgroundColor: 'white', color: 'var(--color-navy)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: 'var(--color-warm-gray)' }}>
              <Icon className="w-3.5 h-3.5" style={{ color: view === id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
        {[['person', 'People'], ['community', 'Communities'], ['initiative', 'Initiatives (local)']].map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: KIND[k] }} /> {l}</span>
        ))}
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-warm-gray)' }}>
          <span className="w-4 h-px" style={{ backgroundColor: 'var(--color-steel)' }} /> 1st
          <span className="w-4 h-px ml-2" style={{ borderTop: '1px dashed #B8B4A8' }} /> 2nd
          <span className="w-4 h-px ml-2" style={{ borderTop: '1px dotted #C9C4B8' }} /> 3rd+
        </span>
      </div>

      {view === 'graph' ? (
        <div className="relative w-full h-[460px] rounded-xl border overflow-hidden select-none"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'white', backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          {/* zoom controls */}
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 p-1 rounded-lg border shadow-sm" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
            <button onClick={() => zoom(1.2)} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Zoom in"><ZoomIn className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
            <button onClick={() => zoom(1 / 1.2)} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Zoom out"><ZoomOut className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
            <button onClick={reset} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Reset"><Maximize2 className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
          </div>
          <svg className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
            <g transform={`translate(${t.x},${t.y}) scale(${t.k})`} style={{ transformOrigin: 'center' }}>
              {/* guide rings */}
              {[165, 258, 332].map(r => <circle key={r} cx={C.x} cy={C.y} r={r} fill="none" stroke="var(--color-border)" strokeOpacity="0.5" />)}
              {/* edges */}
              {edges.map(e => <line key={e.id} x1={C.x} y1={C.y} x2={e.x2} y2={e.y2} {...edgeStyle[e.kind]} />)}
              {/* nodes */}
              {nodes.map(n => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => go(n.nav)} style={{ cursor: n.nav ? 'pointer' : 'default' }} className="group">
                  <title>{n.label} — {n.rel}</title>
                  <circle r={radius(n.kind) + 3} fill="white" opacity={0} className="group-hover:opacity-100" style={{ transition: 'opacity .15s' }} />
                  <circle r={radius(n.kind)}
                    fill={n.kind === 'self' ? KIND.self : n.kind === 'person' ? 'white' : `color-mix(in srgb, ${KIND[n.kind]} 22%, white)`}
                    stroke={KIND[n.kind]} strokeWidth={n.kind === 'self' ? 0 : 2} />
                  <text textAnchor="middle" dy={n.kind === 'self' ? 6 : 4.5} fontSize={n.kind === 'self' ? 18 : 11} fontWeight={700}
                    fill={n.kind === 'self' ? 'white' : 'var(--color-navy)'}>
                    {n.kind === 'initiative' ? '◆' : n.label.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '•'}
                  </text>
                  <text textAnchor="middle" y={radius(n.kind) + 14} fontSize={11} fontWeight={n.kind === 'self' ? 700 : 500} fill="var(--color-navy)">{trunc(n.label, n.kind === 'self' ? 22 : 15)}</text>
                </g>
              ))}
            </g>
          </svg>
          <div className="absolute bottom-2 left-3 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Drag to pan · one global map, re-centered on the selected entity</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {([['1st degree', res.degrees.one, res.counts.one], ['2nd degree', res.degrees.two, res.counts.two], ['3rd+ degree', res.degrees.three, res.counts.three]] as [string, AssocPerson[], number][]).map(([label, list, count]) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>{label}</h3>
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{count}</span>
              </div>
              {list.length === 0 ? (
                <p className="text-xs px-1" style={{ color: 'var(--color-warm-gray)' }}>No connections at this distance.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {list.slice(0, 8).map(p => (
                    <Link key={p.id} to={`/item/${encodeURIComponent(p.name)}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl border bg-white hover:border-[var(--color-steel)] transition-colors group"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 border" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)', borderColor: 'var(--color-border)' }}>{p.name.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{p.name}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--color-warm-gray)' }}>{p.rel}</div>
                      </div>
                      <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full shrink-0 max-w-[160px] truncate" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{p.community}</span>
                      <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-steel)' }}>{p.warmthBand}</span>
                    </Link>
                  ))}
                  {count > 8 && <div className="text-xs px-1 pt-0.5" style={{ color: 'var(--color-warm-gray)' }}>+ {count - 8} more</div>}
                </div>
              )}
            </div>
          ))}

          {/* local overlay — initiatives + communities */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 mb-2 mt-3">
              <Target className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>Initiatives <span className="font-normal" style={{ color: 'var(--color-warm-gray)' }}>· local overlay</span></h3>
            </div>
            {res.initiatives.length === 0 ? (
              <p className="text-xs px-1" style={{ color: 'var(--color-warm-gray)' }}>No initiatives linked to this entity yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {res.initiatives.map(it => (
                  <span key={it.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border" style={{ borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--warning) 8%, transparent)', color: 'var(--color-navy)' }}>
                    <Target className="w-3 h-3" style={{ color: 'var(--warning)' }} /> {it.name}
                  </span>
                ))}
              </div>
            )}
            {res.communities.related.length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-warm-gray)' }}><Users className="w-3 h-3" /> Role-adjacent communities:</span>
                {res.communities.related.slice(0, 5).map(c => (
                  <Link key={c} to={`/item/${encodeURIComponent(c)}`} className="text-xs px-2 py-0.5 rounded-full border hover:border-[var(--color-steel)] transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{c}</Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>One global map — public communities with your initiatives appended, re-centered on the selected entity. Degrees are relative to the center.</p>
    </div>
  );
}
