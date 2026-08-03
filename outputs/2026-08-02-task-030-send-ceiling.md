# TASK-030 — the Rust-enforced send ceiling and the first write op

**Date**: 2026-08-02 · **Tier**: C · **Approval**: AP-091 (applied), ADR-158 + this session's addendum
**Branch**: `task030-send-ceiling`, based on `b68f02d`

## What was wrong

ADR-158 says the rate ceiling is enforced in Rust "because a renderer-side cap is bypassable and a
cap that does not bind is not protection". Track C shipped only the TypeScript half. Until this
change the cap lived entirely in the renderer — the exact arrangement the decision rejects — and
TASK-030's exit test, which asserts the daily cap holds *when the renderer is bypassed*, could not
pass.

## Base check

The worktree I was handed was on `1be17e1`, **not** the required `b68f02d`. The branch
`claude/whatsapp-module-contact-extractor-9cfff3` was checked out in another worktree, so I created
`task030-send-ceiling` at its tip (`b68f02d "Integrate TASK-030 tracks A/B/C…"`) and worked there.

## What was built

| File | What it is |
| --- | --- |
| `platform/apps/desktop/src-tauri/src/whatsapp_send.rs` | New. The binding ceiling: limits, durable ledger, `check_ceiling`, halt/re-arm. |
| `platform/apps/desktop/src-tauri/src/whatsapp_webview.rs` | `script_for_write_op`, `escape_js_string`, `is_sendable_target_id`, and the `whatsapp_send_*` commands. |
| `platform/apps/desktop/src-tauri/src/lib.rs` | Registers the five new commands and `SendCeilingState`. |
| `platform/modules/whatsapp/src/outbound.ts` | New. `performAutomatedSend` — the one place the send ORDER is written down. |
| `platform/apps/web/src/app/pages/whatsapp/whatsapp-shell.ts` | Send transport (start-then-poll), ceiling status, halt, re-arm. |
| `platform/apps/web/src/app/pages/whatsapp/engine.ts` | `sendAutomatedMessage` and the private `sendPort`. |

No UI was added. There is no send surface yet; this is the path a surface will consume.

### Task 1 — the write operation

Start-then-poll (`whatsapp_send_start` / `whatsapp_send_poll`), because a send can stall behind a
reconnect and a command answering after ~60s aborts the whole app under WKWebView (BUGS 2026-07-30).

The renderer supplies three strings and nothing else: a target id, a recipient key and a body. It
cannot supply JavaScript and it cannot supply a count.

- The **target id** is shape-validated in Rust before interpolation, the way `is_group_id` already
  validates the one read argument: a bare numeric user on `c.us`, `lid` or `g.us` (hyphens permitted
  for groups), ≤64 characters. Anything else never becomes a script.
- The **body** cannot be shape-validated, so it is escaped. `"` `\` `'` `` ` `` `<` `>` `&` `/`,
  everything below U+0020, U+007F, and U+2028/U+2029 all become `\uXXXX`. A numeric escape has no
  meaning to an HTML tokenizer or a second parse, so there is no layer where the character reappears.
  Ordinary text — including Devanagari, Japanese and emoji — passes through untouched.

**The obsolete test was rewritten, not deleted.** `v1_op_allowlist_is_read_only` became
`the_read_op_allowlist_is_closed_and_still_has_no_write`. It still asserts that `script_for_op` —
the function `whatsapp_extract_start` calls — refuses `send_message`, `eval`, `Function`, arbitrary
expressions, the empty string, whitespace, case variants and every name not listed, with and without
an argument. A companion test, `the_send_op_is_reachable_only_through_the_gated_path`, asserts the
send script exists only behind `script_for_write_op` and that no other write op name resolves to
anything. The guarantee moved; it was not removed.

### Task 2 — the Rust-enforced ceiling

`SEND_LIMITS` mirrors the four fields of `SEND_POLICY_LIMITS` that this layer enforces: `dailyCap`
30, `recipientCooldownDays` 7, `warmUpFirstDayCap` 5, `warmUpDailyIncrement` 5. Rust binds;
TypeScript stays advisory so the UI can explain and schedule.

Three rules, refused with a structured `{ code, message, earliestAtMs? }`:

- `WHATSAPP_SEND_DAILY_CAP` — rolling 24h, warmed up from the link date.
- `WHATSAPP_SEND_COOLDOWN` — per recipient.
- `WHATSAPP_SEND_HALTED` — sticky. It carries **no** `earliestAtMs`, because there is no instant at
  which it clears. `rearm` is the only transition back and it refuses an empty name.

**Durability.** State lives in `{app_data_dir}/bridge/whatsapp-send-ledger.json`, written
temp-then-rename — the same mechanism `overlay.rs` already uses for persisted positions, found rather
than invented. A managed Tauri struct was rejected because it dies with the process, which is the
bypass being defended against.

Four decisions worth naming, all recorded in the decisions log:

1. A **corrupt** ledger comes back **halted**, not empty. Otherwise damaging the file would zero the
   day's counter — the same class of bypass as restarting.
2. The send is **counted before it is attempted**, and a send that cannot be counted is not sent.
   Recording on success would let a crash mid-send return the slot.
