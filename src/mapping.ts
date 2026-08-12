/**
 * Manual product mapping.
 *
 * Bill's 30 quantity columns and form's free-text `name` are two more
 * naming spaces for products that already exist as Pro codes, and the
 * spaces have already drifted (`pKobs` vs `pKObs`; `pS` vs `"pS - children"`
 * vs `"pS - Mix"`). This module deliberately contains no string-similarity
 * matching: every `ProductMapping` a caller passes in here is a fact a
 * human confirmed through the mapping panel (the record's kebab menu), and
 * every lookup either resolves to that confirmed mapping or reports the
 * source label as unmapped. There is no third outcome — no "close enough".
 */
import type { MappingSourceKind, ProductMapping } from "./schema.js";

export function indexMappings(
  mappings: readonly ProductMapping[],
): ReadonlyMap<string, string> {
  const byKey = new Map<string, string>();
  for (const m of mappings) {
    byKey.set(mappingKey(m.sourceKind, m.sourceLabel), m.productId);
  }
  return byKey;
}

function mappingKey(kind: MappingSourceKind, label: string): string {
  return `${kind}:${label}`;
}

/** The confirmed product for a source label, or `undefined` if unmapped. */
export function resolveMapping(
  index: ReadonlyMap<string, string>,
  sourceKind: MappingSourceKind,
  sourceLabel: string,
): string | undefined {
  return index.get(mappingKey(sourceKind, sourceLabel));
}

export interface UnpivotResult {
  lines: { productId: string; qty: number }[];
  /** Bill column names present in the row that have no confirmed mapping.
   * The importer/UI surfaces these; it never guesses past them. */
  unmapped: string[];
}

/**
 * Turn one legacy Bill row's product columns into line items.
 *
 * `columns` is the row's non-null product-quantity cells, e.g.
 * `{ "TP(R) Tooth Powder Red": 30, "Ka(G) Gen Kashaya": 50 }`. A column
 * with no confirmed mapping is reported in `unmapped` and excluded from
 * `lines` — it is never silently dropped from the report, only from the
 * line items, and only until someone maps it.
 */
export function unpivotBillRow(
  columns: Readonly<Record<string, number>>,
  index: ReadonlyMap<string, string>,
): UnpivotResult {
  const lines: UnpivotResult["lines"] = [];
  const unmapped: string[] = [];
  for (const [label, qty] of Object.entries(columns)) {
    const productId = resolveMapping(index, "bill_column", label);
    if (productId === undefined) {
      unmapped.push(label);
      continue;
    }
    lines.push({ productId, qty });
  }
  return { lines, unmapped };
}
