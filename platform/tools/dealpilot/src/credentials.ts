export type CredentialField = "userId" | "password";
export type CredentialAccessAction = "reveal" | "copy" | "revoke";
export type CredentialAuditField = CredentialField | "credential";

export interface SourceCredential {
  userId?: string;
  password?: string;
}

export interface CredentialMetadata {
  userId: { state: "unavailable" | "available"; masked?: string };
  password: { state: "unavailable" | "available"; masked?: string };
}

export interface SourceCredentialScope {
  workspaceId: string;
  sourceId: string;
}

export interface SourceCredentialVault {
  reserve(scope: SourceCredentialScope): string;
  write(
    scope: SourceCredentialScope,
    reference: string,
    credential: SourceCredential,
  ): Promise<void>;
  put(scope: SourceCredentialScope, credential: SourceCredential): Promise<string>;
  metadata(scope: SourceCredentialScope, reference: string): Promise<CredentialMetadata | null>;
  read(
    scope: SourceCredentialScope,
    reference: string,
    field: CredentialField,
  ): Promise<string | null>;
  delete(scope: SourceCredentialScope, reference: string): Promise<void>;
}

function maskUserId(value: string): string {
  const at = value.indexOf("@");
  if (at > 1) return `${value[0]}${"*".repeat(Math.min(6, at - 1))}${value.slice(at)}`;
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value[0]}${"*".repeat(Math.min(6, value.length - 2))}${value[value.length - 1]}`;
}

export function metadataForCredential(credential: SourceCredential): CredentialMetadata {
  return {
    userId: credential.userId
      ? { state: "available", masked: maskUserId(credential.userId) }
      : { state: "unavailable" },
    password: credential.password
      ? { state: "available", masked: "********" }
      : { state: "unavailable" },
  };
}

export class InMemorySourceCredentialVault implements SourceCredentialVault {
  readonly entries = new Map<string, SourceCredential>();

  reserve(scope: SourceCredentialScope): string {
    return `memory-test://dealpilot/${encodeURIComponent(scope.workspaceId)}/${encodeURIComponent(scope.sourceId)}/${globalThis.crypto.randomUUID()}`;
  }

  async write(
    scope: SourceCredentialScope,
    reference: string,
    credential: SourceCredential,
  ): Promise<void> {
    this.#assertScope(scope, reference);
    this.entries.set(reference, { ...credential });
  }

  async put(scope: SourceCredentialScope, credential: SourceCredential): Promise<string> {
    const reference = this.reserve(scope);
    await this.write(scope, reference, credential);
    return reference;
  }

  async metadata(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<CredentialMetadata | null> {
    this.#assertScope(scope, reference);
    const credential = this.entries.get(reference);
    if (!credential) return null;
    return metadataForCredential(credential);
  }

  async read(
    scope: SourceCredentialScope,
    reference: string,
    field: CredentialField,
  ): Promise<string | null> {
    await this.metadata(scope, reference);
    return this.entries.get(reference)?.[field] ?? null;
  }

  async delete(scope: SourceCredentialScope, reference: string): Promise<void> {
    await this.metadata(scope, reference);
    this.entries.delete(reference);
  }

  #assertScope(scope: SourceCredentialScope, reference: string): void {
    let parsed: URL;
    try {
      parsed = new URL(reference);
    } catch {
      throw new Error("Credential reference is invalid");
    }
    const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (
      parsed.protocol !== "memory-test:" ||
      parsed.hostname !== "dealpilot" ||
      parts.length !== 3 ||
      parts[0] !== scope.workspaceId ||
      parts[1] !== scope.sourceId
    ) {
      throw new Error(
        "Credential reference is outside the requested Organization or Source",
      );
    }
  }
}

export interface CredentialAuditEvent {
  workspaceId: string;
  sourceId: string;
  actorId: string;
  action: CredentialAccessAction;
  field: CredentialAuditField;
  occurredAt: string;
}

export interface CredentialAuditSink {
  append(event: CredentialAuditEvent): Promise<void>;
}

export class InMemoryCredentialAuditSink implements CredentialAuditSink {
  readonly events: CredentialAuditEvent[] = [];
  async append(event: CredentialAuditEvent): Promise<void> {
    this.events.push({ ...event });
  }
}

interface ReauthSession {
  token: string;
  actorId: string;
  workspaceId: string;
  sourceId: string;
  expiresAt: string;
}

export class CredentialAccessError extends Error {
  constructor(
    readonly code:
      | "human_required"
      | "reauthentication_required"
      | "reauthentication_expired"
      | "credential_locked"
      | "credential_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "CredentialAccessError";
  }
}

export class HumanReauthentication {
  readonly sessions = new Map<string, ReauthSession>();
  #now: () => number;
  #ttlMs: number;

  constructor(deps?: { now?: () => number; ttlMs?: number }) {
    this.#now = deps?.now ?? (() => Date.now());
    this.#ttlMs = deps?.ttlMs ?? 2 * 60 * 1000;
  }

