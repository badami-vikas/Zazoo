import type { AxisScores, EvalCase, Scorer } from "./types.js";
import type { ExecutionSnapshot } from "../types.js";

export const routeMatchScorer: Scorer = {
  id: "deterministic:route-match",
  kind: "deterministic",
  async score(evalCase: EvalCase, produced: unknown): Promise<AxisScores> {
    const expected = evalCase.labels?.correct_route;
    const actual = predictedRoute(primaryProduced(produced));
    const score = expected && actual === expected ? 1 : 0;
    return { route_p: score, route_r: score };
  },
};

export const contractMatchScorer: Scorer = {
  id: "deterministic:contract-match",
  kind: "deterministic",
  async score(evalCase: EvalCase, produced: unknown): Promise<AxisScores> {
    return { quality: matchesContract(evalCase.reference, primaryProduced(produced)) ? 1 : 0 };
  },
};

export const replayDeterminismScorer: Scorer = {
  id: "deterministic:replay-determinism",
  kind: "deterministic",
  async score(_evalCase: EvalCase, produced: unknown, _snapshot: ExecutionSnapshot): Promise<AxisScores> {
    const outputs = Array.isArray(produced) ? produced : [produced];
    if (outputs.length <= 1) return { reliability: 1 };
    const first = stableStringify(outputs[0]);
    return { reliability: outputs.every((output) => stableStringify(output) === first) ? 1 : 0 };
  },
};

export const deterministicScorers = [routeMatchScorer, contractMatchScorer, replayDeterminismScorer] as const;

function primaryProduced(produced: unknown): unknown {
  return Array.isArray(produced) ? produced[0] : produced;
}

function predictedRoute(produced: unknown): string | null {
  if (typeof produced !== "object" || produced === null) return null;
  const object = produced as Record<string, unknown>;
  const route = object.route ?? object.routeId;
  return typeof route === "string" ? route : null;
}

function matchesContract(reference: unknown, produced: unknown): boolean {
  if (reference === undefined) return true;
  if (typeof reference === "string") return typeof produced === reference;
  if (Array.isArray(reference)) {
    if (!Array.isArray(produced)) return false;
    if (reference.length === 0) return true;
    return produced.every((item) => matchesContract(reference[0], item));
  }
  if (typeof reference === "object" && reference !== null) {
    if (typeof produced !== "object" || produced === null || Array.isArray(produced)) return false;
    const producedObject = produced as Record<string, unknown>;
    return Object.entries(reference as Record<string, unknown>).every(([key, expected]) =>
      Object.prototype.hasOwnProperty.call(producedObject, key) && matchesContract(expected, producedObject[key]),
    );
  }
  return typeof produced === typeof reference;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
