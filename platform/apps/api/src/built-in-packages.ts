/**
 * Built-in workspace-definition packages — DealPilot, JobPilot, Relationship,
 * Calendar. These ship with the kernel (origin: "built_in") and are seeded
 * as `available` + `installed` on API startup so they appear in
 * Intelligence → Packages and gate Intelligence → Tools visibility.
 *
 * Chief of Staff is deliberately NOT in this list (removed 2026-07-10, user
 * correction): it's the non-deletable router agent (ADR-033), not an
 * installable capability package — nothing to "install," it's always
 * present. Its `/chief-of-staff` page/route stays real and reachable
 * (routes.tsx, pins.ts) independent of the package system; it just no
 * longer appears in Intelligence → Modules or the "+ New" Module picker.
 *
 * Each is a `workspace_definition` package: it defines a compiled workspace
 * surface (ADR-018/020 "packages, not products"). The route path lives as
 * workspaceVocab._route — a frontend convention read by IntelligencePage's
 * Tools section to resolve the link; it is NOT part of the canonical package
 * format (no schema enforcement here, intentional interim step).
 *
 * Risk classification rationale:
 *   deal-pilot / job-pilot = advisory (reads+writes local graph, no egress)
 *   relationship = external (local/private graph plus explicitly gated source reads)
 *   calendar = external (writes round-trip to Google Calendar through the
 *     governed propose→approve→egress pipeline — CalendarPage.tsx's own
 *     header comment; ANY egress permission maps to "external" per
 *     capability/risk.ts's riskForPermission, matching how the trifecta rule
 *     treats external sends regardless of read-side sensitivity)
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
    route: "/module/relationship",
    computedRisk: "external",
    manifest: {
      name: "relationship",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Signals, People, Communities, and governed relationship continuity.",
      description:
        "One Relationship Module over shared Record, Relation, and Event contracts. Private relationship Memory stays Module-associated; source reads cross the Plane Gate only with explicit authority. Helpdesk is a sub-module, not a separate installation.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "relationship.page.signals",
          name: "Signals",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "signal", action: "read", dataScope: "private", egress: false },
            { resourceType: "signal", action: "write", dataScope: "private", egress: false },
            { resourceType: "relation", action: "read", dataScope: "private", egress: false },
            { resourceType: "relation", action: "write", dataScope: "private", egress: false },
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.page.people",
          name: "People",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "person", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.page.communities",
          name: "Communities",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.submodule.helpdesk",
          name: "Helpdesk",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "touchpoint", action: "read", dataScope: "private", egress: false },
            { resourceType: "touchpoint", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.skill.timeline-synthesis",
          name: "Relationship timeline synthesis",
          version: "0.1.0",
          capabilityType: "skill",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "signal", action: "read", dataScope: "private", egress: false },
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.skill.safe-action",
          name: "Safe relationship action proposal",
          version: "0.1.0",
          capabilityType: "skill",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "signal", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.skill.help-routing",
          name: "Help request capability routing",
          version: "0.1.0",
          capabilityType: "skill",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
            { resourceType: "touchpoint", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [],
        },
        {
          id: "relationship.agent.steward",
          name: "Relationship Steward",
          version: "0.1.0",
          capabilityType: "agent",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "signal", action: "read", dataScope: "private", egress: false },
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
            { resourceType: "signal", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [
            { manifestId: "relationship.skill.timeline-synthesis", versionRange: "0.1.0" },
            { manifestId: "relationship.skill.safe-action", versionRange: "0.1.0" },
          ],
        },
        {
          id: "relationship.agent.community-steward",
          name: "Community Steward",
          version: "0.1.0",
          capabilityType: "agent",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "community", action: "read", dataScope: "private", egress: false },
            { resourceType: "touchpoint", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [
            { manifestId: "relationship.skill.help-routing", versionRange: "0.1.0" },
          ],
        },
        {
          id: "relationship.automation.meeting-prep",
          name: "Pre-meeting relationship review",
          version: "0.1.0",
          capabilityType: "workflow",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "person", action: "read", dataScope: "private", egress: false },
            { resourceType: "signal", action: "write", dataScope: "private", egress: false },
          ],
          connectors: [],
          dependencies: [
            { manifestId: "relationship.agent.steward", versionRange: "0.1.0" },
          ],
        },
        {
          id: "relationship.integration.google-sources",
          name: "Google relationship sources",
          version: "0.1.0",
          capabilityType: "integration",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "external:fetch", action: "read", dataScope: "private", egress: true },
          ],
          connectors: [
            { id: "google-gmail" },
            { id: "google-calendar" },
          ],
          dependencies: [],
        },
      ],
      contextProviders: [
        { kind: "email", required: false },
        { kind: "calendar", required: false },
        { kind: "capture", required: false },
      ],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
  },
  {
    route: "/calendar",
    computedRisk: "external",
    manifest: {
      name: "calendar",
      version: "0.1.0",
      kind: "workspace_definition",
      summary: "Time-axis projection over your graph — Google Calendar today.",
      description:
        "A native calendar surface: month/week/day/agenda views over CalendarEvent, projected from the graph — not a calendar product or server (docs/wiki/calendar.md). v0.1's single source is Google Calendar; creating, editing, or deleting an event always goes through the governed propose→approve pipeline before it reaches Google, same as every other egress action. Pre-installed by default — this is a kernel Tool packaged as a Module, not a third-party add-on.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        {
          id: "calendar.surface",
          name: "Calendar surface",
          version: "0.1.0",
          capabilityType: "view",
          origin: "built_in",
          audience: "team",
          permissions: [
            { resourceType: "touchpoint", action: "read", dataScope: "all", egress: false },
            { resourceType: "touchpoint", action: "write", dataScope: "all", egress: true },
          ],
          connectors: [{ id: "google-calendar", externalSend: true }],
          dependencies: [],
        },
      ],
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
  },
];
