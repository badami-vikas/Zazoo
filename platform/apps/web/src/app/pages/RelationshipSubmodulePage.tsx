import { ArrowLeft, Boxes, Network, Radio, Share2 } from "lucide-react";
import { Link } from "react-router";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { Button } from "../components/ui/button";

type RelationshipSubmodule = "relations" | "interactions" | "introductions" | "sources";

const SUBMODULES: Record<RelationshipSubmodule, {
  title: string;
  description: string;
  actionLabel: string;
  actionTo: string;
  icon: typeof Boxes;
}> = {
  relations: {
    title: "Relations",
    description: "Relations use the shared Record graph. Open the Relationship Graph view to inspect evidence-backed connections.",
    actionLabel: "Open Relationship Graph",
    actionTo: "/module/relationship/people?view=graph",
    icon: Network,
  },
  interactions: {
    title: "Interactions",
    description: "Interactions are participant-linked Events. Open a Person or Community to inspect its shared Event timeline.",
    actionLabel: "Choose a Person",
    actionTo: "/module/relationship/people",
    icon: Radio,
  },
  introductions: {
    title: "Introductions",
    description: "Introductions remain private participant Events with two-party consent. Open a Person to review current cases.",
    actionLabel: "Choose a Person",
    actionTo: "/module/relationship/people",
    icon: Share2,
  },
  sources: {
    title: "Sources",
    description: "Relationship Sources are governed Integrations and capture inputs. Configure a real source before data appears.",
    actionLabel: "Open Google Integration",
    actionTo: "/integrations/google",
    icon: Boxes,
  },
};

export function RelationshipSubmodulePage({ submodule }: { submodule: RelationshipSubmodule }) {
  const config = SUBMODULES[submodule];
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <Header
        tabs={[{ id: config.title, icon: config.icon }]}
        activeTab={config.title}
        onTabChange={() => {}}
      />
      <div className="flex-1 space-y-8 overflow-auto p-4 sm:p-6">
        <section className="space-y-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <Link
            to="/module/relationship"
            className="inline-flex items-center gap-1 text-sm no-underline hover:underline"
            style={{ color: "var(--color-steel)" }}
          >
            <ArrowLeft className="size-4" /> Relationship
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--color-navy)" }}>{config.title}</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--color-warm-gray)" }}>
              {config.description}
            </p>
          </div>
          <Button asChild>
            <Link to={config.actionTo}>{config.actionLabel}</Link>
          </Button>
        </section>
        <ModuleFilesSection moduleName="relationship" />
        <div className="mt-6">
          <ModuleIntelligenceSection moduleName="relationship" />
        </div>
      </div>
    </div>
  );
}
