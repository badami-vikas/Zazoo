import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { CreateEventEnvelope, SendEmailEnvelope } from "../src/contracts.js";

let test_fixture_currentGmail: unknown;
let test_fixture_currentCalendar: unknown;

mock.module("googleapis", {
  namedExports: {
    google: {
      gmail: () => test_fixture_currentGmail,
      calendar: () => test_fixture_currentCalendar,
    },
  },
});

const { GoogleApiGateway } = await import("../src/gateway-google.js");

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function setClients(gmail: unknown, calendar: unknown): void {
  test_fixture_currentGmail = gmail;
  test_fixture_currentCalendar = calendar;
}

test("fetchThreads maps Gmail headers, body fallback, participants, pagination, and list options", async () => {
  const listCalls: unknown[] = [];
  const getCalls: unknown[] = [];
  const fakeGmailClient = {
    users: {
      threads: {
        list: async (args: unknown) => {
          listCalls.push(args);
          return { data: { nextPageToken: "test_fixture_next_page", threads: [{ id: "test_fixture_thread_1" }, {}, { id: "test_fixture_thread_2" }] } };
        },
        get: async (args: { id: string }) => {
          getCalls.push(args);
          if (args.id === "test_fixture_thread_1") {
            return {
              data: {
                historyId: "test_fixture_history_1",
                messages: [
                  {
                    id: "test_fixture_msg_1",
                    internalDate: "1751500000000",
                    snippet: "test_fixture_ first snippet",
                    payload: {
                      headers: [
                        { name: "From", value: '"test_fixture_ Alice" <test_fixture_alice@example.com>' },
                        { name: "To", value: "test_fixture_self@example.com, test_fixture_bob@example.com" },
                        { name: "Cc", value: '"test_fixture_ Carol" <test_fixture_carol@example.com>' },
                        { name: "Subject", value: "test_fixture_ Subject" },
                        { name: "Date", value: "2026-07-10T10:00:00.000Z" },
                      ],
                      parts: [{ mimeType: "text/plain", body: { data: b64("test_fixture_ plain body") } }],
                    },
                  },
                ],
              },
            };
          }
          return {
            data: {
              messages: [
                {
                  id: "test_fixture_msg_2",
                  internalDate: "1751503600000",
                  snippet: "test_fixture_ fallback snippet",
                  payload: {
                    headers: [
                      { name: "From", value: "test_fixture_bob@example.com" },
                      { name: "Subject", value: "test_fixture_ Fallback" },
                    ],
                  },
                },
              ],
            },
          };
        },
      },
      drafts: { create: async () => ({ data: {} }) },
    },
  };
  setClients(fakeGmailClient, { events: { list: async () => ({ data: { items: [] } }) } });

  const gw = new GoogleApiGateway({} as never);
  const result = await gw.fetchThreads({ maxResults: 10, query: "from:test_fixture", pageToken: "test_fixture_page" });

  assert.deepEqual(listCalls[0], { userId: "me", maxResults: 10, q: "from:test_fixture", pageToken: "test_fixture_page" });
  assert.deepEqual(getCalls.map((c) => (c as { id: string }).id).sort(), ["test_fixture_thread_1", "test_fixture_thread_2"]);
  assert.equal(result.nextPageToken, "test_fixture_next_page");
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0]?.historyId, "test_fixture_history_1");
  assert.deepEqual(result.threads[0]?.participants, [
    { name: "test_fixture_ Alice", email: "test_fixture_alice@example.com" },
    { email: "test_fixture_self@example.com" },
    { email: "test_fixture_bob@example.com" },
    { name: "test_fixture_ Carol", email: "test_fixture_carol@example.com" },
  ]);
  assert.equal(result.threads[0]?.messages[0]?.bodyText, "test_fixture_ plain body");
  assert.equal(result.threads[0]?.messages[0]?.receivedAt, new Date(1751500000000).toISOString());
  assert.equal(result.threads[1]?.messages[0]?.bodyText, "test_fixture_ fallback snippet");
  assert.equal(result.incomplete, undefined);
});

test("fetchEvents maps Calendar API items with defaults, bounded window, attendees, and pagination", async () => {
  const eventListCalls: unknown[] = [];
  setClients(
    { users: { threads: { list: async () => ({ data: {} }), get: async () => ({ data: {} }) }, drafts: { create: async () => ({ data: {} }) } } },
    {
      events: {
        list: async (args: unknown) => {
          eventListCalls.push(args);
          return {
            data: {
              nextPageToken: "test_fixture_events_next",
              items: [
                {
                  id: "test_fixture_event_1",
                  summary: "test_fixture_ Planning",
                  description: "test_fixture_ Description",
                  start: { dateTime: "2026-07-11T09:00:00.000Z" },
                  end: { dateTime: "2026-07-11T10:00:00.000Z" },
                  location: "test_fixture_ Room",
                  organizer: { displayName: "test_fixture_ Organizer", email: "test_fixture_org@example.com" },
                  attendees: [{ displayName: "test_fixture_ Guest", email: "test_fixture_guest@example.com" }, {}],
                },
                { id: "test_fixture_event_2", start: { date: "2026-07-12" }, end: { date: "2026-07-13" } },
              ],
            },
          };
        },
      },
    },
  );

  const gw = new GoogleApiGateway({} as never);
  const result = await gw.fetchEvents({ maxResults: 5, timeMin: "2026-07-11T00:00:00.000Z", pageToken: "test_fixture_page" });

  assert.deepEqual(eventListCalls[0], {
    calendarId: "primary",
    maxResults: 5,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: "2026-07-11T00:00:00.000Z",
    timeMax: "2026-10-09T00:00:00.000Z",
    pageToken: "test_fixture_page",
  });
  assert.equal(result.nextPageToken, "test_fixture_events_next");
  assert.deepEqual(result.events[0], {
    eventId: "test_fixture_event_1",
    summary: "test_fixture_ Planning",
    description: "test_fixture_ Description",
    start: "2026-07-11T09:00:00.000Z",
    end: "2026-07-11T10:00:00.000Z",
    location: "test_fixture_ Room",
    organizer: { name: "test_fixture_ Organizer", email: "test_fixture_org@example.com" },
    attendees: [{ name: "test_fixture_ Guest", email: "test_fixture_guest@example.com" }, { email: "" }],
  });
  assert.equal(result.events[1]?.summary, "(no title)");
  assert.equal(result.events[1]?.start, "2026-07-12");
});

