/**
 * Share grants over the selected saved List (TASK-064).
 *
 * The Share affordance shipped disabled with an honest reason: Bridge's only
 * sharing primitive was welded to Helpdesk. `view.share.*` is that primitive
 * generalized, and this binds the panel to it.
 *
 * A share points at a SAVED View. With "All" selected there is nothing durable
 * to share, and the panel says exactly that rather than offering a control that
 * would have nothing to write against (AP-021).
 */
import { useCallback, useEffect, useState } from "react";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

export type ShareAccessLevel = "view" | "edit" | "coowner";

export interface ShareGrant {
  id: string;
  granteeUserId: string | null;
  accessToken: string | null;
  accessLevel: ShareAccessLevel;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** The server's answer, never the client's arithmetic. */
  usable: boolean;
}

export interface ShareGrantsApi {
  grants: ShareGrant[];
  ready: boolean;
  /** Why sharing is impossible right now, or null. */
  unavailableReason: string | null;
  /** The new grant, whose token is the only thing the panel shows. */
  createLink: (accessLevel: ShareAccessLevel) => Promise<{ accessToken: string | null } | null>;
  revoke: (grantId: string) => Promise<void>;
}

const NO_SAVED_VIEW =
  "Save this View as a List first — a share points at a saved View, so there is nothing to share until one exists.";

export function useShareGrants(viewId: string | null): ShareGrantsApi {
  const [grants, setGrants] = useState<ShareGrant[]>([]);
  const [ready, setReady] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(NO_SAVED_VIEW);

  const refresh = useCallback(async () => {
    if (!viewId) {
      setGrants([]);
      setReady(true);
      setUnavailableReason(NO_SAVED_VIEW);
      return;
    }
    try {
      const rows = (await trpc.view.share.list.query({
        organizationId: PILOT_ORGANIZATION,
        viewId,
      })) as ShareGrant[];
      setGrants(rows);
      setUnavailableReason(null);
    } catch (cause) {
      setGrants([]);
      setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReady(true);
    }
  }, [viewId]);

  useEffect(() => {
    setReady(false);
    void refresh();
  }, [refresh]);

  const createLink = useCallback(
    async (accessLevel: ShareAccessLevel) => {
      if (!viewId) return null;
      try {
        const grant = await trpc.view.share.grant.mutate({
          organizationId: PILOT_ORGANIZATION,
          viewId,
          accessLevel,
        });
        await refresh();
        return grant;
      } catch (cause) {
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [refresh, viewId],
  );

  const revoke = useCallback(
    async (grantId: string) => {
      try {
        await trpc.view.share.revoke.mutate({ organizationId: PILOT_ORGANIZATION, grantId });
      } catch (cause) {
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
      }
      await refresh();
    },
    [refresh],
  );

  return { grants, ready, unavailableReason, createLink, revoke };
}
