import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";

/**
 * The Gemma experiment sets (`ExpressionExperimentSet`) an experiment
 * belongs to — `GET /rest/v2/experiment-sets`.
 *
 * 🛑 **Not the same thing as an `ExperimentGroup`.** The banner already
 * shows chips for the curation-side workflow groups a dataset is in
 * (`ExperimentGroupChips`, from the local store). These are Gemma's own
 * sets — the ones a `/browse` user filters by, 640 of them on prod, with
 * names like `331cancer`, `Brain GPL570`, `blood/gtex eqtl versus
 * smoking`. A curator needs to know an experiment is in one before
 * editing it, because someone else's analysis is keyed on that
 * membership. Neither surface subsumes the other; both render.
 *
 * 🛑 **There is no reverse lookup, so this reads the whole list and
 * filters client-side.** Gemma serves `/experiment-sets/{id}/datasets`
 * (forward) but nothing answers "which sets contain dataset X".
 * Measured on gemma2 `e8ccbfaae0`: 640 sets, `limit` caps at 100, so
 * seven pages of ~48 KB with `includeMembers=true`, ~0.4 s each.
 *
 * That is affordable exactly once, so the query key is deliberately
 * NOT per-experiment — every experiment page in a session shares one
 * cached list, and `useExperimentSetsFor` filters it in memory. Walking
 * between experiments costs nothing after the first. An ask for a
 * reverse route is filed; when it lands, this collapses to one call and
 * the paging below should go.
 *
 * Gemma-only in both modes, like `subsets.ts` — the store serves no
 * such route, so a 404 or a failure yields "no sets" rather than an
 * error state on a banner.
 */

/** `ExpressionExperimentSetValueObject`, post-`snakeify`. */
export interface ExperimentSet {
  id: number;
  name?: string | null;
  description?: string | null;
  size?: number | null;
  taxon_name?: string | null;
  is_public?: boolean | null;
  /** Populated only with `includeMembers=true`. The membership test. */
  expression_experiment_ids?: number[] | null;
}

/** Gemma caps `limit` at 100 — a larger value is a 400, not a clamp. */
const PAGE = 100;
/** Stop after this many pages even if the server keeps offering more.
 *  640 sets today; the cap is a guard against a runaway loop if
 *  `totalElements` ever disagrees with what is returned, not a limit
 *  anyone should hit. */
const MAX_PAGES = 20;

interface Page {
  data?: ExperimentSet[] | null;
  total_elements?: number | null;
}

export async function fetchAllExperimentSets(): Promise<ExperimentSet[]> {
  const out: ExperimentSet[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(PAGE),
      offset: String(page * PAGE),
      includeMembers: "true",
    });
    // 🛑 The paginated envelope is NOT unwrapped to a bare array here —
    // `total_elements` is what says whether another page exists, and a
    // short page is the only other stop signal.
    const r = await api.get<Page | ExperimentSet[]>(
      `/rest/v2/experiment-sets?${params.toString()}`,
    );
    const rows = Array.isArray(r) ? r : (r?.data ?? []);
    out.push(...rows);
    if (rows.length < PAGE) break;
    const total = Array.isArray(r) ? null : (r?.total_elements ?? null);
    if (typeof total === "number" && out.length >= total) break;
  }
  return out;
}

/** Every set, once per session. Shared key on purpose — see above. */
export function useAllExperimentSets(enabled = true) {
  return useQuery<ExperimentSet[]>({
    queryKey: ["experiment-sets", "all"],
    enabled,
    queryFn: async () => {
      try {
        return await fetchAllExperimentSets();
      } catch (e) {
        // A banner ornament must never become an error state. Local
        // mode 404s the route entirely.
        if (e instanceof ApiError) return [];
        throw e;
      }
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** The sets whose membership includes this experiment, by id.
 *
 *  🛑 Compared as NUMBERS. The route ids arrive numeric and the
 *  experiment id reaches the UI as either — a string/number mismatch
 *  here returns "no sets", which is indistinguishable from the common
 *  case and so would never be noticed. */
export function setsContaining(
  sets: ExperimentSet[],
  experimentId: number | string | null | undefined,
): ExperimentSet[] {
  const id = Number(experimentId);
  if (!Number.isFinite(id)) return [];
  return sets.filter((s) => (s.expression_experiment_ids ?? []).includes(id));
}

export function useExperimentSetsFor(
  experimentId: number | string | null | undefined,
) {
  const all = useAllExperimentSets(experimentId != null && experimentId !== "");
  return {
    ...all,
    sets: setsContaining(all.data ?? [], experimentId),
  };
}
