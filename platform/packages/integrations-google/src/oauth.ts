/**
 * Google OAuth2 — borrowed, not hand-rolled (googleapis / google-auth-library).
 *
 * Read AND write scopes, offline access + consent prompt → a long-lived refresh
 * token. Tokens are persisted to the LOCAL SecretStore (@bridge/local), never to
 * cloud canonical. No third-party connector SaaS is in the path — Bridge talks to
 * Google directly.
 */
import { google, type Auth } from "googleapis";
import type { OAuthTokenRecord } from "@bridge/local";
import { GOOGLE_SCOPES } from "./contracts.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Read OAuth config from env. Returns null if not configured (fake-gateway path). */
export function oauthConfigFromEnv(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/integrations/google/callback";
  return { clientId, clientSecret, redirectUri };
}

export function buildOAuthClient(cfg: GoogleOAuthConfig): Auth.OAuth2Client {
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

/** The Google consent URL. `state` carries our integration id (CSRF + routing). */
export function authUrl(cfg: GoogleOAuthConfig, state: string): string {
  const client = buildOAuthClient(cfg);
  return client.generateAuthUrl({
    access_type: "offline", // refresh token
    prompt: "consent", // force refresh-token issuance
    scope: [...GOOGLE_SCOPES],
    include_granted_scopes: true,
    state,
  });
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  tokenType: string;
  expiryDate?: number;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(cfg: GoogleOAuthConfig, code: string): Promise<ExchangedTokens> {
  const client = buildOAuthClient(cfg);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("oauth: no access_token in token response");
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
    tokenType: tokens.token_type ?? "Bearer",
    ...(tokens.expiry_date ? { expiryDate: tokens.expiry_date } : {}),
  };
}

/** Build an authenticated OAuth client from a stored token record. */
export function clientFromToken(cfg: GoogleOAuthConfig, token: OAuthTokenRecord): Auth.OAuth2Client {
  const client = buildOAuthClient(cfg);
  client.setCredentials({
    access_token: token.accessToken,
    ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
    ...(token.expiryDate ? { expiry_date: token.expiryDate } : {}),
    token_type: token.tokenType,
    scope: token.scope,
  });
  return client;
}

export function tokenRecordFrom(
  integrationId: string,
  workspaceId: string,
  tokens: ExchangedTokens,
  nowISO: string,
): OAuthTokenRecord {
  return {
    integrationId,
    workspaceId,
    provider: "google",
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    ...(tokens.expiryDate ? { expiryDate: tokens.expiryDate } : {}),
    updatedAt: nowISO,
  };
}
