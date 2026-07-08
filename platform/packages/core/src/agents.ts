/**
 * The four non-Chief-of-Staff foundational agents (ADR-033,
 * docs/raw/bridge-foundational-agents-onboarding-2026-07.md). Chief of Staff
 * itself stays modeled by chief-of-staff.ts's star-topology router — it is
 * not in this registry because it IS the router, not a routable target.
 *
 * These four are addressable two ways, both funneling through the same
 * governed pipeline as everything else:
 *  - `@mention` in the chat box (parseMention), read by apps/api's
 *    chiefOfStaff.converse BEFORE it runs classifyIntent, so a mention always
 *    bypasses star-topology classification for that one turn — this is a
 *    manual user override at the calling layer, not agent-to-agent handoff
 *    (the "no peer handoffs" rule is about agents routing to EACH OTHER;
 *    a human directly addressing a named agent is a different thing).
 *  - Chief of Staff's own delegation (future work) when it decides a turn
 *    needs a specialist rather than a direct reply.
 *
 * `neverExecutes` and `requiresApproval` are read by apps/api's converse
 * handler to decide whether a reply is returned directly (Learning /
 * Communications / Governance — pure analysis/text, no side effects) or must
 * go through `pipeline.propose` the same way a Chief-of-Staff route does
 * (Capability Builder — "creates new capabilities after approval only,
 * never ships live").
 */
export type FoundationalAgentId = "learning" | "communications" | "governance" | "capability_builder";

export interface FoundationalAgent {
  id: FoundationalAgentId;
  /** Display name shown in the chat UI when this agent answers. */
  name: string;
  /** @mention aliases that resolve to this agent (lowercase, no leading @). */
  mentions: readonly string[];
  /** One-line mission, from the user's "Bridge Foundational Agents" spec. */
  mission: string;
  /** Condensed responsibility list, used to build the model system prompt. */
  responsibilities: readonly string[];
  /** True for agents that must never trigger a `pipeline.propose`/execute
   * call themselves — their output is information only (Learning Agent:
   * "Never executes actions" per spec, verbatim). */
  neverExecutes: boolean;
  /** True for agents whose output must always be drafted through the
   * governed pipeline rather than returned as a bare chat reply (Capability
   * Builder: "creates new capabilities after approval," never live). */
  requiresApproval: boolean;
}

export const FOUNDATIONAL_AGENTS: readonly FoundationalAgent[] = [
  {
    id: "learning",
    name: "Learning Agent",
    mentions: ["learning", "learn"],
    mission: "Continuously improve Bridge's understanding of the user, organization, and world.",
    responsibilities: [
      "learn from conversations, user behavior, corrections and feedback, connected systems, and documents",
      "conduct external research",
      "build organizational knowledge, user understanding, and domain understanding",
      "discover patterns and generate insights",
    ],
    neverExecutes: true,
    requiresApproval: false,
  },
  {
    id: "communications",
    name: "Communications Agent",
    mentions: ["communications", "comms"],
    mission: "Transform information into clear, effective communication.",
    responsibilities: [
      "draft, edit, rewrite, and summarize",
      "explain, prepare meetings, produce reports and documentation",
      "translate and adapt tone and audience",
      "organize knowledge into presentations and knowledge articles",
    ],
    neverExecutes: false,
    requiresApproval: false,
  },
  {
    id: "governance",
    name: "Governance Agent",
    mentions: ["governance", "gov"],
    mission: "Maintain trust, safety, and organizational integrity.",
    responsibilities: [
      "evaluate permissions and interpret policies",
      "assess risk and route approvals",
      "maintain compliance and preserve audit history",
      "validate capability boundaries and monitor organizational health",
    ],
    neverExecutes: false,
    requiresApproval: false,
  },
  {
    id: "capability_builder",
    name: "Capability Builder",
    mentions: ["builder", "capability-builder", "capabilitybuilder"],
    mission: "Expand Bridge by creating and evolving capabilities, after approval.",
    responsibilities: [
      "create agents, workflows, skills, tools, integrations, automations, dashboards, UIs, templates, and reusable packages",
      "evolve existing capabilities",
      "draft only — every output still goes through the governed pipeline (draft, propose, approve, execute), never shipped live from this agent directly",
    ],
    neverExecutes: true,
    requiresApproval: true,
  },
];

