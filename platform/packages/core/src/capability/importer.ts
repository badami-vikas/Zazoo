/**
 * Foreign-capability importer (docs/raw/execution-plan-2026-07.md Track F3,
 * ADR-027) — translates an upstream descriptor (a Pi module, an MCP server's
 * Action/resource list, an Activepieces piece, or a generic OSS Integration)
 * into a `ForeignCapabilityImport` (foreign-import.ts) whose
 * `translatedManifest` is a Bridge `CapabilityManifest` (types.ts). Pure
 * translation layer: it never calls out to a live MCP server, Activepieces
 * API, or Pi registry — callers hand in an already-fetched descriptor,
 * mirroring module/manifest.ts's "validated at the seam" discipline.
 *
 * Per-source-type mapping:
 *  - pi-module:          extension/skill/prompt -> Skill,
 *                         theme -> view.
 *  - mcp-server:          Actions -> connectors, resources -> read permissions;
 *                         capabilityType always "integration".
 *  - activepieces-piece:  actions/triggers -> one "integration" capability with a
 *                         connector per step. ALWAYS executable -> a real
 *                         sandboxPolicy is required.
 *  - oss-integration:     generic passthrough, capabilityType "integration",
 *                         zero connectors — permissions are NEVER inferred
 *                         from the descriptor, only from the caller-supplied
 *                         `permissionDeclarations`.
 *
 * Sandbox-required guard: any import whose translated capability can run
 * arbitrary upstream code (activepieces pieces always; pi-module extensions
 * when the descriptor marks them executable) MUST carry a sandboxPolicy with
 * `isolation !== "none"`, or `translateForeignCapability` returns a typed
 * `{ ok: false }` result instead of a manifest — never silently allows
 * unsandboxed execution.
 */
import type { CapabilityConnector, CapabilityManifest, CapabilityPermission, CapabilityType } from "./types.js";
import type { ForeignCapabilityImport, ForeignCapabilitySource } from "./foreign-import.js";
import { mcpActionDescriptors } from "./mcp-adapter.js";

/** A foreign import is by definition not built_in/template/ai_generated/
 * user_code — always "community" (capability/types.ts CapabilityOrigin). */
const FOREIGN_IMPORT_ORIGIN = "community" as const;

