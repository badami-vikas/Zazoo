/**
 * A Builder Run — the piece that had been missing between the three halves of
 * BA0. `runBuilderLoop` decides the next action, `HostPrimitiveExecutor` performs
 * it, and until now nothing called either: they were built and unwired, which
 * is the same as not shipped.
 *
 * What this module adds is the governed envelope around them:
 *
 *  1. The Module's own policy decides whether the Builder may run here at all
 *     (`assertModuleGovernance`, ADR-263). A Module that denies `builder.run`
 *     refuses with the user's own stated reason.
 *  2. Every primitive call — executed, escalated, or refused — appends a ledger
 *     row before its result is returned. That is the executor's `audit` hook,
 *     which had no consumer; here it is the ledger.
 *  3. The Run closes with ONE receipt row carrying the stop reason and the
 *     token cost the loop accumulated. BA0's third exit criterion is "every
 *     action has a ledger row with cost"; this is that row.
 *
 * Not in scope, deliberately: an approval round-trip. A call that needs
 * approval STOPS the run and is reported, because a Builder that pauses
 * mid-loop waiting on a human is a durable-workflow problem (BA4), not a
 * sixty-line one. The user's execution-first directive means most calls never
 * reach that branch.
 */
import {
  assertModuleGovernance,
  hashTaintValue,
  labelAtSource,
  runBuilderLoop,
  type BuilderRunUsage,
  type ModelProvider,
  type ModuleGovernancePolicy,
  type ModulePrimitivePolicy,
  type RunCtx,
} from "@bridge/core";
import { BUILDER_AGENT_RUNTIME_ID } from "@bridge/module-manifests";
import { HostPrimitiveExecutor, type PrimitiveAuditEntry } from "./primitive-executor.js";
import type { Wiring } from "../wiring.js";

/** The governed action name the Module policy is asked about. Dotted, like
 * every other governance selector, so `builder.*` governs the whole surface. */
export const BUILDER_RUN_ACTION = "builder.run";

const SYSTEM_PROMPT = [
  "You are Bridge's Builder Agent. You work inside one Module's folder on the",
  "user's own machine, one action at a time, and you never explain instead of",
  "acting: return exactly one JSON action per step.",
  "Read before you write. Verify what you changed by running the Module's own",
  "check when there is one. Finish as soon as the task is done, with a summary",
  "of what changed — not a plan of what you would do.",
].join(" ");

