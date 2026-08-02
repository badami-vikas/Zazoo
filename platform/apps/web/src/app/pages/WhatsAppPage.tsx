import { MessageCircle, Wrench } from "lucide-react";
import { useNavigate } from "react-router";
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
const TAB_ROUTE: Record<string, string> = {
  Chats: "/module/whatsapp/chats",
  Tools: "/module/whatsapp/tools",
};

export function WhatsAppPage({ page }: { page: WhatsAppPageId }) {
  const navigate = useNavigate();
  return (
    <InstalledModuleBoundary moduleName="whatsapp">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          tabs={[
            { id: "Chats", icon: MessageCircle },
            { id: "Tools", icon: Wrench },
          ]}
          activeTab={page === "chats" ? "Chats" : "Tools"}
          onTabChange={(id) => {
            const route = TAB_ROUTE[id];
            if (route) navigate(route);
          }}
        />

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
