import { createBrowserRouter } from "react-router";
import Layout from "./Layout";
import { DealPilotPage } from "./pages/DealPilotPage";
import { RitualsPage } from "./pages/RitualsPage";
import { RitualCreate } from "./pages/RitualCreate";
import { RitualDetail } from "./pages/RitualDetail";
import { ToolDetail } from "./pages/ToolDetail";
import { AgentCreate } from "./pages/AgentCreate";
import { AgentDetail } from "./pages/AgentDetail";
import { IntegrationDetail } from "./pages/IntegrationDetail";
import { GoogleIntegrationPanel } from "./pages/GoogleIntegrationPanel";
import { CalendarPage } from "./pages/CalendarPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { JobPilotPage } from "./pages/JobPilotPage";
import { HelpdeskPage } from "./pages/HelpdeskPage";
import { HelpdeskThread } from "./pages/HelpdeskThread";
import { ResourcesPage } from "./pages/ResourcesPage";
import { PublicHelpdesk } from "./pages/PublicHelpdesk";
import { WorkspacePage } from "./pages/WorkspacePage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { KnowledgeBasePage } from "./pages/KnowledgeBasePage";
import { SettingsPage } from "./pages/SettingsPage";
import { IntelligencePage } from "./pages/IntelligencePage";
import { SignalsPage } from "./pages/SignalsPage";

export const router = createBrowserRouter([
  // Public/unauthenticated — outside Layout's authenticated nav shell entirely
  // (frontend-migration-scoping.md gap #5: a genuinely different auth model).
  { path: "/help", Component: PublicHelpdesk },

  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: DealPilotPage },
      { path: "dealpilot", Component: DealPilotPage },

      // Standalone Tools destination removed (user revision 2026-07-06):
      // Intelligence (/intelligence) owns the capability surface now; pinned
      // individual tools still live in the left nav. tool.run stays reachable.
      { path: "tools/run", Component: ToolDetail },

      { path: "rituals", Component: RitualsPage },
      { path: "rituals/new", Component: RitualCreate },
      { path: "rituals/run", Component: RitualDetail },

      { path: "calendar", Component: CalendarPage },

      { path: "approvals", Component: ApprovalsPage },

      { path: "agents/new", Component: AgentCreate },
      { path: "agents/update", Component: AgentDetail },

      { path: "integrations", Component: IntegrationDetail },
      { path: "integrations/google", Component: GoogleIntegrationPanel },

      { path: "jobpilot", Component: JobPilotPage },

      { path: "helpdesk", Component: HelpdeskPage },
      { path: "helpdesk/:ticketId", Component: HelpdeskThread },

      { path: "resources", Component: ResourcesPage },

      { path: "workspace", Component: WorkspacePage },

      { path: "chief-of-staff", Component: ChiefOfStaffPage },

      // ADR-023 shell IA (+ user revisions 2026-07-06): KnowledgeBase
      // (Projects/Resources/Communities/People toggle), Intelligence (the
      // capability surface: Tools/Integrations/Agents/Workflows/Skills), and
      // Settings are permanent chrome containers; Signals is a separate
      // pinned governance tool (split back out of Approvals per user call).
      { path: "knowledge-base", Component: KnowledgeBasePage },
      { path: "intelligence", Component: IntelligencePage },
      { path: "settings", Component: SettingsPage },
      { path: "signals", Component: SignalsPage },
    ],
  },
]);
