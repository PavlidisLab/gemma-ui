/**
 * React-query hooks for the audit endpoints my brother shipped in
 * Step 3 (see `AUDIT_FEATURE.md` §Status). All routes live under
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    queryFn: async () => {
      try {
        return await api.get<AuditListResponse>(
          `/rest/v2/datasets/${experimentId}/audits`,
        );
      } catch (e: unknown) {
        // Gemma 2.0 doesn't yet expose the local_api ``/audits``
        // surface (it has ``/auditEvents``, a different concept).
        // Treat 404 as "no audits" rather than poisoning every
        // audit-aware surface with an error toast. See
        // ``CURATION_TO_GEMMA_2_0_HANDOFF.md``.
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
    },
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Cross-experiment inbox list. Fed into the audit-inbox surface
 *  (still TODO; the route works now). */
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
    onSuccess: (refreshed) => {
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
    },
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
    },
  });
}

/** POST a freshly-built audit to the mock. Used by the trigger
 *  dialog when we go end-to-end (the SSE stream variant lands in a
 *  later iteration). Server assigns `audit_id` and any inbound
 *  `dispositions` are dropped per the contract. */
export function useSubmitAudit(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (report: AuditReport) =>
      api.post<AuditReport>(
        `/rest/v2/datasets/${experimentId}/audits`,
        report,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({ queryKey: KEY.inbox() });
    },
  });
}
