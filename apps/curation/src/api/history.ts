import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./client";

/** Sentinel returned in place of `AuditEvent[]` when gemma-rest
 *  reports the experiment id isn't accessible. The curation UI
 *  may be looking at an id that exists in local_api / the mock
 *  but hasn't been loaded into Gemma yet — in that case the
 *  HistoryPanel renders a softer empty state instead of an error. */
export const AUDIT_NOT_IN_GEMMA = "not_in_gemma" as const;
export type AuditEventsResult = AuditEvent[] | typeof AUDIT_NOT_IN_GEMMA;

/**
 * Mirrors Gemma's `AuditEventValueObject`. The curation UI routes
 * the GET to **gemma-rest** (the live audit trail) — see the vite
 * proxy exception for `^/rest/v2/datasets/\d+/auditEvents.*`.
 * local_api still owns its own per-experiment audit trail (the
 * curation-side events the UI itself generates: factor edits,
 * proposal accepts, ad-hoc notes); a future iteration will fetch
 * both sources and merge them client-side.
 *
 * Wire shape from gemma-rest after snakeify:
 *   { id, performer, date, action, note, detail,
 *     action_name, event_type_name }
 *
 * The UI wants `event_type` to mean "what kind of event was this"
 * — gemma-rest ships that as `event_type_name`. The adapter below
 * lifts it; local_api already ships `event_type` directly.
 * `shape` (per-event factor/FV counts) is local_api-only — null
 * when sourced from gemma-rest.
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

const KEY = (
  experimentId: number,
  compact: boolean,
  excludeEmpty: boolean,
) => ["audit-events", experimentId, compact, excludeEmpty] as const;

export function useAuditEvents(
  experimentId: number,
  options: {
    limit?: number;
    /** gemma-rest `compact=true` — server-side dedup of
     *  consecutive same-event-type rows. */
    compact?: boolean;
    /** gemma-rest `excludeEmpty=true` — drops "plain" U events
     *  (the boilerplate "U event on entity ExpressionExperiment:N
     *  by user…" rows with empty event_type_name + null detail). */
    excludeEmpty?: boolean;
  } = {},
) {
  const {
    limit = 50,
    compact = false,
    excludeEmpty = false,
  } = options;
  return useQuery<AuditEventsResult>({
    queryKey: KEY(experimentId, compact, excludeEmpty),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      // gemma-rest supports both flags. Server ignores unknown
      // params, so passing them when the server hasn't landed
      // them yet is a safe preflight.
      if (compact) params.set("compact", "true");
      if (excludeEmpty) params.set("excludeEmpty", "true");
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/datasets/${experimentId}/auditEvents?${params}`,
        );
        return adaptAuditEvents(raw);
      } catch (e) {
        // Any error from gemma-rest — 404 (id not loaded), 403
        // (private + anonymous), 500 (server / DB hiccup), etc. —
        // try local_api before giving up. local_api always has the
        // curation-side trail (events the UI itself generated),
        // even when gemma-rest is unreachable or doesn't carry the
        // dataset. If local_api ALSO 404s, fall back to the
        // AUDIT_NOT_IN_GEMMA sentinel for a soft empty state.
        // If local_api also throws a "real" error, re-throw it so
        // the panel surfaces something diagnosable.
        if (e instanceof ApiError) {
          try {
            const raw = await api.get<unknown>(
              `/local-api/rest/v2/datasets/${experimentId}/auditEvents?${params}`,
            );
            return adaptAuditEvents(raw);
          } catch (e2) {
            if (e2 instanceof ApiError && e2.status === 404) {
              return AUDIT_NOT_IN_GEMMA;
            }
            // local_api failed for a non-404 reason — surface the
            // ORIGINAL gemma-rest error so the curator sees the
            // primary upstream's complaint, not a confusing
            // secondary one from local_api.
            throw e;
          }
        }
        throw e;
      }
    },
  });
}

// gemma-rest ships `event_type_name` (after snakeify of
// `eventTypeName`); the local_api mock ships `event_type` directly.
// Lift either into the UI-facing `event_type` so downstream
// renderers don't have to branch. Also defends against the wire
// occasionally returning `null` for fields the UI types as
// non-null strings — coerces those to "" so the HistoryPanel
// renderer doesn't crash on null.
function adaptAuditEvents(raw: unknown): AuditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: unknown): AuditEvent => {
    const row = (r ?? {}) as Record<string, unknown>;
    const eventType =
      (row.event_type as string | undefined) ??
      (row.event_type_name as string | undefined) ??
      "";
    return {
      id: Number(row.id ?? 0),
      date: (row.date as string | undefined) ?? "",
      performer: (row.performer as string | undefined) ?? "",
      action: (row.action as string | undefined) ?? "",
      event_type: eventType,
      note: (row.note as string | undefined) ?? "",
      detail: (row.detail as string | undefined) ?? "",
      shape:
        (row.shape as AuditEvent["shape"] | undefined | null) ?? null,
    };
  });
}
