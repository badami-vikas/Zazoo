/**
 * MemoryStore — the home for "learns how you work" (MEM-1, roadmap
 * undefined-element #3). A thin, derived, CLASSIFIED layer of confirmed/
 * superseded learned facts that sits ALONGSIDE `timeline_entries` (the raw
 * capture log) — it does NOT fork it. A capture lands as a timeline entry
 * (CaptureLedger) and, when wired, a derived Memory candidate is written here
 * referencing that entry via `sourceRef`.
 *
 * WHY a separate table and not timeline_entries:
 *  - timeline_entries is an append-only episodic log of everything captured;
 *    a Memory is a DISTILLED, classified, supersede-able fact derived from one
 *    or more captures/ledger rows/feedback. Different lifecycle (facts get
 *    superseded; log entries never change), different read model (authority-
 *    scoped by classification, not just tenant).
 *
 * Retrieval is AUTHORITY-SCOPED AT THE STORE BOUNDARY (not post-filtered): the
 * store itself applies the classification predicate so a caller can never read
 * a row it is not entitled to. The predicate mirrors the database's own
 * `app_private.visible_relationship_row` (migrations/0008) exactly:
 * public/workspace → any member; team/private/restricted → owner-only (finer
 * team membership + restricted grants land with the governance schema pass).
 *
 * The in-memory adapter here is the dev/test default (mirrors
 * InMemoryCapabilityStore / InMemoryCaptureLedger); @bridge/db binds a
 * Drizzle-backed adapter over the `memories` table, and a Mem0 adapter can bind
 * the same port behind a flag without touching callers.
 */
import type { ContextDataScope } from "../context-provider.js";
import type { Plane, TrustOrigin } from "../types.js";

/** Cognitive kind of a Memory (undefined-elements-definitions-2026-07 §Memory). */
export type MemoryType = "episodic" | "semantic" | "procedural" | "preference";

/** What a Memory was derived from — the provenance back-link. */
export type MemorySourceRefType = "timeline_entry" | "ledger" | "feedback";

/**
 * Classification governs who may read a Memory. Reuses the kernel's canonical
 * `ContextDataScope` union (public|workspace|team|private|restricted) so Memory
 * scoping never drifts from context-capture scoping.
 */
export type MemoryClassification = ContextDataScope;

/** The input shape for writing a Memory. `createdAt` is assigned by the store
 * when omitted; `supersedesId` is set only via `supersede()`, never `write()`. */
export interface MemoryWrite {
  id: string;
  workspaceId: string;
  type: MemoryType;
  /** The element (Person/Community/Initiative…) this fact is about, if any. */
  subjectElementId?: string | null;
  scope: MemoryClassification;
  content: string;
  sourceRefType?: MemorySourceRefType | null;
  sourceRefId?: string | null;
  /** The writer's own confidence in the fact, 0..1. */
  confidence: number;
  /** Provenance / trust origin of the content this Memory was derived from
   * (PI-1). Untrusted-by-default for anything not user/kernel authored. */
  trustOrigin: TrustOrigin;
  plane: Plane;
  /** Provenance actor: the provider/agent/user id that produced this Memory. */
  createdBy: string;
  /** Owner for authority-scoping team/private/restricted reads. */
  ownerUserId?: string | null;
  createdAt?: string;
}

/** A persisted Memory row. */
export interface MemoryEntry extends MemoryWrite {
  /** Set when this row supersedes an earlier Memory (append-only correction). */
  supersedesId?: string | null;
  createdAt: string;
}

export interface MemoryQuery {
  type?: MemoryType;
  subjectElementId?: string;
  /** Include rows that have been superseded by a newer row. Default false —
   * retrieval returns only the CURRENT set of facts. */
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * The authority a caller reads Memory under. `userId` absent = a system/no-user
 * context, which may read only public/workspace-classified Memories.
 */
export interface MemoryAuthScope {
  workspaceId: string;
  userId?: string | null;
}

export interface MemoryStore {
  /** Write a new Memory (candidate or confirmed). */
  write(entry: MemoryWrite): Promise<MemoryEntry>;
  /** Append a correcting Memory that supersedes `id` (append-only: the prior
   * row is retained, tagged as superseded by the returned row). */
  supersede(id: string, next: MemoryWrite): Promise<MemoryEntry>;
  /** Fetch one Memory, authority-scoped — returns null if the caller may not
   * read it (indistinguishable from "not found", by design). */
  get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null>;
  /** List current Memories the caller is authorized to read, newest first. */
  retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]>;
}

/**
 * Authority predicate — the single source of truth for Memory read visibility,
 * shared by every adapter so in-memory and Drizzle agree. Mirrors the DB's
 * `app_private.visible_relationship_row` (migrations/0008_rls_as_code.sql):
 * tenant match always required; public/workspace visible to any member;
 * team/private/restricted visible only to the owner.
 */
export function memoryVisible(entry: MemoryEntry, authScope: MemoryAuthScope): boolean {
  if (entry.workspaceId !== authScope.workspaceId) return false;
  switch (entry.scope) {
    case "public":
    case "workspace":
      return true;
    case "team":
    case "private":
    case "restricted":
      return authScope.userId != null && entry.ownerUserId === authScope.userId;
    default:
      return false;
  }
}

/** In-memory `MemoryStore` — dev/test default (mirrors InMemoryCapabilityStore). */
export class InMemoryMemoryStore implements MemoryStore {
  readonly entries: MemoryEntry[] = [];

  async write(entry: MemoryWrite): Promise<MemoryEntry> {
    return this.#insert(entry, null);
  }

  async supersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    if (!this.entries.some((e) => e.id === id)) {
      throw new Error(`memory store: cannot supersede unknown id ${id}`);
    }
    return this.#insert(next, id);
  }

  async get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null> {
    const row = this.entries.find((e) => e.id === id);
    if (!row || !memoryVisible(row, authScope)) return null;
    return { ...row };
  }

  async retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]> {
    const superseded = new Set(
      this.entries.map((e) => e.supersedesId).filter((v): v is string => v != null),
    );
    let rows = this.entries.filter((e) => memoryVisible(e, authScope));
    if (!query.includeSuperseded) rows = rows.filter((e) => !superseded.has(e.id));
    if (query.type) rows = rows.filter((e) => e.type === query.type);
    if (query.subjectElementId) rows = rows.filter((e) => e.subjectElementId === query.subjectElementId);
    rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((e) => ({ ...e }));
  }

  #insert(entry: MemoryWrite, supersedesId: string | null): MemoryEntry {
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`memory store: duplicate id ${entry.id} (append-only violation)`);
    }
    const full: MemoryEntry = {
      ...entry,
      supersedesId,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    this.entries.push(full);
    return { ...full };
  }
}
