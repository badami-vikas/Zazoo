import type { Action, DataScope, EgressTier, GrantRule, ResourceType } from "@bridge/core";
import { GOVERNED_SKILL_MANIFEST_CATALOG, PILOT_ORGANIZATION } from "./wiring.js";

/**
 * Server-owned Agent role-template catalog, mirroring CULTURE_SOURCE_REGISTRY's
 * "client selects only an id; server resolves everything else" pattern. These
 * ids are the ONLY API-createable Agent authority bundles.
 *
 * NOTE: every template fixes `egressTier:"none"` on purpose. The current tier
 * presets are broader than several governed Skills' manifest-declared
 * permissions (for example `source-internet` implies graph reads plus draft
 * writes, not just `external:fetch:read`). To stay least-privilege, templates
 * encode the exact manifest-derived permissions in `capabilityScope` and let
 * `buildAgentCapability()` serve only as a defense-in-depth sanitizer.
 */
interface AgentRoleTemplateSeed {
  id: string;
  roleId: string;
  organizationId: string;
  allowedSkills: readonly string[];
  dataScope: DataScope;
  egressTier: EgressTier;
}

export interface AuthorizedAgentRoleTemplate {
  id: string;
  roleId: string;
  organizationId: string;
  capabilityScope: readonly string[];
  allowedSkills: readonly string[];
  roleGrants: readonly GrantRule[];
  dataScope: DataScope;
  egressTier: EgressTier;
}

const AGENT_ROLE_TEMPLATE_SEEDS: readonly AgentRoleTemplateSeed[] = [
  {
    id: "learning",
    roleId: "role-learning",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: [
      "stageLearningRecommendation",
      "stageStrategicRecommendation",
      "relationship.help-request.stage-offer",
      "stageCapture",
      "jobpilot.researchCultureSource",
    ],
    dataScope: "all",
    egressTier: "none",
  },
  {
    id: "internal-strategist",
    roleId: "role-internal-strategist",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["stageStrategicRecommendation", "jobpilot.synthesizeCultureProfile"],
    dataScope: "all",
    egressTier: "none",
  },
  {
    id: "outreach",
    roleId: "role-outreach",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["outreach.stageDraft"],
    dataScope: "public",
    egressTier: "none",
  },
  {
    id: "egress",
    roleId: "role-egress",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["dealpilot.source", "google.sourceGmail", "google.sourceCalendar", "google.listCalendarEvents"],
    dataScope: "public",
    egressTier: "none",
  },
  {
    id: "devpilot-tracker",
    roleId: "role-devpilot-tracker",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["devpilot.syncGithub"],
    dataScope: "public",
    egressTier: "none",
  },
  {
    id: "devpilot-reviewer",
    roleId: "role-devpilot-reviewer",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["devpilot.reviewPr", "devpilot.suggestPractice", "devpilot.analyzeIssue"],
    dataScope: "private",
    egressTier: "none",
  },
  {
    id: "intake",
    roleId: "role-intake",
    organizationId: PILOT_ORGANIZATION,
    allowedSkills: ["google.stage"],
    dataScope: "all",
    egressTier: "none",
  },
] as const;

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function grantForCapabilityToken(token: string): GrantRule {
  const idx = token.lastIndexOf(":");
  if (idx <= 0 || idx === token.length - 1) {
    throw new Error(`Agent role template capability "${token}" is not a valid resourceType:action token`);
  }
  const resourceType = token.slice(0, idx);
  const action = token.slice(idx + 1);
  if (resourceType.includes("*") || action.includes("*")) {
    throw new Error(`Agent role template capability "${token}" must not use wildcard grants`);
  }
  return {
    resourceType: resourceType as ResourceType,
    resourceId: null,
    action: action as Action,
    effect: "allow",
  };
}

function manifestPermissionsFor(organizationId: string, skillId: string): readonly string[] {
  const manifest = GOVERNED_SKILL_MANIFEST_CATALOG.find(
    (candidate) => candidate.organizationId === organizationId && candidate.skillId === skillId,
  );
  if (!manifest) {
    throw new Error(`Agent role template skill "${skillId}" is not registered in GOVERNED_SKILL_MANIFEST_CATALOG`);
  }
  return manifest.permissions;
}

function buildTemplate(seed: AgentRoleTemplateSeed): AuthorizedAgentRoleTemplate {
  const allowedSkills = unique(seed.allowedSkills);
  const capabilityScope = unique(allowedSkills.flatMap((skillId) => manifestPermissionsFor(seed.organizationId, skillId)));
  return {
    ...seed,
    allowedSkills,
    capabilityScope,
    roleGrants: capabilityScope.map(grantForCapabilityToken),
  };
}

export const AGENT_ROLE_TEMPLATES: readonly AuthorizedAgentRoleTemplate[] = AGENT_ROLE_TEMPLATE_SEEDS.map(buildTemplate);

export function resolveAuthorizedAgentRoleTemplate(
  organizationId: string,
  roleTemplateId: string,
): AuthorizedAgentRoleTemplate | null {
  const found = AGENT_ROLE_TEMPLATES.find((template) => template.id === roleTemplateId);
  if (!found) return null;
  if (found.organizationId !== organizationId) return null;
  return found;
}
