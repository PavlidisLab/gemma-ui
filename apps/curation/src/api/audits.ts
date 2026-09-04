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
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { api } from "./client";
import {
  annotationSetToReview,
  annotationSetsToReviews,
  asAnnotationSetRows,
  isReviewPayload,
  parseReviewPayload,
  reviewsPath,
  type AnnotationSetRow,
} from "./annotationSetReviews";
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
  // Remote mode reads Gemma's annotation sets; local mode keeps the
  // store route. See `annotationSetReviews.ts` for why the audit /
  // proposal split lives in `kind` rather than the path.
  const remote = resolveGemmaMode().mode === "remote";
  try {
    const raw = await api.get<unknown>(
      reviewsPath(experimentId, remote, "audits"),
    );
    return remote
      ? annotationSetsToReviews(raw, "audit")
      : (raw as AuditListResponse);
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

/** Cross-experiment inbox list. Backed by `/curation/v1/audits`
 *  (paginated response with offset/limit/totalElements). Consumed by
 *  `features/inbox/AuditsInbox.tsx`. */
export function useAuditsInbox() {
  return useQuery({
    queryKey: KEY.inbox(),
    queryFn: () =>
      resolveGemmaMode().mode === "remote"
        ? fetchRemoteInbox("audit")
        : api.get<AuditListResponse>(`/curation/v1/audits`),
    refetchOnWindowFocus: true,
  });
}

/** Cross-experiment review list from Gemma.
 *
 *  🛑 **Two round trips, because the cross-experiment route is thin by
 *  construction.** `GET /annotation-sets` has no `shape` parameter and
 *  ships `payloadSize` in place of `payloadJson` — its own description
 *  says to "fetch one whole set with `GET /annotation-sets/{id}`". The
 *  inbox filters on `summary.overall_verdict`, which lives in the
 *  payload, so the ids come from the list and the reports come from
 *  the per-set reads.
 *
 *  `limit` is capped at 100 server-side (a larger value is a 400, not
 *  a clamp), so this is one page of the newest sets rather than the
 *  whole table. */
async function fetchRemoteInbox(
  kind: "audit" | "proposal",
): Promise<AuditListResponse> {
  const rows = await api.get<unknown>(
    `/rest/v2/annotation-sets?role=proposal&limit=100`,
  );
  // 🛑 Paginated envelope, NOT a bare array — see `asAnnotationSetRows`.
  const wanted = asAnnotationSetRows(rows).filter(
    (r) => (r?.kind ?? "audit") === kind,
  );
  const full = await Promise.all(
    wanted.map((r) =>
      api
        .get<AnnotationSetRow>(`/rest/v2/annotation-sets/${r.id}`)
        .catch(() => null),
    ),
  );
  const items: AuditReport[] = [];
  for (const row of full) {
    if (!row) continue;
    const payload = parseReviewPayload(row);
    if (!payload || !isReviewPayload(payload)) continue;
    items.push(annotationSetToReview(row, payload));
  }
  return { items, total: items.length };
}

/** Single-audit detail. Useful after an SSE stream closes (or for
 *  the inbox detail view) when we want a fresh fetch keyed off
 *  audit_id rather than experiment_id. */
export function useAuditDetail(auditId: string | null | undefined) {
  return useQuery({
    queryKey: KEY.detail(auditId ?? ""),
    queryFn: () =>
      resolveGemmaMode().mode === "remote"
        ? fetchRemoteReview(auditId as string)
        : api.get<AuditReport>(`/curation/v1/audits/${auditId}`),
    enabled: !!auditId,
    refetchOnWindowFocus: true,
  });
}

/** One Gemma annotation set → the review the panels render. Backs the
 *  detail page in remote mode. */
async function fetchRemoteReview(setId: string): Promise<AuditReport> {
  const row = await api.get<AnnotationSetRow>(
    `/rest/v2/annotation-sets/${setId}`,
  );
  const payload = parseReviewPayload(row);
  if (!payload || !isReviewPayload(payload)) {
    throw new Error(
      `Annotation set ${setId} carries no findings — its payload is not a ` +
        `curation review. Agent-proposal payloads (tags / proposed_factors) ` +
        `render through the proposal panel, not the finding cards.`,
    );
  }
  return annotationSetToReview(row, payload);
}

/** Finalize a review — "I'm done triaging this".
 *
 *  🛑 **In remote mode this write has no home yet, and it must not be
 *  sent to Gemma from here.** Paul, 2026-09-03, asked directly whether
 *  the UI should POST `/annotation-sets/{id}/finalize` itself:
 *  *"it really should be the agent."* That is the 2026-08-25 ruling
 *  applied to review state — the UI is a read-only client of Gemma and
 *  the agent performs the writes.
 *
 *  The agent serves `/curation-draft`, `/curation-lock`,
 *  `/curation-preflight`, `/curation-commit` and `/curation-sign`
 *  (measured against the running agent 2026-09-03) — no finalize and no
 *  reopen. So this refuses in remote rather than either writing to
 *  Gemma directly or sending the finalize to a store review that merely
 *  shares the id. Asked of cab; when the relay lands it belongs on its
 *  own top-level prefix like the others, never under `/rest`.
 *
 *  🛑 Gemma's finalize also takes NO note — no request body at all —
 *  so the curator's closing note needs a home in whatever the agent
 *  exposes. Filed with gembro as the second of two gaps. */
async function finalizeReview(
  auditId: string,
  reviewer: string,
  notes?: string,
): Promise<AuditReport> {
  assertAgentOwnsThisWrite(
    "finalize",
    "The agent has no finalize relay yet, and the UI does not write " +
      "review state to Gemma itself.",
  );
  return api.post<AuditReport>(`/curation/v1/audits/${auditId}/finalize`, {
    reviewer,
    ...(notes ? { notes } : {}),
  });
}

/** Reopen a finalized review. Same ruling and the same missing relay as
 *  `finalizeReview`. */
async function reopenReview(
  auditId: string,
  reviewer: string,
): Promise<AuditReport> {
  assertAgentOwnsThisWrite(
    "reopen",
    "The agent has no reopen relay yet, and the UI does not write " +
      "review state to Gemma itself.",
  );
  return api.post<AuditReport>(`/curation/v1/audits/${auditId}/reopen`, {
    reviewer,
  });
}

/** 🛑 A curation write the AGENT owns, called in a mode where the UI
 *  cannot perform it.
 *
 *  Distinct from `assertStoreReviews`, and the distinction is the
 *  reason each exists: that one guards a capability GEMMA does not
 *  have; this one guards a capability Gemma has and the UI is not the
 *  one allowed to use ([[feedback_ui_is_readonly_client_agent_writes]]).
 *  A future agent relay clears this one and leaves that one standing. */
function assertAgentOwnsThisWrite(action: string, because: string): void {
  if (resolveGemmaMode().mode === "remote") {
    throw new Error(
      `Cannot ${action} this review from the UI in remote mode: ${because} ` +
        `Switch to a store-backed session, or wait for the agent relay.`,
    );
  }
}

/** 🛑 Refuse a write Gemma's annotation-set API has no equivalent for.
 *
 *  Read against the gemma2 OpenAPI 2026-09-03, route by route. Gemma
 *  serves `POST /annotation-sets/{id}/finalize`, `/reopen`,
 *  `PATCH /{id}` and `PATCH /{id}/triage`. What it does NOT serve is a
 *  **per-finding disposition**:
 *
 *  - `PATCH /annotation-sets/{id}` is envelope-only — it accepts
 *    `agentName`, `model`, `ranAt`, `agentVersion`, `runSha` and 400s
 *    on anything else, so it cannot record a curator's ruling.
 *  - `PATCH /annotation-sets/{id}/triage` rules on the whole SET
 *    (`fine` / `wont_fix` / `might_fix` / `must_fix`). Its own
 *    description draws the line: *"Not the per-finding audit
 *    disposition (`accepted` / `dismissed` / ...), which answers
 *    whether a curator agrees with one finding. This answers how much
 *    the whole set matters."*
 *
 *  Sending the disposition to the store while the panel is showing
 *  Gemma's review would write to a `curation_review` row that merely
 *  shares an id — the same collision `assertStoreTickets` guards in
 *  `tickets.ts`. Better to say so than to record it against the wrong
 *  row. */
function assertStoreReviews(action: string, because: string): void {
  if (resolveGemmaMode().mode === "remote") {
    throw new Error(
      `Cannot ${action} on a Gemma review: ${because} The store and Gemma ` +
        `number their reviews independently, so sending it anyway would ` +
        `write to a store row that merely shares this id.`,
    );
  }
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
    }) => {
      assertStoreReviews(
        "record a per-finding disposition",
        "Gemma has no route for one — `PATCH /annotation-sets/{id}` is " +
          "envelope-only and `/triage` rules on the whole set, not on one " +
          "finding.",
      );
      return api.patch<AuditReport>(`/curation/v1/audits/${auditId}`, patch);
    },
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
    }) => finalizeReview(auditId, reviewer, notes),
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
    mutationFn: ({ auditId }: { auditId: string }) => {
      assertStoreReviews(
        "clear the dispositions",
        "Gemma stores no per-finding dispositions to clear.",
      );
      return api.post<{
        audit_id: string;
        n_deleted: number;
        audit: AuditReport;
      }>(`/curation/v1/audits/${auditId}/reset-dispositions`, {});
    },
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
    }) => reopenReview(auditId, reviewer),
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

