import type { ReactNode } from 'react';

// Standardized Notion-style card grid — used by Helpdesk, JobPilot, DealPilot (and any future
// gallery-view tool). `repeat(auto-fill, minmax(...))` sizes columns from the available width
// instead of stepping on container-query breakpoints, so a card never balloons to half the
// screen on a mid-size viewport (the bug in Helpdesk's old grid-cols-2 → grid-cols-5 ladder).
export function CardGrid({ children, minWidth = 232 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="p-4 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
      {children}
    </div>
  );
}

export interface CardBodyLine { text: string; matched: boolean }

export interface NotionCardProps {
  eyebrow?: ReactNode;       // small pill/label, top-left of the card body (e.g. a status pill)
  cornerBadge?: ReactNode;   // top-right corner slot — the flag icon lives here
  title: string;
  subtitle?: string;
  bodyLines?: CardBodyLine[]; // matched criteria render green, unmatched render red — no prose
  metaChips?: string[];
  footer?: ReactNode;
  onOpen?: () => void;
}

// A compact, fixed-proportion card — no forced tall aspect ratio. Height is content-driven but
// capped by line-clamp, so cards stay uniform without stretching into the "too broad and long"
// shape the old Helpdesk card had at mid-size grid widths.
export function NotionCard({ eyebrow, cornerBadge, title, subtitle, bodyLines, metaChips, footer, onOpen }: NotionCardProps) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (onOpen && e.key === 'Enter') onOpen(); }}
      className="relative flex flex-col rounded-xl border bg-white transition-all overflow-hidden"
      style={{ borderColor: 'var(--color-border)', cursor: onOpen ? 'pointer' : 'default' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-steel)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 14px rgba(0,0,0,0.06)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
    >
      {cornerBadge && <div className="absolute top-2.5 right-2.5 z-10">{cornerBadge}</div>}
      <div className="p-3.5 flex flex-col gap-1.5">
        {eyebrow}
        <div className="font-semibold text-sm leading-snug line-clamp-2 pr-6" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{title}</div>
        {subtitle && <div className="text-xs truncate" style={{ color: 'var(--color-warm-gray)' }}>{subtitle}</div>}
        {bodyLines && bodyLines.length > 0 && (
          <ul className="flex flex-col gap-0.5 mt-1">
            {bodyLines.slice(0, 4).map((l, i) => (
              <li key={i} className="text-[11px] leading-snug pl-3 relative" style={{ color: l.matched ? 'var(--success)' : 'var(--danger)' }}>
                <span className="absolute left-0 font-bold">{l.matched ? '+' : '−'}</span>{l.text}
              </li>
            ))}
          </ul>
        )}
        {metaChips && metaChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {metaChips.map((c, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'var(--color-surface)' }}>{c}</span>
            ))}
          </div>
        )}
      </div>
      {footer && (
        <div className="px-3.5 py-2 border-t mt-auto shrink-0" style={{ borderColor: 'var(--color-border)' }}>{footer}</div>
      )}
    </div>
  );
}
