# Recon Always-On Deploy + Bridge Intake Hop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Recon's already-built findings flow reach the Bridge web Approvals as governed Signal/Person proposals, and deploy Recon + the platform API always-on so it works without a local server.

**Architecture:** Add one Fastify route (`POST /intake/recon`) to `platform/apps/api` that maps Recon's existing `CaptureEnvelope` → `pipeline.propose()` calls (reusing the seeded `INTAKE_AGENT` + `ledger`), which the web Approvals UI already reads. Recon points `NEXT_PUBLIC_BRIDGE_INTAKE_URL` at it. Then deploy both apps to Fly.io (Recon needs a persistent volume for its JSONL store; the API binds to the same Supabase project the web reads).

**Tech Stack:** TypeScript, Fastify 5, tRPC 11, `@bridge/core` Universal Action Pipeline, `@bridge/db` Drizzle/Postgres, Next.js 15 (Recon), Node built-in test runner (`node --test`), Fly.io, Supabase.

**Source spec:** [2026-06-24-recon-deploy-and-intake-hop-design.md](../specs/2026-06-24-recon-deploy-and-intake-hop-design.md)

---

## File Structure

**New (platform):**
- `platform/apps/api/src/intake/recon-envelope.ts` — pure mapper: `CaptureEnvelope` → propose-request array. The single testable unit.
- `platform/apps/api/src/intake/recon-route.ts` — Fastify route: secret check → zod-validate → build RunCtx → call `pipeline.propose` per mapped request → `{ ok, proposalIds }`.
- `platform/apps/api/test/recon-intake.test.ts` — unit tests (mapper) + integration tests (route via `fastify.inject`).

**Modified (platform):**
- `platform/apps/api/src/wiring.ts` — `export` the three pilot constants the route needs.
- `platform/apps/api/src/server.ts` — register the new route.

**Modified (recon):**
- `Tools/recon/lib/bridge.ts` — add `flushOutbox()` (re-post stranded envelopes once the URL is configured).
- `Tools/recon/app/page.tsx` — call `flushOutbox()` opportunistically after a successful `addToBridge` (the one Recon code touch).

**New (infra, created during deploy tasks):**
- `platform/apps/api/Dockerfile`, `platform/apps/api/fly.toml`
- `Tools/recon/Dockerfile`, `Tools/recon/fly.toml`

---

## Task 1: Pure mapper — `CaptureEnvelope` → propose requests

**Files:**
- Create: `platform/apps/api/src/intake/recon-envelope.ts`
- Test: `platform/apps/api/test/recon-intake.test.ts`

Recon's `CaptureEnvelope.payload` is `{ person: {name, company, domain?, identifiers}, memories: [{text,source,url?,tier}], signals: [{text,source,url?}] }`. We map the subject + its memories into ONE `person:write` proposal (keeps the Approvals inbox signal-dense, per spec open-choice (ii)), and each signal into its own `signal:write` proposal. Actor = the seeded `INTAKE_AGENT` (agent, drafts-only) onBehalfOf the pilot user; skill = `stageMutation` (already registered, echoes inputs as the proposed change).

- [ ] **Step 1: Write the failing test**

