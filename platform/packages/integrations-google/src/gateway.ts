/**
 * GoogleGateway — the EGRESS adapter port. It is the ONLY thing that touches the
 * Google internet APIs; everything upstream goes through the pipeline/gate. A
 * gateway instance is bound to one integration's OAuth tokens.
 *
 * One adapter binds this port: GoogleApiGateway (gateway-google.ts) — real
 * googleapis. There is NO fake/dummy gateway: the platform sources only real data.
 * When Google is not configured, `MissingGoogleGatewayFactory` fails closed.
 */
import type {
  CreateDraftResult,
  CreateEventEnvelope,
  CreateEventResult,
  FetchEventsOpts,
  FetchEventsResult,
  FetchThreadsOpts,
  FetchThreadsResult,
  SendEmailEnvelope,
} from "./contracts.js";

export interface GoogleGateway {
  fetchThreads(opts: FetchThreadsOpts): Promise<FetchThreadsResult>;
  fetchEvents(opts: FetchEventsOpts): Promise<FetchEventsResult>;
  /** Compose a Gmail DRAFT (never auto-sends). Runs only after >= L2 approval. */
  createDraft(envelope: SendEmailEnvelope): Promise<CreateDraftResult>;
  createEvent(envelope: CreateEventEnvelope): Promise<CreateEventResult>;
  updateEvent(eventId: string, envelope: Partial<CreateEventEnvelope>): Promise<CreateEventResult>;
  /** Delete an event by provider id. Runs only after >= L2 approval. */
  deleteEvent(eventId: string): Promise<CreateEventResult>;
}

/** Resolves the gateway for a given integration (loads + refreshes its tokens). */
export interface GoogleGatewayFactory {
  forIntegration(integrationId: string): Promise<GoogleGateway>;
}

/**
 * Fail-closed factory used when Google OAuth is not configured. No fake data — any
 * attempt to reach Google errors clearly instead of silently serving fabricated
 * content. The rest of the API (pipeline, agents, rituals) still runs.
 */
export class MissingGoogleGatewayFactory implements GoogleGatewayFactory {
  async forIntegration(_integrationId: string): Promise<GoogleGateway> {
    throw new Error(
      "google: integration not configured — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (no fake gateway; the platform sources only real data)",
    );
  }
}
