// Fuzzy string similarity — trigram (bigram for short strings) Dice coefficient. No embedding
// dependency at this layer; a caller (e.g. company-sourcing) may layer pgvector cosine on top
// for long-tail name variants, but exact/blocking/trigram covers the common case cheaply.
function ngrams(s: string, n: number): Set<string> {
  const norm = s.toLowerCase().trim().replace(/\s+/g, " ");
  if (norm.length < n) return new Set([norm]);
  const grams = new Set<string>();
  for (let i = 0; i <= norm.length - n; i++) grams.add(norm.slice(i, i + n));
  return grams;
}

// Bigrams (n=2), not trigrams, despite the export's name — a single-character typo/insertion in
// a short name (the common real-world case: "Jon"/"John", "Smith"/"Smyth") destroys ALL trigrams
// around it but only one or two bigrams, so bigram Dice coefficient degrades much more gracefully
// for the short person/company name fields this is actually used on.
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.toLowerCase().trim() === b.toLowerCase().trim()) return 1;
  const ga = ngrams(a, 2);
  const gb = ngrams(b, 2);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}
