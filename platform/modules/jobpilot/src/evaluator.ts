import type { EvalVerdict } from "./types.js";

// Fields the writer agent may never touch without direct evidence from the master resume —
// architecture doc S4.1: "every change_log entry must cite evidence from the master resume or be
// tagged jd_added (keyword-only additions to skills phrasing, never new employers/titles/dates/
// degrees)". Enumerated here because these are exactly the fields where a fabrication is
// materially dangerous (misrepresenting employment history), not stylistic.
const PROTECTED_FIELDS = new Set(["employer", "title", "startDate", "endDate", "degree"]);

export interface ChangeLogEntry {
  field: string;
  action: string;
  evidence?: string; // must be present verbatim in the master resume text, unless tag is jd_added
  tag?: "jd_added"; // keyword-only skills-phrasing addition — the one allowed evidence-free case
}

// Deterministic fabrication guard (architecture doc S4.2 stage 1, `evaluator.evaluateTailoredPlan`
// analog) — pure Python `scorers.py`-shaped logic ported here as pure TS. Runs BEFORE any LLM
// judge stage (not built here, see scoring.ts's comment for why). A single blocking issue is
// enough to reject; the writer/evaluator retry loop (max 3 iterations per architecture doc S4.2)
// is an Automation concern, out of scope for this anchor.
export function evaluateTailoredMaterials(masterResumeText: string, changeLog: ChangeLogEntry[]): EvalVerdict {
  const blockingIssues: string[] = [];
  const master = masterResumeText.toLowerCase();

  for (const entry of changeLog) {
    if (entry.tag === "jd_added") {
      if (PROTECTED_FIELDS.has(entry.field)) {
        blockingIssues.push(`protected field "${entry.field}" cannot be jd_added — requires master-resume evidence`);
      }
      continue;
    }
    if (!entry.evidence || !master.includes(entry.evidence.toLowerCase())) {
      blockingIssues.push(`field "${entry.field}" (${entry.action}) has no evidence in the master resume`);
    }
  }

  return { approved: blockingIssues.length === 0, blockingIssues };
}
