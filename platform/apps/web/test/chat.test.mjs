import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canApplyChatResponse,
  isNearChatBottom,
  mergeChatThreadState,
} from "../src/app/chat/chat-state.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hook = read("../src/app/chat/useChat.ts");
const view = read("../src/app/chat/ChatView.tsx");
const panel = read("../src/app/components/shared/AgentPanel.tsx");
const page = read("../src/app/pages/ChiefOfStaffPage.tsx");
const overlay = read("../src/app/avatar/OverlayApp.tsx");
const desktopNavigation = read("../src/app/lib/desktop-navigation.ts");
const panelControl = read("../src/app/components/shared/PanelControl.tsx");

test("panel, Page, and Avatar render the same persistent Chat view", () => {
  // `moduleName` is passed through since ADR-267e (per-Module chat sessions);
  // this assertion still expected the pre-ADR call shape and had been failing
  // on main. Asserting the surface and the compact flag is what the test is
  // for — pinning the exact argument list makes it fail on every prop added.
  assert.match(panel, /<ChatView surface="chat_panel" compact/);
  assert.match(page, /<ChatView surface="chief_of_staff_page"/);
  assert.match(overlay, /surface="avatar_overlay"/);
  assert.match(overlay, /onOpenTask=/);
  assert.match(hook, /trpc\.chat\.thread\.list\.query/);
  assert.match(hook, /trpc\.chat\.thread\.get\.query/);
  assert.match(hook, /new BroadcastChannel\(CHAT_CHANNEL\)/);
  assert.match(hook, /announce\(threadId\)/);
  assert.doesNotMatch(hook, /threadId !== activeIdRef\.current/);
  assert.doesNotMatch(panel, /useState<.*Message/);
  assert.doesNotMatch(page, /useState<.*Message/);
  assert.doesNotMatch(overlay, /useState<.*Message/);
});

test("polling preserves paginated history and does not steal scroll position", () => {
  const current = {
    thread: { id: "thread", updatedAt: "2026-07-26T10:00:00.000Z" },
    turns: [
      { id: "old", sequence: 1, updatedAt: "2026-07-26T10:00:00.000Z", state: "completed" },
      { id: "latest", sequence: 2, updatedAt: "2026-07-26T10:01:00.000Z", state: "processing" },
    ],
    nextCursor: null,
  };
  const incoming = {
    thread: { id: "thread", updatedAt: "2026-07-26T10:02:00.000Z" },
    turns: [
      { id: "latest", sequence: 2, updatedAt: "2026-07-26T10:02:00.000Z", state: "completed" },
      { id: "new", sequence: 3, updatedAt: "2026-07-26T10:02:00.000Z", state: "completed" },
    ],
    nextCursor: { sequence: 2 },
  };
  const refreshed = mergeChatThreadState(current, incoming);
  assert.deepEqual(refreshed.turns.map((turn) => turn.id), ["old", "latest", "new"]);
  assert.equal(refreshed.turns[1].state, "completed");
  assert.equal(refreshed.nextCursor, null);

  const older = mergeChatThreadState(
    refreshed,
    {
      ...incoming,
      turns: [
        { id: "oldest", sequence: 0, updatedAt: "2026-07-26T09:59:00.000Z", state: "completed" },
      ],
      nextCursor: null,
    },
    "older",
  );
  assert.deepEqual(older.turns.map((turn) => turn.id), ["oldest", "old", "latest", "new"]);
  assert.equal(isNearChatBottom({ scrollHeight: 1_000, scrollTop: 520, clientHeight: 400 }), true);
  assert.equal(isNearChatBottom({ scrollHeight: 1_000, scrollTop: 300, clientHeight: 400 }), false);
  assert.equal(canApplyChatResponse({
    generation: 1,
    currentGeneration: 2,
    threadId: "thread-a",
    activeThreadId: "thread-a",
    desiredThreadId: "thread-b",
    selectsThread: false,
  }), false);
  assert.equal(canApplyChatResponse({
    generation: 2,
    currentGeneration: 2,
    threadId: "thread-b",
    activeThreadId: "thread-a",
    desiredThreadId: "thread-b",
    selectsThread: true,
  }), true);

  assert.match(hook, /mergeChatThreadViews\(current, result, mode === "older" \? "older" : "latest"\)/);
  assert.match(view, /nearBottomRef/);
  assert.match(view, /isNearChatBottom\(event\.currentTarget\)/);
  assert.doesNotMatch(view, /\[chat\.view\?\.turns\]/);
});

test("Avatar Task results navigate through the validated desktop bridge", () => {
  assert.match(overlay, /focus_main_window/);
  assert.match(overlay, /route: `\/task-manager\/\$\{taskId\}`/);
  assert.match(desktopNavigation, /TASK_ROUTE/);
  assert.match(desktopNavigation, /plugin:event\|listen/);
  assert.match(desktopNavigation, /void navigate\(payload\)/);
});

test("public Chat requires a fresh disclosure grant for the exact send", () => {
  assert.match(hook, /trpc\.chat\.turn\.prepareCloud\.mutate/);
  assert.match(hook, /setCloudDisclosure\(disclosure\)/);
  assert.match(hook, /pendingCloudRequest\.message/);
  assert.match(hook, /\.\.\.\(cloudGrantId \? \{ cloudGrantId \} : \{\}\)/);
  assert.match(hook, /setCloudDisclosure\(null\)/);
  assert.match(view, /Send this exact public context/);
  assert.match(view, /Review exact disclosed context/);
  assert.match(view, /disclosure\.system/);
  assert.match(view, /disclosure\.history/);
  assert.match(view, /Send public context once/);
  assert.match(view, />\s*Cancel\s*</);
  assert.match(hook, /setPendingCloudRequest\(null\)/);
});

