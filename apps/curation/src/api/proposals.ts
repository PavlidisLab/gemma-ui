import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { api, ApiError } from "./client";
import { asAnnotationSetRows } from "./annotationSetReviews";
import type {
  CuratorFeedback,
  Proposal,
  ProposalListResponse,
  ProposalStatus,
} from "./types";

const KEY = {
  all: ["proposals"] as const,
  byExperiment: (experimentId: number | string, status?: ProposalStatus) =>
    ["proposals", "experiment", experimentId, status ?? null] as const,
  one: (proposalId: string) => ["proposals", "one", proposalId] as const,
};

export function useProposalsForExperiment(
  experimentId: number | string,
  status?: ProposalStatus,
) {
  return useQuery({
    // 🛑 ``-1`` is the "no experiment selected" sentinel — Overview
    // passes ``draft?.experiment_id ?? -1`` while the draft loads — and
    // ``Boolean(-1)`` is TRUE, so this guard never skipped it. Measured
    // on the live app 2026-09-04: every experiment page in remote mode
    // fired ``GET /curation/v1/datasets/-1/curation-proposals`` at the
    // curation store before the real id arrived. The store answers 200
    // with an empty list, which is why it went unnoticed for so long:
    // the only symptom is a wasted round trip at the store, on a
    // service being retired.
    enabled: experimentId !== -1 && experimentId !== "-1" && Boolean(experimentId),
    queryKey: KEY.byExperiment(experimentId, status),
    queryFn: async () => {
      const q = status ? `?status_filter=${status}` : "";
      try {
        return await api.get<ProposalListResponse>(
          `/curation/v1/datasets/${experimentId}/curation-proposals${q}`,
        );
      } catch (e: unknown) {
        // Gemma 2.0 doesn't yet expose ``/datasets/{id}/curation-proposals``
        // (the local_api endpoint). Treat 404 as "no proposals
        // recorded for this experiment" instead of bubbling the
        // error into every consumer surface.
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          (e as { status: number }).status === 404
        ) {
          return { items: [], total: 0 } as ProposalListResponse;
        }
        throw e;
      }
    },
  });
}

/** One row of Gemma's corpus-wide annotation-set list, thin shape.
 *  Post-`snakeify`; only what the inbox renders is declared. */
interface ProposalSetRow {
  id: number;
  dataset_id: number;
  dataset_short_name?: string | null;
  kind?: string | null;
  status?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  agent_name?: string | null;
  ran_at?: string | null;
  factor_count?: number | null;
  tag_count?: number | null;
}

/**
 * One annotation-set row -> the `Proposal` the inbox renders.
 *
 * 🛑 **`factors` and `tags` are left UNDEFINED, not empty.** The list
 * response carries counts, not the payload, and the difference between
 * "no factors" and "we were not told" is the whole point — see
 * `ShapeSummary`, which renders `(empty)` for the first and must not
 * for the second.
 */
export function proposalSetToProposal(row: ProposalSetRow): Proposal {
  return {
    proposal_id: String(row.id),
    experiment_id: row.dataset_id,
    experiment_short_name: row.dataset_short_name ?? "",
    submitted_at: row.ran_at ?? row.created_at ?? "",
    submitted_by: row.created_by ?? row.agent_name ?? "",
    status: (row.status ?? "pending") as ProposalStatus,
    factor_count: row.factor_count ?? null,
    tag_count: row.tag_count ?? null,
  } as Proposal;
}

/**
 * Cross-experiment list of proposals (newest first). Backs the
 * ``Proposals`` inbox route. Default ``status`` is "pending" — the
 * curator inbox is meant to surface unreviewed agent output.
 *
 * 🛑 **Remote sends `kind=proposal` as well as `role=proposal`, and the
 * second one is not optional.** `role` is the STORAGE role and `kind`
 * is the audit-vs-proposal split; they are independent axes. Measured
 * on gemma2 2026-09-04: six of the eight `role=proposal` sets are
 * `kind=audit`, so filtering on `role` alone puts audit output in the
 * proposals inbox three to one against the real rows. cab caught this
 * before it shipped; gembro then added the `kind` parameter, which
 * 400s on an unrecognized value rather than serving an unfiltered list
 * to a caller that believes it filtered.
 *
 * ⚠️ **Built against gembro's contract, not against a live wire.** The
 * fields below (`status`, `factorCount`, `tagCount`, `datasetShortName`)
 * are committed and their migrations applied, but frink does not
 * autodeploy and none of it was live when this was written. Verify
 * against the real response before trusting it — a declared field being
 * absent from Gemma is a thing that has happened here before.
 */
