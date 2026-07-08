import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;   // omit on the final (current) segment
}

/**
 * Path trail shown when the user navigates INTO a branch/detail away from the
 * top-level nav destinations (Home / Network / Work / Helpdesk landing). The last
 * segment is the current location (bold, non-link). Shared infra — every detail
 * page passes its own segments; no per-page breadcrumb duplication.
 */
export function Breadcrumb({ segments, className = '' }: { segments: Crumb[]; className?: string }) {
  if (!segments.length) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1 text-xs min-w-0 ${className}`}
      style={{ color: 'var(--color-warm-gray)' }}
    >
      {segments.map((c, i) => {
        const last = i === segments.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--color-border)' }} />}
            {last || !c.to ? (
              <span className="truncate font-semibold" style={{ color: 'var(--color-navy)' }} title={c.label}>{c.label}</span>
            ) : (
              <Link to={c.to} className="truncate hover:underline" style={{ color: 'var(--color-warm-gray)' }} title={c.label}>{c.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
