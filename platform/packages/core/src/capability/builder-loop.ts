/**
 * The Builder Agent's loop — the Bridge-native half of BA0. Where the Claude
 * Code backend hands a whole turn to an external agent, this drives Bridge's
 * OWN `ModelProvider` through an action loop, so the Builder works on a local
 * llama.cpp model, on Groq, or on any provider the router can resolve.
 *
 * Why constrained JSON rather than provider function-calling: `ModelProvider` is a
 * deliberately narrow port — one `complete()` that returns text, with an
 * optional JSON-schema response format. Adding native function-call plumbing to
 * every adapter would widen the seam for every consumer to pay for. A loop that
 * asks for one JSON action per step gets the same behaviour from every provider
 * that honours `responseFormat`, including local ones, and keeps the port
 * unchanged. `docs/raw/builder-agent-roadmap-2026-07.md` calls the generation
 * contract "streamed governed action-artifacts"; this is that contract's
 * unstreamed first version — one action per step, each one an audit unit.
 *
 * What this module does NOT do, on purpose:
 *  - It never touches the filesystem. The executor is injected, so @bridge/core
 *    keeps its zero-runtime-dependency discipline and the loop is testable with
 *    a fake in three lines.
 *  - It never decides policy. `decideBuilderPrimitive` already did that inside the
 *    executor; the loop only reacts to the outcome — including stopping when a
 *    call needs approval, because continuing to reason past a call that never
 *    ran produces a transcript describing work that did not happen.
 *  - It never writes to the ledger. The executor audits each call; the caller
 *    records the Run.
 */
import type { ModelProvider, ModelTier } from "../ports.js";

/** One action the model may take per step. `finish` is how it ends a run; a
 * loop that can only act has no way to say "done". */
export type BuilderAction =
  | { kind: "read"; path: string; why: string }
  | { kind: "write"; path: string; content: string; why: string }
  | { kind: "edit"; path: string; old: string; new: string; why: string }
  | { kind: "shell"; command: string; why: string }
  | { kind: "finish"; summary: string };

/** JSON Schema handed to the provider so every step parses. Kept flat (a
 * single `kind` discriminator with optional siblings) because local models
 * follow a flat schema far more reliably than a nested oneOf. */
export const BUILDER_ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "why"],
  properties: {
    kind: { type: "string", enum: ["read", "write", "edit", "shell", "finish"] },
    why: { type: "string" },
    path: { type: "string" },
    content: { type: "string" },
    old: { type: "string" },
    new: { type: "string" },
    command: { type: "string" },
    summary: { type: "string" },
  },
} as const;

/** What the executor reports back. Mirrors the executor's outcomes so the API's
 * `HostPrimitiveExecutor` satisfies this port without an adapter. */
export type BuilderStepResult =
  | { status: "ok"; output: string }
  | { status: "failed"; output: string }
  | { status: "needs_approval"; reason: string }
  | { status: "refused"; reason: string };

export interface BuilderPrimitiveExecutor {
  execute(action: Exclude<BuilderAction, { kind: "finish" }>): Promise<BuilderStepResult>;
}

export interface BuilderLoopStep {
  action: BuilderAction;
  result?: BuilderStepResult;
  /** What the step's own model call cost. Carried per step, not only in the
   * total, because "which action burned the budget" is the question a run
   * review actually asks. */
  usage?: BuilderStepUsage;
}

export interface BuilderStepUsage {
  inputTokens: number;
  outputTokens: number;
}

export type BuilderLoopStopReason =
  | "finished"
  | "needs_approval"
  | "refused"
  | "max_steps"
  | "unparseable_action";

export interface BuilderLoopOutcome {
  stopReason: BuilderLoopStopReason;
  /** The model's closing summary when it finished, or the blocker otherwise. */
  summary: string;
  steps: readonly BuilderLoopStep[];
  /** Totals for the whole run, so the caller can write ONE cost receipt
   * without re-adding the steps. */
  usage: BuilderRunUsage;
}

export interface BuilderRunUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** The model actually answered with, reported by the provider. */
  model: string | null;
}

export interface BuilderLoopOptions {
  task: string;
  system: string;
  provider: ModelProvider;
  executor: BuilderPrimitiveExecutor;
  tier?: ModelTier;
  maxSteps?: number;
  /** Character budget for the transcript handed back to the model. Older observation
   * outputs are elided first; the caller's ledger keeps the full text. */
  contextChars?: number;
  signal?: AbortSignal;
}

const OBSERVATION_KEEP_TAIL = 3;

/**
 * Shrink the transcript to fit a budget by eliding the OLDEST observations
 * first and always keeping the most recent few intact — the recent ones are
 * what the next action depends on. Exported for its own test: a compaction bug
 * is invisible until a long run silently forgets what it did.
 */