export interface BuilderRunArgs {
  wiring: Pick<Wiring, "ledger">;
  run: RunCtx;
  organizationId: string;
  /** Who asked. Recorded as the on-behalf-of actor for every row. */
  actorUserId: string;
  moduleName: string;
  /** The Module's resolved governance (declared + Organization overlay). */
  governance: ModuleGovernancePolicy | null;
  /** Absolute directory every path in this Run resolves inside. */
  workingDirectory: string;
  task: string;
  provider: ModelProvider;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface BuilderRunReceipt {
  runId: string;
  stopReason: string;
  summary: string;
  /** One entry per primitive call, in order — the same shape the ledger got. */
  actions: readonly PrimitiveAuditEntry[];
  usage: BuilderRunUsage;
}

export async function runModuleBuilder(args: BuilderRunArgs): Promise<BuilderRunReceipt> {
  // The Module's policy has the first word. A denial here throws
  // ModuleGovernanceDenied carrying the rule, so the caller can quote the
  // user's own reason back rather than a generic refusal.
  assertModuleGovernance(args.moduleName, args.governance ?? undefined, BUILDER_RUN_ACTION);

  const runId = args.run.ids.next();
  const actions: PrimitiveAuditEntry[] = [];

  // The command allow/deny layer. An empty policy is NOT a default-deny
  // (ADR-263) and not a default-approve: ABSOLUTE_DENY and ALWAYS_APPROVE
  // still apply inside `decideBuilderPrimitive`, and everything else runs.
  // The Module's dotted governance rules govern WHETHER the Builder runs, not
  // which shell globs it may use — those are two vocabularies, and collapsing
  // them would silently reinterpret rules the user wrote for something else.
  const policy: ModulePrimitivePolicy = {};

  const taint = (ref: string, value: unknown) =>
    labelAtSource("system_generated", {
      ref,
      valueHash: hashTaintValue(value),
      sensitivity: "organization",
      instructionRisk: "data",
    });

  const executor = new HostPrimitiveExecutor({
    workingDirectory: args.workingDirectory,
    policy,
    audit: async (entry) => {
      actions.push(entry);
      await args.wiring.ledger.append({
        id: args.run.ids.next(),
        organizationId: args.organizationId,
        actorType: "agent",
        actorId: BUILDER_AGENT_RUNTIME_ID,
        onBehalfOfType: "user",
        onBehalfOfId: args.actorUserId,
        action: entry.token === "file:read" ? "read" : "write",
        resourceType: "record",
        inputs: {
          operation: "builder_primitive",
          runId,
          moduleName: args.moduleName,
          token: entry.token,
          // The path or command, never the file's contents.
          target: entry.target,
          riskBand: entry.riskBand,
        },
        proposedOutput: {
          decision: entry.decision,
          status: entry.status,
          reason: entry.reason,
          ...(entry.detail ? { detail: entry.detail } : {}),
        },
        // "auto" for every outcome: the gate decided, not a human. Whether the
        // call ran, escalated, or was refused is `proposedOutput.decision` —
        // recording a refusal as a human veto would fabricate a decision maker.
        userDecision: "auto",
        policyResults: [],
        dataScope: "private",
        taintLabel: taint(`builder:${runId}:${entry.token}`, {
          target: entry.target,
          status: entry.status,
        }),
        createdAt: args.run.clock.nowISO(),
      });
    },
  });

  const outcome = await runBuilderLoop({
    task: args.task,
    system: SYSTEM_PROMPT,
    provider: args.provider,
    executor: {
      execute: (action) => {
        switch (action.kind) {
          case "read":
            return executor.run({ token: "file:read", path: action.path });
          case "write":
            return executor.run({
              token: "file:write",
              path: action.path,
              content: action.content,
            });
          case "edit":
            return executor.run({
              token: "file:edit",
              path: action.path,
              oldString: action.old,
              newString: action.new,
            });
          case "shell":
            return executor.run({ token: "shell:execute", command: action.command });
        }
      },
    },
    ...(args.maxSteps === undefined ? {} : { maxSteps: args.maxSteps }),
    ...(args.signal ? { signal: args.signal } : {}),
  });

  // The receipt. One row, written whichever way the Run ended — a Run that
  // stopped for approval or ran out of steps still cost tokens, and a cost
  // record that only exists on success is not a cost record.
  await args.wiring.ledger.append({
    id: runId,
    organizationId: args.organizationId,
    actorType: "agent",
    actorId: BUILDER_AGENT_RUNTIME_ID,
    onBehalfOfType: "user",
    onBehalfOfId: args.actorUserId,
    action: "write",
    resourceType: "record",
    inputs: {
      operation: "builder_run",
      runId,
      moduleName: args.moduleName,
      task: args.task,
      model: outcome.usage.model,
      modelCalls: outcome.usage.modelCalls,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    },
    proposedOutput: {
      stopReason: outcome.stopReason,
      summary: outcome.summary,
      actionCount: actions.length,
    },
    userDecision: "auto",
    policyResults: [],
    dataScope: "private",
    taintLabel: taint(`builder:${runId}:receipt`, {
      stopReason: outcome.stopReason,
      actionCount: actions.length,
    }),
    createdAt: args.run.clock.nowISO(),
  });

  return {
    runId,
    stopReason: outcome.stopReason,
    summary: outcome.summary,
    actions,
    usage: outcome.usage,
  };
}
