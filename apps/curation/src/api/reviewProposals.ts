/**
 * React-query hooks for the **proposal-kind** CurationReview
 * endpoints. Pairs with the local-api refactor that split the shared
 * ``curation_review`` table into ``kind='audit'`` and
 * ``kind='proposal'`` rows.
 *
 * Wire shape is identical to audits (the same ``AuditReport`` /
 * forthcoming ``CurationReviewReport`` type); only the read filter
 * differs (kind=proposal vs kind=audit). Per-finding dispositions
 * and finalize routes are kind-agnostic, so this file imports those
 * mutations from ``audits.ts`` rather than duplicating them.
 *
 * Query keys live under ``["curation-reviews", "proposal", …]`` to
 * keep them distinct from:
 *   - ``["audits", …]`` (the audit-kind reviews — same table, other
 *     half), and
 *   - ``["proposals", …]`` (the **legacy** ``agent_proposal`` rows
 *     still served by the live proposer at
 *     ``/datasets/{id}/curation-proposals``).
 *
 * The legacy `proposals.ts` client stays in place during transition;
 * this file is for the new rich-review proposal flow only.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { api } from "./client";
import { annotationSetsToReviews, reviewsPath } from "./annotationSetReviews";
import type { AuditReport } from "./auditTypes";

interface ReviewProposalListResponse {
  items: AuditReport[];
  total: number;
}

const KEY = {
  byExperiment: (experimentId: number | string) =>
    ["curation-reviews", "proposal", "by-experiment", experimentId] as const,
};

/** Shared fetcher so the single- and multi-experiment hooks populate
 *  the same cache entries (mirrors ``fetchAuditsForExperiment``). */
async function fetchProposalReviewsForExperiment(
  experimentId: number | string,
): Promise<ReviewProposalListResponse> {
  // 🛑 **In remote mode the reviews are Gemma's.** `/curation/v1`
  // proxies to local_api in BOTH modes, so naming it unconditionally
  // read the store even when every experiment on the page came from
  // Gemma — a proposal written to Gemma had no surface here at all
  // (cab, 2026-09-03, on set 2563 / GSE6966).
  const remote = resolveGemmaMode().mode === "remote";
  try {
    const raw = await api.get<unknown>(
      reviewsPath(experimentId, remote, "proposals"),
    );
    return remote
      ? annotationSetsToReviews(raw, "proposal")
      : (raw as ReviewProposalListResponse);
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "status" in e &&
      (e as { status: number }).status === 404
    ) {
      return { items: [], total: 0 } as ReviewProposalListResponse;
    }
    throw e;
  }
}

/** Per-experiment list of proposal-kind CurationReviews, most recent
 *  first. Feeds the Proposal sidebar panel. Same 404-fallback as
 *  ``useAuditsForExperiment`` — production Gemma 2.0 doesn't yet
 *  serve this endpoint, so a 404 means "no proposals" rather than
 *  an error to surface. */
export function useProposalReviewsForExperiment(
  experimentId: number | string,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && Boolean(experimentId);
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    queryFn: () => fetchProposalReviewsForExperiment(experimentId),
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Proposal-review lists for MANY experiments — the ticket queue's
 *  disposition filter reads BOTH review kinds, because a ticket's
 *  findings live as ``kind='proposal'`` rows for review tickets and
 *  ``kind='audit'`` rows for audit tickets, and the queue can't know
 *  which up front. Same cache keys as the single-experiment hook;
 *  same gating rationale as ``useAuditsForExperiments``. */
export function useProposalReviewsForExperiments(
  experimentIds: Array<number | string>,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQueries({
    queries: experimentIds.map((id) => ({
      queryKey: KEY.byExperiment(id),
      queryFn: () => fetchProposalReviewsForExperiment(id),
      enabled: enabled && Boolean(id),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    })),
  });
}

/** Re-export the query-key namespace so callers (e.g. the panel's
 *  optimistic-cache update) can derive matching keys without
 *  hard-coding the tuple. */
export const REVIEW_PROPOSAL_KEYS = KEY;
