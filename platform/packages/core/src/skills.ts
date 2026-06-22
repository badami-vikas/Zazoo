/**
 * Capture skills — map a no-blob `media.v1` capture envelope to a proposed graph
 * output. The blob NEVER enters the pipeline: inputs carry only `local_media_id`
 * + facts (caption, ocrText, optional link). The capture event commits as a
 * Touchpoint; an uncertain person match is filed as a `possible_link` Signal,
 * never an auto person-link (ambiguous-duplicates rule).
 */
import type { Skill } from "./ports.js";

interface CaptureInputs {
  local_media_id: string;
  kind?: "photo" | "video";
  caption?: string;
  ocrText?: string;
  link?: { type: "person" | "memory" | "touchpoint"; id: string };
  signal?: string;
  candidate?: string;
}

export const stageCapture: Skill = {
  name: "stageCapture",
  async run(inputs) {
    const i = (inputs ?? {}) as CaptureInputs;
    // Signal path: an uncertain match → a possible_link Signal (manual confirmation).
    if (i.signal) {
      return {
        proposedOutput: {
          type: "signal",
          signal: i.signal,
          local_media_id: i.local_media_id,
          candidate: i.candidate ?? null,
          text: `Possible link for a capture — confirm manually${i.candidate ? `: ${i.candidate}` : ""}`,
        },
        diff: { to: { signal: i.signal, candidate: i.candidate ?? null } },
      };
    }
    const noun = i.kind === "video" ? "video" : "photo";
    const text = `Captured a ${noun}${i.caption ? ` — ${i.caption}` : ""}`;
    return {
      proposedOutput: {
        type: "touchpoint",
        text,
        local_media_id: i.local_media_id,
        ...(i.ocrText ? { notes: i.ocrText } : {}),
        ...(i.link ? { link: i.link } : {}),
      },
      diff: { to: { text, local_media_id: i.local_media_id } },
    };
  },
};
