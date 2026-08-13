/**
 * Speaker-row extraction from an Event page's raw HTML (TASK-070 follow-on).
 *
 * Pure: no fetch, no clock, no id generation. Two strategies, tried in order:
 *
 *   1. JSON-LD `schema.org/Person` entries (inside `Event`/`speaker`/
 *      `performer` fields, or bare `Person` objects anywhere on the page).
 *      This is the strategy that actually generalizes — a real subset of
 *      conference sites emit structured data, and when they do it is
 *      unambiguous: no regex guessing over prose.
 *   2. A text-heuristic fallback over the tag-stripped body: lines shaped like
 *      "Name — Affiliation" or "Name, Affiliation" are accepted; everything
 *      else is dropped rather than guessed at, because a false speaker row
 *      becomes a false Person proposal downstream.
 *
 * ponytail: the text heuristic is a narrow, single-pattern scan — real pages
 * vary a lot more than this. Upgrade path if JSON-LD coverage proves too thin
 * in practice: swap the fallback for an LLM extraction pass over the
 * tag-stripped text, same output shape.
 */

export interface SpeakerCandidate {
  name: string;
  affiliation?: string;
  talkTitle?: string;
}

interface JsonLdPerson {
  "@type"?: string | string[];
  name?: string;
  affiliation?: { name?: string } | string;
  jobTitle?: string;
}

function isPersonNode(value: unknown): value is JsonLdPerson {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as JsonLdPerson)["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  return types.includes("Person");
}

function affiliationOf(person: JsonLdPerson): string | undefined {
  if (typeof person.affiliation === "string") return person.affiliation.trim() || undefined;
  const name = person.affiliation?.name?.trim();
  return name || undefined;
}

/** Walk an arbitrary parsed JSON-LD value, collecting every Person node found at any depth. */
function collectPeople(value: unknown, out: SpeakerCandidate[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPeople(item, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  if (isPersonNode(value)) {
    const name = value.name?.trim();
    const affiliation = affiliationOf(value);
    if (name) {
      out.push({ name, ...(affiliation ? { affiliation } : {}) });
    }
  }
  for (const child of Object.values(value)) collectPeople(child, out);
}

function extractFromJsonLd(html: string): SpeakerCandidate[] {
  const out: SpeakerCandidate[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      collectPeople(JSON.parse(raw), out);
    } catch {
      // Malformed JSON-LD on the page — skip that block, keep scanning the rest.
    }
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// "Jane Doe — Acme University" / "Jane Doe - Acme University" / "Jane Doe, Acme University".
// Requires a plausible name (2-4 capitalized words) so ordinary prose lines don't match.
const NAME_AFFILIATION_LINE = /^([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){1,3})\s*(?:,|[—–-])\s*(.+)$/;

function extractFromText(html: string): SpeakerCandidate[] {
  const text = stripTags(html);
  const out: SpeakerCandidate[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.length > 160) continue;
    const match = NAME_AFFILIATION_LINE.exec(line);
    if (!match) continue;
    const name = match[1]!.trim();
    const affiliation = match[2]!.trim();
    if (!affiliation || affiliation.length > 120) continue;
    const key = `${name.toLowerCase()}::${affiliation.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, affiliation });
  }
  return out;
}

/** Extract speaker candidates from an Event page's HTML. Never throws on malformed input. */
export function extractSpeakerCandidates(html: string): SpeakerCandidate[] {
  const fromJsonLd = extractFromJsonLd(html);
  if (fromJsonLd.length > 0) return fromJsonLd;
  return extractFromText(html);
}
