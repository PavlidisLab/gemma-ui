/**
 * A gene symbol that opens this app's gene page.
 *
 * Every surface that names a gene — heatmap row pop-ups, probe gene
 * mappings, alignment rows, platform element rows — renders the symbol
 * through this, so the link goes to the same place and fails the same
 * way everywhere.
 *
 * Keyed on the NCBI id, because that is what `/gene/ncbi/$ncbiId`
 * addresses. Never pass Gemma's internal gene id: the legacy `/gene/$id`
 * redirect reads a bare number AS an NCBI id, so an internal id would
 * land on a different gene, silently.
 *
 * No NCBI id, or no symbol, means plain text rather than a link.
 * Naming a gene without a link beats linking to the wrong one.
 *
 * Lives in the browser app rather than `@gemma/ui` because the route is
 * the browser's own; the curation app has no gene page.
 */

import { Link } from "@tanstack/react-router";

export function GeneSymbolLink({
  symbol,
  ncbiId,
  fallback = "—",
  className,
  linkClassName = "hover:underline hover:text-gemma-accent",
  stopPropagation = false,
}: {
  symbol: string | null | undefined;
  ncbiId: number | null | undefined;
  /** Shown when there is no symbol. */
  fallback?: string;
  /** Applied whether or not the symbol links. */
  className?: string;
  /** Added only when it links — the link's colour and hover. */
  linkClassName?: string;
  /** For a symbol inside a clickable row, so following the link
   *  doesn't also fire the row's own click. */
  stopPropagation?: boolean;
}) {
  if (ncbiId == null || !symbol) {
    return <span className={className}>{symbol || fallback}</span>;
  }
  return (
    <Link
      to="/gene/ncbi/$ncbiId"
      params={{ ncbiId: String(ncbiId) }}
      className={[className, linkClassName].filter(Boolean).join(" ")}
      title="Open this gene's page"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {symbol}
    </Link>
  );
}
