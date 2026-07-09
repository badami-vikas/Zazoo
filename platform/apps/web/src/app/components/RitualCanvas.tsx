import { useMemo, useRef, useState } from 'react';
import { Zap, Mail, Clock, CheckCircle, GitBranch, Bell, Plus, Trash2, ZoomIn, ZoomOut, Maximize2, Database } from 'lucide-react';
import clsx from 'clsx';

// Non-linear, make.com-style open canvas for a ritual's steps. Nodes are freely draggable, the canvas
// pans + zooms, and a Condition step forks the flow into two branches that merge downstream. Seeded
// deterministically from the ritual's linear step list, then editable in-place (add / move / delete).

type StepLike = { id: string; type: string; name: string; description?: string; delay?: string; icon?: any };
type DataScope = 'all' | 'public' | 'private';
interface CNode { id: string; kind: 'trigger' | 'step'; type: string; name: string; delay?: string; icon: any; x: number; y: number; dataScope?: DataScope }
interface CEdge { from: string; to: string; label?: string }

// Data tier a step may touch (the access dropdown). Maps to the governed pipeline's
// data-scope: public = canonical/public facts, private = the relationship tier.
const DATA_SCOPES: { value: DataScope; label: string }[] = [
  { value: 'all', label: 'All data' },
  { value: 'public', label: 'Public data' },
  { value: 'private', label: 'Private data' },
];

const NODE_W = 184, NODE_H = 66, COL_W = 250, ROW_H = 132;

const typeStyle: Record<string, { color: string; icon: any }> = {
  Trigger: { color: 'var(--color-steel)', icon: Zap },
  Email: { color: 'var(--info)', icon: Mail },
  Wait: { color: 'var(--color-warm-gray)', icon: Clock },
  Touchpoint: { color: 'var(--info)', icon: CheckCircle },
  Condition: { color: 'var(--warning)', icon: GitBranch },
  Notification: { color: 'var(--warning)', icon: Bell },
  Action: { color: 'var(--success)', icon: CheckCircle },
};
const palette = ['Email', 'Wait', 'Touchpoint', 'Condition', 'Notification'] as const;

function buildFlow(steps: StepLike[], triggerName: string): { nodes: CNode[]; edges: CEdge[] } {
  const nodes: CNode[] = [];
  const edges: CEdge[] = [];
  const place = (id: string, kind: CNode['kind'], type: string, name: string, delay: string | undefined, col: number, lane: number): CNode => {
    const n: CNode = { id, kind, type, name, delay, icon: (typeStyle[type]?.icon || CheckCircle), x: 60 + col * COL_W, y: 200 + lane * ROW_H, ...(kind === 'step' ? { dataScope: 'all' as DataScope } : {}) };
    nodes.push(n); return n;
  };

  place('trigger', 'trigger', 'Trigger', triggerName || 'Trigger', undefined, 0, 0);
  let prev = 'trigger';
  let spineCol = 0;
  let inBranch = false, condId = '', condCol = 0;
  let branchTails: string[] = [];

  for (const s of steps) {
    const tag = `${s.name} ${s.delay || ''}`;
    const isA = /branch\s*a/i.test(tag);
    const isB = /branch\s*b/i.test(tag);
    if (inBranch && (isA || isB)) {
      const lane = isA ? -1 : 1;
      place(s.id, 'step', s.type, s.name, s.delay, condCol + 1, lane);
      edges.push({ from: condId, to: s.id, label: isA ? 'If yes' : 'If no' });
      branchTails.push(s.id);
      continue;
    }
    if (inBranch) {
      // merge node — pull the open branches back together
      spineCol = condCol + 2;
      place(s.id, 'step', s.type, s.name, s.delay, spineCol, 0);
      for (const t of branchTails) edges.push({ from: t, to: s.id });
      branchTails = []; inBranch = false; prev = s.id;
    } else {
      spineCol += 1;
      place(s.id, 'step', s.type, s.name, s.delay, spineCol, 0);
      edges.push({ from: prev, to: s.id });
      prev = s.id;
    }
    if (s.type === 'Condition') { inBranch = true; condId = s.id; condCol = spineCol; }
  }
  return { nodes, edges };
}

