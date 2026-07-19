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
 * (`listTickets`/`getTicket`/`replyAsAgent`) are organization-authenticated like
 * every other CRUD store here.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, count, notLike } from "drizzle-orm";
import type { Database } from "./client.js";
import { helpdeskTickets, helpdeskMessages } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface HelpdeskPage<T> {
  items: T[];
  total: number;
}

export type TicketRow = typeof helpdeskTickets.$inferSelect;
export type InternalTicketRow = Omit<TicketRow, "accessToken">;
export type MessageRow = typeof helpdeskMessages.$inferSelect;

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function hashAccessToken(accessToken: string): string {
  return `sha256:${createHash("sha256").update(accessToken).digest("hex")}`;
}

const internalTicketColumns = {
  id: helpdeskTickets.id,
  organizationId: helpdeskTickets.organizationId,
  subject: helpdeskTickets.subject,
  status: helpdeskTickets.status,
  submitterEmail: helpdeskTickets.submitterEmail,
  submitterName: helpdeskTickets.submitterName,
  createdAt: helpdeskTickets.createdAt,
  updatedAt: helpdeskTickets.updatedAt,
};

export class DrizzleHelpdeskStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async #findTicketByAccessToken(accessToken: string): Promise<InternalTicketRow | null> {
    const hashedToken = hashAccessToken(accessToken);
    const hashedRows = await this.#db
      .select(internalTicketColumns)
      .from(helpdeskTickets)
      .where(eq(helpdeskTickets.accessToken, hashedToken))
      .limit(1);
    if (hashedRows[0]) return hashedRows[0];

    const legacyRows = await this.#db
      .select(internalTicketColumns)
      .from(helpdeskTickets)
      .where(
        and(
          eq(helpdeskTickets.accessToken, accessToken),
          notLike(helpdeskTickets.accessToken, "sha256:%"),
        ),
      )
      .limit(1);
    const legacyTicket = legacyRows[0];
    if (!legacyTicket) return null;

    await this.#db
      .update(helpdeskTickets)
      .set({ accessToken: hashedToken })
      .where(
        and(
          eq(helpdeskTickets.id, legacyTicket.id),
          eq(helpdeskTickets.accessToken, accessToken),
        ),
      );
    return legacyTicket;
  }

  /** Public: anyone with the organization's helpdesk link may open a ticket. Returns
   * the access token ONCE — the caller (frontend) is responsible for showing it
   * to the submitter, the same as a one-time signup confirmation link. */
  async createTicket(input: {
    organizationId: string;
    subject: string;
    submitterEmail: string;
    submitterName?: string;
    body: string;
    operationId: string;
    accessToken: string;
  }): Promise<{ ticket: InternalTicketRow & { accessToken: string }; message: MessageRow }> {
    const ticketId = stableUuid(`helpdesk:ticket:${input.organizationId}:${input.operationId}`);
    const messageId = stableUuid(`helpdesk:message:initial:${ticketId}`);
    const accessTokenHash = hashAccessToken(input.accessToken);
    const { storedTicket, message } = await this.#db.transaction(async (tx) => {
      const [insertedTicket] = await tx
        .insert(helpdeskTickets)
        .values({
          id: ticketId,
          organizationId: input.organizationId,
          subject: input.subject,
          submitterEmail: input.submitterEmail,
          ...(input.submitterName ? { submitterName: input.submitterName } : {}),
          accessToken: accessTokenHash,
        })
        .onConflictDoNothing()
        .returning();
      if (insertedTicket) {
        const [message] = await tx
          .insert(helpdeskMessages)
          .values({
            id: messageId,
            organizationId: input.organizationId,
            ticketId,
            authorType: "submitter",
            body: input.body,
          })
          .returning();
        return { storedTicket: insertedTicket, message: message! };
      }

      const [storedTicket] = await tx
        .select()
        .from(helpdeskTickets)
        .where(and(eq(helpdeskTickets.id, ticketId), eq(helpdeskTickets.accessToken, accessTokenHash)))
        .limit(1);
      const [message] = await tx
        .select()
        .from(helpdeskMessages)
        .where(and(eq(helpdeskMessages.id, messageId), eq(helpdeskMessages.ticketId, ticketId)))
        .limit(1);
      if (
        !storedTicket ||
        !message ||
        storedTicket.subject !== input.subject ||
        storedTicket.submitterEmail !== input.submitterEmail ||
        (storedTicket.submitterName ?? undefined) !== input.submitterName ||
        message.body !== input.body
      ) {
        throw new Error("helpdesk: operation id reused with different ticket input");
      }
      return { storedTicket, message };
    });
    const { accessToken: _storedHash, ...ticket } = storedTicket!;
    return { ticket: { ...ticket, accessToken: input.accessToken }, message: message! };
  }

  /** Public: fetch a ticket + its messages by access token. Returns null for any
   * unknown token rather than distinguishing "wrong token" from "no such ticket"
   * — both must look identical to an unauthenticated caller. */
  async getTicketByToken(accessToken: string): Promise<{ ticket: InternalTicketRow; messages: MessageRow[] } | null> {
    const ticket = await this.#findTicketByAccessToken(accessToken);
    if (!ticket) return null;
    const messages = await this.#db
      .select()
      .from(helpdeskMessages)
      .where(eq(helpdeskMessages.ticketId, ticket.id))
      .orderBy(asc(helpdeskMessages.createdAt));
    return { ticket, messages };
  }

  /** Public: the submitter replies to their own ticket, proven by token possession. */
  async replyByToken(accessToken: string, body: string, operationId: string): Promise<MessageRow | null> {
    const ticket = await this.#findTicketByAccessToken(accessToken);
    if (!ticket) return null;
    const messageId = stableUuid(`helpdesk:message:reply:${ticket.id}:${operationId}`);
    return this.#db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(helpdeskMessages)
        .values({ id: messageId, organizationId: ticket.organizationId, ticketId: ticket.id, authorType: "submitter", body })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await tx
          .select()
          .from(helpdeskMessages)
          .where(and(eq(helpdeskMessages.id, messageId), eq(helpdeskMessages.ticketId, ticket.id)))
          .limit(1);
        if (!existing || existing.body !== body || existing.authorType !== "submitter") {
          throw new Error("helpdesk: operation id reused with different reply input");
        }
        return existing;
      }
      await tx
        .update(helpdeskTickets)
        .set({ status: "open", updatedAt: new Date() })
        .where(eq(helpdeskTickets.id, ticket.id));
      return inserted;
    });
  }

  /** Authenticated (organization member) — the support-agent inbox view. */
  async listTickets(organizationId: string, opts: PageOpts): Promise<HelpdeskPage<InternalTicketRow>> {
    const where = eq(helpdeskTickets.organizationId, organizationId);
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select(internalTicketColumns)
        .from(helpdeskTickets)
        .where(where)
        .orderBy(desc(helpdeskTickets.updatedAt))
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(helpdeskTickets).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getTicket(organizationId: string, ticketId: string): Promise<{ ticket: InternalTicketRow; messages: MessageRow[] } | null> {
    const rows = await this.#db
      .select(internalTicketColumns)
      .from(helpdeskTickets)
      .where(and(eq(helpdeskTickets.id, ticketId), eq(helpdeskTickets.organizationId, organizationId)))
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

  async replyAsAgent(organizationId: string, ticketId: string, authorUserId: string, body: string, status?: string): Promise<MessageRow | null> {
    const ticket = await this.getTicket(organizationId, ticketId);
    if (!ticket) return null;
    const [message] = await this.#db
      .insert(helpdeskMessages)
      .values({ id: randomUUID(), organizationId, ticketId, authorType: "agent", authorUserId, body })
      .returning();
    await this.#db
      .update(helpdeskTickets)
      .set({ updatedAt: new Date(), ...(status ? { status } : {}) })
      .where(eq(helpdeskTickets.id, ticketId));
    return message ?? null;
  }
}
