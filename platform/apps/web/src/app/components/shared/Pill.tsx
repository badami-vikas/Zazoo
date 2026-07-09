import clsx from 'clsx';
import type { ReactNode } from 'react';

// The one pill/chip control every "Lists" row uses — ListPillRow (simple category filters) and
// ListBar (user-creatable lists with AI instruction + merge) both render this, not their own copy.
export function Pill({
  label,
  active,
  onClick,
  onContextMenu,
  leadingIcon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  leadingIcon?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border')}
      style={{
        backgroundColor: active ? 'var(--color-steel)' : 'var(--color-surface)',
        color: active ? 'white' : 'var(--color-navy-mid)',
        borderColor: active ? 'var(--color-steel)' : 'var(--color-border)',
      }}
    >
      {leadingIcon}
      {label}
    </button>
  );
}
