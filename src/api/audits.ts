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

interface AuditListResponse {
  items: AuditReport[];
  total: number;
}

/** Patch a single AuditReport inside a cached AuditListResponse,
 *  matching by `audit_id`. Returns the original list untouched if
 *  the audit isn't there (so consumers don't have to null-guard).
 *  Used by finalize / reopen onSuccess to apply the server's
 *  authoritative response without waiting for a refetch — see those
 *  hooks for the agent-side reason refetch alone isn't enough. */
function patchAuditInList(
  list: AuditListResponse | undefined,
  refreshed: AuditReport,
): AuditListResponse | undefined {
  if (!list || !refreshed.audit_id) return list;
  let touched = false;
  const items = list.items.map((it) => {
    if (it.audit_id === refreshed.audit_id) {
      touched = true;
      return refreshed;
    }
    return it;
  });
  if (!touched) return list;
  return { ...list, items };
}

const KEY = {
  byExperiment: (experimentId: number) =>
    ["audits", "by-experiment", experimentId] as const,
  inbox: () => ["audits", "inbox"] as const,
  detail: (auditId: string) => ["audits", "detail", auditId] as const,
};

/** Per-experiment audit list, most recent first. The sidebar reads
 *  the most recent item as "the current audit for this experiment".
 *  Disabled when `experimentId` is missing / negative — keeps the
 *  query off until the shell knows which experiment is loaded. */
export function useAuditsForExperiment(experimentId: number) {
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    queryFn: () =>
      api.get<AuditListResponse>(
        `/rest/v2/datasets/${experimentId}/audits`,
      ),
    enabled: experimentId > 0,
  });
}

/** Cross-experiment inbox list. Fed into the audit-inbox surface
 *  (still TODO; the route works now). */
export function useAuditsInbox() {
  return useQuery({
    queryKey: KEY.inbox(),
    queryFn: () => api.get<AuditListResponse>(`/rest/v2/audits`),
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
  });
}

/** Apply one curator disposition. Append-only on the server; the
 *  returned `AuditReport` carries the refreshed `dispositions` list.
 *
 *  On success: refresh the per-experiment list (sidebar reads from
 *  there) and the detail query for this audit_id. We don't try to
 *  patch the cache surgically — refetch is cheap and the server is
 *  authoritative for which disposition wins per `target_id`. */
export function usePatchDisposition(experimentId: number) {
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
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
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
 *  back off. The agent side aggregates only finalized audits.
 *
 *  Cache strategy: we PATCH the cached list in place with the
 *  `AuditReport` the /finalize endpoint returned (which DOES carry
 *  the freshly-stamped `finalized_at`), and skip the per-experiment
 *  invalidate. Reason: today's mock LIST endpoint
 *  (`GET /rest/v2/datasets/{id}/audits`) reads each audit from the
 *  stored `body_json` blob and doesn't merge in `finalized_at` /
 *  `finalized_by` from the audits row columns — only the SINGLE-
 *  audit GET does. So an invalidate-driven refetch comes back with
 *  `finalized_at: null` and the UI's "isFinalized" flag stays false,
 *  defeating the close. Filed agent-side; this workaround becomes
 *  redundant once the list endpoint merges the columns, at which
 *  point we can re-add the invalidate. The inbox cache gets the
 *  same patch treatment for the same reason. */
export function useFinalizeAudit(experimentId: number) {
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
      qc.setQueryData<AuditListResponse>(
        KEY.byExperiment(experimentId),
        (old) => patchAuditInList(old, refreshed),
      );
      qc.setQueryData<AuditListResponse>(KEY.inbox(), (old) =>
        patchAuditInList(old, refreshed),
      );
      if (refreshed.audit_id) {
        qc.setQueryData(KEY.detail(refreshed.audit_id), refreshed);
      }
    },
  });
}

/** Reopen a finalized audit so the curator can keep dispositioning
 *  without losing the prior triage state. Same cache-patch strategy
 *  as `useFinalizeAudit` — see that comment for why we skip the
 *  invalidate. Reopen also clears `finalized_at` server-side, and
 *  the cached list inherits that via the patched report. */
export function useReopenAudit(experimentId: number) {
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
      qc.setQueryData<AuditListResponse>(
        KEY.byExperiment(experimentId),
        (old) => patchAuditInList(old, refreshed),
      );
      qc.setQueryData<AuditListResponse>(KEY.inbox(), (old) =>
        patchAuditInList(old, refreshed),
      );
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
export function useSubmitAudit(experimentId: number) {
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
