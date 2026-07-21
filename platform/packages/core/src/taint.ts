export const TAINT_LABEL_VERSION = 1 as const;
export const MAX_TAINT_ORIGINS = 16;

export const TAINT_TRUST = [
  "verified_system",
  "authenticated_human",
  "verified_signed",
  "untrusted",
  "unknown",
] as const;
export type TaintTrust = (typeof TAINT_TRUST)[number];

export const TAINT_SOURCES = [
  "operator",
  "human",
  "system",
  "signed_import",
  "screen",
  "clipboard",
  "sensor",
  "email",
  "google",
  "web",
  "mcp",
  "file_import",
  "memory",
  "cache",
  "queue",
  "mixed",
  "unknown",
] as const;
export type TaintSource = (typeof TAINT_SOURCES)[number];

export const TAINT_SENSITIVITY = [
  "public",
  "organization",
  "private",
  "restricted",
  "unknown",
] as const;
export type TaintSensitivity = (typeof TAINT_SENSITIVITY)[number];

export const TAINT_INSTRUCTION_RISK = [
  "none",
  "data",
  "instruction_like",
  "unknown",
] as const;
export type TaintInstructionRisk = (typeof TAINT_INSTRUCTION_RISK)[number];

export interface TaintOrigin {
  source: TaintSource;
  ref: string;
  hash: string;
  transform: string;
}

export interface TaintLabel {
  version: typeof TAINT_LABEL_VERSION;
  trust: TaintTrust;
  source: TaintSource;
  sensitivity: TaintSensitivity;
  instructionRisk: TaintInstructionRisk;
  originChain: readonly TaintOrigin[];
  originsTruncated: boolean;
  provenanceHash: string;
}

type LabelSeed = Omit<TaintLabel, "version" | "provenanceHash">;

