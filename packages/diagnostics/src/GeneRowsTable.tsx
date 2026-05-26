/**
 * Gene-rows table — rendered next to or below any heatmap whose rows
 * are genes (PC-loadings popup, top-DE-genes heatmap, etc.).
 *
 * The convention Paul confirmed 2026-05-26:
 *   "When we show heatmaps with lists of genes, always include the
 *    gene official symbol, official name, and links to the gene in
 *    Gemma. If it's a microarray, the probe (CompositeSequence) id
 *    can be shown as a link as well, but put gene-first."
 *
 * URL builders are app-supplied callbacks rather than hardcoded so the
 * shared package stays free of `import.meta.env` / gemmaUrl coupling.
 * Browser passes `geneUrl` / `compositeSequenceUrl` from its
 * `lib/gemmaConfig`; curation passes equivalent helpers from its own
 * config.
 */

export interface GeneRow {
  /** Heatmap row index (1-based for display). */
  index: number;
  geneSymbol?: string | null;
  geneOfficialName?: string | null;
  /** NCBI id — stable across rebuilds, preferred for the gene link. */
  geneNcbiId?: number | null;
  /** Gemma-internal gene id; fallback when NCBI id is absent. */
  geneId?: number | null;
  /** CompositeSequence id — surfaced as a probe link for microarray
   *  platforms. Optional everywhere because sequencing / gene-list
   *  platforms use the gene id itself as the design element. */
  designElementId?: number | null;
  /** Probe / design-element name — fallback display when no gene
   *  symbol resolves. */
  designElementName?: string | null;
}

export interface GeneRowsTableProps {
  rows: GeneRow[];
  /** Optional one-line caption above the table. */
  caption?: string;
  /** Tailwind max-height class for the scroll container. */
  maxHeightClass?: string;
  /** Returns the gene-page URL (Gemma) for a row, or null when no
   *  link should be rendered. Caller-supplied so the package stays
   *  app-config-free. */
  geneHref?: (row: GeneRow) => string | null;
  /** Returns the probe (CompositeSequence) URL for a row, or null. */
  probeHref?: (row: GeneRow) => string | null;
}

export function GeneRowsTable({
  rows,
  caption,
  maxHeightClass = "max-h-[400px]",
  geneHref,
  probeHref,
}: GeneRowsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic px-2 py-3">
        No gene rows to show.
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {caption ? (
        <div className="text-[11px] text-slate-500 px-1 pb-1">{caption}</div>
      ) : null}
      <div
        className={`overflow-auto rounded border border-slate-200 dark:border-slate-700 ${maxHeightClass}`}
      >
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1 text-right font-medium w-8">#</th>
              <th className="px-2 py-1 text-left font-medium">Symbol</th>
              <th className="px-2 py-1 text-left font-medium">Official name</th>
              <th className="px-2 py-1 text-left font-medium w-24">Probe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <GeneRowLine
                key={r.index}
                row={r}
                geneHref={geneHref}
                probeHref={probeHref}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GeneRowLine({
  row,
  geneHref,
  probeHref,
}: {
  row: GeneRow;
  geneHref?: (row: GeneRow) => string | null;
  probeHref?: (row: GeneRow) => string | null;
}) {
  const symHref = geneHref ? geneHref(row) : null;
  const pHref = probeHref ? probeHref(row) : null;
  // When we have no resolved gene symbol, fall back to the design-element
  // name in the Symbol column — it's the curator-meaningful identifier.
  const symbolText = row.geneSymbol || row.designElementName || "—";
  const symbolItalic = !row.geneSymbol;
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-2 py-0.5 text-right text-slate-400">{row.index}</td>
      <td
        className={
          "px-2 py-0.5 font-medium " +
          (symbolItalic
            ? "italic text-slate-600 dark:text-slate-400"
            : "text-slate-900 dark:text-slate-100")
        }
      >
        {symHref ? (
          <a
            href={symHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 dark:text-blue-300 hover:underline"
          >
            {symbolText}
          </a>
        ) : (
          symbolText
        )}
      </td>
      <td
        className="px-2 py-0.5 text-slate-600 dark:text-slate-300 truncate max-w-[26ch]"
        title={row.geneOfficialName ?? undefined}
      >
        {row.geneOfficialName || <span className="text-slate-300 dark:text-slate-600">—</span>}
      </td>
      <td className="px-2 py-0.5 text-slate-500 font-mono">
        {pHref ? (
          <a
            href={pHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 dark:text-blue-300 hover:underline"
            title={row.designElementName ?? `probe ${row.designElementId}`}
          >
            {row.designElementId}
          </a>
        ) : row.designElementId != null ? (
          <span title={row.designElementName ?? undefined}>
            {row.designElementId}
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
}
