// robots.txt parsing and the per-path crawl gate (RFC 9309).
//
// Every listing-crawler fetch runs through `isPathAllowed` BEFORE the request is made. This is a
// compliance boundary, not an optimization: a Source whose robots.txt disallows the listing path is
// not crawled, full stop, and the connector reports why rather than fetching anyway and hoping.
// Deliberately dependency-free — no HTTP here, no caching policy here. The caller owns fetching
// /robots.txt (through the ONE governed network primitive) and owns how long it holds the result.
//
// Matching follows RFC 9309 section 2.2.2:
//   - Groups are keyed by User-agent. The MOST SPECIFIC matching group wins; `*` is the fallback,
//     and a named group completely replaces `*` rather than merging with it.
//   - Within the winning group the LONGEST matching rule wins. On equal length, Allow beats
//     Disallow (the standard's explicit tie-break, and the safer reading for the site owner).
//   - `*` matches any run of characters; a trailing `$` anchors the match to end-of-path.
//   - An empty `Disallow:` value is the documented "allow everything" idiom and carries no rule.
//
// Crawl-delay is not part of RFC 9309, but enough of the sites in DealPilot's catalog publish one
// (vrgatewaystl.com and capstonema.com both do) that ignoring it would be rude at best. It is
// parsed here and honored by the crawler's pacing.

export interface RobotsRule {
  kind: "allow" | "disallow";
  /** The raw path pattern as written in robots.txt, e.g. `/listings/*?`. */
  pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent tokens this group applies to. */
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/** A robots.txt that could not be fetched or parsed carries no rules — see `isPathAllowed`. */
export const EMPTY_ROBOTS: RobotsTxt = { groups: [], sitemaps: [] };

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).trim();
}

/**
 * Parses robots.txt text into groups. Tolerant by design: unknown directives are skipped, and a
 * malformed line never aborts the parse, because a site's typo must not silently turn into
 * "no rules found, crawl everything". Directives that appear before any `User-agent` line are
 * discarded exactly as the standard requires.
 */
export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one group; the first rule line closes the agent list.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!value) continue;
      if (current && acceptingAgents) {
        current.agents.push(value.toLowerCase());
      } else {
        current = { agents: [value.toLowerCase()], rules: [] };
        groups.push(current);
        acceptingAgents = true;
      }
      continue;
    }

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    // Any non-User-agent directive closes the agent list for the current group.
    if (!current) continue;
    acceptingAgents = false;

    if (field === "allow" || field === "disallow") {
      // `Disallow:` with an empty value is the "allow all" idiom and contributes no rule.
      // `Allow:` with an empty value is meaningless and is likewise dropped.
      if (!value) continue;
      current.rules.push({ kind: field, pattern: value });
      continue;
    }

    if (field === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }

  return { groups, sitemaps };
}

/**
 * Compiles a robots path pattern to a regex anchored at the start of the path. `*` becomes `.*`;
 * a trailing `$` anchors the end. Every other regex metacharacter is escaped so a pattern like
 * `/search?q=` cannot accidentally behave as a regex.
 */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/** How specific a pattern is, for longest-match precedence. `*` and `$` are not path characters. */
function patternLength(pattern: string): number {
  return pattern.replace(/[*$]/g, "").length;
}

/**
 * Selects the group that applies to `userAgent`. A named group whose token is a case-insensitive
 * substring of the user-agent wins over `*`; among named matches the longest token wins, so
 * `googlebot-news` beats `googlebot`. Returns null when nothing matches (including no `*` group),
 * which means the file states no policy for this crawler.
 */
export function selectRobotsGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();
  let best: { group: RobotsGroup; score: number } | null = null;
  let wildcard: RobotsGroup | null = null;

  for (const group of robots.groups) {
    for (const token of group.agents) {
      if (token === "*") {
        // Merge duplicate `*` groups rather than letting a later one shadow an earlier one.
        wildcard = wildcard ? mergeGroups(wildcard, group) : group;
        continue;
      }
      if (!agent.includes(token)) continue;
      if (!best || token.length > best.score) best = { group, score: token.length };
    }
  }
  return best?.group ?? wildcard;
}

function mergeGroups(a: RobotsGroup, b: RobotsGroup): RobotsGroup {
  return {
    agents: [...new Set([...a.agents, ...b.agents])],
    rules: [...a.rules, ...b.rules],
    ...(a.crawlDelaySeconds != null || b.crawlDelaySeconds != null
      ? { crawlDelaySeconds: Math.max(a.crawlDelaySeconds ?? 0, b.crawlDelaySeconds ?? 0) }
      : {}),
  };
}

export interface RobotsDecision {
  allowed: boolean;
  /** The rule that decided it, for the audit trail. Absent when no rule matched. */
  matchedRule?: RobotsRule;
  crawlDelaySeconds?: number;
}

/**
 * Decides whether `pathWithQuery` (e.g. `/listings/?page=2`) may be fetched.
 *
 * A robots.txt that states no applicable rule allows the path — that is the standard's default and
 * matches how every major crawler behaves. Note what this does NOT do: it does not treat a failed
 * robots.txt fetch as permission. The caller distinguishes "fetched, no rule" from "could not
 * fetch", because a 403 on robots.txt (bizbuysell.com, premierbb.com) means the site is actively
 * refusing crawlers, which is the opposite of silence.
 */
export function isPathAllowed(
  robots: RobotsTxt,
  pathWithQuery: string,
  userAgent: string,
): RobotsDecision {
  const group = selectRobotsGroup(robots, userAgent);
  if (!group) return { allowed: true };
  const delay = group.crawlDelaySeconds != null ? { crawlDelaySeconds: group.crawlDelaySeconds } : {};

  let winner: RobotsRule | null = null;
  let winnerLength = -1;
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) continue;
    const length = patternLength(rule.pattern);
    if (length > winnerLength) {
      winner = rule;
      winnerLength = length;
    } else if (length === winnerLength && rule.kind === "allow") {
      // Equal-length tie: Allow wins (RFC 9309 section 2.2.2).
      winner = rule;
    }
  }

  if (!winner) return { allowed: true, ...delay };
  return { allowed: winner.kind === "allow", matchedRule: winner, ...delay };
}
