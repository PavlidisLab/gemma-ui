import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./client";

/**
 * The subsets Gemma has already cut from a dataset —
 * `GET /rest/v2/datasets/{id}/subSets`.
 *
 * 🛑 **These are not the same thing as the subset RECOMMENDATIONS in
 * `DownstreamShapeBlock`.** That panel shows what the proposer thinks
 * SHOULD be split; this is what Gemma HAS. Nothing in either app read
 * this route before 2026-08-31, so an experiment carrying 275 subsets
 * and 45 cell-type annotations looked identical to one carrying none.
 *
 * 🛑 **Two different things are called a subset, and only one carries
 * annotations.** Measured on gemma2 `0293d82c47`:
 *
 *     38390 (classic, cut on the organism-part factor)
 *       3 subsets, 3 names — "Subset for larynx" — `characteristics: []`
 *
 *     44580 (single-cell)
 *       275 subsets, 45 names — "<parent title> - CA1-prosubiculum
 *       hippocampal neuron" — each with a `cell type` characteristic
 *
 * The single-cell ones are cut per cell-type assignment, and each
 * carries a COPY of a cell-level characteristic
 * (`SingleCellExpressionExperimentSubSetServiceImpl`). That copy is
 * constructed fresh rather than pointing at a factor value, which is why
 * these annotations belong to no factor and appear nowhere in the
 * design. Corpus-wide: 4,136 parent experiments, all `cell type`,
 * roughly 77% grounded — the ungrounded remainder being author cluster
 * labels with no CL term (`L4 RSP-ACA glutamatergic neuron`).
 *
 * 🛑 **The row count is not the subset count.** 275 rows resolve to 45
 * distinct names on 44580, and 47,143 rows to 19,391 names corpus-wide
 * (2.4×, varying by experiment). Nobody has explained it yet, so
 * `useDatasetSubsets` reports BOTH numbers and the panel says so rather
 * than quietly showing the deduplicated list as if it were the whole
 * truth.
 *
 * 🛑 **Do not reach for `/subSetGroups` to solve that.** It answers
 * `500 Cannot invoke "java.util.Set.stream()" because "factorValues" is
 * null` on exactly the single-cell datasets this panel exists for
 * (44580), because their subsets have no factor values. It works on the
 * classic ones (38390 → 1 group).
 *
 * Gemma-only in both modes, like `sourceMetadata` and the diagnostics
 * routes — the store serves no such path, so a `404` is the ordinary
 * local-mode answer and renders as "nothing to show", not an error.
 */

/** One characteristic on a subset, post-`snakeify`. Same four fields as
 *  the renamed `/annotations` shape. */
export interface SubsetCharacteristic {
  id?: number | null;
  category?: string | null;
  category_uri?: string | null;
  value?: string | null;
  value_uri?: string | null;
}

/** One row of `/datasets/{id}/subSets`, post-`snakeify`. */
export interface DatasetSubset {
  id: number;
  name?: string | null;
  description?: string | null;
  source_experiment_id?: number | null;
  source_experiment_short_name?: string | null;
  characteristics?: SubsetCharacteristic[] | null;
  sub_set_group_ids?: number[] | null;
}

/** One subset as the curator should see it: the name, its annotation,
 *  and how many rows in Gemma carry that same name. */
export interface DistinctSubset {
  /** The subset name, verbatim. */
  name: string;
  /** Lowest id among the rows sharing this name — a stable key. */
  id: number;
  /** How many rows Gemma returned under this name. 1 is the expected
   *  value; anything higher is the unexplained duplication. */
  rows: number;
  /** Distinct characteristics across those rows. Empty on a classic
   *  factor-cut subset, which carries none. */
  characteristics: SubsetCharacteristic[];
}

export interface SubsetSummary {
  /** Distinct subsets, in the order Gemma first returned them. */
  subsets: DistinctSubset[];
  /** Rows Gemma returned, before collapsing by name. */
  rowCount: number;
  /** The prefix every name shares, if they all share one — on the
   *  single-cell path it is the parent experiment's title plus " - ",
   *  which is the same on all 45 and worth trimming for reading.
   *  Empty when the names have no common prefix. */
  commonPrefix: string;
}

export const NO_SUBSETS: SubsetSummary = {
  subsets: [],
  rowCount: 0,
  commonPrefix: "",
};

function charKey(c: SubsetCharacteristic): string {
  return `${c.category ?? ""}\u0000${c.value ?? ""}\u0000${c.value_uri ?? ""}`;
}

/** The prefix shared by every name, cut back to the last " - " so it
 *  ends on a separator rather than mid-word. Returns "" unless there
 *  are at least two names and the shared part is a real prefix. */
export function sharedNamePrefix(names: string[]): string {
  if (names.length < 2) return "";
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  const cut = prefix.lastIndexOf(" - ");
  return cut > 0 ? prefix.slice(0, cut + 3) : "";
}

export function summarizeSubsets(rows: DatasetSubset[]): SubsetSummary {
  const byName = new Map<string, DistinctSubset>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, id: r.id, rows: 0, characteristics: [] };
      byName.set(name, entry);
    }
    entry.rows += 1;
    entry.id = Math.min(entry.id, r.id);
    for (const c of r.characteristics ?? []) {
      if (!entry.characteristics.some((e) => charKey(e) === charKey(c))) {
        entry.characteristics.push(c);
      }
    }
  }
  const subsets = [...byName.values()];
  return {
    subsets,
    rowCount: rows.length,
    commonPrefix: sharedNamePrefix(subsets.map((s) => s.name)),
  };
}

export function useDatasetSubsets(
  experimentId: number | string | null | undefined,
) {
  return useQuery<SubsetSummary>({
    queryKey: ["dataset-subsets", String(experimentId ?? "")],
    enabled: experimentId != null && experimentId !== "",
    queryFn: async () => {
      try {
        const rows = await api.get<DatasetSubset[] | null>(
          `/rest/v2/datasets/${experimentId}/subSets`,
        );
        return summarizeSubsets(Array.isArray(rows) ? rows : []);
      } catch (e) {
        // 404 is the local-mode answer and the not-in-this-Gemma
        // answer both; neither is worth an error state on a panel
        // that is additive.
        if (e instanceof ApiError && e.status === 404) return NO_SUBSETS;
        throw e;
      }
    },
    // Subsets change when an aggregation runs, not while a curator reads.
    staleTime: 30 * 60_000,
    retry: false,
  });
}
