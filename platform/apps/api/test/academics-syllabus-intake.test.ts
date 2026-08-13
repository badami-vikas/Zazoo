/**
 * academics.syllabusIntake end to end (TASK-069, ADR-237) — reads a real PDF
 * from Module Files (the same `readModuleFileContent` path `modules.addFile`
 * writes through), extracts candidate Assignments, and writes them as
 * Assignment rows. The one invariant this suite exists to prove: every row it
 * writes carries `status: "draft"` — nothing this Skill produces reaches the
 * live toggle un-reviewed, regardless of how many/few candidates it found.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

/** A minimal, hand-built single-page PDF with a text-drawing content stream —
 * no PDF-writing dependency needed for a fixture this small. Each line is one
 * `Tj` show-text op, top to bottom. */
function makeSyllabusPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/([()\\])/g, "\\$1");
  const content = lines
    .map((line, i) => `BT /F1 12 Tf 50 ${700 - i * 20} Td (${escape(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>endobj",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream endobj`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

test("syllabusIntake writes extracted rows as draft Assignments, never any other status", async () => {
  const bridgeRoot = await mkdtemp(join(tmpdir(), "bridge-syllabus-intake-"));
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = await makeCaller(wiring);
    const subject = await caller.academics.createSubject({
      organizationId: PILOT_ORGANIZATION,
      title: "ECON 301",
    });

    const pdf = makeSyllabusPdf([
      "Course Syllabus - ECON 301",
      "Assignment 1: Problem Set 1 due 09/15/2026 worth 10%",
      "Midterm Exam due 10/20/2026 worth 25%",
      "This course meets twice a week in the main hall.",
    ]);
    await caller.modules.addFile({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "academics",
      fileName: "syllabus.pdf",
      contentBase64: pdf.toString("base64"),
    });

    const result = await caller.academics.syllabusIntake({
      organizationId: PILOT_ORGANIZATION,
      subjectId: subject.id,
      fileName: "syllabus.pdf",
    });

    assert.equal(result.draftCount, 2, "the prose line must not become a row");
    assert.ok(result.assignments.every((row) => row.status === "draft"));

    const listed = await caller.academics.listAssignments({
      organizationId: PILOT_ORGANIZATION,
      limit: 50,
      offset: 0,
    });
    const drafted = listed.items.filter((row) => row.subjectId === subject.id);
    assert.equal(drafted.length, 2);
    assert.ok(drafted.every((row) => row.status === "draft"), "no row bypasses draft status on write");

    // Approval is editing the SAME row through updateAssignment — no second
    // approve/reject procedure exists.
    const approved = await caller.academics.updateAssignment({
      organizationId: PILOT_ORGANIZATION,
      id: drafted[0]!.id,
      status: "not_started",
    });
    assert.equal(approved?.status, "not_started");
  } finally {
    await wiring.close();
    await rm(bridgeRoot, { recursive: true, force: true });
  }
});

test("syllabusIntake refuses a File name that isn't in the Academics Local Files folder", async () => {
  const bridgeRoot = await mkdtemp(join(tmpdir(), "bridge-syllabus-intake-missing-"));
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = await makeCaller(wiring);
    const subject = await caller.academics.createSubject({
      organizationId: PILOT_ORGANIZATION,
      title: "ECON 301",
    });
    await assert.rejects(
      () =>
        caller.academics.syllabusIntake({
          organizationId: PILOT_ORGANIZATION,
          subjectId: subject.id,
          fileName: "nope.pdf",
        }),
      /was not found/,
    );
  } finally {
    await wiring.close();
    await rm(bridgeRoot, { recursive: true, force: true });
  }
});
