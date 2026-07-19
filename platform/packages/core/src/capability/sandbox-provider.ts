/**
 * SandboxProvider — the execution-isolation port `builder-primitives.ts`'s `shell:execute`
 * and `code:exec`-shaped resource tokens run through (Track F2, execution-plan
 * 2026-07 + ADR-027 "External-review adaptations"). ADR-027's sandbox doctrine,
 * verbatim: "isolated-vm = narrow no-network JS transforms ONLY; shell:execute/
 * code:exec = container/microVM via SandboxProvider port, E2B adapter for
 * cloud; NEVER isolated-vm for shell, never raw host."
 *
 * This module holds the port + ONE concrete adapter (`InProcessJsSandboxProvider`,
 * isolation tier "in-process-js", Node's built-in `vm` module — no new
 * dependency, no isolated-vm). It deliberately does NOT ship a container/E2B
 * adapter: `NotImplementedContainerSandboxProvider` stubs that interface with a
 * clear throw, so a caller wiring `shell:execute` in dev/test sees an explicit
 * "not implemented" failure rather than silently falling through to the JS
 * sandbox. The type-level guard against that fallthrough lives in
 * `InProcessJsSandboxProvider.run()`'s signature: it only accepts
 * `SandboxRunRequest & { kind: "js-eval" }`, so a `shell:execute`-shaped request
 * (`kind: "shell"`) is not assignable to its parameter type at all — this is
 * checked by `sandbox-provider.test.ts` (a runtime assertion mirrors the
 * compile-time guard for callers that build the request dynamically/untyped).
 */

/** How isolated a `SandboxProvider` implementation actually is — an
 * implementation MUST declare this; it is never inferred or defaulted, so a
 * caller choosing a provider for a risk-sensitive request (operational+
 * "shell:execute" per CLAUDE.md/risk.ts) can check it directly rather than
 * trusting a name/comment. Ordered loosely least->most isolated, but callers
 * should treat this as a set of capabilities, not a strict order:
 *   - "in-process-js": runs inside the host Node process (V8 `vm` context) —
 *     NOT a security boundary against a determined attacker; no network, no
 *     filesystem, no host process access, narrow JS-expression-only surface.
 *   - "container": an OS-level container (e.g. gVisor/Docker/Firecracker-lite)
 *     — real filesystem/process isolation, still same-kernel unless hardened.
 *   - "microvm": a full micro-VM boundary (e.g. Firecracker via E2B) — the
 *     only tier ADR-027 accepts for untrusted `shell:execute`.
 */
export type SandboxIsolationTier = "in-process-js" | "container" | "microvm";

/** The two request shapes a `SandboxProvider` may be asked to run. Kept as a
 * discriminated union (not two separate methods) so a single `run()` call site
 * in `builder-primitives.ts` can dispatch on `.kind` and so an adapter's accepted-request
 * type can be narrowed at the type level (see `InProcessJsSandboxProvider`). */
export type SandboxRunRequest =
  | {
      kind: "js-eval";
      /** A single JS expression/statement block — no `require`, no network,
       * no filesystem. The ONLY thing `InProcessJsSandboxProvider` may run. */
      code: string;
      /** Wall-clock budget in milliseconds; provider MUST enforce it. */
      timeoutMs: number;
    }
  | {
      kind: "shell";
      /** Shell command line (or argv-shaped) to execute inside a
       * container/microVM boundary. NEVER runnable by `InProcessJsSandboxProvider`
       * — see that class's `run()` signature, which does not accept this variant. */
      command: string;
      args?: string[];
      /** Working directory scoped by the caller's resource-token constraints
       * (builder-primitives.ts) — the provider trusts this is already sandboxed, it does
       * not itself re-derive workspace scoping. */
      cwd?: string;
      timeoutMs: number;
    };

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  /** Process/eval exit code — 0 = success. Non-zero or null (killed by
   * timeout) both indicate failure; callers should not assume non-zero always
   * means "handled" cleanly. */
  exitCode: number | null;
  durationMs: number;
  /** True when the provider killed the run for exceeding `timeoutMs`. */
  timedOut: boolean;
}

/**
 * The port every sandbox execution adapter implements. `isolationTier` is a
 * required, explicit property (not a static/const derived elsewhere) so a
 * caller holding only a `SandboxProvider`-typed reference can still read the
 * tier off the instance before deciding whether to route a request to it.
 */
export interface SandboxProvider {
  readonly isolationTier: SandboxIsolationTier;
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}

/**
 * Thrown by any adapter asked to run a request kind it does not support at its
 * isolation tier — e.g. `shell:execute` presented to an "in-process-js"
 * provider. Distinct from a generic Error so callers (builder-primitives.ts's
 * `shellExecute`) can catch it specifically and translate it into a policy
 * denial rather than an unhandled crash.
 */
export class UnsupportedSandboxRequestError extends Error {
  constructor(
    public readonly isolationTier: SandboxIsolationTier,
    public readonly requestKind: SandboxRunRequest["kind"],
  ) {
    super(
      `SandboxProvider (isolationTier="${isolationTier}") cannot run request kind "${requestKind}" — ` +
        `shell:execute/code:exec requires isolationTier "container" or "microvm" (ADR-027).`,
    );
    this.name = "UnsupportedSandboxRequestError";
  }
}

