// Proves the mobile app resolves the @bridge/local workspace package. TYPE-ONLY import:
// the app must NOT pull @bridge/local's Node-only runtime (pglite/pgvector) into the RN
// bundle. Plan 03 supplies the RN-safe SQLite adapter that implements these same ports.
import type { CaptureDraft } from "@bridge/local";

/** A placeholder draft the Capture screen (Plan 05) will produce for real. */
export function emptyDraft(id: string, workspaceId: string): CaptureDraft {
  return { id, workspaceId, text: "", capturedAt: 0 };
}
