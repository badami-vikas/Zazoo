/**
 * Claude sign-in without a terminal — the same public OAuth PKCE flow
 * `claude login` performs, driven from Bridge's own UI so the user never sees
 * a shell. The browser window does the authenticating; the code the callback
 * page displays is pasted back into Bridge; the resulting tokens go straight
 * into the Local Plane credential vault (ADR-181's `SourceCredentialVault` —
 * OS keyring, or the AES-256-GCM encrypted file vault), never a file Bridge
 * writes itself, never Postgres, never a log line.
 *
 * Ported from the myzazoo reference implementation (`src/oauth.ts`) at the
 * user's direction, with three Bridge-specific changes: the token lives in the
 * governed vault rather than a bare keychain call, the verifier is held per
 * Organization rather than per process-global, and refresh failures surface as
 * a typed "needs sign-in" state the model menu can render instead of an
 * exception at send time.
 *
 * Residency: the token is a secret the user obtained interactively, so it is
 * Local Plane only, exactly like a model-provider API key. In public-cloud mode
 * the wired vault refuses every operation and this store fails closed with it.
 */
import { createHash, randomBytes } from "node:crypto";
import type {
  SourceCredentialScope,
  SourceCredentialVault,
} from "@bridge/dealpilot";

/** Claude Code's public OAuth client id — public by design (PKCE, no secret). */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const SCOPE = "org:create_api_key user:profile user:inference";

const NAMESPACE = "claude-code-oauth.v1";
const VERSION = 1;

function scopeFor(organizationId: string): SourceCredentialScope {
  return { organizationId, sourceId: "claude-code:oauth" };
}

interface StoredTokenRef {
  reference: string;
  updatedAt: string;
}

interface OAuthAggregate {
  version: 1;
  token?: StoredTokenRef;
}

interface AtomicStatePort {
  read(organizationId: string, namespace: string): Promise<unknown | null>;
  update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T>;
}

function parseState(value: unknown): OAuthAggregate {
  if (value == null) return { version: VERSION };
  if (
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== VERSION
  ) {
    throw new Error("Claude sign-in storage is invalid or unsupported");
  }
  return value as OAuthAggregate;
}

/** The token set as Bridge stores it — compact JSON in one vault field. */
interface TokenSet {
  access: string;
  refresh: string;
  /** Epoch millis. */
  expires: number;
}

export interface ClaudeSignInStatus {
  /** A token is stored for this Organization. Never the token itself. */
  signedIn: boolean;
  updatedAt?: string;
  /** True when `CLAUDE_CODE_OAUTH_TOKEN` is set in this process's environment,
   * which wins over anything stored — reported rather than silently shadowed. */
  fromEnvironment: boolean;
}

export class ClaudeOAuthStore {
  readonly #state: AtomicStatePort;
  readonly #vault: SourceCredentialVault;
  readonly #now: () => string;
  readonly #env: NodeJS.ProcessEnv;
  /** PKCE verifiers for logins currently in flight, keyed by Organization.
   * In-memory on purpose: a verifier outlives nothing but the browser round
   * trip, and persisting it would store a secret that has no reason to exist
   * after the exchange. A server restart mid-login means starting over. */
  readonly #pending = new Map<string, string>();

  constructor(deps: {
    state: AtomicStatePort;
    vault: SourceCredentialVault;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
  }) {
    this.#state = deps.state;
    this.#vault = deps.vault;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#env = deps.env ?? process.env;
  }

  async status(organizationId: string): Promise<ClaudeSignInStatus> {
    const aggregate = parseState(await this.#state.read(organizationId, NAMESPACE));
    return {
      signedIn: Boolean(aggregate.token),
      ...(aggregate.token ? { updatedAt: aggregate.token.updatedAt } : {}),
      fromEnvironment: Boolean(this.#env.CLAUDE_CODE_OAUTH_TOKEN?.trim()),
    };
  }

  /** Step 1 — the URL the UI opens in a browser window. */
  beginLogin(organizationId: string): string {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest().toString("base64url");
    this.#pending.set(organizationId, verifier);
    const params = new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Step 2 — the callback page shows `code#state`; the user pastes it back. */
  async finishLogin(organizationId: string, pasted: string): Promise<void> {
    const verifier = this.#pending.get(organizationId);
    if (!verifier) {
      throw new Error("Sign-in was not started — click Sign in with Claude first");
    }
    const [code, state] = pasted.trim().split("#");
    if (!code) throw new Error("Paste the code shown on the Claude callback page");
    const tokens = await this.#tokenRequest({
      grant_type: "authorization_code",
      code,
      state: state ?? verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    this.#pending.delete(organizationId);
    await this.#save(organizationId, tokens);
  }

  /**
   * A usable access token, or null when the user has not signed in. Refreshes
   * through the same endpoint when the stored one is within a minute of
   * expiry. The environment variable wins when set, matching how every other
   * credential in this codebase resolves.
   */
  async accessToken(organizationId: string): Promise<string | null> {
    const fromEnv = this.#env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (fromEnv) return fromEnv;

    const aggregate = parseState(await this.#state.read(organizationId, NAMESPACE));
    if (!aggregate.token) return null;
    const raw = await this.#vault.read(
      scopeFor(organizationId),
      aggregate.token.reference,
      "password",
    );
    if (!raw) return null;
    let tokens: TokenSet;
    try {
      tokens = JSON.parse(raw) as TokenSet;
    } catch {
      return null;
    }
    if (Date.now() <= tokens.expires - 60_000) return tokens.access;

    const refreshed = await this.#tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh,
      client_id: CLIENT_ID,
    });
    const saved = await this.#save(organizationId, refreshed);
    return saved.access;
  }

  async signOut(organizationId: string): Promise<void> {
    const aggregate = parseState(await this.#state.read(organizationId, NAMESPACE));
    if (!aggregate.token) return;
    await this.#vault.delete(scopeFor(organizationId), aggregate.token.reference);
    await this.#state.update<void>(
      organizationId,
      NAMESPACE,
      { version: VERSION },
      (current) => {
        const next = parseState(current);
        delete next.token;
        return { state: next, result: undefined };
      },
    );
  }

  async #tokenRequest(body: Record<string, string>): Promise<TokenSet> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The body can echo the code back; keep it out of the thrown message.
      throw new Error(`Claude sign-in failed (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      access: payload.access_token,
      refresh: payload.refresh_token,
      expires: Date.now() + payload.expires_in * 1000,
    };
  }

  /** Vault write first, reference second — a crash between them orphans an
   * invisible vault entry rather than publishing a reference to a secret that
   * was never stored. Same ordering rule as ModelProviderKeyStore.save. */
  async #save(organizationId: string, tokens: TokenSet): Promise<TokenSet> {
    const scope = scopeFor(organizationId);
    const reference = await this.#vault.put(scope, {
      password: JSON.stringify(tokens),
    });
    const previous = await this.#state.update<string | null>(
      organizationId,
      NAMESPACE,
      { version: VERSION },
      (current) => {
        const next = parseState(current);
        const prior = next.token?.reference ?? null;
        next.token = { reference, updatedAt: this.#now() };
        return { state: next, result: prior };
      },
    );
    if (previous && previous !== reference) {
      await this.#vault.delete(scope, previous).catch(() => {
        // An undeletable stale entry is not worth failing a successful sign-in.
      });
    }
    return tokens;
  }
}
