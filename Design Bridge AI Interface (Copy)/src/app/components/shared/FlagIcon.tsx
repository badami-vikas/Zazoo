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

// The flag IS the action control — there are no separate buttons on a card. Clicking it fires
// onClick(color): green proceeds, yellow proceeds-but-holds for review, red rejects. Status-only
// (no onClick) is still supported for read-only surfaces (e.g. inside a tooltip preview).
export function FlagIcon({ color, kind, matched, unmatched, onClick, disabled }: {
  color: FlagColor; kind: FlagKind; matched: string[]; unmatched: string[]; onClick?: (color: FlagColor) => void; disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick ? () => onClick(color) : undefined}
          className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border shadow-sm disabled:cursor-default"
          style={{ borderColor: `color-mix(in srgb, ${COLOR_VAR[color]} 35%, transparent)`, cursor: onClick && !disabled ? 'pointer' : 'default' }}
          aria-label={ACTION_LABEL[color]}
        >
          <Flag className="w-3.5 h-3.5" style={{ color: COLOR_VAR[color] }} fill={COLOR_VAR[color]} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="bg-white border shadow-lg" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-col gap-1 max-w-[240px]">
          <span className="text-[11px] font-bold" style={{ color: COLOR_VAR[color] }}>{ACTION_LABEL[color]}</span>
          <span className="text-[10px] italic" style={{ color: 'var(--color-warm-gray)' }}>{KIND_CAPTION[kind]}</span>
          {matched.map((m, i) => <span key={'m' + i} className="text-[11px] leading-snug" style={{ color: 'var(--success)' }}>+ {m}</span>)}
          {unmatched.map((u, i) => <span key={'u' + i} className="text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>− {u}</span>)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