3. The ledger holds `sha256(recipient key)` and **no** message content or phone numbers. The cooldown
   needs sameness, not identity.
4. The rolling window has an **open upper bound** — a record stamped in the future still counts — so
   winding the system clock back does not free slots.

### Task 3 — the gate

`performAutomatedSend` runs: policy refusals → `decideSend` → Rust ceiling → send. Track C's ordering
is preserved exactly and for their stated reason, which I read before changing anything: policy
refusals run before `decideSend` so a first-contact message or a send during a halt never becomes an
approval prompt. A refused or deferred decision never reaches the shell at all. When the shell's
durable ledger disagrees with the renderer's advisory copy, the shell wins.

## Verification

| Claim | How |
| --- | --- |
| Rust and TypeScript limits cannot drift | **Verified by test** — `limits_match_the_typescript_copy` parses the real `policy.ts`. I changed `dailyCap` to 31 and confirmed the test FAILS, then reverted (`git diff` clean). |
| The daily cap binds exactly at its boundary | **Verified by test** — send 30 allowed, 31 refused. |
| The cap still binds across a restart | **Verified by test** — `the_cap_still_binds_after_a_restart` spends the allowance, writes the ledger, drops every in-memory structure, re-reads from disk exactly as a fresh process would, and asserts the next send is refused. This genuinely proves the property: the second block shares nothing with the first but the file path. |
| A halt survives a restart and never times out | **Verified by test** — re-read 30 days later, still halted; checked at +0, +1 day, +365 days. |
| A corrupt ledger fails closed | **Verified by test** — malformed JSON yields a halted ledger. |
| Clock rollback does not free slots | **Verified by test**. |
| The ledger leaks no identifiers | **Verified by test** — serialised ledger contains neither the phone number nor the recipient key. |
| A hostile body cannot break out of its string | **Verified by test** — 13 adversarial bodies (quote-escape, trailing backslash, newline, CRLF, `</script>`, `</SCRIPT >`, template literal, U+2028, U+2029, NUL, DEL). Asserts the escaped form contains no `"`, newline, backtick, `<`, `>` or line separator, and that every backslash is a complete `\uXXXX` — the trailing-backslash case is what defeats a naive escaper. |
| Target ids are validated before interpolation | **Verified by test** — 11 hostile/malformed ids refused. |
| Read path still refuses `send_message` | **Verified by test**. |
| The engine cannot reach the transport except through the gate | **Verified by test** — source-level, counts `sendMessage` occurrences in `engine.ts`. |
| Everything compiles | **Verified by compilation** — `cargo check --all-targets` clean, zero warnings. |
| The write op actually sends a WhatsApp message | **UNVERIFIED.** Nothing has run against a live session. `tauri dev` was deliberately not started (the user is running it). No message has been sent by this code, and the `WPP.chat.sendTextMessage` call shape is verified only against the wa-js API surface, not observed working. |
| The exit test's cap assertion | **Partially discharged.** The cap is now proven to bind at the Rust layer, including across a restart, in test. Walking the exit test on a live account remains undone. |

### Test counts

- Desktop Rust: **120 pass**, 0 fail, 1 ignored (was 102 + 1 ignored). `cargo check --all-targets` clean.
- `@bridge/whatsapp`: **95 pass** (was 87), coverage 99.13% lines against the 70% gate.
- `@bridge/web`: **120 pass** (was 115).

Note on the module: `node_modules` was absent in this worktree, so `pnpm install --filter` was run for
`@bridge/whatsapp` and `@bridge/web` before building. `platform/apps/web`'s `tsc --noEmit` reports
314 pre-existing errors from unbuilt sibling workspace packages (`@bridge/research` unresolved, etc.)
— the known fresh-worktree noise. **Zero** of them are in any file this change touched; verified by
filtering the output for `pages/whatsapp`.

## Honest gaps

- **Nothing has run live.** The single most important caveat.
- **Deleting the ledger file resets the counter** to a warm-up-day-one allowance of 5/day. On a
  machine whose owner has filesystem access this is not defensible, and it is stated rather than
  papered over. Restarting the app — the bypass the task named — does not reset anything.
- **The send path is not covered by the session-start health tripwire.** `WPP.chat.sendTextMessage`
  was deliberately kept out of `WPP_DEPENDENCIES` so the health op keeps its tested "mentions no send
  function" guarantee. The trade: wa-js drift in the send path surfaces on first send, not at link
  time. `WPP_WRITE_DEPENDENCIES` exists with its own drift test, and the script is built from that
  constant so the declared path is the path actually called.
- **The `MAX_SEND_BODY_CHARS` check counts Unicode scalars** while `send.ts`'s `MAX_BODY_LENGTH`
  counts UTF-16 code units. They agree on ordinary text and diverge only for astral characters near
  the 4,096 boundary, where Rust is the more permissive of the two by at most a factor of two. Not
  security-relevant; noted so it is not discovered as a surprise.
- **No UI, no scheduler.** `delaySeconds` is returned, not slept on; whoever builds the automation
  surface must honour it or the pacing is lost.
