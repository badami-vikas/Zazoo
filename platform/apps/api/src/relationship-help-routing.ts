/**
 * Deterministic Help Request routing owned by the installed Relationship Module.
 * Persistence stays in the shared Helpdesk store and governed drafts still pass
 * through the universal Action pipeline.
 */
export interface HelpRequestInput {
  subject: string;
  body: string;
}

export interface HelpResponderCandidate {
  personId: string;
  displayName: string;
  topics: string[];
}

export interface HelpRoute {
  personId: string;
  displayName: string;
  score: number;
  matchedTopics: string[];
}

export interface HelpOfferDraft {
  kind: "help_offer";
  requestSubject: string;
  routedTo: string;
  routeEvidence: {
    displayName: string;
    score: number;
    matchedTopics: string[];
    topicSource: "caller_supplied";
  };
  draftBody: string;
}

const TOKEN_RE = /[a-z0-9][a-z0-9'-]*/g;

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(TOKEN_RE) ?? []).filter((token) => token.length > 2));
}

export function routeHelpRequest(
  request: HelpRequestInput,
  candidates: HelpResponderCandidate[],
  limit = 3,
): HelpRoute[] {
  const requestTokens = tokenize(`${request.subject} ${request.body}`);
  if (requestTokens.size === 0) return [];

  const routes: HelpRoute[] = [];
  for (const candidate of candidates) {
    const matchedTopics: string[] = [];
    const matchedRequestTokens = new Set<string>();
    const seenTopics = new Set<string>();
    for (const topic of candidate.topics) {
      const hits = [...tokenize(topic)].filter((token) => requestTokens.has(token));
      if (hits.length === 0) continue;
      const topicKey = topic.trim().toLowerCase();
      if (!seenTopics.has(topicKey)) {
        seenTopics.add(topicKey);
        matchedTopics.push(topic);
      }
      for (const token of hits) matchedRequestTokens.add(token);
    }
    if (matchedTopics.length === 0) continue;
    routes.push({
      personId: candidate.personId,
      displayName: candidate.displayName,
      score: matchedRequestTokens.size / requestTokens.size,
      matchedTopics,
    });
  }

  routes.sort((left, right) => right.score - left.score || left.personId.localeCompare(right.personId));
  return routes.slice(0, limit);
}

export function draftHelpOffer(
  request: HelpRequestInput,
  route: HelpRoute,
  draftBody: string,
): HelpOfferDraft {
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
