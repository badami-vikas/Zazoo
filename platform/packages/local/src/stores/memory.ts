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
  OAuthTokenRecord,
  SecretStore,
  StoredBody,
} from "../ports.js";

export class InMemorySecretStore implements SecretStore {
  readonly tokens = new Map<string, OAuthTokenRecord>();
  async putToken(rec: OAuthTokenRecord): Promise<void> {
    this.tokens.set(rec.integrationId, { ...rec });
  }
  async getToken(integrationId: string): Promise<OAuthTokenRecord | null> {
    return this.tokens.get(integrationId) ?? null;
  }
  async deleteToken(integrationId: string): Promise<void> {
    this.tokens.delete(integrationId);
  }
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

/** Assemble an in-memory LocalPlane (tests / zero-infra dev). */
export function createMemoryLocalPlane(): LocalPlane {
  return {
    secrets: new InMemorySecretStore(),
    bodies: new InMemoryBodyStore(),
    graph: new InMemoryLocalGraphStore(),
    close: async () => {},
  };
}