const TRUST_RANK: Readonly<Record<TaintTrust, number>> = {
  verified_system: 0,
  authenticated_human: 1,
  verified_signed: 1,
  untrusted: 2,
  unknown: 3,
};
const SENSITIVITY_RANK: Readonly<Record<TaintSensitivity, number>> = {
  public: 0,
  organization: 1,
  private: 2,
  restricted: 3,
  unknown: 4,
};
const INSTRUCTION_RISK_RANK: Readonly<Record<TaintInstructionRisk, number>> = {
  none: 0,
  data: 1,
  instruction_like: 2,
  unknown: 3,
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashTaintValue(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  lengthView.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const w = new Uint32Array(64);
  const rotateRight = (word: number, bits: number): number =>
    (word >>> bits) | (word << (32 - bits));

  for (let offset = 0; offset < padded.length; offset += 64) {
    const view = new DataView(padded.buffer, offset, 64);
    for (let index = 0; index < 16; index++) {
      w[index] = view.getUint32(index * 4);
    }
    for (let index = 16; index < 64; index++) {
      const s0 =
        rotateRight(w[index - 15]!, 7) ^
        rotateRight(w[index - 15]!, 18) ^
        (w[index - 15]! >>> 3);
      const s1 =
        rotateRight(w[index - 2]!, 17) ^
        rotateRight(w[index - 2]!, 19) ^
        (w[index - 2]! >>> 10);
      w[index] =
        (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let index = 0; index < 64; index++) {
      const sum1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + sum1 + choice + k[index]! + w[index]!) >>> 0;
      const sum0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return `sha256:${[...h]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")}`;
}

function originKey(origin: TaintOrigin): string {
  return canonicalJson(origin);
}

function normalizeOrigins(origins: readonly TaintOrigin[]): {
  originChain: readonly TaintOrigin[];
  truncated: boolean;
} {
  const byKey = new Map<string, TaintOrigin>();
  for (const origin of origins) {
    if (
      !TAINT_SOURCES.includes(origin.source) ||
      !origin.ref.trim() ||
      !origin.hash.trim() ||
      !origin.transform.trim()
    ) {
      throw new Error("taint label: invalid origin");
    }
    byKey.set(originKey(origin), Object.freeze({ ...origin }));
  }
  const ordered = [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, origin]) => origin);
  return {
    originChain: Object.freeze(ordered.slice(0, MAX_TAINT_ORIGINS)),
    truncated: ordered.length > MAX_TAINT_ORIGINS,
  };
}

function finalizeLabel(seed: LabelSeed): TaintLabel {
  const normalized = normalizeOrigins(seed.originChain);
  const base = {
    version: TAINT_LABEL_VERSION,
    trust: seed.trust,
    source: seed.source,
    sensitivity: seed.sensitivity,
    instructionRisk: seed.instructionRisk,
    originChain: normalized.originChain,
    originsTruncated: seed.originsTruncated || normalized.truncated,
  } as const;
  return Object.freeze({
    ...base,
    provenanceHash: hashTaintValue(base),
  });
}

export function createTaintLabel(seed: {
  trust: TaintTrust;
  source: TaintSource;
  sensitivity: TaintSensitivity;
  instructionRisk: TaintInstructionRisk;
  origin: TaintOrigin;
}): TaintLabel {
  return finalizeLabel({
    trust: seed.trust,
    source: seed.source,
    sensitivity: seed.sensitivity,
    instructionRisk: seed.instructionRisk,
    originChain: [seed.origin],
    originsTruncated: false,
  });
}

export const UNKNOWN_LABEL: TaintLabel = createTaintLabel({
  trust: "unknown",
  source: "unknown",
  sensitivity: "unknown",
  instructionRisk: "unknown",
  origin: {
    source: "unknown",
    ref: "legacy-or-malformed",
    hash: hashTaintValue("unknown"),
    transform: "fail_closed",
  },
});

function maxAxis<T extends string>(
  left: T,
  right: T,
  rank: Readonly<Record<T, number>>,
): T {
  return rank[left] >= rank[right] ? left : right;
}

function joinSource(left: TaintSource, right: TaintSource): TaintSource {
  if (left === right) return left;
  if (left === "unknown" || right === "unknown") return "unknown";
  return "mixed";
}

export function joinTaintLabels(...labels: readonly TaintLabel[]): TaintLabel {
  if (labels.length === 0) return UNKNOWN_LABEL;
  let trust = labels[0]!.trust;
  let source = labels[0]!.source;
  let sensitivity = labels[0]!.sensitivity;
  let instructionRisk = labels[0]!.instructionRisk;
  let originsTruncated = labels[0]!.originsTruncated;
  const origins: TaintOrigin[] = [...labels[0]!.originChain];
  for (let index = 1; index < labels.length; index++) {
    const label = labels[index]!;
    trust = maxAxis(trust, label.trust, TRUST_RANK);
    source = joinSource(source, label.source);
    sensitivity = maxAxis(sensitivity, label.sensitivity, SENSITIVITY_RANK);
    instructionRisk = maxAxis(
      instructionRisk,
      label.instructionRisk,
      INSTRUCTION_RISK_RANK,
    );
    originsTruncated ||= label.originsTruncated;
    origins.push(...label.originChain);
  }
  return finalizeLabel({
    trust,
    source,
    sensitivity,
    instructionRisk,
    originChain: origins,
    originsTruncated,
  });
}

export function taintFlowsTo(left: TaintLabel, right: TaintLabel): boolean {
  const sourceFlows =
    left.source === right.source ||
    right.source === "mixed" ||
    right.source === "unknown";
  return (
    TRUST_RANK[left.trust] <= TRUST_RANK[right.trust] &&
    sourceFlows &&
    SENSITIVITY_RANK[left.sensitivity] <= SENSITIVITY_RANK[right.sensitivity] &&
    INSTRUCTION_RISK_RANK[left.instructionRisk] <=
      INSTRUCTION_RISK_RANK[right.instructionRisk]
  );
}

export function serializeTaintLabel(label: TaintLabel): string {
  assertTaintLabel(label);
  return canonicalJson(label);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function parseOrigin(value: unknown): TaintOrigin {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ["source", "ref", "hash", "transform"]) ||
    typeof value["source"] !== "string" ||
    !TAINT_SOURCES.includes(value["source"] as TaintSource) ||
    typeof value["ref"] !== "string" ||
    typeof value["hash"] !== "string" ||
    typeof value["transform"] !== "string"
  ) {
    throw new Error("taint label: malformed origin");
  }
  return {
    source: value["source"] as TaintSource,
    ref: value["ref"],
    hash: value["hash"],
    transform: value["transform"],
  };
}

