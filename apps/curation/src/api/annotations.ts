import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { curieToUrl, ncbiGeneIdFromUri, ncbiGeneUrl } from "@/lib/curie";
import { taxonSortPriority } from "@/lib/taxon";
import { readTermCache, writeTermCache } from "@/lib/termCache";

/**
 * One typeahead candidate. Shape mirrors what the curation mock /
 * adapter emits — snake_case fields that the design-tab pickers
 * consume directly. Gemma's `/annotations/search` carries
 * `usageCount` (camelCase) on the wire; whichever adapter feeds
 * this hook is responsible for translating to the snake_case shape
 * declared here. The 2026-05-xx "endpoint doesn't expose
 * usage_count" TODO is stale — the field is exposed, just under a
 * different name on the wire.
 */
export interface AnnotationCandidate {
  label: string;
  uri: string | null;
  category_label: string;
  category_uri: string | null;
  /** How many times this term has been used across Gemma. Drives
   *  the bold/regular split in the picker. */
  usage_count: number;
  // Gene-shaped hits only (``category == "gene"``); null on
  // ontology-term hits — taxon is a gene-only attribute. Added
  // 2026-06-18 (UIB_HANDOFF_..._GENE_TAXON) so the picker can show
  // ``KRAS (H.s.)`` vs ``Kras (M.m.)`` as distinct rows.
  taxon_id?: number | null;
  taxon_common_name?: string | null;
  taxon_scientific_name?: string | null;
}

const KEY = (q: string, category: string | null, limit: number) =>
  ["annotations-search", q, category ?? "", limit] as const;

/**
 * Debounced typeahead query. Empty `query` returns the full list
 * (still category-filtered) so an unprimed picker still shows
 * suggestions ranked by usage. Long stale-time — usage counts
 * barely move within a session.
 */
