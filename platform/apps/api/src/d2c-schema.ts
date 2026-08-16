/**
 * SQLite persistence for the D2C Module's domain shape (imported from CV
 * Naturals, ADR-246). Column-for-column with
 * platform/modules/d2c/src/schema.ts — this file owns storage concerns only
 * (ids, timestamps-as-text, JSON columns for the invoice snapshot); the
 * domain package owns meaning. Copied rather than subtree-merged (it lived
 * inside CVN's apps/api, not a standalone package) — documented, not hidden.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  displayName: text("display_name").notNull(),
  hsnCode: text("hsn_code"),
  gstRate: real("gst_rate").notNull(),
  sellingPrice: real("selling_price").notNull(),
  scalingConstant: real("scaling_constant"),
  opsCost: real("ops_cost"),
  packagingCost: real("packaging_cost"),
  transportCost: real("transport_cost"),
  retailerMarginPct: real("retailer_margin_pct"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const rawMaterials = sqliteTable("raw_materials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pricePerKg: real("price_per_kg").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  email: text("email"),
});

export const supplierMaterials = sqliteTable(
  "supplier_materials",
  {
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    rawMaterialId: text("raw_material_id").notNull().references(() => rawMaterials.id),
  },
  (t) => [uniqueIndex("supplier_material_uidx").on(t.supplierId, t.rawMaterialId)],
);

/** Actual price paid on a specific purchase, distinct from `rawMaterials.pricePerKg`
 * (the standing price costing reads live). Recorded, never averaged back into the
 * standing price automatically — the owner reviews and updates that themselves. */
export const rawMaterialPurchases = sqliteTable(
  "raw_material_purchases",
  {
    id: text("id").primaryKey(),
    rawMaterialId: text("raw_material_id").notNull().references(() => rawMaterials.id),
    supplierId: text("supplier_id").references(() => suppliers.id),
    quantityKg: real("quantity_kg").notNull(),
    pricePerKg: real("price_per_kg").notNull(),
    purchasedAt: text("purchased_at").notNull(),
    notes: text("notes"),
  },
  (t) => [index("raw_material_purchases_material_idx").on(t.rawMaterialId)],
);

export const formulaLines = sqliteTable(
  "formula_lines",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    rawMaterialId: text("raw_material_id").notNull().references(() => rawMaterials.id),
    sampleWt: real("sample_wt").notNull(),
  },
  (t) => [index("formula_lines_product_idx").on(t.productId)],
);

export const productMappings = sqliteTable(
  "product_mappings",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind", { enum: ["bill_column", "form_name"] }).notNull(),
    sourceLabel: text("source_label").notNull(),
    productId: text("product_id").notNull().references(() => products.id),
    confirmedAt: text("confirmed_at").notNull(),
    confirmedBy: text("confirmed_by"),
  },
  (t) => [uniqueIndex("product_mapping_uidx").on(t.sourceKind, t.sourceLabel)],
);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phoneE164: text("phone_e164"),
  whatsappKey: text("whatsapp_key"),
  address: text("address"),
  stateCode: text("state_code"),
  gstin: text("gstin"),
  openingBalance: real("opening_balance").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  source: text("source", { enum: ["whatsapp", "manual"] }).notNull(),
  status: text("status", {
    enum: ["draft", "confirmed", "packed", "dispatched", "delivered", "cancelled"],
  }).notNull(),
  placedAt: text("placed_at").notNull(),
  transportCharge: real("transport_charge").notNull().default(0),
  /** TASK-031 / AP-009. Percentage is the primary field — `discountAmount` is
   * derived from it and stored so the printed invoice never has to recompute a
   * rounded figure. Editing the final amount back-solves the percentage; both
   * are written together and always reconcile. */
  discountPct: real("discount_pct").notNull().default(0),
  discountAmount: real("discount_amount").notNull().default(0),
  notes: text("notes"),
});

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    productId: text("product_id").notNull().references(() => products.id),
    qty: real("qty").notNull(),
    unitPrice: real("unit_price").notNull(),
    gstRate: real("gst_rate").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    /** Optional: a payment settles a customer's balance, not one order.
     * Set when the payment was recorded against a specific order. */
    orderId: text("order_id").references(() => orders.id),
    customerId: text("customer_id").notNull().references(() => customers.id),
    amount: real("amount").notNull(),
    method: text("method", { enum: ["cash", "upi", "bank_transfer", "other"] }).notNull(),
    at: text("at").notNull(),
    reference: text("reference"),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_customer_idx").on(t.customerId)],
);

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  number: integer("number").notNull(),
  fy: text("fy").notNull(),
  issuedAt: text("issued_at").notNull(),
  /** InvoiceSnapshot, JSON-serialized. Frozen at issue time — see invoicing.ts. */
  snapshotJson: text("snapshot_json").notNull(),
}, (t) => [uniqueIndex("invoice_fy_number_uidx").on(t.fy, t.number)]);

