# WhatsApp Module

**TASK-029 IN PROGRESS.** Nav entry → owner's own WhatsApp Web session inside desktop shell. Tools = add-on Page.

## Shape

- **Chats Page** — real `web.whatsapp.com` in contained Tauri webview, pinned to Page rect. Reads as embedded.
- **Tools Page** — Tool registry. v1 = **Contact Extractor**.
- Extraction stages People/Communities **directly** on Local Plane — no draft-then-approve. Only sends gated (`decideSend`).
- Desktop only. Browser/mobile = honest unavailable state. Browser cannot host session: WhatsApp refuses framing, no cross-origin injection.

## Engine

Vendored + SHA-256-pinned `@wppconnect/wa-js` (Apache-2.0) injected at document start. Runs WhatsApp's OWN client code → lowest enforcement exposure of the options. NOT whatsapp-web.js (bundles Chromium), NOT Baileys (reimplements protocol), NOT own scraping (brittle). See [decisions](decisions.md) ADR-157.

## Containment

Same pattern as research webview + narrower:

- Window label absent from capabilities → no Tauri IPC on page.
- Navigation: `whatsapp.com`/`whatsapp.net` ONLY. Live authenticated session — open redirect must never carry it out.
- Outbound-only reporting via cancelled `bridge-wa:` navigation.
- **Op allowlist** (`script_for_op`): web app names an op, never supplies JS. Group ids validated before interpolation.
- `build.rs` fails build on wa-js hash mismatch.

v1 read ops: `list_contacts`, `list_groups`, `group_participants`, `list_direct_chats`, `pn_lid_map`.

## Three facts you must know

1. **UA.** WKWebView default UA → WhatsApp "update Safari" wall. Needs explicit Safari `Version/` token. Load-bearing.
2. **Session persists** across restart despite logged `aquire-persistent-storage-denied`. Error is noisy, not fatal.
3. **Liveness ≠ `WPP.isReady`.** That flag flips false after socket connects. Live = CONNECTED socket + populated chat store. Reading earlier → "sendIq called before startComms".

## LID — the big trap

WhatsApp Linked IDs (`@lid`) are **opaque handles, not phone numbers**. Measured live: 4,203 of 8,384 contacts. Splitting one into digits mints a fake phone number.

- `phoneFor` short-circuits on the id — guarding only the suffix is NOT enough, an extractor that strips `@lid` into a `phone` field slips past.
- LID keys (`whatsapp-lid:`) and phone keys (`whatsapp:+E164`) are **disjoint**. Never matched to each other by inference.
- Group membership is LID-addressed, address book largely phone-addressed → `pn_lid_map` bridges them using WhatsApp's OWN mapping.

## Scale forces policy

Live account: 8,384 contacts · 817 groups · 35,298 unique participants · 54,245 memberships · largest group 1,146.

Group membership ≠ relationship. Participant policy: `contacts` / `contacts_and_messaged` (default) / `all`, per-group override. 998 vs 35,298 People — difference between reviewable and useless. Community records full size next to what policy proposed ("52 of 58 known to you").

## Residency

Raw capture + phone numbers **Local Plane only**. `local_people.phones` is local-only (unlike `emails`, which dual-writes). Bulk import → `local_person_lists` roster, **out of the relationship graph**. Cloud canonical needs an explicit separate promote.

## v2 — sending

