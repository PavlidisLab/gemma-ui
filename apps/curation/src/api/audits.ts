/**
 * React-query hooks for the audit endpoints the agents side shipped in
 * Step 3. All routes live under
 * `/rest/v2/...` on the same mock-API host the proposals routes use,
 * so they ride the existing Vite dev proxy + bearer token without
 * extra config.
 *
 * Convention follows `src/api/proposals.ts`:
 *   - one query key per resource scope (per-experiment list,
 *     cross-experiment inbox, single audit)
 *   - mutations invalidate the touched scope on success so the next
 *     read returns the fresh server state
 *
 * Storage on the agent side is append-only for dispositions; the
 * read endpoints fold in the latest disposition per `target_id`. So
 * after a PATCH succeeds, refreshing the report query is enough —
 * we don't have to merge the patch into local cache by hand.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";
import type {
  AuditFindingDispositionPatch,
  AuditReport,
} from "./auditTypes";
import { REVIEW_PROPOSAL_KEYS } from "./reviewProposals";

interface AuditListResponse {
  items: AuditReport[];
  total: number;
}


const KEY = {
  byExperiment: (experimentId: number | string) =>
    ["audits", "by-experiment", experimentId] as const,
  inbox: () => ["audits", "inbox"] as const,
  detail: (auditId: string) => ["audits", "detail", auditId] as const,
};

/** Shared fetcher for the per-experiment audit list, so the single-
 *  and multi-experiment hooks below populate the SAME cache entries. */
async function fetchAuditsForExperiment(
  experimentId: number | string,
): Promise<AuditListResponse> {
  try {
    return await api.get<AuditListResponse>(
      `/rest/v2/datasets/${experimentId}/audits`,
    );
  } catch (e: unknown) {
    // Gemma 2.0 doesn't yet expose the local_api ``/audits``
    // surface (it has ``/auditEvents``, a different concept).
    // Treat 404 as "no audits" rather than poisoning every
    // audit-aware surface with an error toast.
    if (
      e &&
      typeof e === "object" &&
      "status" in e &&
      (e as { status: number }).status === 404
    ) {
      return { items: [], total: 0 } as AuditListResponse;
    }
    throw e;
  }
}

/** Per-experiment audit list, most recent first. The sidebar reads
 *  the most recent item as "the current audit for this experiment".
 *  Disabled when `experimentId` is missing / negative — keeps the
 *  query off until the shell knows which experiment is loaded. */
