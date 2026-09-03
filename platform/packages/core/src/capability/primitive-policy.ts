/**
 * PrimitivePolicy — the one pre-execution gate every Builder Agent primitive call passes
 * through, and the place the "execution-first, approval only when the risk is
 * real" rule is actually encoded (user directive, 2026-09-02: "I want
 * governance but not at cost of execution. Seek approval only if high risk
 * task, else lets have execution first approach").
 *
 * Three outcomes, never two:
 *
 *   execute  — the call runs now, no human in the loop. This is the DEFAULT
 *              for reads, writes and edits inside the Module's own directory,
 *              and for commands the Module's manifest allows.
 *   approve  — the call is real and probably fine, but its blast radius is
 *              outside what the Module declared: it becomes a Proposal through
 *              the existing Universal Action Pipeline and waits for a human.
 *   refuse   — the call is denied outright and no approval can unlock it. The
 *              deny list is short and absolute (see ABSOLUTE_DENY): the things
 *              that end a session's reviewability or leave the machine.
 *
 * The refuse list is deliberately not "everything dangerous" — it is the set of
 * actions that would destroy the user's ability to review what the agent did.
 * An agent that can `git push` has already shipped; an agent that can
 * `rm -rf /` has already destroyed. Everything in between is either allowed by
 * the Module's own policy or routed to a human, which is what makes
 * execution-first safe rather than merely fast.
 *
 * Pure and synchronous, zero runtime dependencies, no I/O — same discipline as
 * risk.ts and builder-primitives.ts, and for the same reason: a gate that
 * cannot be unit-tested exhaustively is not a gate.
 */
import type { BuilderPrimitiveToken } from "./builder-primitives.js";

export type PrimitivePolicyOutcome = "execute" | "approve" | "refuse";

export interface PrimitivePolicyDecision {
  outcome: PrimitivePolicyOutcome;
  /** Human-readable basis, always present — an audit row with a bare verdict
   * and no reason is not auditable (mirrors AuthorityDecision.reason). */
  reason: string;
  /** The specific pattern that produced a refuse/approve, when one did. */
  matchedPattern?: string;
}

/**
 * A Module's declared primitive policy — the Bridge equivalent of the module.yaml
 * allow/deny pair, read from the Module manifest's `governance` block
 * (ADR-263), never self-declared by the agent at call time.
 *
 * Semantics, chosen to keep the default executable rather than blocked:
 *  - `deny` always wins and produces `refuse`.
 *  - `allow` present  → a command matching it executes; anything else needs
 *    approval (NOT refusal — the human can still say yes).
 *  - `allow` absent   → commands execute unless denied. An empty policy is not
 *    a default-deny (CLAUDE.md, ADR-263) and it is not a default-approve
 *    either; a Module that declared nothing gets the ordinary execution path.
 */
export interface ModulePrimitivePolicy {
  /** Glob-shaped command patterns that may run without asking. */
  allow?: readonly string[];
  /** Glob-shaped command patterns that may never run. */
  deny?: readonly string[];
  /** Repository-relative glob patterns the agent may write to. Absent means
   * "anywhere inside the working directory"; present narrows it, and a write
   * outside the patterns escalates to approval rather than being refused. */
  writePaths?: readonly string[];
}

/**
 * Commands no Module policy and no human approval can unlock, because each one
 * removes the user's ability to review or undo the agent's work. Merge and
 * push are here for the same reason they are in myzazoo's hook: the agent
 * works on a branch and the merge is the user's click, always.
 */
export const ABSOLUTE_DENY: readonly string[] = [
  "git push*",
  "git merge*",
  "git rebase*",
  "git reset --hard*",
  "git checkout main*",
  "git checkout master*",
  "git switch main*",
  "git switch master*",
  "git branch -D*",
  "git filter-branch*",
  "rm -rf /*",
  "rm -rf ~*",
  "sudo *",
  "shutdown*",
  "diskutil*",
  "mkfs*",
  ":(){*",
];

/**
 * Commands that always need a human even when a Module's allow list would
 * cover them: they move data off the machine, install code from the internet,
 * or hand out credentials. Execution-first stops at the network boundary.
 */
export const ALWAYS_APPROVE: readonly string[] = [
  "curl *",
  "wget *",
  "npm publish*",
  "pnpm publish*",
  "gh release*",
  "gh pr merge*",
  "security *",
  "defaults write*",
  "launchctl*",
  "crontab*",
];

