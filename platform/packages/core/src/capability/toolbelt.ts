/**
 * Builder toolbelt - governed Read/Write/Edit/Bash-equivalent primitives
 * (execution-plan-2026-07.md Track F2 "Builder toolbelt"). Bridge has never
 * had these as first-class capabilities; this module is the FIRST version,
 * additive to (never a fork of) the existing Capability Trust Model (types.ts/
 * risk.ts/approvals.ts) and the Universal Action Pipeline (pipeline.ts)'s
 * propose/decide shape.
 *
 * Naming convention: resource tokens follow the "namespace:action" shape
 * already established by ResourceType/permission-declaration strings
 * elsewhere in this package (e.g. foreign-import.ts's
 * permissionDeclarations[].resourceType/.action, types.ts's
 * "external:send"/"external:fetch" special read targets) - this module
 * adds file:read / file:write / file:edit / shell:execute to that same
 * flat namespace, all against ResourceType's existing "file"/"tool" rows
 * (no new ResourceType needed).
 *
 * Risk classification per CLAUDE.md's Track F2 framing: file:read =
 * Operational-local (read of the local plane's own files - bounded, no
 * governed-resource write, but still gated because it can read anything on
 * the local machine within the granted scope); file:write/file:edit =
 * Operational (a real filesystem mutation); shell:execute = Operational +
 * sandbox mandatory (an arbitrary-code-execution surface - the highest-risk
 * primitive this module exposes, and the ONLY one requiring a SandboxProvider
 * to satisfy at all; see sandbox-provider.ts's ADR-027 doctrine).
 *
 * Execution model: this module does NOT invent a parallel commit/approval
 * flow. It exposes a pure classifyToolbeltRisk/checkGrantScope pair (the
 * risk + scope-check logic a Skill registered with the Universal Action
 * Pipeline would call from inside its run()), plus the ToolbeltGrant/
 * ToolbeltRequest/ToolbeltResult shapes a pipeline-registered skill uses to
 * talk to this module. The actual propose()/decide() lifecycle, ledger
 * append, and policy evaluation are the EXISTING UniversalActionPipeline
 * (pipeline.ts) - a toolbelt call is just another ActionRequest with
 * resourceType: "file" or "tool" and skill: "file.read" etc. This file
 * does not construct or drive a pipeline itself (that is app-wiring's job,
 * same as every other Skill), keeping @bridge/core's zero-runtime-dependency,
 * pure-logic discipline intact.
 */
import type { SandboxProvider, SandboxRunResult } from "./sandbox-provider.js";
import { UnsupportedSandboxRequestError } from "./sandbox-provider.js";
import type { RiskBand } from "./types.js";

/** The four governed toolbelt primitives this module defines. Flat
 * "namespace:action" strings, matching the convention already used by
 * permissionDeclarations[].resourceType/.action pairs in foreign-import.ts
 * and by "external:send"/"external:fetch" in types.ts's ResourceType. */
export type ToolbeltResourceToken = "file:read" | "file:write" | "file:edit" | "shell:execute";

/** Fixed risk classification per resource token - COMPUTED here as a pure
 * lookup (never self-declared by a caller), mirroring risk.ts's "risk axis is
 * COMPUTED from the manifest, never self-declared" discipline. shell:execute
 * is pinned to "operational" AND additionally flagged sandboxMandatory:
 * true - the pipeline-registered skill MUST route it through a
 * SandboxProvider with isolationTier "container"|"microvm"; it is never
 * satisfiable by InProcessJsSandboxProvider (see sandbox-provider.ts). */
export interface ToolbeltRiskClassification {
  riskBand: RiskBand;
  sandboxMandatory: boolean;
}

const TOOLBELT_RISK: Record<ToolbeltResourceToken, ToolbeltRiskClassification> = {
  "file:read": { riskBand: "operational", sandboxMandatory: false },
  "file:write": { riskBand: "operational", sandboxMandatory: false },
  "file:edit": { riskBand: "operational", sandboxMandatory: false },
  "shell:execute": { riskBand: "operational", sandboxMandatory: true },
};

/** Pure lookup - never recomputed from ad hoc caller input, so a caller can't
 * self-declare a lower risk band for a toolbelt primitive than this module
 * assigns it. */
export function classifyToolbeltRisk(token: ToolbeltResourceToken): ToolbeltRiskClassification {
  return TOOLBELT_RISK[token];
}

/**
 * A scoped grant authorizing one actor to invoke one toolbelt token within
 * workspace/path/pattern constraints - the toolbelt-specific narrowing this
 * module adds on top of the pipeline's general ActionRequest/authority
 * check (authority.ts's resolveAuthority still runs; this is an ADDITIONAL,
 * narrower scope check specific to filesystem/shell primitives, the same way
 * CredentialGrantRef narrows a connector grant beyond the general authority
 * check). pathPatterns are glob-shaped (e.g. "src/star-star/star.ts" using
 * standard glob wildcard syntax); a grant with an empty pathPatterns array
 * matches NOTHING (deny-by-default - mirrors authority.ts's deny-default
 * discipline), never "everything".
 */
export interface ToolbeltGrant {
  workspaceId: string;
  token: ToolbeltResourceToken;
  /** Glob-shaped path patterns this grant permits. Empty = matches nothing. */
  pathPatterns: string[];
  /** Optional command allow-list for shell:execute grants - when present,
   * only an exact command-name match (argv[0]) is permitted; when absent, any
   * command may be attempted (still subject to the sandbox boundary). */
  allowedCommands?: string[];
  expiresAtISO: string;
}

