import type { ComponentType } from 'react';

// Standardized tool-page title bar — one shape for every tool (JobPilot, DealPilot, Helpdesk,
// custom helpdesks, …): icon + name, nothing else. Profile and settings live in the platform's
// own left-rail nav now (Workspace/Team/Boundaries under Settings) — a tool page never renders
// its own competing profile/settings chrome, standalone or integrated. Full layout per tool page:
// this title bar -> ListPillRow (Lists) -> StandardToolbar (view/search/filter/custom/more).
export function ToolPageHeader({ icon: Icon, title }: { icon: ComponentType<any>; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b bg-white shrink-0" style={{ borderColor: 'var(--color-border)' }}>
      <Icon className="w-5 h-5" style={{ color: 'var(--color-steel)' }} />
      <h1 className="text-lg font-bold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{title}</h1>
    </div>
  );
}