```ts
// platform/apps/api/test/recon-intake.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { envelopeToProposeRequests, type ReconEnvelope } from "../src/intake/recon-envelope.js";

const IDS = {
  workspaceId: "b0000000-0000-4000-a000-000000000001",
  intakeAgentId: "b0000000-0000-4000-a000-0000000000e2",
  userId: "e0f0053b-fc44-476e-be27-1371e179e958",
};

function sampleEnvelope(): ReconEnvelope {
  return {
    contract: "recon.v1",
    dataScope: "public",
    payload: {
      person: { name: "Dana Lee", company: "Acme Capital", domain: "acme.vc", identifiers: { linkedin: "dana-lee" } },
      memories: [
        { text: "Title: Partner", source: "LinkedIn", url: "https://x", tier: "A" },
        { text: "Education: MIT", source: "LinkedIn", tier: "B" },
      ],
      signals: [{ text: "FINRA disclosure on record", source: "FINRA", url: "https://finra" }],
    },
  };
}

test("maps subject+memories to one person proposal and each signal to its own", () => {
  const reqs = envelopeToProposeRequests(sampleEnvelope(), IDS);
  assert.equal(reqs.length, 2); // 1 person + 1 signal

  const person = reqs.find((r) => r.resourceType === "person")!;
  assert.equal(person.action, "write");
  assert.equal(person.workspaceId, IDS.workspaceId);
  assert.equal(person.actor.type, "agent");
  assert.equal(person.actor.id, IDS.intakeAgentId);
  assert.deepEqual(person.onBehalfOf, { type: "user", id: IDS.userId });
  assert.equal(person.skill, "stageMutation");
  assert.equal(person.dataScope, "public");
  const pInputs = person.inputs as { person: { name: string }; memories: unknown[] };
  assert.equal(pInputs.person.name, "Dana Lee");
  assert.equal(pInputs.memories.length, 2);

  const signal = reqs.find((r) => r.resourceType === "signal")!;
  assert.equal(signal.action, "write");
  assert.equal(signal.actor.id, IDS.intakeAgentId);
  const sInputs = signal.inputs as { text: string; source: string };
  assert.equal(sInputs.text, "FINRA disclosure on record");
  assert.equal(sInputs.source, "FINRA");
});

test("zero signals yields a single person proposal", () => {
  const env = sampleEnvelope();
  env.payload.signals = [];
  const reqs = envelopeToProposeRequests(env, IDS);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].resourceType, "person");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd platform && pnpm --filter @bridge/api build && node --test apps/api/dist/test/recon-intake.test.js`
Expected: FAIL — `Cannot find module '../src/intake/recon-envelope.js'`.

- [ ] **Step 3: Write the mapper**

```ts
// platform/apps/api/src/intake/recon-envelope.ts
// Maps Recon's CaptureEnvelope payload into governed propose-requests. Pure; no I/O.
// The subject + all its memories become ONE person:write proposal; each risk signal
// becomes its own signal:write proposal. Actor is the drafts-only INTAKE_AGENT acting
// on behalf of the pilot user, so every row lands as pending_review (draft-then-approve).
import type { UniversalActionPipeline } from "@bridge/core";

/** The propose-request shape, derived from the pipeline so we never drift from core. */
export type ProposeReq = Parameters<UniversalActionPipeline["propose"]>[0];

/** The subset of Recon's CaptureEnvelope this seam consumes (decoupled from Recon's types). */
export interface ReconEnvelope {
  contract: "recon.v1";
  dataScope: "public";
  payload: {
    person: { name: string; company: string; domain?: string; identifiers: Record<string, string> };
    memories: Array<{ text: string; source: string; url?: string; tier: "A" | "B" | "C" }>;
    signals: Array<{ text: string; source: string; url?: string }>;
  };
}

export interface ReconIntakeIdentities {
  workspaceId: string;
  intakeAgentId: string;
  userId: string;
}

export function envelopeToProposeRequests(env: ReconEnvelope, ids: ReconIntakeIdentities): ProposeReq[] {
  const base = {
    workspaceId: ids.workspaceId,
    actor: { type: "agent" as const, id: ids.intakeAgentId },
    onBehalfOf: { type: "user" as const, id: ids.userId },
    action: "write" as const,
    skill: "stageMutation",
    dataScope: "public" as const,
  };

  const personReq: ProposeReq = {
    ...base,
    resourceType: "person",
    inputs: { person: env.payload.person, memories: env.payload.memories },
  };

  const signalReqs: ProposeReq[] = env.payload.signals.map((s) => ({
    ...base,
    resourceType: "signal",
    inputs: { text: s.text, source: s.source, ...(s.url ? { url: s.url } : {}) },
  }));

  return [personReq, ...signalReqs];
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd platform && pnpm --filter @bridge/api build && node --test apps/api/dist/test/recon-intake.test.js`
Expected: PASS (2 tests). If `pnpm --filter @bridge/api build` errors on the `ProposeReq` type, confirm `UniversalActionPipeline` is exported from `@bridge/core` (it is — see `wiring.ts` import); no other change needed.

- [ ] **Step 5: Commit**

```bash
git add platform/apps/api/src/intake/recon-envelope.ts platform/apps/api/test/recon-intake.test.ts
git commit -m "feat(api): map Recon CaptureEnvelope to governed propose requests"
```

---

## Task 2: Export the pilot identity constants the route needs

**Files:**
- Modify: `platform/apps/api/src/wiring.ts` (the `PILOT_WORKSPACE`, `INTAKE_AGENT`, `PILOT_USER` consts near the top)

These are currently module-private. The route needs them. They are structural constants (not dummy data), already documented as such in `wiring.ts`.