export function useAuditsForExperiment(
  experimentId: number | string,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && Boolean(experimentId);
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    queryFn: () => fetchAuditsForExperiment(experimentId),
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Audit lists for MANY experiments at once — the ticket queue's
 *  disposition filter tallies findings across every target of a
 *  ticket. One query per experiment (the store has no bulk endpoint),
 *  but each rides the SAME cache key as ``useAuditsForExperiment``,
 *  so opening a row after the tally has loaded costs nothing — and a
 *  disposition PATCH from the sidebar invalidates the tally too.
 *  ``enabled: false`` keeps the whole fan-out off until the curator
 *  actually engages the filter (a 400-target ticket is 400 GETs).
 *  Cached entries are reused across pages of the same ticket. */
export function useAuditsForExperiments(
  experimentIds: Array<number | string>,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQueries({
    queries: experimentIds.map((id) => ({
      queryKey: KEY.byExperiment(id),
      queryFn: () => fetchAuditsForExperiment(id),
      enabled: enabled && Boolean(id),
      // The tally is a batch read over possibly hundreds of rows;
      // window-focus refetch storms would hammer the store for no
      // curator-visible gain. The sidebar's own query (same key)
      // still refetches on focus once a row is opened.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    })),
  });
}

/** Cross-experiment inbox list. Backed by `/rest/v2/audits`
 *  (paginated response with offset/limit/totalElements). Consumed by
 *  `features/inbox/AuditsInbox.tsx`. */
export function useAuditsInbox() {
  return useQuery({
    queryKey: KEY.inbox(),
    queryFn: () => api.get<AuditListResponse>(`/rest/v2/audits`),
    refetchOnWindowFocus: true,
  });
}

/** Single-audit detail. Useful after an SSE stream closes (or for
 *  the inbox detail view) when we want a fresh fetch keyed off
 *  audit_id rather than experiment_id. */
export function useAuditDetail(auditId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.detail(auditId ?? ""),
    queryFn: () => api.get<AuditReport>(`/rest/v2/audits/${auditId}`),
    enabled: !!auditId,
    refetchOnWindowFocus: true,
  });
}

/** Apply one curator disposition. Append-only on the server; the
 *  returned `AuditReport` carries the refreshed `dispositions` list.
 *
 *  On success: refresh the per-experiment list (sidebar reads from
 *  there) and the detail query for this audit_id. We don't try to
 *  patch the cache surgically — refetch is cheap and the server is
 *  authoritative for which disposition wins per `target_id`. */
export function usePatchDisposition(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      auditId,
      patch,
    }: {
      auditId: string;
      patch: AuditFindingDispositionPatch;
    }) => api.patch<AuditReport>(`/rest/v2/audits/${auditId}`, patch),
    onSuccess: (refreshed, vars) => {
      // Smoking-gun trace per the 2026-06-14 "3 pending stays 3
      // pending" investigation. If the PATCH returns a report whose
      // dispositions list lacks the target_id we just sent, the
      // server didn't persist (or the read path returned stale state)
      // — surface that immediately rather than waiting for a second
      // round of "the counts aren't updating" reports.
      const patched = refreshed.dispositions?.find(
        (d) => d.target_id === vars.patch.target_id,
      );
      if (!patched) {
        console.warn(
          "patchDisposition.onSuccess: refreshed report missing the just-PATCHed target_id (target_id=%s, audit_id=%s, status=%s, dispositions=%d) — server response didn't persist or returned stale rows",
          vars.patch.target_id,
          vars.auditId,
          vars.patch.status,
          refreshed.dispositions?.length ?? 0,
        );
      }
      // Per-experiment list lives in TWO caches keyed by kind: the
      // audit list at ``["audits", "by-experiment", X]`` and the
      // proposal-review list at ``["curation-reviews", "proposal",
      // "by-experiment", X]`` (see reviewProposals.ts). The PATCH
      // doesn't know which kind it landed for, so refresh both —
      // the wrong-kind cache won't contain the audit_id and the map
      // becomes a no-op there. Caught 2026-05-25: proposal-kind
      // patches were succeeding server-side but the proposal cache
      // never refreshed, so Apply All kept showing pending findings
      // even after dispositions landed.
      const folder = (old: AuditListResponse | undefined) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) =>
            a.audit_id === refreshed.audit_id ? refreshed : a,
          ),
        };
      };
      qc.setQueryData(KEY.byExperiment(experimentId), folder);
      qc.setQueryData(
        REVIEW_PROPOSAL_KEYS.byExperiment(experimentId),
        folder,
      );
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({
        queryKey: REVIEW_PROPOSAL_KEYS.byExperiment(experimentId),
      });
      if (refreshed.audit_id) {
        qc.setQueryData(KEY.detail(refreshed.audit_id), refreshed);
      }
      qc.invalidateQueries({ queryKey: KEY.inbox() });
      invalidateChipCalibrationReport(qc, experimentId);
    },
  });
}

/** Invalidate the ``["chip-calibration-report", experimentId]`` cache
 *  used by ``useCalibrationAuditReport`` (features/comparison/useChipDiff.ts).
 *  That hook holds the override report ChipOverrideMount feeds into the
 *  AuditProvider when the chip strip is in ``polished-vs-agent_proposal``
 *  mode. Without this invalidation the override stays at the pre-mutation
 *  report shape after a PATCH / finalize / reopen / reset succeeds — the
 *  sidebar reads ``dispositionByTarget`` off the stale override, so action
 *  buttons don't grey + the card doesn't fade even though the server state
 *  is up-to-date. Caught 2026-06-09 on the v15 calibration pack. */
