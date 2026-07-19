/**
 * In-memory LOCAL-plane adapters. Zero infra — used by tests and the zero-infra
 * dev build. The pglite adapters (stores/pglite.ts) bind the same ports for the
 * real, persisted local tier.
 */
import type {
  BodyStore,
  ExternalRecordRow,
  LocalEntityRecord,
  LocalGraphStore,
  LocalPerson,
  LocalPlane,
  LocalStateMutation,
  LocalStateStore,
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";

export class InMemorySecretStore implements SecretStore {
  readonly tokens = new Map<string, OAuthTokenRecord>();
  readonly #tails = new Map<string, Promise<void>>();

  async putToken(rec: OAuthTokenRecord): Promise<void> {
    await this.#exclusive(rec.integrationId, async () => {
      const prior = this.tokens.get(rec.integrationId);
      this.tokens.set(rec.integrationId, {
        ...rec,
        ...(rec.refreshToken
          ? {}
          : prior?.refreshToken
            ? { refreshToken: prior.refreshToken }
            : {}),
      });
    });
  }

  async getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    return this.#exclusive(integrationId, async () => {
      const token = this.tokens.get(integrationId);
      return token ? { ...token } : null;
    });
  }

  async deleteToken(integrationId: string): Promise<void> {
    await this.#exclusive(integrationId, async () => {
      this.tokens.delete(integrationId);
    });
  }

  async compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): Promise<boolean> {
    return this.#exclusive(integrationId, async () =>
      this.#compareAndSwapToken(integrationId, expected, replacement),
    );
  }

  async finalizeToken(
    replacement: OAuthTokenRecord,
    stillAuthorized: () => Promise<boolean>,
  ): Promise<boolean> {
    return this.#exclusive(replacement.integrationId, async () => {
      if (!(await stillAuthorized())) return false;
      const previous = this.tokens.get(replacement.integrationId) ?? null;
      const candidate = {
        ...replacement,
        ...(replacement.refreshToken
          ? {}
          : previous?.refreshToken
            ? { refreshToken: previous.refreshToken }
            : {}),
      };
      this.tokens.set(replacement.integrationId, { ...candidate });
      try {
        if (await stillAuthorized()) return true;
      } catch (error) {
        this.#restoreToken(replacement.integrationId, previous);
        throw error;
      }
      this.#restoreToken(replacement.integrationId, previous);
      return false;
    });
  }

  #compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): boolean {
    const current = this.tokens.get(integrationId) ?? null;
    if (!sameToken(current, expected)) return false;
    if (replacement) this.tokens.set(integrationId, { ...replacement });
    else this.tokens.delete(integrationId);
    return true;
  }

  #restoreToken(
    integrationId: string,
    previous: OAuthTokenRecord | null,
  ): void {
    if (previous) this.tokens.set(integrationId, { ...previous });
    else this.tokens.delete(integrationId);
  }

  async #exclusive<T>(
    integrationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#tails.get(integrationId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(integrationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(integrationId) === tail) {
        this.#tails.delete(integrationId);
      }
    }
  }
}

function sameToken(
  left: OAuthTokenRecord | null,
  right: OAuthTokenRecord | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.integrationId === right.integrationId &&
    left.workspaceId === right.workspaceId &&
    left.provider === right.provider &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.scope === right.scope &&
    left.tokenType === right.tokenType &&
    left.expiryDate === right.expiryDate &&
    left.updatedAt === right.updatedAt
  );
}

function bodyKey(workspaceId: string, source: string, sourceRecordId: string): string {
  return `${workspaceId}::${source}::${sourceRecordId}`;
}