  issue(input: {
    actorType: "user" | "team" | "agent";
    actorId: string;
    workspaceId: string;
    sourceId: string;
    reauthenticatedAt?: number;
  }): { token: string; expiresAt: string } {
    if (input.actorType !== "user") {
      throw new CredentialAccessError("human_required", "Only an authenticated Human can access a Source credential");
    }
    if (
      input.reauthenticatedAt == null ||
      input.reauthenticatedAt > this.#now() ||
      this.#now() - input.reauthenticatedAt > 5 * 60 * 1000
    ) {
      throw new CredentialAccessError(
        "reauthentication_required",
        "A cryptographically verified application or OS re-authentication from the last five minutes is required",
      );
    }
    for (const [token, session] of this.sessions) {
      if (
        Date.parse(session.expiresAt) <= this.#now() ||
        (session.actorId === input.actorId &&
          session.workspaceId === input.workspaceId &&
          session.sourceId === input.sourceId)
      ) {
        this.sessions.delete(token);
      }
    }
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const token = `reauth_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const expiresAt = new Date(this.#now() + this.#ttlMs).toISOString();
    this.sessions.set(token, {
      token,
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  assert(token: string, actorId: string, workspaceId: string, sourceId: string): void {
    const session = this.sessions.get(token);
    if (
      !session ||
      session.actorId !== actorId ||
      session.workspaceId !== workspaceId ||
      session.sourceId !== sourceId
    ) {
      throw new CredentialAccessError("reauthentication_required", "A matching re-authentication session is required");
    }
    if (Date.parse(session.expiresAt) <= this.#now()) {
      this.sessions.delete(token);
      throw new CredentialAccessError("reauthentication_expired", "The re-authentication session expired");
    }
  }

  consume(token: string, actorId: string, workspaceId: string, sourceId: string): void {
    const session = this.sessions.get(token);
    if (!session) return;
    if (
      session.actorId !== actorId ||
      session.workspaceId !== workspaceId ||
      session.sourceId !== sourceId
    ) {
      throw new CredentialAccessError(
        "reauthentication_required",
        "A matching re-authentication session is required",
      );
    }
    this.sessions.delete(token);
  }
}

export class SourceCredentialService {
  constructor(
    private readonly vault: SourceCredentialVault,
    private readonly reauthentication: HumanReauthentication,
    private readonly audit: CredentialAuditSink,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async project(
    scope: SourceCredentialScope,
    reference: string | undefined,
  ): Promise<CredentialMetadata> {
    if (!reference) {
      return { userId: { state: "unavailable" }, password: { state: "unavailable" } };
    }
    return (
      (await this.vault.metadata(scope, reference)) ?? {
        userId: { state: "unavailable" },
        password: { state: "unavailable" },
      }
    );
  }

  reauthenticate(input: {
    actorType: "user" | "team" | "agent";
    actorId: string;
    workspaceId: string;
    sourceId: string;
    reauthenticatedAt?: number;
  }): { token: string; expiresAt: string } {
    return this.reauthentication.issue(input);
  }

  async access(input: {
    reference: string | undefined;
    workspaceId: string;
    sourceId: string;
    actorType: "user" | "team" | "agent";
    actorId: string;
    token: string;
    field: CredentialField;
    action: CredentialAccessAction;
  }): Promise<{ value: string; expiresAt: string }> {
    if (input.actorType !== "user") {
      throw new CredentialAccessError("human_required", "Agents, Automations, and teams cannot access raw credentials");
    }
    this.reauthentication.assert(
      input.token,
      input.actorId,
      input.workspaceId,
      input.sourceId,
    );
    if (!input.reference) {
      throw new CredentialAccessError("credential_unavailable", "This Source has no credential reference");
    }
    const value = await this.vault.read(
      { workspaceId: input.workspaceId, sourceId: input.sourceId },
      input.reference,
      input.field,
    );
    if (value == null) {
      throw new CredentialAccessError("credential_locked", `The ${input.field} credential is unavailable or locked`);
    }
    await this.audit.append({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorId: input.actorId,
      action: input.action,
      field: input.field,
      occurredAt: this.now(),
    });
    return { value, expiresAt: new Date(Date.parse(this.now()) + 30_000).toISOString() };
  }

  async revokeCredential(input: {
    reference: string | undefined;
    workspaceId: string;
    sourceId: string;
    actorType: "user" | "team" | "agent";
    actorId: string;
    token: string;
  }): Promise<CredentialAuditEvent> {
    const reference = input.reference;
    if (!reference) {
      throw new CredentialAccessError(
        "credential_unavailable",
        "This Source has no credential reference",
      );
    }
    const audit = this.authorizeCredentialRevocation(input);
    await this.vault.delete(
      { workspaceId: input.workspaceId, sourceId: input.sourceId },
      reference,
    );
    return audit;
  }

  authorizeCredentialRevocation(input: {
    reference: string | undefined;
    workspaceId: string;
    sourceId: string;
    actorType: "user" | "team" | "agent";
    actorId: string;
    token: string;
  }): CredentialAuditEvent {
    if (input.actorType !== "user") {
      throw new CredentialAccessError(
        "human_required",
        "Agents, Automations, and teams cannot revoke raw credentials",
      );
    }
    this.reauthentication.assert(
      input.token,
      input.actorId,
      input.workspaceId,
      input.sourceId,
    );
    if (!input.reference) {
      throw new CredentialAccessError(
        "credential_unavailable",
        "This Source has no credential reference",
      );
    }
    this.reauthentication.consume(
      input.token,
      input.actorId,
      input.workspaceId,
      input.sourceId,
    );
    return {
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorId: input.actorId,
      action: "revoke",
      field: "credential",
      occurredAt: this.now(),
    };
  }
}
