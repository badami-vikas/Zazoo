import { Home, Users, Settings, Building2, ChevronDown, Check, Plus, Target, Brain, Pin } from 'lucide-react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { usePinnedTools } from '../Layout';
import { useActionQueue } from '../data/actionQueue';
import { useLivePendingCount, loadLedger } from '../data/ledger';
import { toolById } from '../data/tools';

// Always-collapsed icon rail (design standard, not a user toggle) — a name label sits under
// every icon so nothing is lost by staying narrow. Width is fixed; there is no expand state.
const RAIL_WIDTH = 76;

export function Sidebar() {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('bridge.workspaces.v1') || '["Acme Corp","Wayne Ent."]'); return Array.isArray(v) && v.length ? v : ['Acme Corp', 'Wayne Ent.']; } catch { return ['Acme Corp', 'Wayne Ent.']; }
  });
  const [activeWs, setActiveWs] = useState<string>(() => { try { return localStorage.getItem('bridge.activeWs.v1') || 'Acme Corp'; } catch { return 'Acme Corp'; } });
  const switchWs = (w: string) => { setActiveWs(w); try { localStorage.setItem('bridge.activeWs.v1', w); } catch {} setWorkspaceOpen(false); };
  const addWs = () => { const name = `Workspace ${workspaces.length + 1}`; const next = [...workspaces, name]; setWorkspaces(next); try { localStorage.setItem('bridge.workspaces.v1', JSON.stringify(next)); } catch {} switchWs(name); };
  const location = useLocation();
  const { pinnedTools } = usePinnedTools();
  const queued = useActionQueue();
  const approvalsBadge = useLivePendingCount() + queued.length;
  useEffect(() => { loadLedger(); }, []);

  const navItems = [
    { icon: Home, label: 'Home', to: '/home' },
    { icon: Users, label: 'Network', to: '/' },
    { icon: Target, label: 'Work', to: '/work' },
  ];
  const bottomItems = [
    { icon: Brain, label: 'Intelligence', to: '/intelligence' },
    { icon: Settings, label: 'Settings', to: '/settings' },
  ];

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/' || location.pathname.startsWith('/item/') || location.pathname.startsWith('/circles');
    if (to === '/work') return location.pathname === '/work' || location.pathname.startsWith('/initiative/') || location.pathname.startsWith('/ritual/') || location.pathname === '/rituals' || location.pathname.startsWith('/project/') || location.pathname === '/tools' || location.pathname.startsWith('/tool/');
    if (to === '/intelligence') return location.pathname === '/intelligence' || location.pathname.startsWith('/agent/') || location.pathname.startsWith('/skill/') || location.pathname.startsWith('/integration/');
    return location.pathname === to || location.pathname.startsWith(to + '/');
  };

  return (
    <aside
      style={{ width: RAIL_WIDTH, backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
      className="h-full border-r flex flex-col justify-between relative z-30 shrink-0"
    >
      <div className="flex flex-col gap-3">
        {/* Profile / workspace switcher — the top-of-rail identity control */}
        <div className="h-16 flex items-center justify-center border-b shrink-0 relative" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => setWorkspaceOpen((o) => !o)} className="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg hover:bg-[var(--color-surface)] transition-colors" title={activeWs}>
            <div className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}>{activeWs.charAt(0)}</div>
            <span className="text-[9px] font-medium truncate max-w-[64px]" style={{ color: 'var(--color-navy-mid)' }}>Profile</span>
          </button>
          <AnimatePresence>
            {workspaceOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWorkspaceOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-1 w-52 mt-1 border rounded-xl shadow-lg z-50 overflow-hidden"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <div className="p-1.5 flex flex-col">
                    {workspaces.map((w, i) => (
                      <button key={w} onClick={() => switchWs(w)} className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-[var(--color-surface)]" style={{ backgroundColor: w === activeWs ? 'var(--color-surface)' : 'transparent' }}>
                        <div className="w-6 h-6 min-w-[24px] rounded-md text-white flex items-center justify-center text-xs font-bold shadow-sm" style={{ backgroundColor: i % 2 === 0 ? 'var(--color-navy)' : 'var(--info)' }}>{w.charAt(0)}</div>
                        <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-navy)' }}>{w}</span>
                        {w === activeWs && <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />}
                      </button>
                    ))}
                    <div className="h-px bg-[var(--color-surface)] my-1 mx-2" />
                    <button onClick={addWs} className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] hover:bg-[var(--color-surface)] rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Add Workspace
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Top Nav — icon + label stack, always visible */}
        <nav className="flex flex-col gap-1 px-1.5">
          {navItems.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                className="flex flex-col items-center gap-0.5 py-2 rounded-lg transition-all relative"
                style={active ? { backgroundColor: 'var(--color-steel-light)' + '20', color: 'var(--color-steel)' } : { color: 'var(--color-navy-mid)' }}
              >
                <item.icon className="w-5 h-5" style={{ color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                <span className="text-[9px] font-medium leading-none">{item.label}</span>
                {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full" style={{ backgroundColor: 'var(--color-steel)' }} />}
              </Link>
            );
          })}

          {/* Pinned tools — same icon+label stack, listed directly under Work */}
          {pinnedTools.length > 0 && (
            <div className="flex flex-col gap-1 mt-1 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
              {pinnedTools.map((toolId) => {
                const meta = toolById(toolId);
                if (!meta) return null;
                const ToolIcon = meta.icon;
                const badge = (meta as any).badge === 'approvals' ? approvalsBadge : 0;
                return (
                  <Link key={toolId} to={(meta as any).route ?? `/tool/${toolId}`} className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors relative" title={meta.name}>
                    <ToolIcon className="w-4 h-4" style={{ color: meta.color }} />
                    <span className="text-[8.5px] font-medium leading-none truncate max-w-[64px]" style={{ color: 'var(--color-navy-mid)' }}>{meta.name}</span>
                    {badge > 0 && <span className="absolute top-0 right-2 min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ backgroundColor: 'var(--warning)', color: 'white' }}>{badge}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
      </div>

      <nav className="flex flex-col gap-1 px-1.5 pb-3">
        {bottomItems.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              className="flex flex-col items-center gap-0.5 py-2 rounded-lg transition-colors"
              style={active ? { backgroundColor: 'var(--color-steel)' + '10', color: 'var(--color-steel)' } : { color: 'var(--color-navy-mid)' }}
            >
              <item.icon className="w-5 h-5" style={{ color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
              <span className="text-[9px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
