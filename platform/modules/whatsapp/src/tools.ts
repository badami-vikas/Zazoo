/**
 * The WhatsApp Module's Tool registry — the "Tools" Page renders this list, so
 * adding a Tool is a registry entry plus its run panel, never new JSX in the
 * Page. v1 ships one Tool.
 *
 * A Tool is user-invoked by definition: nothing in this Module runs on a
 * schedule or from an Automation, which is what keeps read volume against
 * WhatsApp tied to a deliberate human click.
 */

export type WhatsAppToolMode = "contacts" | "groups" | "tags" | "notes" | "activity";

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
];

export function requireTool(toolId: string): WhatsAppTool {
  const tool = WHATSAPP_TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool) throw new Error(`Unknown WhatsApp Tool: ${toolId}`);
  return tool;
}
