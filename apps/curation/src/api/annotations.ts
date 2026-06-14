import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { curieToUrl } from "@/lib/curie";

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
      return rows.map((r): AnnotationCandidate => {
        // Local shape carries ``label``; Gemma shape carries
        // ``value``. ``label`` is what every consumer of
        // ``AnnotationCandidate`` reads, so coalesce here.
        const asLocal = r as Partial<LocalShape>;
        const asGemma = r as Partial<GemmaShape>;
        return {
          label: asLocal.label ?? asGemma.value ?? "",
          uri: asLocal.uri ?? asGemma.value_uri ?? null,
          category_label: asLocal.category_label ?? asGemma.category ?? "",
          category_uri: asLocal.category_uri ?? asGemma.category_uri ?? null,
          usage_count: asLocal.usage_count ?? asGemma.usage_count ?? 0,
        };
      });
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
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
   *  so curators know whether they're looking at Gemma's cached view
   *  or a fresh OLS hit. */
  source: "gemma" | "ols";
  /** Canonical resolver URL — the curator can click "open in OBO" /
   *  "open in OLS" to verify on the upstream page. */
  canonicalUrl: string | null;
}

const GEMMA_TERM_KEY = (uri: string | null) =>
  ["annotations-term-gemma", uri ?? ""] as const;

/** Fetch a term's detail from Gemma's ``/annotations/term`` endpoint.
 *  Returns ``null`` when the URI is empty or Gemma doesn't know the
 *  term — caller falls through to the OLS lookup on explicit
 *  curator click. */
export function useGemmaTerm(uri: string | null | undefined) {
  return useQuery<AnnotationTermDetail | null>({
    queryKey: GEMMA_TERM_KEY(uri ?? null),
    queryFn: async () => {
      if (!uri) return null;
      const params = new URLSearchParams({ uri });
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/annotations/term?${params.toString()}`,
        );
        return parseGemmaTerm(raw, uri);
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 60, // 1h — term definitions barely move
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
        return parseOlsTerm(json, uri);
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 60,
    enabled: !!uri && enabled,
  });
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