export function parseTaintLabel(value: unknown): TaintLabel {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !isPlainRecord(parsed) ||
    !exactKeys(parsed, [
      "version",
      "trust",
      "source",
      "sensitivity",
      "instructionRisk",
      "originChain",
      "originsTruncated",
      "provenanceHash",
    ]) ||
    parsed["version"] !== TAINT_LABEL_VERSION ||
    typeof parsed["trust"] !== "string" ||
    !TAINT_TRUST.includes(parsed["trust"] as TaintTrust) ||
    typeof parsed["source"] !== "string" ||
    !TAINT_SOURCES.includes(parsed["source"] as TaintSource) ||
    typeof parsed["sensitivity"] !== "string" ||
    !TAINT_SENSITIVITY.includes(parsed["sensitivity"] as TaintSensitivity) ||
    typeof parsed["instructionRisk"] !== "string" ||
    !TAINT_INSTRUCTION_RISK.includes(
      parsed["instructionRisk"] as TaintInstructionRisk,
    ) ||
    !Array.isArray(parsed["originChain"]) ||
    parsed["originChain"].length > MAX_TAINT_ORIGINS ||
    typeof parsed["originsTruncated"] !== "boolean" ||
    typeof parsed["provenanceHash"] !== "string"
  ) {
    throw new Error("taint label: malformed or unsupported serialization");
  }
  const label = finalizeLabel({
    trust: parsed["trust"] as TaintTrust,
    source: parsed["source"] as TaintSource,
    sensitivity: parsed["sensitivity"] as TaintSensitivity,
    instructionRisk: parsed["instructionRisk"] as TaintInstructionRisk,
    originChain: parsed["originChain"].map(parseOrigin),
    originsTruncated: parsed["originsTruncated"],
  });
  if (label.provenanceHash !== parsed["provenanceHash"]) {
    throw new Error("taint label: provenance hash mismatch");
  }
  return label;
}

export function assertTaintLabel(label: TaintLabel): void {
  parseTaintLabel(label);
}

export function storedTaintLabelOrUnknown(value: unknown): {
  label: TaintLabel;
  quarantined: boolean;
} {
  try {
    return { label: parseTaintLabel(value), quarantined: false };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("taint label:")) {
      throw error;
    }
    return { label: UNKNOWN_LABEL, quarantined: true };
  }
}

export type LegacyTrustOrigin =
  | "operator"
  | "user_content"
  | "untrusted_external";

export function labelFromLegacyTrustOrigin(
  legacy: LegacyTrustOrigin | null | undefined,
  ref: string,
): TaintLabel {
  if (!legacy) return UNKNOWN_LABEL;
  const mapping: Record<
    LegacyTrustOrigin,
    Pick<TaintLabel, "trust" | "source" | "sensitivity" | "instructionRisk">
  > = {
    operator: {
      trust: "verified_system",
      source: "operator",
      sensitivity: "organization",
      instructionRisk: "none",
    },
    user_content: {
      trust: "authenticated_human",
      source: "human",
      sensitivity: "organization",
      instructionRisk: "instruction_like",
    },
    untrusted_external: {
      trust: "untrusted",
      source: "unknown",
      sensitivity: "unknown",
      instructionRisk: "unknown",
    },
  };
  return createTaintLabel({
    ...mapping[legacy],
    origin: {
      source: mapping[legacy].source,
      ref,
      hash: hashTaintValue({ legacy, ref }),
      transform: "legacy_v0_compatibility",
    },
  });
}

export function legacyTrustOriginFromLabel(
  label: TaintLabel,
): LegacyTrustOrigin {
  if (label.trust === "verified_system" || label.trust === "verified_signed") {
    return "operator";
  }
  if (label.trust === "authenticated_human") return "user_content";
  return "untrusted_external";
}

export interface RuntimeProvenance {
  valueHash: string;
  derivedFrom: readonly string[];
  transformation: string;
}

