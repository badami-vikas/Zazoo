/**
 * ControlPanel — the sliders icon on the DataViews toolbar (user revision
 * 2026-07-06): one place listing every platform element associated with the
 * table/entity being viewed, so the user can control the whole work surface
 * from the table itself.
 *
 * HONESTY BOUNDARY: no association backend exists — there is no kernel
 * endpoint mapping an entity to its tools/workflows/resources/people/agents/
 * skills (filed in docs/BUGS.md: "association graph for control panel needs a
 * kernel endpoint"). What CAN be derived honestly, client-side, from what the
 * view already receives:
 *   - the entity id (spec.id) and its columns (with kinds),
 *   - the view kinds this spec is eligible for (computeEligibleKinds — same
 *     computation the switcher tabs use).
 * Everything else renders as a clearly-labeled empty section. No fabricated
 * associations, ever.
 */
import { SlidersHorizontal } from "lucide-react";
import type { TableSpec, ViewConfig } from "@bridge/tables";
import { Button } from "../components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";
import { computeEligibleKinds } from "./eligibility.js";

const UNWIRED_SECTIONS: { label: string; note: string }[] = [
  { label: "Tools", note: "no entity→tool association endpoint yet" },
  { label: "Workflows", note: "no entity→workflow association endpoint yet" },
  { label: "Resources", note: "no entity→resource association endpoint yet" },
  { label: "People", note: "no entity→person association endpoint yet" },
  { label: "Agents", note: "no entity→agent association endpoint yet" },
  { label: "Skills", note: "no entity→skill association endpoint yet" },
];

export interface ControlPanelProps {
  spec: TableSpec;
  isRelationship?: boolean;
  /** The view kinds actually offered by the switcher (post-restriction), so
   * the panel reports exactly what the surface can do, not a recomputation
   * that could drift from it. Falls back to computeEligibleKinds. */
  eligibleKinds?: ViewConfig["kind"][];
}

export function ControlPanel({ spec, isRelationship = false, eligibleKinds }: ControlPanelProps) {
  const kinds = eligibleKinds ?? computeEligibleKinds(spec, isRelationship);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Control panel for ${spec.id}`}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto text-sm space-y-4">
        <div>
          <div className="font-medium">Control panel · {spec.id}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Everything associated with this work surface, in one place.
          </div>
        </div>

        <section className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Views</div>
          <div className="flex flex-wrap gap-1">
            {kinds.map((k) => (
              <span key={k} className="border rounded px-1.5 py-0.5 text-xs">
                {k}
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Columns</div>
          <ul className="space-y-0.5">
            {spec.columns.map((col) => (
              <li key={col.id} className="text-xs">
                {col.label} <span className="text-muted-foreground">({col.kind})</span>
              </li>
            ))}
          </ul>
        </section>

        {UNWIRED_SECTIONS.map((s) => (
          <section key={s.label} className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
            <div className="text-xs text-muted-foreground border rounded-md px-2 py-1.5 bg-muted/30">
              Not wired — {s.note} (docs/BUGS.md). No fabricated associations.
            </div>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}