export class ForeignImportSandboxRequiredError extends Error {
  constructor(source: string, sourceRef: string) {
    super(
      `foreign import "${sourceRef}" (source=${source}) is executable and requires an explicit sandboxPolicy ` +
        `(isolation !== "none") before it can be translated into a capability manifest — refusing to allow unsandboxed execution`,
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

/** Raw pre-translation input — everything `foreign-import.ts`'s
 * `ForeignCapabilityImport` needs EXCEPT `translatedManifest`, which this
 * module computes, plus the raw upstream descriptor the source-specific
 * translator reads. */
export interface ForeignCapabilityDescriptorInput
  extends Omit<ForeignCapabilityImport, "translatedManifest" | "translatedModule"> {
  /** The raw, source-native descriptor (already fetched by the caller —
   * see module header). Opaque here; each translator narrows it. */
  descriptor: unknown;
}

export type ForeignImportResult =
  | { ok: true; import: ForeignCapabilityImport }
  | { ok: false; error: ForeignImportSandboxRequiredError };

const SOURCES_ALWAYS_EXECUTABLE = new Set<ForeignCapabilitySource>(["activepieces-piece"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function translatePermission(decl: ForeignCapabilityImport["permissionDeclarations"][number]): CapabilityPermission {
  const action = decl.action === "read" || decl.action === "write" || decl.action === "send" ? decl.action : "read";
  return {
    resourceType: decl.resourceType,
    action,
    // conservative fallback when the upstream artifact doesn't say exactly
    // what it touches — "all", never silently narrowed to "private".
    dataScope: decl.scope === "private" || decl.scope === "public" ? decl.scope : "all",
    egress: action === "send",
  };
}

function requiresSandbox(input: ForeignCapabilityDescriptorInput): boolean {
  if (SOURCES_ALWAYS_EXECUTABLE.has(input.source)) return true;
  if (input.source === "pi-module") {
    const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
    // Pi extensions execute code; skills/prompts/themes are declarative
    // assets and do not require sandboxing.
    return descriptor.primitive === "extension";
  }
  if (input.source === "mcp-server") {
    // PKG-1: the MCP "exempt from sandbox by protocol" carve-out is REMOVED.
    // A local (stdio-transport) MCP server IS arbitrary local code execution,
    // and even a remote one is community/untrusted origin whose Actions we
    // must not auto-trust at a higher tier than user_code — the transport
    // boundary is NOT a security boundary. Treat every mcp-server import as
    // executable so it must carry a real sandboxPolicy (isolation !== "none")
    // exactly like an activepieces piece or an executable pi extension.
    return true;
  }
  // oss-integration is a manual-permission passthrough with no code execution
  // implied by this layer alone.
  return false;
}

function capabilityTypeFor(input: ForeignCapabilityDescriptorInput): CapabilityType {
  const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
  switch (input.source) {
    case "pi-module": {
      const primitive = descriptor.primitive;
      if (primitive === "extension") return "skill";
      if (primitive === "theme") return "view";
      return "skill"; // skill | prompt
    }
    case "mcp-server":
      return "integration";
    case "activepieces-piece":
      return "integration";
    case "oss-integration":
      return "integration";
  }
}

function connectorsFor(input: ForeignCapabilityDescriptorInput): CapabilityConnector[] {
  const descriptor = isPlainObject(input.descriptor) ? input.descriptor : {};
  if (input.source === "mcp-server") {
    const actions = mcpActionDescriptors(descriptor);
    return actions.map((action) => ({
      id: String((isPlainObject(action) ? action.name : undefined) ?? action),
    }));
  }
  if (input.source === "activepieces-piece") {
    const actions = Array.isArray(descriptor.actions) ? descriptor.actions : [];
    const triggers = Array.isArray(descriptor.triggers) ? descriptor.triggers : [];
    return [...actions, ...triggers].map((s) => ({
      id: String((isPlainObject(s) ? s.name : undefined) ?? s),
      externalSend: true,
    }));
  }
  if (input.source === "pi-module" && descriptor.primitive === "extension") {
    return [{ id: input.sourceRef }];
  }
  // oss-integration: zero connectors — permissions come only from the
  // caller-supplied permissionDeclarations, never inferred from descriptor.
  return [];
}

/**
 * Translate one foreign-capability descriptor into a full
 * `ForeignCapabilityImport`, computing `translatedManifest`. Returns a typed
 * `{ ok: false }` result (never throws) when the import is executable and
 * lacks a real sandbox policy; throws `ForeignImportValidationError` for
 * other malformed input (missing sourceRef/versionPin), matching
 * module/manifest.ts's "loud validation error, never silent default"
 * convention.
 */
export function translateForeignCapability(input: ForeignCapabilityDescriptorInput): ForeignImportResult {
  if (!input.sourceRef) throw new ForeignImportValidationError("sourceRef is required");
  if (!input.versionPin) throw new ForeignImportValidationError("versionPin is required");
  if (input.auditRequired !== true) throw new ForeignImportValidationError("auditRequired must be true");

  if (requiresSandbox(input) && input.sandboxPolicy.isolation === "none") {
    return { ok: false, error: new ForeignImportSandboxRequiredError(input.source, input.sourceRef) };
  }

  const manifest: CapabilityManifest & { origin: "community" } = {
    id: input.sourceRef,
    name: input.sourceRef,
    version: input.versionPin,
    capabilityType: capabilityTypeFor(input),
    origin: FOREIGN_IMPORT_ORIGIN,
    audience: "private",
    permissions: input.permissionDeclarations.map(translatePermission),
    connectors: connectorsFor(input),
    dependencies: [],
  };

  return {
    ok: true,
    import: {
      ...input,
      translatedManifest: manifest,
    },
  };
}
