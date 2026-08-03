---
title: "TASK-030 — WhatsApp as a hidden engine: spike result and integration build"
type: raw
doc_kind: decision-record
status: active
companions: []
related_wiki: docs/wiki/decisions.md
updated: 2026-08-02
tags: [task-030, whatsapp, adr-158, spike, local-plane, desktop-shell]
---

# TASK-030 — the WhatsApp session as an invisible engine

Approved under AP-091 / ADR-158. Tier C.

## 0. Base correction

The handed-over worktree was at `1be17e1`, not `b68f02d`. The branch
`claude/whatsapp-module-contact-extractor-9cfff3` was at `b68f02d` as expected,
so this work branched from that tip as `task030-hidden-engine`. This is the
third stale base reported on this task; the pattern is the worktree, not the
branch.

---

## 1. SPIKE RESULT — a hidden WKWebView keeps its session

**Answer: option 1 works. `.visible(false)` is sufficient. Offscreen
positioning is not needed and was not the deciding factor.**

### What was measured

Speculation was not going to settle this, so it was measured. A Swift harness
(`AppKit` + `WebKit`, ~90 lines) creates an `NSWindow` containing a `WKWebView`
in three conditions and, after a fixed interval, reads counters out of the page
with `evaluateJavaScript`:

- `visible` — window ordered in, on screen
- `offscreen` — ordered in at x = −20 000
- `hidden` — **never ordered in at all**, the `.visible(false)` case

The page, served by a local dependency-free Node server, counts two independent
things:

- `timerTicks` — a 250 ms `setInterval`: page-driven activity WebKit throttles
- `ssePushes` — server-pushed events every 500 ms over one long-lived HTTP
  connection: **server-driven delivery, which depends on no page timer**

SSE stands in for WhatsApp's WebSocket deliberately. Both are a single
long-lived connection whose delivery is driven by the far end, so neither
depends on a page timer — which is exactly the property in question.

### Results

Run A ran as a background process, so App Nap throttled all three conditions
identically and the comparison was worthless. Run B suppressed App Nap with
`ProcessInfo.beginActivity(.userInitiated, .latencyCritical)`, which is also the
more faithful condition — the real Bridge app is a foreground app doing
user-initiated work.

| condition | duration | timer ticks (expected) | server pushes (expected) | connection | host `eval` |
|---|---|---|---|---|---|
| hidden | 90 s | 13 (360) | 50 (180) | open | OK |
| offscreen | 90 s | 12 (360) | 68 (180) | open | OK |
| visible* | 90 s | 13 (360) | 16 (180) | open | OK |
| **hidden** | **600 s** | **41 (2 400)** | **1 094 (1 200)** | **open** | **OK** |

\* the `visible` window reported `occlusionState` without `.visible` in every
run — the user's own windows covered it — so there is no clean fully-foreground
control. That limitation is stated rather than papered over.

### What this establishes

1. **The connection survives invisibility, at essentially full rate.** Over ten
   minutes in a window that was never ordered in, 1 094 of an expected 1 200
   server pushes arrived — 91 % — and the last one landed in the same
   millisecond as the final measurement. The stream was still `open`. Background
   network delivery to a hidden WKWebView is not meaningfully throttled.
2. **Page timers ARE throttled, to roughly one tick per 15 seconds** (41 in
   600 s). This is real and must be designed around.
3. **Timer throttling is not caused by hiding.** The never-ordered-in window
   ticked the same as the ordered-in ones (13 / 12 / 13). Occlusion drives it,
   and any Bridge window that is not frontmost is already occluded.
4. **`evaluateJavaScript` from the host works throughout**, with zero errors, in
   the hidden window. This is the load-bearing one: Bridge can drive the session
   from Rust on demand regardless of what the page's own timers are doing.

### Why the design is sound

The architecture must not depend on in-page timers, and it does not. Liveness is
polled from the **main** window — which is visible and unthrottled — through
`whatsapp_status`, which `eval`s into the session on a 3-second host-side
interval. Reads are host-initiated the same way. The one thing that has to
survive in the hidden webview is the socket, and the socket survives.

There is also a strong pre-existing argument: **the product already relies on
this.** `whatsapp_hide` is called on unmount and route change today, and the
session is expected to stay linked across that. Making the window permanently
hidden does not enter a new regime; it makes the existing one continuous.

### Residual risk — needs a live run

