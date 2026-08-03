/**
 * Google OAuth redirect handling — a plain Fastify GET (the consent redirect can't
 * be a tRPC POST). Exchanges the authorization code for tokens and persists them to
 * the LOCAL plane (never Supabase), then returns the user to the active client.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { SystemClock } from "@bridge/core";
import { exchangeCode, tokenRecordFrom } from "@bridge/integrations-google";
import { renderWebOrigin } from "./deployment-boundary.js";
import type { Wiring } from "./wiring.js";

type OAuthCallbackResult =
  | { connected: true }
  | { connected: false; error: string };

/** `renderWebOrigin` throws on a malformed host; a bad value must not take down the
 * OAuth callback, so it degrades to the next fallback instead. */
function safeRenderWebOrigin(): string | null {
  try {
    return renderWebOrigin();
  } catch {
    return null;
  }
}

function finishOAuth(
  reply: FastifyReply,
  result: OAuthCallbackResult,
): FastifyReply {
  if (process.env.BRIDGE_OAUTH_DESKTOP === "1") {
    const title = result.connected
      ? "Google connected"
      : "Google connection not completed";
    const message = result.connected
      ? "Your Google authorization is stored in the Bridge Local Plane. Return to Bridge to continue."
      : "Bridge could not complete the Google connection. Return to Bridge and try again.";
    return reply
      .code(result.connected ? 200 : 400)
      .header("Cache-Control", "no-store")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      )
      .header("X-Content-Type-Options", "nosniff")
      .type("text/html; charset=utf-8")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:0 1.5rem;color:#17233d}h1{font-size:1.5rem}</style><main><h1>${title}</h1><p>${message}</p></main></html>`,
      );
  }
  // Deployed OAuth callbacks must land back on the DEPLOYED web app. `BRIDGE_APP_URL`
  // is set nowhere (not in render.yaml, any .env, or CI), so this previously fell
  // straight through to localhost and every hosted Google connect redirected the
  // user to their own machine. `renderWebOrigin()` derives the real origin from
  // `BRIDGE_RENDER_WEB_HOST`, which IS set in render.yaml and already backs the CORS
  // allow-list — so the deployed origin is now the fallback, and localhost is only
  // reached when neither is configured (i.e. genuine local dev).
  const appUrl =
    process.env.BRIDGE_APP_URL ?? safeRenderWebOrigin() ?? "http://localhost:5173";
  return result.connected
    ? reply.redirect(`${appUrl}/integration/google?connected=1`)
    : reply.redirect(
        `${appUrl}/integration/google?error=${encodeURIComponent(result.error)}`,
      );
}

export async function registerGoogleOAuthRoutes(
  app: FastifyInstance,
  wiring: Wiring,
  exchangeAuthorizationCode: typeof exchangeCode = exchangeCode,
): Promise<void> {
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/integrations/google/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (wiring.publicCloudOnly) {
        return finishOAuth(reply, {
          connected: false,
          error: "desktop_local_plane_required",
        });
      }
      if (!wiring.googleOAuth) {
        return finishOAuth(reply, {
          connected: false,
          error: "oauth_not_configured",
        });
      }
      if (!state) {
        return finishOAuth(reply, {
          connected: false,
          error: "missing_oauth_state",
        });
      }
      const organizationId = wiring.google.integrationId.split(":")[0] ?? "";
      const pending = await wiring.googleOAuthStates.consume(organizationId, state);
      if (!pending) {
        return finishOAuth(reply, {
          connected: false,
          error: "invalid_oauth_state",
        });
      }
      if (error) {
        return finishOAuth(reply, { connected: false, error });
      }
      if (!code) {
        return finishOAuth(reply, { connected: false, error: "missing_code" });
      }

      try {
        const integrationId = pending.integrationId;
        if (
          integrationId !== wiring.google.integrationId ||
          !(await wiring.organizationStore.isMember(organizationId, pending.actorId))
        ) {
          return finishOAuth(reply, {
            connected: false,
            error: "oauth_actor_not_authorized",
          });
        }
        const tokens = await exchangeAuthorizationCode(
          wiring.googleOAuth,
          code,
          pending.codeVerifier,
        );
        const nowISO = new SystemClock().nowISO();
        const tokenRecord = tokenRecordFrom(
          integrationId,
          organizationId,
          tokens,
          nowISO,
        );
        if (
          !(await wiring.localPlane.secrets.finalizeToken(tokenRecord, () =>
            wiring.organizationStore.isMember(organizationId, pending.actorId),
          ))
        ) {
          return finishOAuth(reply, {
            connected: false,
            error: "oauth_actor_not_authorized",
          });
        }
        return finishOAuth(reply, { connected: true });
      } catch (e) {
        app.log.error({ err: e }, "google oauth callback failed");
        return finishOAuth(reply, {
          connected: false,
          error: "token_exchange_failed",
        });
      }
    },
  );
}
