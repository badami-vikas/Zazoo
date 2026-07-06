/**
 * Credential broker — docs/wiki/vision.md: "capability requests need ->
 * governance grants temp scoped access. NEVER owns secrets (resolves user Q8
 * contradiction)." A capability never receives a raw secret/token; it asks the
 * broker for a grant, and the broker (backed by the existing `ephemeral_grants`
 * concept — see ports.ts's `EphemeralQuery`/schema.ts's `ephemeralGrants`)
 * returns an opaque grant REFERENCE the capability can present back to the
 * actual connector/tool at call time. The connector (already the sole owner of
 * real credentials per ADR-006 "tools never own OAuth") resolves that
 * reference into the credential itself — the broker and the capability both
 * stay blind to the secret.
 */

/** An opaque, time-boxed grant reference — never the credential itself. */
export interface CredentialGrantRef {
  grantId: string;
  capabilityId: string;
  connector: string;
  scopes: string[];
  expiresAtISO: string;
}

export interface CredentialBroker {
  /**
   * Request a scoped, time-boxed grant for a capability to use a connector.
   * Returns a REFERENCE (grantId) only — never a secret/token. The connector
   * itself resolves the reference into a real credential at call time,
   * through its own existing (tools-never-own-OAuth) credential store.
   */
  requestGrant(
    capabilityId: string,
    connector: string,
    scopes: string[],
    ttlSeconds: number,
  ): Promise<CredentialGrantRef>;

  /** Revoke a grant before its natural expiry (e.g. on suspend). */
  revokeGrant(grantId: string): Promise<void>;

  /** Whether a grant reference is still live (unexpired, unrevoked). Connectors
   * check this before honoring a presented grantId. */
  isActive(grantId: string, nowISO: string): Promise<boolean>;
}

/**
 * In-memory `CredentialBroker` — dev/test default, delegating to the same
 * ephemeral-grant shape `InMemoryEphemeralStore` (memory/stores.ts) uses for
 * the governance spine's ephemeral grants, so both concepts stay consistent
 * even though this broker tracks connector-scoped grants rather than
 * resourceType/action authority grants. NEVER stores or returns a secret —
 * only the grant metadata below.
 */
export class InMemoryCredentialBroker implements CredentialBroker {
  readonly grants = new Map<
    string,
    { capabilityId: string; connector: string; scopes: string[]; expiresAtISO: string; revoked: boolean }
  >();
  #counter = 0;

  async requestGrant(
    capabilityId: string,
    connector: string,
    scopes: string[],
    ttlSeconds: number,
  ): Promise<CredentialGrantRef> {
    const grantId = `cgr_${++this.#counter}_${Math.random().toString(36).slice(2, 10)}`;
    const expiresAtISO = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.grants.set(grantId, { capabilityId, connector, scopes: [...scopes], expiresAtISO, revoked: false });
    return { grantId, capabilityId, connector, scopes: [...scopes], expiresAtISO };
  }

  async revokeGrant(grantId: string): Promise<void> {
    const g = this.grants.get(grantId);
    if (g) g.revoked = true;
  }

  async isActive(grantId: string, nowISO: string): Promise<boolean> {
    const g = this.grants.get(grantId);
    if (!g || g.revoked) return false;
    return Date.parse(g.expiresAtISO) > Date.parse(nowISO);
  }
}
