/**
 * The Research Run engine (TASK-028): plan → act → observe → replan, bounded,
 * with every irreversible action gated.
 *
 * Design rules this file exists to enforce:
 *  - A Run ALWAYS terminates with a recorded reason. Every exit path sets a
 *    `StopReason`; there is no path that simply stops looping.
 *  - Authority is decided by the ENGINE from the step's tool and target, not
 *    by the planner. A planner that asks to click gets a Proposal; it cannot
 *    grant itself permission by phrasing the step differently.
 *  - External text never reaches the planner's instruction channel — it is
 *    quarantined at the boundary and passed as labelled observations.
 *  - Red actions are refused, never proposed: there is no "ask the user to
 *    approve entering a password" flow, because that flow should not exist.
 */
import {
  DEFAULT_RESEARCH_BOUNDS,
  type AuthorityTier,
  type EvidenceEntry,
  type PlannedStep,
  type QuarantinedText,
  type ResearchBounds,
  type ResearchDeps,
  type ResearchOutcome,
  type ResearchToolName,
  type StopReason,
} from "./ports.js";
import { detectInjection, quarantine } from "./injection.js";

/**
 * Targets that are refused outright (plan §3 RED). Matched against the URL
 * of the page an action would touch. A red action never becomes a Proposal:
 * asking a user to approve a credential entry normalises exactly the thing
 * that must stay impossible.
 */
const RED_URL_PATTERNS: readonly RegExp[] = [
  /\/(login|signin|sign-in|auth|oauth|sso)(\/|\?|$)/i,
  /\/(checkout|payment|billing|purchase|order)(\/|\?|$)/i,
  /\/(account|settings|preferences)\/(security|password|privacy)(\/|\?|$)/i,
  /\bcaptcha\b/i,
];

/** Text in a step that indicates a refused action regardless of URL. */
const RED_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(password|passphrase|credential|api[_\s-]?key|secret|otp|2fa|one[-\s]?time\s+code|cvv|card\s+number|ssn)\b/i,
  /\b(buy|purchase|pay|checkout|subscribe|transfer\s+funds?)\b/i,
  /\b(post|publish|tweet|send\s+(email|message|dm)|submit\s+(review|comment))\b/i,
];

export function classifyAuthority(step: PlannedStep, currentUrl: string | null): AuthorityTier {
  if (step.tool === "search" || step.tool === "read" || step.tool === "find" || step.tool === "note") {
    // Reading is autonomous — but never into a credential or payment page.
    if (step.tool === "read" && isRedUrl(step.argument)) return "red";
    return "green";
  }
  // click / type: actuation.
  const haystack = `${step.argument} ${step.text ?? ""} ${step.rationale}`;
  if (RED_INTENT_PATTERNS.some((pattern) => pattern.test(haystack))) return "red";
  if (currentUrl && isRedUrl(currentUrl)) return "red";
  return "amber";
}

