/**
 * Accounting's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readPrivate, writePrivate, type BuiltInModuleWithSurface } from "@bridge/core";

export const accountingModule: BuiltInModuleWithSurface = {
  // Internal: the advisor's own imported books. Nothing egresses — the
  // Module opens its own sqlite inside the dataDir the host grants it
  // (ADR-246) and never reaches @bridge/db or the PGlite Local Plane.
  computedRisk: "operational",
  manifest: {
    name: "accounting",
    // 0.1.0 as a Bridge Module; the imported domain layer carries Avilo's
    // own 1.10.1 in its package version, and its 35 commits of history are
    // reachable through the subtree merge.
    version: "0.1.0",
    kind: "organization_definition",
    summary: "QuickBooks exports become a month-end report, a dashboard, and a PDF.",
    description:
      "Imported from Avilo Advisory (ADR-246). Facts are keyed by (client, period, account) so any range is a WHERE clause; row labels resolve through persisted, user-correctable mappings; metrics are versioned formulas evaluated at runtime; corrections are overrides with full history. Every figure on screen traces to an imported fact, a stored override, or a formula — 'unknown' is a first-class result (ADR-247).",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      capability("accounting.books", "Imported books and periods", "database", [
        readPrivate("record"),
        writePrivate("record"),
      ]),
      capability("accounting.reports", "Month-end reports and formulas", "database", [
        readPrivate("record"),
        writePrivate("record"),
      ]),
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    // Avilo's AI posture, moved out of prose and into declared data (ADR-248).
    // It was correct for a year and enforced by nothing: BUG-029…BUG-045 are
    // all the assistant claiming work it had not done under exactly these
    // rules, and ADR-045 records prompt text failing twice on the same defect.
    // The user can edit these in the Governance Section; deny always wins.
    governance: {
      allow: [
        {
          action: "model.call.requested",
          reason: "Suggest, Generate, the Assistant panel and Test connection each run on an explicit button press.",
        },
        {
          action: "books.read",
          reason: "The Assistant sees the open client's imported periods and accounts, read-only, from the same queries the report view runs.",
        },
      ],
      deny: [
        {
          action: "model.call.unattended",
          reason: "No model call without an explicit user action — nothing calls out on upload, render, navigation or a timer. The app works fully with no model configured.",
        },
        {
          action: "books.write.model",
          reason: "A model may choose, never invent. It reads facts; it cannot write one. A hallucinated id degrades to skip.",
        },
        {
          action: "external.agent.books",
          reason: "An external agent reaches configuration, never the books — enforced by the module import graph, not by this rule alone.",
        },
      ],
    },
    module: {
      displayName: "Accounting",
      route: "/module/accounting",
      pages: [
        {
          id: "clients",
          name: "Clients",
          route: "/module/accounting/clients",
          databaseId: "accounting.books",
          capabilityId: "accounting.books",
        },
        {
          id: "reports",
          name: "Reports",
          route: "/module/accounting/reports",
          databaseId: "accounting.reports",
          capabilityId: "accounting.reports",
        },
      ],
      agents: [],
      automations: [],
    },
  },
};
