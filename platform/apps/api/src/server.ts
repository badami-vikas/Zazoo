/**
 * Fastify 5 + tRPC 11 server. Boots the pipeline surface with zero infra.
 */
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./router.js";
import { makeContextFactory } from "./context.js";
import { isVerifierConfigured } from "./identity.js";
import { buildWiring, PILOT_WORKSPACE } from "./wiring.js";
import { registerGoogleOAuthRoutes } from "./google-oauth-routes.js";
import { reconcileWorkspaceRelationshipMaterializations } from "./relationship-materializer.js";

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

  if (process.env.NODE_ENV === "production" || isVerifierConfigured()) return [];
  return true;
}

export function serverHostConfig(): string {
  if (process.env.API_HOST) return process.env.API_HOST;
  return process.env.NODE_ENV === "production" || isVerifierConfigured() || Boolean(process.env.DATABASE_URL)
    ? "0.0.0.0"
    : "127.0.0.1";
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
  "ritual.runById",
  "commons.runInstalledSkill",
  "helpdesk.public.",
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

/**
 * Fail fast in production rather than silently booting onto unsafe defaults. Today
 * that means: a real ledger (DATABASE_URL) — without it every proposal/decision
 * lives in `InMemoryLedger`, wiped on restart, while `/health` still reports
 * `ok:true`. See known-issues.md "In-memory everything without DATABASE_URL".
 */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production without: ${missing.join(", ")}. ` +
        "In-memory stores are unsafe for production (data loss on restart, no real audit trail).",
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
  "req.body.json.accessToken",
  "req.body.*.json.accessToken",
  "req.headers.authorization",
  'req.headers["authorization"]',
  "body.phone",
  "body.code",
  "body.accessToken",
  "body.json.accessToken",
  "body.*.json.accessToken",
  "headers.authorization",
  'headers["authorization"]',
];

export const loggerOptions = {
  redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
};

export async function buildServer() {
  assertProductionEnv();
  const wiring = await buildWiring();
  const createContext = makeContextFactory(wiring);

  const app = Fastify({ logger: loggerOptions, maxParamLength: 5000 });
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
    { verifierConfigured, persistent: wiring.persistent },
    `identity: verifier ${verifierConfigured ? "CONFIGURED" : "not configured (pilot fallback for tokenless requests)"}; ` +
      `stores ${wiring.persistent ? "persistent" : "in-memory"}`,
  );
  if (!verifierConfigured && (wiring.persistent || process.env.NODE_ENV === "production")) {
    app.log.warn(
      "identity: NO verifier configured on a persistent/production deploy — every mutation will be " +
        "REJECTED with 401 (SEC-1 fail-closed). Set SUPABASE_JWT_SECRET or SUPABASE_URL to enable auth.",
    );
  }

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
    return { ready, persistent: wiring.persistent, checks };
  });

  // OAuth redirect target (a GET, not tRPC): Google sends the user back here with a
  // `code`. We exchange it for tokens and persist them to the LOCAL plane (never
  // Supabase), then bounce back to the prototype. `state` carries the integration id.
  await registerGoogleOAuthRoutes(app, wiring);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
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
      const result = await reconcileWorkspaceRelationshipMaterializations(
        wiring.graphStore,
        wiring.relationMaterializations,
        wiring.ledger,
        PILOT_WORKSPACE,
        new Date(),
        {
          ...(relationOwnerCursor
            ? { afterOwnerUserId: relationOwnerCursor }
            : {}),
        },
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
  await reconcileRelationships();
  const relationReconciliationTimer = setInterval(
    () => void reconcileRelationships(),
    60_000,
  );
  relationReconciliationTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(relationReconciliationTimer);
  });

  return app;
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  buildServer()
    .then((app) => app.listen({ port, host: serverHostConfig() }))
    .then((addr) => console.log(`bridge-api listening at ${addr}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
