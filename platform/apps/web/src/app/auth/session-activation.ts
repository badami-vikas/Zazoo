export interface SessionActivationCoordinator {
  isActivated(userId: string): boolean;
  activate(userId: string, run: () => Promise<unknown>): Promise<void>;
  reset(): void;
}

export function createSessionActivationCoordinator(): SessionActivationCoordinator {
  let activatedUserId: string | null = null;
  let generation = 0;
  let pending: { userId: string; promise: Promise<void> } | null = null;

  const reset = () => {
    generation += 1;
    activatedUserId = null;
    pending = null;
  };

  return {
    isActivated: (userId) => activatedUserId === userId,
    async activate(userId, run) {
      if (activatedUserId === userId) return;

      if (pending && pending.userId !== userId) reset();
      if (activatedUserId !== null && activatedUserId !== userId) reset();

      if (!pending) {
        const activationGeneration = generation;
        let promise: Promise<void>;
        promise = run()
          .then(() => {
            if (generation === activationGeneration) {
              activatedUserId = userId;
            }
          })
          .finally(() => {
            if (pending?.promise === promise) pending = null;
          });
        pending = { userId, promise };
      }

      await pending.promise;
    },
    reset,
  };
}
