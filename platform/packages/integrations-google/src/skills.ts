/**
 * Pipeline Skills for the Google integration. Skills run at propose() time
 * (BEFORE the review gate), so they must never perform irreversible egress:
 *
 *   - Source skills (external:fetch) READ from Google and CACHE raw bodies to the
 *     LOCAL BodyStore (capture ≠ commit; bodies are private, local-only). Their
 *     proposedOutput is a light manifest — the audit trail rides the LOCAL ledger.
 *   - Stage skill echoes a typed local-graph directive for review (touchpoint /
 *     memory / signal / person). Materialization happens post-approval.
 *   - Compose skills VALIDATE an outbound envelope and return it as a draft —
 *     they DO NOT send. The real send/create runs in the EgressExecutor only after
 *     a human approves the external:send proposal (>= L2).
 */
import type { Skill } from "@bridge/core";
import type { BodyStore } from "@bridge/local";
import { CALENDAR_SOURCE, GMAIL_SOURCE, type SendEmailEnvelope, type CreateEventEnvelope } from "./contracts.js";
import type { GoogleGatewayFactory } from "./gateway.js";

export const SKILL_SOURCE_GMAIL = "google.sourceGmail";
export const SKILL_SOURCE_CALENDAR = "google.sourceCalendar";
export const SKILL_STAGE = "google.stage";
export const SKILL_COMPOSE_EMAIL = "google.composeEmail";
export const SKILL_COMPOSE_EVENT = "google.composeEvent";

export interface GoogleSkillDeps {
  gateways: GoogleGatewayFactory;
  bodies: BodyStore;
}

interface SourceGmailInputs {
  integrationId: string;
  workspaceId: string;
  maxResults?: number;
  query?: string;
}
interface SourceCalendarInputs {
  integrationId: string;
  workspaceId: string;
  maxResults?: number;
  timeMin?: string;
}
interface ComposeEmailInputs {
  integrationId: string;
  envelope: SendEmailEnvelope;
  display?: unknown;
}
interface ComposeEventInputs {
  integrationId: string;
  envelope: CreateEventEnvelope;
  display?: unknown;
}

function sourceGmailSkill(deps: GoogleSkillDeps): Skill {
  return {
    name: SKILL_SOURCE_GMAIL,
    async run(inputs, ctx) {
      const i = inputs as SourceGmailInputs;
      const gw = await deps.gateways.forIntegration(i.integrationId);
      const { threads } = await gw.fetchThreads({
        ...(i.maxResults ? { maxResults: i.maxResults } : {}),
        ...(i.query ? { query: i.query } : {}),
      });
      // Capture raw private bodies to the LOCAL plane (inert until adopted).
      for (const t of threads) {
        await deps.bodies.put({
          workspaceId: i.workspaceId,
          source: GMAIL_SOURCE,
          sourceRecordId: t.threadId,
          dataScope: "private",
          content: t,
          capturedAt: ctx.clock.nowISO(),
        });
      }
      const manifest = threads.map((t) => ({
        threadId: t.threadId,
        subject: t.subject,
        participants: t.participants.map((p) => p.email),
        snippet: t.snippet,
        lastMessageAt: t.lastMessageAt,
      }));
      return {
        proposedOutput: { source: GMAIL_SOURCE, count: threads.length, threads: manifest },
        diff: { capturedToLocal: threads.length },
      };
    },
  };
}

function sourceCalendarSkill(deps: GoogleSkillDeps): Skill {
  return {
    name: SKILL_SOURCE_CALENDAR,
    async run(inputs, ctx) {
      const i = inputs as SourceCalendarInputs;
      const gw = await deps.gateways.forIntegration(i.integrationId);
      const { events } = await gw.fetchEvents({
        ...(i.maxResults ? { maxResults: i.maxResults } : {}),
        ...(i.timeMin ? { timeMin: i.timeMin } : {}),
      });
      for (const e of events) {
        await deps.bodies.put({
          workspaceId: i.workspaceId,
          source: CALENDAR_SOURCE,
          sourceRecordId: e.eventId,
          dataScope: "private",
          content: e,
          capturedAt: ctx.clock.nowISO(),
        });
      }
      const manifest = events.map((e) => ({
        eventId: e.eventId,
        summary: e.summary,
        attendees: e.attendees.map((a) => a.email),
        start: e.start,
        end: e.end,
      }));
      return {
        proposedOutput: { source: CALENDAR_SOURCE, count: events.length, events: manifest },
        diff: { capturedToLocal: events.length },
      };
    },
  };
}

/** Pure echo — stages a typed local-graph directive for human review. */
const stageSkill: Skill = {
  name: SKILL_STAGE,
  async run(inputs) {
    const display = (inputs as { display?: unknown })?.display;
    return { proposedOutput: inputs, ...(display ? { diff: display } : {}) };
  },
};

function composeEmailSkill(): Skill {
  return {
    name: SKILL_COMPOSE_EMAIL,
    async run(inputs) {
      const i = inputs as ComposeEmailInputs;
      // Validate only — NEVER send here (propose() runs before approval).
      if (!i?.envelope || !Array.isArray(i.envelope.to) || i.envelope.to.length === 0) {
        throw new Error("composeEmail: envelope.to is required");
      }
      if (!i.envelope.subject && !i.envelope.bodyText) {
        throw new Error("composeEmail: subject or body is required");
      }
      return {
        proposedOutput: { integrationId: i.integrationId, envelope: i.envelope, egressKind: "email.draft" },
        diff: { to: i.envelope.to, subject: i.envelope.subject },
      };
    },
  };
}

function composeEventSkill(): Skill {
  return {
    name: SKILL_COMPOSE_EVENT,
    async run(inputs) {
      const i = inputs as ComposeEventInputs;
      if (!i?.envelope || !i.envelope.summary || !i.envelope.start || !i.envelope.end) {
        throw new Error("composeEvent: summary, start and end are required");
      }
      return {
        proposedOutput: { integrationId: i.integrationId, envelope: i.envelope, egressKind: "calendar.create" },
        diff: { summary: i.envelope.summary, start: i.envelope.start, end: i.envelope.end },
      };
    },
  };
}

/** All Google skills, ready to register in the pipeline's SkillRegistry. */
export function googleSkills(deps: GoogleSkillDeps): Skill[] {
  return [
    sourceGmailSkill(deps),
    sourceCalendarSkill(deps),
    stageSkill,
    composeEmailSkill(),
    composeEventSkill(),
  ];
}