export function compactTranscript(lines: string[], budgetChars: number): string[] {
  const size = (rows: string[]) => rows.join("\n").length;
  const out = [...lines];
  for (let i = 0; i < out.length - OBSERVATION_KEEP_TAIL && size(out) > budgetChars; i += 1) {
    const line = out[i]!;
    if (line.startsWith("OBSERVATION:") && line.length > 200) {
      out[i] = `${line.slice(0, 200)} …[elided ${line.length - 200} chars — full text in the Run ledger]`;
    }
  }
  return out;
}

function parseAction(text: string): BuilderAction | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = parsed.kind;
  const why = typeof parsed.why === "string" ? parsed.why : "";
  const str = (key: string): string | null =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : null;

  if (kind === "finish") return { kind: "finish", summary: str("summary") ?? why };
  if (kind === "read") {
    const path = str("path");
    return path ? { kind: "read", path, why } : null;
  }
  if (kind === "write") {
    const path = str("path");
    const content = str("content");
    return path !== null && content !== null ? { kind: "write", path, content, why } : null;
  }
  if (kind === "edit") {
    const path = str("path");
    const oldString = str("old");
    const newString = str("new");
    return path !== null && oldString !== null && newString !== null
      ? { kind: "edit", path, old: oldString, new: newString, why }
      : null;
  }
  if (kind === "shell") {
    const command = str("command");
    return command ? { kind: "shell", command, why } : null;
  }
  return null;
}

/** One line per step, so the model sees what it did rather than being told. */
function describe(action: BuilderAction): string {
  switch (action.kind) {
    case "read":
      return `ACTION: read ${action.path}`;
    case "write":
      return `ACTION: write ${action.path} (${action.content.length} chars)`;
    case "edit":
      return `ACTION: edit ${action.path}`;
    case "shell":
      return `ACTION: shell ${action.command}`;
    case "finish":
      return `ACTION: finish`;
  }
}

/**
 * Run the Builder loop until the model finishes, a call needs a human, or the
 * step budget runs out. Every exit is a named `stopReason` — this function has
 * no path that returns "done" without saying which kind of done it was.
 */
export async function runBuilderLoop(
  options: BuilderLoopOptions,
): Promise<BuilderLoopOutcome> {
  const maxSteps = options.maxSteps ?? 30;
  const contextChars = options.contextChars ?? 24_000;
  const steps: BuilderLoopStep[] = [];
  const usage: BuilderRunUsage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    model: null,
  };
  let transcript: string[] = [`TASK: ${options.task}`];

  for (let step = 0; step < maxSteps; step += 1) {
    transcript = compactTranscript(transcript, contextChars);
    const completion = await options.provider.complete({
      system: options.system,
      prompt: `${transcript.join("\n")}\n\nReturn the next single action as JSON.`,
      tier: options.tier ?? "default",
      responseFormat: {
        type: "json_schema",
        name: "builder_action",
        schema: BUILDER_ACTION_SCHEMA,
        strict: true,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });

    usage.modelCalls += 1;
    usage.inputTokens += completion.usage?.inputTokens ?? 0;
    usage.outputTokens += completion.usage?.outputTokens ?? 0;
    usage.model = completion.model;
    const stepUsage: BuilderStepUsage = {
      inputTokens: completion.usage?.inputTokens ?? 0,
      outputTokens: completion.usage?.outputTokens ?? 0,
    };

    const action = parseAction(completion.text);
    if (!action) {
      // One retry is the model's job, not the loop's: a provider that cannot
      // honour the schema will not honour it on the second ask either, and
      // spending another call to prove that is how a build burns its budget.
      return {
        stopReason: "unparseable_action",
        summary: "The model did not return a valid action. No changes were made in this step.",
        steps,
        usage,
      };
    }

    if (action.kind === "finish") {
      steps.push({ action, usage: stepUsage });
      return { stopReason: "finished", summary: action.summary, steps, usage };
    }

    const result = await options.executor.execute(action);
    steps.push({ action, result, usage: stepUsage });

    if (result.status === "needs_approval") {
      return {
        stopReason: "needs_approval",
        summary: result.reason,
        steps,
        usage,
      };
    }
    if (result.status === "refused") {
      return { stopReason: "refused", summary: result.reason, steps, usage };
    }

    transcript.push(describe(action));
    transcript.push(`OBSERVATION: ${result.output}`);
  }

  return {
    stopReason: "max_steps",
    summary: `Stopped after ${maxSteps} steps without finishing.`,
    steps,
    usage,
  };
}
