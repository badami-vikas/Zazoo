/**
 * Chief of Staff — the star-topology router (docs/wiki/roadmap.md "Agents (all
 * phases)": "star topology — Chief of Staff sole router, NO peer handoffs · hard
 * chain-depth cap + best-so-far fallback"). This module is PURE intent
 * classification + routing — no I/O, no pipeline call, no ModelProvider network
 * call performed here. apps/api's `chiefOfStaff.converse` procedure is the only
 * place a RoutingDecision ever turns into a `pipeline.propose` call (routed
 * actions are ALWAYS proposals, never direct execution — CLAUDE.md's governed-
 * agentic-execution principle).
 *
 * Star topology, enforced structurally (not by convention):
 *  - `classifyIntent` returns AT MOST ONE `RoutingDecision.route` per call — the
 *    return type has no field for a list of downstream targets, so there is no
 *    code path to "route to two capabilities in one turn."
 *  - `RoutingDecision.chainDepth` is caller-supplied (the caller — apps/api —
 *    tracks how many hops a conversation has taken) and `assertChainDepth`
 *    throws `ChainDepthExceededError` once depth reaches `MAX_CHAIN_DEPTH`,
 *    modeling "hard chain-depth cap" as a real thrown error rather than a
 *    convention callers might forget to check.
 *  - There is no `peers`/`handoff` field anywhere in this module's types — a
 *    downstream capability cannot itself request a further route; the star
 *    shape (Chief of Staff is the ONLY node that ever decides where a message
 *    goes) is expressed by the type surface having nowhere to put a peer link.
 *
 * Model-agnostic: `classifyIntent` takes an optional `ModelProvider` (the
 * @bridge/core seam every model call goes through, ports.ts). When a provider
 * IS supplied, its `complete()` is called with a constrained prompt asking for
 * one of the known route ids back, verbatim, and the response is validated
 * against the same registry the keyword fallback uses (a hallucinated route id
 * falls back to "clarify", never an invented route). When no provider is
 * supplied (in-memory/offline mode must still work — CLAUDE.md/roadmap P0
 * "kernel runs with ZERO providers"), a DETERMINISTIC keyword-match fallback
 * classifies instead. Both paths funnel through the same registry validation,
 * so the offline fallback is not a lesser code path — it is the SAME contract
 * with a different signal source.
 */
import { createModelCallReceipt, type ModelCallReceipt, type ModelProvider } from "./ports.js";

/** A downstream capability Chief of Staff can route a single turn to. Kept as
 * a closed, caller-supplied registry (mirrors compileBlueprint's registered-
 * node-types design in blueprint.ts) — an unregistered route id is never
 * returned, only ever rejected back to "clarify". */
export interface RoutableCapability {
  id: string;
  /** Short description used both in the model-classification prompt and as
   * the keyword-fallback's match vocabulary (space-separated terms). */
  description: string;
  /** Keyword-fallback match terms (lowercase). Falls back to splitting
   * `description` on whitespace when omitted. */
  keywords?: string[];
}

/** The star topology's hard depth cap (roadmap.md: "hard chain-depth cap +
 * best-so-far fallback"). A conversation turn's `chainDepth` counts how many
 * routing hops have already happened THIS conversation; once it would reach
 * this cap, `assertChainDepth` throws rather than routing further. Kept as a
 * named constant (not a magic number) so a future `policy_params` binding can
 * override it without touching call sites, mirroring
 * `capability/approvals.ts`'s `AUTO_ACTIVATION_BUDGETS` pattern. */
export const MAX_CHAIN_DEPTH = 3;

export class ChainDepthExceededError extends Error {
  constructor(depth: number) {
    super(`chief-of-staff: chain depth ${depth} would exceed the hard cap of ${MAX_CHAIN_DEPTH} — routing stops here (best-so-far fallback)`);
    this.name = "ChainDepthExceededError";
  }
}

/** Throws when routing this turn would exceed the star topology's hard chain-
 * depth cap. Callers (apps/api's chiefOfStaff.converse) call this BEFORE
 * attempting a route and, on throw, fall back to replying directly (best-so-
 * far: the conversation still gets an answer, just not a further hop). */
export function assertChainDepth(chainDepth: number): void {
  if (chainDepth >= MAX_CHAIN_DEPTH) {
    throw new ChainDepthExceededError(chainDepth);
  }
}

/** The one and only thing a Chief-of-Staff turn ever decides: reply directly,
 * or route to AT MOST ONE downstream capability. There is deliberately no
 * array/list field here — the type itself cannot express "route to two
 * things," which is the star topology's "no peer handoffs" rule made
 * structural rather than conventional. */
