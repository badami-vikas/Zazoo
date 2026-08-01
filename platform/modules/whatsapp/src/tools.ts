/**
 * The WhatsApp Module's Tool registry — the "Tools" Page renders this list, so
 * adding a Tool is a registry entry plus its run panel, never new JSX in the
 * Page. v1 ships one Tool.
 *
 * A Tool is user-invoked by definition: nothing in this Module runs on a
 * schedule or from an Automation, which is what keeps read volume against
 * WhatsApp tied to a deliberate human click.
 */

export type WhatsAppToolMode = "contacts" | "groups";

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
];

export function requireTool(toolId: string): WhatsAppTool {
  const tool = WHATSAPP_TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool) throw new Error(`Unknown WhatsApp Tool: ${toolId}`);
  return tool;
}
