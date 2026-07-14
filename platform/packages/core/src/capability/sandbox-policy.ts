/**
 * Sandbox requirement gate (PKG-1, roadmap Month-6 "package runtime hardening
 * ahead of executable logic"). Pure, zero-deps — mirrors risk.ts/lifecycle.ts
 * discipline (a plain function over plain data, no store, no I/O, no wall-clock).
 *
 * Two jobs, both keyed off `CapabilityManifest.execution` (types.ts):
 *
 *  1. ISOLATION FLOOR — "require sandboxing for any executable capability."
 *     An executable capability (one carrying an `execution` spec) can only
 *     reach Active when it declares a real sandbox: `isolation !== "none"`, and
 *     `container`/`vm` (not merely `process`) once its sandbox grants network or
 *     filesystem access. A declarative capability (no `execution`) is never
 *     gated here. This complements — never replaces — the SandboxProvider port
 *     (sandbox-provider.ts), which is the RUNTIME isolation boundary
 *     `shell:execute` routes through; this module is the pre-Active POLICY gate.
 *
 *  2. SANDBOX-CAP TRIFECTA — "extend the lethal-trifecta union check to gate
 *     sandbox caps (network/fs/env) before Active." An executable capability's
 *     GRANTED SANDBOX CAPS are mapped to lethal-trifecta legs so that a package
 *     (or a single capability) whose sandbox assembles private-read +
 *     untrusted-ingest + egress escalates to `external` exactly like the
 *     permission/connector-derived trifecta already does (package/risk.ts).
 *     A sandbox that grants network is BOTH an egress and an untrusted-ingest
 *     vector; filesystem or env passthrough is a private-data read vector.
 *
 * This module is READ-ONLY against ./types.ts — it builds ON TOP of
 * CapabilityManifest/CapabilityExecutionSpec, never redefines them.
 */
import type { CapabilityManifest, SandboxCapabilityRequest, SandboxIsolationLevel } from "./types.js";

/** The lethal-trifecta legs an executable capability's sandbox caps contribute.
 * A declarative capability (no execution spec) contributes none. */
export interface SandboxTrifectaLegs {
  /** Filesystem or env passthrough — a private-data read vector. */
  privateRead: boolean;
  /** Network — an untrusted external-content ingest vector. */
  untrustedIngest: boolean;
  /** Network — an egress vector. */
  egress: boolean;
}

const NO_LEGS: SandboxTrifectaLegs = { privateRead: false, untrustedIngest: false, egress: false };

/**
 * Map a capability's GRANTED SANDBOX CAPS to lethal-trifecta legs. Only an
 * executable capability (has `execution`) contributes anything; the mapping is:
 *   - network  -> egress AND untrustedIngest (it can both send and pull untrusted content)
 *   - filesystem (non-empty) -> privateRead (local files are private data)
 *   - env (non-empty)        -> privateRead (env vars routinely carry secrets)
 * package/risk.ts ORs these into its per-capability trifecta accounting, so the
 * SAME union check catches a trifecta assembled through sandbox grants — even
 * across separate capabilities — that individually-benign permissions would miss.
 */
export function sandboxTrifectaLegs(manifest: CapabilityManifest): SandboxTrifectaLegs {
  const exec = manifest.execution;
  if (!exec || exec.executable !== true) return NO_LEGS;
  const caps = exec.sandbox;
  return {
    privateRead: caps.filesystem.length > 0 || caps.env.length > 0,
    untrustedIngest: caps.network,
    egress: caps.network,
  };
}

export type SandboxGateDenialReason =
  /** executable capability declared `isolation: "none"` — never allowed. */
  | "executable_requires_isolation"
  /** executable capability whose sandbox grants network/filesystem but only
   * declares `process` isolation — network/fs need a container/VM boundary. */
  | "executable_caps_require_stronger_isolation";

export interface SandboxGateResult {
  /** True when the capability is executable (carries an `execution` spec). */
  requiresSandbox: boolean;
  /** True when the declared isolation SATISFIES the floor for its caps. A
   * declarative capability is trivially satisfied. When false, the capability
   * MUST NOT be allowed to reach Active (the install/approve path rejects it). */
  satisfied: boolean;
  reason?: SandboxGateDenialReason;
  /** The declared isolation ("none" for a declarative capability). */
  isolation: SandboxIsolationLevel;
  /** The sandbox caps under evaluation, echoed for the audit/why card. */
  gatedCaps: SandboxCapabilityRequest;
}

const NO_CAPS: SandboxCapabilityRequest = { network: false, filesystem: [], env: [] };

/** Isolation levels that actually contain network/filesystem access (ADR-027:
 * `process` isolation is not a boundary against network/fs; a real
 * container/microVM is required). */
function containsNetworkAndFs(isolation: SandboxIsolationLevel): boolean {
  return isolation === "container" || isolation === "vm";
}

/**
 * The pre-Active sandbox floor gate. Pure, sync, no I/O. Returns a typed result
 * (never throws) so the install/approve path can surface the specific `reason`
 * as an auditable denial, mirroring toolbelt.ts's ToolbeltScopeCheckResult
 * discipline of typed rejection over exceptions for expected-path denials.
 */
export function evaluateSandboxRequirement(manifest: CapabilityManifest): SandboxGateResult {
  const exec = manifest.execution;
  if (!exec || exec.executable !== true) {
    // Declarative capability — no code runs, nothing to sandbox.
    return { requiresSandbox: false, satisfied: true, isolation: "none", gatedCaps: NO_CAPS };
  }

  const caps = exec.sandbox;
  const base = { requiresSandbox: true as const, isolation: exec.isolation, gatedCaps: caps };

  if (exec.isolation === "none") {
    return { ...base, satisfied: false, reason: "executable_requires_isolation" };
  }

  const grantsNetworkOrFs = caps.network || caps.filesystem.length > 0;
  if (grantsNetworkOrFs && !containsNetworkAndFs(exec.isolation)) {
    return { ...base, satisfied: false, reason: "executable_caps_require_stronger_isolation" };
  }

  return { ...base, satisfied: true };
}
