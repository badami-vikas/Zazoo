// =====================================================================
// The per-repo agent-ledger template (TM6 deliverable, ADR-209).
//
// `tasks.md` is the projection an external coding agent orients on. It says
// what the work IS. It has never said how to WORK it — what may be edited,
// what happens to an edit, what "done" requires, or where the authority sits.
// TM6's exit test is another repository's coding agent working one full task
// from this ledger, and that agent arrives with no Bridge context at all.
//
// So this file is the second half of the projection: a template dropped into
// the same folder, written for an agent that has never seen this system.
//
// Every rule below is DERIVED from the constants that enforce it rather than
// restated in prose. A template that drifts from the system it describes is
// worse than no template: it teaches an agent a contract the server will then
// refuse, and the agent has no way to tell which of the two is wrong.
// =====================================================================

export interface AgentLedgerTemplateInput {
  /** The Module folder the projection lives in, so the template can name the
   * actual path rather than a placeholder the reader has to resolve. */
  moduleDisplayName: string;
  organizationName: string;
  /** The projection file's name, from the same constant that writes it. */
  projectionFileName: string;
  /** How many completed Tasks the projection retains. Derived, because an
   * agent that assumes the full history is here would read the absence of an
   * old Task as its deletion. */
  completedCap: number;
  /** The statuses a Task may hold, from the kernel's own list. */
  statuses: readonly string[];
}

export const AGENT_LEDGER_TEMPLATE_FILE = "AGENTS.md";

/**
 * Render the template.
 *
 * Deterministic: same inputs, same bytes. It is written to the Module folder
 * beside the projection and is content-hashed like any other Module File, so
 * a stale copy is detectable rather than silently authoritative.
 */
export function emitAgentLedgerTemplate(input: AgentLedgerTemplateInput): string {
  const path = `~/Documents/Bridge/${input.organizationName}/${input.moduleDisplayName}/`;
  return [
    "# Working this repository's task ledger",
    "",
    `This folder holds \`${input.projectionFileName}\`, a **projection** of a governed Task`,
    "Database. It is generated. You are reading a mirror, not the source.",
    "",
    "## The one rule everything else follows from",
    "",
    "**The Database is authoritative, and your edits are proposals.**",
    "",
    `You may edit \`${input.projectionFileName}\` freely — that is what it is for. Nothing you`,
    "write takes effect until a Human approves it. An edit is detected as *drift*,",
    "turned into a reconciliation proposal, and applied only on approval. Nothing is",
    "silently overwritten in either direction: not your edit by a regeneration, and",
    "not the Database by your edit.",
    "",
    "If your change is rejected, the file is regenerated from the Database and your",
    "version is in the proposal record. Nothing is lost; it simply was not accepted.",
    "",
    "## Orienting without reading the whole file",
    "",
    "Read the in-progress Tasks and the first three pending ones. That is enough to",
    "know what to pick up. Follow a Task's evidence links only when you need them.",
    "",
    `The **Recently completed** section holds at most ${input.completedCap} Tasks. Older completed work`,
    "is in the Database, not here. A Task you cannot find has not been deleted — it",
    "has aged out of the projection.",
    "",
    "## Reading one Task",
    "",
    "- **Record ID** — the Task's identity. Never invent one, never reuse one.",
    "- **Version** — bumps on every change. If it moved since you read it, re-read.",
    `- **Status** — one of: ${input.statuses.join(", ")}.`,
    "- **Exit test** — how anyone can tell this Task is finished. If it says `none`,",
    "  the Task has no agreed definition of done and cannot enter `in_progress`.",
    "- **Evidence** — what was produced. Required before `done`.",
    "- **Dependencies** — what this Task is waiting on. `none` means nothing is in",
    "  the way. `not read` means the edges were not loaded, which is **not** the same",
    "  claim — do not treat it as a clear path.",
    "",
    "## Finishing a Task",
    "",
    "1. Do the work.",
    "2. Record evidence — a commit, a file, a test run, a link. Something checkable.",
    "3. Satisfy the exit test. Do not restate the Task title as evidence that it is",
    "   done; the exit test asks how someone ELSE could tell.",
    "4. Move it to `done`.",
    "",
    "A `done` Task with no evidence is challenged automatically and reopened. This is",
    "not a formality: it is the check that keeps the ledger worth reading.",
    "",
    "## What you may not do",
    "",
    "- **Do not change a Task's Record ID, path, or version.** Those are the",
    "  Database's identity for the row, and an edit to them is unresolvable rather",
    "  than merely wrong.",
    "- **Do not mark work done that you did not verify.**",
    "- **Do not add a Task by inventing a heading.** Ask for one; placement in the",
    "  tree is a decision with consequences for everything under it.",
    "",
    "## Where this lives",
    "",
    `\`${path}\``,
    "",
    "Generated by the Task Manager Module. Edit the Database, not this file — this",
    "one is regenerated and your changes to it are not proposals.",
    "",
  ].join("\n");
}
