/**
 * Pipeline Skills for the Google integration. Skills run at propose() time
 * (BEFORE the review gate), so they must never perform irreversible egress:
 *
 *   - Source skills (external:fetch) READ from Google and CACHE raw bodies to the
 *     LOCAL BodyStore (capture ≠ commit; bodies are private, local-only). Their
 *     proposedOutput is a light manifest — the audit trail rides the LOCAL ledger.
 *   - Stage skill echoes a typed local-graph directive for review (Event /
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
/** Read-only projection: fetch full Calendar events for DISPLAY (no caching, no
 * Event proposals). Distinct from sourceCalendar, which feeds the graph. */
export const SKILL_LIST_CALENDAR = "google.listCalendarEvents";
export const SKILL_STAGE = "google.stage";
export const SKILL_COMPOSE_EMAIL = "google.composeEmail";
export const SKILL_COMPOSE_EVENT = "google.composeEvent";
export const SKILL_COMPOSE_UPDATE_EVENT = "google.composeUpdateEvent";
export const SKILL_COMPOSE_DELETE_EVENT = "google.composeDeleteEvent";

export interface GoogleSkillDeps {
  gateways: GoogleGatewayFactory;
  bodies: BodyStore;
}

interface SourceGmailInputs {
  integrationId: string;
  organizationId: string;
  maxResults?: number;
  query?: string;
}
interface SourceCalendarInputs {
  integrationId: string;
  organizationId: string;
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
}
interface ComposeEmailInputs {
  integrationId: string;
  envelope: SendEmailEnvelope;
  display?: unknown;
}
interface ListCalendarInputs {
  integrationId: string;
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
}
interface ComposeEventInputs {
  integrationId: string;
  envelope: CreateEventEnvelope;
  display?: unknown;
}
interface ComposeUpdateEventInputs {
  integrationId: string;
  envelope: Partial<CreateEventEnvelope> & { eventId: string };
  display?: unknown;
}
interface ComposeDeleteEventInputs {
  integrationId: string;
  eventId: string;
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
          organizationId: i.organizationId,
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
        ...(i.timeMax ? { timeMax: i.timeMax } : {}),
      });
      for (const e of events) {
        await deps.bodies.put({
          organizationId: i.organizationId,
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

/**
 * Read-only projection for the Calendar surface: fetch FULL events for display.
 * Unlike sourceCalendar it does not cache bodies or propose Events — it just
 * returns events. Still an external:fetch (gated); the user's own view authorizes it.
 */
function listCalendarSkill(deps: GoogleSkillDeps): Skill {
  return {
    name: SKILL_LIST_CALENDAR,
    async run(inputs) {
      const i = inputs as ListCalendarInputs;
      const gw = await deps.gateways.forIntegration(i.integrationId);
      const { events } = await gw.fetchEvents({
        ...(i.maxResults ? { maxResults: i.maxResults } : {}),
        ...(i.timeMin ? { timeMin: i.timeMin } : {}),
        ...(i.timeMax ? { timeMax: i.timeMax } : {}),
      });
      return {
        proposedOutput: { source: CALENDAR_SOURCE, count: events.length, events },
        diff: { listed: events.length },
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

function composeUpdateEventSkill(): Skill {
  return {
    name: SKILL_COMPOSE_UPDATE_EVENT,
    async run(inputs) {
      const i = inputs as ComposeUpdateEventInputs;
      if (!i?.envelope || !i.envelope.eventId) {
        throw new Error("composeUpdateEvent: envelope.eventId is required");
      }
      const { eventId, summary, description, start, end, location, attendees } = i.envelope;
      if (
        summary === undefined &&
        description === undefined &&
        start === undefined &&
        end === undefined &&
        location === undefined &&
        attendees === undefined
      ) {
        throw new Error("composeUpdateEvent: at least one field to change is required");
      }
      return {
        proposedOutput: { integrationId: i.integrationId, envelope: i.envelope, egressKind: "calendar.update" },
        diff: { eventId, ...(summary ? { summary } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) },
      };
    },
  };
}

function composeDeleteEventSkill(): Skill {
  return {
    name: SKILL_COMPOSE_DELETE_EVENT,
    async run(inputs) {
      const i = inputs as ComposeDeleteEventInputs;
      if (!i?.eventId) {
        throw new Error("composeDeleteEvent: eventId is required");
      }
      return {
        proposedOutput: { integrationId: i.integrationId, envelope: { eventId: i.eventId }, egressKind: "calendar.delete" },
        diff: { eventId: i.eventId, action: "delete" },
      };
    },
  };
}

/** All Google skills, ready to register in the pipeline's SkillRegistry. */
export function googleSkills(deps: GoogleSkillDeps): Skill[] {
  return [
    sourceGmailSkill(deps),
    sourceCalendarSkill(deps),
    listCalendarSkill(deps),
    stageSkill,
    composeEmailSkill(),
    composeEventSkill(),
    composeUpdateEventSkill(),
    composeDeleteEventSkill(),
  ];
}
