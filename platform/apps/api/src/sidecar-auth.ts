import { timingSafeEqual } from "node:crypto";

export const SIDECAR_TOKEN_HEADER = "x-bridge-sidecar-token";

export function validSidecarToken(
  provided: string | string[] | undefined,
): boolean {
  const expected = process.env.BRIDGE_SIDECAR_TOKEN;
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!expected || expected.length < 32 || !value) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(value);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}