declare const runtimeValueBrand: unique symbol;
export interface RuntimeValue<T> {
  readonly [runtimeValueBrand]: true;
  readonly label: TaintLabel;
  readonly provenance: RuntimeProvenance;
}

const runtimePayloads = new WeakMap<object, unknown>();

export function createRuntimeValue<T>(
  value: T,
  label: TaintLabel,
  provenance: Omit<RuntimeProvenance, "valueHash"> & { valueHash?: string },
): RuntimeValue<T> {
  assertTaintLabel(label);
  const envelope = Object.freeze({
    label,
    provenance: Object.freeze({
      valueHash: provenance.valueHash ?? hashTaintValue(value),
      derivedFrom: Object.freeze([...provenance.derivedFrom].sort()),
      transformation: provenance.transformation,
    }),
  }) as RuntimeValue<T>;
  runtimePayloads.set(envelope, value);
  return envelope;
}

export function mapRuntimeValue<T, U>(
  input: RuntimeValue<T>,
  transform: (value: T) => U,
  transformation: string,
  additionalLabels: readonly TaintLabel[] = [],
): RuntimeValue<U> {
  const value = runtimePayloads.get(input as object);
  if (!runtimePayloads.has(input as object)) {
    throw new Error("runtime value: invalid or deserialized envelope");
  }
  return createRuntimeValue(transform(value as T), joinTaintLabels(input.label, ...additionalLabels), {
    derivedFrom: [input.provenance.valueHash],
    transformation,
  });
}

export const TAINT_SOURCE_IDS = [
  "operator_input",
  "human_input",
  "system_generated",
  "signed_commons_import",
  "screen_capture",
  "clipboard_capture",
  "sensor_capture",
  "email_google_intake",
  "web_search",
  "mcp_result",
  "file_import",
] as const;
export type TaintSourceId = (typeof TAINT_SOURCE_IDS)[number];

export const TAINT_SINK_IDS = [
  "network_egress",
  "external_send",
  "file_write",
  "credential_access",
  "schema_mutation",
  "skill_execution",
  "model_capability_context",
  "cache_storage",
  "queue_storage",
] as const;
export type TaintSinkId = (typeof TAINT_SINK_IDS)[number];

export const TAINT_SOURCE_REGISTRY: Readonly<
  Record<TaintSourceId, { source: TaintSource; defaultTrust: TaintTrust }>
> = Object.freeze({
  operator_input: { source: "operator", defaultTrust: "verified_system" },
  human_input: { source: "human", defaultTrust: "authenticated_human" },
  system_generated: { source: "system", defaultTrust: "verified_system" },
  signed_commons_import: { source: "signed_import", defaultTrust: "verified_signed" },
  screen_capture: { source: "screen", defaultTrust: "untrusted" },
  clipboard_capture: { source: "clipboard", defaultTrust: "untrusted" },
  sensor_capture: { source: "sensor", defaultTrust: "untrusted" },
  email_google_intake: { source: "google", defaultTrust: "untrusted" },
  web_search: { source: "web", defaultTrust: "untrusted" },
  mcp_result: { source: "mcp", defaultTrust: "untrusted" },
  file_import: { source: "file_import", defaultTrust: "untrusted" },
});

export const TAINT_SINK_REGISTRY: Readonly<
  Record<TaintSinkId, { authorityBearing: boolean; egress: boolean }>
> = Object.freeze({
  network_egress: { authorityBearing: true, egress: true },
  external_send: { authorityBearing: true, egress: true },
  file_write: { authorityBearing: true, egress: false },
  credential_access: { authorityBearing: true, egress: false },
  schema_mutation: { authorityBearing: true, egress: false },
  skill_execution: { authorityBearing: true, egress: false },
  model_capability_context: { authorityBearing: true, egress: false },
  cache_storage: { authorityBearing: false, egress: false },
  queue_storage: { authorityBearing: false, egress: false },
});

export function assertTaintInventory(): void {
  for (const id of TAINT_SOURCE_IDS) {
    if (!TAINT_SOURCE_REGISTRY[id]) throw new Error(`unclassified taint source: ${id}`);
  }
  for (const id of TAINT_SINK_IDS) {
    if (!TAINT_SINK_REGISTRY[id]) throw new Error(`unclassified taint sink: ${id}`);
  }
}