/** Which orders an invoice covers. `orderId` unique: an order belongs to at
 * most one invoice, enforced here rather than trusted to callers. */
export const invoiceOrders = sqliteTable(
  "invoice_orders",
  {
    invoiceId: text("invoice_id").notNull().references(() => invoices.id),
    orderId: text("order_id").notNull().references(() => orders.id).unique(),
  },
  (t) => [index("invoice_orders_invoice_idx").on(t.invoiceId)],
);

export const stockBatches = sqliteTable("stock_batches", {
  id: text("id").primaryKey(),
  itemType: text("item_type", { enum: ["product", "raw_material"] }).notNull(),
  itemId: text("item_id").notNull(),
  batchNo: text("batch_no").notNull(),
  mfgDate: text("mfg_date"),
  expiryDate: text("expiry_date"),
  unitCost: real("unit_cost").notNull(),
}, (t) => [index("stock_batches_item_idx").on(t.itemType, t.itemId)]);

/** Append-only. No update/delete path is exposed anywhere in the router —
 * stock on hand is always sum(delta), never a mutated counter.
 *
 * TASK-034 / AP-010 makes this the single raw-material quantity ledger the
 * detail page renders: every ledger row IS a stock move, enriched from
 * `rawMaterialPurchases` (purchases) or the production run (usage). The two
 * `unrecorded_*` reasons are what an edit to "stock in hand" writes — a manual
 * increase beyond the ledger is an unrecorded purchase, a decrease beyond
 * production consumption an unrecorded usage. `reason` is a plain TEXT column
 * in SQL (drizzle's `enum` is a TypeScript-level refinement, no CHECK
 * constraint is emitted), so adding reasons needs no migration. */
export const stockMoves = sqliteTable(
  "stock_moves",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => stockBatches.id),
    delta: real("delta").notNull(),
    reason: text("reason", {
      enum: [
        "purchase", "production_in", "production_out", "sale", "adjustment", "return",
        "unrecorded_purchase", "unrecorded_usage",
      ],
    }).notNull(),
    refType: text("ref_type", { enum: ["order", "production_run", "purchase"] }),
    refId: text("ref_id"),
    /** Ledger money for this row (TASK-034). Auto-calculated on write — purchase
     * price × quantity, or product unit price × quantity consumed — and null only
     * for moves predating the ledger. A manual edit overrides the calculation,
     * which is exactly why this is stored rather than recomputed on read. */
    price: real("price"),
    /** The ledger's "From": a supplier id for purchase-shaped rows, a product id
     * for usage-shaped ones. Which it is follows from `reason`, so this is
     * deliberately untyped rather than two mutually-exclusive FK columns. */
    counterpartyId: text("counterparty_id"),
    at: text("at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("stock_moves_batch_idx").on(t.batchId)],
);

/** Research module: one row per plant, card-view in the web app. Notes are
 * freeform markdown — there is no structured research schema yet. */
export const plants = sqliteTable("plants", {
  id: text("id").primaryKey(),
  commonName: text("common_name").notNull(),
  botanicalName: text("botanical_name"),
  imageUrl: text("image_url"),
  summary: text("summary"),
  notes: text("notes"),
  /** The ingredient this research record is about. Set for every raw material
   * so "which products use this?" resolves without a name match. */
  rawMaterialId: text("raw_material_id").references(() => rawMaterials.id),
});