/**
 * The ONLY concrete adapter shipped in this module. Isolation tier
 * "in-process-js" — narrow, no-network, no-filesystem JS EXPRESSION evaluation
 * only, using Node's built-in `vm` module with a frozen/limited context. No new
 * npm dependency (no isolated-vm). This is explicitly NOT a security boundary
 * against a hostile actor (same process, same heap) — it exists only to satisfy
 * narrow "evaluate this JS transform" capability calls (e.g. a formula/template
 * expression), never `shell:execute`.
 *
 * Type-level guard against the shell fallthrough ADR-027 warns about: `run()`
 * only accepts `SandboxRunRequest & { kind: "js-eval" }`, which is narrower
 * than the `SandboxProvider` interface's `run(request: SandboxRunRequest)`.
 * TypeScript's method-parameter bivariance means this class is still
 * STRUCTURALLY assignable to `SandboxProvider` (the whole point — callers hold
 * it via the port), but any caller that narrows to this CONCRETE class first
 * and passes a `{ kind: "shell", ... }` literal gets a compile error, and any
 * caller going through the wider `SandboxProvider` interface gets the runtime
 * `UnsupportedSandboxRequestError` thrown below instead of silent shell
 * execution. Both paths are exercised in sandbox-provider.test.ts.
 */
export class InProcessJsSandboxProvider implements SandboxProvider {
  readonly isolationTier = "in-process-js" as const;

  async run(request: SandboxRunRequest & { kind: "js-eval" }): Promise<SandboxRunResult> {
    const start = Date.now();

    // Runtime guard mirrors the type-level one: if a caller went through the
    // wider `SandboxProvider` interface (erasing the narrowed parameter type)
    // and handed us a "shell" request, refuse loudly rather than attempt it.
    if ((request as SandboxRunRequest).kind !== "js-eval") {
      throw new UnsupportedSandboxRequestError(this.isolationTier, (request as SandboxRunRequest).kind);
    }

    const vm = await import("node:vm");

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exitCode: number | null = 0;

    // Frozen/limited context: no `require`, no `process`, no `globalThis`
    // reach-through, no filesystem/network handles. `console` is shimmed to
    // capture output rather than writing to the host's real stdout/stderr.
    const sandboxConsole = {
      log: (...args: unknown[]) => {
        stdout += args.map(String).join(" ") + "\n";
      },
      error: (...args: unknown[]) => {
        stderr += args.map(String).join(" ") + "\n";
      },
    };
    const context = vm.createContext(
      Object.freeze({ console: Object.freeze(sandboxConsole) }),
      { name: "bridge-in-process-js-sandbox", codeGeneration: { strings: false, wasm: false } },
    );

    try {
      const script = new vm.Script(request.code, { filename: "bridge-sandbox-eval.js" });
      const result = script.runInContext(context, { timeout: request.timeoutMs });
      if (result !== undefined) stdout += String(result) + "\n";
    } catch (err) {
      exitCode = 1;
      // `vm.Script.runInContext`'s timeout error is NOT a same-realm `Error`
      // instance (`err instanceof Error` is false for it, even though it has
      // a `.message`/`.name`) -- duck-type on `.message` (falling back to
      // `String(err)`) rather than gating on `instanceof Error`, which would
      // silently miss every timeout and mis-set `timedOut`.
      const message = typeof (err as { message?: unknown } | null)?.message === "string"
        ? (err as { message: string }).message
        : String(err);
      if (/Script execution timed out/i.test(message)) {
        timedOut = true;
      }
      stderr += message + "\n";
    }

    return {
      stdout,
      stderr,
      exitCode: timedOut ? null : exitCode,
      durationMs: Date.now() - start,
      timedOut,
    };
  }
}

/**
 * Stub only — NOT a real container/E2B adapter. Declares `isolationTier:
 * "container"` (satisfying the port's type) but every `run()` call throws
 * immediately with a clear "requires container/E2B runtime" message. This lets
 * kernel wiring reference a container-tier `SandboxProvider` (e.g. for
 * `shell:execute` request routing in `builder-primitives.ts`) in dev/test WITHOUT ever
 * silently executing on the host — the absence of a real adapter is loud, not
 * silent. A real implementation (E2B, per ADR-027/execution-plan Track F2)
 * replaces this class; it does not extend it.
 */
export class NotImplementedContainerSandboxProvider implements SandboxProvider {
  readonly isolationTier = "container" as const;

  async run(_request: SandboxRunRequest): Promise<SandboxRunResult> {
    throw new Error(
      "NotImplementedContainerSandboxProvider: shell:execute/code:exec requires a real " +
        "container/microVM runtime (E2B adapter, per ADR-027) — none is wired yet. " +
        "This stub exists only to type-satisfy the SandboxProvider port; it must never be " +
        "used to actually execute shell commands.",
    );
  }
}
