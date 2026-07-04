import { createBrowserRouter } from "react-router";
import { Briefcase } from "lucide-react";
import Layout from "./Layout";
import { StandaloneLayout } from "./StandaloneLayout";
import { DataEngine } from "./components/DataEngine";
import { ItemDetail } from "./pages/ItemDetail";
import { WorkPage } from "./pages/WorkPage";
import { InitiativeDetail } from "./pages/InitiativeDetail";
import { IntelligencePage } from "./pages/IntelligencePage";
import { RitualsPage } from "./pages/RitualsPage";
import { RitualDetail } from "./pages/RitualDetail";
import { AgentDetail } from "./pages/AgentDetail";
import { AgentCreate } from "./pages/AgentCreate";
import { RitualCreate } from "./pages/RitualCreate";
import { SkillDetail } from "./pages/SkillDetail";
import { IntegrationDetail } from "./pages/IntegrationDetail";
import { ToolsPage } from "./pages/ToolsPage";
import { ToolDetail } from "./pages/ToolDetail";
import { ResourcesPage } from "./pages/ResourcesPage";
import { CalendarPage } from "./pages/CalendarPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HomePage } from "./pages/HomePage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { HelpdeskPage } from "./pages/HelpdeskPage";
import { HelpdeskThread } from "./pages/HelpdeskThread";
import { PublicHelpdesk } from "./pages/PublicHelpdesk";
import { JobPilotPage } from "./pages/JobPilotPage";
import { DealPilotPage } from "./pages/DealPilotPage";
import { AuthGate } from "./components/AuthGate";

// Bridge routes
export const router = createBrowserRouter([
  // PUBLIC — no Bridge account, outside the auth gate (shareable helpdesk URL).
  { path: "/help/:slug", Component: PublicHelpdesk },
  // STANDALONE — JobPilot built first per the tool-standardization plan's "build standalone,
  // merge later" path (section 7): its own minimal shell, no Network/other platform tools.
  {
    path: "/standalone/jobpilot",
    element: <StandaloneLayout toolIcon={Briefcase} toolName="JobPilot" />,
    children: [{ index: true, Component: JobPilotPage }],
  },
  {
    path: "/",
    element: (
      <AuthGate>
        <Layout />
      </AuthGate>
    ),
    children: [
      { index: true, Component: DataEngine },
      { path: "item/:id", Component: ItemDetail },
      { path: "work", Component: WorkPage },
      { path: "initiative/:id", Component: InitiativeDetail },
      { path: "ritual/create", Component: RitualCreate },
      { path: "ritual/:id", Component: RitualDetail },
      { path: "rituals", Component: RitualsPage },
      { path: "intelligence", Component: IntelligencePage },
      { path: "approvals", Component: ApprovalsPage },
      { path: "helpdesk", Component: HelpdeskPage },
      { path: "helpdesk/ask/:id", Component: HelpdeskThread },
      { path: "jobpilot", Component: JobPilotPage },
      { path: "dealpilot", Component: DealPilotPage },
      { path: "agent/create", Component: AgentCreate },
      { path: "agent/:id", Component: AgentDetail },
      { path: "skill/:id", Component: SkillDetail },
      { path: "integration/:id", Component: IntegrationDetail },
      { path: "tools", Component: ToolsPage },
      { path: "tool/:id", Component: ToolDetail },
      { path: "resources", Component: ResourcesPage },
      { path: "calendar", Component: CalendarPage },
      { path: "home", Component: HomePage },
      { path: "settings", Component: SettingsPage },
    ],
  },
]);