/** Research automation (TASK-012 remainder): links a researcher pastes in for a
 * plant, plus artefacts (summaries / manual notes) derived from or independent
 * of those links. Deliberately flat — no crawl queue, no job table; "ingest" is
 * a single server-side fetch-on-add, not a background worker. */
export const researchLinks = sqliteTable("research_links", {
  id: text("id").primaryKey(),
  plantId: text("plant_id").notNull().references(() => plants.id),
  url: text("url").notNull(),
  title: text("title"),
  extractedText: text("extracted_text"),
  addedAt: text("added_at").notNull(),
});

export const researchArtefacts = sqliteTable("research_artefacts", {
  id: text("id").primaryKey(),
  plantId: text("plant_id").notNull().references(() => plants.id),
  sourceLinkId: text("source_link_id").references(() => researchLinks.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Notes module: one document per row, landing as a StandardTable list
 * (TASK-016). The continuous-block editor is the detail page for one row. */
export const noteDocuments = sqliteTable("note_documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Free-form Kannada/English note rows — one document's blocks. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  documentId: text("document_id").references(() => noteDocuments.id),
  position: integer("position").notNull(),
  kannada: text("kannada").notNull().default(""),
  english: text("english").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/** Saved list/filter shortcuts for a StandardTable, keyed by which table they
 * belong to (`tableKey`, e.g. "products"). Shared across every device that
 * points at this database — starring a list is a `isDefault` flip, and only
 * one row per `tableKey` may hold it (enforced in the router, not here). */
export const savedViews = sqliteTable("saved_views", {
  id: text("id").primaryKey(),
  tableKey: text("table_key").notNull(),
  name: text("name").notNull(),
  filterColumn: text("filter_column"),
  filterText: text("filter_text"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

/** User-defined columns (TASK-014's "Add column"), generic across any
 * StandardTable — not just products. One `customFieldDefs` row per column
 * the user creates; one `customFieldValues` row per (entity, key) holding
 * its value as text, cast by `kind` in the UI. Deliberately not a real SQL
 * migration per field — that's the whole point of this mechanism. */
export const customFieldDefs = sqliteTable(
  "custom_field_defs",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** Plain TEXT in SQL — drizzle's `enum` is a TypeScript refinement, not a
     * CHECK constraint — so TASK-029's `select`/`multi_select` needed no
     * migration of their own, only the `options` column below. `boolean` stays
     * readable for columns created before Dropdown replaced Checkbox. */
    kind: text("kind", {
      enum: ["text", "number", "boolean", "date", "relation", "select", "multi_select"],
    }).notNull(),
    /** JSON string array of the choices for `select`/`multi_select` (TASK-029).
     * Null for every other kind. Stored as JSON rather than a child table for
     * the same reason the whole mechanism exists: a user-defined column must
     * not cost a migration. */
    options: text("options"),
    /** Optional help text (TASK-029, directive item 18). Rendered as a tooltip
     * on the column header and field label, never as body text. */
    description: text("description"),
    /** Which of the 8 known entity types a `kind: "relation"` column links to (one of
     * "products" | "raw-materials" | "suppliers" | "production" | "customers" | "orders" |
     * "payments" | "notes-docs" — the same strings pages already pass to useCustomFields/
     * useSavedViews). Null for every other kind. */
    relatedEntityType: text("related_entity_type"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("custom_field_defs_uidx").on(t.entityType, t.key)],
);

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    uniqueIndex("custom_field_values_uidx").on(t.entityType, t.entityId, t.key),
    index("custom_field_values_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Raw WhatsApp messages, kept for audit even after (or absent) order linkage. */
export const waMessages = sqliteTable("wa_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  senderKey: text("sender_key"),
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull(),
  orderId: text("order_id").references(() => orders.id),
  reviewStatus: text("review_status", { enum: ["pending", "applied", "dismissed"] })
    .notNull()
    .default("pending"),
});
