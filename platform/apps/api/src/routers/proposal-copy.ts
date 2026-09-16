/**
 * Plain-language copy for a pending Proposal (user directive 2026-09-05:
 * "anything on this platform a 5 year old should be able to understand").
 *
 * Knowledge as data (ADR-247): one table of known Skill ids → what the Agent is
 * asking to do, in words; one table of Agent ids → who is asking; and a
 * fallback built from the action and resource type so an unknown Skill still
 * reads as a sentence, never as an identifier. The raw ids stay on the payload
 * for the ledger and for anyone who wants them.
 */
import {
  BUILDER_AGENT_RUNTIME_ID,
  BUILT_IN_MODULES,
  CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  GOVERNANCE_AGENT_RUNTIME_ID,
  INTERNAL_STRATEGIST_AGENT_RUNTIME_ID,
  LEARNING_AGENT_RUNTIME_ID,
  resolveModuleAgentRuntimeId,
} from "@bridge/module-manifests";

/** What a Skill does, said to a person. Keep every entry a full sentence
 * fragment that follows "<Agent> wants to …". */
const SKILL_COPY: Record<string, { does: string; why: string }> = {
  "learning.observationDigest": {
    does: "save a short note about what it noticed you working on today",
    why: "so Bridge can learn your habits and suggest better next steps",
  },
  "devpilot.syncGithub": {
    does: "check GitHub for new changes to your code",
    why: "so DevPilot's list of pull requests stays current",
  },
  "task-manager.skill.web-research": {
    does: "look things up on the web for a research Task",
    why: "the Learning Agent needs sources before it can write a brief",
  },
};

const KERNEL_AGENT_NAMES: Record<string, string> = {
  [CHIEF_OF_STAFF_AGENT_RUNTIME_ID]: "Chief of Staff",
  [LEARNING_AGENT_RUNTIME_ID]: "Learning Agent",
  [INTERNAL_STRATEGIST_AGENT_RUNTIME_ID]: "Internal Strategist",
  [GOVERNANCE_AGENT_RUNTIME_ID]: "Governance Agent",
  [BUILDER_AGENT_RUNTIME_ID]: "Capability Builder",
};

/** Module-declared Agents, keyed by their runtime id — read once from the
 * manifests, never typed by hand. */
const MANIFEST_AGENT_NAMES: Record<string, string> = (() => {
  const names: Record<string, string> = {};
  for (const pkg of BUILT_IN_MODULES) {
    for (const agent of pkg.manifest.module?.agents ?? []) {
      const runtimeId = resolveModuleAgentRuntimeId(pkg.manifest.name, agent.id);
      if (runtimeId && agent.name) names[runtimeId] = agent.name;
    }
  }
  return names;
})();

export function agentDisplayName(actor: { type: string; id: string }): string {
  if (actor.type === "user") return "You";
  if (actor.type === "team") return "Your team";
  return KERNEL_AGENT_NAMES[actor.id] ?? MANIFEST_AGENT_NAMES[actor.id] ?? "An Agent";
}

const ACTION_VERBS: Record<string, string> = {
  read: "look at",
  write: "save changes to",
  create: "add",
  update: "change",
  delete: "remove",
  share: "share",
  send: "send",
  "external:fetch": "fetch from the internet",
  "external:write": "send outside Bridge",
};

function words(identifier: string): string {
  return identifier
    .replace(/^external:/, "")
    .replace(/[._:-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

export interface ProposalCopy {
  /** "Learning Agent wants to save a short note about what it noticed…" */
  title: string;
  /** Why it is asking, or what saying yes means. */
  detail: string;
}

/**
 * The sentence a person reads instead of `learning.observationDigest WRITE`.
 * `skill` is the persisted Skill id when the ledger has it; the action and
 * resource type are always present.
 */
export function describeProposal(request: {
  actor: { type: string; id: string };
  action: string;
  resourceType: string;
  skill?: string | null | undefined;
}): ProposalCopy {
  const who = agentDisplayName(request.actor);
  const known = request.skill ? SKILL_COPY[request.skill] : undefined;
  if (known) {
    return { title: `${who} wants to ${known.does}.`, detail: `Why: ${known.why}.` };
  }
  const verb = ACTION_VERBS[request.action] ?? words(request.action);
  const thing = words(request.resourceType) || "something";
  const skillNote =
    request.skill && request.skill !== "(replayed)" ? ` using the "${words(request.skill)}" Skill` : "";
  return {
    title: `${who} wants to ${verb} ${thing}${skillNote}.`,
    detail:
      request.action.startsWith("external:") || request.action === "share" || request.action === "send"
        ? "This reaches outside Bridge, so it waits for your yes."
        : "Nothing happens until you say yes.",
  };
}
