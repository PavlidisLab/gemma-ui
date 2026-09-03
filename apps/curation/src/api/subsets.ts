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
 * 🛑 **The row count is not the subset count** — 275 rows resolve to 45
 * distinct names on 44580, and 47,143 rows to 19,391 names corpus-wide
 * (2.4×, varying by experiment). That 2.4× IS the superseded groups
 * above. `useDatasetSubsets` still reports both numbers, because a
 * name can also repeat inside one group.
 *
 * ✅ **`/subSetGroups` is the answer to that, and its 500 is fixed.**
 * The route used to reply `500 Cannot invoke "java.util.Set.stream()"
 * because "factorValues" is null` on exactly the single-cell datasets
 * this panel exists for; re-measured 2026-09-03 on gemma2 `d255303a`,
 * **100 of 100 single-cell datasets answer 200** (8 legitimately carry
 * no groups).
 *
 * 🛑 **And it explains the duplication: a dataset carries SEVERAL subset
 * groups, all but one of them a superseded cut.** Census of those 100 —
 * 92 have groups, **57 of the 92 (62%) have more than one**, 139 extra
 * groups in all; eid 76967 has 32 (1 live + 31 dead). The dead cut is
 * routinely BIGGER than the live one (77392: live 8, dead 36), so the
 * flat `/subSets` list is dominated by rows nobody should act on. On
 * eid 79038 the two groups are the same ten cell types twice — the live
 * one grounded to CL, the dead one holding the author's raw strings
 * (`opc`, `t_cell`, `endothelia`).
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

/* ------------------------------------------------------------------ *
 * Subset GROUPS — which cut is live, and which are superseded.
 * ------------------------------------------------------------------ */

/** One quantitation type on a subset group, post-`snakeify`. Only
 *  `is_preferred` is read: it is what separates the live cut from the
 *  dead ones. */
export interface SubsetGroupQuantitationType {
  id?: number | null;
  name?: string | null;
  is_preferred?: boolean | null;
}

/** One row of `/datasets/{id}/subSetGroups`, post-`snakeify`.
 *
 *  🛑 **`sub_sets` here comes back with `characteristics: []`** — the
 *  group route does not populate them. The annotations live on
 *  `/subSets`, which carries `sub_set_group_ids` to join back. So both
 *  calls are needed; neither alone answers "what is in this group". */
export interface SubsetGroup {
  id: number;
  name?: string | null;
  factors?: { id?: number | null; name?: string | null }[] | null;
  quantitation_types?: SubsetGroupQuantitationType[] | null;
  sub_sets?: { id: number }[] | null;
}

/** A group with its subsets joined back in and its liveness decided. */
export interface SubsetGroupView {
  id: number;
  name: string;
  /** Distinct subsets in this group, collapsed by name. */
  subsets: DistinctSubset[];
  /** Rows Gemma returned for this group, before collapsing. */
  rowCount: number;
  commonPrefix: string;
  /** Names of the experimental factors this group is cut on. */
  factorNames: string[];
  /** True when any of the group's quantitation types is preferred. */
  preferred: boolean;
  /** How many of this group's subsets carry a grounded characteristic. */
  groundedCount: number;
  /** Set on every group but the live one. */
  superseded: boolean;
}

export interface SubsetGroupsSummary {
  groups: SubsetGroupView[];
  /** Subsets belonging to no group at all. Empty on every dataset
   *  measured so far, but a flat list that silently drops rows is the
   *  failure this panel exists to stop. */
  ungrouped: DistinctSubset[];
  /** True when the live group could not be picked — two groups claim a
   *  preferred quantitation type, or none does. 2 of 92 datasets
   *  (65454, 51179). The panel says so instead of guessing. */
  liveAmbiguous: boolean;
}

export const NO_SUBSET_GROUPS: SubsetGroupsSummary = {
  groups: [],
  ungrouped: [],
  liveAmbiguous: false,
};

function isGrounded(s: DistinctSubset): boolean {
  return s.characteristics.some((c) => !!c.value_uri);
}

