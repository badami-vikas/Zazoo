import { z } from "zod";
import { assertPilotOrganization, paginatedInput, procedure, t } from "../router-shared.js";

/**
 * Academics — Subjects / Lecture Sessions / Assignments vault (TASK-067,
 * ADR-231). Plain authenticated CRUD, same tier as `resources` above.
 */
export const academicsRouter = t.router({
  createSubject: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        code: z.string().optional(),
        title: z.string().min(1),
        term: z.string().optional(),
        instructor: z.string().optional(),
        credits: z.number().int().positive().optional(),
        targetGrade: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.createSubject({
        organizationId: input.organizationId,
        title: input.title,
        ...(input.code ? { code: input.code } : {}),
        ...(input.term ? { term: input.term } : {}),
        ...(input.instructor ? { instructor: input.instructor } : {}),
        ...(input.credits != null ? { credits: input.credits } : {}),
        ...(input.targetGrade ? { targetGrade: input.targetGrade } : {}),
      });
    }),

  listSubjects: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const { items, total } = await ctx.wiring.academicsStore.listSubjects(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  updateSubject: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().uuid(),
        code: z.string().optional(),
        title: z.string().optional(),
        term: z.string().optional(),
        instructor: z.string().optional(),
        credits: z.number().int().positive().optional(),
        status: z.enum(["planned", "active", "complete", "dropped"]).optional(),
        grade: z.string().optional(),
        targetGrade: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.updateSubject(input.id, input.organizationId, {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.term !== undefined ? { term: input.term } : {}),
        ...(input.instructor !== undefined ? { instructor: input.instructor } : {}),
        ...(input.credits !== undefined ? { credits: input.credits } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
        ...(input.targetGrade !== undefined ? { targetGrade: input.targetGrade } : {}),
      });
    }),

  createLectureSession: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        subjectId: z.string().uuid(),
        sessionDate: z.string().datetime().optional(),
        topic: z.string().optional(),
        myNotes: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.createLectureSession({
        organizationId: input.organizationId,
        subjectId: input.subjectId,
        ...(input.sessionDate ? { sessionDate: new Date(input.sessionDate) } : {}),
        ...(input.topic ? { topic: input.topic } : {}),
        ...(input.myNotes ? { myNotes: input.myNotes } : {}),
      });
    }),

  listLectureSessions: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const { items, total } = await ctx.wiring.academicsStore.listLectureSessions(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  updateLectureSession: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().uuid(),
        sessionDate: z.string().datetime().optional(),
        topic: z.string().optional(),
        status: z.enum(["scheduled", "attended", "missed", "reviewed"]).optional(),
        myNotes: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.updateLectureSession(input.id, input.organizationId, {
        ...(input.sessionDate !== undefined ? { sessionDate: new Date(input.sessionDate) } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.myNotes !== undefined ? { myNotes: input.myNotes } : {}),
      });
    }),

  createAssignment: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        subjectId: z.string().uuid(),
        title: z.string().min(1),
        type: z.enum(["problem_set", "essay", "project", "exam", "lab"]).optional(),
        dueAt: z.string().datetime().optional(),
        weight: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.createAssignment({
        organizationId: input.organizationId,
        subjectId: input.subjectId,
        title: input.title,
        ...(input.type ? { type: input.type } : {}),
        ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.weight != null ? { weight: input.weight } : {}),
      });
    }),

  listAssignments: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const { items, total } = await ctx.wiring.academicsStore.listAssignments(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  updateAssignment: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().uuid(),
        title: z.string().optional(),
        type: z.enum(["problem_set", "essay", "project", "exam", "lab"]).optional(),
        dueAt: z.string().datetime().optional(),
        weight: z.number().int().min(0).max(100).optional(),
        status: z.enum(["not_started", "in_progress", "submitted", "graded"]).optional(),
        risk: z.enum(["red", "yellow", "green"]).optional(),
        submittedAt: z.string().datetime().optional(),
        grade: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return ctx.wiring.academicsStore.updateAssignment(input.id, input.organizationId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.risk !== undefined ? { risk: input.risk } : {}),
        ...(input.submittedAt !== undefined ? { submittedAt: new Date(input.submittedAt) } : {}),
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
      });
    }),
});
