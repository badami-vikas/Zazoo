/**
 * Onboarding profile store (ADR-033/R-029 open question: "where is
 * onboarding-personalization data stored and how are prompts built from
 * it?"). Scoped narrowly to onboarding personalization — NOT the general
 * Memory/Knowledge kernel primitive (vector store, embeddings, retrieval)
 * that's still genuinely absent; that's a separate, larger build.
 *
 * Today spirit animal + answers live ONLY in browser localStorage
 * (avatar-store.ts) — invisible to the server, so nothing server-side (e.g.
 * an agent system prompt) can read "this user picked Owl" or "verified via
 * phone". This store gives that a durable, workspace-scoped home so a second
 * surface (desktop/mobile) sees the same profile, and so
 * buildAgentSystemPrompt's animalTone can eventually be resolved server-side
 * instead of trusting whatever the client happens to pass.
 */
import type { RunPersona } from "./run-context.js";
import { ANIMAL_TONE } from "./agents.js";

export interface OnboardingProfileRow {
  workspaceId: string;
  animal: string;
  answers: Record<string, string | string[] | undefined>;
  phoneVerified: boolean;
  /** "linkedin" | "phone" | null — which identity-verification path was used. */
  verificationMethod: string | null;
  connectedSourceIds: string[];
  updatedAtISO: string;
}

export interface OnboardingProfileStore {
  get(workspaceId: string): Promise<OnboardingProfileRow | null>;
  save(row: OnboardingProfileRow): Promise<void>;
}

export class InMemoryOnboardingProfileStore implements OnboardingProfileStore {
  readonly rows = new Map<string, OnboardingProfileRow>();

  async get(workspaceId: string): Promise<OnboardingProfileRow | null> {
    return this.rows.get(workspaceId) ?? null;
  }

  async save(row: OnboardingProfileRow): Promise<void> {
    this.rows.set(row.workspaceId, row);
  }
}

/**
 * The richer, Memory-family onboarding profile (undefined-elements #11 —
 * "OnboardingProfile stored as Memory scope=workspace") that AGENTS-2 turns into
 * the Chief of Staff's persona. Distinct from the storage-shaped
 * `OnboardingProfileRow` above (the durable row the client writes): this is the
 * kernel-facing VIEW the prompt assembler consumes, with the fields the spec
 * names (role/goals/domains/connected_sources/chosen_animal_id/
 * working_style_notes/source). Progressive-onboarding-friendly: every
 * personalization field is optional (`T | undefined`, exactOptionalPropertyTypes)
 * so a half-finished profile still builds a valid — just less personalized —
 * persona, same ZERO-input graceful default as the rest of the kernel.
 */
export interface OnboardingProfile {
  workspaceId: string;
  userId?: string;
  role?: string;
  goals?: readonly string[];
  domains?: readonly string[];
  connectedSources?: readonly string[];
  chosenAnimalId?: string;
  workingStyleNotes?: string;
  /** Provenance tag (Memory-family `source`) — always "onboarding" for a
   * profile built from the onboarding flow. */
  source: "onboarding";
}

function asString(v: string | readonly string[] | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asStringArray(v: string | readonly string[] | undefined): readonly string[] | undefined {
  if (Array.isArray(v)) {
    const a = v.map((x) => x.trim()).filter((x) => x.length > 0);
    return a.length > 0 ? a : undefined;
  }
  const s = asString(v);
  return s ? [s] : undefined;
}

/**
 * Bridge the durable, storage-shaped `OnboardingProfileRow` (what the client
 * writes today) into the kernel-facing `OnboardingProfile` view. Best-effort and
 * HONEST — it maps only what the row actually carries (animal → chosenAnimalId,
 * connectedSourceIds → connectedSources) and reads role/goals/domains/working-
 * style from the free-form `answers` map by conventional keys, degrading each
 * missing field to `undefined` rather than inventing a placeholder (no-dummy-
 * data rule). This is the server-side seam that lets the persona be resolved
 * from stored data instead of trusting whatever the client passes.
 */
export function profileFromRow(row: OnboardingProfileRow): OnboardingProfile {
  const role = asString(row.answers["role"]);
  const goals = asStringArray(row.answers["goals"]);
  const domains = asStringArray(row.answers["domains"]);
  const notes = asString(row.answers["workingStyle"]) ?? asString(row.answers["working_style_notes"]);
  return {
    workspaceId: row.workspaceId,
    source: "onboarding",
    ...(row.animal ? { chosenAnimalId: row.animal } : {}),
    ...(row.connectedSourceIds.length > 0 ? { connectedSources: row.connectedSourceIds } : {}),
    ...(role ? { role } : {}),
    ...(goals ? { goals } : {}),
    ...(domains ? { domains } : {}),
    ...(notes ? { workingStyleNotes: notes } : {}),
  };
}

/**
 * Resolve a spirit-animal id to its tone descriptor (the SpiritAnimal tone card,
 * undefined-elements #11 layer-2 input). Reuses the already-reconciled
 * `ANIMAL_TONE` map (agents.ts) rather than a second copy — case-insensitive,
 * and returns `undefined` for an unknown/unset animal so the persona simply
 * carries no tone line (graceful degrade, never a thrown error or a made-up
 * tone). The richer four-axis tone card (warmth/directness/playfulness/
 * formality + voice examples) named in the spec is future Commons-authored
 * Knowledge; the string descriptor is the shipped v1.
 */
export function resolveAnimalTone(animalId: string | undefined): string | undefined {
  if (!animalId) return undefined;
  return ANIMAL_TONE[animalId.toLowerCase()];
}

/**
 * Build the Chief of Staff's `RunPersona` (run-context.ts, ADR-027 assembler
 * seam) from an onboarding profile — AGENTS-2's "onboarding-profile → CoS
 * persona". The animal supplies the tone (layer-2 register); role/goals/domains/
 * working-style seed the identity framing; the fixed CoS duties (route to ONE
 * capability, hold the through-line, keep everything governed) are the
 * responsibilities. Personality only ever touches tone/framing, never authority
 * (primitive spec: "personality never touches authority"). A near-empty profile
 * still yields a valid generic Chief-of-Staff persona.
 */
export function buildChiefOfStaffPersona(profile: OnboardingProfile): RunPersona {
  const tone = resolveAnimalTone(profile.chosenAnimalId);
  const who = profile.role ? `a ${profile.role}` : "the person in this workspace";
  const framing: string[] = [
    `the primary interlocutor for ${who} and the sole router of every request — you answer directly when you can and delegate to one specialist when it fits, but you are the only node that decides where a turn goes.`,
  ];
  if (profile.goals && profile.goals.length > 0) framing.push(`Their goals right now: ${profile.goals.join("; ")}.`);
  if (profile.domains && profile.domains.length > 0) framing.push(`They work across: ${profile.domains.join(", ")}.`);
  if (profile.workingStyleNotes) framing.push(`Working style to respect: ${profile.workingStyleNotes}.`);
  const responsibilities: readonly string[] = [
    "Understand what the person actually needs and route each turn to the single best capability — never fan out to multiple peers at once.",
    "Answer directly for simple questions; delegate to the Learning, Governance, or Capability-Builder agents (or a skill) when the request fits their mission.",
    "Hold the through-line of the conversation and the person's goals across turns.",
    "Keep every action governed — you propose, you never execute or send anything yourself.",
  ];
  return {
    id: "chief_of_staff",
    name: "Chief of Staff",
    role: framing.join(" "),
    actorType: "agent",
    actorId: "chief_of_staff",
    responsibilities,
    ...(tone ? { tone } : {}),
  };
}