/** Reasons a scope check can fail - surfaced back to the pipeline/policy layer
 * as the "why" of a PolicyResult-shaped denial, not thrown as an opaque
 * Error, so a caller can log/audit the specific reason (mirrors
 * AuthorityDecision.reason's "human-readable basis" discipline). */
export type ToolbeltDenialReason =
  | "grant_expired"
  | "token_mismatch"
  | "workspace_mismatch"
  | "path_not_permitted"
  | "command_not_permitted"
  | "sandbox_required_but_missing"
  | "sandbox_isolation_insufficient";

export interface ToolbeltScopeCheckResult {
  allowed: boolean;
  reason?: ToolbeltDenialReason;
}

/** Minimal glob match - supports a single-star wildcard (any run of
 * non-separator chars) and a double-star wildcard (any run of chars
 * including separators). Deliberately small: this is a scope-narrowing
 * check, not a general-purpose glob library, and this package carries zero
 * runtime dependencies by design (see index.ts's header). */
function globToRegExp(pattern: string): RegExp {
  const DOUBLE_STAR = "**";
  const SINGLE_STAR = "*";
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split(DOUBLE_STAR)
    .join(" DOUBLESTAR ")
    .split(SINGLE_STAR)
    .join("[^/]*")
    .split(" DOUBLESTAR ")
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

function pathMatchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/**
 * Checks whether a grant permits a specific (workspace, path) pair for a
 * specific token, at a given instant - pure, sync, no I/O (mirrors risk.ts's
 * "deliberately pure/sync" discipline). This is the narrowing check a
 * pipeline-registered skill runs BEFORE calling out to the filesystem/sandbox;
 * it does not replace resolveAuthority, it composes with it.
 */
export function checkGrantScope(
  grant: ToolbeltGrant,
  args: { workspaceId: string; path: string; nowISO: string },
): ToolbeltScopeCheckResult {
  if (Date.parse(grant.expiresAtISO) <= Date.parse(args.nowISO)) {
    return { allowed: false, reason: "grant_expired" };
  }
  if (grant.workspaceId !== args.workspaceId) {
    return { allowed: false, reason: "workspace_mismatch" };
  }
  if (!pathMatchesAnyPattern(args.path, grant.pathPatterns)) {
    return { allowed: false, reason: "path_not_permitted" };
  }
  return { allowed: true };
}

/** Checks a shell:execute grant's command allow-list (when present). Absent
 * allowedCommands means no command-name restriction beyond the sandbox
 * boundary itself. */
export function checkCommandAllowed(grant: ToolbeltGrant, command: string): ToolbeltScopeCheckResult {
  if (!grant.allowedCommands || grant.allowedCommands.length === 0) return { allowed: true };
  return grant.allowedCommands.includes(command)
    ? { allowed: true }
    : { allowed: false, reason: "command_not_permitted" };
}

/** A toolbelt call's request shape - the inputs a pipeline-registered
 * file.read/file.write/file.edit/shell.execute Skill receives. */
export type ToolbeltRequest =
  | { token: "file:read"; workspaceId: string; path: string }
  | { token: "file:write"; workspaceId: string; path: string; content: string }
  | { token: "file:edit"; workspaceId: string; path: string; oldString: string; newString: string }
  | {
      token: "shell:execute";
      workspaceId: string;
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs: number;
    };

/** A toolbelt call's outcome - either a policy-shaped denial (never thrown -
 * mirrors Proposal's rejectionReason discipline of auditable, typed
 * rejection over exceptions for expected-path denials) or a success payload.
 * SandboxRunResult is reused verbatim for the shell:execute success case
 * rather than inventing a parallel result shape. */
export type ToolbeltResult =
  | { ok: false; reason: ToolbeltDenialReason }
  | { ok: true; token: "file:read"; content: string }
  | { ok: true; token: "file:write" | "file:edit" }
  | { ok: true; token: "shell:execute"; result: SandboxRunResult };

/**
 * Routes a shell:execute request through a SandboxProvider, enforcing
 * ADR-027's isolation-tier floor at the type AND runtime level: a provider
 * whose isolationTier is "in-process-js" is refused here BEFORE run() is
 * ever called (never relies solely on InProcessJsSandboxProvider.run()'s own
 * narrowed parameter type, since a caller could still hold it via the wider
 * SandboxProvider port type). This is the one place in the toolbelt where
 * shell:execute requests are dispatched to a sandbox; every other resource
 * token (file:read/write/edit) never touches a SandboxProvider at all.
 */
export async function runShellExecute(
  provider: SandboxProvider,
  req: Extract<ToolbeltRequest, { token: "shell:execute" }>,
): Promise<ToolbeltResult> {
  if (provider.isolationTier === "in-process-js") {
    return { ok: false, reason: "sandbox_isolation_insufficient" };
  }
  try {
    const result = await provider.run({
      kind: "shell",
      command: req.command,
      ...(req.args ? { args: req.args } : {}),
      ...(req.cwd ? { cwd: req.cwd } : {}),
      timeoutMs: req.timeoutMs,
    });
    return { ok: true, token: "shell:execute", result };
  } catch (err) {
    if (err instanceof UnsupportedSandboxRequestError) {
      return { ok: false, reason: "sandbox_isolation_insufficient" };
    }
    throw err;
  }
}
