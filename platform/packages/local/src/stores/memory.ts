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
  LocalMessage,
  LocalMessageSearchCapabilities,
  LocalMessageSearchHit,
  LocalMessageSearchQuery,
  LocalPerson,
  LocalPersonList,
  LocalPlane,
  LocalStateMutation,
  LocalStateStore,
  LocalThreadActivity,
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";
import { assertMessageShape } from "../messages.js";

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
    left.organizationId === right.organizationId &&
    left.provider === right.provider &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.scope === right.scope &&
    left.tokenType === right.tokenType &&
    left.expiryDate === right.expiryDate &&
    left.updatedAt === right.updatedAt
  );
}

function bodyKey(organizationId: string, source: string, sourceRecordId: string): string {
  return `${organizationId}::${source}::${sourceRecordId}`;
}

export class InMemoryBodyStore implements BodyStore {
  readonly bodies = new Map<string, StoredBody>();
  async put(body: StoredBody): Promise<void> {
    this.bodies.set(bodyKey(body.organizationId, body.source, body.sourceRecordId), { ...body });
  }
  async get(organizationId: string, source: string, sourceRecordId: string): Promise<StoredBody | null> {
    return this.bodies.get(bodyKey(organizationId, source, sourceRecordId)) ?? null;
  }
  async list(organizationId: string, source: string): Promise<StoredBody[]> {
    return [...this.bodies.values()].filter((b) => b.organizationId === organizationId && b.source === source);
  }
}

export class InMemoryLocalGraphStore implements LocalGraphStore {
  readonly people: LocalPerson[] = [];
  readonly entities: LocalEntityRecord[] = [];
  readonly lists: LocalPersonList[] = [];
  readonly listMembers: { listId: string; personId: string }[] = [];
  readonly external: ExternalRecordRow[] = [];
  readonly cursors = new Map<string, string>();

  async findPeopleByEmail(organizationId: string, email: string): Promise<LocalPerson[]> {
    const needle = email.trim().toLowerCase();
    return this.people.filter(
      (p) => p.organizationId === organizationId && p.emails.some((e) => e.trim().toLowerCase() === needle),
    );
  }
  async upsertPerson(person: LocalPerson): Promise<void> {
    const idx = this.people.findIndex((p) => p.id === person.id);
    if (idx >= 0) this.people[idx] = { ...person };
    else this.people.push({ ...person });
  }
  async listPeople(organizationId: string): Promise<LocalPerson[]> {
    return this.people.filter((p) => p.organizationId === organizationId);
  }
  async findPeopleByDedupeKey(organizationId: string, dedupeKey: string): Promise<LocalPerson[]> {
    return this.people.filter(
      (p) => p.organizationId === organizationId && p.dedupeKey === dedupeKey,
    );
  }
  async ensurePersonList(list: LocalPersonList): Promise<LocalPersonList> {
    const existing = this.lists.find(
      (l) => l.organizationId === list.organizationId && l.name === list.name,
    );
    if (existing) return existing;
    this.lists.push({ ...list });
    return list;
  }
  async listPersonLists(organizationId: string): Promise<LocalPersonList[]> {
    return this.lists.filter((l) => l.organizationId === organizationId);
  }
  async addPeopleToList(listId: string, personIds: readonly string[]): Promise<void> {
    for (const personId of personIds) {
      if (this.listMembers.some((m) => m.listId === listId && m.personId === personId)) continue;
      this.listMembers.push({ listId, personId });
    }
  }
  async listPeopleInList(listId: string): Promise<LocalPerson[]> {
    const ids = new Set(
      this.listMembers.filter((m) => m.listId === listId).map((m) => m.personId),
    );
    return this.people.filter((p) => ids.has(p.id));
  }
  async commitEntity(entry: LocalEntityRecord): Promise<void> {
    // Idempotent: a retry after a partial dual-write failure re-commits the same
    // deterministic id — that must be a silent no-op (mirrors recordExternal below).
    if (this.entities.some((e) => e.id === entry.id)) return;
    this.entities.push({ ...entry });
  }
  async listEntities(organizationId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]> {
    return this.entities.filter((e) => e.organizationId === organizationId && (kind ? e.kind === kind : true));
  }
  async recordExternal(row: ExternalRecordRow): Promise<void> {
    if (await this.hasExternal(row.organizationId, row.source, row.sourceRecordId)) return;
    this.external.push({ ...row });
  }
  async hasExternal(organizationId: string, source: string, sourceRecordId: string): Promise<boolean> {
    return this.external.some(
      (r) => r.organizationId === organizationId && r.source === source && r.sourceRecordId === sourceRecordId,
    );
  }
  async getSyncCursor(integrationId: string, source: string): Promise<string | null> {
    return this.cursors.get(`${integrationId}::${source}`) ?? null;
  }
  async setSyncCursor(integrationId: string, source: string, cursor: string): Promise<void> {
    this.cursors.set(`${integrationId}::${source}`, cursor);
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  readonly messages: LocalMessage[] = [];

  #messageKey(m: Pick<LocalMessage, "organizationId" | "source" | "messageId">): string {
    return `${m.organizationId}::${m.source}::${m.messageId}`;
  }