export class InMemoryBodyStore implements BodyStore {
  readonly bodies = new Map<string, StoredBody>();
  async put(body: StoredBody): Promise<void> {
    this.bodies.set(bodyKey(body.workspaceId, body.source, body.sourceRecordId), { ...body });
  }
  async get(workspaceId: string, source: string, sourceRecordId: string): Promise<StoredBody | null> {
    return this.bodies.get(bodyKey(workspaceId, source, sourceRecordId)) ?? null;
  }
  async list(workspaceId: string, source: string): Promise<StoredBody[]> {
    return [...this.bodies.values()].filter((b) => b.workspaceId === workspaceId && b.source === source);
  }
}

export class InMemoryLocalGraphStore implements LocalGraphStore {
  readonly people: LocalPerson[] = [];
  readonly entities: LocalEntityRecord[] = [];
  readonly external: ExternalRecordRow[] = [];
  readonly cursors = new Map<string, string>();

  async findPeopleByEmail(workspaceId: string, email: string): Promise<LocalPerson[]> {
    const needle = email.trim().toLowerCase();
    return this.people.filter(
      (p) => p.workspaceId === workspaceId && p.emails.some((e) => e.trim().toLowerCase() === needle),
    );
  }
  async upsertPerson(person: LocalPerson): Promise<void> {
    const idx = this.people.findIndex((p) => p.id === person.id);
    if (idx >= 0) this.people[idx] = { ...person };
    else this.people.push({ ...person });
  }
  async listPeople(workspaceId: string): Promise<LocalPerson[]> {
    return this.people.filter((p) => p.workspaceId === workspaceId);
  }
  async commitEntity(entry: LocalEntityRecord): Promise<void> {
    // Idempotent: a retry after a partial dual-write failure re-commits the same
    // deterministic id — that must be a silent no-op (mirrors recordExternal below).
    if (this.entities.some((e) => e.id === entry.id)) return;
    this.entities.push({ ...entry });
  }
  async listEntities(workspaceId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]> {
    return this.entities.filter((e) => e.workspaceId === workspaceId && (kind ? e.kind === kind : true));
  }
  async recordExternal(row: ExternalRecordRow): Promise<void> {
    if (await this.hasExternal(row.workspaceId, row.source, row.sourceRecordId)) return;
    this.external.push({ ...row });
  }
  async hasExternal(workspaceId: string, source: string, sourceRecordId: string): Promise<boolean> {
    return this.external.some(
      (r) => r.workspaceId === workspaceId && r.source === source && r.sourceRecordId === sourceRecordId,
    );
  }
  async getSyncCursor(integrationId: string, source: string): Promise<string | null> {
    return this.cursors.get(`${integrationId}::${source}`) ?? null;
  }
  async setSyncCursor(integrationId: string, source: string, cursor: string): Promise<void> {
    this.cursors.set(`${integrationId}::${source}`, cursor);
  }
}

function stateKey(workspaceId: string, namespace: string): string {
  return `${workspaceId}::${namespace}`;
}

export class InMemoryLocalStateStore implements LocalStateStore {
  readonly rows = new Map<string, unknown>();
  readonly #tails = new Map<string, Promise<void>>();

  async read(workspaceId: string, namespace: string): Promise<unknown | null> {
    const value = this.rows.get(stateKey(workspaceId, namespace));
    return value === undefined ? null : structuredClone(value);
  }

  async update<T>(
    workspaceId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => LocalStateMutation<T>,
  ): Promise<T> {
    const key = stateKey(workspaceId, namespace);
    return this.#exclusive(key, async () => {
      const current = this.rows.has(key) ? this.rows.get(key) : initialState;
      const mutation = reduce(structuredClone(current));
      this.rows.set(key, structuredClone(mutation.state));
      return mutation.result;
    });
  }

  async #exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

/** Assemble an in-memory LocalPlane (tests / zero-infra dev). */
export function createMemoryLocalPlane(): LocalPlane {
  return {
    secrets: new InMemorySecretStore(),
    bodies: new InMemoryBodyStore(),
    graph: new InMemoryLocalGraphStore(),
    state: new InMemoryLocalStateStore(),
    close: async () => {},
  };
}
