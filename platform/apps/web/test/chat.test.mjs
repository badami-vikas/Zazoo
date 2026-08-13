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
const layout = read("../src/app/Layout.tsx");

test("panel, Page, and Avatar render the same persistent Chat view", () => {
  assert.match(panel, /<ChatView surface="chat_panel" compact moduleId={moduleId} \/>/);
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

test("ADR-240: the Chat Panel scopes to the current route's Module and can attach another Module's session", () => {
  // Layout resolves the active Module from the URL and threads its
  // installation id into the Chat Panel — the source of "which Module's
  // sessions does this surface default to".
  assert.match(layout, /activeModuleId/);
  assert.match(layout, /<AgentPanel moduleId={activeModuleId} \/>/);
  assert.match(panel, /moduleId\?:\s*string \| undefined/);
  // useChat scopes listing/creation by moduleId and resolves "default to
  // last opened" from lastOpenedAt, not from localStorage, when scoped.
  assert.match(hook, /export function useChat\(surfaceKind: ChatSurfaceKind, moduleId\?: string\)/);
  assert.match(hook, /moduleId: moduleId \?\? null/);
  assert.match(hook, /lastOpenedAt\.localeCompare/);
  assert.match(hook, /trpc\.chat\.thread\.touchLastOpened/);
  // The cross-Module attach picker reuses `chat.selectThread` — attaching a
  // foreign session views/continues it without re-scoping it.
  assert.match(view, /AttachModulePicker/);
  assert.match(view, /onAttach={\(threadId\) => void chat\.selectThread\(threadId\)}/);
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
