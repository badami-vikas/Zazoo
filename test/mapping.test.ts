import { describe, expect, it } from "vitest";
import { indexMappings, resolveMapping, unpivotBillRow } from "../src/mapping.js";
import type { ProductMapping } from "../src/schema.js";

describe("resolveMapping", () => {
  it("resolves only a confirmed mapping, never a fuzzy match", () => {
    const mappings: ProductMapping[] = [
      { sourceKind: "bill_column", sourceLabel: "TP(R) Tooth Powder Red", productId: "pTR" },
    ];
    const index = indexMappings(mappings);
    expect(resolveMapping(index, "bill_column", "TP(R) Tooth Powder Red")).toBe("pTR");
    // A near-identical but unconfirmed label resolves to nothing, not a guess.
    expect(resolveMapping(index, "bill_column", "TP(R): Tooth Powder Red")).toBeUndefined();
  });

  it("keeps bill_column and form_name as separate namespaces for the same label", () => {
    const mappings: ProductMapping[] = [
      { sourceKind: "bill_column", sourceLabel: "Bath Powder", productId: "pS" },
      { sourceKind: "form_name", sourceLabel: "Bath Powder", productId: "pSC" },
    ];
    const index = indexMappings(mappings);
    expect(resolveMapping(index, "bill_column", "Bath Powder")).toBe("pS");
    expect(resolveMapping(index, "form_name", "Bath Powder")).toBe("pSC");
  });
});

describe("unpivotBillRow", () => {
  it("turns mapped columns into line items and reports unmapped columns without dropping them silently", () => {
    const mappings: ProductMapping[] = [
      { sourceKind: "bill_column", sourceLabel: "TP(R) Tooth Powder Red", productId: "pTR" },
    ];
    const index = indexMappings(mappings);
    const result = unpivotBillRow(
      { "TP(R) Tooth Powder Red": 30, "Ka(G) Gen Kashaya": 50 },
      index,
    );
    expect(result.lines).toEqual([{ productId: "pTR", qty: 30 }]);
    expect(result.unmapped).toEqual(["Ka(G) Gen Kashaya"]);
  });

  it("produces no unmapped entries once every column is confirmed", () => {
    const mappings: ProductMapping[] = [
      { sourceKind: "bill_column", sourceLabel: "Hair Oil", productId: "oH" },
    ];
    const index = indexMappings(mappings);
    const result = unpivotBillRow({ "Hair Oil": 12 }, index);
    expect(result.unmapped).toEqual([]);
    expect(result.lines).toEqual([{ productId: "oH", qty: 12 }]);
  });
});
