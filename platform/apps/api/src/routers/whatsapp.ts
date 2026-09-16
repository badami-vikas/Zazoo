import { z } from "zod";
import { PILOT_ORGANIZATION, whatsAppCaptureSignalId } from "../wiring.js";
import { advance, hashTaintValue, labelAtSource, uuidv7 } from "@bridge/core";
import { captureAllowed, recordSignal as recordCaptureSignal, whatsAppMessageCaptureSignal } from "@bridge/core";
import { mapExtraction as mapWhatsAppExtraction, personIndexFrom as whatsAppPersonIndexFrom, advanceCursor as advanceWhatsAppCursor, mapMessages as mapWhatsAppMessages, newMessagesSince as newWhatsAppMessagesSince, readSyncState as readWhatsAppSyncState, summarizeSync as summarizeWhatsAppSync, syncedThreads as whatsAppSyncedThreads, type RawMessage as RawWhatsAppMessage, WHATSAPP_ANNOTATIONS_NAMESPACE, readAnnotationState, addTags as addWhatsAppTags, removeTag as removeWhatsAppTag, addNote as addWhatsAppNote, removeNote as removeWhatsAppNote, listAnnotations as listWhatsAppAnnotations, tagCounts as whatsAppTagCounts, WHATSAPP_AUDIT_NAMESPACE, readAuditState, auditEventFromOutcome, listAuditEvents, summarizeAudit, type AuditEventKind as WhatsAppAuditEventKind, WHATSAPP_AUTOMATION_NAMESPACE, assignmentLedgerOf as whatsAppAssignmentLedger, ruleLedgerOf as whatsAppRuleLedger, scheduleLedgerOf as whatsAppScheduleLedger, withLedgers as whatsAppWithLedgers, readAutomationState as readWhatsAppAutomationState, addRule as addWhatsAppRule, deleteRule as deleteWhatsAppRule, draftAutomationRule as draftWhatsAppRule, planAutomationRun as planWhatsAppAutomationRun, setRuleEnabled as setWhatsAppRuleEnabled, assignAgent as assignWhatsAppAgent, unassignAgent as unassignWhatsAppAgent, cancelAction as cancelWhatsAppAction, cancelActionsForRule as cancelWhatsAppActionsForRule, scheduleFromPolicy as scheduleWhatsAppFromPolicy, resolveChatLink as resolveWhatsAppChatLink, duplicateSignalId as whatsAppDuplicateSignalId, possibleDuplicatePayload as whatsAppPossibleDuplicatePayload, identityKindOfDedupeKey as whatsAppIdentityKindOfDedupeKey } from "@bridge/whatsapp";
import { WHATSAPP_SOURCE, WHATSAPP_SYNC_NAMESPACE, assertMembership, authenticatedProcedure, procedure, readCaptureConsentState, recordWhatsAppAudit, requireWhatsAppHuman, t, whatsAppAutomationSubjectSchema, whatsAppAutomationUpdate, whatsAppModuleAgents } from "../router-shared.js";

/**
 * WhatsApp Module — staging a Contact Extractor run.
 *
 * Residency: the raw payload and every phone number stay on the LOCAL plane.
 * A WhatsApp address book is a firehose import, so it lands as a local list —
 * a roster — and deliberately creates NO graph entities. Nothing here writes
 * to cloud canonical; promoting an identity is a separate, explicit act.
 */