export function labelAtSource(
  sourceId: TaintSourceId,
  args: {
    ref: string;
    valueHash: string;
    sensitivity: TaintSensitivity;
    instructionRisk: TaintInstructionRisk;
  },
): TaintLabel {
  const classification = TAINT_SOURCE_REGISTRY[sourceId];
  if (!classification) throw new Error(`unclassified taint source: ${sourceId}`);
  return createTaintLabel({
    trust: classification.defaultTrust,
    source: classification.source,
    sensitivity: args.sensitivity,
    instructionRisk: args.instructionRisk,
    origin: {
      source: classification.source,
      ref: args.ref,
      hash: args.valueHash,
      transform: `source:${sourceId}`,
    },
  });
}

export interface TaintSinkTrace {
  sink: TaintSinkId;
  label: TaintLabel;
  sourceChain: readonly TaintOrigin[];
  policy: "allow" | "require_human" | "block";
  reason: string;
  traceHash: string;
}

export interface PersistedTaintSinkTrace extends TaintSinkTrace {
  id: string;
  organizationId: string;
  ledgerId: string | null;
  createdAt: string;
  plane: "local" | "cloud";
}

export interface TaintTraceMetrics {
  total: number;
  allowed: number;
  humanReview: number;
  blocked: number;
  unknown: number;
  alerts: Array<{
    kind: "unknown_label" | "blocked_sink";
    traceHash: string;
    sink: TaintSinkId;
  }>;
}

export function summarizeTaintTraces(
  traces: readonly PersistedTaintSinkTrace[],
): TaintTraceMetrics {
  const metrics: TaintTraceMetrics = {
    total: traces.length,
    allowed: 0,
    humanReview: 0,
    blocked: 0,
    unknown: 0,
    alerts: [],
  };
  for (const trace of traces) {
    if (trace.policy === "allow") metrics.allowed += 1;
    if (trace.policy === "require_human") metrics.humanReview += 1;
    if (trace.policy === "block") {
      metrics.blocked += 1;
      metrics.alerts.push({
        kind: "blocked_sink",
        traceHash: trace.traceHash,
        sink: trace.sink,
      });
    }
    if (
      trace.label.trust === "unknown" ||
      trace.label.sensitivity === "unknown" ||
      trace.label.instructionRisk === "unknown"
    ) {
      metrics.unknown += 1;
      metrics.alerts.push({
        kind: "unknown_label",
        traceHash: trace.traceHash,
        sink: trace.sink,
      });
    }
  }
  return metrics;
}

export function replayTaintSinkTrace(
  trace: PersistedTaintSinkTrace,
): { matches: boolean; replayed: TaintSinkTrace } {
  const replayed = evaluateTaintSink(trace.sink, [trace.label]);
  return {
    matches:
      replayed.policy === trace.policy &&
      replayed.reason === trace.reason &&
      replayed.traceHash === trace.traceHash,
    replayed,
  };
}

export interface TaintAuditStore {
  appendSinkTrace(trace: PersistedTaintSinkTrace): Promise<void>;
  appendDeclassification(record: TaintDeclassificationRecord): Promise<void>;
  listSinkTraces(
    organizationId: string,
    ledgerId: string,
  ): Promise<PersistedTaintSinkTrace[]>;
  listDeclassifications(
    organizationId: string,
    parentTraceHash: string,
  ): Promise<TaintDeclassificationRecord[]>;
}

export class PlaneRoutingTaintAuditStore implements TaintAuditStore {
  constructor(
    private readonly local: TaintAuditStore,
    private readonly cloud: TaintAuditStore,
  ) {}

  async appendSinkTrace(trace: PersistedTaintSinkTrace): Promise<void> {
    return (trace.plane === "cloud" ? this.cloud : this.local)
      .appendSinkTrace(trace);
  }

  async appendDeclassification(
    record: TaintDeclassificationRecord,
  ): Promise<void> {
    return (record.plane === "cloud" ? this.cloud : this.local)
      .appendDeclassification(record);
  }