export function useAnnotationSearch(
  query: string,
  category: string | null,
  options: { limit?: number; enabled?: boolean } = {},
) {
  const { limit = 25, enabled = true } = options;
  return useQuery({
    queryKey: KEY(query, category, limit),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (category) params.set("category", category);
      params.set("limit", String(limit));
      // Bias by how often each term has actually been used in
      // Gemma curations rather than the default Lucene tf-idf
      // ranking. Without this, common multi-word labels like
      // "wild type genotype" get tokenised and the matching term
      // sinks past the visible window — curators have to type
      // quoted phrases to find them. ``rank=usage`` lands in
      // Gemma 2.0 (phase2-acl-migrate); older servers ignore
      // unknown params, so this degrades to lucene ordering.
      params.set("rank", "usage");
      // Two response shapes live on the wire today (2026-05-23):
      //   - local_api returns the bare list ``[{label, uri,
      //     category_label, category_uri, usage_count}, …]``.
      //   - real Gemma's ``AnnotationsWebService`` wraps it in a
      //     ``ResponseDataObject<List<…>>`` envelope AND uses
      //     different field names on the value object:
      //     ``{value, valueUri, category, categoryUri, usageCount}``.
      //     The client's ``unwrapGemmaEnvelope`` + ``snakeify`` strip
      //     the envelope and lowercase the keys, but the
      //     ``value``/``valueUri``/``category`` rename has to happen
      //     here.
      // The ontology-routing exception in vite.config.ts can send this
      // request to either backend, so accept either shape and
      // normalise. Drop the gemma-shape branch when the routing
      // exception goes away (see project_ontology_routing_exception).
      type GemmaShape = {
        value?: string | null;
        value_uri?: string | null;
        category?: string | null;
        category_uri?: string | null;
        usage_count?: number | null;
        // Gene hits carry taxon after the 2026-06-18 backend change;
        // client.ts snakeifies ``taxonId`` → ``taxon_id`` etc.
        taxon_id?: number | null;
        taxon_common_name?: string | null;
        taxon_scientific_name?: string | null;
      };
      type LocalShape = AnnotationCandidate;
      const raw = await api.get<
        Array<LocalShape | GemmaShape> | { data?: Array<LocalShape | GemmaShape> }
      >(`/rest/v2/annotations/search?${params.toString()}`);
      const rows: Array<LocalShape | GemmaShape> = Array.isArray(raw)
        ? raw
        : raw && Array.isArray(raw.data)
          ? raw.data
          : [];
      const candidates = rows.map((r): AnnotationCandidate => {
        // Local shape carries ``label``; Gemma shape carries
        // ``value``. ``label`` is what every consumer of
        // ``AnnotationCandidate`` reads, so coalesce here. The
        // ``taxon_*`` fields share a key across both shapes (local_api
        // won't populate them until the agents side ships taxon
        // awareness — null is the correct degraded value).
        const asLocal = r as Partial<LocalShape>;
        const asGemma = r as Partial<GemmaShape>;
        return {
          label: asLocal.label ?? asGemma.value ?? "",
          uri: asLocal.uri ?? asGemma.value_uri ?? null,
          category_label: asLocal.category_label ?? asGemma.category ?? "",
          category_uri: asLocal.category_uri ?? asGemma.category_uri ?? null,
          usage_count: asLocal.usage_count ?? asGemma.usage_count ?? 0,
          taxon_id: asLocal.taxon_id ?? asGemma.taxon_id ?? null,
          taxon_common_name:
            asLocal.taxon_common_name ?? asGemma.taxon_common_name ?? null,
          taxon_scientific_name:
            asLocal.taxon_scientific_name ??
            asGemma.taxon_scientific_name ??
            null,
        };
      });
      return orderCandidatesByTaxon(candidates);
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

/**
 * Cluster same-symbol gene hits across species into adjacent rows
 * without losing the backend's usage ranking for everything else.
 *
 * The backend ranks the whole list by usage. When ``kras`` matches
 * the human, mouse, rat and zebrafish genes, those rows can scatter
 * through the list by usage; a curator scanning for "the mouse one"
 * has to hunt. We group by (case-insensitive) label, keeping each
 * group's first-seen position (so usage ranking still drives overall
 * order), and within a multi-row group sort human → mouse → rat →
 * others, then by descending usage. Singleton groups (the common,
 * non-gene case) pass through untouched.
 */
export function orderCandidatesByTaxon(
  candidates: AnnotationCandidate[],
): AnnotationCandidate[] {
  const groups = new Map<string, AnnotationCandidate[]>();
  const order: string[] = [];
  for (const c of candidates) {
    const key = c.label.trim().toLowerCase();
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(c);
  }
  const out: AnnotationCandidate[] = [];
  for (const key of order) {
    const bucket = groups.get(key)!;
    if (bucket.length > 1) {
      bucket.sort((a, b) => {
        const pa = taxonSortPriority(a.taxon_common_name, a.taxon_scientific_name);
        const pb = taxonSortPriority(b.taxon_common_name, b.taxon_scientific_name);
        if (pa !== pb) return pa - pb;
        return b.usage_count - a.usage_count;
      });
    }
    out.push(...bucket);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-URI term lookup — used by the inline ``CuriePopover`` so curators
// can verify the term without leaving the page. Hits Gemma's
// ``/annotations/term`` endpoint (routed via the existing
// ``/rest/v2/annotations/*`` proxy split). OLS is a separate hook
// that the popover invokes only on explicit click — per Paul
// 2026-06-13: "fallback to OLS: require another click".
// ---------------------------------------------------------------------------

/** Minimal term-detail shape consumed by the CuriePopover. Source-
 *  agnostic — Gemma and OLS map to it via the two adapters below. */
export interface AnnotationTermDetail {
  uri: string;
  label: string;
  definition: string;
  /** ``rdfs:label`` of each direct parent class. Empty list when the
   *  source didn't provide hierarchy. */
  parents: string[];
  /** Ontology short name (e.g. ``efo``, ``uberon``, ``mondo``) when
   *  the source identifies it. Empty when unknown. */
  ontology: string;
  /** Where the row came from — useful for the popover's footer pill
   *  so curators know whether they're looking at Gemma's cached view,
   *  a fresh OLS hit, or NCBI Gene metadata. */
  source: "gemma" | "ols" | "ncbi";
  /** Canonical resolver URL — the curator can click "open in OBO" /
   *  "open in OLS" to verify on the upstream page. */
  canonicalUrl: string | null;
  /** Species for gene records (NCBI Gene path); null for ontology
   *  terms. Lets the popover header disambiguate which species' gene
   *  the curator is looking at. ``taxonId`` is the NCBI Taxonomy id. */
  taxonScientificName?: string | null;
  taxonCommonName?: string | null;
  taxonId?: number | null;
}

const GEMMA_TERM_KEY = (uri: string | null) =>
  ["annotations-term-gemma", uri ?? ""] as const;

/** Fetch a term's detail from Gemma's ``/annotations/term`` endpoint.
 *  Returns ``null`` when the URI is empty or Gemma doesn't know the
 *  term — caller falls through to the OLS lookup on explicit
 *  curator click. */
export function useGemmaTerm(uri: string | null | undefined) {
  const cached = readTermCache("gemma", uri);
  return useQuery<AnnotationTermDetail | null>({
    queryKey: GEMMA_TERM_KEY(uri ?? null),
    queryFn: async () => {
      if (!uri) return null;
      // Gemma's ``/annotations/term`` keys on the full IRI, not the
      // CURIE. Chips carry CURIEs (``EFO:0600015``), and passing that
      // raw made Gemma 404 with "No ontology term with URI …" — which
      // the popover rendered as the misleading "Gemma doesn't know this
      // term" (Paul 2026-06-19; frink resolves the same term fine when
      // asked by IRI). Expand to IRI first, exactly like ``useOlsTerm``.
      const iri = curieToUrl(uri) ?? uri;
      const params = new URLSearchParams({ uri: iri });
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/annotations/term?${params.toString()}`,
        );
        const detail = parseGemmaTerm(raw, uri);
        if (detail) writeTermCache("gemma", uri, detail);
        return detail;
      } catch {
        return null;
      }
    },
    // 24h — term definitions barely move; matches the persisted cache
    // TTL so a localStorage-seeded result counts as fresh and skips the
    // refetch.
    staleTime: 1000 * 60 * 60 * 24,
    // Keep the result well past the 5-min default after the popover
    // unmounts so reopening the chip shows the term without a refetch.
    gcTime: 1000 * 60 * 60 * 24,
    // Seed from the cross-session localStorage cache so a reopened chip
    // (or a fresh page load) shows the term immediately without a hit.
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.updatedAt,
    enabled: !!uri,
  });
}

function parseGemmaTerm(
  raw: unknown,
  uri: string,
): AnnotationTermDetail | null {
  if (!raw || typeof raw !== "object") return null;
  // Gemma envelope strip: payload may live under ``.data`` per the
  // ``ResponseDataObject<T>`` shape the client unwraps.
  const root = (raw as { data?: unknown }).data ?? raw;
  if (!root || typeof root !== "object") return null;
  const r = root as Record<string, unknown>;
  const label =
    (r.label as string) ??
    (r.value as string) ??
    (r.name as string) ??
    "";
  const definition =
    (r.definition as string) ??
    (r.description as string) ??
    "";
  const parentsRaw = (r.parents ?? r.parent_labels ?? []) as unknown[];
  const parents = Array.isArray(parentsRaw)
    ? parentsRaw
        .map((p) =>
          typeof p === "string"
            ? p
            : (p as { label?: string }).label ?? "",
        )
        .filter((s): s is string => !!s)
    : [];
  const ontology =
    typeof r.ontology === "string"
      ? r.ontology
      : typeof r.ontology_short === "string"
        ? (r.ontology_short as string)
        : "";
  if (!label && !definition && parents.length === 0) return null;
  return {
    uri,
    label,
    definition,
    parents,
    ontology,
    source: "gemma",
    canonicalUrl: curieToUrl(uri),
  };
}

const OLS_TERM_KEY = (uri: string | null) =>
  ["annotations-term-ols", uri ?? ""] as const;

/** Fetch a term's detail from EBI's Ontology Lookup Service (OLS4).
 *  Disabled by default — the popover only enables this query when the
 *  curator clicks "Fetch from OLS" (per Paul 2026-06-13). Single hit
 *  against the OLS4 search endpoint with a strict-iri filter — that
 *  lets the resolver find the term across every ontology it indexes
 *  without us having to guess which ontology the URI belongs to. */
export function useOlsTerm(
  uri: string | null | undefined,
  enabled: boolean,
) {
  const cached = readTermCache("ols", uri);
  return useQuery<AnnotationTermDetail | null>({
    queryKey: OLS_TERM_KEY(uri ?? null),
    queryFn: async () => {
      if (!uri) return null;
      // Resolve CURIEs to full URLs before querying OLS — OLS keys
      // on IRI, not CURIE.
      const iri = curieToUrl(uri) ?? uri;
      const params = new URLSearchParams({
        iri,
        rows: "1",
        fieldList: "label,description,short_form,ontology_name",
      });
      const url = `https://www.ebi.ac.uk/ols4/api/terms?${params.toString()}`;
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" } });
        if (!resp.ok) return null;
        const json = await resp.json();
        const detail = parseOlsTerm(json, uri);
        if (detail) writeTermCache("ols", uri, detail);
        return detail;
      } catch {
        return null;
      }
    },
    // Seed an already-fetched OLS result from localStorage so reopening
    // the chip (or reloading the page) shows it without a re-click.
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.updatedAt,
    staleTime: 1000 * 60 * 60 * 24,
    // OLS terms are immutable; once a curator clicks "Fetch from OLS"
    // we keep the result for a day so reopening the popover (which
    // remounts with a fresh ``olsRequested = false``) still shows it
    // from cache rather than dropping back to the CTA.
    gcTime: 1000 * 60 * 60 * 24,
    enabled: !!uri && enabled,
  });
}

// ---------------------------------------------------------------------------
// NCBI Gene lookup. NCBI gene URIs (``ncbigene/948`` / ``NCBI:gene:948``)
// don't live in OLS, so the popover routes them to NCBI E-utilities
// instead. No API key needed for moderate browser-side use; the
// ``esummary`` endpoint sends CORS headers that allow direct fetches.
// ---------------------------------------------------------------------------

const NCBI_GENE_KEY = (geneId: string | null) =>
  ["annotations-term-ncbi-gene", geneId ?? ""] as const;

/** Fetch a gene's summary record from NCBI E-utilities. Auto-enabled
 *  whenever the URI matches a known NCBI gene shape (per
 *  ``ncbiGeneIdFromUri``) — OLS doesn't index NCBI Gene, so there's
 *  nothing to gate behind a curator click for this source. */
export function useNcbiGene(uri: string | null | undefined) {
  const geneId = ncbiGeneIdFromUri(uri);
  return useQuery<AnnotationTermDetail | null>({
    queryKey: NCBI_GENE_KEY(geneId),
    queryFn: async () => {
      if (!geneId || !uri) return null;
      const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${encodeURIComponent(geneId)}&retmode=json`;
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" } });
        if (!resp.ok) return null;
        const json = await resp.json();
        return parseNcbiGene(json, uri, geneId);
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 60,
    enabled: !!geneId,
  });
}

function parseNcbiGene(
  json: unknown,
  uri: string,
  geneId: string,
): AnnotationTermDetail | null {
  if (!json || typeof json !== "object") return null;
  const result = (json as { result?: Record<string, unknown> }).result;
  if (!result || typeof result !== "object") return null;
  const rec = result[geneId];
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  // ``error`` is surfaced inline when the id doesn't exist.
  if (typeof r.error === "string" && r.error) return null;
  const symbol = typeof r.name === "string" ? r.name : "";
  const description =
    typeof r.description === "string" ? r.description : "";
  const summary = typeof r.summary === "string" ? r.summary : "";
  const aliases =
    typeof r.otheraliases === "string" && r.otheraliases.trim()
      ? r.otheraliases
      : "";
  const organismObj =
    r.organism && typeof r.organism === "object"
      ? (r.organism as Record<string, unknown>)
      : null;
  const organism =
    typeof organismObj?.scientificname === "string"
      ? organismObj.scientificname
      : "";
  const taxonCommonName =
    typeof organismObj?.commonname === "string" && organismObj.commonname
      ? organismObj.commonname
      : null;
  // esummary ships ``taxid`` as a number (sometimes a numeric string).
  const taxidRaw = organismObj?.taxid;
  const taxonId =
    typeof taxidRaw === "number"
      ? taxidRaw
      : typeof taxidRaw === "string" && taxidRaw.trim() !== ""
        ? Number(taxidRaw)
        : null;
  // Compose label as ``SYMBOL — full name``; falls back to whichever
  // half is present.
  const label = [symbol, description].filter(Boolean).join(" — ");
  // Definition prefers NCBI's curated summary; falls back to the
  // organism + alias list so the popover still says something useful
  // for genes that don't have a written summary yet.
  const defParts: string[] = [];
  if (summary) defParts.push(summary);
  else if (description) defParts.push(description);
  if (organism) defParts.push(`Organism: ${organism}.`);
  if (aliases) defParts.push(`Also known as: ${aliases}.`);
  const definition = defParts.join(" ");
  if (!label && !definition) return null;
  return {
    uri,
    label,
    definition,
    parents: [],
    ontology: "NCBI Gene",
    source: "ncbi",
    canonicalUrl: ncbiGeneUrl(geneId),
    taxonScientificName: organism || null,
    taxonCommonName,
    taxonId: Number.isFinite(taxonId) ? taxonId : null,
  };
}

function parseOlsTerm(
  json: unknown,
  uri: string,
): AnnotationTermDetail | null {
  if (!json || typeof json !== "object") return null;
  const root = json as { _embedded?: { terms?: unknown[] } };
  const terms = root._embedded?.terms ?? [];
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const t = terms[0] as Record<string, unknown>;
  const label =
    typeof t.label === "string"
      ? t.label
      : Array.isArray(t.label)
        ? (t.label[0] as string)
        : "";
  const descArr = t.description as unknown;
  const definition = Array.isArray(descArr)
    ? (descArr[0] as string)
    : typeof descArr === "string"
      ? descArr
      : "";
  const ontology =
    typeof t.ontology_name === "string" ? (t.ontology_name as string) : "";
  if (!label && !definition) return null;
  return {
    uri,
    label,
    definition,
    parents: [],
    ontology,
    source: "ols",
    canonicalUrl: `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(uri)}`,
  };
}
