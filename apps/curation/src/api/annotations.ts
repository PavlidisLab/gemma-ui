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
 * declared here. (No gap here despite an old note claiming otherwise:
 * the endpoint DOES expose the usage count, just as `usageCount`.)
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
  // 2026-06-18 so the picker can show
  // ``KRAS (H.s.)`` vs ``Kras (M.m.)`` as distinct rows.
  taxon_id?: number | null;
  taxon_common_name?: string | null;
  taxon_scientific_name?: string | null;
  /** One representative prior usage of this term, for the "e.g. …"
   *  hint on rare candidates. Only present when the query opted in
   *  via ``includeExampleUsage`` AND Gemma found a usage. */
  example_usage?: AnnotationExampleUsage | null;
}

/** One representative prior usage of a candidate term — which
 *  FactorValue/factor (or EE-tag / sample) it was attached to, and
 *  the full Statement triple when the term sits inside one (the
 *  candidate itself is the subject). Wire is camelCase
 *  (``AnnotationSearchResultValueObject.exampleUsage``); the client's
 *  ``snakeify`` transform lowers both this object's own keys and
 *  everything nested inside it before it reaches app code. */
export interface AnnotationExampleUsage {
  level: "ExperimentTag" | "FactorValue" | "BioMaterial" | string;
  parent_name: string | null;
  parent_of_parent_name: string | null;
  predicate: string | null;
  predicate_uri: string | null;
  object: string | null;
  object_uri: string | null;
  second_predicate: string | null;
  second_predicate_uri: string | null;
  second_object: string | null;
  second_object_uri: string | null;
  source_experiment_id: number | null;
}

const KEY = (
  q: string,
  category: string | null,
  limit: number,
  includeExampleUsage: boolean,
) => ["annotations-search", q, category ?? "", limit, includeExampleUsage] as const;

/**
 * Debounced typeahead query. Empty `query` returns the full list
 * (still category-filtered) so an unprimed picker still shows
 * suggestions ranked by usage. Long stale-time — usage counts
 * barely move within a session.
 */
export function useAnnotationSearch(
  query: string,
  category: string | null,
  options: {
    limit?: number;
    enabled?: boolean;
    /** Opt into the ``exampleUsage`` enrichment (batched reverse
     *  lookup on Gemma's side, off by default to keep the hot
     *  per-keystroke path cheap and cache-friendly). Only the
     *  picker's own dropdown — the one place that renders the "e.g.
     *  …" hint — should set this; other callers should leave it
     *  off. */
    includeExampleUsage?: boolean;
  } = {},
) {
  const { limit = 25, enabled = true, includeExampleUsage = false } = options;
  return useQuery({
    queryKey: KEY(query, category, limit, includeExampleUsage),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (category) params.set("category", category);
      params.set("limit", String(limit));
      if (includeExampleUsage) params.set("includeExampleUsage", "true");
      // Coverage-dominant ranking with usage as a secondary signal:
      //   0.5*tokenCoverage + 0.3*normalizedLog(usage) + 0.2*1/(1+rank)
      //
      // Was ``rank=usage`` until 2026-08-13. That parameter does NOT
      // blend rank with usage despite its name — measured with geb:
      // its usage score saturates at usage 10, so every term used ≥10
      // times outscores the best conceivable usage-0 hit (an exact
      // label match at position 0). It is a PARTITION — "used terms
      // first, in URI order" — not a ranking. And because `limit`
      // truncates AFTER ranking, that changes which terms are visible
      // at all, not just their order.
      //
      // What that did to the picker: typing `malignant melanoma` under
      // `category=disease` offered gastric cancer, urinary bladder
      // cancer and brain cancer, with no melanoma term in the list.
      // Those are ordinary lexical hits — their MONDO synonyms contain
      // "malignant" — floated above the real match purely for being
      // used.
      //
      // The original justification for `usage` no longer holds either:
      // `wild type genotype` was the case it was added for, and it now
      // leads under lucene, usage AND composite. Where `usage` was
      // genuinely earning its keep — duplicate labels across
      // ontologies, `liver` (u=0) vs `liver` (u=1124), `dmso` vs
      // `dimethyl sulfoxide` — `composite` fixes those identically.
      //
      // There is no measured trade-off. The switch was recommended as
      // accepting a known cost — that `usage` wins one-token
      // designations colliding with a gene symbol (`FTC` under
      // treatment → emtricitabine vs the MGI gene). Measured over 398
      // decontaminated gold pairs, all five rankers score an identical
      // 0.993 recall@5 on single-token queries: exact-match promotion
      // has already put the answer on top before any ranker runs, so
      // there is nothing to win there and the FTC case is too rare to
      // move an aggregate. The whole difference is on multi-word
      // queries, where composite is recall@5 0.828 vs lucene 0.672 and
      // usage 0.708.
      //
      // Why composite rather than usage specifically: `usage`'s
      // contribution is MEMBERSHIP, not ordering — on multi-word its
      // recall goes 0.708@5 → 0.820@20 (the right term is present but
      // below the fold) where lucene gains 1pp over the same span.
      // composite keeps that membership gain without the ordering
      // damage.
      //
      // Handoffs: GEB_TO_UIB_2026_08_13_IT_IS_A_RERANK_AND_THE_BLEND_IS_A_PARTITION
      // (mechanism), UIB_TO_GEB_2026_08_13_RANKER_NUMBERS_THERE_IS_NO_TRADEOFF
      // (numbers + harness).
      //
      // Older servers ignore unknown params, so this degrades to
      // lucene ordering.
      params.set("rank", "composite");
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
        // ``exampleUsage`` → ``example_usage`` (client.ts snakeifies
        // nested keys too, including this object's own fields — see
        // AnnotationExampleUsage's doc comment).
        example_usage?: AnnotationExampleUsage | null;
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
          example_usage: asLocal.example_usage ?? asGemma.example_usage ?? null,
        };
      });
      return orderCandidatesByTaxon(dedupeCandidates(candidates));
    },
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

