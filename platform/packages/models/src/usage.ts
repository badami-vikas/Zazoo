import type { ModelTier } from "@bridge/core";

const MAX_PROVIDER_TOKEN_COUNT = 10_000_000;

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: expected an object`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}: expected a string`);
  return value;
}

export function configuredModelId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error(`${label}: expected a bounded model id`);
  }
  return normalized;
}

export function requiredTokenCount(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_PROVIDER_TOKEN_COUNT
  ) {
    throw new Error(`${label}: expected a bounded non-negative integer`);
  }
  return value as number;
}

export function nullableTokenCount(value: unknown, label: string): number {
  return value === null ? 0 : requiredTokenCount(value, label);
}

export function providerRequestError(label: string, status: number): Error {
  return new Error(`${label}: provider request failed with status ${status}`);
}

export function assertTierSupported(providerId: string, tiers: readonly ModelTier[], tier: ModelTier): void {
  if (!tiers.includes(tier)) {
    throw new Error(`${providerId}: tier "${tier}" is not supported by this provider`);
  }
}

export function verifiedProviderModel(
  expected: string,
  value: unknown,
  label: string,
): string {
  const reported = requiredString(value, label).trim();
  if (reported.length === 0 || reported !== expected) {
    throw new Error(`${label}: provider reported an unexpected model identity`);
  }
  return reported;
}