  async putMessages(messages: readonly LocalMessage[]): Promise<void> {
    for (const message of messages) assertMessageShape(message);
    for (const message of messages) {
      const key = this.#messageKey(message);
      const index = this.messages.findIndex((m) => this.#messageKey(m) === key);
      if (index >= 0) this.messages[index] = { ...message };
      else this.messages.push({ ...message });
    }
  }

  async listMessages(
    organizationId: string,
    source: string,
    chatId: string,
    limit?: number,
  ): Promise<LocalMessage[]> {
    return this.messages
      .filter(
        (m) =>
          m.organizationId === organizationId &&
          m.source === source &&
          m.chatId === chatId,
      )
      // Newest first, take the limit, then reverse — see the pglite store and
      // the port doc. Truncating from the oldest end hid every recent message
      // in a long thread (BUGS 2026-08-03), and the two stores must agree or
      // the memory store stops being a faithful test double.
      .sort((a, b) =>
        a.sentAt === b.sentAt
          ? b.messageId.localeCompare(a.messageId)
          : b.sentAt.localeCompare(a.sentAt),
      )
      .slice(0, limit ?? 500)
      .reverse();
  }

  /**
   * Substring matching for both modes. The in-memory adapter deliberately does
   * NOT reimplement Postgres ranking — it exists so a slice can run with zero
   * infra, and a hand-rolled approximation of `ts_rank` would be a second,
   * silently different search behaviour. `rank` is 0 and capabilities report
   * `fullText: false` so a caller can tell the difference.
   */
  async searchMessages(query: LocalMessageSearchQuery): Promise<LocalMessageSearchHit[]> {
    const needle = query.text.trim().toLowerCase();
    if (needle.length === 0) return [];
    return this.messages
      .filter(
        (m) =>
          m.organizationId === query.organizationId &&
          (query.source ? m.source === query.source : true) &&
          (query.chatId ? m.chatId === query.chatId : true) &&
          (query.senderKey ? m.senderKey === query.senderKey : true) &&
          m.body.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .slice(0, query.limit ?? 50)
      .map((m) => ({ ...m, rank: 0 }));
  }

  async getThreadActivity(
    organizationId: string,
    source: string,
    chatId: string,
  ): Promise<LocalThreadActivity> {
    const thread = this.messages.filter(
      (m) =>
        m.organizationId === organizationId &&
        m.source === source &&
        m.chatId === chatId,
    );
    const inbound = thread
      .filter((m) => m.direction === "inbound")
      .map((m) => m.sentAt)
      .sort();
    const outbound = thread
      .filter((m) => m.direction === "outbound")
      .map((m) => m.sentAt)
      .sort();
    return {
      chatId,
      inboundCount: inbound.length,
      outboundCount: outbound.length,
      ...(inbound[0] ? { firstInboundAt: inbound[0] } : {}),
      ...(inbound.at(-1) ? { lastInboundAt: inbound.at(-1) as string } : {}),
      ...(outbound.at(-1) ? { lastOutboundAt: outbound.at(-1) as string } : {}),
    };
  }

  async messageSearchCapabilities(): Promise<LocalMessageSearchCapabilities> {
    return { fullText: false, trigram: false };
  }
}

function stateKey(organizationId: string, namespace: string): string {
  return `${organizationId}::${namespace}`;
}

export class InMemoryLocalStateStore implements LocalStateStore {
  readonly rows = new Map<string, unknown>();
  readonly #tails = new Map<string, Promise<void>>();

  async read(organizationId: string, namespace: string): Promise<unknown | null> {
    const value = this.rows.get(stateKey(organizationId, namespace));
    return value === undefined ? null : structuredClone(value);
  }

  async update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => LocalStateMutation<T>,
  ): Promise<T> {
    const key = stateKey(organizationId, namespace);
    return this.#exclusive(key, async () => {
      const current = this.rows.has(key) ? this.rows.get(key) : initialState;
      const mutation = reduce(structuredClone(current));
      this.rows.set(key, structuredClone(mutation.state));
      return mutation.result;
    });
  }

  async remove(organizationId: string, namespace: string): Promise<boolean> {
    const key = stateKey(organizationId, namespace);
    return this.#exclusive(key, async () => this.rows.delete(key));
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
