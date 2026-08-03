/**
 * The WhatsApp Module's Tool registry — the "Tools" Page renders this list, so
 * adding a Tool is a registry entry plus its run panel, never new JSX in the
 * Page.
 *
 * A Tool is user-invoked by definition, and the READ Tools keep it that way:
 * no extraction runs on a schedule, which is what keeps read volume against
 * WhatsApp tied to a deliberate human click.
 *
 * v2 adds the three automation Tools. They do not change that: authoring a
 * rule, inspecting the queue and assigning an Agent are all human acts, and
 * what a rule ultimately starts is an Agent Run whose every outbound message
 * still passes the consent gate, the send discipline and the Rust-enforced
 * ceiling (`policy.ts`, `outbound.ts`). No Tool here is a second write path.
 */

export type WhatsAppToolMode =
  | "contacts"
  | "groups"
  | "tags"
  | "notes"
  | "activity"
  | "rules"
  | "queue"
  | "assignments";

export interface WhatsAppTool {
  id: string;
  name: string;
  description: string;
  modes: readonly WhatsAppToolMode[];
  /** Capability in the Module manifest that gates this Tool. */
  capabilityId: string;
}

export const WHATSAPP_TOOLS: readonly WhatsAppTool[] = [
  {
    id: "contact-extractor",
    name: "Contact Extractor",
    description:
      "Read your WhatsApp contacts and selected groups, then stage them as People and Communities for your approval.",
    modes: ["contacts", "groups"],
    capabilityId: "whatsapp.tool.contact-extractor",
  },
  {
    id: "annotations",
    name: "Tags and Internal Notes",
    description:
      "Your own tags and private notes about a chat, Person, or Community. Bridge's data, stored on this machine — WhatsApp is never read or written, and nobody you message can see any of it.",
    modes: ["tags", "notes"],
    capabilityId: "whatsapp.tool.annotations",
  },
  {
    id: "audit",
    name: "Analytics and Audit Log",
    description:
      "What Bridge itself has done: sends it attempted or refused and why, syncs run, and extractions staged. Built only from Bridge's own records — nothing is measured by reading your WhatsApp account.",
    modes: ["activity"],
    capabilityId: "whatsapp.tool.audit",
  },
  {
    id: "automation-rules",
    name: "Automation Rules",
    description:
      "Author rules that start an Agent Run when a chat you already have goes quiet or someone writes to you. A rule never opens a conversation and can only tighten the send discipline, never widen it.",
    modes: ["rules"],
    capabilityId: "whatsapp.tool.automation-rules",
  },
  {
    id: "scheduled-actions",
    name: "Scheduled Actions",
    description:
      "The queue of Agent Runs waiting to happen, each showing which rule set its time and why. Cancel any of them.",
    modes: ["queue"],
    capabilityId: "whatsapp.tool.scheduled-actions",
  },
  {
    id: "agent-assignment",
    name: "Agent Assignment",
    description:
      "Put a named Agent in charge of a chat or a Person. Nothing automated runs on a subject with no assigned Agent, and every assignment can be removed.",
    modes: ["assignments"],
    capabilityId: "whatsapp.tool.agent-assignment",
  },
];

export function requireTool(toolId: string): WhatsAppTool {
  const tool = WHATSAPP_TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool) throw new Error(`Unknown WhatsApp Tool: ${toolId}`);
  return tool;
}
