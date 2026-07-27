export function mergeChatThreadState(current, incoming, page = "latest") {
  if (!current || current.thread.id !== incoming.thread.id) return incoming;
  const turns = new Map(current.turns.map((turn) => [turn.id, turn]));
  for (const turn of incoming.turns) {
    const existing = turns.get(turn.id);
    if (!existing || existing.updatedAt <= turn.updatedAt) turns.set(turn.id, turn);
  }
  return {
    ...incoming,
    thread:
      current.thread.updatedAt > incoming.thread.updatedAt
        ? current.thread
        : incoming.thread,
    turns: [...turns.values()].sort((left, right) => left.sequence - right.sequence),
    nextCursor: page === "older" ? incoming.nextCursor : current.nextCursor,
  };
}

export function isNearChatBottom(
  { scrollHeight, scrollTop, clientHeight },
  threshold = 80,
) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function canApplyChatResponse({
  generation,
  currentGeneration,
  threadId,
  activeThreadId,
  desiredThreadId,
  selectsThread,
}) {
  if (generation !== currentGeneration || desiredThreadId !== threadId) return false;
  return selectsThread || activeThreadId === threadId;
}
