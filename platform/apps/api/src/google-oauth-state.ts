import { createHash } from "node:crypto";

const NAMESPACE = "google.oauth-state.v1";
const VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface AtomicStatePort {
  update<T>(
    workspaceId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T>;
}

interface PendingOAuthState {
  integrationId: string;
  actorId: string;
  expiresAt: string;
}

interface OAuthStateAggregate {
  version: 1;
  pending: Record<string, PendingOAuthState>;
}

function emptyState(): OAuthStateAggregate {
  return { version: VERSION, pending: {} };
}

function parseState(value: unknown): OAuthStateAggregate {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== VERSION ||
    !("pending" in value) ||
    typeof value.pending !== "object" ||
    value.pending === null ||
    Array.isArray(value.pending)
  ) {
    throw new Error("Google OAuth state storage is invalid or unsupported");
  }
  return value as OAuthStateAggregate;
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export class GoogleOAuthStateStore {
  constructor(
    private readonly state: AtomicStatePort,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  async issue(
    workspaceId: string,
    integrationId: string,
    actorId: string,
  ): Promise<string> {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const raw = `oauth_${Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
    const hash = stateHash(raw);
    const now = this.now();
    await this.state.update(workspaceId, NAMESPACE, emptyState(), (current) => {
      const aggregate = parseState(current);
      for (const [key, pending] of Object.entries(aggregate.pending)) {
        if (Date.parse(pending.expiresAt) <= now) delete aggregate.pending[key];
      }
      aggregate.pending[hash] = {
        integrationId,
        actorId,
        expiresAt: new Date(now + this.ttlMs).toISOString(),
      };
      return { state: aggregate, result: undefined };
    });
    return raw;
  }

  async consume(
    workspaceId: string,
    raw: string,
  ): Promise<PendingOAuthState | null> {
    if (!/^oauth_[0-9a-f]{64}$/.test(raw)) return null;
    const hash = stateHash(raw);
    const now = this.now();
    return this.state.update(
      workspaceId,
      NAMESPACE,
      emptyState(),
      (current) => {
        const aggregate = parseState(current);
        const pending = aggregate.pending[hash];
        delete aggregate.pending[hash];
        for (const [key, candidate] of Object.entries(aggregate.pending)) {
          if (Date.parse(candidate.expiresAt) <= now) delete aggregate.pending[key];
        }
        return {
          state: aggregate,
          result:
            pending && Date.parse(pending.expiresAt) > now
              ? { ...pending }
              : null,
        };
      },
    );
  }
}
