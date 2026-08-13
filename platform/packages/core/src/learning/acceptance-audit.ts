/**
 * K10 E2 (TASK-043, ADR-176 mechanism 2): the shown-text acceptance hash.
 *
 * An acceptance is only as meaningful as what the human actually READ. The
 * client sends the exact text it rendered; the stamp records its sha256 and
 * whether it matched the server's own canonical suggestion text at the
 * moment of acceptance. The audit can then distinguish REVIEWED acceptances
 * (stamp present, texts matched) from UNVERIFIED ones (no stamp — a legacy
 * or scripted caller — or a mismatch: the human saw something other than
 * what the server believes it proposed, e.g. a stale tab accepted after the
 * suggestion was superseded).
 *
 * The stamp never blocks: an acceptance without a stamp still lands (the
 * decision is the human's regardless); it lands AUDITABLY unverified. That
 * is the mechanism — bulk rubber-stamping stops being indistinguishable
 * from review.
 *
 * Hashing goes through the Web Crypto API (`globalThis.crypto.subtle`)
 * rather than `node:crypto`: this module is reachable from the web app's
 * bundle through core's public barrel, and a named binding pulled from
 * `node:crypto` fails Rollup's resolution step even for code never called
 * client-side. Web Crypto is standard in both Node 19+ and every browser.
 */
import type { MemoryAuthScope, MemoryStore } from "../memory/memory-store.js";

export const ACCEPTANCE_AUDIT_KINDS = [
  "learning_suggestion",
  "automation_draft_suggestion",
  "claim_suggestion",
] as const;

export interface AcceptanceStamp {
  /** sha256 (hex) of exactly what the client rendered to the human. */
  shownTextHash: string;
  /** Whether the client's text was byte-identical to the server's canonical
   * suggestion text at acceptance time. */
  matchedCanonicalText: boolean;
}

export async function hashShownText(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Build the stamp for one acceptance. `shownText` absent = no stamp (the
 * acceptance lands unverified, never blocked). */
export async function acceptanceStamp(
  shownText: string | undefined,
  canonicalText: string,
): Promise<AcceptanceStamp | null> {
  if (typeof shownText !== "string" || shownText.length === 0) return null;
  return {
    shownTextHash: await hashShownText(shownText),
    matchedCanonicalText: shownText === canonicalText,
  };
}

export function readAcceptanceStamp(content: Record<string, unknown>): AcceptanceStamp | null {
  const raw = content["acceptance"];
  if (raw === null || typeof raw !== "object") return null;
  const stamp = raw as Partial<AcceptanceStamp>;
  if (typeof stamp.shownTextHash !== "string" || typeof stamp.matchedCanonicalText !== "boolean") {
    return null;
  }
  return { shownTextHash: stamp.shownTextHash, matchedCanonicalText: stamp.matchedCanonicalText };
}

export interface AcceptanceAuditRow {
  memoryId: string;
  kind: string;
  moduleId: string | null;
  verdict: "reviewed" | "unverified";
  /** Why an unverified row is unverified — absent stamp vs text mismatch. */
  reason?: "no_stamp" | "text_mismatch";
}

export interface AcceptanceAudit {
  reviewed: number;
  unverified: number;
  rows: AcceptanceAuditRow[];
}

/** The bulk-accept audit: every accepted suggestion across the three
 * suggestion kinds, classified by its stamp. */
export async function auditAcceptances(
  store: MemoryStore,
  scope: MemoryAuthScope,
): Promise<AcceptanceAudit> {
  const rows: AcceptanceAuditRow[] = [];
  for (const kind of ACCEPTANCE_AUDIT_KINDS) {
    const entries = await store.retrieve(
      {
        type: "semantic",
        contentPathEquals: [
          { path: "anchor.kind", equals: kind },
          { path: "anchor.status", equals: "accepted" },
        ],
      },
      scope,
    );
    for (const entry of entries) {
      let content: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(entry.content);
        if (parsed === null || typeof parsed !== "object") continue;
        content = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const anchor = content["anchor"] as { moduleId?: unknown } | undefined;
      const stamp = readAcceptanceStamp(content);
      rows.push({
        memoryId: entry.id,
        kind,
        moduleId: typeof anchor?.moduleId === "string" ? anchor.moduleId : null,
        verdict: stamp?.matchedCanonicalText ? "reviewed" : "unverified",
        ...(stamp?.matchedCanonicalText
          ? {}
          : { reason: stamp ? ("text_mismatch" as const) : ("no_stamp" as const) }),
      });
    }
  }
  return {
    reviewed: rows.filter((row) => row.verdict === "reviewed").length,
    unverified: rows.filter((row) => row.verdict === "unverified").length,
    rows,
  };
}
