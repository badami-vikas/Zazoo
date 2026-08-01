import { MessageCircle, Wrench } from "lucide-react";
import { Link } from "react-router";
import { WHATSAPP_TOOLS } from "@bridge/whatsapp";
import { Header } from "../components/shared/Header";
import { InstalledModuleBoundary } from "../components/InstalledModuleBoundary";
import { ChatsSurface } from "./whatsapp/ChatsSurface";
import { ContactExtractorRun } from "./whatsapp/ContactExtractorRun";

type WhatsAppPageId = "chats" | "tools";

/**
 * The WhatsApp Module's two Pages. `chats` is the live session surface;
 * `tools` is the add-on Tool list over it.
 *
 * The Tool list renders from the Module's registry rather than hardcoded JSX,
 * so a second Tool is a registry entry plus its panel.
 */
export function WhatsAppPage({ page }: { page: WhatsAppPageId }) {
  return (
    <InstalledModuleBoundary moduleName="whatsapp">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          tabs={[
            { id: "Chats", icon: MessageCircle },
            { id: "Tools", icon: Wrench },
          ]}
          activeTab={page === "chats" ? "Chats" : "Tools"}
          onTabChange={() => {}}
        />
        <nav className="flex gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
          <Link
            to="/module/whatsapp/chats"
            className="rounded-md px-3 py-1 text-sm no-underline"
            style={{
              backgroundColor: page === "chats" ? "var(--color-surface)" : "transparent",
              color: "var(--color-navy)",
            }}
          >
            Chats
          </Link>
          <Link
            to="/module/whatsapp/tools"
            className="rounded-md px-3 py-1 text-sm no-underline"
            style={{
              backgroundColor: page === "tools" ? "var(--color-surface)" : "transparent",
              color: "var(--color-navy)",
            }}
          >
            Tools
          </Link>
        </nav>

        {page === "chats" ? (
          <div className="min-h-0 flex-1">
            <ChatsSurface />
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-6">
            {WHATSAPP_TOOLS.map((tool) => (
              <section
                key={tool.id}
                className="space-y-4 rounded-xl border p-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="space-y-1">
                  <h2 className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                    {tool.name}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
                    {tool.description}
                  </p>
                </div>
                {tool.id === "contact-extractor" ? <ContactExtractorRun /> : null}
              </section>
            ))}
          </div>
        )}
      </div>
    </InstalledModuleBoundary>
  );
}
