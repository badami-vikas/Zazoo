/**
 * D2C's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readPrivate, writePrivate, type BuiltInModuleWithSurface } from "@bridge/core";

export const d2cModule: BuiltInModuleWithSurface = {
  // Internal: the owner's own D2C business records. The WhatsApp boundary is
  // NOT declared here — it is served by the existing @bridge/whatsapp Module,
  // whose clone in CV Naturals was byte-identical and therefore not imported.
  computedRisk: "operational",
  manifest: {
    name: "d2c",
    version: "0.1.0",
    kind: "organization_definition",
    summary: "Orders, inventory and research for a direct-to-consumer herbal business.",
    description:
      "Imported from CV Naturals (ADR-246). The parent Module for four sub-modules — Orders, Inventory, Research and Notes — over one domain layer covering order lifecycle, GST invoice numbering, product-to-source mapping, formula costing and the stock ledger. Opens its own sqlite in the host-granted dataDir; never touches the PGlite Local Plane.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      capability("d2c.commerce", "Orders, invoices and stock", "database", [
        readPrivate("record"),
        writePrivate("record"),
      ]),
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    module: {
      displayName: "D2C",
      route: "/module/d2c",
      // Orders and Inventory are the SAME commerce domain in different data
      // shapes, so they are toggle Pages of this Module rather than
      // sub-modules — the ui-architecture rule from AP-011 (different columns
      // → toggle Pages; loosely related → sub-module). Research (plants) and
      // Notes are loosely related and nest below as sub-modules instead.
      // A Module must also land on a real data Page, never on its own
      // capability-inventory overview (catalog.test.ts), which a Pages-less
      // parent would do.
      pages: [
        {
          id: "orders",
          name: "Orders",
          route: "/module/d2c/orders",
          databaseId: "d2c.commerce",
          capabilityId: "d2c.commerce",
        },
        {
          id: "inventory",
          name: "Inventory",
          route: "/module/d2c/inventory",
          databaseId: "d2c.commerce",
          capabilityId: "d2c.commerce",
        },
      ],
      agents: [],
      automations: [],
    },
  },
};

const d2cSubModules = (
  [
    {
      name: "d2c-research",
      displayName: "Research",
      summary: "Plants, their traditional uses and their sourcing.",
      description:
        "A nested sub-module of D2C. Plant Records carry uses, contraindications, sourcing and regulatory classification, linked to the raw materials Inventory tracks.",
    },
    {
      name: "d2c-notes",
      displayName: "Notes",
      summary: "The owner's working notes, linked to the Records they concern.",
      description:
        "A nested sub-module of D2C. Notes are Records that link to orders, products and plants, so a note about a batch is reachable from the batch.",
    },
  ] as const
).map((sub): BuiltInModuleWithSurface => ({
  // Internal: same private contracts as the parent, no egress.
  computedRisk: "operational",
  manifest: {
    name: sub.name,
    version: "0.1.0",
    kind: "organization_definition",
    summary: sub.summary,
    description: sub.description,
    lineageManifestId: null,
    dependencies: [],
    // Restating the parent's capability under the sub-module's own row is
    // descriptive, not a second grant — identical data, identical plane,
    // exactly as Helpdesk does under NetworkManager. Every Module needs at
    // least one declared capability or the seed step rejects it outright.
    capabilities: [
      capability("d2c.commerce", "Orders, invoices and stock", "database", [
        readPrivate("record"),
        writePrivate("record"),
      ]),
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    module: {
      displayName: sub.displayName,
      // Nesting is nav only (ADR-178): governance, plane and capability
      // resolution are unchanged by the parent.
      parentModule: "d2c",
      route: `/module/d2c/${sub.displayName.toLowerCase()}`,
      pages: [
        {
          id: sub.displayName.toLowerCase(),
          name: sub.displayName,
          route: `/module/d2c/${sub.displayName.toLowerCase()}`,
          databaseId: "d2c.commerce",
          capabilityId: "d2c.commerce",
        },
      ],
      agents: [],
      automations: [],
    },
  },
}));

export const d2cResearchModule: BuiltInModuleWithSurface = d2cSubModules[0]!;
export const d2cNotesModule: BuiltInModuleWithSurface = d2cSubModules[1]!;
