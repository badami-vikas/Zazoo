/**
 * ResearchRun — the "Research this" prototype surface (TASK-028 live wiring,
 * user-approved prototype-first path 2026-07-30).
 *
 * Runs the @bridge/research engine IN THIS OVERLAY WEBVIEW with its ports
 * wired to what the desktop already provides:
 *  - search  → the governed `skill.webResearch` tRPC procedure (TASK-023 —
 *              Tier-1 keyless, quarantined, cited)
 *  - read    → `research_read_page` (contained always-on-bottom webview;
 *              outbound-only text channel)
 *  - find    → `research_locate` (Set-of-Mark grid over the reader window's
 *              own image)
 *  - planner → createChatPlanner over `research_chat` (the Groq key never
 *              enters this webview)
 *
 * PROTOTYPE DEVIATION, recorded in TASKS.md: steps run here, not as kernel
 * child Runs, and there is no actuator and no proposal channel — so every
 * amber (click/type) step is blocked honestly by the engine itself. Green
 * tools only. The kernel-Run migration is the follow-up.
 */
import { useRef, useState } from "react";
import {
  runResearch,
  createChatPlanner,
  type ChatMessage,
  type EvidenceEntry,
  type ResearchDeps,
  type ResearchOutcome,
  type SearchHit,
} from "@bridge/research";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { tauriInvokeStrict } from "./tauri-internals";
import { setAvatarStatus } from "./avatar-store";

interface PageExtract {
  url: string;
  title: string;
  text: string;
}

