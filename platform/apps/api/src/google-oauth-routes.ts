/**
 * Google OAuth redirect handling — a plain Fastify GET (the consent redirect can't
 * be a tRPC POST). Exchanges the authorization code for tokens and persists them to
 * the LOCAL plane (never Supabase), then bounces the user back to the prototype.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { SystemClock } from "@bridge/core";
import { exchangeCode, tokenRecordFrom } from "@bridge/integrations-google";
import type { Wiring } from "./wiring.js";

const APP_URL = process.env.BRIDGE_APP_URL ?? "http://localhost:5173";
const STATE_TTL_MS = 10 * 60 * 1_000;
const MAX_PENDING_STATES = 1_000;
const pendingStates = new Map<
  string,
  { integrationId: string; ownerUserId: string; expiresAt: number }
>();

export function issueGoogleOAuthState(
  integrationId: string,
  ownerUserId: string,
  now = Date.now(),
): string {
  for (const [state, record] of pendingStates) {
    if (record.expiresAt <= now) pendingStates.delete(state);
  }
  if (pendingStates.size >= MAX_PENDING_STATES) {
    throw new Error("Too many Google OAuth connections are awaiting completion");
  }
  const state = randomUUID();
  pendingStates.set(state, {
    integrationId,
    ownerUserId,
    expiresAt: now + STATE_TTL_MS,
  });
  return state;
}

function consumeGoogleOAuthState(
  state: string,
  expectedIntegrationId: string,
  expectedOwnerUserId: string,
  now = Date.now(),
): string | null {
  const record = pendingStates.get(state);
  pendingStates.delete(state);
  if (
    !record ||
    record.expiresAt <= now ||
    record.integrationId !== expectedIntegrationId ||
    record.ownerUserId !== expectedOwnerUserId
  ) {
    return null;
  }
  return record.integrationId;
}

export async function registerGoogleOAuthRoutes(app: FastifyInstance, wiring: Wiring): Promise<void> {
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/integrations/google/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return reply.redirect(`${APP_URL}/integration/google?error=${encodeURIComponent(error)}`);
      if (!wiring.googleOAuth) {
        return reply.redirect(`${APP_URL}/integration/google?error=oauth_not_configured`);
      }
      if (!code || !state) {
        return reply.redirect(`${APP_URL}/integration/google?error=missing_code_or_state`);
      }

      try {
        const integrationId = consumeGoogleOAuthState(
          state,
          wiring.google.integrationId,
          wiring.google.ownerUserId,
        );
        if (!integrationId) {
          return reply.redirect(`${APP_URL}/integration/google?error=invalid_state`);
        }
        const workspaceId = integrationId.split(":")[0] ?? "";
        const tokens = await exchangeCode(wiring.googleOAuth, code);
        const nowISO = new SystemClock().nowISO();
        await wiring.localPlane.secrets.putToken(
          tokenRecordFrom(integrationId, workspaceId, tokens, nowISO),
        );
        return reply.redirect(`${APP_URL}/integration/google?connected=1`);
      } catch (e) {
        app.log.error({ err: e }, "google oauth callback failed");
        return reply.redirect(`${APP_URL}/integration/google?error=token_exchange_failed`);
      }
    },
  );
}
