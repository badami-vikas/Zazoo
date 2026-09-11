/**
 * DevPilot's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readAll, writeAll, readPrivate, readPublic, type BuiltInModuleWithSurface, type ModuleRuntimeIds } from "@bridge/core";

/** DevPilot D0/D1 (TASK-067/TASK-068, ADR-235) — continuing the runtime-id
 * sequence after Task Manager's routing Automation (…000108). */
export const DEVPILOT_TRACKER_AGENT_ID = "b0000000-0000-4000-a000-000000000109";
export const DEVPILOT_GITHUB_POLL_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010a";
export const DEVPILOT_GITHUB_POLL_AUTOMATION_KEY = "devpilot.github-poll";
/** DevPilot D2 (TASK-071, ADR-237) — engineering-assist Skills that call a
 * model over quarantined GitHub content. A separate Agent identity from the
 * tracker (…109): the tracker's authority is `external:fetch:read` alone,
 * the reviewer additionally needs model-calling + `record:write` to draft a
 * proposal, and least-privilege keeps those scopes on separate identities
 * rather than widening the tracker's. Continuing the id sequence after the
 * tracker poll Automation (…10a). */
export const DEVPILOT_REVIEWER_AGENT_ID = "b0000000-0000-4000-a000-00000000010b";
export const DEVPILOT_REVIEW_PR_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010c";
export const DEVPILOT_REVIEW_PR_AUTOMATION_KEY = "devpilot.review-pr";
export const DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010d";
export const DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY = "devpilot.suggest-practice";
export const DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010e";
export const DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY = "devpilot.analyze-issue";

export const DEVPILOT_RUNTIME_IDS: ModuleRuntimeIds = {
  automations: {
    [DEVPILOT_GITHUB_POLL_AUTOMATION_KEY]: DEVPILOT_GITHUB_POLL_AUTOMATION_ID,
    [DEVPILOT_REVIEW_PR_AUTOMATION_KEY]: DEVPILOT_REVIEW_PR_AUTOMATION_ID,
    [DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY]: DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID,
    [DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY]: DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID,
  },
  agents: {
    "tracker-agent": DEVPILOT_TRACKER_AGENT_ID,
    "reviewer-agent": DEVPILOT_REVIEWER_AGENT_ID,
  },
};