/**
 * Join `/subSets` rows onto `/subSetGroups` and mark the live cut.
 *
 * 🛑 **Liveness is decided by the PREFERRED QUANTITATION TYPE, not by
 * "has a factor".** Measured over 92 single-cell datasets 2026-09-03:
 * exactly-one-group-is-preferred holds on **90**, while
 * exactly-one-group-has-a-factor fails on **10** (75811, 75052, 67057,
 * 67053 each have two groups that both carry a factor). When the
 * preferred test does not resolve to exactly one group — 65454 and
 * 51179 — nothing is marked superseded and `liveAmbiguous` is set, so
 * the curator sees every group rather than a coin-flip.
 *
 * The stronger signal is that the DEA analyses all point at one group
 * (eid 79038: 10 of 10 on the live group, 0 on the dead one), but that
 * is another request; this join is free once both lists are in hand.
 */
export function summarizeSubsetGroups(
  rows: DatasetSubset[],
  groups: SubsetGroup[],
): SubsetGroupsSummary {
  const byGroup = new Map<number, DatasetSubset[]>();
  const orphans: DatasetSubset[] = [];
  for (const r of rows) {
    const ids = r.sub_set_group_ids ?? [];
    if (ids.length === 0) {
      orphans.push(r);
      continue;
    }
    for (const g of ids) {
      const list = byGroup.get(g) ?? [];
      list.push(r);
      byGroup.set(g, list);
    }
  }

  const preferredIds = groups
    .filter((g) =>
      (g.quantitation_types ?? []).some((q) => q.is_preferred === true),
    )
    .map((g) => g.id);
  const liveAmbiguous = preferredIds.length !== 1;
  const liveId = liveAmbiguous ? null : preferredIds[0];

  const views: SubsetGroupView[] = groups.map((g) => {
    const summary = summarizeSubsets(byGroup.get(g.id) ?? []);
    return {
      id: g.id,
      name: (g.name ?? "").trim(),
      subsets: summary.subsets,
      rowCount: summary.rowCount,
      commonPrefix: summary.commonPrefix,
      factorNames: (g.factors ?? [])
        .map((f) => (f.name ?? "").trim())
        .filter(Boolean),
      preferred: (g.quantitation_types ?? []).some(
        (q) => q.is_preferred === true,
      ),
      groundedCount: summary.subsets.filter(isGrounded).length,
      superseded: liveId != null && g.id !== liveId,
    };
  });

  // Live cut first; then the superseded ones largest-first, because a
  // dead cut of 36 is the one a curator will ask about.
  views.sort((a, b) => {
    if (a.superseded !== b.superseded) return a.superseded ? 1 : -1;
    return b.subsets.length - a.subsets.length;
  });

  return {
    groups: views,
    ungrouped: summarizeSubsets(orphans).subsets,
    liveAmbiguous,
  };
}

/** `/datasets/{id}/subSetGroups` joined with `/datasets/{id}/subSets`.
 *
 *  Both calls are needed — see `SubsetGroup.sub_sets`. A 404 on either
 *  is the ordinary local-mode answer and renders as "nothing to show". */
export function useDatasetSubsetGroups(
  experimentId: number | string | null | undefined,
) {
  return useQuery<SubsetGroupsSummary>({
    queryKey: ["dataset-subset-groups", String(experimentId ?? "")],
    enabled: experimentId != null && experimentId !== "",
    queryFn: async () => {
      try {
        const [rows, groups] = await Promise.all([
          api.get<DatasetSubset[] | null>(
            `/rest/v2/datasets/${experimentId}/subSets`,
          ),
          api.get<SubsetGroup[] | null>(
            `/rest/v2/datasets/${experimentId}/subSetGroups`,
          ),
        ]);
        return summarizeSubsetGroups(
          Array.isArray(rows) ? rows : [],
          Array.isArray(groups) ? groups : [],
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return NO_SUBSET_GROUPS;
        throw e;
      }
    },
    staleTime: 30 * 60_000,
    retry: false,
  });
}
