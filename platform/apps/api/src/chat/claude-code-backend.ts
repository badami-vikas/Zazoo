/**
 * Claude Code as a Bridge chat backend — Claude Code the coding agent, running
 * headless inside the API process, answering turns in the Right Chat Panel and
 * the Avatar composer.
 *
 * "Runs terminal in backend" is the requirement and it is meant literally: the
 * Agent SDK spawns the Claude Code CLI as a subprocess, that subprocess reads
 * and edits files and runs commands in the Organization's Module directory,
 * and none of it is ever shown as a terminal. The user sees a chat reply. This
 * is the myzazoo `src/agents/claude.ts` adapter, widened to Bridge's
 * `ChatBackend` port so Codex and Cursor drop in beside it as registry rows.
 *
 * What this file deliberately does NOT do:
 *  - It does not parse Bridge's assistant envelope. Claude Code never saw that
 *    schema; the router wraps the reply as `{kind:"answer"}` instead of
 *    pretending the backend produced one.
 *  - It does not implement its own governance. Tool permission inside the SDK
 *    loop is the SDK's `permissionMode`; what lands in the repository is gated
 *    by the branch-and-merge rule Bridge already enforces, and by
 *    `tool-policy.ts`'s absolute deny list applied to the working directory it
 *    is handed. A second governance plane beside Bridge's authority plane is
 *    exactly what ADR-194 says not to build.
 *  - It does not hold credentials. The OAuth token comes from
 *    `ClaudeOAuthStore` (Local Plane vault) at the top of every turn.
 *
 * Residency: `plane: "cloud"`. The subprocess runs on this machine, but the
 * file contents it reads are sent to Anthropic's hosted models — where the DATA
 * goes is the residency question, not where the process runs.
 */
import type {
  ChatBackend,
  ChatBackendReadiness,
  ChatBackendSendArgs,
  ChatBackendTurn,
} from "@bridge/core";
import type { ClaudeOAuthStore } from "./claude-oauth.js";

/** Errors whose text means "the user needs to sign in again", as opposed to a
 * transport or model failure. Matches the myzazoo heuristic; kept as a
 * heuristic because the SDK surfaces auth failures as plain messages. */
export function isClaudeAuthError(message: string): boolean {
  return /authenticat|oauth|401|invalid api key|log ?in|sign.?in|credit balance/i.test(message);
}

export interface ClaudeCodeBackendOptions {
  oauth: ClaudeOAuthStore;
  /** Turn cap per send — a runaway loop costs money and wall-clock time. */
  maxTurns?: number;
  /** SDK permission mode. `acceptEdits` lets file edits land without a prompt
   * (the branch is the review boundary); riskier tools still ask, and the ask
   * fails closed here because there is no interactive terminal to answer it. */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  env?: NodeJS.ProcessEnv;
}

export function createClaudeCodeBackend(
  options: ClaudeCodeBackendOptions,
): ChatBackend {
  const env = options.env ?? process.env;
  const maxTurns = options.maxTurns ?? Number(env.BRIDGE_CLAUDE_CHAT_MAX_TURNS ?? 30);
  const permissionMode =
    options.permissionMode ??
    ((env.BRIDGE_CLAUDE_CHAT_PERMISSION as ClaudeCodeBackendOptions["permissionMode"]) ??
      "acceptEdits");

  return {
    id: "claude_code",
    label: "Claude Code",
    plane: "cloud",
    agentic: true,

    async readiness(organizationId): Promise<ChatBackendReadiness> {
      const token = await options.oauth.accessToken(organizationId).catch(() => null);
      if (token) return { ready: true };
      // An existing `~/.claude` login on this machine still works — the SDK
      // finds it itself — so absence of a Bridge-held token is not proof of
      // "not signed in". Report it as a sign-in prompt rather than a hard no,
      // and let the first turn confirm.
      return {
        ready: true,
        reason: "No Bridge-held Claude sign-in — an existing Claude Code login on this machine will be used if present",
        needsSignIn: true,
      };
    },

    async send(args: ChatBackendSendArgs): Promise<ChatBackendTurn> {
      const token = await options.oauth.accessToken(args.organizationId).catch(() => null);
      try {
        return await sendOnce({ ...args, token, maxTurns, permissionMode });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isClaudeAuthError(message)) {
          throw new ClaudeSignInRequiredError();
        }
        throw error;
      }
    },
  };
}

/** Thrown when the turn failed for a reason the user can fix by signing in.
 * The router maps it to a typed response so the UI can show the sign-in flow
 * inline rather than a generic error toast. */
export class ClaudeSignInRequiredError extends Error {
  constructor() {
    super("Claude needs sign-in");
    this.name = "ClaudeSignInRequiredError";
  }
}

async function sendOnce(
  args: ChatBackendSendArgs & {
    token: string | null;
    maxTurns: number;
    permissionMode: NonNullable<ClaudeCodeBackendOptions["permissionMode"]>;
  },
): Promise<ChatBackendTurn> {
  // Dynamic import keeps the SDK (and the CLI subprocess it carries) out of the
  // API's boot path — a deployment that never selects this backend never loads
  // it, and the public-cloud build does not pay for it at all.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  // The env var is what the spawned CLI reads; set it for this call only when
  // Bridge holds a token, so an existing ~/.claude login keeps working when it
  // does not.
  const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (args.token) process.env.CLAUDE_CODE_OAUTH_TOKEN = args.token;

  try {
    const stream = query({
      prompt: args.text,
      options: {
        cwd: args.workingDirectory,
        ...(args.system
          ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: args.system } }
          : {}),
        ...(args.backendSessionId ? { resume: args.backendSessionId } : {}),
        permissionMode: args.permissionMode,
        maxTurns: args.maxTurns,
        ...(args.signal ? { abortController: abortControllerFor(args.signal) } : {}),
      },
    });

    let sessionId = args.backendSessionId;
    let result = "";
    let lastAssistantText = "";
    const changedPaths = new Set<string>();

    for await (const message of stream as AsyncIterable<Record<string, any>>) {
      if (typeof message.session_id === "string") sessionId = message.session_id;

      if (message.type === "assistant") {
        const blocks: any[] = message.message?.content ?? [];
        const text = blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        if (text) lastAssistantText = text;
        for (const block of blocks) {
          if (block.type !== "tool_use") continue;
          const path = block.input?.file_path ?? block.input?.path;
          if (typeof path === "string" && /^(Write|Edit|NotebookEdit)$/.test(String(block.name))) {
            changedPaths.add(path);
          }
        }
      }

      if (message.type === "result") {
        result =
          message.subtype === "success"
            ? (message.result ?? lastAssistantText)
            : `[${message.subtype}] ${lastAssistantText}`;
      }
    }

    return {
      reply: result || lastAssistantText || "[no reply]",
      backendSessionId: sessionId,
      changedPaths: [...changedPaths],
    };
  } finally {
    if (args.token) {
      if (previous === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous;
    }
  }
}

/** The SDK takes an AbortController, the router owns an AbortSignal; bridge the
 * two without letting an already-aborted signal start work. */
function abortControllerFor(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}