interface Located {
  ref: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shell commands reject with typed {code, message} objects and tRPC with its
 * own error class; normalise BOTH into real Errors so the engine's history —
 * which the planner reads to decide its next step — never says
 * "[object Object]" where the cause should be.
 */
function toError(caught: unknown): Error {
  if (caught instanceof Error) return caught;
  if (caught && typeof caught === "object") {
    const record = caught as Record<string, unknown>;
    if (typeof record.message === "string") {
      return new Error(
        typeof record.code === "string"
          ? `${record.code}: ${record.message}`
          : record.message,
      );
    }
  }
  return new Error(String(caught));
}

/** FNV-1a — same evidence fingerprint the HTTP reader records. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The webResearch mutation returns a governed proposal envelope whose exact
 * nesting belongs to the pipeline; rather than coupling this prototype to it,
 * walk the result for the citations array the output schema guarantees.
 */
function findCitations(value: unknown, depth = 0): SearchHit[] | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const citations = record.citations;
  if (Array.isArray(citations) && citations.length > 0) {
    const hits: SearchHit[] = [];
    for (const entry of citations) {
      if (entry === null || typeof entry !== "object") continue;
      const cite = entry as Record<string, unknown>;
      if (typeof cite.url !== "string" || typeof cite.summary !== "string") continue;
      hits.push({
        url: cite.url,
        title: null,
        excerpt: cite.summary,
        providerId: typeof cite.providerId === "string" ? cite.providerId : "web-research",
        retrievedAt:
          typeof cite.retrievedAt === "string" ? cite.retrievedAt : new Date().toISOString(),
      });
    }
    if (hits.length > 0) return hits;
  }
  for (const child of Object.values(record)) {
    const found = findCitations(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function ResearchRun() {
  const [objective, setObjective] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef({ aborted: false });

  function report(line: string) {
    setSteps((prior) => [...prior, line]);
  }

  async function start() {
    const trimmed = objective.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setSteps([]);
    setOutcome(null);
    setError(null);
    abortRef.current = { aborted: false };
    setAvatarStatus("reading_context");

    const deps: ResearchDeps = {
      signal: abortRef.current,
      planner: createChatPlanner(async (messages: readonly ChatMessage[]) => {
        try {
          return (await tauriInvokeStrict("research_chat", {
            messages: messages.map((message) => ({ ...message })),
          })) as string;
        } catch (caught) {
          throw toError(caught);
        }
      }),
      search: {
        async search(runObjective, query) {
          report(`Searching: ${query}`);
          let raw: unknown;
          try {
            raw = await trpc.agentOrchestration.skill.webResearch.mutate({
              organizationId: PILOT_ORGANIZATION,
              objective: runObjective.slice(0, 500),
              scope: "public_web",
              searchQueries: [query.slice(0, 160)],
              budget: {
                maxResults: 5,
                maxResponseBytes: 256 * 1024,
                maxProviderAttempts: 2,
                timeoutMs: 10_000,
              },
            });
          } catch (caught) {
            const normalised = toError(caught);
            report(`Search failed: ${normalised.message}`);
            throw normalised;
          }
          const hits = findCitations(raw) ?? [];
          report(hits.length > 0 ? `Found ${hits.length} result(s)` : "No results");
          return hits;
        },
      },
      reader: {
        async read(url) {
          report(`Reading: ${url}`);
          let page: PageExtract;
          try {
            page = (await tauriInvokeStrict("research_read_page", { url })) as PageExtract;
          } catch (caught) {
            const normalised = toError(caught);
            report(`Read failed: ${normalised.message}`);
            throw normalised;
          }
          return {
            url: page.url,
            title: page.title || null,
            text: page.text,
            retrievedAt: new Date().toISOString(),
            contentHash: fingerprint(page.text),
            bytes: page.text.length,
          };
        },
      },
      locator: {
        async find(description) {
          report(`Locating: ${description}`);
          let located: Located | null;
          try {
            located = (await tauriInvokeStrict("research_locate", {
              description,
            })) as Located | null;
          } catch (caught) {
            const normalised = toError(caught);
            report(`Locate failed: ${normalised.message}`);
            throw normalised;
          }
          return located
            ? { ...located, ref: located.ref, description: located.description }
            : null;
        },
      },
      // No actuator and no proposal channel on purpose: this prototype is
      // green-tools-only, and the engine blocks amber steps honestly.
    };

    try {
      const result = await runResearch(
        { runId: `overlay-${Date.now()}`, objective: trimmed },
        deps,
      );
      setOutcome(result);
    } catch (caught) {
      setError(
        caught && typeof caught === "object" && "message" in caught
          ? String((caught as { message: unknown }).message)
          : String(caught),
      );
    } finally {
      setRunning(false);
      setAvatarStatus("idle");
      // The reader window has served its purpose for this Run.
      void tauriInvokeStrict("research_close").catch(() => undefined);
    }
  }

  function stop() {
    abortRef.current.aborted = true;
    report("Stopping after the current step…");
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-sm" style={{ minHeight: 0, overflowY: "auto" }}>
      <p className="text-xs text-[var(--color-navy-mid)]">
        A background Research Run: searches the public web, reads pages in a contained
        always-on-bottom browser window you can watch, and returns a cited brief. It never
        clicks, types, or signs in.
      </p>
      <textarea
        value={objective}
        onChange={(event) => setObjective(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void start();
          }
        }}
        placeholder="What should Bridge research?"
        rows={2}
        disabled={running}
        className="w-full rounded border border-[var(--color-border)] bg-white p-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || objective.trim().length === 0}
          className="rounded bg-[var(--color-navy)] px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {running ? "Researching…" : "Research this"}
        </button>
        {running && (
          <button
            type="button"
            onClick={stop}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          >
            Stop
          </button>
        )}
      </div>
      {steps.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {steps.map((line, index) => (
            <li key={index}>• {line}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {outcome && (
        <div className="flex flex-col gap-1">
          <p className="whitespace-pre-wrap">{outcome.brief}</p>
          <p className="text-xs text-muted-foreground">
            {outcome.stepsTaken} step(s) · stopped: {outcome.stopReason.replace(/_/g, " ")}
          </p>
          {outcome.injectionReports.length > 0 && (
            <div className="text-xs text-amber-700">
              {outcome.injectionReports.map((line, index) => (
                <p key={index}>⚠ {line}</p>
              ))}
            </div>
          )}
          {outcome.blockedActions.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {outcome.blockedActions.map((line, index) => (
                <p key={index}>⛔ {line}</p>
              ))}
            </div>
          )}
          {outcome.citations.length > 0 && (
            <ul className="text-xs text-[var(--color-navy-mid)]">
              {outcome.citations.map((url) => (
                <li key={url} className="truncate">
                  {url}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Evidence view kept minimal on purpose; the Run detail Page owns depth. */
export type { EvidenceEntry };
