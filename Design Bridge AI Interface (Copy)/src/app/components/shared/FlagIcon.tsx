import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

export type FlagColor = 'green' | 'yellow' | 'red';
// ai_inference: the flag is the system's judgment call (e.g. a fit score) — feedback is about
// whether the AI read it right. data_quality: the flag is about verbatim user/platform data —
// feedback is about whether the DATA is right, not any inference.
export type FlagKind = 'ai_inference' | 'data_quality';

const COLOR_VAR: Record<FlagColor, string> = { green: 'var(--success)', yellow: 'var(--warning)', red: 'var(--danger)' };

// Universal, platform-wide meaning — the same in JobPilot, DealPilot, or anywhere else a flag
// appears. Never redefine this per tool.
const ACTION_LABEL: Record<FlagColor, string> = {
  green: 'Go ahead',
  yellow: 'Go ahead — hold status changes for manual review',
  red: 'No-go',
};

const KIND_CAPTION: Record<FlagKind, string> = {
  ai_inference: 'AI judgment — click to tell it if this is right',
  data_quality: 'Source data — click to flag if this is wrong',
};

const ALL_COLORS: FlagColor[] = ['green', 'yellow', 'red'];

// The flag IS the action control — there are no separate buttons on a card. The default display
// state is always the neutral yellow flag (regardless of the computed fit color) — clicking it is
// no longer a one-shot action. Instead, hovering the whole control reveals all three flags
// (green/yellow/red) so the user explicitly picks one; clicking a picker flag fires onClick(color):
// green proceeds, yellow proceeds-but-holds for review, red rejects. Status-only (no onClick) is
// still supported for read-only surfaces (e.g. inside a tooltip preview). Once `disabled` (already
// flagged), we drop the hover picker entirely and just show the actual current color, same as before.
export function FlagIcon({ color, kind, matched, unmatched, onClick, disabled }: {
  color: FlagColor; kind: FlagKind; matched: string[]; unmatched: string[]; onClick?: (color: FlagColor) => void; disabled?: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const showPicker = !disabled && hovering;
  const displayColor: FlagColor = disabled ? color : 'yellow';

  return (
    <div
      className="relative inline-flex items-center justify-center"
      onMouseEnter={() => !disabled && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={onClick ? () => onClick(displayColor) : undefined}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border shadow-sm disabled:cursor-default"
            style={{ borderColor: `color-mix(in srgb, ${COLOR_VAR[displayColor]} 35%, transparent)`, cursor: onClick && !disabled ? 'pointer' : 'default', visibility: showPicker ? 'hidden' : 'visible' }}
            aria-label={ACTION_LABEL[displayColor]}
          >
            <Flag className="w-3.5 h-3.5" style={{ color: COLOR_VAR[displayColor] }} fill={COLOR_VAR[displayColor]} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="bg-white border shadow-lg" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-col gap-1 max-w-[240px]">
            <span className="text-[11px] font-bold" style={{ color: COLOR_VAR[displayColor] }}>{ACTION_LABEL[displayColor]}</span>
            <span className="text-[10px] italic" style={{ color: 'var(--color-warm-gray)' }}>{KIND_CAPTION[kind]}</span>
            {matched.map((m, i) => <span key={'m' + i} className="text-[11px] leading-snug" style={{ color: 'var(--success)' }}>+ {m}</span>)}
            {unmatched.map((u, i) => <span key={'u' + i} className="text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>− {u}</span>)}
          </div>
        </TooltipContent>
      </Tooltip>

      {showPicker && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-1 px-1.5 py-1 rounded-full bg-white border shadow-md z-10"
          style={{ borderColor: 'var(--color-border)', width: 'max-content', left: '50%', transform: 'translateX(-50%)' }}
        >
          {ALL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={onClick ? () => onClick(c) : undefined}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full"
              style={{ cursor: onClick ? 'pointer' : 'default' }}
              aria-label={ACTION_LABEL[c]}
              title={ACTION_LABEL[c]}
            >
              <Flag className="w-3.5 h-3.5" style={{ color: COLOR_VAR[c] }} fill={COLOR_VAR[c]} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