export const whatsappRouter = t.router({
  stageExtraction: authenticatedProcedure
    .input(
      z.object({
        runId: z.string().min(1).max(128),
        capturedAt: z.string().min(1),
        listName: z.string().min(1).max(120).default("WhatsApp"),
        contacts: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.string().optional(),
              pushname: z.string().optional(),
              phone: z.string().optional(),
              isMyContact: z.boolean(),
              isGroup: z.boolean(),
            }),
          )
          .max(50_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Single-tenant by construction, exactly like every other Module
      // surface here (see the PILOT_ORGANIZATION note above).
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const localPlane = ctx.wiring.localPlane;

      // 1. Raw capture → LOCAL body store. Never the cloud plane.
      await localPlane.bodies.put({
        organizationId,
        source: "whatsapp",
        sourceRecordId: `capture:${input.runId}`,
        // Structurally private: these bodies cannot egress.
        dataScope: "private",
        content: { capturedAt: input.capturedAt, contacts: input.contacts },
        capturedAt: input.capturedAt,
      });

      // 2. Map, matching against people this source has seen before.
      const existingRows: { personId: string; dedupeKey: string }[] = [];
      for (const person of await localPlane.graph.listPeople(organizationId)) {
        if (person.dedupeKey) {
          existingRows.push({ personId: person.id, dedupeKey: person.dedupeKey });
        }
      }
      const contacts = input.contacts.map((contact) => ({
        id: contact.id,
        isMyContact: contact.isMyContact,
        isGroup: contact.isGroup,
        ...(contact.name !== undefined ? { name: contact.name } : {}),
        ...(contact.pushname !== undefined ? { pushname: contact.pushname } : {}),
        ...(contact.phone !== undefined ? { phone: contact.phone } : {}),
      }));
      const result = mapWhatsAppExtraction(
        { kind: "contacts", runId: input.runId, capturedAt: input.capturedAt, contacts },
        whatsAppPersonIndexFrom(existingRows),
      );

      // 3. Commit the roster locally. Ambiguous matches produced no proposal
      //    at all — they are Signals for a human, not rows to guess at.
      const list = await localPlane.graph.ensurePersonList({
        id: uuidv7(),
        organizationId,
        name: input.listName,
        source: "whatsapp",
        createdAt: new Date().toISOString(),
      });

      const memberIds: string[] = [];
      for (const proposal of result.people) {
        const personId = proposal.matchedPersonId ?? uuidv7();
        await localPlane.graph.upsertPerson({
          id: personId,
          organizationId,
          ...(proposal.displayName ? { fullName: proposal.displayName } : {}),
          emails: [],
          // Absent for every LID identity — a hidden number is never invented.
          ...(proposal.phoneE164 ? { phones: [proposal.phoneE164] } : {}),
          dedupeKey: proposal.dedupeKey,
        });
        memberIds.push(personId);
      }
      await localPlane.graph.addPeopleToList(list.id, memberIds);

      // 4. File the ambiguous ones as Signals for a human to resolve.
      //
      //    These were previously computed and thrown away, which made the
      //    "never auto-merge" rule invisible: the run refused to guess, said
      //    so in a counter, and left no way to act on it. A Signal is the
      //    reviewable artefact that refusal is supposed to produce.
      //
      //    The id is deterministic on the identity key, so re-running an
      //    extraction over the same address book re-commits the same rows
      //    (`commitEntity` is a no-op on conflict) instead of minting a fresh
      //    Signal per run. `personId` is deliberately left unset — the whole
      //    point of this Signal is that nobody knows which Person it is.
      for (const signal of result.signals) {
        await localPlane.graph.commitEntity({
          id: whatsAppDuplicateSignalId(signal.dedupeKey),
          organizationId,
          kind: "signal",
          payload: whatsAppPossibleDuplicatePayload(
            signal,
            whatsAppIdentityKindOfDedupeKey(signal.dedupeKey),
          ),
          source: WHATSAPP_SOURCE,
          sourceRecordId: `possible_duplicate:${signal.dedupeKey}`,
          createdAt: new Date().toISOString(),
        });
      }

      // Bridge did something; the audit log records it. Counts only —
      // no name, no number, no body ever enters an audit row.
      await recordWhatsAppAudit(localPlane, organizationId, {
        id: uuidv7(),
        kind: "extraction_run",
        at: new Date().toISOString(),
        detail: {
          runId: input.runId,
          listName: list.name,
          staged: result.people.length,
          ambiguous: result.signals.length,
        },
      });

      return {
        runId: input.runId,
        listId: list.id,
        listName: list.name,
        staged: {
          people: result.people.length,
          withPhone: result.people.filter((person) => person.phoneE164).length,
          numberHidden: result.people.filter((person) => !person.phoneE164).length,
          ambiguous: result.signals.length,
          skipped: contacts.length - result.people.length - result.signals.length,
        },
      };
    }),

  // ── Message capture (TASK-030, ADR-158 under AP-091) ────────────────────
  //
  // RESIDENCY, stated once and applying to every procedure below: a WhatsApp
  // message body is another person's private content. It is written to the
  // LOCAL plane and to nowhere else. There is no dual-write, no promote path,
  // and no cloud canonical destination for any of it — unlike an identity
  // fact, which `stageExtraction` above may surface outward. The sync cursor
  // lives in the local state store beside it.

  /**
   * Store one chat's newly-read messages and advance its cursor.
   *
   * Idempotent by construction: the store's upsert is keyed on
   * (source, messageId), and `newMessagesSince` re-applies the watermark
   * here so an inclusive read op cannot re-write what is already stored.
   *
   * The cursor moves only AFTER the write succeeds. A failed write therefore
   * leaves the watermark where it was and the next run re-reads the same
   * window, which costs a round trip and loses nothing — the opposite order
   * would skip those messages permanently.
   */
  ingestMessages: authenticatedProcedure
    .input(
      z.object({
        chatId: z.string().min(1).max(128),
        /** Display label only. Never an identifier. */
        chatName: z.string().max(300).optional(),
        isGroup: z.boolean().optional(),
        capturedAt: z.string().min(1),
        /** The watermark this read was made against, in epoch seconds. */
        since: z.number().int().min(0).default(0),
        messages: z
          .array(
            z.object({
              id: z.string().min(1),
              chatId: z.string().min(1),
              fromMe: z.boolean(),
              timestamp: z.number(),
              author: z.string().optional(),
              from: z.string().optional(),
              body: z.string().optional(),
              type: z.string().optional(),
              ack: z.number().optional(),
              mimetype: z.string().optional(),
              filename: z.string().optional(),
              size: z.number().optional(),
            }),
          )
          .max(1_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const localPlane = ctx.wiring.localPlane;

      // Mapping decides identity. `senderOf` never turns a Linked ID into a
      // phone number, and the store's `assertMessageShape` re-checks the same
      // rule at its own boundary — two independent guards on the path that
      // once fabricated 4,203 phone numbers.
      const mapped = mapWhatsAppMessages(input.messages as RawWhatsAppMessage[]);
      const fresh = newWhatsAppMessagesSince(mapped.messages, input.since);

      await localPlane.graph.putMessages(
        fresh.map((message) => ({
          organizationId,
          source: WHATSAPP_SOURCE,
          messageId: message.messageId,
          chatId: message.chatId,
          ...(message.senderKey !== undefined ? { senderKey: message.senderKey } : {}),
          senderKind: message.senderKind,
          direction: message.direction,
          sentAt: message.sentAt,
          body: message.body,
          ...(message.attachment ? { attachment: message.attachment } : {}),
          ack: message.ack,
          capturedAt: input.capturedAt,
        })),
      );

      const cursor = await localPlane.state.update(
        organizationId,
        WHATSAPP_SYNC_NAMESPACE,
        readWhatsAppSyncState(null),
        (current) => {
          const next = advanceWhatsAppCursor(
            readWhatsAppSyncState(current),
            input.chatId,
            fresh,
            input.capturedAt,
            {
              ...(input.chatName !== undefined ? { name: input.chatName } : {}),
              ...(input.isGroup !== undefined ? { isGroup: input.isGroup } : {}),
            },
          );
          return { state: next, result: next.chats[input.chatId] ?? null };
        },
      );

      // One row per sync pass that actually stored something. A pass that
      // found nothing new is not recorded: it is the common case, and logging
      // it would bury the passes that mattered under polling noise.
      // `skipped` is per-reason; the audit row carries the total plus each
      // non-zero reason, so "the sync keeps refusing things" stays diagnosable
      // without the row growing a column per reason that never occurs.
      const refusedByReason = Object.entries(mapped.skipped).filter(([, count]) => count > 0);
      const refusedTotal = refusedByReason.reduce((sum, [, count]) => sum + count, 0);
      if (fresh.length > 0 || refusedTotal > 0) {
        await recordWhatsAppAudit(localPlane, organizationId, {
          id: uuidv7(),
          kind: "sync_run",
          at: new Date().toISOString(),
          subjectKey: `chat:${input.chatId}`,
          detail: {
            stored: fresh.length,
            refused: refusedTotal,
            ...Object.fromEntries(refusedByReason.map(([reason, count]) => [`refused_${reason}`, count])),
          },
        });
      }

      // AI Harness K2 (TASK-046): the owner's own OUTBOUND messages become
      // envelope-only learning signals — flight on and the whatsapp
      // source's consent explicitly ON (default off). Inbound is someone
      // else's act and never emits (the mapper enforces it; the loop skips
      // it early to avoid pointless id derivations). The mapper's envelope
      // type cannot express `body`, so message text has no path into a
      // signal row; deterministic ids make a re-ingested window a no-op.
      // Bounded by construction: `fresh` is capped by the input's own
      // 1,000-message ceiling.
      if (ctx.wiring.learningObservationEnabled) {
        const consent = await readCaptureConsentState(ctx.wiring, organizationId);
        if (captureAllowed(consent, "whatsapp")) {
          const owner = { organizationId, userId: ctx.identity.id };
          for (const message of fresh) {
            if (message.direction !== "outbound") continue;
            const signalId = whatsAppCaptureSignalId(message.messageId);
            if (await ctx.wiring.memoryStore.get(signalId, owner)) continue;
            const signal = whatsAppMessageCaptureSignal(
              {
                messageId: message.messageId,
                chatId: message.chatId,
                direction: message.direction,
                isGroup: input.isGroup ?? false,
                sentAt: message.sentAt,
                capturedAt: input.capturedAt,
                // Taint-labeled at source: the owner's own outbound act,
                // hashed over envelope facts only — never the body.
                taintLabel: labelAtSource("human_input", {
                  ref: `whatsapp:${message.chatId}:${message.messageId}`,
                  valueHash: hashTaintValue({
                    messageId: message.messageId,
                    direction: message.direction,
                  }),
                  sensitivity: "private",
                  instructionRisk: "data",
                }),
              },
              owner,
              signalId,
            );
            if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
          }
        }
      }

      return {
        chatId: input.chatId,
        stored: fresh.length,
        // Reported, not swallowed: a read op that keeps producing unmappable
        // entries is drift worth seeing.
        refused: mapped.skipped,
        cursor,
      };
    }),

  /** Which threads have been synced, and how much history is actually held. */
  syncState: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = PILOT_ORGANIZATION;
    await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
    const state = readWhatsAppSyncState(
      await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
    );
    return {
      threads: whatsAppSyncedThreads(state),
      progress: summarizeWhatsAppSync(state),
      capabilities: await ctx.wiring.localPlane.graph.messageSearchCapabilities(),
    };
  }),

  /** One thread, oldest first — what the message list renders. */
  thread: authenticatedProcedure
    .input(
      z.object({
        chatId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(20_000).default(5_000),
      }),
    )
    .query(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const messages = await ctx.wiring.localPlane.graph.listMessages(
        organizationId,
        WHATSAPP_SOURCE,
        input.chatId,
        input.limit,
      );
      return {
        chatId: input.chatId,
        messages,
        // The consent facts the send gate reads, surfaced so the composer can
        // explain itself rather than silently refusing.
        activity: await ctx.wiring.localPlane.graph.getThreadActivity(
          organizationId,
          WHATSAPP_SOURCE,
          input.chatId,
        ),
      };
    }),

  /** Full-text (or fuzzy) search across captured message bodies. */
  searchMessages: authenticatedProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(500),
        chatId: z.string().max(128).optional(),
        mode: z.enum(["fulltext", "fuzzy"]).default("fulltext"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const hits = await ctx.wiring.localPlane.graph.searchMessages({
        organizationId,
        source: WHATSAPP_SOURCE,
        text: input.text,
        mode: input.mode,
        limit: input.limit,
        ...(input.chatId ? { chatId: input.chatId } : {}),
      });
      return {
        hits,
        // Reported rather than assumed: fuzzy search needs pg_trgm, which the
        // store may not have loaded, and a silently degraded search that
        // returns nothing looks identical to "no matches".
        capabilities: await ctx.wiring.localPlane.graph.messageSearchCapabilities(),
      };
    }),

  // ── Relationship links (TASK-030, ADR-159) ──────────────────────────────
  //
  // "Whose chat is this?" — the seam between this Module and the Relationship
  // Module. Both procedures below are READ-ONLY and commit nothing: resolving
  // a link is a lookup, and a lookup must not have the side effect of writing
  // a Person. Ambiguity discovered here is reported, not filed; the Signal is
  // written by `stageExtraction`, which is the run the user actually asked for.
  //
  // RESIDENCY: identity keys embed phone numbers, and every read here is
  // against the LOCAL plane. Nothing in this section touches cloud canonical
  // and no message body is returned by either procedure.

  /**
   * The Relationship subject for every synced chat, with its link state.
   *
   * Returns real rows or an empty list — a chat with no Person reads as
   * `unlinked`, never as a placeholder Person.
   */
  relationshipLinks: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = PILOT_ORGANIZATION;
    await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
    const localPlane = ctx.wiring.localPlane;

    const people = await localPlane.graph.listPeople(organizationId);
    const index = whatsAppPersonIndexFrom(
      people.flatMap((person) =>
        person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
      ),
    );
    // Names come from the local People rows, so a linked chat can be labelled
    // with the Person Bridge knows rather than the name WhatsApp reports.
    const nameById = new Map(people.map((person) => [person.id, person.fullName ?? ""]));

    const state = readWhatsAppSyncState(
      await localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
    );
    const links = whatsAppSyncedThreads(state).map((thread) => {
      const link = resolveWhatsAppChatLink(thread.chatId, index);
      return {
        chatId: thread.chatId,
        // A label, never an identifier — see `ChatSyncCursor.name`.
        ...(thread.name !== undefined ? { chatName: thread.name } : {}),
        messageCount: thread.messageCount,
        link,
        ...(link.state === "linked"
          ? { personName: nameById.get(link.personId) || undefined }
          : {}),
      };
    });

    // Counted per state so the surface can lead with the honest headline
    // ("142 chats, 38 linked") instead of implying the rest matched.
    const counts = links.reduce<Record<string, number>>((acc, row) => {
      acc[row.link.state] = (acc[row.link.state] ?? 0) + 1;
      return acc;
    }, {});
    return { links, counts, totalChats: links.length, knownPeople: people.length };
  }),

  /** The Relationship subject for one chat. */
  chatLink: authenticatedProcedure
    .input(z.object({ chatId: z.string().min(1).max(128) }))
    .query(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const localPlane = ctx.wiring.localPlane;
      const people = await localPlane.graph.listPeople(organizationId);
      const link = resolveWhatsAppChatLink(
        input.chatId,
        whatsAppPersonIndexFrom(
          people.flatMap((person) =>
            person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
          ),
        ),
      );
      const person =
        link.state === "linked" ? people.find((row) => row.id === link.personId) : undefined;
      return {
        chatId: input.chatId,
        link,
        // Identity-grade fields only. No phone number is returned here: the
        // surface needs to know WHO, not how to dial them.
        ...(person ? { person: { id: person.id, fullName: person.fullName } } : {}),
      };
    }),

  // ── Tags and internal notes (TASK-030) ──────────────────────────────────
  //
  // Bridge's OWN data about a subject. Nothing below reads or writes any
  // WhatsApp surface: a tag and a note are things the owner wrote, held on
  // the LOCAL plane, invisible to the counterparty and with no promote path.

  /** Everything annotated, plus the tag vocabulary actually in use. */
  annotations: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = PILOT_ORGANIZATION;
    await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
    const state = readAnnotationState(
      await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_ANNOTATIONS_NAMESPACE),
    );
    // An empty store returns empty arrays. The surface says "nothing yet"
    // rather than showing an example row.
    return { subjects: listWhatsAppAnnotations(state), tags: whatsAppTagCounts(state) };
  }),

  /** Add one or more tags to a subject. Idempotent. */
  addTags: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["chat", "person", "community"]),
        id: z.string().min(1).max(300),
        tags: z.array(z.string().min(1).max(48)).min(1).max(25),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const at = new Date().toISOString();
      return ctx.wiring.localPlane.state.update(
        organizationId,
        WHATSAPP_ANNOTATIONS_NAMESPACE,
        readAnnotationState(null),
        (current) => {
          const next = addWhatsAppTags(
            readAnnotationState(current),
            { kind: input.kind, id: input.id },
            input.tags,
            at,
          );
          return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
        },
      );
    }),

  removeTag: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["chat", "person", "community"]),
        id: z.string().min(1).max(300),
        tag: z.string().min(1).max(48),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const at = new Date().toISOString();
      return ctx.wiring.localPlane.state.update(
        organizationId,
        WHATSAPP_ANNOTATIONS_NAMESPACE,
        readAnnotationState(null),
        (current) => {
          const next = removeWhatsAppTag(
            readAnnotationState(current),
            { kind: input.kind, id: input.id },
            input.tag,
            at,
          );
          return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
        },
      );
    }),

  /**
   * Write an internal note. The author is the AUTHENTICATED identity, never a
   * client-supplied field — a note's provenance is the one thing about it a
   * caller must not be able to choose.
   */
  addNote: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["chat", "person", "community"]),
        id: z.string().min(1).max(300),
        body: z.string().trim().min(1).max(4_096),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const at = new Date().toISOString();
      const noteId = uuidv7();
      const authorId = ctx.identity.id;
      return ctx.wiring.localPlane.state.update(
        organizationId,
        WHATSAPP_ANNOTATIONS_NAMESPACE,
        readAnnotationState(null),
        (current) => {
          const next = addWhatsAppNote(
            readAnnotationState(current),
            { kind: input.kind, id: input.id },
            { id: noteId, body: input.body, authorId },
            at,
          );
          return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
        },
      );
    }),

  removeNote: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["chat", "person", "community"]),
        id: z.string().min(1).max(300),
        noteId: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const at = new Date().toISOString();
      return ctx.wiring.localPlane.state.update(
        organizationId,
        WHATSAPP_ANNOTATIONS_NAMESPACE,
        readAnnotationState(null),
        (current) => {
          const next = removeWhatsAppNote(
            readAnnotationState(current),
            { kind: input.kind, id: input.id },
            input.noteId,
            at,
          );
          return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
        },
      );
    }),

  // ── Analytics and audit (TASK-030) ──────────────────────────────────────

  /**
   * Record the outcome of one attempted send.
   *
   * This is the seam, not the send. The gate itself lives in the renderer's
   * engine (`performAutomatedSend` → the Rust ceiling) and is untouched by
   * this Tool; the call site simply hands the OUTCOME here afterwards so the
   * audit log holds it. Deliberately not a send procedure: adding one would
   * be a second write path to WhatsApp, which the ordered gate exists to
   * prevent.
   *
   * The status is what the gate decided, so a caller cannot report a refusal
   * as a success — but it also cannot use this to send anything, because
   * nothing here touches a transport.
   */
  recordSendOutcome: authenticatedProcedure
    .input(
      z.object({
        recipientKey: z.string().min(1).max(300),
        status: z.enum(["sent", "refused", "deferred", "needs_approval"]),
        reason: z.string().max(1_000).optional(),
        /** The policy or shell rule that decided it. */
        code: z.string().max(120).optional(),
        delaySeconds: z.number().int().min(0).max(86_400).optional(),
        earliestAtMs: z.number().int().min(0).optional(),
        subjectKey: z.string().max(300).optional(),
        ruleId: z.string().max(128).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);

      // Rebuilt as the outcome shape so the row is produced by the same
      // mapping the Module tests cover, rather than a second hand-written one.
      const outcome =
        input.status === "sent"
          ? ({
              status: "sent",
              request: {
                targetKind: "person",
                targetId: "",
                recipientKey: input.recipientKey,
                body: "",
              },
              delaySeconds: input.delaySeconds ?? 0,
            } as const)
          : input.status === "needs_approval"
            ? ({
                status: "needs_approval",
                request: {
                  targetKind: "person",
                  targetId: "",
                  recipientKey: input.recipientKey,
                  body: "",
                },
                reason: input.reason ?? "",
              } as const)
            : input.status === "refused"
              ? ({
                  status: "refused",
                  reason: input.reason ?? "",
                  ...(input.code !== undefined ? { code: input.code } : {}),
                } as const)
              : ({
                  status: "deferred",
                  reason: input.reason ?? "",
                  ...(input.code !== undefined ? { code: input.code } : {}),
                  ...(input.earliestAtMs !== undefined
                    ? { earliestAtMs: input.earliestAtMs }
                    : {}),
                } as const);

      await recordWhatsAppAudit(
        ctx.wiring.localPlane,
        organizationId,
        auditEventFromOutcome(uuidv7(), new Date().toISOString(), input.recipientKey, outcome, {
          ...(input.subjectKey !== undefined ? { subjectKey: input.subjectKey } : {}),
          ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
        }),
      );
      return { recorded: true };
    }),

  /**
   * What Bridge itself has done, and the rollup over it.
   *
   * Built ONLY from rows Bridge wrote as it acted. Nothing here reads the
   * WhatsApp account — there is no scraped engagement metric, no per-contact
   * message count, and no backfill, because there would be nothing honest to
   * backfill from.
   */
  auditLog: authenticatedProcedure
    .input(
      z
        .object({
          kinds: z
            .array(
              z.enum([
                "send_attempted",
                "send_sent",
                "send_refused",
                "send_deferred",
                "send_needs_approval",
                "sync_run",
                "extraction_run",
                "rule_fired",
                "rule_skipped",
                "automation_halted",
                "automation_rearmed",
              ]),
            )
            .optional(),
          sinceIso: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .default({ limit: 100 }),
    )
    .query(async ({ input, ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const state = readAuditState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUDIT_NAMESPACE),
      );
      return {
        events: listAuditEvents(state, {
          limit: input.limit,
          ...(input.kinds ? { kinds: input.kinds as WhatsAppAuditEventKind[] } : {}),
          ...(input.sinceIso ? { sinceIso: input.sinceIso } : {}),
        }),
        // The rollup deliberately spans the whole retained log, not the
        // truncated page above it, so the counts do not silently mean "of the
        // first 100 rows".
        summary: summarizeAudit(state, {
          ...(input.sinceIso ? { sinceIso: input.sinceIso } : {}),
        }),
      };
    }),
  // ── Automation: rules, schedule, assignment (TASK-030, ADR-158/AP-091) ──
  //
  // RESIDENCY: all three ledgers live in ONE `LocalStateStore` namespace,
  // which is Local Plane by construction. Rules name chats, assignments name
  // humans and Agents, scheduled actions name goals. None of it dual-writes
  // and none of it has a promote path.
  //
  // SEND DISCIPLINE: nothing in this section sends, and nothing in it can.
  // A rule starts an Agent Run; whatever that Run wants to deliver goes
  // through `performAutomatedSend` — policy refusals, then `decideSend`,
  // then the Rust-enforced ceiling. There is no second write path here.
  //
  // ATTRIBUTION: every mutation below requires `identity.type === "user"`.
  // An Agent may not author its own rules, assign itself, or re-arm anything;
  // that is what makes the audit trail mean something.
  automation: t.router({
    /** Every ledger, plus what the panels need to render honest choices. */
    state: authenticatedProcedure.query(async ({ ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const state = readWhatsAppAutomationState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUTOMATION_NAMESPACE),
      );
      const sync = readWhatsAppSyncState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
      );
      return {
        rules: state.rules,
        assignments: state.assignments,
        scheduled: state.scheduled,
        // The manifest is the authority on which Agents exist. Sending the
        // list means the panel offers real Agents rather than free text.
        agents: whatsAppModuleAgents(),
        // Real synced threads only. A chat the store has never seen is not
        // offered as a subject, because a rule pointed at one could never
        // have the consent facts it needs.
        chats: whatsAppSyncedThreads(sync).map((thread) => ({
          chatId: thread.chatId,
          ...(thread.name !== undefined ? { name: thread.name } : {}),
          ...(thread.isGroup !== undefined ? { isGroup: thread.isGroup } : {}),
        })),
      };
    }),

    createRule: authenticatedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          subject: whatsAppAutomationSubjectSchema,
          trigger: z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("inbound_message"),
              bodyContains: z.string().trim().max(200).optional(),
            }),
            z.object({
              kind: z.literal("thread_quiet"),
              quietDays: z.number().int().min(1).max(365),
            }),
          ]),
          goal: z.string().trim().min(1).max(600),
          /**
           * Only ever tightening — `tightenLimits` takes the stricter of each
           * field, so these bounds are a usability guard, not the protection.
           */
          limitOverrides: z
            .object({
              dailyCap: z.number().int().min(1).max(30).optional(),
              recipientCooldownDays: z.number().int().min(7).max(365).optional(),
              businessHourStart: z.number().int().min(9).max(23).optional(),
              businessHourEnd: z.number().int().min(1).max(21).optional(),
              requireRecipientInitiated: z.boolean().optional(),
            })
            .optional(),
          enabled: z.boolean().default(true),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        const rule = draftWhatsAppRule({
          id: uuidv7(),
          name: input.name,
          subject: input.subject,
          // Rebuilt field by field rather than spread: the package builds
          // with `exactOptionalPropertyTypes`, and an absent `bodyContains`
          // must be absent rather than present-and-undefined.
          trigger:
            input.trigger.kind === "inbound_message"
              ? {
                  kind: "inbound_message" as const,
                  ...(input.trigger.bodyContains
                    ? { bodyContains: input.trigger.bodyContains }
                    : {}),
                }
              : { kind: "thread_quiet" as const, quietDays: input.trigger.quietDays },
          goal: input.goal,
          createdBy: who,
          now,
          enabled: input.enabled,
          // Undefined entries are dropped rather than passed through, for the
          // same `exactOptionalPropertyTypes` reason as the trigger above.
          // `tightenLimits` would ignore them either way — it only ever takes
          // the stricter of each field against the shipped discipline.
          ...(input.limitOverrides
            ? {
                limitOverrides: Object.fromEntries(
                  Object.entries(input.limitOverrides).filter(
                    ([, value]) => value !== undefined,
                  ),
                ),
              }
            : {}),
        });
        await whatsAppAutomationUpdate(ctx, (state) =>
          whatsAppWithLedgers(state, {
            rules: addWhatsAppRule(whatsAppRuleLedger(state), rule),
          }),
        );
        return { rule };
      }),

    setRuleEnabled: authenticatedProcedure
      .input(
        z.object({
          ruleId: z.string().min(1).max(128),
          enabled: z.boolean(),
          reason: z.string().trim().max(300).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        await whatsAppAutomationUpdate(ctx, (state) =>
          whatsAppWithLedgers(state, {
            rules: setWhatsAppRuleEnabled(
              whatsAppRuleLedger(state),
              input.ruleId,
              input.enabled,
              who,
              now,
              input.reason,
            ),
          }),
        );
        return { ruleId: input.ruleId, enabled: input.enabled };
      }),

    /**
     * Delete a rule, and cancel everything it had already queued.
     *
     * Both halves in ONE atomic state update. Deleting the rule while leaving
     * its queued Agent Runs behind would leave the owner watching actions
     * fire from an automation they believe they removed.
     */
    deleteRule: authenticatedProcedure
      .input(z.object({ ruleId: z.string().min(1).max(128) }))
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        // Assigned inside the reducer, which may be retried under contention;
        // a plain assignment (not an accumulation) is safe to redo.
        let cancelledActions = 0;
        await whatsAppAutomationUpdate(ctx, (state) => {
          const swept = cancelWhatsAppActionsForRule(
            whatsAppScheduleLedger(state),
            input.ruleId,
            who,
            now,
          );
          cancelledActions = swept.cancelled;
          return whatsAppWithLedgers(state, {
            rules: deleteWhatsAppRule(whatsAppRuleLedger(state), input.ruleId),
            schedule: swept.ledger,
          });
        });
        return { ruleId: input.ruleId, cancelledActions };
      }),

    assignAgent: authenticatedProcedure
      .input(
        z.object({
          subject: whatsAppAutomationSubjectSchema,
          agentId: z.string().min(1).max(128),
          note: z.string().trim().max(300).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        await whatsAppAutomationUpdate(ctx, (state) =>
          whatsAppWithLedgers(state, {
            assignments: assignWhatsAppAgent(whatsAppAssignmentLedger(state), {
              id: uuidv7(),
              subject: input.subject,
              agentId: input.agentId,
              assignedBy: who,
              assignedAt: now,
              // The manifest decides which Agents exist. Never a client list.
              allowedAgentIds: whatsAppModuleAgents().map((agent) => agent.id),
              ...(input.note ? { note: input.note } : {}),
            }).ledger,
          }),
        );
        return { subject: input.subject, agentId: input.agentId };
      }),

    unassignAgent: authenticatedProcedure
      .input(z.object({ subject: whatsAppAutomationSubjectSchema }))
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        await whatsAppAutomationUpdate(ctx, (state) =>
          whatsAppWithLedgers(state, {
            assignments: unassignWhatsAppAgent(
              whatsAppAssignmentLedger(state),
              input.subject,
              who,
              now,
            ).ledger,
          }),
        );
        return { subject: input.subject };
      }),

    cancelAction: authenticatedProcedure
      .input(z.object({ actionId: z.string().min(1).max(128) }))
      .mutation(async ({ input, ctx }) => {
        const who = requireWhatsAppHuman(ctx.identity);
        const now = new Date().toISOString();
        await whatsAppAutomationUpdate(ctx, (state) =>
          whatsAppWithLedgers(state, {
            schedule: cancelWhatsAppAction(
              whatsAppScheduleLedger(state),
              input.actionId,
              who,
              now,
            ).ledger,
          }),
        );
        return { actionId: input.actionId };
      }),

    /**
     * Evaluate every enabled rule against what the message store actually
     * holds, and queue whatever is due.
     *
     * This is a USER-CLICKED check, not a background loop — the same posture
     * the read Tools take. It reads only stored Local Plane facts, so it
     * touches the WhatsApp session not at all, and it queues Agent Runs
     * rather than sending anything.
     *
     * Every rule that did not produce an action reports WHY, including the
     * ones blocked by the consent gate. A rule pointed at a thread the
     * recipient has never written in can never fire, and the owner should
     * learn that from this check rather than from silence.
     */
    check: authenticatedProcedure.mutation(async ({ ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const now = new Date().toISOString();

      const state = readWhatsAppAutomationState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUTOMATION_NAMESPACE),
      );

      // Consent facts, per subject, read from the store rather than assumed.
      const activity = new Map<string, Awaited<ReturnType<typeof ctx.wiring.localPlane.graph.getThreadActivity>>>();
      for (const rule of state.rules) {
        if (rule.subject.kind !== "chat" || activity.has(rule.subject.key)) continue;
        activity.set(
          rule.subject.key,
          await ctx.wiring.localPlane.graph.getThreadActivity(
            organizationId,
            WHATSAPP_SOURCE,
            rule.subject.key,
          ),
        );
      }

      const outcomes: {
        ruleId: string;
        ruleName: string;
        status: string;
        explanation: string;
        actionId?: string;
      }[] = [];
      const queued: { id: string; ruleId: string; scheduledFor: string }[] = [];

      await whatsAppAutomationUpdate(ctx, (current) => {
        let schedule = whatsAppScheduleLedger(current);
        outcomes.length = 0;
        queued.length = 0;

        for (const rule of current.rules) {
          const thread = activity.get(rule.subject.key) ?? {
            chatId: rule.subject.key,
            inboundCount: 0,
            outboundCount: 0,
          };
          // A Person-subject rule has no single thread to read consent from,
          // so it is reported honestly rather than run against a guess.
          if (rule.subject.kind !== "chat") {
            outcomes.push({
              ruleId: rule.id,
              ruleName: rule.name,
              status: "blocked",
              explanation:
                "This rule watches a Person rather than one chat, and consent is a per-thread fact. Point it at a chat.",
            });
            continue;
          }

          const plan = planWhatsAppAutomationRun(rule, {
            now,
            assignments: whatsAppAssignmentLedger(current),
            thread,
          });

          if (plan.status !== "start_agent_run") {
            // Said plainly rather than left as "not due": this check is a
            // SWEEP over stored facts, so it can evaluate a quiet thread but
            // has no arriving message to hand an `inbound_message` rule. Such
            // a rule is not broken and is not due — it is waiting for a hook
            // that does not exist yet, and the owner should be told that
            // rather than pressing this button again next week.
            const sweepBlind =
              plan.status === "not_due" && rule.trigger.kind === "inbound_message";
            outcomes.push({
              ruleId: rule.id,
              ruleName: rule.name,
              status: sweepBlind ? "waiting" : plan.status,
              explanation: sweepBlind
                ? "This rule fires when a message arrives. This check only sweeps what is already stored, so it cannot fire one — that needs the message-arrival hook, which is not built yet."
                : plan.status === "blocked"
                  ? plan.explanation
                  : plan.reason,
            });
            continue;
          }

          // A trigger match is not a licence to act now. The action is queued
          // and paced; when it runs, the send gate speaks again.
          const id = uuidv7();
          const outcome = scheduleWhatsAppFromPolicy(schedule, {
            id,
            ruleId: rule.id,
            agentId: plan.agentId,
            subject: plan.subject,
            goal: plan.goal,
            ...(plan.skillId ? { skillId: plan.skillId } : {}),
            now,
            decision: { status: "allowed", delaySeconds: 0 },
            limits: plan.limits,
            jitterDraw: Math.random(),
          });
          if (outcome.status === "refused") {
            outcomes.push({
              ruleId: rule.id,
              ruleName: rule.name,
              status: "refused",
              explanation: outcome.reason,
            });
            continue;
          }
          schedule = outcome.ledger;
          queued.push({ id, ruleId: rule.id, scheduledFor: outcome.action.scheduledFor });
          outcomes.push({
            ruleId: rule.id,
            ruleName: rule.name,
            status: "queued",
            explanation: `${plan.because} ${outcome.action.reason.explanation}`,
            actionId: id,
          });
        }

        return whatsAppWithLedgers(current, { schedule });
      });

      return { checkedAt: now, outcomes, queued };
    }),
  }),
});
