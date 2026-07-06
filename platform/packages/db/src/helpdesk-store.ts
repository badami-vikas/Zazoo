/**
 * DrizzleHelpdeskStore — Helpdesk's ticket + message persistence, including the
 * public/unauthenticated submitter path (frontend-migration-scoping.md gap #3).
 *
 * No new Actor type or identity-resolution change was needed for the anonymous
 * side (see docs/raw/decisions-log.md): a submitter's ONLY credential is
 * possession of `accessToken`, an opaque unguessable string returned once at
 * ticket creation — the same trust model as a password-reset link. The public
 * methods below (`createTicket`, `getTicketByToken`, `replyByToken`) never
 * consult a caller identity at all; the internal/agent methods
 * (`listTickets`/`getTicket`/`replyAsAgent`) are workspace-authenticated like
 * every other CRUD store here.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, count } from "drizzle-orm";
import type { Database } from "./client.js";
import { helpdeskTickets, helpdeskMessages } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export type TicketRow = typeof helpdeskTickets.$inferSelect;
export type MessageRow = typeof helpdeskMessages.$inferSelect;

function generateAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

export class DrizzleHelpdeskStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /** Public: anyone with the workspace's helpdesk link may open a ticket. Returns
   * the access token ONCE — the caller (frontend) is responsible for showing it
   * to the submitter, the same as a one-time signup confirmation link. */
  async createTicket(input: {
    workspaceId: string;
    subject: string;
    submitterEmail: string;
    submitterName?: string;
    body: string;
  }): Promise<{ ticket: TicketRow; message: MessageRow }> {
    const ticketId = randomUUID();
    const accessToken = generateAccessToken();
    const [ticket] = await this.#db
      .insert(helpdeskTickets)
      .values({
        id: ticketId,
        workspaceId: input.workspaceId,
        subject: input.subject,
        submitterEmail: input.submitterEmail,
        ...(input.submitterName ? { submitterName: input.submitterName } : {}),
        accessToken,
      })
      .returning();
    const [message] = await this.#db
      .insert(helpdeskMessages)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        ticketId,
        authorType: "submitter",
        body: input.body,
      })
      .returning();
    return { ticket: ticket!, message: message! };
  }

  /** Public: fetch a ticket + its messages by access token. Returns null for any
   * unknown token rather than distinguishing "wrong token" from "no such ticket"
   * — both must look identical to an unauthenticated caller. */
  async getTicketByToken(accessToken: string): Promise<{ ticket: TicketRow; messages: MessageRow[] } | null> {
    const rows = await this.#db.select().from(helpdeskTickets).where(eq(helpdeskTickets.accessToken, accessToken)).limit(1);
    const ticket = rows[0];
    if (!ticket) return null;
    const messages = await this.#db
      .select()
      .from(helpdeskMessages)
      .where(eq(helpdeskMessages.ticketId, ticket.id))
      .orderBy(asc(helpdeskMessages.createdAt));
    return { ticket, messages };
  }

  /** Public: the submitter replies to their own ticket, proven by token possession. */
  async replyByToken(accessToken: string, body: string): Promise<MessageRow | null> {
    const rows = await this.#db.select().from(helpdeskTickets).where(eq(helpdeskTickets.accessToken, accessToken)).limit(1);
    const ticket = rows[0];
    if (!ticket) return null;
    const [message] = await this.#db
      .insert(helpdeskMessages)
      .values({ id: randomUUID(), workspaceId: ticket.workspaceId, ticketId: ticket.id, authorType: "submitter", body })
      .returning();
    await this.#db.update(helpdeskTickets).set({ status: "open", updatedAt: new Date() }).where(eq(helpdeskTickets.id, ticket.id));
    return message ?? null;
  }

  /** Authenticated (workspace member) — the support-agent inbox view. */
  async listTickets(workspaceId: string, opts: PageOpts): Promise<Page<TicketRow>> {
    const where = eq(helpdeskTickets.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(helpdeskTickets).where(where).orderBy(desc(helpdeskTickets.updatedAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(helpdeskTickets).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getTicket(workspaceId: string, ticketId: string): Promise<{ ticket: TicketRow; messages: MessageRow[] } | null> {
    const rows = await this.#db
      .select()
      .from(helpdeskTickets)
      .where(and(eq(helpdeskTickets.id, ticketId), eq(helpdeskTickets.workspaceId, workspaceId)))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) return null;
    const messages = await this.#db
      .select()
      .from(helpdeskMessages)
      .where(eq(helpdeskMessages.ticketId, ticket.id))
      .orderBy(asc(helpdeskMessages.createdAt));
    return { ticket, messages };
  }

  async replyAsAgent(workspaceId: string, ticketId: string, authorUserId: string, body: string, status?: string): Promise<MessageRow | null> {
    const ticket = await this.getTicket(workspaceId, ticketId);
    if (!ticket) return null;
    const [message] = await this.#db
      .insert(helpdeskMessages)
      .values({ id: randomUUID(), workspaceId, ticketId, authorType: "agent", authorUserId, body })
      .returning();
    await this.#db
      .update(helpdeskTickets)
      .set({ updatedAt: new Date(), ...(status ? { status } : {}) })
      .where(eq(helpdeskTickets.id, ticketId));
    return message ?? null;
  }
}
