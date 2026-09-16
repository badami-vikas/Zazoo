/**
 * The stable id a newly added column gets from the name a person typed
 * (TASK-084 add-column, user report 2026-09-05 "I should always be able to add
 * columns in all modules").
 *
 * A column id is a FIELD NAME: it addresses a value inside a stored Record and
 * reaches every Filter, Sort and formula that names the column, which is why
 * the server bounds it to `[A-Za-z][A-Za-z0-9_]*` and refuses anything else.
 * Deriving it here rather than asking the user for it keeps the add gesture to
 * one field — the label — while still sending the server an id it will accept.
 *
 * The server refuses a duplicate; this de-duplicates first so the common case
 * (two columns both called "Notes") succeeds instead of erroring.
 */
export function columnIdFromLabel(
  label: string,
  existing: readonly { id: string }[],
): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const camel = words
    .map((word, at) =>
      at === 0
        ? word.toLowerCase()
        : `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join("");
  // A label of pure punctuation or non-Latin script leaves nothing usable, and
  // an id starting with a digit is refused: fall back rather than send a name
  // the server will reject.
  const base = /^[A-Za-z]/.test(camel) ? camel.slice(0, 64) : `column${camel}`.slice(0, 64);
  const taken = new Set(existing.map((column) => column.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}
