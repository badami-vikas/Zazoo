/**
 * DrizzleAcademicsStore — Academics Module (TASK-067) persistence: Subjects,
 * Lecture Sessions, Assignments. Plain organization-authenticated CRUD, same
 * tier as `DrizzleResourcesStore` — tracking a Subject/Session/Assignment has
 * no external effect requiring approval.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, count, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { academicsSubjects, academicsLectureSessions, academicsAssignments, academicsDocuments } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export type SubjectRow = typeof academicsSubjects.$inferSelect;
export type LectureSessionRow = typeof academicsLectureSessions.$inferSelect;
export type AssignmentRow = typeof academicsAssignments.$inferSelect;
export type DocumentRow = typeof academicsDocuments.$inferSelect;

export interface CreateSubjectInput {
  organizationId: string;
  code?: string;
  title: string;
  term?: string;
  instructor?: string;
  credits?: number;
  targetGrade?: string;
}

export interface CreateLectureSessionInput {
  organizationId: string;
  subjectId: string;
  sessionDate?: Date;
  topic?: string;
  myNotes?: string;
}

export interface CreateAssignmentInput {
  organizationId: string;
  subjectId: string;
  title: string;
  type?: string;
  dueAt?: Date;
  weight?: number;
}

/** LMS sync (TASK-078). Upserts key on (organizationId, source, sourceId) and
 * update ONLY source-owned fields — a re-sync never clobbers the owner's own
 * status/grade/notes edits. Submission-derived assignment fields (status/
 * submittedAt/grade) are applied only when the source actually asserts them. */
export interface UpsertSubjectFromSourceInput {
  organizationId: string;
  source: string;
  sourceId: string;
  title: string;
  code?: string;
  term?: string;
  instructor?: string;
}

export interface UpsertAssignmentFromSourceInput {
  organizationId: string;
  subjectId: string;
  source: string;
  sourceId: string;
  title: string;
  dueAt?: Date;
  status?: string;
  submittedAt?: Date;
  grade?: string;
}

export interface UpsertDocumentFromSourceInput {
  organizationId: string;
  subjectId: string;
  source: string;
  sourceId: string;
  kind: "page" | "file";
  title: string;
  content?: string;
  url?: string;
}