function isRedUrl(url: string): boolean {
  return RED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export interface RunResearchOptions {
  runId: string;
  objective: string;
  bounds?: Partial<ResearchBounds>;
  /**
   * BR4: continue a Run that was interrupted (app restart, crash, stop).
   * Prior steps are replayed from the ledger as history and evidence — they
   * are NOT re-executed, so a resumed Run never re-clicks anything and never
   * re-spends its page or byte budget on work already done.
   */
  resume?: boolean;
}

export async function runResearch(
  options: RunResearchOptions,
  deps: ResearchDeps,
): Promise<ResearchOutcome> {
  const bounds: ResearchBounds = { ...DEFAULT_RESEARCH_BOUNDS, ...options.bounds };
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const evidence: EvidenceEntry[] = [];
  const observations: QuarantinedText[] = [];
  const history: string[] = [];
  const citations: string[] = [];
  const blockedActions: string[] = [];
  const injectionReports: string[] = [];

  let pagesRead = 0;
  let totalBytes = 0;
  let stepIndex = 0;
  let currentUrl: string | null = null;
  let stopReason: StopReason = "planner_finished";

  if (options.resume && deps.ledger) {
    const prior = await deps.ledger.load(options.runId);
    for (const entry of prior) {
      evidence.push(entry);
      history.push(entry.summary);
      if (entry.sourceUrl) citations.push(entry.sourceUrl);
      if (entry.quarantined) observations.push(entry.quarantined);
      if (entry.tool === "read") pagesRead += 1;
      // Consumed budget carries over: a resumed Run must not get a fresh
      // allowance by virtue of having been interrupted.
      stepIndex = Math.max(stepIndex, entry.stepIndex + 1);
    }
  }

  const record = async (entry: EvidenceEntry): Promise<void> => {
    evidence.push(entry);
    if (deps.ledger) await deps.ledger.append(options.runId, entry);
  };

  while (true) {
    if (deps.signal?.aborted) {
      stopReason = "cancelled";
      break;
    }
    if (stepIndex >= bounds.maxSteps) {
      stopReason = "bound_steps";
      break;
    }
    if (now() - startedAt >= bounds.maxWallClockMs) {
      stopReason = "bound_wall_clock";
      break;
    }

    let step: PlannedStep | null;
    try {
      step = await deps.planner.next({
        objective: options.objective,
        history,
        observations,
        stepsRemaining: bounds.maxSteps - stepIndex,
      });
    } catch (error) {
      history.push(`Planning failed: ${errorText(error)}`);
      stopReason = "planner_failed";
      break;
    }
    if (!step) {
      stopReason = "planner_finished";
      break;
    }

    const tier = classifyAuthority(step, currentUrl);
    if (tier === "red") {
      const refusal = `Refused ${step.tool} (${truncate(step.argument, 120)}): this touches credentials, payment, or publishing, which Bridge never does on your behalf.`;
      blockedActions.push(refusal);
      history.push(refusal);
      await record({
        stepIndex,
        tool: step.tool,
        summary: refusal,
        sourceUrl: currentUrl,
      });
      stepIndex += 1;
      // A refusal is not fatal — the planner may choose another route — but
      // a planner that only wants red actions will exhaust its step bound.
      continue;
    }

    if (tier === "amber") {
      if (!deps.proposals) {
        const refusal = `Blocked ${step.tool}: this Run has no approval channel, so it cannot act on a page.`;
        blockedActions.push(refusal);
        history.push(refusal);
        stepIndex += 1;
        continue;
      }
      const decision = await deps.proposals.request({
        runId: options.runId,
        stepIndex,
        tool: step.tool,
        summary: proposalSummary(step, currentUrl),
        url: currentUrl,
      });
      if (decision !== "approved") {
        const rejected = `You declined: ${proposalSummary(step, currentUrl)}`;
        blockedActions.push(rejected);
        history.push(rejected);
        await record({
          stepIndex,
          tool: step.tool,
          summary: rejected,
          sourceUrl: currentUrl,
        });
        stepIndex += 1;
        continue;
      }
    }

    // ---- execute -------------------------------------------------------
    try {
      switch (step.tool) {
        case "search": {
          const hits = await deps.search.search(options.objective, step.argument);
          for (const hit of hits) {
            citations.push(hit.url);
            const observation = quarantine(hit.url, `${hit.title ?? ""}\n${hit.excerpt}`);
            const findings = detectInjection(observation);
            if (findings.length > 0) {
              injectionReports.push(
                `Search result ${hit.url} contains text addressed to the agent: "${findings[0]!.excerpt}"`,
              );
              continue;
            }
            observations.push(observation);
            await record({
              stepIndex,
              tool: "search",
              summary: `Found: ${hit.title ?? hit.url}`,
              sourceUrl: hit.url,
              quarantined: observation,
            });
          }
          history.push(`Searched "${truncate(step.argument, 80)}" — ${hits.length} result(s).`);
          break;
        }

        case "read": {
          if (!deps.reader) {
            history.push("Reading pages is unavailable in this Run.");
            break;
          }
          if (pagesRead >= bounds.maxPages) {
            stopReason = "bound_pages";
            return finish();
          }
          const page = await deps.reader.read(step.argument);
          pagesRead += 1;
          totalBytes += page.bytes;
          currentUrl = page.url;
          citations.push(page.url);
          const observation = quarantine(page.url, page.text);
          const findings = detectInjection(observation);
          if (findings.length > 0) {
            const report = `${page.url} contains instructions aimed at the agent — reported, not followed: "${findings[0]!.excerpt}"`;
            injectionReports.push(report);
            history.push(report);
            await record({
              stepIndex,
              tool: "read",
              summary: report,
              sourceUrl: page.url,
            });
            stepIndex += 1;
            if (totalBytes >= bounds.maxTotalBytes) {
              stopReason = "bound_bytes";
              return finish();
            }
            continue;
          }
          observations.push(observation);
          await record({
            stepIndex,
            tool: "read",
            summary: `Read ${page.title ?? page.url}`,
            sourceUrl: page.url,
            quarantined: observation,
          });
          history.push(`Read ${truncate(page.title ?? page.url, 80)}.`);
          if (totalBytes >= bounds.maxTotalBytes) {
            stopReason = "bound_bytes";
            return finish();
          }
          break;
        }

        case "find": {
          if (!deps.locator) {
            history.push("Element location is unavailable in this Run.");
            break;
          }
          const element = await deps.locator.find(step.argument);
          const summary = element
            ? `Located "${truncate(step.argument, 60)}" at ${Math.round(element.x)},${Math.round(element.y)}.`
            : `Could not find "${truncate(step.argument, 60)}" on this page.`;
          history.push(summary);
          await record({ stepIndex, tool: "find", summary, sourceUrl: currentUrl });
          break;
        }

        case "click": {
          if (!deps.actuator) {
            history.push("Clicking is unavailable in this Run.");
            break;
          }
          await deps.actuator.click(step.argument);
          const summary = `Clicked ${truncate(step.argument, 60)} (you approved this).`;
          history.push(summary);
          await record({ stepIndex, tool: "click", summary, sourceUrl: currentUrl });
          break;
        }

        case "type": {
          if (!deps.actuator) {
            history.push("Typing is unavailable in this Run.");
            break;
          }
          await deps.actuator.type(step.argument, step.text ?? "");
          const summary = `Typed into ${truncate(step.argument, 60)} (you approved this).`;
          history.push(summary);
          await record({ stepIndex, tool: "type", summary, sourceUrl: currentUrl });
          break;
        }

        case "note": {
          const summary = truncate(step.argument, 400);
          history.push(`Noted: ${summary}`);
          await record({ stepIndex, tool: "note", summary, sourceUrl: currentUrl });
          break;
        }
      }
    } catch (error) {
      const failure = `Step ${stepIndex} (${step.tool}) failed: ${errorText(error)}`;
      history.push(failure);
      await record({ stepIndex, tool: step.tool, summary: failure, sourceUrl: currentUrl });
    }

    stepIndex += 1;
  }

  return finish();

  async function finishAsync(): Promise<ResearchOutcome> {
    let brief: string;
    try {
      brief = await deps.planner.synthesize(options.objective, evidence);
    } catch (error) {
      brief = `No brief could be composed (${errorText(error)}). The evidence gathered so far is preserved below.`;
    }
    return {
      runId: options.runId,
      objective: options.objective,
      brief,
      evidence,
      citations: [...new Set(citations)],
      stopReason,
      stepsTaken: stepIndex,
      blockedActions,
      injectionReports,
    };
  }

  // Hoisted so every `return finish()` above is a single expression.
  function finish(): Promise<ResearchOutcome> {
    return finishAsync();
  }
}

function proposalSummary(step: PlannedStep, currentUrl: string | null): string {
  const where = currentUrl ? ` on ${currentUrl}` : "";
  return step.tool === "type"
    ? `Type "${truncate(step.text ?? "", 60)}" into ${truncate(step.argument, 60)}${where}`
    : `Click ${truncate(step.argument, 60)}${where}`;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { ResearchToolName };