function invalidateChipCalibrationReport(
  qc: ReturnType<typeof useQueryClient>,
  experimentId: number | string,
) {
  qc.invalidateQueries({
    queryKey: ["chip-calibration-report", experimentId],
  });
}

/** Finalize an audit — the curator's "I'm done triaging this" press
 *  (see `AUDIT_DISPOSITIONS.md` Ask #1). Server stamps
 *  `finalized_at` + `finalized_by`; subsequent PATCH attempts on
 *  this audit return 409 until a `useReopenAudit` flips the gate
 *  back off. The agent side aggregates only finalized audits. */
export function useFinalizeAudit(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      auditId,
      reviewer,
      notes,
    }: {
      auditId: string;
      reviewer: string;
      notes?: string;
    }) =>
      api.post<AuditReport>(`/rest/v2/audits/${auditId}/finalize`, {
        reviewer,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: (refreshed) => {
      // Refresh BOTH per-experiment caches — same kind-mismatch
      // bug as usePatchDisposition: finalizing a proposal-kind
      // review needs to invalidate the proposal cache, not just
      // the audit one. Otherwise the UI keeps reading the
      // pre-finalize state ("Close" stays clickable, looks like
      // the click did nothing).
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({
        queryKey: REVIEW_PROPOSAL_KEYS.byExperiment(experimentId),
      });
      qc.invalidateQueries({ queryKey: KEY.inbox() });
      if (refreshed.audit_id) {
        qc.setQueryData(KEY.detail(refreshed.audit_id), refreshed);
      }
      invalidateChipCalibrationReport(qc, experimentId);
    },
  });
}

/** Bulk-clear every disposition on an audit so the curator can
 *  re-disposition from scratch. Use case: iterating on an
 *  augmentation / calibration package where the curator already
 *  actioned findings and hit a UI or wire-schema issue mid-flow.
 *  Returns the audit with empty dispositions reflected and the
 *  count of rows deleted. Does NOT roll back design mutations
 *  the curator made in response to those dispositions — the
 *  draft carries those; discard the draft separately to reset
 *  the design. */
export function useResetAuditDispositions(
  experimentId: number | string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ auditId }: { auditId: string }) =>
      api.post<{
        audit_id: string;
        n_deleted: number;
        audit: AuditReport;
      }>(`/rest/v2/audits/${auditId}/reset-dispositions`, {}),
    onSuccess: (refreshed) => {
      if (refreshed.audit_id) {
        qc.setQueryData(KEY.detail(refreshed.audit_id), refreshed.audit);
      }
      // Force a refetch (not just an invalidate-on-next-mount): the
      // sidebar reads ``report`` from the list-query, and stale
      // dispositions there will keep Apply All hidden because the
      // filter sees prior accepts. ``refetchQueries`` triggers an
      // immediate network roundtrip so the cleared state lands
      // before the next render.
      qc.refetchQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.refetchQueries({
        queryKey: REVIEW_PROPOSAL_KEYS.byExperiment(experimentId),
      });
      qc.invalidateQueries({ queryKey: KEY.inbox() });
      invalidateChipCalibrationReport(qc, experimentId);
    },
  });
}


/** Reopen a finalized audit so the curator can keep dispositioning
 *  without losing the prior triage state. */
export function useReopenAudit(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      auditId,
      reviewer,
    }: {
      auditId: string;
      reviewer: string;
    }) =>
      api.post<AuditReport>(`/rest/v2/audits/${auditId}/reopen`, {
        reviewer,
      }),
    onSuccess: (refreshed) => {
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({
        queryKey: REVIEW_PROPOSAL_KEYS.byExperiment(experimentId),
      });
      qc.invalidateQueries({ queryKey: KEY.inbox() });
      if (refreshed.audit_id) {
        qc.setQueryData(KEY.detail(refreshed.audit_id), refreshed);
      }
      invalidateChipCalibrationReport(qc, experimentId);
    },
  });
}

