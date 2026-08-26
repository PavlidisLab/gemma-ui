/**
 * The pop-up that opens when you hover a heatmap row's label.
 *
 * One component for every heatmap that labels rows by probe→gene — the
 * Expression tab and the Diagnostics tab's top-loaded-probes popup —
 * so the same probe reads the same way wherever you meet it. The
 * Expression tab's version is the baseline; the PC-loadings popup used
 * to render its own near-copy with different wording and a different
 * set of links.
 *
 * It lives in the app rather than in ``@gemma/heatmap`` because it
 * links into the app's own routes, and that package is shared with the
 * curation app, which has no such routes. The package owns what a row
 * *says* (``probeRowLabel``); this owns what its pop-up shows.
 *
 * **Links go on the ids that actually address the thing.** A gene by
 * its NCBI id, because that's what the gene page is keyed by; a probe
 * by its design-element id under its platform, because that's the only
 * way REST can resolve one. Gemma's internal gene id used to be shown
 * here too — it addressed nothing and is gone.
 *
 * Neither link is guaranteed. The wire carries internal gene ids, not
 * NCBI ones, so gene links wait on a lookup; and a probe link needs a
 * platform, which a multi-platform dataset can't pin down for a given
 * row. In both cases the tooltip still names the thing and just omits
 * the link — naming without linking beats linking somewhere wrong.
 */

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { NONSPECIFIC_MARK, type HeatmapRowGene } from "@gemma/heatmap";
import { getTaxonGenesBySymbols } from "@/api/endpoints";

/**
 * Gemma-internal gene id → NCBI gene id, for a set of genes.
 *
 * The gene page is keyed by NCBI id (symbols collide across taxa), but
 * every heatmap payload — ``heatmap-data`` and ``/svd/loadings`` alike
 * — carries only Gemma's internal id, and ``/genes/{internalId}``
 * answers empty for it rather than erroring. The taxon-scoped symbol
 * lookup returns records holding both, so one batched call over the
 * distinct symbols on screen bridges the gap.
 *
 * Empty map while in flight, with no taxon to scope by, or on failure
 * — the tooltip then names every gene without linking.
 */
export function useNcbiIdsByGeneId(
  genes: HeatmapRowGene[],
  taxon: string | undefined,
): Map<number, number> {
  const symbols = useMemo(() => {
    const out = new Set<string>();
    for (const g of genes) if (g.officialSymbol) out.add(g.officialSymbol);
    return Array.from(out).sort();
  }, [genes]);

  const q = useQuery({
    queryKey: ["taxon-genes-by-symbol", taxon ?? "", symbols.join(",")],
    queryFn: ({ signal }) => getTaxonGenesBySymbols(taxon!, symbols, signal),
    enabled: !!taxon && symbols.length > 0,
    staleTime: 30 * 60_000,
  });

  return useMemo(() => {
    const m = new Map<number, number>();
    // Key on the internal id the lookup echoes back, not on the symbol
    // we sent — exact, and immune to case / alias mismatches.
    for (const g of q.data ?? []) if (g.ncbiId != null) m.set(g.id, g.ncbiId);
    return m;
  }, [q.data]);
}

export interface ProbeRowTooltipProps {
  /** Probe name, e.g. ``1007_s_at``. */
  designElementName: string;
  /** Probe id — what the probe page is addressed by. */
  designElementId?: number | null;
  /** Every gene the probe maps to, in wire order. */
  genes: HeatmapRowGene[];
  /** Internal gene id → NCBI id, from ``useNcbiIdsByGeneId``. Genes
   *  missing from it render unlinked. */
  ncbiIdByGeneId?: Map<number, number>;
  /** The platform the probe sits on. Absent ⇒ no probe link; see the
   *  multi-platform note in the header. */
  platformShortName?: string;
  /** Genes the viewer searched for. Empty (the default) means no
   *  search is driving the view, and nothing is tagged. */
  queried?: ReadonlySet<number>;
}

export function ProbeRowTooltip({
  designElementName,
  designElementId,
  genes,
  ncbiIdByGeneId,
  platformShortName,
  queried,
}: ProbeRowTooltipProps) {
  const searched = queried ?? new Set<number>();
  // A gene with neither symbol nor name has nothing to show; drop it
  // rather than rendering an empty block.
  const named = genes.filter((g) => g.officialSymbol || g.name);
  const extras = searched.size > 0 ? named.filter((g) => !searched.has(g.id)).length : 0;

  // Sits flush under the last gene's ``ncbi:`` line and reads the same
  // way — both are "identifier: value" for the thing above them.
  const probeLine = (
    <div className="text-[10px] text-slate-500 font-mono">
      {platformShortName && designElementId != null ? (
        <Link
          to="/platforms/$shortName/probe/$elementId"
          params={{
            shortName: platformShortName,
            elementId: String(designElementId),
          }}
          className="text-sky-700 hover:underline"
          title="Open this probe's page"
        >
          probe:{designElementName}
        </Link>
      ) : (
        <span>probe:{designElementName}</span>
      )}
    </div>
  );

  if (named.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        <div className="italic">maps to no gene</div>
        {probeLine}
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-800">
      <div className="space-y-1">
        {named.map((g) => {
          const ncbiId = ncbiIdByGeneId?.get(g.id);
          const symbol = g.officialSymbol || `gene ${g.id}`;
          return (
            <div key={g.id}>
              {ncbiId != null ? (
                <Link
                  to="/gene/ncbi/$ncbiId"
                  params={{ ncbiId: String(ncbiId) }}
                  className="font-mono font-semibold text-sky-700 hover:underline"
                  title="Open this gene's page"
                >
                  {symbol}
                </Link>
              ) : (
                <span className="font-mono font-semibold">{symbol}</span>
              )}
              {g.name ? (
                <span className="ml-2 text-slate-600">{g.name}</span>
              ) : null}
              {searched.size > 0 && !searched.has(g.id) ? (
                <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px align-middle">
                  not searched
                </span>
              ) : null}
              {ncbiId != null ? (
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  ncbi:{ncbiId}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* The probe belongs to the row, not to each gene — one line at
          the bottom rather than repeated in every block. */}
      {probeLine}
      {extras > 0 ? (
        <div className="text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-200">
          <span className="font-mono">{NONSPECIFIC_MARK}</span> this probe also
          measures {extras} gene{extras === 1 ? "" : "s"} you didn’t search for
          — the signal isn’t specific to your selection.
        </div>
      ) : null}
    </div>
  );
}
