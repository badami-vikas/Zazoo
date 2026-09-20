/**
 * field-match — how the Avatar decides which copied field belongs in which
 * control of the form in front, and which typed phrases mean "copy the
 * fields" / "fill this form". Pure functions, no DOM, no Tauri: the panel
 * (FieldsRun) shows the result and the USER decides what is filled.
 *
 * A match has a tier the user can gate on:
 *  - `exact`: same label after normalisation or a known synonym;
 *  - `close`: strong token overlap, or an unambiguous subset ("Year" ⊂
 *    "Vehicle Year" when nothing else contains "year");
 *  - `none`: left empty.
 */
export interface MatchField {
  label: string;
  value: string;
  kind: string;
}

export type MatchTier = "exact" | "close" | "none";

export interface MappingRow {
  target: MatchField;
  source: MatchField | null;
  tier: MatchTier;
}

export function normalizeLabel(label: string): string {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ponytail: hand-written synonym groups; swap for a model-backed mapper when a real portal defeats them.
const SYNONYMS: string[][] = [
  ["first name", "given name", "forename", "first"],
  ["last name", "surname", "family name", "last"],
  ["email", "e mail", "email address", "e mail address"],
  ["phone", "telephone", "mobile", "cell", "phone number", "mobile number"],
  ["dob", "date of birth", "birth date", "birthdate", "birthday"],
  ["street", "address", "address line 1", "street address"],
  ["zip", "zip code", "postal code", "postcode"],
  ["state", "province", "region"],
  ["vin", "vehicle identification number"],
  ["married", "marital status"],
  ["gender", "sex"],
];

function canonical(label: string): string {
  const n = normalizeLabel(label);
  for (const group of SYNONYMS) if (group.includes(n)) return group[0];
  return n;
}

function tokens(s: string): Set<string> {
  return new Set(normalizeLabel(s).split(" ").filter(Boolean));
}

export function matchScore(a: string, b: string): number {
  const A = canonical(a);
  const B = canonical(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = tokens(A);
  const tb = tokens(B);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared ? shared / Math.max(ta.size, tb.size) : 0;
}

function isSubset(a: string, b: string): boolean {
  const ta = tokens(canonical(a));
  const tb = tokens(canonical(b));
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return small.size > 0 && [...small].every((t) => large.has(t));
}

const CLOSE_MIN = 0.6;

/** The best copied field for one target label, with its tier. */
export function bestMatch(label: string, sources: MatchField[]): { source: MatchField; tier: MatchTier } | null {
  let best: { source: MatchField; score: number } | null = null;
  for (const source of sources) {
    const score = matchScore(label, source.label);
    if (score >= CLOSE_MIN && (!best || score > best.score)) best = { source, score };
  }
  if (best) return { source: best.source, tier: best.score >= 1 ? "exact" : "close" };
  const subsets = sources.filter((s) => isSubset(label, s.label));
  return subsets.length === 1 ? { source: subsets[0], tier: "close" } : null;
}

/** One row per target control, in the order the form shows them. */
export function planFill(targets: MatchField[], sources: MatchField[]): MappingRow[] {
  return targets.map((target) => {
    const hit = bestMatch(target.label, sources);
    return hit ? { target, source: hit.source, tier: hit.tier } : { target, source: null, tier: "none" };
  });
}

export type FillPolicy = "exact" | "close" | "each";

/** Which rows start ticked under a policy. "Ask me each" starts with none. */
export function tickedByPolicy(rows: MappingRow[], policy: FillPolicy): boolean[] {
  return rows.map((row) => row.source !== null && (policy === "exact" ? row.tier === "exact" : policy === "close" ? row.tier !== "none" : false));
}

export type FieldsIntent = "copy" | "fill" | "recall";

/**
 * Typed phrases that belong to the fields clipboard rather than to a question
 * or the hands. "copy" needs a noun so "copy this sentence" stays a question.
 */
export function fieldsIntent(text: string): FieldsIntent | null {
  const t = text.trim().toLowerCase();
  if (/^(copy|grab|capture)\b/.test(t) && /\b(field|fields|detail|details|form|all|everything)\b/.test(t)) return "copy";
  if (/^(fill|paste)\b/.test(t)) return "fill";
  if (/^recall\b/.test(t) || /^(show|what)\b.*\b(copied|copy|clipboard|fields)\b/.test(t)) return "recall";
  return null;
}