export function useAllProposals(
  options: { status?: ProposalStatus; limit?: number } = {},
) {
  const status = options.status ?? "pending";
  const limit = options.limit ?? 100;
  const remote = resolveGemmaMode().mode === "remote";
  return useQuery({
    queryKey: ["proposals", "all", status, limit, remote] as const,
    queryFn: async (): Promise<ProposalListResponse> => {
      if (!remote) {
        return await api.get<ProposalListResponse>(
          `/curation/v1/curation-proposals?status_filter=${status}&limit=${limit}`,
        );
      }
      const raw = await api.get<unknown>(
        `/rest/v2/annotation-sets?role=proposal&kind=proposal` +
          `&status=${encodeURIComponent(status)}&limit=${limit}`,
      );
      // 🛑 The collection route answers a PAGINATED envelope, not a
      // bare array — `asAnnotationSetRows` is the guard that already
      // knows both shapes. Reading `.data` by hand here is how the
      // list silently reads empty.
      const rows = asAnnotationSetRows(raw) as unknown as ProposalSetRow[];
      const items = rows.map(proposalSetToProposal);
      // `totalElements` is the server's count for THIS filter — gembro
      // put the new predicates on the count query as well as the page,
      // so it is pageable-to rather than a total for a different list.
      const total =
        (raw as { total_elements?: number } | null)?.total_elements ??
        items.length;
      return { items, total } as ProposalListResponse;
    },
  });
}

export function useProposal(proposalId: string | undefined) {
  return useQuery({
    queryKey: KEY.one(proposalId ?? ""),
    queryFn: () => api.get<Proposal>(`/curation/v1/curation-proposals/${proposalId}`),
    enabled: !!proposalId,
  });
}

/**
 * Body shape for ``POST /propose/{accession}``. Mirrors
 * ``ProposeRequest`` in ``gemma_curation_agents/proposer_service.py``.
 * Every field optional; default is "use cache, fresh preboarding off,
 * no overwrite" — same as ``./run_propose.sh GSE…`` with no flags.
 */
export interface TriggerProposalBody {
  /** Generic capability tier — server resolves to a provider
   *  model id. Preferred over ``model``; mutually exclusive with
   *  it (``model`` wins server-side if both are sent). */
  tier?: "fast" | "standard" | "strong";
  /** Provider-specific model id escape hatch. Use ``tier`` first;
   *  this exists for ad-hoc overrides (e.g. trying a brand-new
   *  model id before adding it to the tier registry). */
  model?: string;
  fresh_preboarding?: boolean;
  allow_overwrite?: boolean;
  use_cache?: boolean;
  refresh_cache?: boolean;
  /** Curator's free-text override from the redo-with-notes flow.
   *  When set, the design-proposer prompt grows a
   *  ``## Curator feedback from previous attempt`` block ahead of
   *  the candidate-factors hint, instructing the model to treat
   *  the feedback as a strong override. Backwards compatible —
   *  agents predating the field ignore it. */
  prior_feedback?: string | null;
  /** When the preboarding carries no GEO-linked publication, look one
   *  up via pub_finder and use it for the rest of the run. Agent
   *  default true; omit to take it. */
  find_pub_if_missing?: boolean;
  /** Ablation flag — strip every publication id, skip pub_finder and
   *  skip biolit, so the proposer sees only the per-sample data.
   *  Provenance records ``id_source='withheld'``. This is the switch
   *  for measuring the proposer without a paper carrying it. */
  withhold_publication?: boolean;
}

/**
 * Kick the proposer service to build + submit a fresh proposal for
 * an accession. The service runs the pipeline synchronously, so this
 * mutation can take 30-90s for a fresh preboarding state (cache hits return
 * in seconds). On success, invalidate the proposal queries so the
 * sidebar pulls in the new pending row.
 *
 * The Vite dev proxy routes ``/propose/*`` to ``$GEMMA_PROPOSER_URL``
 * (default ``http://localhost:8090``); Phase 2's central deploy
 * routes the same path through nginx to the same service. Either
 * way the UI hits a relative path so neither dev nor prod needs a
 * build-time URL.
 */
