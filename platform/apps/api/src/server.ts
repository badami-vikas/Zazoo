/**
 * Fastify 5 + tRPC 11 server. Boots the pipeline surface with zero infra.
 */
import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
import type { ListenOptions } from "node:net";
import type { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { appRouter, eggRouter, type AppRouter } from "./router.js";
import { makeContextFactory } from "./context.js";
import { isVerifierConfigured, missingVerifierNotice } from "./identity.js";
import { buildWiring, PILOT_ORGANIZATION } from "./wiring.js";
import { indexMemoryEmbeddings } from "./retrieval-fusion.js";
import { runUsageRetrievalEval } from "./retrieval-eval.js";
import { SystemClock } from "@bridge/core";
import {
  startAutomationScheduler,
  type AutomationSchedulerHandle,
} from "./automation-scheduler.js";
import { registerGoogleOAuthRoutes } from "./google-oauth-routes.js";
import { reconcileOrganizationRelationshipMaterializations } from "./relationship-materializer.js";
import { SIDECAR_TOKEN_HEADER, validSidecarToken } from "./sidecar-auth.js";
import {
  isPublicCloudOnly,
  isPublicCloudScratchPath,
  renderWebOrigin,
} from "./deployment-boundary.js";

/**
 * CORS origin resolution. `API_ALLOWED_ORIGINS` (comma-separated) is the explicit
 * allowlist and always wins when set — any origin, any environment. Without it we
 * fail CLOSED (no origin allowed) whenever this looks like a real/shared deploy —
 * production OR a cryptographic verifier is configured. A server that verifies
 * identities must not simultaneously hand a wildcard CORS grant to every website
 * (SEC-2): permissive `origin: true` survives ONLY for pure local dev (non-prod AND
 * no verifier), so the prototype's local Vite server keeps working with zero config.
 * Previously the fallback keyed on `NODE_ENV` alone, so an auth-enabled non-prod
 * deploy still echoed `origin: true`. See known-issues.md.
 */
export function corsOriginConfig(): true | string[] {
  const explicit = process.env.API_ALLOWED_ORIGINS;
  if (explicit) {
    return explicit
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  const renderOrigin = renderWebOrigin();
  if (renderOrigin) return [renderOrigin];

  if (process.env.NODE_ENV === "production" || isVerifierConfigured()) return [];
  return true;
}

export function serverHostConfig(): string {
  if (process.env.BRIDGE_SIDECAR_TOKEN) return "127.0.0.1";
  if (process.env.API_HOST) return process.env.API_HOST;
  return process.env.NODE_ENV === "production" || isVerifierConfigured() || Boolean(process.env.DATABASE_URL)
    ? "0.0.0.0"
    : "127.0.0.1";
}

export function inheritedListenFd(): number | undefined {
  const raw = process.env.BRIDGE_LISTEN_FD;
  if (raw === undefined) return undefined;
  if (process.platform === "win32") {
    throw new Error(
      "BRIDGE_LISTEN_FD is unsupported on Windows; refusing an unreserved sidecar transport",
    );
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("BRIDGE_LISTEN_FD must be a numeric file descriptor");
  }
  const fd = Number(raw);
  if (!Number.isSafeInteger(fd) || fd < 3) {
    throw new Error("BRIDGE_LISTEN_FD must identify an inherited socket");
  }
  return fd;
}

interface InheritedListenOptions extends ListenOptions {
  fd: number;
}

export async function listenServer(
  app: FastifyInstance,
  port: number,
): Promise<string> {
  const fd = inheritedListenFd();
  if (process.env.BRIDGE_SIDECAR_TOKEN && fd === undefined) {
    throw new Error(
      "Managed sidecars require a parent-retained inherited loopback listener",
    );
  }
  if (fd === undefined) {
    return app.listen({ port, host: serverHostConfig() });
  }

  await app.ready();
  return new Promise<string>((resolve, reject) => {
    const options: InheritedListenOptions = { fd };
    const onError = (error: Error) => {
      app.server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      app.server.off("error", onError);
      const address = app.server.address();
      if (
        address === null ||
        typeof address === "string" ||
        address.address !== "127.0.0.1"
      ) {
        reject(
          new Error(
            "Inherited sidecar listener must be an IPv4 loopback TCP socket",
          ),
        );
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    };
    app.server.once("error", onError);
    app.server.once("listening", onListening);
    try {
      app.server.listen(options);
    } catch (error) {
      app.server.off("error", onError);
      app.server.off("listening", onListening);
      reject(error);
    }
  });
}

/** Sensitive tRPC procedures that get a tighter per-IP rate cap than the global default:
 * a mutation that spends real work/quota (`action.propose`, `blueprint.propose`), a
 * brute-forceable verification stub (`onboarding.verifyPhoneOtp`), and outbound-network
 * procedures that can be turned into a cost-amplification / SSRF lever
 * (`google.syncGmail`, `dealpilot.discoverDeals`, governed Automation Runs). Matched as substrings of the request path so
 * a batched tRPC call (comma-joined procedure names in the URL) is caught if it contains
 * ANY sensitive procedure — fail-tight. */
const RATE_LIMIT_SENSITIVE_PATHS = [
  "action.propose",
  "blueprint.propose",
  "onboarding.verifyPhoneOtp",
  "google.syncGmail",
  "dealpilot.discoverDeals",
  "automation.runById",
  "commons.runInstalledSkill",
  "relationship.helpdesk.public.",
] as const;

export interface RateLimitConfig {
  /** Per-IP requests/window for ordinary endpoints. */
  globalMax: number;
  /** Per-IP requests/window for `RATE_LIMIT_SENSITIVE_PATHS` (own bucket). */
  sensitiveMax: number;
  /** Window length (ms). */
  windowMs: number;
}

/** Rate-limit caps, env-overridable (`API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_SENSITIVE_MAX`,
 * `API_RATE_LIMIT_WINDOW_MS`) with safe defaults. Exported for tests. */
export function rateLimitConfig(): RateLimitConfig {
  const num = (v: string | undefined, fallback: number): number => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    globalMax: num(process.env.API_RATE_LIMIT_MAX, 300),
    sensitiveMax: num(process.env.API_RATE_LIMIT_SENSITIVE_MAX, 10),
    windowMs: num(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
  };
}

/** Path (no query string) → which limit bucket it falls in. A request lands in the
 * `sensitive` bucket if its path contains any sensitive procedure name. */
export function rateLimitBucket(url: string): "sensitive" | "global" {
  const path = url.split("?")[0] ?? url;
  return RATE_LIMIT_SENSITIVE_PATHS.some((p) => path.includes(p)) ? "sensitive" : "global";
}

function validUuid(value: string | undefined): boolean {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function validBase64Key(value: string | undefined): boolean {
  if (!value) return false;
  const decoded = Buffer.from(value, "base64");
  return (
    decoded.byteLength === 32 &&
    decoded.toString("base64").replace(/=+$/, "") ===
      value.trim().replace(/=+$/, "")
  );
}

/** Fail closed before any production listener is opened. */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const invalid: string[] = [];
  const publicCloudOnly = isPublicCloudOnly();
  if (!process.env.DATABASE_URL) invalid.push("DATABASE_URL");
  if (!process.env.SUPABASE_URL) {
    invalid.push("SUPABASE_URL");
  } else {
    try {
      if (new URL(process.env.SUPABASE_URL).protocol !== "https:") {
        invalid.push("SUPABASE_URL (must use HTTPS)");
      }
    } catch {
      invalid.push("SUPABASE_URL (invalid URL)");
    }
  }
  let renderOrigin: string | null = null;
  try {
    renderOrigin = renderWebOrigin();
  } catch {
    invalid.push("BRIDGE_RENDER_WEB_HOST");
  }
  const origins =
    process.env.API_ALLOWED_ORIGINS
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ??
    (renderOrigin ? [renderOrigin] : undefined);
  if (!origins?.length) {
    invalid.push("API_ALLOWED_ORIGINS");
  } else {
    for (const origin of origins) {
      try {
        if (new URL(origin).protocol !== "https:") {
          invalid.push("API_ALLOWED_ORIGINS (HTTPS origins only)");
          break;
        }
      } catch {
        invalid.push("API_ALLOWED_ORIGINS (invalid URL)");
        break;
      }
    }
  }
  if (!validUuid(process.env.BRIDGE_PILOT_USER_ID)) {
    invalid.push("BRIDGE_PILOT_USER_ID (Supabase Auth UUID)");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.env.BRIDGE_PILOT_USER_EMAIL ?? "")) {
    invalid.push("BRIDGE_PILOT_USER_EMAIL");
  }
  const localDir = process.env.BRIDGE_LOCAL_DIR;
  if (!localDir || !isAbsolute(localDir)) {
    invalid.push(
      `BRIDGE_LOCAL_DIR (absolute ${publicCloudOnly ? "ephemeral scratch" : "durable volume"} path)`,
    );
  }
  const filesRoot = process.env.BRIDGE_FILES_ROOT;
  if (!filesRoot || !isAbsolute(filesRoot)) {
    invalid.push(
      `BRIDGE_FILES_ROOT (absolute ${publicCloudOnly ? "ephemeral scratch" : "durable volume"} path)`,
    );
  }
  const previousKey = process.env.BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY?.trim();
  const previousKeyId =
    process.env.BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY_ID?.trim();
  if (publicCloudOnly) {
    if (
      (localDir && !isPublicCloudScratchPath(localDir)) ||
      (filesRoot && !isPublicCloudScratchPath(filesRoot))
    ) {
      invalid.push("public-cloud scratch paths must stay under /tmp/bridge-public-only");
    }
    if (process.env.BRIDGE_DEALPILOT_CREDENTIAL_VAULT !== "disabled") {
      invalid.push("BRIDGE_DEALPILOT_CREDENTIAL_VAULT=disabled");
    }
    if (
      process.env.BRIDGE_CREDENTIAL_VAULT_KEY_ID ||
      process.env.BRIDGE_CREDENTIAL_VAULT_KEY ||
      previousKeyId ||
      previousKey
    ) {
      invalid.push("public-cloud mode forbids credential vault keys");
    }
    // At least one REMOTE model provider. `buildPersistentPorts` always registers
    // LlamaCppProvider and OllamaProvider, but both are Local-Plane runtimes: the
    // deployed image is plain `node:22-bookworm-slim` with no llama.cpp binary and
    // no Ollama daemon, and OllamaProvider defaults to http://localhost:11434.
    // Without an Anthropic or Groq key the container therefore boots "healthy"
    // with a provider list that cannot serve a single turn — every Agent Run then
    // fails at its first model call with a connection error instead of the deploy
    // failing. render.yaml already declares both keys as `sync: false` secrets, so
    // this asserts the contract that file already assumes.
    //
    // Scoped to public-cloud mode ON PURPOSE: a self-hosted production host may
    // legitimately run a real local Ollama, and asserting there would refuse a
    // valid deployment.
    if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim()) {
      invalid.push(
        "ANTHROPIC_API_KEY or GROQ_API_KEY (public-cloud has no local model runtime, so a remote provider is the only one that can answer)",
      );
    }
  } else {
    if (process.env.BRIDGE_LOCAL_RESIDENCY !== "encrypted-host-volume") {
      invalid.push("BRIDGE_LOCAL_RESIDENCY=encrypted-host-volume");
    }
    if (process.env.BRIDGE_DEALPILOT_CREDENTIAL_VAULT !== "encrypted-file") {
      invalid.push("BRIDGE_DEALPILOT_CREDENTIAL_VAULT=encrypted-file");
    }
    if (!process.env.BRIDGE_CREDENTIAL_VAULT_KEY_ID?.trim()) {
      invalid.push("BRIDGE_CREDENTIAL_VAULT_KEY_ID");
    }
    if (!validBase64Key(process.env.BRIDGE_CREDENTIAL_VAULT_KEY?.trim())) {
      invalid.push("BRIDGE_CREDENTIAL_VAULT_KEY (base64 32-byte key)");
    }
    if (Boolean(previousKey) !== Boolean(previousKeyId)) {
      invalid.push(
        "BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY_ID/BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY (configure together)",
      );
    } else if (previousKey && !validBase64Key(previousKey)) {
      invalid.push(
        "BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY (base64 32-byte key)",
      );
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      `Refusing to start with incomplete or unsafe production configuration: ${invalid.join(", ")}`,
    );
  }
}

/** A syntactically-valid probe id — the stores below are queried by shape, not existence. */
const HEALTH_PROBE_ID = "00000000-0000-0000-0000-000000000000";

/**
 * SEC-7 — pino log redaction. If a request body or Authorization header is ever
 * serialized into a log line (a custom serializer, an error log, or a debug dump),
 * these paths are censored instead of written in the clear. The onboarding phone
 * flow carries a phone number + OTP `code`, and bearer credentials ride the
 * Authorization header — none of which should ever land in logs.
 */
export const LOG_REDACT_PATHS: string[] = [
  "req.body.phone",
  "req.body.code",
  "req.body.accessToken",
  "req.body.password",
  "req.body.userId",
  "req.body.json.accessToken",
  "req.body.json.password",
  "req.body.json.userId",
  "req.body.*.json.accessToken",
  "req.body.*.json.password",
  "req.body.*.json.userId",
  "req.headers.authorization",
  'req.headers["authorization"]',
  "req.headers.x-bridge-sidecar-token",
  'req.headers["x-bridge-sidecar-token"]',
  "body.phone",
  "body.code",
  "body.accessToken",
  "body.password",
  "body.userId",
  "body.json.accessToken",
  "body.json.password",
  "body.json.userId",
  "body.*.json.accessToken",
  "body.*.json.password",
  "body.*.json.userId",
  "headers.authorization",
  'headers["authorization"]',
  "headers.x-bridge-sidecar-token",
  'headers["x-bridge-sidecar-token"]',
];

export const loggerOptions = {
  redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
};

export function desktopOAuthRedirectUri(
  address: ReturnType<FastifyInstance["server"]["address"]>,
): string {
  if (
    !address ||
    typeof address === "string" ||
    address.port < 1 ||
    (address.address !== "127.0.0.1" &&
      address.address !== "::1" &&
      address.address !== "::ffff:127.0.0.1")
  ) {
    throw new Error(
      "Desktop Google OAuth requires a bound loopback TCP address",
    );
  }
  return `http://127.0.0.1:${address.port}/integrations/google/callback`;
}

export async function buildServer() {
  assertProductionEnv();
  const wiring = await buildWiring();
  const createContext = makeContextFactory(wiring);

  const app = Fastify({
    logger: loggerOptions,
    maxParamLength: 5000,
    forceCloseConnections: "idle",
  });
  app.addHook("onRequest", async (request, reply) => {
    if (
      process.env.BRIDGE_OAUTH_DESKTOP === "1" &&
      wiring.googleOAuth &&
      app.server.address() !== null
    ) {
      wiring.googleOAuth.redirectUri = desktopOAuthRedirectUri(
        app.server.address(),
      );
    }
    if (
      process.env.BRIDGE_SIDECAR_TOKEN &&
      request.method !== "OPTIONS" &&
      !request.url.startsWith("/integrations/google/callback") &&
      !validSidecarToken(request.headers[SIDECAR_TOKEN_HEADER])
    ) {
      return reply.code(401).send({ error: "sidecar authentication required" });
    }
  });
  app.addHook("onClose", async () => {
    await wiring.close();
  });
  const origin = corsOriginConfig();
  if (origin === true) {
    app.log.warn("CORS: no API_ALLOWED_ORIGINS set — allowing all origins (dev default). Set API_ALLOWED_ORIGINS in any shared/production environment.");
  } else if (origin.length === 0) {
    app.log.warn("CORS: no API_ALLOWED_ORIGINS set and NODE_ENV=production — allowing NO origins. Set API_ALLOWED_ORIGINS to the prototype's real origin(s).");
  }
  await app.register(cors, { origin });

  // SEC-1: make the identity posture visible at boot. A verifier being absent on a
  // persistent/production deploy is not just informational — every mutation will be
  // rejected by `requireAuthOnMutation`, so surface it loudly rather than letting the
  // operator discover it one 401 at a time.
  const verifierConfigured = isVerifierConfigured();
  app.log.info(
    {
      verifierConfigured,
      persistent: wiring.persistent,
      boundary: wiring.publicCloudOnly ? "public-cloud" : "full",
    },
    `identity: verifier ${verifierConfigured ? "CONFIGURED" : "not configured (pilot fallback for tokenless requests)"}; ` +
      `stores ${wiring.persistent ? "persistent" : "in-memory"}`,
  );
  const verifierNotice = missingVerifierNotice({
    verifierConfigured,
    persistent: wiring.persistent,
    production: process.env.NODE_ENV === "production",
    sidecarToken: process.env.BRIDGE_SIDECAR_TOKEN,
  });
  if (verifierNotice) app.log[verifierNotice.level](verifierNotice.message);

  // SEC-2: bound request rates per client IP. A global cap plus a much tighter,
  // independently-counted cap on sensitive procedures (cost/quota-spending mutations,
  // the brute-forceable OTP stub, outbound-network levers) so an unauthenticated flood
  // can't cost-amplify or brute-force even before the auth gate turns it away. The
  // default in-memory store is per-process — a shared store (Redis) is the follow-up for
  // a multi-instance deploy; see known-issues.md. The hook runs on `onRequest`, ahead of
  // tRPC context creation, so limiting happens before any real work.
  const rl = rateLimitConfig();
  await app.register(rateLimit, {
    global: true,
    max: (req) => (rateLimitBucket(req.url) === "sensitive" ? rl.sensitiveMax : rl.globalMax),
    timeWindow: rl.windowMs,
    keyGenerator: (req) => `${req.ip}:${rateLimitBucket(req.url)}`,
  });

  app.get("/health", async () => ({ ok: true, service: "bridge-api" }));
  app.post("/internal/sidecar/shutdown", async (_request, reply) => {
    if (!process.env.BRIDGE_SIDECAR_TOKEN) {
      return reply.code(404).send({ error: "not found" });
    }
    setImmediate(() => {
      void app.close().catch((error: unknown) => {
        app.log.error({ err: error }, "sidecar shutdown failed");
      });
    });
    return reply.code(202).send({ stopping: true });
  });

  // Liveness ("/health") only proves the process is up. Readiness actually probes the
  // backing stores so a downed Postgres or corrupted local plane surfaces as a real
  // failure instead of a silent `ok:true`.
  app.get("/health/ready", async (_req, reply) => {
    const checks: Record<string, "ok" | "error"> = {};
    let ready = true;

    try {
      await wiring.ledger.get(HEALTH_PROBE_ID);
      checks.ledger = "ok";
    } catch (err) {
      checks.ledger = "error";
      ready = false;
      app.log.error({ err }, "health/ready: ledger probe failed");
    }

    try {
      await wiring.localPlane.graph.hasExternal(HEALTH_PROBE_ID, "healthcheck", "healthcheck");
      checks.localPlane = "ok";
    } catch (err) {
      checks.localPlane = "error";
      ready = false;
      app.log.error({ err }, "health/ready: local plane probe failed");
    }

    reply.code(ready ? 200 : 503);
    return {
      ready,
      persistent: wiring.persistent,
      boundary: wiring.publicCloudOnly ? "public-cloud" : "full",
      checks,
    };
  });

  // OAuth redirect target (a GET, not tRPC): Google sends the user back here with a
  // `code`. We exchange it for tokens and persist them to the LOCAL plane (never
  // Supabase), then bounce back to the prototype. `state` carries the integration id.
  await registerGoogleOAuthRoutes(app, wiring);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      // The Egg mounts the kernel alone; Commons Module namespaces are absent
      // until installed from the registry (ADR 2026-09-04). The client type
      // stays AppRouter — a missing namespace is a NOT_FOUND, not a type gap.
      // `eggRouter` is a structural subset of `appRouter`; the cast keeps the
      // plugin typed against the full contract the client compiles against.
      router: (wiring.profile === "egg" ? eggRouter : appRouter) as AppRouter,
      createContext,
      allowMethodOverride: true,
      onError({ path, error }) {
        app.log.error({ path, msg: error.message }, "trpc error");
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  let relationReconciliationRunning = false;
  let relationOwnerCursor: string | undefined;
  const reconcileRelationships = async () => {
    if (relationReconciliationRunning) return;
    relationReconciliationRunning = true;
    try {
      const result = await reconcileOrganizationRelationshipMaterializations(
        wiring.graphStore,
        wiring.relationMaterializations,
        wiring.ledger,
        PILOT_ORGANIZATION,
        new Date(),
        {
          ...(relationOwnerCursor
            ? { afterOwnerUserId: relationOwnerCursor }
            : {}),
        },
        wiring.memoryStore,
      );
      relationOwnerCursor = result.nextOwnerCursor ?? undefined;
      if (result.failed > 0 || result.errors.length > 0) {
        app.log.warn(
          {
            ownersExamined: result.ownersExamined,
            attempted: result.attempted,
            failed: result.failed,
            errors: result.errors,
          },
          "Relationship materialization reconciliation left retryable effects",
        );
      }
    } catch (err) {
      app.log.error({ err }, "Relationship materialization reconciliation failed");
    } finally {
      relationReconciliationRunning = false;
    }
  };
  let relationReconciliationTimer: NodeJS.Timeout | undefined;
  if (!wiring.publicCloudOnly) {
    await reconcileRelationships();
    relationReconciliationTimer = setInterval(
      () => void reconcileRelationships(),
      60_000,
    );
    relationReconciliationTimer.unref();
  }
  // ADR-179 — the generic Automation scheduler. This used to be a hardcoded
  // `setInterval(..., 15 * 60_000)` naming ONE automation id, which meant any
  // Automation declaring a schedule (in its manifest, or in the `cadence`
  // column) simply never ran. The cadence now lives on each Automation as a
  // typed trigger and this loop reads it, so adding a scheduled Automation
  // needs no new timer and no server change.
  //
  // Same posture as before: flight-gated, off on the public cloud boundary
  // (scheduled Runs touch private Local-Plane state), reentrancy-guarded and
  // unref'd. A failed Run logs and waits for the next tick — no retry storm,
  // and one broken Automation cannot stop the others.
  let automationScheduler: AutomationSchedulerHandle | undefined;
  if (wiring.learningObservationEnabled && !wiring.publicCloudOnly) {
    automationScheduler = startAutomationScheduler({
      registry: wiring.automationRegistry,
      runRecorder: wiring.automationRunRecorder,
      executor: wiring.automationExecutor,
      organizationId: PILOT_ORGANIZATION,
      log: {
        info: (obj, msg) => app.log.info(obj as object, msg),
        warn: (obj, msg) => app.log.warn(obj as object, msg),
        error: (obj, msg) => app.log.error(obj as object, msg),
      },
    });
  }

  // LA5 (TASK-032) — scheduled memory-embedding indexer. Derived-index
  // maintenance, not an agent action: it reads prose Memory rows and writes
  // vectors (refs only, rebuildable), so it runs as a plain maintenance loop
  // like the relationship-reconciliation timer rather than a governed
  // Automation. Exists ONLY while the retrieval-fusion flight is on and
  // never on the public cloud boundary.
  let memoryIndexRunning = false;
  const runMemoryEmbeddingIndex = async () => {
    if (memoryIndexRunning) return;
    memoryIndexRunning = true;
    try {
      const pass = await indexMemoryEmbeddings({
        memoryStore: wiring.memoryStore,
        vectorIndex: wiring.vectorIndex,
        organizationId: PILOT_ORGANIZATION,
        ownerUserId: wiring.pilotUserId,
        ...(wiring.semanticEmbedder ? { embedder: wiring.semanticEmbedder } : {}),
      });
      // A silent downgrade is a dishonest surface: retrieval quality dropped
      // from semantic to lexical overlap and nothing else would say so.
      if (pass.degraded) {
        app.log.warn(
          { configured: wiring.semanticEmbedder?.id, active: pass.embeddingModel },
          "semantic embedder unreachable — memory index ran in the lexical fallback space",
        );
      }
    } catch (err) {
      app.log.error({ err }, "memory embedding index failed");
    } finally {
      memoryIndexRunning = false;
    }
  };
  let memoryIndexTimer: NodeJS.Timeout | undefined;
  let memoryIndexBootTimer: NodeJS.Timeout | undefined;
  if (wiring.retrievalFusionEnabled && !wiring.publicCloudOnly) {
    memoryIndexBootTimer = setTimeout(() => void runMemoryEmbeddingIndex(), 30_000);
    memoryIndexBootTimer.unref();
    memoryIndexTimer = setInterval(() => void runMemoryEmbeddingIndex(), 15 * 60_000);
    memoryIndexTimer.unref();
  }

  // LA5 — scheduled retrieval eval over real usage. Mines self-retrieval
  // cases from the organization's own prose Memories, runs them through the
  // LIVE fused pipeline, persists the scored EvalRun. Every 6 hours plus a
  // post-boot run 2 minutes in (after the first index pass); skips honestly
  // below the minimum case count. Same maintenance-loop posture as the
  // indexer — measurement, not agent action.
  let retrievalEvalRunning = false;
  const runRetrievalEval = async () => {
    if (retrievalEvalRunning) return;
    retrievalEvalRunning = true;
    try {
      const result = await runUsageRetrievalEval({
        memoryStore: wiring.memoryStore,
        vectorIndex: wiring.vectorIndex,
        graphStore: wiring.graphStore,
        evalStore: wiring.evalStore,
        organizationId: PILOT_ORGANIZATION,
        ownerUserId: wiring.pilotUserId,
        ...(wiring.semanticEmbedder ? { embedder: wiring.semanticEmbedder } : {}),
        nowISO: () => new SystemClock().nowISO(),
      });
      if (result.skipped) {
        app.log.info({ cases: result.cases }, "retrieval usage eval skipped (too few prose memories)");
      } else {
        app.log.info(
          {
            runId: result.runId,
            cases: result.cases,
            recallAtK: result.recallAtK,
            precisionAtK: result.precisionAtK,
            mrr: result.mrr,
            embeddingModel: result.embeddingModel,
          },
          "retrieval usage eval recorded",
        );
      }
    } catch (err) {
      app.log.error({ err }, "retrieval usage eval failed");
    } finally {
      retrievalEvalRunning = false;
    }
  };
  let retrievalEvalTimer: NodeJS.Timeout | undefined;
  let retrievalEvalBootTimer: NodeJS.Timeout | undefined;
  if (wiring.retrievalFusionEnabled && !wiring.publicCloudOnly) {
    retrievalEvalBootTimer = setTimeout(() => void runRetrievalEval(), 120_000);
    retrievalEvalBootTimer.unref();
    retrievalEvalTimer = setInterval(() => void runRetrievalEval(), 6 * 60 * 60_000);
    retrievalEvalTimer.unref();
  }

  app.addHook("onClose", async () => {
    if (relationReconciliationTimer) {
      clearInterval(relationReconciliationTimer);
    }
    automationScheduler?.stop();
    if (memoryIndexBootTimer) {
      clearTimeout(memoryIndexBootTimer);
    }
    if (memoryIndexTimer) {
      clearInterval(memoryIndexTimer);
    }
    if (retrievalEvalBootTimer) {
      clearTimeout(retrievalEvalBootTimer);
    }
    if (retrievalEvalTimer) {
      clearInterval(retrievalEvalTimer);
    }
  });

  return app;
}

export function watchParentLiveness(
  input: Readable,
  shutdown: () => void,
): () => void {
  let stopped = false;
  const parentLost = () => {
    if (stopped) return;
    stopped = true;
    shutdown();
  };
  input.once("end", parentLost);
  input.once("close", parentLost);
  input.once("error", parentLost);
  input.resume();
  return () => {
    stopped = true;
    input.off("end", parentLost);
    input.off("close", parentLost);
    input.off("error", parentLost);
    input.pause();
  };
}

interface ClosableServer {
  close(): Promise<void>;
  server?: {
    closeIdleConnections?: () => void;
  };
}

export function closeServerWithDeadline(
  app: ClosableServer,
  exitProcess: (code: number) => void = (code) => process.exit(code),
  timeoutMs = 5_000,
  idleSweepMs = 100,
): void {
  let completed = false;
  const closeIdleConnections = () => {
    app.server?.closeIdleConnections?.();
  };
  closeIdleConnections();
  const idleSweep = setInterval(closeIdleConnections, Math.max(1, idleSweepMs));
  const deadline = setTimeout(() => {
    if (completed) return;
    completed = true;
    clearInterval(idleSweep);
    console.error("bridge-api graceful shutdown timed out; forcing process exit");
    exitProcess(1);
  }, timeoutMs);
  void app.close().then(
    () => {
      if (completed) return;
      completed = true;
      clearInterval(idleSweep);
      clearTimeout(deadline);
      exitProcess(0);
    },
    (error: unknown) => {
      if (completed) return;
      completed = true;
      clearInterval(idleSweep);
      clearTimeout(deadline);
      console.error("bridge-api shutdown failed", error);
      exitProcess(1);
    },
  );
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  buildServer()
    .then(async (app) => {
      let stopping = false;
      let parentWatch: NodeJS.Timeout | undefined;
      let stopParentLivenessWatch: (() => void) | undefined;
      const shutdown = () => {
        if (stopping) return;
        stopping = true;
        if (parentWatch) clearInterval(parentWatch);
        stopParentLivenessWatch?.();
        closeServerWithDeadline(app);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      if (process.env.BRIDGE_PARENT_LIVENESS === "stdin") {
        stopParentLivenessWatch = watchParentLiveness(process.stdin, shutdown);
      }
      const expectedParentPid = Number(process.env.BRIDGE_PARENT_PID);
      if (Number.isSafeInteger(expectedParentPid) && expectedParentPid > 0) {
        parentWatch = setInterval(() => {
          if (process.ppid !== expectedParentPid) shutdown();
        }, 1_000);
        parentWatch.unref();
      }
      const addr = await listenServer(app, port);
      console.log(`bridge-api listening at ${addr}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
