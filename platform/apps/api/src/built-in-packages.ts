/**
 * Built-in workspace-definition packages — DealPilot, JobPilot, Helpdesk,
 * Chief of Staff. These ship with the kernel (origin: "built_in") and are
 * seeded as `available` + `installed` on API startup so they appear in
 * Intelligence → Packages and gate Intelligence → Tools visibility.
 *
 * Each is a `workspace_definition` package: it defines a compiled workspace
 * surface (ADR-018/020 "packages, not products"). The route path lives as
 * workspaceVocab._route — a frontend convention read by IntelligencePage's
 * Tools section to resolve the link; it is NOT part of the canonical package
 * format (no schema enforcement here, intentional interim step).
 *
 * Risk classification rationale:
 *   deal-pilot / job-pilot = advisory (reads+writes local graph, no egress)
 *   helpdesk = operational (manages support tickets; future: sends replies)
 *   chief-of-staff = advisory (proposes actions, never executes autonomously)
 */
import type { PackageManifest } from "@bridge/core";

export const BUILT_IN_PACKAGES: readonly {
  manifest: PackageManifest;
  computedRisk: "informational" | "advisory" | "transformational" | "operational" | "external";
  route: string;
}[] = [
  {
    route: "/dealpilot",
    computedRisk: "advisory",
    manifest: {
      name: "deal-pilot",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Sourcing waterfall + thesis-fit scoring for deal flow.",
      description:
        "Adds a deal-sourcing surface: waterfall pipeline, thesis-fit scoring, and Initiative tracking per prospect. Reads Person/Community graph. No external sends in v0.1.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "deal-pilot.surface",
          name: "DealPilot surface",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "all", egress: false },
            { resourceType: "initiative", action: "read", dataScope: "all", egress: false },
            { resourceType: "initiative", action: "write", dataScope: "all", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
      ],
      contextProviders: [],
      workspaceVocab: {
        alignsToBridgeTheme: false,
        domainTerms: { Initiative: "Deal", Person: "Founder" },
      },
    },
  },
  {
    route: "/jobpilot",
    computedRisk: "advisory",
    manifest: {
      name: "job-pilot",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Job search tracker + application pipeline.",
      description:
        "Adds a job-search workspace: role tracking, application pipeline, and interview stage management. Reads Person/Community graph for contacts at target companies. No external sends in v0.1.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "job-pilot.surface",
          name: "JobPilot surface",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "all", egress: false },
            { resourceType: "initiative", action: "read", dataScope: "all", egress: false },
            { resourceType: "initiative", action: "write", dataScope: "all", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
      ],
      contextProviders: [],
      workspaceVocab: {
        alignsToBridgeTheme: false,
        domainTerms: { Initiative: "Application", Person: "Hiring Manager" },
      },
    },
  },
  {
    route: "/helpdesk",
    computedRisk: "operational",
    manifest: {
      name: "helpdesk",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Support ticket inbox + routing.",
      description:
        "Adds a support-operations surface: ticket inbox, thread view, and routing rules. Operational risk: future versions will draft+send replies through the governed egress pipeline.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "helpdesk.surface",
          name: "Helpdesk surface",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "touchpoint", action: "read", dataScope: "all", egress: false },
            { resourceType: "touchpoint", action: "write", dataScope: "all", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
      ],
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
  },
  {
    route: "/chief-of-staff",
    computedRisk: "advisory",
    manifest: {
      name: "chief-of-staff",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Conversational router — one governed route per turn.",
      description:
        "The kernel's conversational entry point: classifies intent, proposes actions, and routes to the appropriate governed workflow. Never executes autonomously; always draft-then-approve.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "chief-of-staff.surface",
          name: "Chief of Staff surface",
          version: "0.1.0",
          capabilityType: "skill",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "all", egress: false },
            { resourceType: "signal", action: "read", dataScope: "all", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
      ],
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
  },
];
