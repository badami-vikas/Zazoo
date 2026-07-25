type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ApiRecoveryState = "idle" | "waking" | "ready" | "unavailable";

export interface ApiTransportOptions {
  apiUrl: string;
  fetchImpl?: FetchFunction;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  wakeDelaysMs?: readonly number[];
  wakeTimeoutMs?: number;
  wakeBudgetMs?: number;
  readyTtlMs?: number;
  onStateChange?: (state: ApiRecoveryState) => void;
}

export interface ApiTransport {
  fetch: FetchFunction;
  fetchReplaySafe: FetchFunction;
  getState(): ApiRecoveryState;
  ensureReady(force?: boolean): Promise<void>;
}

const DEFAULT_WAKE_DELAYS_MS = [
  0, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000,
  10_000,
] as const;
const DEFAULT_WAKE_TIMEOUT_MS = 15_000;
const DEFAULT_WAKE_BUDGET_MS = 90_000;
const DEFAULT_READY_TTL_MS = 10 * 60_000;
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

export class ApiUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown = null) {
    super(message);
    this.name = "ApiUnavailableError";
    this.cause = cause;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function requestUrl(
  input: RequestInfo | URL,
  apiBase: URL,
): URL | null {
  try {
    const value =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    return new URL(value, apiBase);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function isReplaySafe(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createApiTransport(options: ApiTransportOptions): ApiTransport {
  const apiBase = new URL(options.apiUrl || "http://127.0.0.1");
  const wakeUrl = new URL("/health", apiBase);
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const wakeDelays = options.wakeDelaysMs ?? DEFAULT_WAKE_DELAYS_MS;
  const wakeTimeoutMs = options.wakeTimeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS;
  const wakeBudgetMs = options.wakeBudgetMs ?? DEFAULT_WAKE_BUDGET_MS;
  const readyTtlMs = options.readyTtlMs ?? DEFAULT_READY_TTL_MS;
  const needsWakeGate =
    options.apiUrl.length > 0 &&
    (apiBase.protocol === "http:" || apiBase.protocol === "https:") &&
    !isLoopback(apiBase.hostname);

  let state: ApiRecoveryState = "idle";
  let readyAt: number | null = null;
  let wakePromise: Promise<void> | null = null;

  const setState = (next: ApiRecoveryState) => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  };

  const probeLiveness = async (timeoutMs: number): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(wakeUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const runWake = async (): Promise<void> => {
    const deadline = now() + wakeBudgetMs;
    let lastFailure: unknown = new Error("no liveness attempt completed");
    for (const delayMs of wakeDelays) {
      const remainingBeforeDelay = deadline - now();
      if (remainingBeforeDelay <= 0 || delayMs >= remainingBeforeDelay) break;
      if (delayMs > 0) await sleep(delayMs);
      const remaining = deadline - now();
      if (remaining <= 0) break;
      try {
        const response = await probeLiveness(Math.min(wakeTimeoutMs, remaining));
        if (response.ok) {
          readyAt = now();
          setState("ready");
          return;
        }
        lastFailure = new Error(`liveness returned HTTP ${response.status}`);
        if (
          response.status >= 400 &&
          response.status < 500 &&
          !RETRYABLE_STATUSES.has(response.status)
        ) {
          break;
        }
      } catch (failure) {
        lastFailure = failure;
      }
    }
    readyAt = null;
    setState("unavailable");
    throw new ApiUnavailableError(
      "Bridge API is unavailable after the bounded wake period",
      lastFailure,
    );
  };

  const ensureReady = async (force = false): Promise<void> => {
    if (!needsWakeGate) return;
    if (!force && readyAt !== null && now() - readyAt < readyTtlMs) return;
    if (wakePromise) return wakePromise;
    setState("waking");
    wakePromise = runWake().finally(() => {
      wakePromise = null;
    });
    return wakePromise;
  };

  const fetchWithReplayPolicy = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    explicitlyReplaySafe: boolean,
  ): Promise<Response> => {
    const target = requestUrl(input, apiBase);
    const sameApiOrigin = target?.origin === apiBase.origin;
    if (sameApiOrigin) await ensureReady();

    const method = requestMethod(input, init);
    const mayReplay = explicitlyReplaySafe || isReplaySafe(method);
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (failure) {
      readyAt = null;
      if (!sameApiOrigin || !mayReplay) throw failure;
      await ensureReady(true);
      return fetchImpl(input, init);
    }

    if (
      sameApiOrigin &&
      RETRYABLE_STATUSES.has(response.status)
    ) {
      readyAt = null;
      if (mayReplay) {
        await ensureReady(true);
        return fetchImpl(input, init);
      }
    }
    return response;
  };
  const transportFetch: FetchFunction = (input, init) =>
    fetchWithReplayPolicy(input, init, false);
  const replaySafeFetch: FetchFunction = (input, init) =>
    fetchWithReplayPolicy(input, init, true);

  return {
    fetch: transportFetch,
    fetchReplaySafe: replaySafeFetch,
    getState: () => state,
    ensureReady,
  };
}

function resolveApiUrl(): string {
  if (
    typeof window !== "undefined" &&
    typeof window.__BRIDGE_API_URL__ === "string" &&
    window.__BRIDGE_API_URL__.length > 0
  ) {
    return window.__BRIDGE_API_URL__;
  }
  const configured =
    typeof import.meta.env === "object"
      ? import.meta.env.VITE_API_URL?.trim()
      : undefined;
  if (configured) return configured;
  return typeof import.meta.env === "object" && import.meta.env.DEV
    ? "http://localhost:4000"
    : "";
}

export const API_URL = resolveApiUrl();

let recoveryState: ApiRecoveryState = "idle";
const recoveryListeners = new Set<() => void>();
const bridgeApiTransport = createApiTransport({
  apiUrl: API_URL,
  onStateChange(next) {
    recoveryState = next;
    for (const listener of recoveryListeners) listener();
  },
});

export const apiFetch = bridgeApiTransport.fetch;
export const apiQueryFetch = bridgeApiTransport.fetchReplaySafe;
export function getApiRecoveryState(): ApiRecoveryState {
  return recoveryState;
}
export function subscribeApiRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
