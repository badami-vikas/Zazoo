import { useState, useEffect, createContext, useContext } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { AgentPanel } from './components/AgentPanel';

export interface PinnedToolsContextType {
  pinnedTools: string[];
  togglePin: (toolId: string) => void;
  isPinned: (toolId: string) => boolean;
}

export const PinnedToolsContext = createContext<PinnedToolsContextType>({
  pinnedTools: [],
  togglePin: () => {},
  isPinned: () => false,
});

export function usePinnedTools() {
  return useContext(PinnedToolsContext);
}

export default function Layout() {
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  // Layout is locked to the user's arrangement — collapse states (and the AI panel width) persist.
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => typeof window !== 'undefined' && localStorage.getItem('bridge.leftCollapsed') === '1');
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => typeof window !== 'undefined' && localStorage.getItem('bridge.rightCollapsed') === '1');
  useEffect(() => { try { localStorage.setItem('bridge.leftCollapsed', leftPanelCollapsed ? '1' : '0'); } catch {} }, [leftPanelCollapsed]);
  useEffect(() => { try { localStorage.setItem('bridge.rightCollapsed', rightPanelCollapsed ? '1' : '0'); } catch {} }, [rightPanelCollapsed]);
  // Approvals is pinned by default (it's the moat) — it lives as a pinned tool, not a default nav item.
  const [pinnedTools, setPinnedTools] = useState<string[]>(['approvals', 'reconnect', 'open-threads', 'helpdesk']);

  const togglePin = (toolId: string) => {
    setPinnedTools(prev =>
      prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId]
    );
  };

  const isPinned = (toolId: string) => pinnedTools.includes(toolId);

  return (
    <PinnedToolsContext.Provider value={{ pinnedTools, togglePin, isPinned }}>
      <div className="flex h-screen w-full overflow-hidden font-sans selection:bg-[var(--color-steel-light)]/20 selection:text-[var(--color-steel)]" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-navy)' }}>
        <Sidebar isCollapsed={leftPanelCollapsed} setIsCollapsed={setLeftPanelCollapsed} />
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 relative z-0">
          <Outlet context={{ highlightedRowId, setHighlightedRowId }} />
        </div>
        <AgentPanel 
           highlightedRowId={highlightedRowId} 
           setHighlightedRowId={setHighlightedRowId} 
           isCollapsed={rightPanelCollapsed}
           setIsCollapsed={setRightPanelCollapsed}
        />
      </div>
    </PinnedToolsContext.Provider>
  );
}
