/**
 * The Builder-built Module every Module test installs, and the round trip that
 * installs it.
 *
 * Extracted from `module-records.test.ts` (2026-09-06): a second suite needed
 * the same fixture, and importing it from a `*.test.ts` file re-runs that
 * file's whole suite inside the importer's process.
 */
import assert from "node:assert/strict";
import { PILOT_ORGANIZATION } from "../src/wiring.js";
import type { makeCaller } from "./caller.js";

export function builtModuleManifest(name = "invoice-tracker") {
  return {
    module: {
      name,
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Client invoices and their status",
      description: "A Module the Builder made from a user request",
      dependencies: [],
      capabilities: [
        {
          id: `${name}.invoices`,
          capability_type: "database",
          version: "0.1.0",
          permissions: [
            { resource_type: "record", action: "read", data_scope: "private", egress: false },
            { resource_type: "record", action: "write", data_scope: "private", egress: false },
          ],
          connectors: [],
        },
      ],
      module: {
        displayName: "Invoice Tracker",
        route: `/module/${name}`,
        databases: [
          {
            id: "invoices",
            name: "Invoices",
            columns: [
              { id: "client", label: "Client", kind: "text", required: true },
              { id: "amount", label: "Amount", kind: "number" },
              { id: "status", label: "Status", kind: "select", options: ["draft", "sent", "paid"] },
              { id: "due", label: "Due", kind: "date" },
            ],
          },
        ],
        pages: [
          {
            id: "invoices",
            name: "Invoices",
            route: `/module/${name}/invoices`,
            database_id: "invoices",
            capability_id: `${name}.invoices`,
          },
        ],
        agents: [],
        automations: [],
      },
    },
  };
}

export async function approveInstall(
  caller: ReturnType<typeof makeCaller>,
  installationId: string,
): Promise<void> {
  const result = await caller.modules.install({
    organizationId: PILOT_ORGANIZATION,
    installationId,
    todayKey: "2026-09-04",
  });
  if (!result.installed) {
    assert.ok(result.proposal, "a parked install carries its proposal");
    await caller.action.decide({ proposalId: result.proposal.id, decision: "approve" });
  }
  const row = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
  const mine = row.items.find((item) => item.id === installationId);
  assert.equal(mine?.status, "installed");
}