export function RitualCanvas({ steps, triggerName = 'Trigger' }: { steps: StepLike[]; triggerName?: string }) {
  const seed = useMemo(() => buildFlow(steps, triggerName), [steps, triggerName]);
  const [nodes, setNodes] = useState<CNode[]>(seed.nodes);
  const [edges, setEdges] = useState<CEdge[]>(seed.edges);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.85 });

  const pan = useRef<{ x: number; y: number } | null>(null);
  const nodeDrag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

  const onBgDown = (e: React.PointerEvent) => { pan.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (nodeDrag.current) {
      const d = nodeDrag.current;
      const dx = (e.clientX - d.x) / view.k, dy = (e.clientY - d.y) / view.k;
      d.x = e.clientX; d.y = e.clientY; d.moved = true;
      setNodes(ns => ns.map(n => n.id === d.id ? { ...n, x: n.x + dx, y: n.y + dy } : n));
    } else if (pan.current) {
      setView(v => ({ ...v, x: v.x + (e.clientX - pan.current!.x), y: v.y + (e.clientY - pan.current!.y) }));
      pan.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onUp = () => { pan.current = null; nodeDrag.current = null; };
  const onNodeDown = (e: React.PointerEvent, id: string) => { e.stopPropagation(); nodeDrag.current = { id, x: e.clientX, y: e.clientY, moved: false }; };

  const zoom = (f: number) => setView(v => ({ ...v, k: Math.min(1.6, Math.max(0.4, v.k * f)) }));
  const reset = () => setView({ x: 0, y: 0, k: 0.85 });

  const addStep = (type: string) => {
    const spine = nodes.filter(n => Math.abs(n.y - 200) < 1);
    const last = spine.length ? spine.reduce((a, b) => (b.x > a.x ? b : a)) : nodes[0];
    const id = `s_new_${nodes.length}_${type}`;
    const node: CNode = { id, kind: 'step', type, name: `New ${type}`, delay: 'Set timing', icon: typeStyle[type]?.icon || CheckCircle, x: (last?.x || 60) + COL_W, y: 200, dataScope: 'all' };
    setNodes(ns => [...ns, node]);
    if (last) setEdges(es => [...es, { from: last.id, to: id }]);
  };
  const del = (id: string) => { setNodes(ns => ns.filter(n => n.id !== id)); setEdges(es => es.filter(e => e.from !== id && e.to !== id)); };
  const setScope = (id: string, scope: DataScope) => setNodes(ns => ns.map(n => n.id === id ? { ...n, dataScope: scope } : n));

  const nodeById = (id: string) => nodes.find(n => n.id === id);
  const edgePath = (e: CEdge) => {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* palette + controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold mr-1" style={{ color: 'var(--color-warm-gray)' }}>Add step</span>
          {palette.map(t => {
            const Icon = typeStyle[t].icon;
            return (
              <button key={t} onClick={() => addStep(t)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium hover:bg-[var(--color-surface)] transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: typeStyle[t].color }} /> {t}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg border shadow-sm" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
          <button onClick={() => zoom(1.2)} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Zoom in"><ZoomIn className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
          <button onClick={() => zoom(1 / 1.2)} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Zoom out"><ZoomOut className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
          <button onClick={reset} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]" title="Reset"><Maximize2 className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} /></button>
        </div>
      </div>

      {/* canvas */}
      <div
        className="relative w-full h-[520px] rounded-xl border overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', backgroundImage: 'radial-gradient(var(--color-border) 1.2px, transparent 1.2px)', backgroundSize: '24px 24px' }}
        onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: 4000, height: 1400 }}>
          {/* edges */}
          <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" width={4000} height={1400}>
            <defs>
              <marker id="rc-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M1,1 L8,4.5 L1,8" fill="none" stroke="var(--color-warm-gray)" strokeWidth="1.4" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const mid = (() => { const a = nodeById(e.from), b = nodeById(e.to); return a && b ? { x: (a.x + NODE_W + b.x) / 2, y: (a.y + b.y) / 2 + NODE_H / 2 } : null; })();
              return (
                <g key={i}>
                  <path d={edgePath(e)} fill="none" stroke="var(--color-warm-gray)" strokeWidth="1.6" strokeOpacity="0.7" markerEnd="url(#rc-arrow)" />
                  {e.label && mid && (
                    <foreignObject x={mid.x - 26} y={mid.y - 12} width="54" height="20" className="overflow-visible">
                      <div className="text-[10px] font-semibold text-center rounded-full px-1.5 py-0.5 border" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{e.label}</div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </svg>

          {/* nodes */}
          {nodes.map(n => {
            const st = typeStyle[n.type] || { color: 'var(--color-warm-gray)', icon: CheckCircle };
            const Icon = n.icon || st.icon;
            return (
              <div key={n.id}
                onPointerDown={(e) => onNodeDown(e, n.id)}
                className={clsx('absolute rounded-xl border bg-white shadow-sm hover:shadow-md transition-shadow group cursor-grab active:cursor-grabbing')}
                style={{ left: n.x, top: n.y, width: NODE_W, borderColor: n.kind === 'trigger' ? 'var(--color-steel)' : 'var(--color-border)', borderWidth: n.kind === 'trigger' ? 2 : 1 }}
              >
                <div className="flex items-start gap-2.5 p-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 12%, white)`, borderColor: `color-mix(in srgb, ${st.color} 30%, transparent)` }}>
                    <Icon className="w-4 h-4" style={{ color: st.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 12%, white)`, color: st.color }}>{n.type}</span>
                    </div>
                    <div className="text-sm font-semibold truncate mt-0.5" style={{ color: 'var(--color-navy)' }}>{n.name}</div>
                    {n.delay && <div className="text-[11px] truncate" style={{ color: 'var(--color-warm-gray)' }}>{n.delay}</div>}
                  </div>
                  {n.kind !== 'trigger' && (
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => del(n.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-all" title="Delete step">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {/* data-access dropdown — which tier this step may touch (governed) */}
                {n.kind !== 'trigger' && (
                  <div className="flex items-center gap-1.5 px-3 pb-2.5 -mt-1" onPointerDown={e => e.stopPropagation()}>
                    <Database className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
                    <select
                      value={n.dataScope || 'all'}
                      onChange={(e) => setScope(n.id, e.target.value as DataScope)}
                      className="w-full text-[11px] font-medium rounded-md border px-1.5 py-1 bg-[var(--color-surface)] cursor-pointer focus:outline-none focus:ring-1"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                      title="Data this step can access"
                    >
                      {DATA_SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                )}
                {/* ports */}
                <span className="absolute right-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: st.color }} />
                {n.kind !== 'trigger' && <span className="absolute left-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: 'var(--color-warm-gray)' }} />}
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-2 left-3 text-[11px] pointer-events-none" style={{ color: 'var(--color-warm-gray)' }}>Drag nodes to arrange · drag canvas to pan · a Condition forks the flow</div>
      </div>
    </div>
  );
}
