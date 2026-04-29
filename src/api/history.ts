import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Mirrors Gemma's `AuditEventValueObject`. Real Gemma's audit
 * trail lives in `AuditEvent` / `AuditEventValueObject` and is
 * surfaced today via DWR (`AuditController`) rather than REST.
 * Until the REST surface is added (see TODO-gemma-api.md), the
 * mock owns this endpoint with the same field shape so the swap-
 * in is a URL change.
 */
export interface AuditEvent {
  id: number;
  /** ISO timestamp. */
  date: string;
  /** Username; "" when not stamped. */
  performer: string;
  /** Action code — "C" (create) or "U" (update). */
  action: string;
  /** Class name of the AuditEventType subclass — e.g.
   *  `ExperimentalDesignUpdatedEvent`, `CommentedEvent`. */
  event_type: string;
  note: string;
  detail: string;
  /** Mock-side: shape counts at the time of the event. Empty /
   *  null when sourced from real Gemma until the REST API exposes
   *  per-event body summaries. */
  shape: {
    n_factors: number;
    n_fvs: number;
    n_biomaterials: number;
    n_tags: number;
  } | null;
}

const KEY = (experimentId: number) =>
  ["audit-events", experimentId] as const;

export function useAuditEvents(experimentId: number, limit = 50) {
  return useQuery({
    queryKey: KEY(experimentId),
    queryFn: () =>
      api.get<AuditEvent[]>(
        `/rest/v2/datasets/${experimentId}/auditEvents?limit=${limit}`,
      ),
  });
}
