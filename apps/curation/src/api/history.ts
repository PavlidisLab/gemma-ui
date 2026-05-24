import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

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

const KEY = (experimentId: number, compressed: boolean) =>
  ["audit-events", experimentId, compressed] as const;

export function useAuditEvents(
  experimentId: number,
  options: { limit?: number; compressed?: boolean } = {},
) {
  const { limit = 50, compressed = false } = options;
  return useQuery({
    queryKey: KEY(experimentId, compressed),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      // gemma-rest is expected to land a `compressed=true` query
      // param that deduplicates consecutive same-type events
      // (e.g. five `ExperimentalDesignUpdatedEvent`s in a row
      // collapse to one). Pass it whenever the caller asks; the
      // server ignores unknown params today.
      if (compressed) params.set("compressed", "true");
      const raw = await api.get<unknown>(
        `/rest/v2/datasets/${experimentId}/auditEvents?${params}`,
      );
      return adaptAuditEvents(raw);
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
