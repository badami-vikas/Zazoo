export function mergeChatThreadState<T>(
  current: T | null,
  incoming: T,
  page?: "latest" | "older",
): T;

export function isNearChatBottom(
  metrics: {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
  },
  threshold?: number,
): boolean;

export function canApplyChatResponse(input: {
  generation: number;
  currentGeneration: number;
  threadId: string;
  activeThreadId: string | null;
  desiredThreadId: string | null;
  selectsThread: boolean;
}): boolean;

export function needsCloudGrant(
  thread: { plane: string; backend?: string } | null | undefined,
): boolean;