WhatsApp Web's *own* client-side keepalive runs on page timers, which are
throttled to ~1/15 s. Whether WhatsApp's server tolerates that indefinitely is
not answerable from a synthetic probe. This is the one open question.

**Procedure to settle it (user, ~30 minutes, no code change required):** the
current build already produces the exact condition. On the running `tauri dev`,
open the WhatsApp Module Page so the session links and goes live, then navigate
to any other Page — `whatsapp_hide` runs and the session is now hidden exactly
as the new design leaves it. Wait 30 minutes without returning. Then navigate
back. If the status line reports `CONNECTED` with a non-zero chat count and no
QR code, a hidden session holds and the design is confirmed end to end. If it
demands re-linking, report that and the fallback is a periodic 1-pixel
show/hide from the host, which the probe suggests is unnecessary.

### Rust: NOT changed, as instructed

`whatsapp_webview.rs` is untouched — `git diff` against `b68f02d` shows no
change to it. The spike needed no edit to it, because the invisible state is
reachable through the commands that already exist: `whatsapp_open` at a parked
rect followed by `whatsapp_hide`. `engine.ts`'s `ensureHiddenSession()` does
exactly that, so **the hidden engine works today with zero Rust changes**.

The optional one-line polish, for the parent to apply after the sibling merges,
removes the sub-frame flash before the hide lands — in `ensure_window`, on the
builder chain (around line 1021), add:

```rust
        .visible(false)
```

and in `whatsapp_open` (line 1221) drop `let _ = window.show();`, moving the
show into the linking path only. This is cosmetic. The design does not need it.

---

## 2. Message sync into the Local Plane

Track C built the store; nothing populated it. The path now exists end to end:
`wa-js read op → WhatsAppEngine → sync orchestrator → tRPC → Local Plane`.

**`platform/modules/whatsapp/src/messages.ts`** — pure mapping and cursor
arithmetic, 27 new tests.

- `senderOf` is the identity guard. `fromMe` → `self` with no key. A `@lid`
  author → `whatsapp-lid:<id>`, and `toE164` is never reached for it. Only a
  `@c.us` author can become `whatsapp:+<E164>`. **Everything else — a group id
  where an author was expected, a broadcast, a newsletter, an absent sender, or
  bare digits with no suffix — is `unknown` with no key.** Bare digits are
  called out specifically: that is the laundered shape that fabricated 4 203
  numbers, and it now resolves to "unknown", not to a plausible number.
- Bounded history is modelled, not hidden: each cursor records
  `oldestTimestamp`, so the surface states where the history it holds begins.
- Incremental: per-chat watermark, `newMessagesSince` re-filters so an inclusive
  read op cannot re-write stored rows, `chatsDueForSync` skips chats with no new
  activity, unrecognised persisted state resets rather than half-trusting a
  cursor.

**`platform/apps/api/src/router.ts`** — `whatsapp.ingestMessages`,
`whatsapp.syncState`, `whatsapp.thread`, `whatsapp.searchMessages`.

- Bodies are written to `localPlane.graph.putMessages` and nowhere else. No
  dual-write, no promote path. Stated as a block comment at the top of the
  section.
- **The cursor advances only after the write succeeds.** A failed write
  re-reads a window next run; the other order would skip permanently.
- Two independent identity checks now guard the same path: `senderOf` at
  mapping, `assertMessageShape` at the store boundary. Deliberate redundancy.
- Sync cursors live in `localPlane.state` under `whatsapp:message-sync`.

**`platform/apps/web/src/app/pages/whatsapp/sync.ts`** — the orchestrator.
Sequential (parallel bursts against a personal number draw enforcement, and the
shell serialises anyway), newest-activity-first (so an interrupted run has
synced what the user is most likely to open), per-chat commit, page budget per
chat, and a `shouldStop` checked between chats.

**`platform/apps/desktop/src-tauri/src/whatsapp_message_ops.rs`** — a NEW file,
not an edit to the sibling-owned one. Holds `list_chats` and `list_messages`,
their id/integer validation, and 10 Rust tests. Tested properties include: the
chat-list op carries no message body (a scheduling read must not become a bulk
content read), and the message op never splits an id into digits.

---

## 3. The Bridge-native chat surface

`ChatsSurface.tsx` is rewritten. No webview placeholder, no pinned child window
on the normal path.

