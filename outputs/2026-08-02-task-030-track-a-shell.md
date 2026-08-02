# TASK-030 Track A — WhatsApp desktop shell (ADR-158, AP-091)

Date: 2026-08-02
Scope: `platform/apps/desktop/src-tauri/` only — `whatsapp_webview.rs`, `Cargo.toml`.
`lib.rs` and `capabilities/default.json` were **not** changed (see A4).

Evidence tiers used throughout, deliberately kept apart:

- **VERIFIED BY TEST** — a `cargo test` assertion fails if it stops being true.
- **VERIFIED BY COMPILATION** — the type checker accepted it; runtime behaviour unproven.
- **VERIFIED BY SOURCE** — read out of the pinned dependency's own source, not from docs or memory.
- **UNVERIFIED** — needs a human at the keyboard with a live WhatsApp session.

`cargo check --all-targets` clean, no warnings. `cargo test` 102 passed / 1 ignored
(was 84 + 1 ignored at the V11 sweep). The 6 pre-existing WhatsApp tests all still pass;
12 new ones added. `cargo clippy --all-targets` introduces no new warning — the one
remaining hit in this file (`assertions_on_constants` at `payloads_over_the_cap_are_refused`)
pre-dates this work and was left alone.

`tauri dev` was NOT run, per instruction.

---

## A1(a) — `on_download`: code written, defect NOT demonstrated fixed

An `on_download` handler is now registered on the session webview builder. wry only wires
up the platform download machinery when a handler exists, which is why the control was inert.

- Destination is pre-filled with an **absolute** path under the user's Downloads directory
  (`path().download_dir()`, falling back to `home_dir()/Downloads`).
- An existing file is **never** overwritten: `disambiguate` walks `name (1).ext`,
  `name (2).ext`, … up to 999, then falls back to a random hex suffix rather than clobbering.
- The proposed name is treated as hostile third-party input. `sanitize_download_name` reduces
  it to one path segment — every `/` and `\` stripped, so `../../../etc/passwd` becomes
  `passwd`; control characters and `:` removed; length capped at 120 bytes keeping the
  extension; empty/`.`/`..` fall back to a fixed name.
- Name preference order: platform proposal → percent-decoded last URL path segment → fallback.
- Refuses the download (returns `false`) rather than guessing if no Downloads directory
  resolves or cannot be created.
- Logs the **directory only**. File names come from private conversations and do not belong
  in a log line.
- `DownloadEvent` is `#[non_exhaustive]`; the catch-all arm returns `true` so a future
  variant does not silently become a refusal.

**Status: NOT demonstrated fixed.** VERIFIED BY TEST covers the pure policy
(`download_names_are_reduced_to_one_safe_segment`, `download_names_prefer_the_proposal_then_the_url`,
`downloads_never_overwrite_an_existing_file`). That a file actually lands on disk when WhatsApp
Web's download control is pressed is UNVERIFIED and needs a live run. The BUGS entry should stay
open until someone downloads a real attachment.

## A1(b) — `data_store_identifier`: code written, does NOT explain the storage error

The session webview now gets its own persisted WKWebView data store.

- A v4 UUID is persisted at `{app_data_dir}/bridge/whatsapp-data-store-id` and reused across
  launches. Persistence is load-bearing: a fresh UUID each launch would hand the session an
  empty store and force a re-link every time.
- Guarded to macOS >= 14 via `NSProcessInfo.operatingSystemVersion().majorVersion`, which
  required adding the `NSProcessInfo` feature to `objc2-foundation`. VERIFIED BY SOURCE that
  wry guards this too (`wkwebview/mod.rs:223`, `custom_data_store_available = os_major_version >= 14`,
  falling back to `defaultDataStore`), so an older macOS degrades rather than crashing. The
  check is repeated in our code anyway so the requirement is visible here and the log line
  states honestly which store was used.
- The nil UUID is explicitly avoided. `WKWebsiteDataStore(forIdentifier:)` raises an
  Objective-C exception on it — one Rust cannot catch, so it would take the app down. This
  matches whatRust's own note ("fall back to a freshly generated non-nil UUID rather than
  risk the nil-UUID exception").
- A corrupt or unreadable id file is rejected and re-minted with a log line, not half-parsed.

**Does this explain `aquire-persistent-storage-denied`?** *Honestly: I do not know, and I
lean towards no.* The BUGS entry called it "the leading candidate"; I could not raise its
confidence and would now rate it lower than the entry implies:

- The error string is emitted by WebKit's storage quota path, not by data-store selection.
  A webview using the default store is a perfectly normal configuration that does not
  ordinarily produce it.
- The earlier restart test showed the session surviving. That was correctly read as "*a*
  store persisted" — but it also means the default store was working, which is evidence
  against a data-store-identity cause.
