/**
 * Foreign-capability importer (docs/raw/execution-plan-2026-07.md Track F3) —
 * translates a `ForeignCapabilityImport` (foreign-import.ts) into a Bridge
 * `CapabilityManifest` (types.ts), the same trust-model unit risk.ts/
 * lifecycle.ts/approvals.ts already operate on. This is a pure translation
 * layer: it never calls out to a live MCP server, Activepieces API, or Pi
 * registry — callers hand in an already-fetched descriptor (mirroring
 * package/manifest.ts's "validated at the seam" discipline).
 *
 * Per-source-type mapping:
 *  - pi-package:          extension -> tool/connector, skill -> skill,
 *                         prompt -> skill (prompt asset), theme -> view.
 *  - mcp-server:          MCP tool/resource declarations -> tool capability
 *                         shape (tools become connectors, resources become
 *                         read permissions).
 *  - activepieces-piece:  actions/triggers -> skill capability shape;
 *                         ALWAYS executable -> sandboxPolicy required.
 *  - oss-integration:     generic passthrough — permissions are NEVER
 *                         auto-inferred from the descriptor, only from
 *                         `permissionDeclarations` the caller explicitly
 *                         supplied.
 *
 * Sandbox-required guard: any import whose translated capabilityType is
 * executable in a way that can run arbitrary upstream code (activepieces
 * pieces always; pi-package extensions when the descriptor marks them
 * executable) MUST carry a `sandboxPolicy` other than `{kind: "none"}` on the
 * input, or `translateForeignCapability` returns a typed
 * `ForeignImportSandboxRequiredError` result instead of throwing — the
 * pipeline can inspect `.ok` before touching the manifest, matching this
 * module's other translators' "loud validation error, never silent default"
 * convention (package/manifest.ts).
 */
import type { CapabilityConnector, CapabilityManifest, CapabilityPermission, CapabilityType } from "./types.js";
import { FOREIGN_IMPORT_ORIGIN, type ForeignCapabilityImport, type ForeignPermissionDeclaration } from "./foreign-import.js";

export class ForeignImportSandboxRequiredError extends Error {
  constructor(source: string, targetId: string) {
    super(
      `foreign import "${targetId}" (source=${source}) is executable and requires an explicit sandboxPolicy ` +
        `(kind !== "none") before it can be translated into a capability manifest — refusing to allow unsandboxed execution`,
    );
    this.name = "ForeignImportSandboxRequiredError";
  }
}

export class ForeignImportValidationError extends Error {
  constructor(reason: string) {
    super(`foreign capability import invalid: ${reason}`);
    this.name = "ForeignImportValidationError";
  }
}

/** Result union so callers can branch on `.ok` instead of relying on
 * try/catch for the sandbox guard specifically (still throws for other
 * malformed-input cases, matching parsePackageManifest's convention). */
export type ForeignImportResult =
  | { ok: true; manifest: CapabilityManifest }
  | { ok: false; error: ForeignImportSandboxRequiredError };

