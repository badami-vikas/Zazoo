import { Home, Users, Calendar, PenTool, Settings, HelpCircle, ChevronsLeft, ChevronsRight, Building2, ChevronDown, ChevronRight, Plus, RefreshCw, Search, Milestone, Briefcase, Activity, MessageCircle, Pin, Target, Brain, Lightbulb, ShieldCheck, Check, LifeBuoy } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { usePinnedTools } from '../Layout';
import { useActionQueue } from '../data/actionQueue';
import { useLivePendingCount, loadLedger } from '../data/ledger';
import { toolById } from '../data/tools';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

// Pinned-tool metadata now comes from the single tools registry (data/tools.ts) so pin → nav works
// and the labels/icons stay in sync with the Tools page and the /tool/:id detail page.

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('bridge.workspaces.v1') || '["Acme Corp","Wayne Ent."]'); return Array.isArray(v) && v.length ? v : ['Acme Corp', 'Wayne Ent.']; } catch { return ['Acme Corp', 'Wayne Ent.']; }
  });
  const [activeWs, setActiveWs] = useState<string>(() => { try { return localStorage.getItem('bridge.activeWs.v1') || 'Acme Corp'; } catch { return 'Acme Corp'; } });
  const switchWs = (w: string) => { setActiveWs(w); try { localStorage.setItem('bridge.activeWs.v1', w); } catch {} setWorkspaceOpen(false); };
  const addWs = () => { const name = `Workspace ${workspaces.length + 1}`; const next = [...workspaces, name]; setWorkspaces(next); try { localStorage.setItem('bridge.workspaces.v1', JSON.stringify(next)); } catch {} switchWs(name); };
  const [pinnedToolsOpen, setPinnedToolsOpen] = useState(true);
  const location = useLocation();
  const { pinnedTools } = usePinnedTools();
  // Reactive: live ledger pending count + any signal-proposed actions in the local draft store.
  const queued = useActionQueue();
  const approvalsBadge = useLivePendingCount() + queued.length;
  // Prime the live pending count once on app load so the badge is correct on any landing page.
  useEffect(() => { loadLedger(); }, []);

  const navItems = [
    { icon: Home, label: 'Home', to: '/home' },
    { icon: Users, label: 'Network', to: '/' },
    { icon: Target, label: 'Work', to: '/work' },
    // Helpdesk is now a PINNABLE TOOL (default-pinned under Work), not a fixed nav item — see
    // data/tools.ts (id 'helpdesk', route '/helpdesk') + Layout default pins. Users can unpin it.
    // Approvals is now a PINNED TOOL (default-pinned under Work), not a default nav item — the
    // pending badge rides on the pinned tool. See data/tools.ts (id 'approvals') + Layout pins.
  ];

  // Intelligence sits in the bottom group (above Settings); Help now lives inside Settings.
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

  const hasPinnedTools = pinnedTools.length > 0;

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 64 : 240 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      onClick={(e) => {
        // When collapsed, clicking anywhere that isn't an icon/link expands the sidebar.
        if (isCollapsed && !(e.target as HTMLElement).closest('a,button')) setIsCollapsed(false);
      }}
      className={clsx('h-full border-r flex flex-col justify-between relative z-30 shrink-0', isCollapsed && 'cursor-pointer')}
      style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex flex-col gap-4">
        {/* Workspace Brand Header */}
        <div className={clsx(
          'h-14 flex items-center border-b shrink-0',
          isCollapsed ? 'justify-center px-0' : 'justify-between pl-4 pr-2'
        )}>
          <div className="relative flex-1 overflow-hidden">
            <button
              onClick={() => !isCollapsed && setWorkspaceOpen(!workspaceOpen)}
              className={clsx(
                'flex items-center gap-3 transition-colors py-1.5 rounded-lg w-full',
                'hover:bg-[var(--color-surface)]',
                isCollapsed ? 'justify-center' : 'text-left px-1'
              )}
              title={isCollapsed ? activeWs : undefined}
            >
              <div className="w-8 h-8 min-w-[32px] rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}>
                {activeWs.charAt(0)}
              </div>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="flex flex-col overflow-hidden whitespace-nowrap flex-1"
                >
                  <span className="font-bold text-sm tracking-tight" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>{activeWs}</span>
                  <span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-warm-gray)' }}>
                    <Building2 className="w-3 h-3" /> Enterprise
                  </span>
                </motion.div>
              )}
              {!isCollapsed && (
                <ChevronDown className={clsx('w-4 h-4 text-[var(--color-warm-gray)] transition-transform shrink-0', workspaceOpen && 'rotate-180')} />
              )}
            </button>

            <AnimatePresence>
              {!isCollapsed && workspaceOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-1 right-1 mt-1 border rounded-xl shadow-lg z-50 overflow-hidden"
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
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={clsx(
              'p-2 rounded-lg transition-colors',
              'hover:bg-[var(--color-surface)]',
              isCollapsed && 'hidden'
            )}
            title="Collapse Sidebar"
          >
            <ChevronsLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Top Nav */}
        <nav className="flex flex-col gap-1 px-3 pt-1">
          {navItems.map((item) => {
            const active = isActive(item.to);
            const isWorkItem = item.label === 'Work';
            const badge = (item as any).badge as number | undefined;
            return (
              <div key={item.label}>
                <Link
                  to={item.to}
                  title={isCollapsed ? item.label : undefined}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative overflow-hidden',
                    active
                      ? 'font-medium'
                      : 'hover:bg-[var(--color-surface)]'
                  )}
                  style={active ? {
                    backgroundColor: 'var(--color-steel-light)' + '20',
                    color: 'var(--color-steel)'
                  } : { color: 'var(--color-navy-mid)' }}
                >
                  <item.icon className="w-5 h-5 min-w-[20px]" style={{ color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                  {!isCollapsed && <span className="whitespace-nowrap text-sm">{item.label}</span>}
                  {/* pending-count badge (Approvals) */}
                  {!isCollapsed && badge ? (
                    <span
                      className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'var(--warning)', color: 'white' }}
                    >
                      {badge}
                    </span>
                  ) : null}
                  {isCollapsed && badge ? (
                    <span
                      className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: 'var(--warning)', color: 'white' }}
                    >
                      {badge}
                    </span>
                  ) : null}
                  {isCollapsed && active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full" style={{ backgroundColor: 'var(--color-steel)' }} />
                  )}
                  {/* Chevron for Work — pinned tools drop under it */}
                  {!isCollapsed && isWorkItem && hasPinnedTools && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinnedToolsOpen(!pinnedToolsOpen); }}
                      className="ml-auto p-0.5 rounded transition-colors"
                      style={{ backgroundColor: pinnedToolsOpen ? 'var(--color-surface)' : 'transparent' }}
                    >
                      <ChevronDown className={clsx('w-3.5 h-3.5 text-[var(--color-warm-gray)] transition-transform', pinnedToolsOpen && 'rotate-180')} />
                    </button>
                  )}
                </Link>

                {/* Pinned tools dropdown under Work */}
                {isWorkItem && hasPinnedTools && !isCollapsed && (
                  <AnimatePresence>
                    {pinnedToolsOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-0.5 ml-5 pl-3 border-l-2 mt-1 mb-1" style={{ borderColor: 'var(--color-border)' }}>
                          {pinnedTools.map(toolId => {
                            const meta = toolById(toolId);
                            if (!meta) return null;
                            const ToolIcon = meta.icon;
                            const tBadge = (meta as any).badge === 'approvals' ? approvalsBadge : 0;
                            return (
                              <Link
                                key={toolId}
                                to={(meta as any).route ?? `/tool/${toolId}`}
                                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors group hover:bg-[var(--color-surface)]"
                                style={{ color: 'var(--color-navy-mid)' }}
                              >
                                <ToolIcon className="w-3.5 h-3.5 shrink-0" style={{ color: meta.color }} />
                                <span className="text-xs whitespace-nowrap truncate">{meta.name}</span>
                                {tBadge ? (
                                  <span className="ml-auto min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--warning)', color: 'white' }}>{tBadge}</span>
                                ) : (
                                  <Pin className="w-2.5 h-2.5 text-[var(--color-warm-gray)] ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}

                {/* Collapsed pinned tools indicators */}
                {isWorkItem && hasPinnedTools && isCollapsed && (
                  <div className="flex flex-col items-center gap-1 mt-1">
                    {pinnedTools.slice(0, 3).map(toolId => {
                      const meta = toolById(toolId);
                      if (!meta) return null;
                      const ToolIcon = meta.icon;
                      return (
                        <Link key={toolId} to={(meta as any).route ?? `/tool/${toolId}`} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--color-surface)] transition-colors cursor-pointer" title={meta.name}>
                          <ToolIcon className="w-3 h-3" style={{ color: meta.color }} />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-4 pb-4">
        {/* Bottom Nav */}
        <nav className="flex flex-col gap-1 px-3">
          {bottomItems.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                title={isCollapsed ? item.label : undefined}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative overflow-hidden',
                  active
                    ? 'bg-[var(--color-steel)]/10 text-[var(--color-steel)] font-medium'
                    : 'text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] hover:text-[var(--color-navy)]'
                )}
              >
                <item.icon className="w-5 h-5 min-w-[20px]" style={{ color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                {!isCollapsed && <span className="whitespace-nowrap font-medium text-sm">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

      </div>
    </motion.aside>
  );
}