  async listSinkTraces(
    organizationId: string,
    ledgerId: string,
  ): Promise<PersistedTaintSinkTrace[]> {
    const [local, cloud] = await Promise.all([
      this.local.listSinkTraces(organizationId, ledgerId),
      this.cloud.listSinkTraces(organizationId, ledgerId),
    ]);
    return [...local, ...cloud].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  }

  async listDeclassifications(
    organizationId: string,
    parentTraceHash: string,
  ): Promise<TaintDeclassificationRecord[]> {
    const [local, cloud] = await Promise.all([
      this.local.listDeclassifications(organizationId, parentTraceHash),
      this.cloud.listDeclassifications(organizationId, parentTraceHash),
    ]);
    return [...local, ...cloud].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  }
}

export class InMemoryTaintAuditStore implements TaintAuditStore {
  readonly sinkTraces: PersistedTaintSinkTrace[] = [];
  readonly declassifications: TaintDeclassificationRecord[] = [];

  async appendSinkTrace(trace: PersistedTaintSinkTrace): Promise<void> {
    if (
      this.sinkTraces.some(
        (entry) =>
          entry.organizationId === trace.organizationId &&
          entry.ledgerId === trace.ledgerId &&
          entry.traceHash === trace.traceHash,
      )
    ) {
      return;
    }
    this.sinkTraces.push(Object.freeze({ ...trace }));
  }

  async appendDeclassification(
    record: TaintDeclassificationRecord,
  ): Promise<void> {
    if (this.declassifications.some((entry) => entry.id === record.id)) {
      throw new Error(`taint audit: duplicate declassification ${record.id}`);
    }
    this.declassifications.push(Object.freeze({ ...record }));
  }

  async listSinkTraces(
    organizationId: string,
    ledgerId: string,
  ): Promise<PersistedTaintSinkTrace[]> {
    return this.sinkTraces.filter(
      (entry) =>
        entry.organizationId === organizationId &&
        entry.ledgerId === ledgerId,
    );
  }

  async listDeclassifications(
    organizationId: string,
    parentTraceHash: string,
  ): Promise<TaintDeclassificationRecord[]> {
    return this.declassifications.filter(
      (entry) =>
        entry.organizationId === organizationId &&
        entry.parentTraceHash === parentTraceHash,
    );
  }
}

export function evaluateTaintSink(
  sink: TaintSinkId,
  labels: readonly TaintLabel[],
): TaintSinkTrace {
  const classification = TAINT_SINK_REGISTRY[sink];
  if (!classification) throw new Error(`unclassified taint sink: ${sink}`);
  const label = joinTaintLabels(...labels);
  let policy: TaintSinkTrace["policy"] = "allow";
  let reason = "classified context satisfies sink policy";
  if (
    label.trust === "unknown" ||
    label.sensitivity === "unknown" ||
    label.instructionRisk === "unknown"
  ) {
    policy = "block";
    reason = "unknown taint axis fails closed";
  } else if (
    classification.authorityBearing &&
    label.trust === "untrusted" &&
    label.instructionRisk === "instruction_like"
  ) {
    policy = "block";
    reason = "untrusted instruction-bearing content cannot reach an authority-bearing sink";
  } else if (label.trust === "untrusted" && classification.authorityBearing) {
    if (classification.egress) {
      policy = "require_human";
      reason = "untrusted data at egress requires an explicit Human Decision";
    }
  } else if (
    classification.egress &&
    (label.sensitivity === "private" || label.sensitivity === "restricted")
  ) {
    policy = "block";
    reason = "private or restricted content cannot cross an egress sink";
  }
  const traceBase = {
    sink,
    label: label.provenanceHash,
    policy,
    reason,
  };
  return Object.freeze({
    sink,
    label,
    sourceChain: label.originChain,
    policy,
    reason,
    traceHash: hashTaintValue(traceBase),
  });
}

