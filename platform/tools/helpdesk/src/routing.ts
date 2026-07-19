/**
 * Help Request routing — the `helpdesk.capability-routing` capability
 * (module.yaml at this module's root; format = docs/raw/
 * capability-module-format.md, ADR-018). Pure logic, no store: a help
 * request is routed over the organization graph (the caller supplies candidate
 * responders — e.g. organization members enriched with topic tags); scoring is
 * deterministic keyword overlap, mirroring the deterministic-fallback
 * discipline of @bridge/core's classifyIntent (offline mode must still
 * answer; a model-backed ranker is a later, separate concern).
 *
 * Vocabulary: Help Request / Help Route / Help Offer (kernel-safe — the
 * ADR-018 Helpdesk sketch's terms), never Ticket/Lead/Case at this seam.
 */

export interface HelpRequestInput {
  subject: string;
  body: string;
}

/** A candidate responder node from the organization graph — id + the topics
 * they can help with (skills/interests as free-text tags). */
export interface HelpResponderCandidate {
  personId: string;
  displayName: string;
  topics: string[];
}

export interface HelpRoute {
  personId: string;
  displayName: string;
  /** 0..1 — fraction of request tokens matched by the responder's topics. */
  score: number;
  /** The topic tags that matched, for the approval card's "why" line. */
  matchedTopics: string[];
}

const TOKEN_RE = /[a-z0-9][a-z0-9'-]*/g;

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 2));
}

/**
 * Route a help request over the supplied graph slice: score every candidate
 * by topic-token overlap with the request's subject+body, return matches
 * ranked best-first. Deterministic (stable sort with personId tiebreak) —
 * no wall-clock/model dependency, so tests and offline mode behave
 * identically. Zero-match candidates are excluded: an honest empty result
 * beats a fabricated route.
 */
export function routeHelpRequest(request: HelpRequestInput, candidates: HelpResponderCandidate[], limit = 3): HelpRoute[] {
  const requestTokens = tokenize(`${request.subject} ${request.body}`);
  if (requestTokens.size === 0) return [];

  const routes: HelpRoute[] = [];
  for (const candidate of candidates) {
    const matchedTopics: string[] = [];
    const matchedRequestTokens = new Set<string>();
    const seenTopics = new Set<string>();
    for (const topic of candidate.topics) {
      const topicTokens = tokenize(topic);
      const hits = [...topicTokens].filter((t) => requestTokens.has(t));
      if (hits.length > 0) {
        const topicKey = topic.trim().toLowerCase();
        if (!seenTopics.has(topicKey)) {
          seenTopics.add(topicKey);
          matchedTopics.push(topic);
        }
        for (const token of hits) matchedRequestTokens.add(token);
      }
    }
    if (matchedTopics.length === 0) continue;
    routes.push({
      personId: candidate.personId,
      displayName: candidate.displayName,
      score: matchedRequestTokens.size / requestTokens.size,
      matchedTopics,
    });
  }

  routes.sort((a, b) => b.score - a.score || a.personId.localeCompare(b.personId));
  return routes.slice(0, limit);
}

/**
 * Draft a Help Offer — the `helpdesk.offer-drafting` capability. Produces
 * the PROPOSAL INPUTS shape the caller stages through pipeline.propose
 * (draft-then-approve; this function never sends/commits anything itself —
 * advisory band by construction, matching the module.yaml declaration).
 */
export interface HelpOfferDraft {
  kind: "help_offer";
  requestSubject: string;
  routedTo: string; // personId
  routeEvidence: {
    displayName: string;
    score: number;
    matchedTopics: string[];
    topicSource: "caller_supplied";
  };
  draftBody: string;
}

export function draftHelpOffer(request: HelpRequestInput, route: HelpRoute, draftBody: string): HelpOfferDraft {
  if (!draftBody.trim()) {
    throw new Error("help offer: draft body must be non-empty");
  }
  return {
    kind: "help_offer",
    requestSubject: request.subject,
    routedTo: route.personId,
    routeEvidence: {
      displayName: route.displayName,
      score: route.score,
      matchedTopics: [...route.matchedTopics],
      topicSource: "caller_supplied",
    },
    draftBody,
  };
}
