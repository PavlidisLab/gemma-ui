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
 * Both ids come straight off the wire. The gene links used to wait on
 * a batched symbol lookup, because the payloads carried Gemma's
 * internal gene id and nothing else; both endpoints serve ``ncbiId``
 * as of 2026-08-25, so that round-trip is gone.
 *
 * A link is still not guaranteed: a gene may arrive without an
 * ``ncbiId``, and a probe link needs a platform, which a
 * multi-platform dataset can't pin down for a given row. Either way
 * the tooltip names the thing and omits the link — naming without
 * linking beats linking somewhere wrong.
 */

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  NONSPECIFIC_MARK,
  type HeatmapPayloadRow,
  type HeatmapRowGene,
} from "@gemma/heatmap";
import { GeneSymbolLink } from "@/features/gene/GeneSymbolLink";

export interface ProbeRowTooltipProps {
  /** Probe name, e.g. ``1007_s_at``. Absent ⇒ no probe line: the DE
   *  endpoint returns some genes with no probe vector at all. */
  designElementName?: string | null;
  /** Probe id — what the probe page is addressed by. */
  designElementId?: number | null;
  /** Every gene the probe maps to, in wire order. */
  genes: HeatmapRowGene[];
  /** The platform the probe sits on. Absent ⇒ no probe link; see the
   *  multi-platform note in the header. */
  platformShortName?: string;
  /** Genes the viewer searched for. Empty (the default) means no
   *  search is driving the view, and nothing is tagged. */
  queried?: ReadonlySet<number>;
  /** What a particular heatmap knows about the row beyond the probe
   *  and its genes — the DE heatmap's FDR / p / log2FC. Rendered
   *  between the genes and the probe line. */
  children?: ReactNode;
}

export function ProbeRowTooltip({
  designElementName,
  designElementId,
  genes,
  platformShortName,
  queried,
  children,
}: ProbeRowTooltipProps) {
  const searched = queried ?? new Set<number>();
  // A gene with neither symbol nor name has nothing to show; drop it
  // rather than rendering an empty block.
  const named = genes.filter((g) => g.officialSymbol || g.name);
  const extras = searched.size > 0 ? named.filter((g) => !searched.has(g.id)).length : 0;

  // Sits flush under the last gene's ``ncbi:`` line and reads the same
  // way — both are "identifier: value" for the thing above them.
  const probeLine = !designElementName ? null : (
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
        {children}
        {probeLine}
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-800">
      <div className="space-y-1">
        {named.map((g) => {
          const ncbiId = g.ncbiId;
          const symbol = g.officialSymbol || `gene ${g.id}`;
          return (
            <div key={g.id}>
              <GeneSymbolLink
                symbol={symbol}
                ncbiId={ncbiId}
                className="font-mono font-semibold"
                linkClassName="text-sky-700 hover:underline"
              />
              {g.name ? (
                <span className="ml-2 text-slate-600">{g.name}</span>
              ) : null}
              {searched.size > 0 && !searched.has(g.id) ? (
                <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px align-middle">
                  not searched
                </span>
              ) : null}
              {ncbiId != null ? (
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/gene/${ncbiId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-700 hover:underline"
                    title="Open this gene at NCBI"
                  >
                    ncbi:{ncbiId}
                  </a>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {children}
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

/**
 * One gene symbol in a heatmap row's gutter label, as a link to its gene
 * page — the `renderRowLabelGene` every browser heatmap passes, so the
 * gutter links the same way the pop-up above does. The symbol is looked
 * up among the row's own genes; one that isn't there (the probe-name
 * fallback) stays plain text.
 */
export function rowLabelGeneLink(
  row: Pick<HeatmapPayloadRow, "geneSymbols" | "geneNcbiIds"> | undefined,
  symbol: string,
): ReactNode {
  const gi = row ? row.geneSymbols.indexOf(symbol) : -1;
  if (!row || gi < 0) return null;
  return (
    <GeneSymbolLink
      symbol={symbol}
      ncbiId={row.geneNcbiIds?.[gi]}
      // Inside the label, whose own click pins the pop-up.
      stopPropagation
    />
  );
}
