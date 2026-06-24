// platform/apps/api/src/intake/recon-route.ts
// POST /intake/recon — Recon's CaptureEnvelope intake. addToBridge() posts the envelope
// as raw JSON (not tRPC-wrapped), so this is a plain Fastify route. It maps the envelope to
// governed propose-requests and runs each through the pipeline → pending_review ledger rows.
import type { FastifyInstance } from "fastify";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { z } from "zod";
import type { Wiring } from "../wiring.js";
import { PILOT_WORKSPACE, INTAKE_AGENT, PILOT_USER } from "../wiring.js";
import { envelopeToProposeRequests, type ReconEnvelope } from "./recon-envelope.js";

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

    // parsed.data is shape-validated; zod's `.optional()` widens optionals to
    // `T | undefined`, which `exactOptionalPropertyTypes` rejects against the
    // contract's `domain?: T`. The validated shape is structurally a ReconEnvelope.
    const requests = envelopeToProposeRequests(
      parsed.data as ReconEnvelope,
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