- The plausible mechanism, if there is one, is quota/attribution rather than identity: an
  app-bound default store shared with other Bridge webviews may attribute quota differently
  than a dedicated one. That is a hypothesis, not a finding.

**Do not mark this defect resolved on the strength of this change.** The correct next step is
a live run that checks whether the console error is still present. If it is, the fix is still
worth keeping — per-session store isolation is right on its own merits — but the error needs
a separate root cause.

## A2 — `health` operation

`health` is added to the `script_for_op` allowlist. It is read-only: it walks `window` by
path, reads `typeof`, and calls only two cheap probes.

The dependency list is a single Rust constant, `WPP_DEPENDENCIES`, which is both the script's
input and the test's input:

| path | expected `typeof` | shape probed |
|---|---|---|
| `WPP.contact.list` | function | no |
| `WPP.contact.getPnLidEntry` | function | no |
| `WPP.group.getAllGroups` | function | no |
| `WPP.group.getParticipants` | function | no |
| `WPP.whatsapp.ChatStore.getModelsArray` | function | yes — must return an array |
| `WPP.whatsapp.Socket` | object | yes — `.state` must be a string |
| `WPP.on` | function | yes (existence; used by the A3 listener) |

Result shape: `{ ok, waJsVersion, missing[], degraded[], checks[] }`, where each check carries
`shapeProbed` so the caller can tell an existence check from an exercised one. The three
expensive reads are existence-checked only and say so — `WPP.contact.list` measured ~2 minutes
on the real account, so probing its shape at session start would turn the tripwire into the
outage it exists to prevent. That is a real limitation of this tripwire: it catches a function
*disappearing*, not a function *changing what it returns*.

Tests (VERIFIED BY TEST):

- `v1_op_allowlist_is_read_only` — `health` added to the allowed set. The refused set is
  unchanged and still refuses everything it refused before, plus `session_events` (reserved
  for the push channel; the page volunteers it, nothing may request it).
- `health_covers_every_wpp_dependency` — extracts every `WPP.…` path from every op script
  *and* the A3 listener, and fails if any is not declared in `WPP_DEPENDENCIES`. A new WPP
  dependency added without declaring it breaks the build. This is the part that keeps the
  tripwire honest over time.
- `health_calls_nothing_expensive_and_nothing_that_writes`.

Not wired to run automatically at session start — that is a web-app-side call and belongs to
whoever owns the `WhatsAppEngine` interface. The Rust side is ready.

## A3 — batched push event channel

`WPP` events → in-page batcher → cancelled `bridge-wa:` navigation → Rust → Tauri event
`whatsapp://session-events`, emitted **to the main window only**.

In-page (`event_listener_script`): buffers events, coalesces in place by `(kind, key)` so the
last value wins while first-seen order is kept, and flushes on whichever comes first —
750 ms interval or 64 buffered events. Subscribes to `chat.active_chat` (the active chat
changing, which is the event this channel exists for), `chat.new_message`,
`chat.msg_ack_change`, `conn.main_ready`. Polls for `WPP.on` for 60 s because wa-js injects
before WhatsApp's own bundles finish; gives up quietly, since a missing event channel degrades
the dashboard rather than breaking the session. Flushes on `pagehide`.

Rust re-applies the whole policy in `coalesce_events`. This duplication is deliberate and is
the only place the policy actually *binds*: the batcher runs inside WhatsApp's origin, so a
drifted or hostile script could flood or forge the channel. Rust drops kinds outside a fixed
allowlist (`active_chat`, `message`, `chat_state`, `connection`), re-coalesces, and caps at
256 events per batch. Malformed bodies yield an empty batch rather than an error — nobody is
waiting to be told the page sent nonsense.

Security boundary intact: the session webview is still absent from
`capabilities/default.json` and still has no Tauri IPC. The channel reuses the existing
cancelled-navigation mechanism; nothing new was opened. A test asserts the injected script
contains no `__TAURI__`, `invoke(`, or `tauri://` surface.

Tests (VERIFIED BY TEST): coalescing keeps the last value per slot in first-seen order;
distinct keys are not collapsed; disallowed and empty kinds are dropped; batches are capped
regardless of what the page sends; malformed JSON yields nothing; the injected script carries
both flush triggers and in-place coalescing.

UNVERIFIED: that `chat.active_chat` and the other three are the correct current wa-js event
names, and that the batch actually arrives. Those need a live session.

---

## A4 — Tauri `unstable` child-webview spike: **RECOMMEND ABANDON**

Timeboxed, spike code written and reverted. Nothing from A4 is committed.

### What holds