/** Minimal glob → RegExp. Single `*` spans any run of characters within one
 * command segment; this is a command matcher, not a path matcher, so there is
 * no separator to respect. Kept local and tiny for the same zero-dependency
 * reason as builder-primitives.ts's own globToRegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Split a command line into the pieces a policy should judge separately, so
 * `pnpm test && git push` cannot smuggle a denied command past a matcher that
 * only looked at the head of the line.
 *
 * ponytail: naive split on && || ; | — a separator inside a quoted string
 * over-segments and can escalate a legitimate command to approval. That is the
 * safe direction to be wrong in (a false approval prompt, never a false
 * execution), so it stays until agents actually hit it; upgrade path is a real
 * POSIX shell-word parser.
 */
export function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function firstMatch(
  segments: readonly string[],
  patterns: readonly string[],
): string | null {
  for (const segment of segments) {
    for (const pattern of patterns) {
      if (globToRegExp(pattern).test(segment)) return pattern;
    }
  }
  return null;
}

/** Path containment: is `relativePath` inside the working directory once
 * normalized? Rejects absolute paths and any traversal that climbs out. Pure
 * string logic so it runs identically on every platform and in tests. */
export function pathEscapesWorkingDirectory(relativePath: string): boolean {
  if (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) return true;
  let depth = 0;
  for (const part of relativePath.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return true;
      continue;
    }
    depth += 1;
  }
  return false;
}

export interface PrimitivePolicyRequest {
  token: BuilderPrimitiveToken;
  /** Present for file:read / file:write / file:edit. */
  path?: string;
  /** Present for shell:execute. */
  command?: string;
}

/**
 * The gate. Decides execute / approve / refuse for one tool call against one
 * Module's policy.
 */
export function decideBuilderPrimitive(
  request: PrimitivePolicyRequest,
  policy: ModulePrimitivePolicy,
): PrimitivePolicyDecision {
  if (request.token === "shell:execute") {
    const command = request.command ?? "";
    if (command.trim().length === 0) {
      return { outcome: "refuse", reason: "empty command" };
    }
    const segments = commandSegments(command);

    const absolute = firstMatch(segments, ABSOLUTE_DENY);
    if (absolute) {
      return {
        outcome: "refuse",
        reason: `"${absolute}" is denied for every Module and cannot be approved — the agent works on a branch and the merge is yours`,
        matchedPattern: absolute,
      };
    }

    const moduleDenied = firstMatch(segments, policy.deny ?? []);
    if (moduleDenied) {
      return {
        outcome: "refuse",
        reason: `the Module's governance deny list matches "${moduleDenied}"`,
        matchedPattern: moduleDenied,
      };
    }

    const escalated = firstMatch(segments, ALWAYS_APPROVE);
    if (escalated) {
      return {
        outcome: "approve",
        reason: `"${escalated}" leaves this machine or changes system state — needs your approval even though the Module allows it`,
        matchedPattern: escalated,
      };
    }

    if (policy.allow && policy.allow.length > 0) {
      const unmatched = segments.find(
        (segment) => !policy.allow!.some((pattern) => globToRegExp(pattern).test(segment)),
      );
      if (unmatched !== undefined) {
        return {
          outcome: "approve",
          reason: `"${unmatched}" is outside the Module's allow list — approve it once to let it run`,
        };
      }
    }

    return { outcome: "execute", reason: "within the Module's declared command policy" };
  }

  const path = request.path ?? "";
  if (path.trim().length === 0) {
    return { outcome: "refuse", reason: "empty path" };
  }
  if (pathEscapesWorkingDirectory(path)) {
    return {
      outcome: "refuse",
      reason: `"${path}" escapes the Module's working directory`,
    };
  }
  if (request.token === "file:read") {
    return { outcome: "execute", reason: "read inside the Module's working directory" };
  }
  if (policy.writePaths && policy.writePaths.length > 0) {
    const permitted = policy.writePaths.some((pattern) => globToRegExp(pattern).test(path));
    if (!permitted) {
      return {
        outcome: "approve",
        reason: `"${path}" is outside the paths this Module declared writable — approve to let the change land`,
      };
    }
  }
  return { outcome: "execute", reason: "write inside the Module's declared paths" };
}
