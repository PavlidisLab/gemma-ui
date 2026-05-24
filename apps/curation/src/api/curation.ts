import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Mirrors Gemma's `AbstractCuratableValueObject` curation block —
 * the canonical Gemma model. There is no separate notes object;
 * `curation_note` is one field on this record alongside the
 * `troubled` / `needs_attention` flags.
 *
 * Per-aspect last-update fields are denormalised from the audit
 * trail so the UI can show "last updated by X on Y" without
 * dereferencing audit events. Production Gemma's value object
 * embeds the full AuditEventValueObject for each; we keep flat
 * fields for now (sufficient for the curation banner; full
 * detail lives on the Audit trail tab).
 */
export interface CurationDetails {
  experiment_id: number;
  last_updated: string;
  troubled: boolean;
  needs_attention: boolean;
  curation_note: string;
  last_note_update_at: string;
  last_note_update_by: string;
  last_troubled_event_at: string;
  last_troubled_event_by: string;
  last_needs_attention_event_at: string;
  last_needs_attention_event_by: string;
}

const KEY = (experimentId: number | string) =>
  ["curation-details", experimentId] as const;

export function useCurationDetails(experimentId: number | string) {
  return useQuery({
    queryKey: KEY(experimentId),
    queryFn: () =>
      api.get<CurationDetails>(
        `/rest/v2/datasets/${experimentId}/curationDetails`,
      ),
  });
}

/**
 * Patch the curation-details for an experiment. Pass any subset of
 * `{curation_note, troubled, needs_attention}`; fields you omit
 * stay unchanged. The server diffs against the current state and
 * appends the matching audit events for each actually-changed
 * field (`CurationNoteUpdateEvent`, `TroubledStatusFlagEvent`,
 * `NeedsAttentionEvent`, …) — same taxonomy as production Gemma.
 */
export function useUpdateCurationDetails(
  experimentId: number | string,
  reviewer: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      patch: Partial<
        Pick<CurationDetails, "curation_note" | "troubled" | "needs_attention">
      >,
    ) =>
      api.put<CurationDetails>(
        `/rest/v2/datasets/${experimentId}/curationDetails?reviewer=${encodeURIComponent(reviewer)}`,
        patch,
      ),
    onSuccess: (server) => {
      qc.setQueryData(KEY(experimentId), server);
      // Mutations append audit events server-side; bust the audit
      // cache so the History tab reflects the change.
      qc.invalidateQueries({ queryKey: ["audit-events", experimentId] });
    },
  });
}
