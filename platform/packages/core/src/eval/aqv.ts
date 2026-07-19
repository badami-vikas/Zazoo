import type { ExecutionSnapshot, LedgerEntry } from "../types.js";

export interface AqvWindow {
  from?: string;
  to?: string;
}

export interface AqvEvidence {
  violationCount?: number;
}

export interface AqvRecord {
  id: string;
  createdAt: string;
  userDecision: LedgerEntry["userDecision"];
  diff?: unknown;
  executionSnapshot?: ExecutionSnapshot;
  policyResults?: LedgerEntry["policyResults"];
}

export interface AQV {
  window: AqvWindow;
  episodeCount: number;
  success: number;
  correction: number;
  reliability: number;
  safety: number;
  efficiency: number;
}

export interface AqvSource {
  listAqvRecords(capabilityId: string, window: AqvWindow): Promise<{ records: AqvRecord[]; evidence?: AqvEvidence }>;
}

export function recordsInWindow(records: readonly AqvRecord[], window: AqvWindow): AqvRecord[] {
  return records.filter((record) => {
    const at = Date.parse(record.createdAt);
    if (Number.isNaN(at)) return false;
    if (window.from && at < Date.parse(window.from)) return false;
    if (window.to && at > Date.parse(window.to)) return false;
    return true;
  });
}

export function resolvedEpisodes(records: readonly AqvRecord[]): AqvRecord[] {
  return records.filter((record) => record.userDecision !== null);
}

export function computeSuccess(records: readonly AqvRecord[]): number {
  const episodes = resolvedEpisodes(records);
  if (episodes.length === 0) return 0;
  const score = episodes.reduce((sum, record) => {
    if (record.userDecision === "approve" || record.userDecision === "auto") return sum + 1;
    if (record.userDecision === "edit") return sum + 0.5;
    return sum;
  }, 0);
  return score / episodes.length;
}

export function computeCorrection(records: readonly AqvRecord[]): number {
  const episodes = resolvedEpisodes(records);
  if (episodes.length === 0) return 0;
  return episodes.filter((record) => record.userDecision === "edit").length / episodes.length;
}

export function computeCorrectionDepth(records: readonly AqvRecord[]): number {
  const edited = resolvedEpisodes(records).filter((record) => record.userDecision === "edit");
  if (edited.length === 0) return 0;
  return edited.reduce((sum, record) => sum + normalizedDiffSize(record.diff), 0) / edited.length;
}

export function computeReliability(records: readonly AqvRecord[]): number {
  const runs = resolvedEpisodes(records);
  if (runs.length === 0) return 0;
  return runs.filter((record) => isCleanCompletion(record.executionSnapshot)).length / runs.length;
}

export function computeSafety(records: readonly AqvRecord[], evidence: AqvEvidence = {}): number {
  if ((evidence.violationCount ?? 0) > 0) return 0;
  return records.some((record) => {
    const snapshot = record.executionSnapshot;
    if ((snapshot?.violationCount ?? 0) > 0) return true;
    if (snapshot?.planeGateRejected || snapshot?.approvalBypassAttempted) return true;
    return record.policyResults?.some((result) => result.effect === "block") ?? false;
  })
    ? 0
    : 1;
}

export function computeEfficiency(records: readonly AqvRecord[]): number {
  const successful = resolvedEpisodes(records).filter(
    (record) => (record.userDecision === "approve" || record.userDecision === "auto") && isCleanCompletion(record.executionSnapshot),
  );
  const ratios = successful
    .map((record) => {
      const cost = agentCost(record.executionSnapshot);
      const baseline = record.executionSnapshot?.baselineCost;
      if (!cost || !baseline || cost <= 0 || baseline <= 0) return null;
      return Math.min(baseline / cost, 1);
    })
    .filter((ratio): ratio is number => ratio !== null);
  if (ratios.length === 0) return 0;
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

export function computeAqv(records: readonly AqvRecord[], window: AqvWindow = {}, evidence: AqvEvidence = {}): AQV {
  const scoped = recordsInWindow(records, window);
  return {
    window,
    episodeCount: resolvedEpisodes(scoped).length,
    success: computeSuccess(scoped),
    correction: computeCorrection(scoped),
    reliability: computeReliability(scoped),
    safety: computeSafety(scoped, evidence),
    efficiency: computeEfficiency(scoped),
  };
}

export async function scoreCapability(source: AqvSource, capabilityId: string, window: AqvWindow = {}): Promise<AQV> {
  const { records, evidence } = await source.listAqvRecords(capabilityId, window);
  return computeAqv(records, window, evidence);
}

function isCleanCompletion(snapshot: ExecutionSnapshot | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.terminalState && snapshot.terminalState !== "completed") return false;
  return !snapshot.error && !snapshot.timedOut && !snapshot.fallbackUsed && !snapshot.chainDepthExceeded;
}

function agentCost(snapshot: ExecutionSnapshot | undefined): number | null {
  if (!snapshot) return null;
  if (typeof snapshot.cost === "number") return snapshot.cost;
  const started = snapshot.startedAt ? Date.parse(snapshot.startedAt) : NaN;
  const finished = snapshot.finishedAt ? Date.parse(snapshot.finishedAt) : NaN;
  const durationMs = Number.isNaN(started) || Number.isNaN(finished) ? 0 : Math.max(finished - started, 0);
  const derived = (snapshot.tokenCount ?? 0) + (snapshot.actionInputCount ?? 0) + durationMs;
  return derived > 0 ? derived : null;
}

function normalizedDiffSize(diff: unknown): number {
  if (!diff) return 0;
  if (typeof diff === "object" && diff !== null && "normalizedDiffSize" in diff) {
    const raw = (diff as { normalizedDiffSize?: unknown }).normalizedDiffSize;
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.min(raw, 1));
  }
  const before = stringifyField(diff, "from");
  const after = stringifyField(diff, "to");
  if (before === null || after === null) return 0;
  const distance = Math.abs(after.length - before.length);
  const denominator = Math.max(before.length, after.length, 1);
  return Math.min(distance / denominator, 1);
}

function stringifyField(value: unknown, key: "from" | "to"): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : JSON.stringify(field);
}
