export function normalizeCultureSynthesisResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (
    Array.isArray(candidate.resultHashes) ||
    !Array.isArray(candidate.artifactHashes)
  ) {
    return value;
  }
  const { artifactHashes, ...rest } = candidate;
  return { ...rest, resultHashes: artifactHashes };
}