/**
 * Collapse rows a curator cannot tell apart, because picking either
 * one commits the identical (label, URI) pair.
 *
 * Gemma's search returns the same free-text value twice for at least
 * some terms — `129/Ola` under `strain` comes back as
 * `{usageCount: 24, valueUri: ""}` and `{usageCount: null,
 * valueUri: null}`, identical in every other field. Rendered, that is
 * one row reading `×24` and another reading `new`, which asks the
 * curator to choose between a term and itself; the two also collide
 * on the list's React key. Reported 2026-08-16 in
 * `UIB_TO_GEB_2026_08_16_THE_SEARCH_RETURNS_THE_SAME_FREE_TEXT_TWICE.md`.
 *
 * 🛑 Keyed on what a pick WRITES — trimmed label plus URI, with an
 * empty URI and a null URI treated as the same "ungrounded". Two rows
 * with different URIs are two different terms and both must survive,
 * however similar their labels look.
 *
 * The survivor is the richest row, not the first: usage count and the
 * example-usage enrichment are the whole reason the catalog section
 * exists, and dropping the `×24` row for an identical bare one would
 * hide the signal the curator is choosing on.
 */
export function dedupeCandidates(
  candidates: AnnotationCandidate[],
): AnnotationCandidate[] {
  const byKey = new Map<string, number>();
  const out: AnnotationCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.label.trim().toLowerCase()}|${(c.uri ?? "").trim()}`;
    const at = byKey.get(key);
    if (at == null) {
      byKey.set(key, out.length);
      out.push(c);
      continue;
    }
    const kept = out[at];
    if (richerCandidate(c, kept)) out[at] = c;
  }
  return out;
}

/** Which of two identical-identity rows to show. Usage count first
 *  (it is the ranking signal on the row), then the presence of the
 *  example-usage / taxon enrichment. */
function richerCandidate(
  a: AnnotationCandidate,
  b: AnnotationCandidate,
): boolean {
  if ((a.usage_count ?? 0) !== (b.usage_count ?? 0)) {
    return (a.usage_count ?? 0) > (b.usage_count ?? 0);
  }
  const score = (c: AnnotationCandidate) =>
    (c.example_usage ? 2 : 0) + (c.taxon_id != null ? 1 : 0);
  return score(a) > score(b);
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
// that the popover invokes only on explicit click — per design review
// 2026-06-13: "fallback to OLS: require another click".
// ---------------------------------------------------------------------------

/** A term reference — a label plus the URI it resolves to. Used for
 *  parent classes so the popover can navigate into one. ``uri`` is
 *  null when the source gave a bare label with no identifier. */
export interface TermRef {
  uri: string | null;
  label: string;
}

/** A synonym with its OBO scope. ``type`` is e.g. ``exact_synonym`` /
 *  ``related_synonym`` / ``broad_synonym`` / ``narrow_synonym``; empty
 *  when the source didn't classify it. */
export interface TermSynonym {
  value: string;
  type: string;
}

/** Cellosaurus-backed metadata Gemma ships on ``/annotations/term`` for
 *  CVCL rows (live on gemma2 + frink since 2026-08-11). Every field here
 *  is a catalogue assertion, not a curation — ``lib/derivedFacts.ts``
 *  turns them into rows and owns the rule that they must never render
 *  like curated content. */
export interface TermSourceMetadata {
  species?: { ncbiTaxonId?: number | null; label?: string | null }[] | null;
  cellLineType?: string | null;
  sex?: string | null;
  strainType?: string | null;
  /** Cellosaurus' problem flag — "Contaminated" on a misidentified line
   *  (KB / CVCL_0372 is a HeLa derivative). Null on a clean line. */
  problematic?: string | null;
}

/** Minimal term-detail shape consumed by the CuriePopover. Source-
 *  agnostic — Gemma and OLS map to it via the two adapters below. */
export interface AnnotationTermDetail {
  uri: string;
  label: string;
  definition: string;
  /** Direct parent classes — each carries a URI (when the source
   *  provides one) so the popover can navigate into it. Empty list
   *  when the source didn't provide hierarchy. */
  parents: TermRef[];
  /** Alternate / synonymous labels for this same concept, with scope.
   *  Empty when the source didn't ship synonyms (OLS / NCBI paths). */
  synonyms: TermSynonym[];
  /** Alternate ontology IDs for this concept — merged / deprecated id
   *  redirects (CURIE or IRI strings) that fold INTO this term. They do
   *  NOT resolve to a card of their own (the obsolete id has no class),
   *  so the popover renders them as plain informational text, not links.
   *  Empty for most terms. */
  alternativeIds: string[];
  /** Database cross-references to OTHER ontologies / vocabularies
   *  (``DOID:3526``, ``ICD10CM:I63``, ``UMLS:...``, ``MESH:...``). From
   *  Gemma's ``dbXrefs`` wire field. These live outside the ontology
   *  Gemma loaded, so they're informational text — not internally
   *  navigable (Gemma has no card for a DOID/ICD term). Empty when the
   *  source didn't ship xrefs. */
  xrefs: string[];
  /** Ontology release the term was read from (e.g. a MONDO release
   *  OWL URL). Surfaced discreetly so the curator knows the vintage.
   *  Null when the source didn't report it. */
  ontologyVersion: string | null;
  /** Ontology short name (e.g. ``efo``, ``uberon``, ``mondo``) when
   *  the source identifies it. Empty when unknown. */
  ontology: string;
  /** Where the row came from — useful for the popover's footer pill
   *  so curators know whether they're looking at Gemma's cached view,
   *  a fresh OLS hit, or NCBI Gene metadata. */
  source: "gemma" | "ols" | "ncbi";
  /** Canonical resolver URL — feeds the popover's registry link-outs
   *  ("open in Ontobee / OLS / …") so the curator can verify on the
   *  upstream page. */
  canonicalUrl: string | null;
  /** Species for gene records (NCBI Gene path); null for ontology
   *  terms. Lets the popover header disambiguate which species' gene
   *  the curator is looking at. ``taxonId`` is the NCBI Taxonomy id. */
  taxonScientificName?: string | null;
  taxonCommonName?: string | null;
  taxonId?: number | null;
  /** Catalogue-asserted facts about the term — species / cell-line type
   *  / sex / strain type / Cellosaurus' ``problematic`` flag. Populated
   *  on Cellosaurus (CVCL) rows; null elsewhere. These are DERIVED, not
   *  curated: see ``lib/derivedFacts.ts`` for the class distinction and
   *  the rendering rule. */
  sourceMetadata?: TermSourceMetadata | null;
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
      // term" (design review 2026-06-19; a gene-aware ontology host resolves the
      // same term fine when asked by IRI). Expand to IRI first, exactly like
      // ``useOlsTerm``.
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

/** Exported for unit tests — maps a (post-client-snakeify) Gemma
 *  ``/annotations/term`` payload into the popover's term-detail shape. */
export function parseGemmaTerm(
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
  // Gemma 2.0 ships parents as ``{uri, label}`` objects (GemBro
  // 2026-06-21); older shapes used bare label strings / ``parent_labels``.
  // Tolerate both so a stale cache or an older server still renders.
  const parentsRaw = (r.parents ?? r.parent_labels ?? []) as unknown[];
  const parents: TermRef[] = Array.isArray(parentsRaw)
    ? parentsRaw
        .map((p): TermRef =>
          typeof p === "string"
            ? { uri: null, label: p }
            : {
                uri:
                  typeof (p as { uri?: unknown }).uri === "string"
                    ? ((p as { uri: string }).uri)
                    : null,
                label:
                  typeof (p as { label?: unknown }).label === "string"
                    ? ((p as { label: string }).label)
                    : "",
              },
        )
        .filter((p) => !!p.label)
    : [];
  // Synonyms ship as ``{value, type}`` (GemBro 2026-06-21). Drop the
  // synonym that just repeats the primary label — it's redundant on the
  // card. Tolerate a bare-string shape and OLS-style ``{name, scope}``.
  const synRaw = (r.synonyms ?? []) as unknown[];
  const synonyms: TermSynonym[] = Array.isArray(synRaw)
    ? synRaw
        .map((s): TermSynonym => {
          if (typeof s === "string") return { value: s, type: "" };
          const o = s as {
            value?: unknown;
            name?: unknown;
            type?: unknown;
            scope?: unknown;
          };
          const value =
            typeof o.value === "string"
              ? o.value
              : typeof o.name === "string"
                ? o.name
                : "";
          const type =
            typeof o.type === "string"
              ? o.type
              : typeof o.scope === "string"
                ? o.scope
                : "";
          return { value, type };
        })
        .filter(
          (s) =>
            !!s.value && s.value.trim().toLowerCase() !== label.trim().toLowerCase(),
        )
    : [];
  const altRaw = (r.alternative_ids ?? r.alternativeIds ?? []) as unknown[];
  const alternativeIds = Array.isArray(altRaw)
    ? altRaw.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  // Cross-references to other vocabularies. GemBro ships them under
  // ``dbXrefs`` (snakeified to ``db_xrefs``); accept a few plausible
  // aliases. Plain CURIE strings ("DOID:3526", "ICD10CM:I63").
  const xrefRaw = (r.db_xrefs ?? r.dbXrefs ?? r.xrefs ?? []) as unknown[];
  const xrefs = Array.isArray(xrefRaw)
    ? xrefRaw.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  const ontologyVersion =
    typeof r.ontology_version === "string"
      ? r.ontology_version
      : typeof r.ontologyVersion === "string"
        ? (r.ontologyVersion as string)
        : null;
  const ontology =
    typeof r.ontology === "string"
      ? r.ontology
      : typeof r.ontology_short === "string"
        ? (r.ontology_short as string)
        : "";
  const sourceMetadata = parseSourceMetadata(
    r.source_metadata ?? r.sourceMetadata,
  );
  if (!label && !definition && parents.length === 0) return null;
  return {
    uri,
    label,
    definition,
    parents,
    synonyms,
    alternativeIds,
    xrefs,
    ontologyVersion,
    ontology,
    source: "gemma",
    canonicalUrl: curieToUrl(uri),
    sourceMetadata,
  };
}

/** Read the Cellosaurus ``sourceMetadata`` block off a term payload.
 *  Every field is optional and absent on non-CVCL rows, so an unknown
 *  or empty block collapses to null rather than an object of nulls the
 *  renderer would have to re-check. */
function parseSourceMetadata(raw: unknown): TermSourceMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  const speciesRaw = (m.species ?? []) as unknown[];
  const species = Array.isArray(speciesRaw)
    ? speciesRaw
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const label =
            typeof o.label === "string"
              ? o.label
              : typeof o.name === "string"
                ? o.name
                : null;
          const id = o.ncbiTaxonId ?? o.ncbi_taxon_id;
          return {
            label,
            ncbiTaxonId: typeof id === "number" ? id : null,
          };
        })
        .filter((s) => !!s.label)
    : [];
  const out: TermSourceMetadata = {
    species: species.length > 0 ? species : null,
    cellLineType: str("cellLineType", "cell_line_type"),
    sex: str("sex"),
    strainType: str("strainType", "strain_type"),
    problematic: str("problematic"),
  };
  const anything =
    !!out.species ||
    !!out.cellLineType ||
    !!out.sex ||
    !!out.strainType ||
    !!out.problematic;
  return anything ? out : null;
}

// ---------------------------------------------------------------------------
// Immediate children — the direct subclasses of a term, so a curator can
// see at a glance whether a MORE SPECIFIC choice exists below the term the
// chip carries. Gemma's ``/annotations/term`` ships parents but no children
// (verified against a live Gemma host 2026-07), so this is a separate, LAZY lookup
// against Gemma's ``/annotations/children?...&direct=true`` — the SAME host
// that serves the parents, so the hierarchy stays on one ontology release
// instead of skewing against an external service. ``direct=true`` returns
// only the immediate children (without it the endpoint returns the whole
// transitive descendant set — 477 for cerebral cortex vs 32 direct). Lazy +
// cached a day (the hierarchy is immutable within a session), so it never
// blocks the popover's primary render.
// ---------------------------------------------------------------------------

/** Immediate-children result for the popover: the direct children plus
 *  their count, so the UI can render "child A, child B (+N more)". */
export interface TermChildren {
  children: TermRef[];
  total: number;
}

const TERM_CHILDREN_KEY = (uri: string | null) =>
  ["annotations-term-children-gemma", uri ?? ""] as const;

/** Fetch a term's IMMEDIATE children from Gemma. Lazy + cached: enable it
 *  only while the popover is open on an ontology term. Returns ``null``
 *  when the URI is empty or the fetch fails — the popover then simply omits
 *  the children line rather than falsely claiming a leaf. */
export function useTermChildren(uri: string | null | undefined, enabled: boolean) {
  return useQuery<TermChildren | null>({
    queryKey: TERM_CHILDREN_KEY(uri ?? null),
    queryFn: async () => {
      if (!uri) return null;
      // Gemma keys ``/annotations/children`` on the full IRI, like the
      // term endpoint. ``direct=true`` → immediate children only.
      const iri = curieToUrl(uri) ?? uri;
      const params = new URLSearchParams({ uri: iri, direct: "true" });
      try {
        const raw = await api.get<unknown>(
          `/rest/v2/annotations/children?${params.toString()}`,
        );
        return parseGemmaChildren(raw);
      } catch {
        return null;
      }
    },
    // Immutable hierarchy — hold it for a day so reopening the chip is free.
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    enabled: !!uri && enabled,
  });
}

/** Map Gemma's ``/annotations/children`` payload into the {children,
 *  total} shape. The endpoint returns the full immediate-children list
 *  (no pagination), so ``total`` is just its length; the popover caps the
 *  display and shows a "(+N more)" tail.
 *
 *  A well-formed EMPTY list is a genuine leaf → ``{children: [], total: 0}``
 *  (the popover labels it "leaf term"). Returns ``null`` only when the
 *  payload isn't a list at all (transport error / unexpected shape), so a
 *  failed lookup never masquerades as a definitive leaf. */
export function parseGemmaChildren(raw: unknown): TermChildren | null {
  if (!raw || typeof raw !== "object") return null;
  // Gemma envelope: the list may sit under ``.data`` (ResponseDataObject)
  // or be returned bare by local_api-style servers.
  const root = (raw as { data?: unknown }).data ?? raw;
  if (!Array.isArray(root)) return null;
  const children: TermRef[] = root
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      // ``value``/``valueUri`` (Gemma) with snake_case + generic fallbacks
      // so the client's key-transform and a bare shape both parse.
      uri:
        typeof x.value_uri === "string"
          ? x.value_uri
          : typeof x.valueUri === "string"
            ? (x.valueUri as string)
            : typeof x.uri === "string"
              ? x.uri
              : null,
      label:
        typeof x.value === "string"
          ? x.value
          : typeof x.label === "string"
            ? x.label
            : "",
    }))
    .filter((c) => !!c.label);
  return { children, total: children.length };
}

const OLS_TERM_KEY = (uri: string | null) =>
  ["annotations-term-ols", uri ?? ""] as const;

/** Fetch a term's detail from EBI's Ontology Lookup Service (OLS4).
 *  Disabled by default — the popover only enables this query when the
 *  curator clicks "Fetch from OLS" (per design review 2026-06-13). Single hit
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
  // NCBI ``otheraliases`` is a comma-separated alias list
  // ("C-K-RAS, CFC2, KRAS2, …"). Surface these as structured synonyms
  // (rendered under an "aliases" label for genes) instead of burying
  // them in the definition text. Design review 2026-06-21. Genes have no
  // ontology synonyms/parents/version — this is the gene analog.
  const aliasList =
    typeof r.otheraliases === "string"
      ? r.otheraliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
      : [];
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
  // organism so the popover still says something useful for genes that
  // don't have a written summary yet. (Aliases used to be appended here
  // as "Also known as: …"; they now render as a structured aliases line.)
  const defParts: string[] = [];
  if (summary) defParts.push(summary);
  else if (description) defParts.push(description);
  if (organism) defParts.push(`Organism: ${organism}.`);
  const definition = defParts.join(" ");
  // Drop the primary symbol if it shows up in its own alias list.
  const synonyms: TermSynonym[] = aliasList
    .filter((a) => a.toLowerCase() !== symbol.toLowerCase())
    .map((a) => ({ value: a, type: "alias" }));
  if (!label && !definition) return null;
  return {
    uri,
    label,
    definition,
    parents: [],
    synonyms,
    alternativeIds: [],
    xrefs: [],
    ontologyVersion: null,
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
    synonyms: parseOlsSynonyms(t, label),
    alternativeIds: [],
    xrefs: [],
    ontologyVersion: null,
    ontology,
    source: "ols",
    canonicalUrl: `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(uri)}`,
  };
}

/** Extract synonyms from an OLS4 term record. OLS ships plain-string
 *  ``synonyms`` and scoped ``obo_synonym`` objects (``{name, scope}``);
 *  merge both, dedupe case-insensitively, and drop the one that just
 *  repeats the primary label. */
export function parseOlsSynonyms(
  t: Record<string, unknown>,
  label: string,
): TermSynonym[] {
  const out: TermSynonym[] = [];
  const seen = new Set<string>();
  const labelKey = label.trim().toLowerCase();
  const push = (value: string, type: string) => {
    const v = value.trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (key === labelKey || seen.has(key)) return;
    seen.add(key);
    out.push({ value: v, type });
  };
  const plain = t.synonyms;
  if (Array.isArray(plain)) {
    for (const s of plain) if (typeof s === "string") push(s, "");
  }
  const obo = t.obo_synonym;
  if (Array.isArray(obo)) {
    for (const s of obo) {
      if (!s || typeof s !== "object") continue;
      const o = s as { name?: unknown; scope?: unknown };
      if (typeof o.name === "string") {
        push(o.name, typeof o.scope === "string" ? o.scope : "");
      }
    }
  }
  return out;
}

const OLS_SYNONYMS_KEY = (uri: string | null) =>
  ["annotations-synonyms-ols", uri ?? ""] as const;

/** Lazy, always-on OLS side-fetch for a term's synonyms — mirrors
 *  ``useTermChildren``. Gemma's ``/annotations/term`` ships synonyms for
 *  some terms but not others (CHEBI compounds routinely arrive with
 *  none), so the popover fills the gap from OLS in parallel with the
 *  primary lookup. Never blocks the card; the synonyms line just fills in
 *  when it resolves, and only when the primary source shipped none. */
export function useTermSynonyms(
  uri: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<TermSynonym[]>({
    queryKey: OLS_SYNONYMS_KEY(uri ?? null),
    queryFn: async () => {
      if (!uri) return [];
      const iri = curieToUrl(uri) ?? uri;
      const params = new URLSearchParams({
        iri,
        rows: "1",
        fieldList: "label,synonym,obo_synonym",
      });
      const url = `https://www.ebi.ac.uk/ols4/api/terms?${params.toString()}`;
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" } });
        if (!resp.ok) return [];
        const json = await resp.json();
        const root = json as { _embedded?: { terms?: unknown[] } };
        const terms = root._embedded?.terms ?? [];
        if (!Array.isArray(terms) || terms.length === 0) return [];
        const t = terms[0] as Record<string, unknown>;
        const label =
          typeof t.label === "string"
            ? t.label
            : Array.isArray(t.label)
              ? (t.label[0] as string)
              : "";
        return parseOlsSynonyms(t, label);
      } catch {
        return [];
      }
    },
    // Synonyms are immutable per ontology release — hold a day.
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    enabled: !!uri && enabled,
  });
}
