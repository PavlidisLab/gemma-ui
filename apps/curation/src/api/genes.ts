import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { ncbiGeneIdFromUri } from "@/lib/curie";

/**
 * Gene lookup by NCBI id — Gemma's own gene catalogue.
 *
 * Every gene binding carries its NCBI id in the term URI, so the
 * species is knowable for all of them, including the ones whose stored
 * label never said (``"ESR1"``). ``GET /rest/v2/genes/{ncbiId}`` answers
 * with the official symbol, the official name and the taxon.
 *
 * Gemma's own catalogue rather than NCBI eutils: same host as the rest
 * of the ontology surface, no external rate limit, and it is Gemma's
 * view of the gene — the one the annotation was made against.
 * ``/annotations/term`` is NOT an option; it 404s on gene URIs.
 *
 * Routed to the ontology host by the ``/rest/v2/genes`` proxy entry
 * (see ``vite.config.ts``) — a local_api stack carries no gene
 * catalogue.
 */
export interface GeneInfo {
  ncbiId: string;
  /** Gemma's official symbol — "ESR1". */
  symbol: string | null;
  /** Official full name — "estrogen receptor 1". */
  name: string | null;
  taxonCommonName: string | null;
  taxonScientificName: string | null;
  aliases: string[];
}

export const GENE_KEY = (ncbiId: string | null) =>
  ["gene", ncbiId] as const;

/** Look a gene up from its term URI. Disabled — and ``null`` — for a
 *  non-gene URI, so callers can invoke it unconditionally.
 *
 *  A gene's species doesn't change, so this is cached hard: the same
 *  gene rendered on twenty chips is one request, and revisiting the
 *  experiment tomorrow is none. A miss (unknown id, catalogue
 *  unreachable) resolves to ``null`` rather than throwing — the chip
 *  falls back to what its label says, and flags when the label says
 *  nothing. */
export function useGeneInfo(uri: string | null | undefined) {
  const ncbiId = ncbiGeneIdFromUri(uri);
  return useQuery<GeneInfo | null>({
    queryKey: GENE_KEY(ncbiId),
    enabled: !!ncbiId,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: false,
    queryFn: async () => {
      if (!ncbiId) return null;
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/genes/${encodeURIComponent(ncbiId)}`,
        );
        return parseGene(raw, ncbiId);
      } catch {
        return null;
      }
    },
  });
}

/** Gemma wraps single-entity responses in ``{ data: [ … ] }``, and the
 *  API client unwraps a pure envelope on the way through — so what
 *  lands here is the array. Accept the wrapped form too rather than
 *  depending on which side of that rule this endpoint falls.
 *
 *  Keys are snake_case: the client snakeifies every response, which is
 *  the ingestion boundary the camelCase-vs-snake_case rule names. The
 *  wire says ``officialSymbol`` / ``taxon.scientificName``; by the time
 *  it reaches this function it says ``official_symbol`` /
 *  ``taxon.scientific_name``.
 *
 *  A gene id can map to more than one row; the first carries the
 *  identity fields, and they agree on taxon, which is what this is
 *  for. */
export function parseGene(raw: unknown, ncbiId: string): GeneInfo | null {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as { data?: unknown }).data
      : null;
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first || typeof first !== "object") return null;
  const r = first as Record<string, unknown>;
  const taxon =
    r.taxon && typeof r.taxon === "object"
      ? (r.taxon as Record<string, unknown>)
      : null;
  const info: GeneInfo = {
    ncbiId,
    symbol: str(r.official_symbol),
    name: str(r.official_name),
    taxonCommonName: str(taxon?.common_name),
    taxonScientificName: str(taxon?.scientific_name),
    aliases: Array.isArray(r.aliases)
      ? r.aliases.filter((a): a is string => typeof a === "string")
      : [],
  };
  // Nothing identifying came back → treat as a miss, so the caller
  // falls back to the label instead of rendering an empty species.
  if (!info.symbol && !info.taxonScientificName && !info.taxonCommonName) {
    return null;
  }
  return info;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
