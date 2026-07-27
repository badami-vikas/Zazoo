/**
 * Minimal injectable fetch seam — mirrors tools/recorder's `SidecarFetch`
 * pattern (sidecar-port.ts): providers take a `fetchImpl` constructor arg
 * (default: global `fetch`) so request-SHAPING is unit-testable with no
 * network call, and so callers can point at a proxy/mock in tests without
 * reaching for nock/msw. Only the narrow surface actually used is typed here
 * (not the full DOM `fetch` signature) to keep this module dependency-light.
 */
export interface FetchLike {
  (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

export const defaultFetch: FetchLike = ((...args: Parameters<FetchLike>) =>
  (globalThis.fetch as unknown as FetchLike)(...args)) as FetchLike;