test("createDraft encodes the MIME message and preserves optional cc/thread metadata", async () => {
  const draftCalls: unknown[] = [];
  setClients(
    {
      users: {
        threads: { list: async () => ({ data: {} }), get: async () => ({ data: {} }) },
        drafts: {
          create: async (args: unknown) => {
            draftCalls.push(args);
            return { data: { id: "test_fixture_draft_id", message: { id: "test_fixture_message_id" } } };
          },
        },
      },
    },
    { events: { list: async () => ({ data: { items: [] } }) } },
  );

  const gw = new GoogleApiGateway({} as never);
  const envelope: SendEmailEnvelope = {
    to: ["test_fixture_to@example.com"],
    cc: ["test_fixture_cc@example.com"],
    subject: "test_fixture_ Draft subject",
    bodyText: "test_fixture_ Draft body",
    threadId: "test_fixture_thread_id",
  };
  const result = await gw.createDraft(envelope);

  assert.deepEqual(result, { providerDraftId: "test_fixture_draft_id", providerMessageId: "test_fixture_message_id" });
  const raw = (draftCalls[0] as { requestBody: { message: { raw: string; threadId?: string } } }).requestBody.message.raw;
  assert.equal((draftCalls[0] as { requestBody: { message: { threadId?: string } } }).requestBody.message.threadId, "test_fixture_thread_id");
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(decoded, /^To: test_fixture_to@example\.com\r\nCc: test_fixture_cc@example\.com\r\nSubject: test_fixture_ Draft subject/);
  assert.ok(decoded.endsWith("\r\n\r\ntest_fixture_ Draft body"));
});

test("create/update/delete calendar events send the expected API payloads and echo no-body deletes", async () => {
  const calls: unknown[] = [];
  setClients(
    { users: { threads: { list: async () => ({ data: {} }), get: async () => ({ data: {} }) }, drafts: { create: async () => ({ data: {} }) } } },
    {
      events: {
        list: async () => ({ data: { items: [] } }),
        insert: async (args: unknown) => {
          calls.push({ method: "insert", args });
          return { data: { id: "test_fixture_created_event", htmlLink: "https://test_fixture/event" } };
        },
        patch: async (args: unknown) => {
          calls.push({ method: "patch", args });
          return { data: {} };
        },
        delete: async (args: unknown) => {
          calls.push({ method: "delete", args });
          return { data: {} };
        },
      },
    },
  );

  const gw = new GoogleApiGateway({} as never);
  const createEnvelope: CreateEventEnvelope = {
    summary: "test_fixture_ Created",
    description: "test_fixture_ Details",
    location: "test_fixture_ Office",
    start: "2026-07-12T09:00:00.000Z",
    end: "2026-07-12T10:00:00.000Z",
    attendees: ["test_fixture_attendee@example.com"],
  };

  assert.deepEqual(await gw.createEvent(createEnvelope), { providerEventId: "test_fixture_created_event", htmlLink: "https://test_fixture/event" });
  assert.deepEqual(await gw.updateEvent("test_fixture_event_to_patch", { summary: "test_fixture_ Patched", end: "2026-07-12T11:00:00.000Z" }), {
    providerEventId: "test_fixture_event_to_patch",
  });
  assert.deepEqual(await gw.deleteEvent("test_fixture_event_to_delete"), { providerEventId: "test_fixture_event_to_delete" });

  assert.deepEqual((calls[0] as { args: unknown }).args, {
    calendarId: "primary",
    requestBody: {
      summary: "test_fixture_ Created",
      description: "test_fixture_ Details",
      location: "test_fixture_ Office",
      start: { dateTime: "2026-07-12T09:00:00.000Z" },
      end: { dateTime: "2026-07-12T10:00:00.000Z" },
      attendees: [{ email: "test_fixture_attendee@example.com" }],
    },
  });
  assert.deepEqual((calls[1] as { args: unknown }).args, {
    calendarId: "primary",
    eventId: "test_fixture_event_to_patch",
    requestBody: { summary: "test_fixture_ Patched", end: { dateTime: "2026-07-12T11:00:00.000Z" } },
  });
  assert.deepEqual((calls[2] as { args: unknown }).args, { calendarId: "primary", eventId: "test_fixture_event_to_delete" });
});
