/**
 * Typed tRPC client — the ONLY way this app talks to data. Every page routes reads/writes
 * through `appRouter`'s procedures, never a direct Supabase/localStorage read (that's the
 * prototype's pattern this app replaces — see docs/raw/frontend-migration-scoping.md).
 */
import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import type { AppRouter } from "@bridge/api";
import { SUPABASE_CONFIGURED, supabase } from "./supabase";
import { API_URL, apiFetch, apiQueryFetch } from "./api-transport";

/**
 * API URL resolution order (R-001 offline desktop):
 *  1. `window.__BRIDGE_API_URL__` — injected by the Tauri shell's window
 *     initialization script, pointing at the managed API sidecar it spawned
 *     on a free localhost port. Runs before this module evaluates.
 *  2. `VITE_API_URL` — build-time env (browser deploys, dev).
 *  3. localhost:4000 only in an explicit Vite development build.
 */
export const API_TRANSPORT_CONFIGURED = Boolean(API_URL);
export { API_URL };

export async function trpcAuthorizationHeaders(): Promise<Record<string, string>> {
  if (!API_TRANSPORT_CONFIGURED) {
    throw new Error("Bridge API transport is not configured");
  }
  let token: string | undefined;
  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(`Could not read the authenticated Supabase session: ${error.message}`);
    }
    token = data.session?.access_token;
  }
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(typeof window !== "undefined" && window.__BRIDGE_SIDECAR_TOKEN__
      ? { "x-bridge-sidecar-token": window.__BRIDGE_SIDECAR_TOKEN__ }
      : {}),
  };
}

function createHttpBatchLink(fetchImpl: typeof apiFetch) {
  return httpBatchLink<AppRouter>({
    url: API_TRANSPORT_CONFIGURED
      ? `${API_URL}/trpc`
      : "http://bridge-api.invalid/trpc",
    methodOverride: "POST",
    headers: trpcAuthorizationHeaders,
    fetch: async (input, init) => {
      if (!API_TRANSPORT_CONFIGURED) {
        throw new Error("Bridge API transport is not configured");
      }
      return fetchImpl(input, init);
    },
  });
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (operation) => operation.type === "query",
      true: createHttpBatchLink(apiQueryFetch),
      false: createHttpBatchLink(apiFetch),
    }),
  ],
});

// Real pilot identity — this app is single-tenant until Phase 5 (see decisions-log.md
// 2026-07-05 "single-tenant safety net"). Every organization-scoped call uses this id; the
// server rejects any other with FORBIDDEN.
export const PILOT_ORGANIZATION = "b0000000-0000-4000-a000-000000000001";
