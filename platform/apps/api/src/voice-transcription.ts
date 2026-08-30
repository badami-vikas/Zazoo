/**
 * Server-side speech-to-text for the Chat composer (TASK-082).
 *
 * The desktop shell already had this as a Rust command (`companion_transcribe`
 * in `apps/desktop/src-tauri/src/companion.rs`), which is why the Chat mic was
 * gated on `window.__TAURI_INTERNALS__` and did nothing in a browser. This is
 * the same call — Groq Whisper, same model, same multipart shape — made from
 * the API process instead, so every Bridge surface (desktop, web, mobile)
 * reaches one implementation.
 *
 * RESIDENCY. The recording is raw capture: it is decoded here, forwarded once,
 * and never written to disk or to any store. The procedure that calls this is
 * classified LOCAL-ONLY in `deployment-boundary.ts` — a public-cloud shell does
 * not transcribe, because that would route a user's microphone through a shared
 * deployment. Egress to Groq itself is the same standing Cloud Plane consent
 * the desktop path already carried (AP-142/AP-143): the user chose the voice
 * control, with a Groq key they configured.
 *
 * SECRETS. The key is read from the environment or the governed vault by the
 * caller and passed in. It appears in one Authorization header and is never
 * logged, returned, or included in an error message.
 */

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Same model the desktop command uses — one behaviour across surfaces. */
const STT_MODEL = "whisper-large-v3-turbo";

/** Whisper's own container list, mirrored from `companion.rs`. */
const AUDIO_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

/** Matches the desktop command's ceiling; well under Groq's own 25 MB limit. */
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 24 * 1024 * 1024;

export class VoiceTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceTranscriptionError";
  }
}

export function transcriptionExtension(mime: string): string {
  const extension = AUDIO_EXTENSIONS.get(mime.split(";")[0]!.trim().toLowerCase());
  if (!extension) {
    throw new VoiceTranscriptionError(`Unsupported recording format ${mime}`);
  }
  return extension;
}

/**
 * Transcribe one recording. Rejects with a `VoiceTranscriptionError` whose
 * message is safe to show the user; the caller maps it onto a tRPC error.
 */
export async function transcribeAudio(input: {
  apiKey: string;
  audio: Uint8Array;
  mime: string;
}): Promise<string> {
  if (input.audio.byteLength === 0) {
    throw new VoiceTranscriptionError("The recording was empty");
  }
  if (input.audio.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new VoiceTranscriptionError("The recording is too long to transcribe");
  }
  const extension = transcriptionExtension(input.mime);
  const form = new FormData();
  form.set("model", STT_MODEL);
  form.set("file", new Blob([input.audio], { type: input.mime }), `audio.${extension}`);
  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}` },
      body: form,
    });
  } catch (cause) {
    // Deliberately does not echo the cause: a fetch failure can carry the
    // request headers, and those hold the key.
    throw new VoiceTranscriptionError("The transcription service could not be reached");
  }
  if (!response.ok) {
    throw new VoiceTranscriptionError(
      `The transcription service refused the recording (HTTP ${response.status})`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const text =
    body && typeof body === "object" && "text" in body && typeof body.text === "string"
      ? body.text.trim()
      : null;
  if (text === null) {
    throw new VoiceTranscriptionError("The transcription reply carried no text");
  }
  return text;
}
