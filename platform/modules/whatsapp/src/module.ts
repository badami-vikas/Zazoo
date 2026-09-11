/**
 * WhatsApp's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readPrivate, writePrivate, type BuiltInModuleWithSurface } from "@bridge/core";

/**
 * WhatsApp Module capabilities.
 *
 * Every permission here is `private` scope and NONE declares egress: v1 reads
 * the owner's own WhatsApp session and writes nothing outbound. The read-only
 * guarantee is enforced in the desktop shell's op allowlist
 * (`whatsapp_webview.rs::script_for_op`); this manifest is the declaration
 * that matches it, and the manifest test asserts the two stay honest.
 */
const whatsappCapabilities = [
  capability("whatsapp.page.chats", "Chats", "database", [readPrivate("event")]),
  capability("whatsapp.page.tools", "Tools", "database", [readPrivate("record")]),
  capability("whatsapp.tool.contact-extractor", "Contact Extractor", "skill", [
    readPrivate("person"),
    writePrivate("person"),
    writePrivate("community"),
    writePrivate("signal"),
  ]),
  // Bridge's OWN data about a subject. No WhatsApp permission of any kind
  // appears here because the Tool touches no WhatsApp surface: it reads and
  // writes local Records the owner authored themselves.
  capability("whatsapp.tool.annotations", "Tags and Internal Notes", "skill", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  // Read-only over Bridge's own action log. No WhatsApp read permission: the
  // analytics are built from what Bridge did, never from the account.
  capability("whatsapp.tool.audit", "Analytics and Audit Log", "skill", [
    readPrivate("record"),
  ]),
  // The three automation Tools (TASK-030, ADR-158 under AP-091). None declares
  // egress: authoring a rule, reading the queue and naming an Agent are all
  // local reads and writes. The outbound permission stays where the sending
  // actually happens — behind the consent gate in the Agent's own capability —
  // rather than being granted to the surfaces that merely schedule it.
  capability("whatsapp.tool.automation-rules", "Automation Rules", "skill", [
    readPrivate("event"),
    writePrivate("record"),
  ]),
  capability("whatsapp.tool.scheduled-actions", "Scheduled Actions", "skill", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  capability("whatsapp.tool.agent-assignment", "Agent Assignment", "skill", [
    readPrivate("person"),
    writePrivate("record"),
  ]),
  capability(
    "whatsapp.agent.contact-steward",
    "WhatsApp Contact Steward",
    "agent",
    [readPrivate("person"), writePrivate("person"), writePrivate("community")],
    [],
    [{ manifestId: "whatsapp.tool.contact-extractor", versionRange: "0.2.0" }],
  ),
  /**
   * The Agent an Automation actually starts a Run of.
   *
   * It is separate from the Contact Steward because the two answer for
   * different things: the Steward reconciles an address book, this one answers
   * for a conversation. Assignment (`assignment.ts`) names one of them per chat
   * or Person, and an Automation may only start a Run of the Agent that was
   * named — that is what "only an attributable allowed Agent invokes a Skill"
   * means in this Module.
   *
   * It declares the WRITE permission for messages, and it is the only WhatsApp
   * capability that does. Sending is still not a thing this Agent can do
   * unilaterally: every message it proposes goes through the consent gate, the
   * send discipline, and the Rust-enforced ceiling.
   */
  capability(
    "whatsapp.agent.conversation-steward",
    "WhatsApp Conversation Steward",
    "agent",
    [readPrivate("event"), readPrivate("person"), writePrivate("event"), writePrivate("record")],
    [],
    [
      { manifestId: "whatsapp.tool.automation-rules", versionRange: "0.2.0" },
      { manifestId: "whatsapp.tool.scheduled-actions", versionRange: "0.2.0" },
      { manifestId: "whatsapp.tool.agent-assignment", versionRange: "0.2.0" },
    ],
  ),
];
export const whatsappModule: BuiltInModuleWithSurface = {
  // External: the Module renders a third-party site inside the desktop shell
  // and reads the owner's private contact graph out of it.
  computedRisk: "external",
  manifest: {
    name: "whatsapp",
    // 0.2.0: the Tools Page grew five Tools (annotations, audit, rules,
    // queue, assignment) and the Conversation Steward Agent. The installed
    // manifest is immutable per version — content changes REQUIRE this bump,
    // or seedBuiltInModules refuses to start (the 2026-08-02 Local Plane
    // outage was exactly that refusal).
    // 0.3.0: declares NetworkManager as its nav parent (ADR-178).
    version: "0.3.0",
    kind: "organization_definition",
    summary: "Your WhatsApp Web session, with Tools that turn it into People and Communities.",
    description:
      "Runs the owner's own WhatsApp Web session inside the Bridge desktop shell and hosts a Tool list over it. The Contact Extractor stages individual contacts as People and selected groups as Communities with participant membership directly on the Local Plane; only sends are gated. Raw capture and phone numbers stay on the Local Plane.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: whatsappCapabilities,
    contextProviders: [{ kind: "capture", required: false }],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    module: {
      displayName: "WhatsApp",
      // A sub-module of NetworkManager: WhatsApp's Chats are a SOURCE of
      // People and Communities, not a second copy of them. Nesting is nav
      // only — the Local-Plane session, the capture, and every Skill here
      // stay governed exactly as they were at the root.
      parentModule: "relationship",
      route: "/module/whatsapp/chats",
      pages: [
        {
          id: "chats",
          name: "Chats",
          route: "/module/whatsapp/chats",
          databaseId: "whatsapp.chats",
          capabilityId: "whatsapp.page.chats",
        },
        {
          id: "tools",
          name: "Tools",
          route: "/module/whatsapp/tools",
          databaseId: "whatsapp.tools",
          capabilityId: "whatsapp.page.tools",
        },
      ],
      agents: [
        {
          id: "contact-steward",
          name: "WhatsApp Contact Steward",
          capabilityId: "whatsapp.agent.contact-steward",
          skillIds: ["whatsapp.tool.contact-extractor"],
          // The session is desktop-local and never leaves the machine.
          plane: "local",
        },
        {
          id: "conversation-steward",
          name: "WhatsApp Conversation Steward",
          capabilityId: "whatsapp.agent.conversation-steward",
          skillIds: [
            "whatsapp.tool.automation-rules",
            "whatsapp.tool.scheduled-actions",
            "whatsapp.tool.agent-assignment",
          ],
          plane: "local",
        },
      ],
      // Deliberately empty, and it stays empty: no BUILT-IN Automation may
      // run a WhatsApp read or send. Every extraction is a user-clicked Tool
      // run, and the v2 rules are authored by the owner one chat at a time
      // (`automation.ts`) rather than shipped with the Module.
      automations: [],
    },
  },
};