/** Leading `@mention` token, case-insensitive, resolved against every agent's
 * `mentions` list. Returns `{ agentId: null, rest: message }` when the
 * message doesn't start with a recognized mention (the overwhelmingly common
 * case — Chief of Staff stays the default interlocutor). Never throws on an
 * unrecognized `@word` — it's just treated as ordinary message text, so a
 * literal "@" in a normal sentence never misfires into an agent lookup. */
export function parseMention(message: string): { agentId: FoundationalAgentId | null; rest: string } {
  const match = /^@(\S+)\s*([\s\S]*)$/.exec(message.trim());
  if (!match) return { agentId: null, rest: message };
  const token = match[1] ?? "";
  const rest = match[2] ?? "";
  const normalized = token.toLowerCase();
  const agent = FOUNDATIONAL_AGENTS.find((a) => a.mentions.includes(normalized));
  if (!agent) return { agentId: null, rest: message };
  return { agentId: agent.id, rest: rest.trim() };
}

export function findFoundationalAgent(id: FoundationalAgentId): FoundationalAgent {
  const agent = FOUNDATIONAL_AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`agents.ts: unregistered FoundationalAgentId "${id}"`);
  return agent;
}

/** Builds the ModelProvider system prompt for a directly-addressed agent turn
 * — mission + responsibilities + the same governance guardrail every agent
 * carries (draft-then-approve, no direct execution from a chat reply).
 *
 * `animalTone` is optional and additive — the caller (apps/api) reads the
 * user's chosen spirit animal from client-supplied state (avatar-store.ts is
 * a browser-local preference today, not yet kernel data — see ANIMAL_TONE's
 * doc comment) and passes its tone description through. Omit it and the
 * prompt is unchanged; every agent still answers correctly with no animal
 * selected, same "kernel runs with ZERO providers"-style graceful default. */
export function buildAgentSystemPrompt(id: FoundationalAgentId, animalTone?: string): string {
  const agent = findFoundationalAgent(id);
  const lines = [
    `You are Bridge's ${agent.name}. Mission: ${agent.mission}`,
    "Responsibilities:",
    ...agent.responsibilities.map((r) => `- ${r}`),
  ];
  if (agent.neverExecutes) {
    lines.push("You never execute actions directly — you only produce information, analysis, or a draft for review.");
  }
  if (agent.requiresApproval) {
    lines.push("Anything you propose must go through Bridge's governed approval pipeline before it can run — you never ship it live yourself.");
  }
  if (animalTone) {
    lines.push(`Match this tone in how you write, without ever saying so explicitly: ${animalTone}`);
  }
  lines.push("Answer the user's message plainly, in character with this mission — no filler, no restating the question.");
  return lines.join("\n");
}

/** Tone descriptions for every spirit animal in `avatar-store.ts`'s
 * SPIRIT_ANIMALS — covers all 14 of the user's onboarding spec (R-030: the
 * 10 gap animals got real illustrations in AvatarOverlay.tsx, so their tone
 * entries land in the same slice) plus the 2 bonus extras (crane/wolf).
 * Read by apps/api to flavor Communications Agent's voice (spec: "emotional
 * connect people usually have" with their chosen animal) — additive only,
 * never changes WHAT an agent says, only its register. */
export const ANIMAL_TONE: Record<string, string> = {
  owl: "wise and calm — measured, a little formal, sees the bigger picture before speaking",
  fox: "clever and playful — quick, a bit wry, enjoys a good shortcut",
  turtle: "steady and patient — unhurried, reassuring, never rushes the user",
  crane: "graceful and precise — economical with words, elegant phrasing",
  wolf: "loyal and direct — plain-spoken, protective, gets straight to the point",
  cat: "independent and witty — dry humor, understated, confident",
  lion: "confident and bold — commanding, warm underneath the confidence, natural authority",
  dog: "loyal and enthusiastic — eager to help, warm, plainly happy to be useful",
  panda: "gentle and easygoing — calm, a little playful, low-drama",
  butterfly: "light and encouraging — optimistic, airy, gently transformative in framing",
  dolphin: "playful and sharp — quick-witted, sociable, finds the clever angle",
  peacock: "expressive and proud — vivid, a little theatrical, takes visible pride in good work",
  elephant: "wise and unhurried — remembers everything, deliberate, deeply reliable",
  eagle: "sharp and far-seeing — decisive, focused, cuts straight to what matters",
  horse: "strong and steady — dependable, forward-moving, quietly powerful",
  beaver: "industrious and practical — methodical, hands-on, takes visible satisfaction in building",
};
