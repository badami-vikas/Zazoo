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
import { JobPilotApplicationDetail } from "./pages/JobPilotApplicationDetail";
import { ResourcesPage } from "./pages/ResourcesPage";
import { PublicHelpdesk } from "./pages/PublicHelpdesk";
import { WorkspacePage } from "./pages/WorkspacePage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { IntelligencePage } from "./pages/IntelligencePage";
import { PendingWorkPage } from "./pages/PendingWorkPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
// Ported prototype surface (faithful visual port, 2026-07-07)
import { HomePage } from "./pages/HomePage";
import { WorkPage } from "./pages/WorkPage";
import { ItemDetail } from "./pages/ItemDetail";
import { InitiativeDetail } from "./pages/InitiativeDetail";
import { SkillDetail } from "./pages/SkillDetail";
import { ToolsPage } from "./pages/ToolsPage";
import { ControlPanelPage } from "./pages/ControlPanelPage";
import { DataEngine } from "./components/DataEngine";
// TASK-001 / VOCAB6: manifest-driven Module Detail (§4b)
import { ModuleDetailPage } from "./pages/ModuleDetailPage";
import {
  RelationshipPage,
  RelationshipRecordDetailPage,
  SignalDetailPage,
  SignalSourceEventPage,
} from "./pages/RelationshipPage";
import {
  RelationshipHelpdeskPage,
  RelationshipHelpdeskThreadPage,
} from "./pages/RelationshipHelpdeskPage";

export const router = createBrowserRouter([
  // Public/unauthenticated — outside Layout's authenticated nav shell entirely
  // (frontend-migration-scoping.md gap #5: a genuinely different auth model).
  { path: "/help", Component: PublicHelpdesk },
  // Prototype's shareable public helpdesk URL shape (slug-addressed).
  { path: "/help/:slug", Component: PublicHelpdesk },

  {
    path: "/",
    Component: Layout,
    children: [
      // HomePage is the index (prototype parity); DealPilot keeps /dealpilot.
      { index: true, Component: HomePage },
      { path: "home", Component: HomePage },
      { path: "dealpilot", Component: DealPilotPage },

      // TASK-001 / VOCAB6: manifest-driven Module Detail surface (§4b).
      // Route param = packageName (e.g. "deal-pilot", "job-pilot"). Every
      // installed Module in the left nav links here.
      { path: "module/:moduleId", Component: ModuleDetailPage },
      { path: "module/relationship/signals/:signalId/event", Component: SignalSourceEventPage },
      { path: "module/relationship/signals/:signalId", Component: SignalDetailPage },
      { path: "module/relationship/people/:recordId", element: <RelationshipRecordDetailPage kind="person" /> },
      { path: "module/relationship/communities/:recordId", element: <RelationshipRecordDetailPage kind="community" /> },
      { path: "module/relationship/helpdesk/:ticketId", Component: RelationshipHelpdeskThreadPage },
      { path: "module/relationship/helpdesk", Component: RelationshipHelpdeskPage },
      { path: "module/relationship/:page", Component: RelationshipPage },

      // Ported prototype surface (2026-07-07): the prototype mounted the
      // network DataEngine at "/" — here it lives at /network so HomePage
      // can own the index.
      { path: "network", Component: DataEngine },
      { path: "item/:id", Component: ItemDetail },
      { path: "work", Component: WorkPage },
      { path: "initiative/:id", Component: InitiativeDetail },
      // Per-Initiative admin (ADR-029): platform admin = /settings, initiative
      // admin = its Control Panel. Strictly scoped to the one :id.
      { path: "initiative/:id/control-panel", Component: ControlPanelPage },
      { path: "ritual/create", Component: RitualCreate },
      { path: "ritual/:id", Component: RitualDetail },
      { path: "agent/create", Component: AgentCreate },
      { path: "agent/:id", Component: AgentDetail },
      { path: "skill/:id", Component: SkillDetail },
      { path: "integration/:id", Component: IntegrationDetail },
      { path: "tools", Component: ToolsPage },
      { path: "tool/:id", Component: ToolDetail },
      // Standalone Tools destination removed (user revision 2026-07-06):
      // Intelligence (/intelligence) owns the capability surface now; pinned
      // individual tools still live in the left nav. tool.run stays reachable.
      { path: "tools/run", Component: ToolDetail },

      { path: "rituals", Component: RitualsPage },
      { path: "rituals/new", Component: RitualCreate },
      { path: "rituals/run", Component: RitualDetail },

      { path: "calendar", Component: TaskManagerPage },
      { path: "calendar/google", Component: CalendarPage },
      { path: "task-manager", Component: TaskManagerPage },

      { path: "approvals", Component: ApprovalsPage },

      { path: "agents/new", Component: AgentCreate },
      { path: "agents/update", Component: AgentDetail },

      { path: "integrations", Component: IntegrationDetail },
      { path: "integrations/google", Component: GoogleIntegrationPanel },

      { path: "jobpilot", Component: JobPilotPage },
      { path: "jobpilot/application/:id", Component: JobPilotApplicationDetail },

      { path: "resources", Component: ResourcesPage },

      { path: "workspace", Component: WorkspacePage },

      { path: "chief-of-staff", Component: ChiefOfStaffPage },

      // ADR-023 shell IA (+ user revisions 2026-07-06): KnowledgeBase
      // (Projects/Resources/Communities/People toggle), Intelligence (the
      // capability surface: Tools/Integrations/Agents/Workflows/Skills), and
      // Settings are permanent chrome containers; Signals is a separate
      // pinned governance tool (split back out of Approvals per user call).
      { path: "intelligence", Component: IntelligencePage },
      { path: "settings", Component: SettingsPage },
      { path: "pending-work", Component: PendingWorkPage },
    ],
  },
]);
