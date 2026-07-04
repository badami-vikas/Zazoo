import type { ComponentType } from 'react';
import { Outlet } from 'react-router';
import { AgentPanel } from './components/AgentPanel';
import { useState } from 'react';

// The standalone shell a tool gets when it ships on its OWN (per the tool-standardization plan's
// "build standalone first" path) — no Network, no other platform tools, no Settings (that's a
// platform concept; see ToolPageHeader's comment). Just: profile at top, this one tool's icon,
// the tool's own page, and its AI panel. When later mounted inside the real platform Layout, this
// entire shell is discarded — only the tool PAGE (e.g. JobPilotPage) survives, per the merge-back
// checklist in tool-standardization-plan.md section 7.
export function StandaloneLayout({ toolIcon: Icon, toolName }: { toolIcon: ComponentType<any>; toolName: string }) {
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-navy)' }}>
      <aside className="h-full border-r flex flex-col items-center gap-3 py-3 shrink-0" style={{ width: 76, borderColor: 'var(--color-border)' }}>
        <div className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-sm font-bold shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }} title="Profile (standalone)">
          {toolName.charAt(0)}
        </div>
        <span className="text-[9px] font-medium -mt-2" style={{ color: 'var(--color-navy-mid)' }}>Profile</span>
        <div className="w-full h-px my-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-steel-light)' + '20', color: 'var(--color-steel)' }}>
          <Icon className="w-5 h-5" />
          <span className="text-[9px] font-medium leading-none">{toolName}</span>
        </div>
      </aside>
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 relative z-0">
        <Outlet context={{ highlightedRowId, setHighlightedRowId }} />
      </div>
      <AgentPanel highlightedRowId={highlightedRowId} setHighlightedRowId={setHighlightedRowId} isCollapsed={rightCollapsed} setIsCollapsed={setRightCollapsed} toolNameOverride={toolName} />
    </div>
  );
}