- Bridge components and CSS variables throughout. **No green, no bubble tails,
  no delivery ticks, no wallpaper** — this is explicitly not a WhatsApp replica.
- The message list is virtualised with `@tanstack/react-virtual` (MIT), with
  `measureElement` for real per-row heights, because message length varies too
  much for a fixed estimate.
- Full-text search from `messages.ts` is wired in, including the honest note
  when the store reports no `pg_trgm` — a silently degraded search is
  indistinguishable from "no matches".
- Honest empty states, four of them, all distinct: not on desktop; nothing
  synced yet; thread empty; and "this build of the shell cannot read messages
  yet". No conversation is ever fabricated.
- The composer is present but visibly disabled with a stated reason, rather than
  looking usable — interactive-looking UI must perform, open, or explain.
- Device linking is the ONE moment the session becomes visible, with a stated
  reason (a human has to scan a QR code) and it hides itself the moment the
  socket connects. Enforced by test: `showSession` has exactly one call site.

The Tools Page and Contact Extractor are untouched and still pass their tests.

---

## 4. THE HANDOFF — one line

Everything above is merged-ready except one line, deliberately left out because
`whatsapp_webview.rs` is under concurrent change. In `script_for_op`, change the
fallthrough arm (line 473):

```rust
        _ => None,
```

to:

```rust
        _ => crate::whatsapp_message_ops::script_for_message_op(op, arg),
```

Until that lands the shell refuses `list_chats` / `list_messages` by name, and
the app says so honestly — `isOpRefused` turns the refusal into "this build of
the Bridge desktop app cannot read messages yet", not a failure the user has to
interpret. A test asserts that this remains true for as long as the delegation
is absent.

Optionally also add the two `MESSAGE_WPP_DEPENDENCIES` entries to
`WPP_DEPENDENCIES` so the health tripwire covers `WPP.chat.getMessages`.

---

## 5. Evidence — what is actually verified

**Verified by test (ran, passed):**

- `@bridge/whatsapp` — 114 pass (87 baseline + 27 new). `messages.js` at 100 %
  line / 93.8 % branch coverage. Includes the LID-laundering regression case.
- `@bridge/web` — 120 pass (115 baseline + 5 new), 0 fail.
- `bridge-desktop` Rust — 10/10 in `whatsapp_message_ops`, crate compiles.

**Verified by compilation only:**

- The tRPC procedures typecheck and the whole workspace builds, but no
  integration test drives `ingestMessages` against a real pglite store. The
  store's own guards are Track C's tests; the wiring between them is not
  covered end to end.
- `ChatsSurface.tsx` typechecks and the web bundle builds. It has not been
  rendered — the source-level tests assert structural properties (hidden on
  mount, one `showSession` caller), not visual behaviour.

**Needs a live run (`tauri dev`, which was not run):**

- The 30-minute hidden-session persistence check in §1.
- Whether `list_chats` / `list_messages` return usable shapes against real
  wa-js. The scripts follow the same idioms as the existing ops and the
  dependencies are declared, but wa-js is a moving target and only a live
  session proves the shape.
- Whether the virtualised list performs on a real archive.

---

## 6. Honest limitations

- The `visible` control in the spike was occluded in every run, so the
  measurement compares hidden against occluded-visible, not against true
  foreground. The 10-minute hidden run stands on its own regardless: 91 %
  delivery over an invisible connection is the fact that matters.
- SSE is not a WebSocket. Both are single long-lived server-driven connections
  and neither depends on a page timer, but they are not identical.
- No media is downloaded. Attachments are described (kind, mime, name, size)
  and never carry a URL, because a stored remote URL turns opening a message
  into a fetch that leaks a read receipt.
- pglite writes to a directory in the user's home. Encryption at rest is the
  user's FileVault setting, not a guarantee Bridge makes — as Track C already
  recorded.

## 7. Unrelated pre-existing failure, reported not fixed

`pnpm check:vocabulary` fails at `b68f02d`, before any change here, on three
tool-identifier fingerprints in `packages/research/test/engine.test.ts`
(`changed from 0 to 6 / 2 / 1`). Nothing in this branch touches
`packages/research` — `git diff --name-only b68f02d..HEAD` returns no file under
it. Left alone deliberately: it belongs to TASK-028's surface, not this one, and
guessing at a fingerprint migration from outside that work is how a check gets
silenced rather than fixed. Flagged here so it is not mistaken for a regression
from this branch.