const SOURCES_ALWAYS_EXECUTABLE = new Set<ForeignCapabilityImport["source"]>(["activepieces-piece"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Translate one upstream permission declaration into a Bridge
 * `CapabilityPermission` — conservative dataScope fallback when the upstream
 * artifact can't tell us exactly what it touches (`scoped: false` -> "all",
 * never silently narrowed to "private"). */
function translatePermission(decl: ForeignPermissionDeclaration): CapabilityPermission {
  return {
    resourceType: decl.resource,
    action: decl.action,
    dataScope: decl.scoped ? "private" : "all",
    egress: decl.action === "send",
  };
}

function translatePermissions(input: ForeignCapabilityImport): CapabilityPermission[] {
  return input.permissionDeclarations.map(translatePermission);
}

/** Determines whether this import, given its source type and descriptor,
 * is executable (can run arbitrary upstream code) and therefore requires a
 * real sandbox policy. */
function requiresSandbox(input: ForeignCapabilityImport): boolean {
  if (SOURCES_ALWAYS_EXECUTABLE.has(input.source)) return true;
  if (input.source === "pi-package") {
    const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
    const primitive = descriptor.primitive;
    // Pi extensions execute code; skills/prompts/themes are declarative
    // assets and do not require sandboxing.
    return primitive === "extension";
  }
  // mcp-server tool calls run inside the (already-sandboxed-by-protocol) MCP
  // transport, and oss-integration is a manual-permission passthrough with
  // no code execution implied by this layer alone.
  return false;
}

function hasRealSandboxPolicy(input: ForeignCapabilityImport): boolean {
  return input.sandboxPolicy !== undefined && input.sandboxPolicy.kind !== "none";
}

/** pi-package: map extension->tool, skill->skill, prompt->skill (prompt
 * asset), theme->view (per the Pi primitive mapping, execution-plan-2026-07's
 * Pi-primitive-mapping section). Connectors carry the extension's ability to
 * reach external systems; skill/prompt/theme imports carry no connectors of
 * their own beyond what permissionDeclarations already encodes. */
function translatePiPackage(input: ForeignCapabilityImport): { capabilityType: CapabilityType; connectors: CapabilityConnector[] } {
  const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
  const primitive = typeof descriptor.primitive === "string" ? descriptor.primitive : "extension";

  switch (primitive) {
    case "extension": {
      const externalSend = input.permissionDeclarations.some((p) => p.action === "send");
      return {
        capabilityType: "tool",
        connectors: [{ id: `${input.targetId}.connector`, externalSend }],
      };
    }
    case "skill":
      return { capabilityType: "skill", connectors: [] };
    case "prompt":
      // A prompt asset is a declarative skill-shaped capability (no
      // execution surface of its own).
      return { capabilityType: "skill", connectors: [] };
    case "theme":
      return { capabilityType: "view", connectors: [] };
    default:
      throw new ForeignImportValidationError(
        `pi-package descriptor.primitive must be one of extension|skill|prompt|theme, got ${JSON.stringify(primitive)}`,
      );
  }
}

/** mcp-server: MCP tool declarations become connectors (a tool call can, by
 * MCP design, reach out to whatever backend the server proxies); MCP resource
 * declarations become read permissions layered on top of whatever the caller
 * already supplied via permissionDeclarations. capabilityType is always
 * "tool" — an MCP server IS a tool/connector surface in Bridge's model. */
function translateMcpServer(input: ForeignCapabilityImport): { capabilityType: CapabilityType; connectors: CapabilityConnector[]; extraPermissions: CapabilityPermission[] } {
  const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
  const toolsRaw = Array.isArray(descriptor.tools) ? descriptor.tools : [];
  const resourcesRaw = Array.isArray(descriptor.resources) ? descriptor.resources : [];

  const connectors: CapabilityConnector[] = toolsRaw.map((t, i) => {
    const name = isPlainObject(t) && typeof t.name === "string" ? t.name : `tool-${i}`;
    return { id: `${input.targetId}.${name}`, externalSend: true };
  });

  const extraPermissions: CapabilityPermission[] = resourcesRaw.map((r) => {
    const uri = isPlainObject(r) && typeof r.uri === "string" ? r.uri : "mcp-resource";
    return { resourceType: uri, action: "read", dataScope: "all", egress: false };
  });

  return { capabilityType: "tool", connectors, extraPermissions };
}

/** activepieces-piece: actions/triggers map to a single "skill" capability
 * (an orchestrated sequence of steps, Bridge's skill shape) that composes
 * connectors for each action/trigger's side-effecting reach. Always
 * executable, so the sandbox guard in translateForeignCapability always
 * applies for this source. */
function translateActivepiecesPiece(input: ForeignCapabilityImport): { capabilityType: CapabilityType; connectors: CapabilityConnector[] } {
  const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
  const actionsRaw = Array.isArray(descriptor.actions) ? descriptor.actions : [];
  const triggersRaw = Array.isArray(descriptor.triggers) ? descriptor.triggers : [];

  const connectors: CapabilityConnector[] = [...actionsRaw, ...triggersRaw].map((step, i) => {
    const name = isPlainObject(step) && typeof step.name === "string" ? step.name : `step-${i}`;
    return { id: `${input.targetId}.${name}`, externalSend: true };
  });

  return { capabilityType: "skill", connectors };
}

/** oss-integration: generic passthrough. NO auto-inference from the
 * descriptor — the only permissions that end up on the manifest are the ones
 * the caller explicitly declared via `permissionDeclarations`. capabilityType
 * defaults to "integration" (the catch-all shape for a hand-wired external
 * system with no more specific Bridge-native mapping). */
function translateOssIntegration(): { capabilityType: CapabilityType; connectors: CapabilityConnector[] } {
  return { capabilityType: "integration", connectors: [] };
}

function assertValidEnvelope(input: ForeignCapabilityImport): void {
  if (!input.targetId || input.targetId.length === 0) {
    throw new ForeignImportValidationError("targetId must be a non-empty string");
  }
  if (!input.targetName || input.targetName.length === 0) {
    throw new ForeignImportValidationError("targetName must be a non-empty string");
  }
  if (!input.versionPin || !input.versionPin.ref || !input.versionPin.version) {
    throw new ForeignImportValidationError("versionPin.ref and versionPin.version are required");
  }
  if (!Array.isArray(input.permissionDeclarations)) {
    throw new ForeignImportValidationError("permissionDeclarations must be an array");
  }
  if (input.auditRequired !== true) {
    throw new ForeignImportValidationError("auditRequired must be true — every foreign import requires an audit trail");
  }
}

/**
 * Translate a `ForeignCapabilityImport` into a Bridge `CapabilityManifest`.
 * Origin is always forced to "community" (Capability Trust Model origin
 * axis) regardless of source type. Returns a typed error result rather than
 * throwing when an executable import lacks a real sandbox policy — every
 * other malformed-input case still throws (matching parsePackageManifest's
 * "loud validation error" convention for genuinely malformed input, as
 * opposed to this one well-known/expected governance gate).
 */
export function translateForeignCapability(input: ForeignCapabilityImport): ForeignImportResult {
  assertValidEnvelope(input);

  let capabilityType: CapabilityType;
  let connectors: CapabilityConnector[];
  let extraPermissions: CapabilityPermission[] = [];

  switch (input.source) {
    case "pi-package": {
      const r = translatePiPackage(input);
      capabilityType = r.capabilityType;
      connectors = r.connectors;
      break;
    }
    case "mcp-server": {
      const r = translateMcpServer(input);
      capabilityType = r.capabilityType;
      connectors = r.connectors;
      extraPermissions = r.extraPermissions;
      break;
    }
    case "activepieces-piece": {
      const r = translateActivepiecesPiece(input);
      capabilityType = r.capabilityType;
      connectors = r.connectors;
      break;
    }
    case "oss-integration": {
      const r = translateOssIntegration();
      capabilityType = r.capabilityType;
      connectors = r.connectors;
      break;
    }
    default: {
      const exhaustive: never = input.source;
      throw new ForeignImportValidationError(`unknown source type: ${JSON.stringify(exhaustive)}`);
    }
  }

  // Sandbox-required guard: never silently allow unsandboxed execution.
  if (requiresSandbox(input) && !hasRealSandboxPolicy(input)) {
    return { ok: false, error: new ForeignImportSandboxRequiredError(input.source, input.targetId) };
  }

  const manifest: CapabilityManifest = {
    id: input.targetId,
    name: input.targetName,
    version: input.versionPin.version,
    capabilityType,
    origin: FOREIGN_IMPORT_ORIGIN,
    audience: "private",
    permissions: [...translatePermissions(input), ...extraPermissions],
    connectors,
    dependencies: [],
  };

  return { ok: true, manifest };
}