export function readRuntimeValueAtSink<T>(
  value: RuntimeValue<T>,
  sink: TaintSinkId,
  contextLabels: readonly TaintLabel[] = [],
): { value: T; trace: TaintSinkTrace } {
  const trace = evaluateTaintSink(sink, [value.label, ...contextLabels]);
  if (trace.policy === "block") {
    throw new Error(`taint sink ${sink}: ${trace.reason}`);
  }
  if (!runtimePayloads.has(value as object)) {
    throw new Error("runtime value: invalid or deserialized envelope");
  }
  return { value: runtimePayloads.get(value as object) as T, trace };
}

export interface SerializedRuntimeValue<T> {
  version: 1;
  value: T;
  label: TaintLabel;
  provenance: RuntimeProvenance;
}

export function serializeRuntimeValue<T>(
  value: RuntimeValue<T>,
  sink: Extract<
    TaintSinkId,
    "file_write" | "network_egress" | "cache_storage" | "queue_storage"
  >,
): SerializedRuntimeValue<T> {
  const read = readRuntimeValueAtSink(value, sink);
  return {
    version: 1,
    value: read.value,
    label: value.label,
    provenance: value.provenance,
  };
}

export function deserializeRuntimeValue<T>(
  serialized: SerializedRuntimeValue<T>,
): RuntimeValue<T> {
  if (
    !isPlainRecord(serialized) ||
    serialized.version !== 1 ||
    !isPlainRecord(serialized.provenance) ||
    typeof serialized.provenance.valueHash !== "string" ||
    !Array.isArray(serialized.provenance.derivedFrom) ||
    !serialized.provenance.derivedFrom.every((item) => typeof item === "string") ||
    typeof serialized.provenance.transformation !== "string"
  ) {
    throw new Error("runtime value: malformed serialization");
  }
  const label = parseTaintLabel(serialized.label);
  const actualHash = hashTaintValue(serialized.value);
  if (actualHash !== serialized.provenance.valueHash) {
    throw new Error("runtime value: value hash mismatch");
  }
  return createRuntimeValue(serialized.value, label, serialized.provenance);
}

export interface TaintDeclassificationRecord {
  id: string;
  organizationId: string;
  before: TaintLabel;
  after: TaintLabel;
  reason: string;
  evidenceHash: string;
  actor: { type: "user" | "validator"; id: string };
  decisionLedgerId: string | null;
  rule: { id: string; version: string } | null;
  createdAt: string;
  parentTraceHash: string;
  plane: "local" | "cloud";
}

export function deriveDeclassifiedLabel(
  before: TaintLabel,
  patch: Partial<
    Pick<TaintLabel, "trust" | "sensitivity" | "instructionRisk">
  >,
): TaintLabel {
  return finalizeLabel({
    trust: patch.trust ?? before.trust,
    source: before.source,
    sensitivity: patch.sensitivity ?? before.sensitivity,
    instructionRisk: patch.instructionRisk ?? before.instructionRisk,
    originChain: before.originChain,
    originsTruncated: before.originsTruncated,
  });
}

export function declassifyTaintLabel(args: {
  id: string;
  organizationId: string;
  before: TaintLabel;
  after: TaintLabel;
  reason: string;
  evidenceHash: string;
  actor:
    | { type: "user"; id: string; decisionLedgerId: string }
    | { type: "validator"; id: string; rule: { id: string; version: string } };
  createdAt: string;
  plane: "local" | "cloud";
}): TaintDeclassificationRecord {
  if (
    !taintFlowsTo(args.after, args.before) ||
    taintFlowsTo(args.before, args.after)
  ) {
    throw new Error("taint declassification: after label is not less restrictive");
  }
  if (!args.reason.trim() || !args.evidenceHash.trim()) {
    throw new Error("taint declassification: reason and evidence hash are required");
  }
  const actor = { type: args.actor.type, id: args.actor.id } as const;
  return Object.freeze({
    id: args.id,
    organizationId: args.organizationId,
    before: args.before,
    after: args.after,
    reason: args.reason,
    evidenceHash: args.evidenceHash,
    actor,
    decisionLedgerId:
      args.actor.type === "user" ? args.actor.decisionLedgerId : null,
    rule: args.actor.type === "validator" ? args.actor.rule : null,
    createdAt: args.createdAt,
    parentTraceHash: args.before.provenanceHash,
    plane: args.plane,
  });
}
