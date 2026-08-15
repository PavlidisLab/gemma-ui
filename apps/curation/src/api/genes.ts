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
    queryFn: () => (ncbiId ? queueGeneFetch(ncbiId) : Promise.resolve(null)),
  });
}

// ── request batching ────────────────────────────────────────────────
//
// A design can carry a dozen gene chips, and each one mounting its own
// request is a dozen round trips for one screen. The endpoint takes a
// comma-separated id list and answers them all at once (verified
// 2026-08-14: ``/rest/v2/genes/2099,13982,24890`` → three rows), so
// ids raised in the same tick are collected and asked for together.
//
// React Query already dedups the SAME gene across chips and caches the
// answer for a day; this handles the other axis — DIFFERENT genes
// mounting together.
//
// A failed batch resolves every waiter to null rather than rejecting:
// a chip that can't reach the catalogue falls back to its label and
// flags, which is the same degraded path as an unknown id.

/** How long to hold the door open for other chips mounting in the same
 *  render pass. One frame is enough — chips mount together — and it
 *  keeps the first paint's lookup off a long timer. */
const BATCH_WINDOW_MS = 16;

/** Cap per request so a huge design can't build an unreasonable URL. */
const MAX_BATCH = 50;

let pending = new Map<string, ((info: GeneInfo | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function queueGeneFetch(ncbiId: string): Promise<GeneInfo | null> {
  return new Promise((resolve) => {
    const waiters = pending.get(ncbiId);
    if (waiters) waiters.push(resolve);
    else pending.set(ncbiId, [resolve]);
    if (pending.size >= MAX_BATCH) {
      void flushGeneQueue();
      return;
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(() => void flushGeneQueue(), BATCH_WINDOW_MS);
    }
  });
}

async function flushGeneQueue(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = pending;
  pending = new Map();
  const ids = Array.from(batch.keys());
  if (ids.length === 0) return;
  let rows: unknown = null;
  try {
    rows = await api.get<unknown>(
      `/rest/v2/genes/${ids.map(encodeURIComponent).join(",")}`,
    );
  } catch {
    rows = null;
  }
  for (const id of ids) {
    const info = parseGene(rows, id);
    for (const resolve of batch.get(id) ?? []) resolve(info);
  }
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
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // A batched response carries every gene asked for, so pick the row
  // that IS this id — taking the first would hand one gene's species to
  // another chip, which is precisely the error this whole surface
  // exists to catch. Fall back to the first row only when nothing
  // matches and there is just one (a single-id response whose id field
  // came back in a shape we didn't expect).
  const idOf = (row: unknown): string =>
    row && typeof row === "object"
      ? String((row as Record<string, unknown>).ncbi_id ?? "")
      : "";
  const match = rows.find((row) => idOf(row) === ncbiId);
  // The fallback is narrow on purpose: one row that doesn't say which
  // gene it is. A row that DOES say, and says something else, is a
  // different gene and must not be handed over — the id asked for
  // simply wasn't in the answer.
  const picked =
    match ?? (rows.length === 1 && !idOf(rows[0]) ? rows[0] : null);
  if (!picked || typeof picked !== "object") return null;
  const r = picked as Record<string, unknown>;
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
