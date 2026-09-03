/**
 * The Builder Agent's primitive executor — the first code in Bridge that actually
 * EXECUTES a builder primitive rather than classifying one.
 *
 * `@bridge/core`'s `builder-primitives.ts` has long had the risk lookup, the
 * grant-scope check and the `SandboxProvider` port; what it never had was
 * anything that reads a file, writes a file, or runs a command. This module is
 * that missing half, and it is deliberately small: four operations, one gate,
 * one ledger append per call.
 *
 * Execution model (user directive, 2026-09-02 — "governance but not at cost of
 * execution; seek approval only if high risk"):
 *
 *   decideBuilderPrimitive → "execute"  run it now, record it, return the result
 *                  → "approve"  do not run; return a typed `needs_approval`
 *                               outcome carrying the reason, so the caller
 *                               raises ONE proposal through the existing
 *                               Universal Action Pipeline
 *                  → "refuse"   never runs, cannot be approved
 *
 * Where the sandbox doctrine lands. ADR-027 requires container/microVM
 * isolation for `shell:execute` of UNTRUSTED capability bodies, and that rule
 * is untouched: `runShellExecute` + `SandboxProvider` remain the only path for
 * code that came from Commons, an import, or a generated artifact. This module
 * covers the different case the roadmap had not separated out — the Builder
 * Agent working, at the user's explicit request, inside the user's OWN Bridge
 * folder on the user's OWN machine, which is exactly the myzazoo model the user
 * asked Bridge to match. There the trust boundary is not a container; it is the
 * allow/deny gate plus the fact that the agent works on a branch and the merge
 * is the user's click. `HostPrimitiveExecutor` therefore declares itself `host-process`
 * and refuses to be handed to any caller expecting a sandbox: it does not
 * implement `SandboxProvider`, so it cannot be mistaken for one.
 *
 * Every call — executed, escalated or refused — appends to the immutable
 * ledger before returning. An unrecorded tool call is the one outcome this
 * module treats as a bug rather than a risk.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  classifyBuilderPrimitiveRisk,
  decideBuilderPrimitive,
  type BuilderPrimitiveToken,
  type ModulePrimitivePolicy,
  type PrimitivePolicyDecision,
} from "@bridge/core";

/** Output cap per call. A tool result is model context, and an unbounded
 * result is how a build session burns its budget on a `find /`. */
const MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function truncate(value: string): string {
  return value.length > MAX_OUTPUT_CHARS
    ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${value.length - MAX_OUTPUT_CHARS} chars]`
    : value;
}

export type PrimitiveCall =
  | { token: "file:read"; path: string }
  | { token: "file:write"; path: string; content: string }
  | { token: "file:edit"; path: string; oldString: string; newString: string; replaceAll?: boolean }
  | { token: "shell:execute"; command: string; timeoutMs?: number };

export type PrimitiveOutcome =
  | { status: "ok"; output: string }
  /** Not run. The caller raises one proposal and retries after a decision. */
  | { status: "needs_approval"; reason: string; token: BuilderPrimitiveToken }
  /** Not run, and no approval can change that. */
  | { status: "refused"; reason: string }
  /** Ran, and failed on its own terms (non-zero exit, missing file). */
  | { status: "failed"; output: string };

/** What the executor records for each call. The caller owns the ledger; this
 * module owns the shape, so a Builder Run's audit trail is uniform whether the
 * call executed, escalated, or was refused. */
export interface PrimitiveAuditEntry {
  token: BuilderPrimitiveToken;
  /** The path or command acted on — never file CONTENT, which can be private. */
  target: string;
  decision: PrimitivePolicyDecision["outcome"];
  reason: string;
  riskBand: string;
  status: PrimitiveOutcome["status"];
  /** Bytes written / read, or process exit code — a size, never a payload. */
  detail?: string;
}

export interface PrimitiveExecutorOptions {
  /** Absolute directory every path resolves inside. */
  workingDirectory: string;
  /** The owning Module's declared allow/deny (ADR-263 governance block). */
  policy: ModulePrimitivePolicy;
  /** Called once per tool call, before the result is returned. Throwing here
   * fails the call — an unrecorded execution is not an acceptable outcome. */
  audit: (entry: PrimitiveAuditEntry) => Promise<void>;
  /** Environment for spawned commands. Defaults to a minimal PATH-only env, so
   * a build cannot read the API process's own secrets out of `process.env`. */
  shellEnv?: NodeJS.ProcessEnv;
}

/**
 * The host executor. Not a `SandboxProvider` and never assignable to one — see
 * the header. Instantiate one per Builder Run, per Module.
 */
export class HostPrimitiveExecutor {
  /** Declared, not inferred, and deliberately not one of the
   * `SandboxIsolationTier` values: this is not a sandbox and must not be
   * selected by code shopping for one. */
  readonly isolation = "host-process" as const;

  readonly #root: string;
  readonly #policy: ModulePrimitivePolicy;
  readonly #audit: PrimitiveExecutorOptions["audit"];
  readonly #shellEnv: NodeJS.ProcessEnv;

  constructor(options: PrimitiveExecutorOptions) {
    this.#root = resolve(options.workingDirectory);
    this.#policy = options.policy;
    this.#audit = options.audit;
    this.#shellEnv = options.shellEnv ?? {
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME ?? "",
      LANG: process.env.LANG ?? "en_US.UTF-8",
    };
  }

  async run(call: PrimitiveCall): Promise<PrimitiveOutcome> {
    const target = call.token === "shell:execute" ? call.command : call.path;
    const decision = decideBuilderPrimitive(
      call.token === "shell:execute"
        ? { token: call.token, command: call.command }
        : { token: call.token, path: call.path },
      this.#policy,
    );
    const { riskBand } = classifyBuilderPrimitiveRisk(call.token);

    if (decision.outcome === "refuse") {
      const outcome: PrimitiveOutcome = { status: "refused", reason: decision.reason };
      await this.#record(call.token, target, decision, riskBand, outcome);
      return outcome;
    }
    if (decision.outcome === "approve") {
      const outcome: PrimitiveOutcome = {
        status: "needs_approval",
        reason: decision.reason,
        token: call.token,
      };
      await this.#record(call.token, target, decision, riskBand, outcome);
      return outcome;
    }

    const outcome = await this.#execute(call);
    await this.#record(call.token, target, decision, riskBand, outcome);
    return outcome;
  }

  async #record(
    token: BuilderPrimitiveToken,
    target: string,
    decision: PrimitivePolicyDecision,
    riskBand: string,
    outcome: PrimitiveOutcome,
  ): Promise<void> {
    await this.#audit({
      token,
      target,
      decision: decision.outcome,
      reason: decision.reason,
      riskBand,
      status: outcome.status,
      ...(outcome.status === "ok" || outcome.status === "failed"
        ? { detail: `${outcome.output.length} chars` }
        : {}),
    });
  }

  /** Second containment check, after the policy gate: resolve the path and
   * confirm it is still under the root. The policy gate works on the string;
   * this works on the resolved path, so a symlink-shaped or
   * platform-specific escape the string check missed still fails here. */
  #resolveInside(path: string): string | null {
    const resolved = resolve(this.#root, path);
    if (resolved !== this.#root && !resolved.startsWith(this.#root + sep)) return null;
    return resolved;
  }

  async #execute(call: PrimitiveCall): Promise<PrimitiveOutcome> {
    if (call.token === "shell:execute") {
      return this.#shell(call.command, call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }

    const resolved = this.#resolveInside(call.path);
    if (!resolved) {
      return { status: "refused", reason: `"${call.path}" resolves outside the working directory` };
    }

    try {
      if (call.token === "file:read") {
        return { status: "ok", output: truncate(await readFile(resolved, "utf8")) };
      }
      if (call.token === "file:write") {
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, call.content);
        return { status: "ok", output: `wrote ${call.path} (${call.content.length} chars)` };
      }
      const text = await readFile(resolved, "utf8");
      const occurrences = text.split(call.oldString).length - 1;
      if (occurrences === 0) {
        return { status: "failed", output: `old string not found in ${call.path}` };
      }
      if (occurrences > 1 && call.replaceAll !== true) {
        return {
          status: "failed",
          output: `old string occurs ${occurrences} times in ${call.path}; pass replaceAll or be more specific`,
        };
      }
      await writeFile(resolved, text.split(call.oldString).join(call.newString));
      return {
        status: "ok",
        output: `edited ${call.path} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`,
      };
    } catch (error) {
      return {
        status: "failed",
        output: error instanceof Error ? error.message : "unknown filesystem error",
      };
    }
  }

  /** `spawn` with an explicit argv rather than a shell string would be safer,
   * but a build agent legitimately needs pipes and globs, so the command runs
   * through `bash -c` and the policy gate is what stands between it and the
   * machine. That is the deliberate trade the header describes. */
  #shell(command: string, timeoutMs: number): Promise<PrimitiveOutcome> {
    return new Promise((resolveOutcome) => {
      const child = spawn("bash", ["-c", command], {
        cwd: this.#root,
        env: this.#shellEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let settled = false;
      const finish = (result: PrimitiveOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOutcome(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ status: "failed", output: `${truncate(output)}\n[timed out after ${timeoutMs}ms]` });
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on("error", (error) => finish({ status: "failed", output: error.message }));
      child.on("close", (code) => {
        finish(
          code === 0
            ? { status: "ok", output: truncate(output) }
            : { status: "failed", output: `${truncate(output)}\n[exit ${code}]` },
        );
      });
    });
  }
}