`decideSend`: **approve per recipient, then trusted**. Grant bound to exact message body → standing trust ≠ blank cheque for later text. Revocation beats any live approval. Malformed/empty = refused, never an approval prompt (don't train click-through).

## Commons

**Withheld**, like `relationship`. Private contact graph out of a third-party session ≠ generalized installable capability.

## ToS

Unofficial automation of personal WhatsApp violates WhatsApp Terms, any library. Reading own contacts = mildest end. Risk accepted knowingly, not mitigated away.

## v2 (TASK-030, ADR-158) — write-enabled, local searchable store

**One account, one browser profile, one wa-js runtime, many surfaces.** The VISIBLE session is the
engine AND execution layer. No second authenticated client — `whatsapp-web.js` as a headless backend
rejected (duplicate session/sync, client races, bigger behavioural footprint).

- **Adapter is two-layer.** TS `WhatsAppEngine` NAMES an op; Rust allowlist owns the script. Web app
  can never supply JS. A test asserts the TS and Rust allowlists match, so they cannot drift.
- **Store**: message bodies on Local Plane, searchable. Core FTS is unconditional; **trigram is not**
  — pglite ships `pg_trgm` but does not offer it, and it must be registered at client construction.
  Worse: a trigram index in a PERSISTED db, reopened without the extension, breaks EVERY query on
  that table including plain `ILIKE`, and the catalog cannot detect it. Probe functionally
  (`SELECT similarity(...)`), never via `pg_extension`.
- `simple` not `english` text-search config (stemming breaks a multilingual address book).
  `word_similarity` not `similarity` (a short query in a long body scores near zero).
- **UI is makeshift**, on `@tanstack/react-virtual`, deliberately NOT a WhatsApp replica. That also
  removes the trade-dress question: functional layout is unprotectable; name/logo/green/wallpaper are not.
- **Write enabled.** `decideSend` decides; policy refusals run BEFORE it so a refused send never
  becomes an approval prompt (do not train click-through on the one prompt that must stay deliberate).
- **Ban protection is behavioural, not the engine.** Consent gate (automation never opens a thread),
  hard daily cap, per-recipient cooldown, no near-identical bodies (Jaccard over char trigrams),
  warm-up, recipient-timezone hours, kill switch that never auto-resumes. Jitter is NOT a cloak.

## Embed: settled — parented child window, NOT a child webview

`unstable` multi-webview ABANDONED (ADR-158 addendum). As a child webview the session LOSES its
capability exclusion: `windows: ["main"]` covers every webview in that window regardless of the
`webviews` field. Also `get_webview_window("main")` returns `None` once main hosts a second webview —
22 call sites, silent `(0.0, 0.0)` fallbacks. A single-window embed costs the security boundary.

## Sync honesty — unknown is not "up to date"

**A chat whose last-activity time cannot be read is scheduled for a READ, never reported as
current.** Cost real time on 2026-08-02: a live 500-chat session synced nothing and said "Everything
is already up to date."

- `list_chats` read the time via `c.lastReceivedKey ? c.t : c.t` — **a ternary whose two arms are the
  same expression**, so one field only. Absent live ⇒ all 500 chats undated.
- The scheduler then DROPPED undated chats, so the queue was empty and rendered as success. The
  success message is what hid the total read failure.
- Now: extraction consults `c.t` / `c.lastMsgTimestamp` / `c.msgs.last().t` and reports **`null`, not
  `0`** — unknown and never must stay distinguishable all the way to the scheduler.
- Undated ⇒ due for exactly ONE read, gated on the store cursor so it converges. Unbounded re-reads
  against a personal number is the behaviour that draws enforcement.
- Outcome statuses are split: `nothing-readable` ≠ `completed`, rendered in the failed colour.
- **Status bar labels its planes** (`N chats on WhatsApp · M stored in Bridge`). The session is
  authoritative about WhatsApp; the store about Bridge. Unlabelled, two true facts read as a
  contradiction.
- `data_store_identifier` was suspected and is **REFUTED** — the identified store holds the live
  `web.whatsapp.com` IndexedDB, the default store has been empty since 2026-07-07, and
  `data_directory` was never used. Nothing was orphaned; no re-link needed.

Health tripwire covers the message ops too (`WPP.chat.getMessages`, existence-only — invoking it
would read a real conversation at session start).

## Recovery (ADR-159)

Splash-wedge incident: invalidated store ⇒ WhatsApp Web splash forever, no shell affordance, manual
`~/Library/WebKit` surgery. Now two named ops, escalation order:

- **Reload** (`whatsapp_session_reload`) — same store, fresh page. Cheap first try. Offered when not
  linked AND when connected-but-chatless.
- **Reset** (`whatsapp_session_reset`) — destroy window, `rename` store dir to timestamped sibling
  (**never delete**; rename failure = typed error, no deletion fallback), clear store-id file ⇒
  next start mints fresh store + QR. Confirm-gated, not-linked state only. Safe on absent
  window/dir/file.
- Send outcomes now recorded through `whatsapp.recordSendOutcome` at the one send site
  (`engine.ts sendAutomatedMessage`). Recording only; audit failure warns, never rethrows.

## Two traps that cost real time

1. **A raw NUL byte in a Rust source makes grep silently match nothing.** Happened here in the event
   batcher's composite key. Compiled fine, 102 tests passed, and every grep against the file holding
   the op allowlist returned a clean-looking empty. Use a JS unicode escape inside raw strings.
2. **Event names**: single colon, kebab (`whatsapp:session-events`). Dotted names have NEVER
   delivered in this codebase (BUGS 2026-07-29). Two parallel tracks picked two different names and
   nothing failed loudly, because the listener degraded silently.

## Relationship link (ADR-159)

- Chat → Person is an EXACT lookup: chat id → `whatsapp:+E164` / `whatsapp-lid:<id>` key →
  `local_people.dedupe_key`. No fuzzy tier, ever. `modules/whatsapp/src/link.ts`.
- Link states: `linked` / `ambiguous` / `unlinked` / `community_unsupported` / `unaddressable`.
  Each is a different sentence on the surface; never collapsed. LID chat + phone Person = unlinked
  — honest, WhatsApp hid the number.
- Ambiguous = `possible_duplicate` Signal committed to `local_entities` (was computed and DROPPED
  by `stageExtraction` before this). Deterministic id per dedupe key → re-runs no-op, no flood.
- API: `whatsapp.relationshipLinks` (all chats + counts), `whatsapp.chatLink` (one),
  `relationship.whatsappTimeline` (a Record's WhatsApp activity: counts/timestamps only — no body,
  no phone, no key crosses the wire).
- Person page Timeline renders a "WhatsApp activity" subsection from the Local Plane, joined at
  RENDER time. WhatsApp rows never become cloud `events` rows — that would break residency.
- Honest limit: cloud↔local person bridge is ID EQUALITY only (Google/Capture mint one uuid for
  both planes). WhatsApp-origin local People have NO cloud row, so their chats have no cloud page
  yet; reported as `no_local_record`/`no_whatsapp_identity`, not as empty activity. Promote path =
  future work.
