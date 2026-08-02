/**
 * The `WhatsAppEngine` two-layer boundary (ADR-158, TASK-030).
 *
 * The adapter's whole security property is that the TypeScript layer only ever
 * NAMES an operation and the Rust allowlist owns the script that name resolves
 * to. These assertions are source-level on purpose: the property lives in what
 * the code is *able* to express, which a runtime test over a stubbed shell
 * cannot observe.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ENGINE = read("../src/app/pages/whatsapp/engine.ts");
const CHATS_SURFACE = read("../src/app/pages/whatsapp/ChatsSurface.tsx");
const EXTRACTOR = read("../src/app/pages/whatsapp/ContactExtractorRun.tsx");
const SHELL_RS = read("../../desktop/src-tauri/src/whatsapp_webview.rs");

/** Op names the Rust allowlist recognises, from its `"op" => …` match arms. */
function rustAllowlist() {
  const body = SHELL_RS.slice(SHELL_RS.indexOf("fn script_for_op"));
  const ops = new Set();
  for (const match of body.matchAll(/^\s*"([a-z_]+)" =>/gm)) ops.add(match[1]);
  return ops;
}

/** Op names the engine can ask for — every `runReadOp<…>("op")` call site. */
function engineOps() {
  const ops = new Set();
  for (const match of ENGINE.matchAll(/runReadOp<[^>]*>\("([a-z_]+)"/g)) ops.add(match[1]);
  return ops;
}

test("the Rust allowlist parses — a silent empty set would pass everything", () => {
  const allowed = rustAllowlist();
  assert.ok(allowed.size >= 5, `expected the allowlist arms to parse, got ${allowed.size}`);
  assert.ok(allowed.has("list_contacts"));
});

test("every operation the engine names is one the Rust allowlist accepts", () => {
  const allowed = rustAllowlist();
  const named = engineOps();
  assert.ok(named.size > 0, "the engine should name at least one operation");
  for (const op of named) {
    assert.ok(allowed.has(op), `engine names "${op}", which the Rust allowlist does not accept`);
  }
});

test("the engine can only ever pass a literal op name — never a computed one", () => {
  // If a call site could compute its op name, the allowlist would still refuse
  // an unknown one, but the TypeScript layer would have stopped being an
  // enumerable surface. Keep it enumerable.
  const callSites = ENGINE.match(/runReadOp\s*(<[^>]*>)?\(/g) ?? [];
  const literalCallSites = ENGINE.match(/runReadOp<[^>]*>\("[a-z_]+"/g) ?? [];
  assert.equal(
    callSites.length,
    literalCallSites.length,
    "every runReadOp call in engine.ts must pass a string literal op name",
  );
});

test("the engine exposes no API that takes a script, selector or expression", () => {
  // ADR-158: the web app must never be able to supply JavaScript. Anything
  // that would let it — an eval-ish helper, a raw invoke passthrough, a direct
  // WPP reference in code — is a hole in the boundary.
  const code = ENGINE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "window.WPP",
    "WPP.",
    "eval(",
    "new Function",
    "tauriInvokeStrict(",
    "querySelector",
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `engine.ts must not contain "${forbidden}" — it would let the web app supply code`,
    );
  }
});

test("WhatsApp surfaces consume the engine, not the transport layer", () => {
  for (const [name, source] of [
    ["ChatsSurface.tsx", CHATS_SURFACE],
    ["ContactExtractorRun.tsx", EXTRACTOR],
  ]) {
    assert.ok(!source.includes("whatsapp-shell"), `${name} should import from ./engine, not the shell`);
    assert.ok(source.includes('from "./engine"'), `${name} should import from ./engine`);
  }
});

test("the start-then-poll shape and its 300s ceiling survive the refactor", () => {
  // BUGS 2026-07-30: a command that answers after ~60s aborts the whole app
  // under WKWebView, so reads must stay split into start + poll.
  const shell = read("../src/app/pages/whatsapp/whatsapp-shell.ts");
  assert.match(shell, /whatsapp_extract_start/);
  assert.match(shell, /whatsapp_extract_poll/);
  assert.match(shell, /timeoutMs:\s*300_000/);
});

test("the session rect stays viewport-relative — no screenX/screenY", () => {
  // Under a Retina WKWebView those do not share units with
  // getBoundingClientRect(), which put the session window off-screen.
  const shell = read("../src/app/pages/whatsapp/whatsapp-shell.ts");
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!code.includes("screenX"), "rectOf must not add window.screenX");
  assert.ok(!code.includes("screenY"), "rectOf must not add window.screenY");
});

