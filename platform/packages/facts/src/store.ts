import type { Fact, NewFactInput, Provenance } from "./types.js";
import { PROVENANCE_RANK } from "./types.js";

let seq = 0;
function nextId(): string {
  seq += 1;
  return `fact_${Date.now().toString(36)}_${seq}`;
}

export interface FactStore {
  append<T>(input: NewFactInput<T>): Fact<T>;
  // Records a new fact for the same entity+field AND marks the previous live fact (if any)
  // as superseded — this is how a correction is made without ever mutating history.
  supersede<T>(input: NewFactInput<T>, previousFactId: string): Fact<T>;
  all(entityId: string): Fact[];
  // Latest-wins "living profile": one row per field, the most recent non-superseded fact,
  // provenance rank breaking ties on identical timestamps.
  livingProfile(entityId: string): Record<string, Fact>;
}

export function createFactStore(): FactStore {
  const facts: Fact[] = [];

  function append<T>(input: NewFactInput<T>): Fact<T> {
    const fact: Fact<T> = { id: nextId(), recordedAt: new Date().toISOString(), ...input };
    facts.push(fact as Fact);
    return fact;
  }

  function supersede<T>(input: NewFactInput<T>, previousFactId: string): Fact<T> {
    const prev = facts.find((f) => f.id === previousFactId);
    if (prev) prev.supersededBy = "__pending__"; // placeholder until the new fact's id is known
    const fact = append(input);
    if (prev) prev.supersededBy = fact.id;
    return fact;
  }

  function all(entityId: string): Fact[] {
    return facts.filter((f) => f.entityId === entityId);
  }

  function livingProfile(entityId: string): Record<string, Fact> {
    const live = all(entityId).filter((f) => !f.supersededBy);
    const byField = new Map<string, Fact>();
    for (const f of live) {
      const existing = byField.get(f.field);
      if (!existing) {
        byField.set(f.field, f);
        continue;
      }
      const newer = new Date(f.recordedAt).getTime() > new Date(existing.recordedAt).getTime();
      const sameAge = new Date(f.recordedAt).getTime() === new Date(existing.recordedAt).getTime();
      const higherProvenance = rank(f.provenance) > rank(existing.provenance);
      if (newer || (sameAge && higherProvenance)) byField.set(f.field, f);
    }
    return Object.fromEntries(byField);
  }

  function rank(p: Provenance): number {
    return PROVENANCE_RANK[p];
  }

  return { append, supersede, all, livingProfile };
}
