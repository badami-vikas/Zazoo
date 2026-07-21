import {
  SearchRequestBoundsError,
  normalizeSearchRequest,
  type SearchProviderRouter,
  type Skill,
} from "@bridge/core";

export const WEB_RESEARCH_SKILL_ID = "web-research";

export interface WebResearchSkillInput {
  objective: string;
  searchQueries: readonly string[];
  maxResults?: number;
  timeoutMs?: number;
}

function parseInput(value: unknown): WebResearchSkillInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new SearchRequestBoundsError(
      "web-research input must be an object",
    );
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "objective",
    "searchQueries",
    "maxResults",
    "timeoutMs",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new SearchRequestBoundsError(
      "web-research input contains an unsupported field",
    );
  }
  if (
    typeof input.objective !== "string" ||
    !Array.isArray(input.searchQueries) ||
    input.searchQueries.some((query) => typeof query !== "string") ||
    (input.maxResults !== undefined &&
      typeof input.maxResults !== "number") ||
    (input.timeoutMs !== undefined && typeof input.timeoutMs !== "number")
  ) {
    throw new SearchRequestBoundsError(
      "web-research input has an invalid field type",
    );
  }
  return {
    objective: input.objective,
    searchQueries: input.searchQueries as string[],
    ...(typeof input.maxResults === "number"
      ? { maxResults: input.maxResults }
      : {}),
    ...(typeof input.timeoutMs === "number"
      ? { timeoutMs: input.timeoutMs }
      : {}),
  };
}

export function createWebResearchSkill(
  providers: SearchProviderRouter,
): Skill {
  return {
    name: WEB_RESEARCH_SKILL_ID,
    async run(rawInput, ctx) {
      const input = parseInput(rawInput);
      const request = normalizeSearchRequest({
        objective: input.objective,
        searchQueries: input.searchQueries,
        maxResults: input.maxResults ?? 5,
        timeoutMs: input.timeoutMs ?? 12_000,
        requestId: ctx.ids.next(),
        requestedAt: ctx.clock.nowISO(),
      });
      const result = await providers.search(request);
      return {
        proposedOutput: {
          kind: "web_research",
          objective: request.objective,
          searchQueries: request.searchQueries,
          citations: result.citations,
          warnings: result.warnings,
          provenance: result.provenance,
          providerAttempts: result.attempts,
          trustOrigin: "untrusted_external",
        },
        trustOrigin: "untrusted_external",
      };
    },
  };
}