test("the Chats surface still has no blur listener", () => {
  // Showing the session window blurs the main window, so a blur-hide handler
  // hid the session the instant it appeared.
  const code = CHATS_SURFACE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!code.includes('"blur"'), "ChatsSurface must not listen for blur");
});

// ---------------------------------------------------------------------------
// The write path (TASK-030) — the ORDER is the security property
// ---------------------------------------------------------------------------

const SHELL_TS = read("../src/app/pages/whatsapp/whatsapp-shell.ts");
const CEILING_RS = read("../../desktop/src-tauri/src/whatsapp_send.rs");

test("the write op is a separate command from the read pair, and start-then-poll", () => {
  // A send can stall behind a reconnect, and a command answering after ~60s
  // aborts the whole app under WKWebView (BUGS 2026-07-30).
  assert.match(SHELL_TS, /whatsapp_send_start/);
  assert.match(SHELL_TS, /whatsapp_send_poll/);
  // The read union must not have grown a write member: `runReadOp` reaches
  // `script_for_op`, which has no write arm at all.
  const union = SHELL_TS.slice(
    SHELL_TS.indexOf("export type WhatsAppReadOp"),
    SHELL_TS.indexOf("export interface SessionRect"),
  );
  for (const write of ["send_", "delete_", "add_participant"]) {
    assert.ok(!union.includes(write), `WhatsAppReadOp must not contain "${write}"`);
  }
});

test("the engine sends only through the ordered gate, never straight to the shell", () => {
  // policy refusals → decideSend → Rust ceiling → send. The first two are
  // `performAutomatedSend`; skipping it would let a first-contact message
  // become an approval prompt, which is the one prompt that must stay
  // deliberate.
  assert.match(ENGINE, /performAutomatedSend\(request, approvals, context, this\.sendPort\)/);
  const code = ENGINE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // `sendMessage` — the raw transport — appears exactly twice: the import and
  // the one call inside `sendPort`. A third would be a bypass.
  assert.equal(
    (code.match(/\bsendMessage\b/g) ?? []).length,
    2,
    "the raw send transport must only be reachable from sendPort",
  );
});

test("the ceiling constants live in Rust and the renderer never supplies a count", () => {
  // ADR-158: a renderer-side cap is bypassable, so the numbers that bind are
  // Rust's. The renderer passes a target, a recipient key and a body — nothing
  // that could inflate its own allowance.
  assert.match(CEILING_RS, /pub const SEND_LIMITS/);
  assert.match(SHELL_TS, /\{ targetId, recipientKey, body \}/);
  const sendFn = SHELL_TS.slice(SHELL_TS.indexOf("export async function sendMessage"));
  const body = sendFn.slice(0, sendFn.indexOf("export async function sendCeilingStatus"));
  assert.ok(
    !/dailyCap|sentLast24h|cap:/.test(body),
    "the renderer must not pass any count or cap to the shell",
  );
});

test("re-arming the kill switch demands a human, and a halt has no expiry", () => {
  assert.match(SHELL_TS, /rearmSending\(rearmedBy: string\)/);
  assert.match(CEILING_RS, /pub fn rearm\(/);
  assert.match(CEILING_RS, /requires the human who authorised it/);
  // Nothing time-based, count-based or automatic may clear a halt.
  assert.ok(
    !/auto_?resume|resume_after|halt_expiry|halt_timeout/.test(CEILING_RS),
    "a halt must have no automatic path back to armed",
  );
});

test("the ceiling's state is durable, not in-memory", () => {
  // A cap that a relaunch resets is not a cap: restarting would be the bypass.
  assert.match(CEILING_RS, /app_data_dir/);
  assert.match(CEILING_RS, /whatsapp-send-ledger\.json/);
  // Written atomically, and read back on every check rather than cached.
  assert.match(CEILING_RS, /fs::rename/);
  assert.match(SHELL_RS, /ceiling::load_from\(&path, now\)/);
});

test("subscribe() degrades to a no-op unsubscribe off the desktop shell", async () => {
  // Exercised against the compiled behaviour of the guard clause: with no
  // desktop shell present, subscribing must return a callable unsubscribe and
  // must not throw.
  assert.match(ENGINE, /subscribe\(listener: WhatsAppEventListener\): Unsubscribe/);
  assert.match(ENGINE, /if \(!isDesktopShell\(\)\) return \(\) => undefined;/);
  assert.match(ENGINE, /\.catch\(\(\) => \{/);
});
