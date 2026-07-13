export interface RoutingDecisionDisplayInput {
  kind: "route" | "clarify" | "direct_reply";
  route?: string;
}

export interface RoutingDecisionDisplay {
  kindLabel: "route" | "clarify" | "direct reply";
  routeLabel: string | null;
}

export function getRoutingDecisionDisplay(decision: RoutingDecisionDisplayInput): RoutingDecisionDisplay {
  switch (decision.kind) {
    case "route":
      return { kindLabel: "route", routeLabel: decision.route ?? null };
    case "clarify":
      return { kindLabel: "clarify", routeLabel: null };
    case "direct_reply":
      return { kindLabel: "direct reply", routeLabel: null };
  }
}
