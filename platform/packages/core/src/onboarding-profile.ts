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
