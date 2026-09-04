/**
 * Canvas access-token handling — validation and MASKED metadata only. The raw
 * token is never logged, never returned from any function here, and never
 * round-tripped through a tRPC response; callers persist it to @bridge/local's
 * SecretStore and pass the plain string straight into
 * `CanvasGatewayFactory.forConnection` at the point of use. Mirrors
 * @bridge/integrations-github's pat.ts.
 */

/** Canvas manual access tokens are `{shard-id}~{random}` (e.g. `6078~…`).
 * Shape-only validation — the gateway's `profile()` call is what actually
 * proves the token works against the instance. */
const CANVAS_TOKEN_PATTERN = /^\d{1,8}~[A-Za-z0-9~_-]{20,}$/;

export interface MaskedCanvasTokenMetadata {
  /** Last 4 characters only — enough for the owner to recognize which token
   * they connected, never enough to reconstruct it. */
  last4: string;
}

export function isCanvasTokenShape(token: string): boolean {
  return CANVAS_TOKEN_PATTERN.test(token);
}

export function maskCanvasToken(token: string): MaskedCanvasTokenMetadata {
  if (!isCanvasTokenShape(token)) throw new Error("not a recognized Canvas access-token shape");
  return { last4: token.slice(-4) };
}

/**
 * Normalizes a user-typed Canvas instance ("wustl.instructure.com", or a full
 * pasted URL) to a bare lowercase hostname. Returns undefined for anything
 * that is not a plausible hostname — the caller renders its own message.
 * Self-hosted Canvas domains are legal, so this does NOT require
 * `.instructure.com`.
 */
export function normalizeCanvasHost(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0]!.split("?")[0]!;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) return undefined;
  return value;
}