test("Chat exposes model setup, terminal lifecycle actions, and accessible status", () => {
  assert.match(view, /Set up local model/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /aria-busy=\{chat\.sending\}/);
  assert.match(view, /aria-label="Chat message"/);
  assert.match(view, /restoreComposerFocusRef/);
  assert.match(view, /if \(!chat\.sending && restoreComposerFocusRef\.current\)/);
  assert.doesNotMatch(view, /await chat\.send\(message\);\s*inputRef\.current\?\.focus\(\)/);
  assert.match(view, /chat\.cancel\(turn\)/);
  assert.match(view, /chat\.retry\(turn\)/);
  assert.match(view, /onDecide\("approve"\)/);
  assert.match(view, /onDecide\("edit", draft\)/);
  assert.match(view, /onDecide\("veto"\)/);
  assert.match(hook, /sending \|\|/);
  assert.match(hook, /model\?\.local\.state === "verifying"/);
  assert.match(hook, /if \(id\) void loadThread[\s\S]*void refreshModel\(\)/);
  assert.doesNotMatch(hook, /if \(shouldPoll\) void refreshModel\(\)/);
  assert.match(view, /const accepted = await chat\.send\(message\)/);
  assert.match(view, /if \(accepted\) setDraft\(""\)/);
  assert.doesNotMatch(view, /setDraft\(""\);\s*restoreComposerFocusRef/);
  assert.match(view, /if \(accepted && pendingMessage\)/);
  assert.match(view, /current\.trim\(\) === pendingMessage \? "" : current/);
  assert.match(hook, /retryTurnId: turn\.id/);
  assert.match(hook, /clientRequestId: prior\.clientRequestId/);
  assert.doesNotMatch(hook, /if \(prior\) await send\(prior\.content\)/);
  assert.match(view, /Load older messages/);
  assert.match(view, /Decision:/);
  assert.match(view, /Run:/);
  assert.match(view, /Open Task/);
  assert.match(view, /bg-\[var\(--color-navy\)\] text-background/);
  assert.doesNotMatch(view, /text-muted-foreground/);
  assert.match(panelControl, /aria-valuenow=\{Math\.round\(value\)\}/);
  assert.match(panelControl, /aria-valuetext=\{`\$\{Math\.round\(value\)\} pixels`\}/);
  assert.match(panel, /\{!mobile && \(\s*<ResizeHandle/);
});

// ---------------------------------------------------------------------------
// TASK-082 — the composer's two dead controls
// ---------------------------------------------------------------------------

const companionAsk = read("../src/app/avatar/CompanionAsk.tsx");

test("the paperclip uploads through the one Module File path (TASK-082)", () => {
  // The dishonest disabled state is gone, and nothing replaced it with a
  // second dishonest one: the control is present, and its title states the
  // real reason only when the server says attachments cannot land (§3a).
  assert.doesNotMatch(view, /Attachments aren't supported yet/);
  assert.match(view, /type="file"/);
  assert.match(view, /trpc\.modules\.addFile\.mutate/);
  // Reuse, not a second storage path: no bespoke upload endpoint.
  assert.doesNotMatch(view, /chat\.attachment\.upload/);
  // The message carries the reference, so the attachment is findable from
  // the turn it was sent with.
  assert.match(view, /ATTACHMENT_MODULE/);
  assert.match(view, /attachmentUnavailableReason/);
});

test("the mic runs on every surface, and still only fills the draft (TASK-082)", () => {
  // No Tauri gate, and no desktop-only command left in the panel composer.
  assert.doesNotMatch(view, /isDesktopShell/);
  assert.doesNotMatch(view, /companion_transcribe/);
  assert.doesNotMatch(view, /companion_capabilities/);
  assert.match(view, /trpc\.chat\.voice\.transcribe\.mutate/);
  // AP-168 does NOT approve auto-send from the panel: dictation fills the
  // composer for human review, because a Chat turn can start governed Task
  // proposals.
  assert.match(view, /setDraft\(\(current\) => \(current \? `\$\{current\} \$\{transcript\}` : transcript\)\)/);
  assert.doesNotMatch(view, /chat\.send\(transcript\)/);
  // The Avatar shortcut's auto-send is correct and unchanged.
  assert.match(companionAsk, /ask\(transcript\)/);
  // Unavailability is stated on the control, never hidden (ADR-001/§3a).
  assert.match(view, /voiceUnavailableReason/);
});

test("one conversation can hold several Modules, and says which (TASK-093)", () => {
  // The server has carried `moduleName` + `attachedModules` since ADR-267e and
  // `useChat` has called `attachModule` since; what was missing was any way for
  // a person to reach it. A thread that can span Modules but offers no control
  // to attach one is a capability only a test can use.
  assert.match(hook, /trpc\.chat\.thread\.attachModule\.mutate/);
  assert.match(view, /aria-label="Attach a Module"/);
  assert.match(view, /chat\.attachModule\(/);
  // The Modules already on the thread are not offered again...
  assert.match(view, /!threadModules\.includes\(module\.moduleName\)/);
  // ...and the ones that ARE on it are visible, which is what the exit test
  // ("confirm both are listed on the thread") actually checks.
  assert.match(view, /On this conversation:/);
  assert.match(view, /threadModules\.map\(/);
  // Only Modules this Organization has installed can be attached from here —
  // the same filter the nav uses, so the offer matches what a user can open.
  assert.match(view, /trpc\.modules\.list/);
  assert.match(view, /item\.state === "available"/);
});
