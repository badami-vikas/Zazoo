import type { PolicyParams } from "./params.js";
import { clampToBounds, getTunable } from "./params.js";

export interface ChipTarget {
  paramKey: string;
  direction: "increase" | "decrease";
}

export const CHIP_PARAM_MAP: Record<string, ChipTarget> = {
  too_casual: { paramKey: "tone_threshold", direction: "increase" },
  too_formal: { paramKey: "tone_threshold", direction: "decrease" },
};

export interface VettedVeto {
  decisionId: string;
  chip: string;
}

export interface VarianceProposal {
  paramKey: string;
  chip: string;
  direction: "increase" | "decrease";
  from: number;
  to: number;
  delta: number;
  clampedAtCeiling: boolean;
  clampedAtFloor: boolean;
  vetoCount: number;
  governed: true;
  applied: false;
  rationale: string;
}

export interface ProposeOpts {
  minVetoes?: number;
  delta?: number;
}

export function proposeVarianceAdjustment(
  params: PolicyParams,
  vetoes: VettedVeto[],
  opts?: ProposeOpts,
): VarianceProposal | null {
  const chipCounts = new Map<string, number>();
  for (const veto of vetoes) {
    if (CHIP_PARAM_MAP[veto.chip] === undefined) continue;
    chipCounts.set(veto.chip, (chipCounts.get(veto.chip) ?? 0) + 1);
  }

  let chosenChip: string | undefined;
  let chosenCount = 0;
  for (const [chip, count] of chipCounts) {
    if (count > chosenCount) {
      chosenChip = chip;
      chosenCount = count;
    }
  }

  if (chosenChip === undefined) return null;

  const minVetoes = opts?.minVetoes ?? 3;
  if (chosenCount < minVetoes) return null;

  const target = CHIP_PARAM_MAP[chosenChip];
  if (target === undefined) return null;

  const param = getTunable(params, target.paramKey);
  if (param === undefined) return null;

  const step = opts?.delta ?? params.variance.delta;
  const rawTo = target.direction === "increase" ? param.value + step : param.value - step;
  const to = clampToBounds(rawTo, param);
  const clampedAtCeiling = rawTo > param.ceil;
  const clampedAtFloor = rawTo < param.floor;

  return {
    paramKey: target.paramKey,
    chip: chosenChip,
    direction: target.direction,
    from: param.value,
    to,
    delta: step,
    clampedAtCeiling,
    clampedAtFloor,
    vetoCount: chosenCount,
    governed: true,
    applied: false,
    rationale: buildRationale(chosenCount, chosenChip, target.paramKey, target.direction, param.value, to, clampedAtCeiling, clampedAtFloor),
  };
}

function buildRationale(
  vetoCount: number,
  chip: string,
  paramKey: string,
  direction: ChipTarget["direction"],
  from: number,
  to: number,
  clampedAtCeiling: boolean,
  clampedAtFloor: boolean,
): string {
  const clampNote = clampedAtCeiling ? " (clamped at ceiling)" : clampedAtFloor ? " (clamped at floor)" : "";
  return `${vetoCount} '${chip}' vetoes → nudge ${paramKey} ${direction} from ${from} to ${to}${clampNote}`;
}
