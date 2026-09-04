/**
 * Which Sections this Database's Record pages show (TASK-083, ADR-261).
 *
 * PER-DATABASE. The hook takes a spec id and nothing else, because the toggle
 * is per-Database by decision: two Records of one Database with different
 * Sections is the divergence the UI gate exists to catch, so there is no
 * Record-scoped variant for a caller to reach for.
 *
 * The server has the last word (ADR-247): `toggle` sends the change and adopts
 * the answer that comes back rather than the value it asked for.
 */
import { useCallback, useEffect, useState } from "react";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

export const RECORD_SECTION_IDS = ["notes", "intelligence", "governance"] as const;
export type RecordSectionId = (typeof RECORD_SECTION_IDS)[number];
export type RecordSectionState = Record<RecordSectionId, boolean>;

export const RECORD_SECTION_LABELS: Record<RecordSectionId, string> = {
  notes: "Notes",
  intelligence: "Intelligence",
  governance: "Governance",
};

const ALL_OFF: RecordSectionState = { notes: false, intelligence: false, governance: false };

export interface RecordSectionsApi {
  sections: RecordSectionState;
  /** Loaded at least once — until then the toggles are honestly unavailable. */
  ready: boolean;
  /** Why the toggles cannot be changed right now, or null when they can. */
  unavailableReason: string | null;
  toggle: (section: RecordSectionId, enabled: boolean) => Promise<void>;
}

export function useRecordSections(specId: string): RecordSectionsApi {
  const [sections, setSections] = useState<RecordSectionState>(ALL_OFF);
  const [ready, setReady] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        const answer = (await trpc.records.sections.query({
          organizationId: PILOT_ORGANIZATION,
          specId,
        })) as RecordSectionState;
        if (cancelled) return;
        setSections(answer);
        setUnavailableReason(null);
      } catch (cause) {
        if (cancelled) return;
        setSections(ALL_OFF);
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specId]);

  const toggle = useCallback(
    async (section: RecordSectionId, enabled: boolean) => {
      try {
        const answer = (await trpc.records.setSection.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          section,
          enabled,
        })) as RecordSectionState;
        setSections(answer);
        setUnavailableReason(null);
      } catch (cause) {
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [specId],
  );

  return { sections, ready, unavailableReason, toggle };
}
