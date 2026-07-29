/**
 * @bridge/research — bounded multi-step background Research Run engine
 * (TASK-028). Port-driven: nothing here opens a socket, a browser, or a
 * model connection, so the authority model, bounds, evidence ledger, and
 * injection defense are all unit-testable.
 */
export { runResearch, classifyAuthority } from "./engine.js";
export type { RunResearchOptions } from "./engine.js";
export { detectInjection, fenceUntrusted, quarantine } from "./injection.js";
export type { InjectionFinding } from "./injection.js";
export { HttpPageReader, htmlToText } from "./http-reader.js";
export { createChatPlanner } from "./chat-planner.js";
export type { ChatFn, ChatMessage } from "./chat-planner.js";
export type { HttpReaderOptions } from "./http-reader.js";
export * from "./ports.js";
