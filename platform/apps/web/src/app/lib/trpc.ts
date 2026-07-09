/**
 * Typed tRPC client — the ONLY way this app talks to data. Every page routes reads/writes
 * through `appRouter`'s procedures, never a direct Supabase/localStorage read (that's the
 * prototype's pattern this app replaces — see docs/raw/frontend-migration-scoping.md).
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@bridge/api";

/**
 * API URL resolution order (R-001 offline desktop):
 *  1. `window.__BRIDGE_API_URL__` — injected by the Tauri shell's window
 *     initialization script, pointing at the managed API sidecar it spawned
 *     on a free localhost port. Runs before this module evaluates.
 *  2. `VITE_API_URL` — build-time env (browser deploys, dev).
 *  3. localhost:4000 — the API's dev default.
 */
const API_URL =
  (typeof window !== "undefined" && window.__BRIDGE_API_URL__) ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:4000";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});

// Real pilot identity — this app is single-tenant until Phase 5 (see decisions-log.md
// 2026-07-05 "single-tenant safety net"). Every workspace-scoped call uses this id; the
// server rejects any other with FORBIDDEN.
export const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