export interface RoutingDecision {
  /** "route" = hand this turn to exactly one downstream capability (by id);
   * "clarify" = Chief of Staff could not confidently classify intent and asks
   * a clarifying question instead of guessing a route; "direct_reply" =
   * Chief of Staff answers itself, no routing needed. */
  kind: "route" | "clarify" | "direct_reply";
  /** Populated only when kind === "route" — the single downstream capability id. */
  route?: string;
  /** 0-1 confidence signal. Model-classified turns carry the provider's
   * self-reported confidence (clamped); keyword-fallback turns report a
   * simple match-strength score. Not authoritative on its own — callers decide
   * their own confidence threshold for auto-routing vs. clarifying. */
  confidence: number;
  /** Human-readable reason surfaced to the UI (chat panel's "why did it route
   * here" honesty requirement — CLAUDE.md "explain before automating"). */
  reason: string;
  /** Which path produced this decision — surfaced so the UI/tests can tell a
   * real model classification from the offline keyword fallback. */
  source: "model" | "keyword_fallback";
  /** Present only when a real provider classified the turn. Callers may persist
   * this receipt without retaining the prompt or response body. */
  modelReceipt?: ModelCallReceipt;
}

/** Structured input to `classifyIntent` — one user message plus the closed
 * registry of capabilities it may route to. */
export interface ClassifyIntentArgs {
  message: string;
  registry: readonly RoutableCapability[];
  /** Optional ModelProvider (ports.ts seam). Omit for the deterministic
   * keyword-only path — in-memory/offline mode MUST classify without one. */
  model?: ModelProvider;
}

const CLARIFY_REASON_NO_MATCH = "no registered capability's keywords matched the message confidently enough";

/** Deterministic keyword-match fallback: scores every registry entry by how
 * many of its keywords appear in the (lowercased) message, picks the highest
 * non-zero scorer, and falls back to "clarify" on a total miss. No randomness,
 * no network, no clock — same input always yields the same decision, so
 * in-memory-mode tests can assert on it exactly. */
function classifyByKeyword(message: string, registry: readonly RoutableCapability[]): RoutingDecision {
  const normalized = message.toLowerCase();
  let best: { cap: RoutableCapability; score: number } | undefined;

  for (const cap of registry) {
    const terms = (cap.keywords ?? cap.description.toLowerCase().split(/\s+/)).map((t) => t.toLowerCase());
    let score = 0;
    for (const term of terms) {
      if (term.length > 0 && normalized.includes(term)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { cap, score };
    }
  }

  if (!best) {
    return { kind: "clarify", confidence: 0, reason: CLARIFY_REASON_NO_MATCH, source: "keyword_fallback" };
  }

  // Confidence is a simple, transparent function of match strength — not tuned
  // against any real distribution (there is no training signal here), just a
  // bounded, monotonic score callers can compare across calls.
  const confidence = Math.min(1, best.score / 3);
  return {
    kind: "route",
    route: best.cap.id,
    confidence,
    reason: `keyword match against "${best.cap.id}" (${best.cap.description}), score ${best.score}`,
    source: "keyword_fallback",
  };
}

/** Parse a model's raw completion text into a route id, validated against the
 * registry — a hallucinated or malformed response NEVER produces an invented
 * route; it degrades to "clarify" instead. Expected format: the model is
 * prompted to answer with EITHER a bare registered capability id, or the
 * literal token "CLARIFY". */
function parseModelResponse(text: string, registry: readonly RoutableCapability[]): RoutingDecision {
  const trimmed = text.trim();
  if (/^clarify$/i.test(trimmed)) {
    return { kind: "clarify", confidence: 0.5, reason: "model classifier returned CLARIFY", source: "model" };
  }
  const match = registry.find((cap) => cap.id.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    return {
      kind: "clarify",
      confidence: 0,
      reason: `model response "${trimmed}" did not match any registered capability id — degrading to clarify rather than inventing a route`,
      source: "model",
    };
  }
  return {
    kind: "route",
    route: match.id,
    confidence: 0.8,
    reason: `model classified intent as "${match.id}" (${match.description})`,
    source: "model",
  };
}

function classificationPrompt(message: string, registry: readonly RoutableCapability[]): { system: string; prompt: string } {
  const options = registry.map((cap) => `- ${cap.id}: ${cap.description}`).join("\n");
  return {
    system:
      "You are Chief of Staff, a routing classifier. Given a user message, respond with EXACTLY ONE bare capability id from the list below that best matches the user's intent, or the literal word CLARIFY if none confidently apply. Respond with nothing else — no punctuation, no explanation.\n\n" +
      options,
    prompt: message,
  };
}

/**
 * Classify one user message into a `RoutingDecision`. Uses `args.model` when
 * supplied (a real ModelProvider.complete() call, prompted to answer with a
 * registered id or CLARIFY); falls back to the deterministic keyword matcher
 * when no provider is supplied — this fallback path is what keeps in-memory/
 * offline mode functional with no model configured (roadmap P0: "kernel runs
 * with ZERO providers").
 *
 * Never returns more than one route (star topology, no peer handoffs) and
 * never returns a route id outside `args.registry` (both the model and
 * keyword paths validate against the same closed registry).
 */
export async function classifyIntent(args: ClassifyIntentArgs): Promise<RoutingDecision> {
  if (!args.model) {
    return classifyByKeyword(args.message, args.registry);
  }
  const { system, prompt } = classificationPrompt(args.message, args.registry);
  const result = await args.model.complete({
    system,
    prompt,
    maxTokens: 32,
    tier: "cheap",
    cache: { strategy: "stable_system_prefix", ttl: "5m" },
  });
  return {
    ...parseModelResponse(result.text, args.registry),
    modelReceipt: createModelCallReceipt(args.model, result, "cheap"),
  };
}
