// Shared text-field helpers for turning broker prose into DealPilot payload numbers.
//
// These were originally private to connectors.ts (the BizBuySell alert parser). The listing
// crawler's HTML extractor needs the exact same money/label semantics — an alert email and a
// listing card both say "Asking Price: $850,000" — so they live here rather than being duplicated
// with two subtly different notions of what "$1.2M" means.

const MONEY_RE = /\$\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?/;
const LOCATION_RE = /\b([A-Z][a-zA-Z.\s]+,\s*[A-Z]{2})\b/;

/** Collapses HTML to readable text: drops script/style bodies, turns block ends into newlines. */
export function stripHtml(input: string): string {
  return input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Parses the first money value in `text`, honoring a `k`/`m` suffix. Undefined when absent. */
export function parseMoney(text: string): number | undefined {
  const m = text.match(MONEY_RE);
  if (!m) return undefined;
  let value = Number.parseFloat(m[1]!.replace(/,/g, ""));
  if (Number.isNaN(value)) return undefined;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  return value;
}

/** Pull the value following a labeled field like "Asking Price: $850,000". */
export function labeledField(body: string, ...labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, "i");
    const m = body.match(re);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** First "City, ST" shaped string in the text, if any. */
export function findLocation(body: string): string | undefined {
  return body.match(LOCATION_RE)?.[1]?.trim();
}
