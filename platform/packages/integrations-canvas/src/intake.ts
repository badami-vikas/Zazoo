/**
 * Pure intake mapping — Canvas payloads to Academics row inputs. No I/O, no
 * fabricated figures: any field Canvas does not provide stays undefined
 * (ADR-247 — "unknown" is first-class), and submission state only ever maps
 * FORWARD (submitted/graded); an unsubmitted Canvas state maps to undefined so
 * a sync never downgrades the owner's own manual status edits.
 */
import type { CanvasAssignmentPayload, CanvasCoursePayload, CanvasFilePayload, CanvasPagePayload } from "./gateway.js";

export interface MappedCanvasCourse {
  sourceId: string;
  title: string;
  code?: string;
  term?: string;
  instructor?: string;
}

export interface MappedCanvasAssignment {
  sourceId: string;
  /** The owning course — resolved to a Subject row by the sync Skill. */
  courseSourceId: string;
  title: string;
  dueAt?: string;
  status?: "submitted" | "graded";
  submittedAt?: string;
  grade?: string;
}

/** Date-restricted or unnamed enrollments carry no usable fields — skip them. */
export function mapCanvasCourse(payload: CanvasCoursePayload): MappedCanvasCourse | undefined {
  const title = payload.name ?? payload.course_code;
  if (!title || payload.access_restricted_by_date) return undefined;
  const term = payload.term?.name;
  const instructor = payload.teachers?.[0]?.display_name;
  return {
    sourceId: String(payload.id),
    title,
    ...(payload.course_code ? { code: payload.course_code } : {}),
    // Canvas puts non-term-scoped courses in a literal "Default Term" — that
    // is instance plumbing, not a term the owner would ever type.
    ...(term && term !== "Default Term" ? { term } : {}),
    ...(instructor ? { instructor } : {}),
  };
}

export function mapCanvasAssignment(
  payload: CanvasAssignmentPayload,
  courseSourceId: string,
): MappedCanvasAssignment | undefined {
  if (!payload.name) return undefined;
  const submission = payload.submission ?? undefined;
  const status =
    submission?.workflow_state === "graded"
      ? ("graded" as const)
      : submission?.workflow_state === "submitted" || submission?.workflow_state === "pending_review"
        ? ("submitted" as const)
        : undefined;
  const grade =
    submission?.entered_grade ?? (submission?.score !== null && submission?.score !== undefined ? String(submission.score) : undefined);
  return {
    sourceId: String(payload.id),
    courseSourceId,
    title: payload.name,
    ...(payload.due_at ? { dueAt: payload.due_at } : {}),
    ...(status ? { status } : {}),
    ...(submission?.submitted_at ? { submittedAt: submission.submitted_at } : {}),
    // A grade only exists once Canvas says the submission was graded — a bare
    // score on an ungraded row is a placeholder, not a result.
    ...(status === "graded" && grade !== undefined ? { grade } : {}),
  };
}

export interface MappedCanvasDocument {
  sourceId: string;
  /** The owning course — resolved to a Subject row by the sync Skill. */
  courseSourceId: string;
  kind: "page" | "file";
  title: string;
  /** Plain text extracted from a Page's HTML body. Undefined for a File —
   * Bridge does not download or parse file bytes (a separate, unbuilt
   * capability); a File row is metadata (name/url) only. */
  content?: string;
  url?: string;
}

/** Strips HTML tags from a Canvas RCE page body down to plain text for
 * storage/summarization. Not a sanitizer — this text is never rendered as
 * HTML, only read as a prompt/preview string. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Page with no title and no body is Canvas plumbing (an empty front
 * page), not class content — skip it. */
export function mapCanvasPage(payload: CanvasPagePayload, courseSourceId: string): MappedCanvasDocument | undefined {
  const title = payload.title?.trim();
  const content = payload.body ? stripHtml(payload.body) : undefined;
  if (!title || !content) return undefined;
  return {
    sourceId: payload.url,
    courseSourceId,
    kind: "page",
    title,
    content,
  };
}

export function mapCanvasFile(payload: CanvasFilePayload, courseSourceId: string): MappedCanvasDocument | undefined {
  const title = payload.display_name ?? payload.filename;
  if (!title) return undefined;
  return {
    sourceId: String(payload.id),
    courseSourceId,
    kind: "file",
    title,
    ...(payload.url ? { url: payload.url } : {}),
  };
}
