import type { AtomicStatePort } from "@bridge/core";

const NAMESPACE = "onboarding:phone-otp-proof";

interface ProofState {
  version: 1;
  /** userId -> expiry epoch ms. Single-use: consumed proofs are deleted. */
  proofs: Record<string, number>;
}

function proofState(value: unknown): ProofState {
  if (value && typeof value === "object" && (value as ProofState).version === 1) return value as ProofState;
  return { version: 1, proofs: {} };
}

/** Server-side phone-OTP proof — verifyPhoneOtp issues, saveProfile consumes.
 * Persisted through the Local Plane state port so a restart between the two
 * calls does not silently drop the proof. Expired proofs are pruned on write. */
export class OtpProofStore {
  constructor(
    private readonly state: AtomicStatePort,
    private readonly clock: () => number = Date.now,
  ) {}

  async issue(organizationId: string, userId: string, ttlMs: number): Promise<void> {
    const now = this.clock();
    await this.state.update(organizationId, NAMESPACE, { version: 1, proofs: {} }, (current) => {
      const proofs = Object.fromEntries(
        Object.entries(proofState(current).proofs).filter(([, exp]) => exp > now),
      );
      proofs[userId] = now + ttlMs;
      return { state: { version: 1, proofs } satisfies ProofState, result: undefined };
    });
  }

  async consume(organizationId: string, userId: string): Promise<boolean> {
    const now = this.clock();
    return this.state.update(organizationId, NAMESPACE, { version: 1, proofs: {} }, (current) => {
      const { [userId]: exp, ...rest } = proofState(current).proofs;
      return { state: { version: 1, proofs: rest } satisfies ProofState, result: exp !== undefined && exp > now };
    });
  }
}
