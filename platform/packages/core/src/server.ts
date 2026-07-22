/**
 * @bridge/core/server — Node-only server-side capability code (TASK-017 D3).
 *
 * `InProcessJsSandboxProvider` dynamically `import("node:vm")`s at runtime.
 * The main "@bridge/core" barrel (index.ts) is imported broadly by
 * browser-facing code (@bridge/web), so this class (and its `node:vm` import)
 * must not be reachable from that file at all — not even as an unused
 * re-export, since a bundler's Node-builtin externalization check fires at
 * module-load/resolution time, before tree-shaking can prune an unused class.
 * It is therefore defined HERE rather than in capability/sandbox-provider.ts
 * (which `builder-primitives.ts` — reachable from the main barrel — imports
 * a real, value-level binding from). Import "@bridge/core/server" only from
 * Node-only runtimes (apps/api, tests) — never from browser-facing code.
 *
 * Everything else on the `SandboxProvider` port (`NotImplementedContainerSandboxProvider`,
 * `UnsupportedSandboxRequestError`, the port interface + request/result types)
 * has no Node builtin import and stays in capability/sandbox-provider.ts,
 * re-exported from the main barrel as before.
 */
import { UnsupportedSandboxRequestError, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult } from "./capability/sandbox-provider.js";

/**
 * The ONLY concrete in-process adapter. Isolation tier "in-process-js" —
 * narrow, no-network, no-filesystem JS EXPRESSION evaluation only, using
 * Node's built-in `vm` module with a frozen/limited context. No new npm
 * dependency (no isolated-vm). This is explicitly NOT a security boundary
 * against a hostile actor (same process, same heap) — it exists only to
 * satisfy narrow "evaluate this JS transform" capability calls (e.g. a
 * formula/template expression), never `shell:execute`.
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