export class DrizzleAcademicsStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async createSubject(input: CreateSubjectInput): Promise<SubjectRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(academicsSubjects)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          title: input.title,
          ...(input.code ? { code: input.code } : {}),
          ...(input.term ? { term: input.term } : {}),
          ...(input.instructor ? { instructor: input.instructor } : {}),
          ...(input.credits != null ? { credits: input.credits } : {}),
          ...(input.targetGrade ? { targetGrade: input.targetGrade } : {}),
        })
        .returning();
      return row!;
    });
  }

  async listSubjects(organizationId: string, opts: PageOpts): Promise<Page<SubjectRow>> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = eq(academicsSubjects.organizationId, organizationId);
      const [rows, totalRows] = await Promise.all([
        tx.select().from(academicsSubjects).where(where).orderBy(desc(academicsSubjects.createdAt)).limit(opts.limit).offset(opts.offset),
        tx.select({ value: count() }).from(academicsSubjects).where(where),
      ]);
      return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async updateSubject(
    id: string,
    organizationId: string,
    patch: Partial<Omit<CreateSubjectInput, "organizationId">> & { status?: string; grade?: string },
  ): Promise<SubjectRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(academicsSubjects)
        .set({
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.term !== undefined ? { term: patch.term } : {}),
          ...(patch.instructor !== undefined ? { instructor: patch.instructor } : {}),
          ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
          ...(patch.targetGrade !== undefined ? { targetGrade: patch.targetGrade } : {}),
        })
        .where(and(eq(academicsSubjects.id, id), eq(academicsSubjects.organizationId, organizationId)))
        .returning();
      return row ?? null;
    });
  }

  async upsertSubjectFromSource(input: UpsertSubjectFromSourceInput): Promise<{ row: SubjectRow; created: boolean }> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [existing] = await tx
        .select({ id: academicsSubjects.id })
        .from(academicsSubjects)
        .where(
          and(
            eq(academicsSubjects.organizationId, input.organizationId),
            eq(academicsSubjects.source, input.source),
            eq(academicsSubjects.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      const sourceOwned = {
        title: input.title,
        code: input.code ?? null,
        term: input.term ?? null,
        instructor: input.instructor ?? null,
      };
      if (existing) {
        const [row] = await tx
          .update(academicsSubjects)
          .set(sourceOwned)
          .where(eq(academicsSubjects.id, existing.id))
          .returning();
        return { row: row!, created: false };
      }
      const [row] = await tx
        .insert(academicsSubjects)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          source: input.source,
          sourceId: input.sourceId,
          ...sourceOwned,
        })
        .returning();
      return { row: row!, created: true };
    });
  }

  async upsertAssignmentFromSource(
    input: UpsertAssignmentFromSourceInput,
  ): Promise<{ row: AssignmentRow; created: boolean }> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [existing] = await tx
        .select({ id: academicsAssignments.id })
        .from(academicsAssignments)
        .where(
          and(
            eq(academicsAssignments.organizationId, input.organizationId),
            eq(academicsAssignments.source, input.source),
            eq(academicsAssignments.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      const sourceOwned = {
        subjectId: input.subjectId,
        title: input.title,
        dueAt: input.dueAt ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.submittedAt !== undefined ? { submittedAt: input.submittedAt } : {}),
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
      };
      if (existing) {
        const [row] = await tx
          .update(academicsAssignments)
          .set(sourceOwned)
          .where(eq(academicsAssignments.id, existing.id))
          .returning();
        return { row: row!, created: false };
      }
      const [row] = await tx
        .insert(academicsAssignments)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          source: input.source,
          sourceId: input.sourceId,
          ...sourceOwned,
        })
        .returning();
      return { row: row!, created: true };
    });
  }

  async upsertDocumentFromSource(input: UpsertDocumentFromSourceInput): Promise<{ row: DocumentRow; created: boolean }> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [existing] = await tx
        .select({ id: academicsDocuments.id })
        .from(academicsDocuments)
        .where(
          and(
            eq(academicsDocuments.organizationId, input.organizationId),
            eq(academicsDocuments.source, input.source),
            eq(academicsDocuments.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      const sourceOwned = {
        subjectId: input.subjectId,
        kind: input.kind,
        title: input.title,
        content: input.content ?? null,
        url: input.url ?? null,
      };
      if (existing) {
        const [row] = await tx
          .update(academicsDocuments)
          .set(sourceOwned)
          .where(eq(academicsDocuments.id, existing.id))
          .returning();
        return { row: row!, created: false };
      }
      const [row] = await tx
        .insert(academicsDocuments)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          source: input.source,
          sourceId: input.sourceId,
          ...sourceOwned,
        })
        .returning();
      return { row: row!, created: true };
    });
  }

  async listDocuments(organizationId: string, opts: PageOpts): Promise<Page<DocumentRow>> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = eq(academicsDocuments.organizationId, organizationId);
      const [rows, totalRows] = await Promise.all([
        tx
          .select()
          .from(academicsDocuments)
          .where(where)
          .orderBy(desc(academicsDocuments.createdAt))
          .limit(opts.limit)
          .offset(opts.offset),
        tx.select({ value: count() }).from(academicsDocuments).where(where),
      ]);
      return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  /** Unsummarized page documents — the ONLY input a summarization Run reads.
   * Bounded by `limit` so a single Run has a predictable cost. */
  async listUnsummarizedDocuments(organizationId: string, limit: number): Promise<DocumentRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(academicsDocuments)
        .where(
          and(
            eq(academicsDocuments.organizationId, organizationId),
            eq(academicsDocuments.kind, "page"),
            isNull(academicsDocuments.summary),
          ),
        )
        .orderBy(desc(academicsDocuments.createdAt))
        .limit(limit);
      return rows.filter((row) => row.content);
    });
  }

  async setDocumentSummary(id: string, organizationId: string, summary: string): Promise<DocumentRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(academicsDocuments)
        .set({ summary, summarizedAt: new Date() })
        .where(and(eq(academicsDocuments.id, id), eq(academicsDocuments.organizationId, organizationId)))
        .returning();
      return row ?? null;
    });
  }

  async createLectureSession(input: CreateLectureSessionInput): Promise<LectureSessionRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(academicsLectureSessions)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          subjectId: input.subjectId,
          ...(input.sessionDate ? { sessionDate: input.sessionDate } : {}),
          ...(input.topic ? { topic: input.topic } : {}),
          ...(input.myNotes ? { myNotes: input.myNotes } : {}),
        })
        .returning();
      return row!;
    });
  }

  async listLectureSessions(organizationId: string, opts: PageOpts): Promise<Page<LectureSessionRow>> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = eq(academicsLectureSessions.organizationId, organizationId);
      const [rows, totalRows] = await Promise.all([
        tx
          .select()
          .from(academicsLectureSessions)
          .where(where)
          .orderBy(desc(academicsLectureSessions.createdAt))
          .limit(opts.limit)
          .offset(opts.offset),
        tx.select({ value: count() }).from(academicsLectureSessions).where(where),
      ]);
      return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async updateLectureSession(
    id: string,
    organizationId: string,
    patch: Partial<Omit<CreateLectureSessionInput, "organizationId" | "subjectId">> & { status?: string },
  ): Promise<LectureSessionRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(academicsLectureSessions)
        .set({
          ...(patch.sessionDate !== undefined ? { sessionDate: patch.sessionDate } : {}),
          ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.myNotes !== undefined ? { myNotes: patch.myNotes } : {}),
        })
        .where(and(eq(academicsLectureSessions.id, id), eq(academicsLectureSessions.organizationId, organizationId)))
        .returning();
      return row ?? null;
    });
  }

  async createAssignment(input: CreateAssignmentInput): Promise<AssignmentRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const [row] = await tx
        .insert(academicsAssignments)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          subjectId: input.subjectId,
          title: input.title,
          ...(input.type ? { type: input.type } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          ...(input.weight != null ? { weight: input.weight } : {}),
        })
        .returning();
      return row!;
    });
  }

  async listAssignments(organizationId: string, opts: PageOpts): Promise<Page<AssignmentRow>> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = eq(academicsAssignments.organizationId, organizationId);
      const [rows, totalRows] = await Promise.all([
        tx
          .select()
          .from(academicsAssignments)
          .where(where)
          .orderBy(desc(academicsAssignments.createdAt))
          .limit(opts.limit)
          .offset(opts.offset),
        tx.select({ value: count() }).from(academicsAssignments).where(where),
      ]);
      return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async updateAssignment(
    id: string,
    organizationId: string,
    patch: Partial<Omit<CreateAssignmentInput, "organizationId" | "subjectId">> & {
      status?: string;
      risk?: string;
      submittedAt?: Date;
      grade?: string;
    },
  ): Promise<AssignmentRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(academicsAssignments)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
          ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.risk !== undefined ? { risk: patch.risk } : {}),
          ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
          ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
        })
        .where(and(eq(academicsAssignments.id, id), eq(academicsAssignments.organizationId, organizationId)))
        .returning();
      return row ?? null;
    });
  }
}
