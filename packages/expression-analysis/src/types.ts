import type { HeatmapPayload } from "@gemma/heatmap";

// ─── Gene / GO / heatmap wire shapes ───────────────────────────────────────────
//
// These mirror the Gemma REST VOs exactly (field-for-field, camelCase) —
// see apps/browser/src/api/endpoints.ts, which is where they were lifted
// from. Each app's own GeneExpressionApi implementation is responsible
// for producing values in THIS shape regardless of its own transport —
// apps/browser reads Gemma directly (already this shape); apps/curation
// reads through a client that snakeifies responses, so its
// implementation must decode + re-shape before handing data back here.

export interface Taxon {
  id?: number;
  commonName?: string | null;
  scientificName?: string | null;
}

export interface Gene {
  id: number;
  officialSymbol?: string | null;
  officialName?: string | null;
  ncbiId?: number | null;
  ensemblId?: string | null;
  aliases?: string[] | null;
  taxon?: Taxon | null;
  ncbiUri?: string | null;
  description?: string | null;
}

/** Shape returned by GET /annotations/search?query=...&prefixes=GO_ */
export interface GoTermMatch {
  value: string;
  valueUri: string | null;
  category: string | null;
  categoryUri: string | null;
  usageCount?: number;
}

export interface GoTermGenesPage {
  data: Gene[];
  totalElements?: number;
}

export interface QuantitationTypeLite {
  id: number;
  name?: string | null;
  scale?: string | null;
  type?: string | null;
  isPreferred?: boolean;
  isMaskedPreferred?: boolean;
}

export interface PlatformLite {
  shortName?: string | null;
}

export interface GeneExpressionHeatmapParams {
  genes?: number[];
  sampleSize?: number;
  quantitationType?: number;
  maskOutliers?: boolean;
}

/** Per-gene origin record — the GO term a gene is in the set BECAUSE
 *  of. Threaded into the heatmap adapter so the row gutter can mark a
 *  gene's provenance with a colour dot. */
export interface GeneOrigin {
  goUri: string;
  goLabel: string;
}

export interface GeneExpressionHeatmapDecoration {
  origins: Record<number, GeneOrigin>;
  queried: Set<number>;
}

/**
 * Every data-fetching function `GeneExpressionPanel` needs, injected by
 * the host app. The panel owns orchestration (`useQuery` keys, loading /
 * error states, caching); the host owns the transport and — critically —
 * the wire-casing boundary (see the file header).
 *
 * `getQuantitationTypes` / `getPlatforms` are optional: omitting them
 * just hides the admin QT/outlier-mask picker rather than erroring.
 */
export interface GeneExpressionApi {
  searchGenes(
    query: string,
    opts: { taxon?: string; limit?: number; signal?: AbortSignal },
  ): Promise<Gene[]>;
  searchGoTerms(
    query: string,
    opts: { limit?: number; signal?: AbortSignal },
  ): Promise<GoTermMatch[]>;
  getGoTermGenes(
    termUri: string,
    opts: { taxon?: string; limit?: number; signal?: AbortSignal },
  ): Promise<GoTermGenesPage | null>;
  /** Returns an already-decorated, ready-to-render payload — the host
   *  applies `decoration` (origin colours + the "queried" set used to
   *  mark non-specific probes) while it still has the wire response,
   *  since the wire shape never leaves the host's own api file. */
  getHeatmapData(
    entityId: number,
    params: GeneExpressionHeatmapParams,
    decoration: GeneExpressionHeatmapDecoration,
    signal?: AbortSignal,
  ): Promise<HeatmapPayload | null>;
  getQuantitationTypes?(
    entityId: number,
    signal?: AbortSignal,
  ): Promise<QuantitationTypeLite[]>;
  getPlatforms?(
    entityId: number,
    signal?: AbortSignal,
  ): Promise<PlatformLite[]>;
  /** Cold-load rehydrate for a shared `#genes=` link: resolve one
   *  share-id (an NCBI gene id, or the internal id for a gene lacking
   *  one — see `shareIdOf`) to a full `Gene`. Optional; omitting it
   *  just means a shared link whose genes aren't already in the query
   *  cache renders `{ id }` placeholders instead of full metadata —
   *  the heatmap still works since it only needs the id. */
  resolveGene?(shareId: number, signal?: AbortSignal): Promise<Gene | null>;
  /** Resolve a bare GO curie's label (a shared `#go=` link carries only
   *  the curie). Optional; omitting it leaves the curie as the chip's
   *  label instead of the human-readable term name. */
  resolveGoTermLabel?(curie: string): Promise<{ label: string } | null>;
  /** Error → display string for a failed GO-term search. Optional;
   *  falls back to a generic message. Kept per-host rather than shared
   *  — apps/browser's own `annotationSearchMessage` is deliberately not
   *  promoted (its own header comment: "same failure, different
   *  vocabulary for different readers"). */
  formatSearchError?(err: unknown, query?: string): string;
}
