import type { ModelTier } from "@bridge/core";

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

export function requiredTokenCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label}: expected a non-negative integer`);
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