// DevPilot D0/D1 (TASK-067/TASK-068, ADR-235) — a freelance engineer's
// tracked repos, pull requests, and issues, synced from GitHub through a
// fine-grained Personal Access Token. Read-only: no external:send capability
// in D1 (D2's PR-review drafts stay local; posting is a later, separately
// approval-gated capability).
const devpilotCapabilities = [
  capability("devpilot.repos", "Repos database and views", "database", [readAll("record"), writeAll("record")]),
  capability("devpilot.pulls", "Pull Requests database and views", "database", [readAll("record"), writeAll("record")]),
  capability("devpilot.issues", "Issues database and views", "database", [readAll("record"), writeAll("record")]),
  capability(
    "devpilot.syncGithub",
    "Sync GitHub repos, pull requests, and issues",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.tracker-agent",
    "Dev tracker Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [{ manifestId: "devpilot.syncGithub", versionRange: "0.2.0" }],
  ),
  capability(
    "devpilot.github-poll",
    "GitHub tracker poll",
    "automation",
    [readPublic("external:fetch"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.tracker-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.syncGithub", versionRange: "0.2.0" },
    ],
  ),
  capability("devpilot.github", "GitHub tracker intake", "integration", [readAll("external:fetch")], [{ id: "github" }]),
  // DevPilot D2 (TASK-071, ADR-237) — draft-only engineering-assist Skills.
  // Each reads quarantined PR/Issue content (untrusted_external, GitHub's
  // own private-repo dataScope) and writes a governed proposal a Human must
  // approve; none may send or write back to GitHub — no external:send here,
  // same posture D1 declared for the tracker.
  capability(
    "devpilot.reviewPr",
    "Draft a code review from a Pull Request's diff",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.suggestPractice",
    "Draft best-practice suggestions from a Pull Request's diff",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.analyzeIssue",
    "Draft a triage analysis from an Issue's body",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.reviewer-agent",
    "Dev reviewer Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [
      { manifestId: "devpilot.reviewPr", versionRange: "0.2.0" },
      { manifestId: "devpilot.suggestPractice", versionRange: "0.2.0" },
      { manifestId: "devpilot.analyzeIssue", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.review-pr-automation",
    "Draft PR review (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.reviewPr", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.suggest-practice-automation",
    "Draft best-practice suggestions (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.suggestPractice", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.analyze-issue-automation",
    "Draft issue analysis (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.analyzeIssue", versionRange: "0.2.0" },
    ],
  ),
];
export const devpilotModule: BuiltInModuleWithSurface = {
  // External: the sync Skill reaches the internet (GitHub REST API) with
  // egress, same computedRisk tier as DealPilot's sourcing.
  computedRisk: "external",
  manifest: {
    name: "devpilot",
    version: "0.2.0",
    kind: "organization_definition",
    summary: "Organizes a freelance engineer's code, issues, and work priorities.",
    description:
      "Tracks GitHub repos, pull requests, and issues in DevPilot-owned Databases, refreshed by a scheduled poll behind a fine-grained Personal Access Token. Tracking writes land directly in those Databases. Drafts PR reviews, best-practice suggestions, and Issue triage on request — drafts are proposals, never posted back to GitHub. No capability may send to GitHub in this version.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: devpilotCapabilities,
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    module: {
      displayName: "DevPilot",
      route: "/module/devpilot/pulls",
      pages: [
        {
          id: "pulls",
          name: "Pull Requests",
          route: "/module/devpilot/pulls",
          databaseId: "devpilot.pulls",
          capabilityId: "devpilot.pulls",
        },
        {
          id: "issues",
          name: "Issues",
          route: "/module/devpilot/issues",
          databaseId: "devpilot.issues",
          capabilityId: "devpilot.issues",
        },
        {
          id: "repos",
          name: "Repos",
          route: "/module/devpilot/repos",
          databaseId: "devpilot.repos",
          capabilityId: "devpilot.repos",
        },
      ],
      agents: [
        {
          id: "tracker-agent",
          name: "Dev tracker Agent",
          capabilityId: "devpilot.tracker-agent",
          skillIds: ["devpilot.syncGithub"],
          plane: "cloud",
        },
        {
          id: "reviewer-agent",
          name: "Dev reviewer Agent",
          capabilityId: "devpilot.reviewer-agent",
          skillIds: ["devpilot.reviewPr", "devpilot.suggestPractice", "devpilot.analyzeIssue"],
          plane: "cloud",
        },
      ],
      automations: [
        {
          id: "github-poll",
          name: "GitHub tracker poll",
          capabilityId: "devpilot.github-poll",
          agentId: "tracker-agent",
          trigger: "Scheduled",
          schedule: { kind: "schedule", everyMinutes: 15 },
          procedure: "devpilot.syncGithub",
          automationId: DEVPILOT_GITHUB_POLL_AUTOMATION_KEY,
          runRoute: "/module/devpilot/pulls",
        },
        {
          id: "review-pr",
          name: "Draft PR review",
          capabilityId: "devpilot.review-pr-automation",
          agentId: "reviewer-agent",
          // Human-triggered rather than scheduled or Event-fired, same
          // reasoning as Task Manager's planning-playbook Automation: this
          // answers a question someone asked ("review this PR"), so no
          // `schedule` — an Automation still gives the invocation an
          // attributable Agent Run and a proposal that halts for review.
          trigger: "Manual — 'Draft review' on a tracked Pull Request",
          procedure: "devpilot.reviewPr",
          automationId: DEVPILOT_REVIEW_PR_AUTOMATION_KEY,
          runRoute: "/module/devpilot/pulls",
        },
        {
          id: "suggest-practice",
          name: "Draft best-practice suggestions",
          capabilityId: "devpilot.suggest-practice-automation",
          agentId: "reviewer-agent",
          trigger: "Manual — 'Suggest practices' on a tracked Pull Request",
          procedure: "devpilot.suggestPractice",
          automationId: DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY,
          runRoute: "/module/devpilot/pulls",
        },
        {
          id: "analyze-issue",
          name: "Draft issue analysis",
          capabilityId: "devpilot.analyze-issue-automation",
          agentId: "reviewer-agent",
          trigger: "Manual — 'Analyze' on a tracked Issue",
          procedure: "devpilot.analyzeIssue",
          automationId: DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY,
          runRoute: "/module/devpilot/issues",
        },
      ],
    },
  },
};