1. **API surface transfers — VERIFIED BY COMPILATION.** With `features = ["unstable"]`, a
   `WebviewBuilder` carrying `.user_agent()`, `.initialization_script()`, `.on_navigation()`,
   `.on_download()` and `.data_store_identifier()` is accepted by
   `Window::add_child(builder, position, size)`. A throwaway `spike_a4.rs` compiled cleanly,
   then was deleted.
2. **`unstable` does not break the build — VERIFIED BY COMPILATION.** Turning the feature on,
   the whole shell including `tauri-nspanel` 2.1.0 `cargo check --all-targets` clean. That is a
   compile-time result only and says nothing about panel runtime behaviour.

### What does not hold

3. **The capability exclusion does NOT carry over to webviews — VERIFIED BY SOURCE.** This is
   exactly the thing I was told not to assume, and the assumption is wrong. From
   `tauri-utils/src/acl/capability.rs`: if a window label matches `windows`, "the capability
   will be enabled on all the webviews of that window, **regardless of the value of**
   `webviews`". Confirmed at the resolution site, `tauri/src/ipc/authority.rs:459` —
   `cmd.webviews.iter().any(...) || cmd.windows.iter().any(...)`. Our `default.json` uses
   `"windows": ["main", "overlay*", "annotate*"]`, so a WhatsApp webview inside the main
   window would be covered by `core:default`.

   There is a second barrier that would still hold: `default.json` declares no `remote` block,
   so its context is `Local`, and `Origin::matches` (`authority.rs:57`) never matches a remote
   origin against a local context — `web.whatsapp.com` would still be refused. But that reduces
   the boundary from **two independent barriers** (no capability entry *and* remote origin) to
   **one**, and it fails silently the day anyone adds a `remote` block to the default
   capability. Mitigable by rewriting `default.json` to use `webviews` instead of `windows`.
   I did not make that change — it is a governed, cross-cutting edit and A4 is not proceeding.

4. **The migration is far more invasive than "change the builder" — VERIFIED BY SOURCE. This
   is the finding that decides it.** `Window::is_webview_window()`
   (`tauri/src/window/mod.rs`) is:

   ```rust
   self.webviews().iter().all(|w| w.label() == self.label())
   ```

   and `Manager::get_webview_window()` (`tauri/src/lib.rs:576`) returns `None` unless that
   holds. The moment `main` hosts a second webview labelled `whatsapp-session`,
   **`app.get_webview_window("main")` returns `None`.** There are 22 `get_webview_window`
   call sites in the shell. The `MAIN_LABEL` ones do not error — they take `None` branches
   that fall back to `(0.0, 0.0)` origins or skip work — so this would degrade *silently*,
   which is the same failure mode as the off-screen-window bug this Module already hit once.
   `whatsapp_webview::position()` and `ensure_window()`'s `parent()` lookup are among them.
   This is not a window-construction change; it is a shell-wide refactor of how the main
   window is resolved.

5. **The hard stop cannot be discharged.** Whether `tauri-nspanel` and the Avatar overlay
   still work is **UNVERIFIED and unverifiable without a live run.** The overlays are separate
   single-webview windows, so `to_panel()` should be structurally unaffected — but "should be"
   is not the standard the hard stop sets, and `overlay.rs` does call
   `get_webview_window(MAIN_LABEL)`, which finding 4 says would start returning `None`.

6. **Also UNVERIFIED, all needing a live run:** that the child webview is clipped by the parent
   window rather than overlapping Bridge chrome; that the Safari UA still suppresses the
   unsupported-browser wall in practice; that wa-js still injects; that the navigation
   allowlist and the `bridge-wa:` outbound channel still fire.

### Recommendation

**Abandon the multi-webview approach; keep today's parented child window.** Two independent
reasons, either sufficient: the hard-stop condition cannot be cleared without a live run, and
finding 4 makes this a shell-wide refactor whose main risk is silent degradation rather than a
loud failure. Per the instruction to say so rather than half-migrate — saying so.

A negative result, but a real one: findings 3 and 4 are properties of the pinned Tauri version,
not guesses, and both would have been easy to discover only after the migration.

---

## Follow-ups for whoever owns those files

I did not touch these — they are outside my assigned ownership.

- `docs/BUGS.md` "OPEN 2026-08-02" needs updating: both defects have code written, **neither
  is demonstrated fixed**, and the entry's claim that `data_store_identifier` is "the leading
  candidate" for `aquire-persistent-storage-denied` should be *weakened*, not resolved, on the
  reasoning above.
- The web app should call the `health` op at session start and surface a degraded state.
- The dashboard should listen for `whatsapp://session-events`.
- If A4 is ever revisited, `capabilities/default.json` must move from `windows` to `webviews`
  **first**, as a separate reviewed change.