- [ ] **Step 1: Add `export` to the three constants**

Change in `platform/apps/api/src/wiring.ts`:

```ts
// before:
const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
const EGRESS_AGENT = "b0000000-0000-4000-a000-0000000000e1";
const INTAKE_AGENT = "b0000000-0000-4000-a000-0000000000e2";
const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";

// after (only these three gain `export`; leave OUTREACH_AGENT / EGRESS_AGENT as-is):
export const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
const EGRESS_AGENT = "b0000000-0000-4000-a000-0000000000e1";
export const INTAKE_AGENT = "b0000000-0000-4000-a000-0000000000e2";
export const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";
```

- [ ] **Step 2: Verify it still builds**

Run: `cd platform && pnpm --filter @bridge/api build`
Expected: success, no type errors.

- [ ] **Step 3: Commit**

```bash
git add platform/apps/api/src/wiring.ts
git commit -m "refactor(api): export pilot identity constants for the intake route"
```

---

## Task 3: The Fastify intake route

**Files:**
- Create: `platform/apps/api/src/intake/recon-route.ts`
- Test: `platform/apps/api/test/recon-intake.test.ts` (append integration tests)

The route validates the shared secret, zod-parses the envelope, builds a per-request `RunCtx` exactly like `context.ts` does, and calls `pipeline.propose` for each mapped request. In local/in-memory mode `seedGovernance()` authorizes `INTAKE_AGENT`, so proposals land as `pending_review` ledger rows.

- [ ] **Step 1: Write the failing integration tests** (append to the test file)

```ts
// append to platform/apps/api/test/recon-intake.test.ts
import { buildServer } from "../src/server.js";

const SECRET = "test-secret";

test("route rejects a missing/wrong secret with 401", async () => {
  process.env.RECON_SHARED_SECRET = SECRET;
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/intake/recon",
    headers: { "content-type": "application/json" },
    payload: sampleEnvelope(),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("route accepts a valid envelope and returns proposalIds", async () => {
  process.env.RECON_SHARED_SECRET = SECRET;
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/intake/recon",
    headers: { "content-type": "application/json", "x-recon-secret": SECRET },
    payload: sampleEnvelope(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; proposalIds: string[] };
  assert.equal(body.ok, true);
  assert.equal(body.proposalIds.length, 2); // 1 person + 1 signal
  await app.close();
});

test("route 400s on a malformed envelope", async () => {
  process.env.RECON_SHARED_SECRET = SECRET;
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/intake/recon",
    headers: { "content-type": "application/json", "x-recon-secret": SECRET },
    payload: { contract: "recon.v1", dataScope: "public", payload: { person: { name: "x" } } },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd platform && pnpm --filter @bridge/api build && node --test apps/api/dist/test/recon-intake.test.js`
Expected: FAIL — route returns 404 (not registered yet), so the 401/200 assertions fail.

- [ ] **Step 3: Write the route**

```ts
// platform/apps/api/src/intake/recon-route.ts
// POST /intake/recon — Recon's CaptureEnvelope intake. addToBridge() posts the envelope
// as raw JSON (not tRPC-wrapped), so this is a plain Fastify route. It maps the envelope to
// governed propose-requests and runs each through the pipeline → pending_review ledger rows.
import type { FastifyInstance } from "fastify";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { z } from "zod";
import type { Wiring } from "../wiring.js";
import { PILOT_WORKSPACE, INTAKE_AGENT, PILOT_USER } from "../wiring.js";
import { envelopeToProposeRequests } from "./recon-envelope.js";

const envelopeSchema = z.object({
  contract: z.literal("recon.v1"),
  dataScope: z.literal("public"),
  payload: z.object({
    person: z.object({
      name: z.string().min(1),
      company: z.string(),
      domain: z.string().optional(),
      identifiers: z.record(z.string()),
    }),
    memories: z.array(
      z.object({ text: z.string(), source: z.string(), url: z.string().optional(), tier: z.enum(["A", "B", "C"]) }),
    ),
    signals: z.array(z.object({ text: z.string(), source: z.string(), url: z.string().optional() })),
  }),
});

function newRunCtx(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(clock.nowMs() >>> 0);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

export function registerReconIntakeRoute(app: FastifyInstance, wiring: Wiring): void {
  app.post("/intake/recon", async (req, reply) => {
    const secret = process.env.RECON_SHARED_SECRET;
    const provided = req.headers["x-recon-secret"];
    if (!secret || provided !== secret) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid envelope", issues: parsed.error.issues });
    }

    const requests = envelopeToProposeRequests(
      { ...parsed.data },
      { workspaceId: PILOT_WORKSPACE, intakeAgentId: INTAKE_AGENT, userId: PILOT_USER },
    );

    const proposalIds: string[] = [];
    for (const r of requests) {
      const proposal = await wiring.pipeline.propose(r, newRunCtx());
      proposalIds.push(proposal.id);
    }
    return reply.code(200).send({ ok: true, proposalIds });
  });
}
```