export function useTriggerProposal(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accession,
      body,
    }: {
      accession: string;
      body?: TriggerProposalBody;
    }) =>
      api.post<Proposal>(
        `/propose/${encodeURIComponent(accession)}`,
        body ?? {},
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proposals"] }),
        qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) }),
      ]);
    },
  });
}

/**
 * Response shape for ``POST /find-publication/{accession}``. Mirrors
 * ``FindPublicationsResult`` in
 * ``gemma_curation_agents/agents/pub_finder/finder.py``.
 *
 * ``source`` is the discriminator the UI branches on:
 *   - ``geo_linked_pmids``: at least one Pubmed-ID came back from GEO
 *     (``candidates`` may still be empty if every PMID 404s on
 *     PubMed metadata; ``note`` carries the reason).
 *   - ``no_geo_record``: biolit returned ``None`` for the accession.
 *   - ``no_linked_pmids``: GEO record exists but has no Pubmed-ID;
 *     curator should fall back to a manual PubMed search.
 */
export interface PublicationCandidate {
  pmid: string;
  doi: string | null;
  title: string;
  citation: string;
  pubmed_url: string;
}
export interface FindPublicationsResult {
  accession: string;
  source: "geo_linked_pmids" | "no_geo_record" | "no_linked_pmids";
  candidates: PublicationCandidate[];
  note: string | null;
}

/**
 * Look up candidate publications for an experiment by GEO accession.
 * Phase 1 just returns Pubmed-IDs already linked in the GEO record;
 * phase 2 will add an LLM-driven contributor / title search.
 *
 * The agents-side pub-finder is wired into the same FastAPI process
 * as ``/propose/*``; the Vite dev proxy routes ``/find-publication/*``
 * there. No body — accession in the path is all we need.
 */
export function useFindPublication() {
  return useMutation({
    mutationFn: ({ accession }: { accession: string }) =>
      api.post<FindPublicationsResult>(
        `/find-publication/${encodeURIComponent(accession)}`,
        {},
      ),
  });
}

export function useReviewProposal(experimentId: number | string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      feedback,
    }: {
      proposalId: string;
      feedback: CuratorFeedback;
    }) =>
      api.patch<Proposal>(
        `/curation/v1/curation-proposals/${proposalId}`,
        feedback,
      ),
    // Await the invalidations so callers using ``mutateAsync().then(...)``
    // see fresh data downstream. Prefix-matching means ``["proposals"]``
    // already covers ``KEY.one(id)`` and ``KEY.byExperiment(id)``, but
    // we keep the narrower invalidates explicit so a future refactor
    // that narrows the broad call doesn't silently break either path.
    onSuccess: async (_data, { proposalId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proposals"] }),
        qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) }),
        qc.invalidateQueries({ queryKey: KEY.one(proposalId) }),
      ]);
    },
    // 404 = the proposal we're patching has already been retired
    // server-side (rejected from another tab, mock DB reset, etc).
    // The card holding it is now cruft. Two passes:
    //   1. Optimistically drop it from any cached per-experiment
    //      list and from the per-id cache. This is what makes the
    //      card unmount immediately — invalidate-only worked in
    //      theory but the mock occasionally still echoed the
    //      proposal in the listing endpoint after the per-id
    //      404, which kept the card visible.
    //   2. Invalidate so a server-side refetch eventually
    //      reconciles. If the listing comes back consistent
    //      (proposal really is gone), this is a no-op; if it
    //      comes back surprising (proposal reappears), the
    //      parent re-renders with whatever the server says.
    onError: async (err, { proposalId }) => {
      if (err instanceof ApiError && err.status === 404) {
        // Drop from all cached per-experiment listings, regardless
        // of the status filter the caller used — we don't track
        // every variant, so iterate the cache.
        qc.setQueriesData<ProposalListResponse>(
          { queryKey: ["proposals", "experiment", experimentId] },
          (old) => {
            if (!old) return old;
            const items = old.items.filter(
              (p) => p.proposal_id !== proposalId,
            );
            if (items.length === old.items.length) return old;
            return { ...old, items, total: items.length };
          },
        );
        qc.removeQueries({ queryKey: KEY.one(proposalId) });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["proposals"] }),
          qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) }),
        ]);
      }
    },
  });
}
