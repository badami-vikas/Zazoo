import { cosineSimilarity } from "../learning/retrieval.js";
export { cosineSimilarity };
import type { ModelProvider } from "../ports.js";
import type { CapabilityManifestRow } from "./ports.js";
import type { CapabilityType, ComponentKind } from "./types.js";

const DEFAULT_NEAR_DUPLICATE = 0.82;
const DEFAULT_INCONCLUSIVE_LOW = 0.5;

const KIND_WEIGHT = 0.4;
const NAME_WEIGHT = 0.4;
const PERMISSIONS_WEIGHT = 0.2;

export interface OverlapCandidate {
  name: string;
  kind?: ComponentKind;
  capabilityType: CapabilityType;
  permissions?: string[];
  purpose?: string;
}

export interface OverlapMatch {
  manifestId: string;
  name: string;
  score: number;
  tier: "structural" | "semantic";
  nearDuplicate: boolean;
  reason: string;
}

export interface FindOverlapsOpts {
  model?: ModelProvider;
  nearDuplicate?: number;
  inconclusiveLow?: number;
}

interface StructuralSignals {
  effectiveKindMatch: boolean;
  nameJaccard: number;
  permissionJaccard?: number;
  score: number;
}

export function structuralSimilarity(candidate: OverlapCandidate, existing: CapabilityManifestRow): number {
  return structuralSignals(candidate, existing).score;
}

export async function findOverlaps(
  candidate: OverlapCandidate,
  existing: CapabilityManifestRow[],
  opts: FindOverlapsOpts = {},
): Promise<OverlapMatch[]> {
  const nearDuplicate = opts.nearDuplicate ?? DEFAULT_NEAR_DUPLICATE;
  const inconclusiveLow = opts.inconclusiveLow ?? DEFAULT_INCONCLUSIVE_LOW;
  const structuralMatches = existing
    .map((row) => structuralMatch(candidate, row, nearDuplicate))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const topScore = structuralMatches[0]?.score;
  if (topScore === undefined) return [];
  if (topScore >= nearDuplicate) return structuralMatches;
  if (topScore < inconclusiveLow) return structuralMatches.map((match) => ({ ...match, nearDuplicate: false }));

  const borderlineRows = existing.filter((row) => {
    const score = structuralSimilarity(candidate, row);
    return score >= inconclusiveLow && score < nearDuplicate;
  });

  const embed = opts.model?.embed;
  if (embed === undefined) {
    return structuralMatches.map((match) => ({
      ...match,
      reason: `${match.reason}; semantic comparison skipped: embedding model unavailable`,
    }));
  }

  try {
    const candidateText = candidate.purpose ?? candidate.name;
    const rowTexts = borderlineRows.map((row) => manifestPurpose(row) ?? row.name);
    const vectors = await embed([candidateText, ...rowTexts]);
    const candidateVector = vectors[0] ?? [];
    return borderlineRows
      .map((row, index) => {
        const cosine = clamp01(cosineSimilarity(candidateVector, vectors[index + 1] ?? []));
        return {
          manifestId: row.id,
          name: row.name,
          score: cosine,
          tier: "semantic" as const,
          nearDuplicate: cosine >= nearDuplicate,
          reason: `semantic purpose cosine ${formatScore(cosine)} after inconclusive structural match`,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  } catch (error) {
    return structuralMatches.map((match) => ({
      ...match,
      reason: `${match.reason}; semantic comparison skipped: embedding failed`,
    }));
  }
}


function structuralMatch(candidate: OverlapCandidate, row: CapabilityManifestRow, nearDuplicate: number): OverlapMatch {
  const signals = structuralSignals(candidate, row);
  return {
    manifestId: row.id,
    name: row.name,
    score: signals.score,
    tier: "structural",
    nearDuplicate: signals.score >= nearDuplicate,
    reason: structuralReason(signals),
  };
}

function structuralSignals(candidate: OverlapCandidate, existing: CapabilityManifestRow): StructuralSignals {
  const effectiveKindMatch = effectiveKind(candidate) === effectiveKind(existing);
  const nameJaccard = jaccard(tokenize(candidate.name), tokenize(existing.name));
  const permissionJaccard = permissionSimilarity(candidate, existing);

  // Weights: kind 0.4, name 0.4, permissions 0.2; omit missing permission term and renormalize.
  const terms = [
    { score: effectiveKindMatch ? 1 : 0, weight: KIND_WEIGHT },
    { score: nameJaccard, weight: NAME_WEIGHT },
    ...(permissionJaccard !== undefined ? [{ score: permissionJaccard, weight: PERMISSIONS_WEIGHT }] : []),
  ];
  const totalWeight = terms.reduce((sum, term) => sum + term.weight, 0);
  const score = terms.reduce((sum, term) => sum + term.score * term.weight, 0) / totalWeight;
  return {
    effectiveKindMatch,
    nameJaccard,
    ...(permissionJaccard !== undefined ? { permissionJaccard } : {}),
    score: clamp01(score),
  };
}

function effectiveKind(row: OverlapCandidate | CapabilityManifestRow): ComponentKind | CapabilityType {
  return row.kind ?? row.capabilityType;
}

function permissionSimilarity(candidate: OverlapCandidate, existing: CapabilityManifestRow): number | undefined {
  const candidatePermissions = candidate.permissions;
  if (candidatePermissions === undefined || candidatePermissions.length === 0) return undefined;
  const existingPermissions = manifestPermissions(existing.manifest);
  if (existingPermissions === undefined || existingPermissions.length === 0) return undefined;
  return jaccard(new Set(candidatePermissions), new Set(existingPermissions));
}

function manifestPermissions(manifest: unknown): string[] | undefined {
  if (!isRecord(manifest) || !Array.isArray(manifest.permissions)) return undefined;
  const permissions: string[] = [];
  for (const permission of manifest.permissions) {
    if (!isRecord(permission)) continue;
    const resourceType = permission.resourceType;
    const action = permission.action;
    if (typeof resourceType === "string" && typeof action === "string") {
      permissions.push(`${resourceType}:${action}`);
    }
  }
  return permissions;
}

function manifestPurpose(row: CapabilityManifestRow): string | undefined {
  const manifest = row.manifest;
  if (!isRecord(manifest)) return undefined;
  return typeof manifest.purpose === "string" ? manifest.purpose : undefined;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function structuralReason(signals: StructuralSignals): string {
  return [
    `kind ${signals.effectiveKindMatch ? "matched" : "differed"}`,
    `name token Jaccard ${formatScore(signals.nameJaccard)}`,
    ...(signals.permissionJaccard !== undefined ? [`permission Jaccard ${formatScore(signals.permissionJaccard)}`] : []),
  ].join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatScore(value: number): string {
  return value.toFixed(3);
}