- [ ] **Step 4: Register the route in the server**

In `platform/apps/api/src/server.ts`, add the import and call it right after the Google OAuth routes:

```ts
// add near the other imports:
import { registerReconIntakeRoute } from "./intake/recon-route.js";

// inside buildServer(), after `await registerGoogleOAuthRoutes(app, wiring);`:
registerReconIntakeRoute(app, wiring);
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `cd platform && pnpm --filter @bridge/api build && node --test apps/api/dist/test/recon-intake.test.js`
Expected: PASS (all 5 tests). If `proposal.id` is undefined, inspect the `Proposal` type in `packages/core/src/types.ts:133` and use its id field name (it is the ledger row id); update both the route and the assertion to match.

- [ ] **Step 6: Commit**

```bash
git add platform/apps/api/src/intake/recon-route.ts platform/apps/api/src/server.ts platform/apps/api/test/recon-intake.test.ts
git commit -m "feat(api): add POST /intake/recon governed intake route"
```

---

## Task 4: Full-suite regression (blast-radius check)

- [ ] **Step 1: Build + run the whole API test suite**

Run: `cd platform && pnpm --filter @bridge/api build && node --test apps/api/dist/test/*.test.js`
Expected: PASS — the new tests plus the existing `social.test.ts` all green. If `social.test.ts` regressed, the route registration or constant exports broke something; fix before proceeding.

- [ ] **Step 2: Typecheck the workspace**

Run: `cd platform && pnpm -r typecheck`
Expected: green across all packages.

- [ ] **Step 3: Commit (only if fixes were needed; otherwise skip)**

```bash
git add -A && git commit -m "test(api): keep full suite green after intake route"
```

---

## Task 5: Recon side — point at the intake URL + flush the stranded outbox

**Files:**
- Modify: `Tools/recon/lib/bridge.ts` (add `flushOutbox`)
- Modify: `Tools/recon/app/page.tsx` (call it after a successful add)

`addToBridge()` already posts to `NEXT_PUBLIC_BRIDGE_INTAKE_URL` when set. The only gap is the items already stranded in the `localStorage` outbox while the URL was unset. Add a flush that re-posts them.

- [ ] **Step 1: Add `flushOutbox` to `Tools/recon/lib/bridge.ts`**

Append (it reuses the existing `loadOutbox` + the `OUTBOX_KEY` already defined in the file):

```ts
// Re-post any envelopes stranded in the outbox (captured while the intake URL was unset).
// Returns how many were delivered. Successfully delivered items are removed from the outbox.
export async function flushOutbox(): Promise<{ delivered: number; remaining: number }> {
  const intakeUrl = process.env.NEXT_PUBLIC_BRIDGE_INTAKE_URL;
  if (!intakeUrl) return { delivered: 0, remaining: loadOutbox().length };
  const pending = loadOutbox();
  const stillStuck: CaptureEnvelope[] = [];
  let delivered = 0;
  for (const env of pending) {
    const r = await addToBridge(env);
    if (r.ok && r.sink === "intake_url") delivered++;
    else stillStuck.push(env);
  }
  if (typeof window !== "undefined") localStorage.setItem(OUTBOX_KEY, JSON.stringify(stillStuck));
  return { delivered, remaining: stillStuck.length };
}
```

- [ ] **Step 2: Call it after a successful add in `Tools/recon/app/page.tsx`**

Find the existing `addToBridge(...)` call site (it powers the "Add to Bridge" button). Immediately after a successful add, fire-and-forget a flush so backlog drains without blocking the UI:

```ts
// after the line that awaits/handles a successful addToBridge(...) result:
import { flushOutbox } from "@/lib/bridge"; // ensure imported at top
// ...
void flushOutbox().catch(() => {}); // drain any backlog; non-blocking, best-effort
```

- [ ] **Step 3: Verify Recon builds**

Run: `cd Tools/recon && npm run build`
Expected: Next.js build succeeds.

- [ ] **Step 4: Commit**

```bash
git add Tools/recon/lib/bridge.ts Tools/recon/app/page.tsx
git commit -m "feat(recon): flush stranded Bridge outbox once intake URL is configured"
```

---

## Task 6: Prove the end-to-end flow locally (no deploy yet)

This is the spec's "provable locally before any deploy" gate. Run the platform API in-memory and Recon locally, and watch a real report become Approvals.

- [ ] **Step 1: Start the platform API in local/in-memory mode (governance auto-seeded)**

```bash
cd platform && pnpm --filter @bridge/api build
RECON_SHARED_SECRET=local-secret PORT=4000 node apps/api/dist/src/server.js
```
Expected: `bridge-api listening at http://0.0.0.0:4000`. (No `DATABASE_URL` → in-memory ledger + `seedGovernance()` authorizes `INTAKE_AGENT`.)

- [ ] **Step 2: Smoke-test the route directly with curl**

```bash
curl -s -X POST http://localhost:4000/intake/recon \
  -H 'content-type: application/json' -H 'x-recon-secret: local-secret' \
  -d '{"contract":"recon.v1","dataScope":"public","payload":{"person":{"name":"Dana Lee","company":"Acme","identifiers":{}},"memories":[],"signals":[{"text":"FINRA disclosure","source":"FINRA"}]}}'
```
Expected: `{"ok":true,"proposalIds":["...","..."]}` (2 ids). A 401 means the secret header is wrong; a 400 means the payload shape is off.

- [ ] **Step 3: Run Recon against it**

```bash
cd Tools/recon
printf 'NEXT_PUBLIC_BRIDGE_INTAKE_URL=http://localhost:4000/intake/recon\nNEXT_PUBLIC_BRIDGE_INTAKE_SECRET=local-secret\n' >> .env.local
npm run dev   # http://localhost:3000 (or :3001 per README)
```
Note: `addToBridge()` reads `NEXT_PUBLIC_BRIDGE_INTAKE_URL` but does NOT currently send the secret header. Add the header in `addToBridge` (small follow-on in `lib/bridge.ts`): include `'x-recon-secret': process.env.NEXT_PUBLIC_BRIDGE_INTAKE_SECRET ?? ''` in the `fetch` headers. Commit that one-line change with message `feat(recon): send shared secret on Bridge intake`.

- [ ] **Step 4: Run a report and click "Add to Bridge"; confirm proposals**

In the Recon UI, run any report, click "Add to Bridge". The API console logs a `propose` per request. Because this run is in-memory, the proposals live in the API process (not Supabase) — this step proves the wire; persistence is Task 8. Expected: the curl-equivalent `{ ok: true }` path, no errors in the API log.

- [ ] **Step 5: Commit any fixups made during this task**

```bash
git add -A && git commit -m "fix(recon): wire intake secret header end-to-end" # only if changes were made
```

---

## Task 7: Containerize both apps for Fly.io

**Files:**
- Create: `platform/apps/api/Dockerfile`, `platform/apps/api/fly.toml`
- Create: `Tools/recon/Dockerfile`, `Tools/recon/fly.toml`

- [ ] **Step 1: Platform API Dockerfile** (`platform/apps/api/Dockerfile`)

Build the pnpm workspace and run the compiled server. Build context is the `platform/` root (the workspace).

```dockerfile
# platform/apps/api/Dockerfile — build from the platform/ workspace root:
#   docker build -f apps/api/Dockerfile -t bridge-api .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build
FROM node:20-slim
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
```

- [ ] **Step 2: Platform API `fly.toml`** (`platform/apps/api/fly.toml`)

```toml
app = "bridge-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false   # always-on
  min_machines_running = 1

[[http_service.checks]]
  path = "/health"
  interval = "15s"
  timeout = "2s"
```

- [ ] **Step 3: Recon Dockerfile** (`Tools/recon/Dockerfile`) — standalone Next.js, data dir on a volume

```dockerfile
# Tools/recon/Dockerfile — build context is Tools/recon/
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build
FROM node:20-slim
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3000
EXPOSE 3000
# data/ is the JSONL store — mounted from a Fly volume (see fly.toml) so it persists.
CMD ["npm", "run", "start"]
```

Note: confirm `Tools/recon/package.json` has a `start` script (`next start -p ${PORT:-3000}`); if missing, add it and commit with the Dockerfile.

- [ ] **Step 4: Recon `fly.toml` with a persistent volume** (`Tools/recon/fly.toml`)

```toml
app = "bridge-recon"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

[[mounts]]
  source = "recon_data"
  destination = "/app/data"   # Recon's JSONL store survives restarts
```

- [ ] **Step 5: Commit**

```bash
git add platform/apps/api/Dockerfile platform/apps/api/fly.toml Tools/recon/Dockerfile Tools/recon/fly.toml
git commit -m "build: Fly.io Dockerfiles + configs for bridge-api and bridge-recon"
```

---

## Task 8: Persistent-mode governance seeding (Supabase) — REQUIRED before the API can write proposals in prod

**Why:** in `wiring.ts`, `seedGovernance()` runs **only** in the in-memory branch. With `DATABASE_URL` set, authority resolves from the Drizzle governance tables. If the intake agent's grants aren't in the DB, `pipeline.propose` is **denied** and no proposals appear. This task makes the prod DB grant exactly what `seedGovernance()` grants in memory.

**This is an inspection-first task** (the only one): the exact rows depend on the live schema + what governance hardening already seeded on 2026-06-22.

- [ ] **Step 1: Read the persistent governance query logic**

Read `platform/packages/db/src/governance-stores.ts` (`directGrants` at line ~75, `assumedRole` at ~104) and `platform/packages/db/src/schema.ts` (`agents` ~385, `roles` ~473, `rolePermissions` ~481, `permissions` ~499, `delegations` ~538, `workspaceMembers`). Determine the exact tables/columns that back: an agent's assumed role + scope, a role's grants, and a user's direct grants.

- [ ] **Step 2: Check what already exists in the live Supabase project**

Using the Supabase MCP (`list_tables`, `execute_sql`), query the `agents`, `roles`, `role_permissions`, `permissions` rows for workspace `b0000000-0000-4000-a000-000000000001`. Determine whether `INTAKE_AGENT` (`b0000000-...e2`), `role-intake`, and `PILOT_USER` direct grants already exist (governance hardening may have seeded them).

- [ ] **Step 3: Insert the missing grants to match `seedGovernance()`**

The target authorization (copied verbatim from `wiring.ts` `seedGovernance`) that MUST hold in the DB:
- Agent `b0000000-...e2` assumes role `role-intake`, scope `["touchpoint:write","signal:write","person:write"]`.
- `role-intake` grants: `touchpoint:write`, `signal:write`, `person:write` (all `effect=allow`, `resourceId=null`).
- User `e0f0053b-fc44-476e-be27-1371e179e958` direct grants include `person:write` and `signal:write` (the on-behalf-of principal must also hold the authority — intersection rule).

Write the `INSERT … ON CONFLICT DO NOTHING` statements against the real tables found in Step 1 and apply them via `apply_migration` (Supabase MCP). Use real uuids for any permission/role-permission ids.

- [ ] **Step 4: Verify authorization with a persistent-mode propose**

Run the API locally but bound to Supabase:
```bash
cd platform/apps/api
DATABASE_URL='<supabase-postgres-url>' RECON_SHARED_SECRET=local-secret PORT=4000 node dist/src/server.js
```
Re-run the Task 6 Step 2 curl. Expected: `{ ok: true, proposalIds: [...] }` AND a new `pending_review` row in the Supabase `ledger`. A denial (proposal rejected / authority error) means a grant from Step 3 is missing — fix and retry.

- [ ] **Step 5: Confirm it surfaces in the web Approvals UI**

Open the deployed Bridge web app (`bridge-ai-1ay.pages.dev`). The Approvals page reads the same Supabase `ledger` via `loadLedger()`. Expected: the two proposals appear as pending Signals/Person. Approve one → a decision row is written; reject one → excluded.

- [ ] **Step 6: Commit the migration**

```bash
git add platform/packages/db/migrations/  # or wherever migrations live; include the new seed migration
git commit -m "feat(db): seed role-intake authorization for Recon governed intake"
```

---

## Task 9: Deploy both apps always-on + configure Recon secrets

- [ ] **Step 1: Deploy the platform API**

```bash
cd platform
fly launch --no-deploy --copy-config --name bridge-api   # if app not yet created
fly secrets set -a bridge-api \
  DATABASE_URL='<supabase-postgres-url>' \
  RECON_SHARED_SECRET='<generate a strong secret>' \
  BRIDGE_PILOT_USER_ID='e0f0053b-fc44-476e-be27-1371e179e958'
fly deploy -a bridge-api --dockerfile apps/api/Dockerfile .
```
Expected: `/health` returns `{ ok: true }` at the bridge-api URL. Record the URL.

- [ ] **Step 2: Create Recon's volume and deploy it**

```bash
cd Tools/recon
fly launch --no-deploy --copy-config --name bridge-recon
fly volumes create recon_data -a bridge-recon --region iad --size 1
fly secrets set -a bridge-recon \
  SUPABASE_URL='<supabase-url>' \
  SUPABASE_SERVICE_KEY='<supabase-service-key>' \
  BRIDGE_WORKSPACE_ID='b0000000-0000-4000-a000-000000000001' \
  NEXT_PUBLIC_BRIDGE_INTAKE_URL='https://bridge-api.fly.dev/intake/recon' \
  NEXT_PUBLIC_BRIDGE_INTAKE_SECRET='<same secret as RECON_SHARED_SECRET>'
fly deploy -a bridge-recon
```
Note: `NEXT_PUBLIC_*` vars are inlined at build time by Next.js — they must be present during `fly deploy`'s build. If Fly builds remotely without secrets at build time, pass them as build args/`[build.args]` in `fly.toml` instead, or bake via `--build-arg`. Verify the deployed Recon's network tab shows the intake URL, not localhost.

- [ ] **Step 3: Update the extension's backend URL (carried from the deferred extension spec, minimal version)**

In `Tools/recon/extension/src/popup.ts` and `src/background.ts`, the hardcoded `const RECON_URL = 'http://localhost:3001'` → set to the deployed Recon URL `https://bridge-recon.fly.dev`. Update `manifest.json` `host_permissions` to include `https://bridge-recon.fly.dev/*`. Rebuild: `cd Tools/recon/extension && npm run build`. (Full configurable-URL UI is the separate deferred extension spec; this is the minimal redirect so the extension talks to the deployment.)

- [ ] **Step 4: Full end-to-end verification on the deployment**

With NO local server running: open deployed Recon → run a report → "Add to Bridge". Then open the Bridge web Approvals → confirm the Signals/Person proposals appear. Separately, capture a LinkedIn profile via the extension → confirm a `people_canonical` row in Supabase. Restart both Fly apps → confirm Recon's staging persists (volume) and the flow still works.

- [ ] **Step 5: Commit deploy/config changes**

```bash
git add Tools/recon/extension/ Tools/recon/package.json
git commit -m "build: point Recon extension at the bridge-recon deployment"
```

---

## Task 10: Docs + known-issues (project protocol)

- [ ] **Step 1: ADR**

Append to `docs/raw/decisions-log.md`: the separate-but-integrated decision; Fly.io chosen for Recon (filesystem JSONL store needs a volume — serverless rejected); intake implemented as a Fastify route (not tRPC) because `addToBridge` posts raw JSON; the two-write-patterns rationale (extension→`capture_profile`/`people_canonical` vs report→`/intake/recon`→governed `ledger`).

- [ ] **Step 2: Known-issues + wiki + log**

In `docs/wiki/known-issues.md`: mark the Recon→Bridge intake gap RESOLVED (date 2026-06-24) with the cause (unwired `addToBridge` + missing endpoint). Note the remaining follow-on: Recon's `/api/store/*` OSINT JSONL features still assume a filesystem (now satisfied by the Fly volume; a Supabase migration remains optional future work). Update `docs/wiki/index.md` if it enumerates the Recon integration. Append a `docs/log.md` entry.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: record Recon intake hop + Fly deploy decisions and resolved issue"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Part A (deploy + Supabase keys) → Tasks 7–9; Part B (intake hop) → Tasks 1–6, 8. Web Approvals display → Task 8 Step 5. Shared-secret gate → Task 3 + Task 6 Step 3. Filesystem-store host decision → Task 7/9 (volume).
- **Known sharp edges flagged inline:** `proposal.id` field name (Task 3 Step 5), `NEXT_PUBLIC_*` build-time inlining (Task 9 Step 2), the secret header not yet sent by `addToBridge` (Task 6 Step 3), persistent governance seeding being inspection-first (Task 8).
- **Out of scope (separate specs):** full configurable-URL extension UI + LinkedIn connection-send (deferred extension spec); monorepo unification (shelved program); migrating Recon's JSONL store to Supabase.
