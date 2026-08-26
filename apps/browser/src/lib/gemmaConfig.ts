// Static configuration ported from src/config/gemma.js — the
// excluded-categories list, excluded-terms list, category-display
// order, per-category options, and ontology-source link patterns.

import type { Taxon } from "./types";

/** Base URL for absolute links into the Gemma web app — legacy JSP
 *  pages (``/gene/showGene.html`` etc.) and the copy-paste API
 *  snippets, both of which bypass the dev proxy and so need a real
 *  origin. Resolution order:
 *
 *    1. ``VITE_GEMMA_BASE_URL`` — explicit client-side override.
 *       Required for prod builds, where there is no dev proxy.
 *    2. ``__GEMMA_TARGET__`` — the upstream the Vite dev proxy is
 *       already fronting, injected by ``vite.config.ts`` from the
 *       un-prefixed ``GEMMA_BASE_URL``. Only ``VITE_``-prefixed vars
 *       reach client code, so without this fallback a dev server
 *       with a perfectly good ``GEMMA_BASE_URL`` in ``.env.local``
 *       still resolved to an empty ``baseUrl`` — and anything that
 *       fed the result to ``new URL()`` threw mid-render.
 *
 *  Trailing slashes are stripped; every caller passes a path that
 *  already starts with one. */
function resolveBaseUrl(): string {
  const explicit = import.meta.env.VITE_GEMMA_BASE_URL;
  const proxied = typeof __GEMMA_TARGET__ === "string" ? __GEMMA_TARGET__ : "";
  return (explicit || proxied || "").replace(/\/+$/, "");
}

export const baseUrl: string = resolveBaseUrl();

let warnedMissingBaseUrl = false;

/** Build an absolute Gemma URL for opening in a new tab. Returns
 *  ``path`` unresolved (relative, so effectively inert) when neither
 *  source above is set, rather than throwing mid-render. Callers that
 *  hand the result to ``new URL()`` must still pass a base. */
export function gemmaUrl(path: string): string {
  if (!baseUrl) {
    if (!warnedMissingBaseUrl) {
      warnedMissingBaseUrl = true;
      console.warn(
        "No Gemma base URL configured — legacy Gemma links won't resolve. " +
          "Set GEMMA_BASE_URL in apps/browser/.env.local (dev) or " +
          "VITE_GEMMA_BASE_URL at build time (prod).",
      );
    }
    return path;
  }
  return baseUrl + path;
}

/**
 * A Gemma URL for someone ELSE to fetch — a genome browser loading a
 * custom track, say. Empty string when we have no base we can honestly
 * claim is reachable from outside; callers drop the feature rather than
 * hand out a link that times out.
 *
 * 🛑 Not `gemmaUrl`. That resolves to whatever this app talks to, which
 * is an internal address as often as not: UCSC was handed
 * `http://frink.msl.ubc.ca:8080/rest/v2/...` and answered "connection
 * timed out: either the server is offline or a firewall between UCSC
 * and the server blocks the connection". Reachable from the dev box is
 * not reachable from the internet, and the two had been the same
 * string.
 *
 * Order:
 *  1. `VITE_GEMMA_PUBLIC_URL` — say it outright, ends all guessing.
 *  2. This page's own origin, when it is `https:` and not loopback. In
 *     production the app is served from the public Gemma, so its
 *     origin IS the public base, with nothing to configure.
 *  3. The configured base, but only when it is `https:`. A heuristic,
 *     and named as one: it separates `https://gemma2.msl.ubc.ca` from
 *     `http://frink.msl.ubc.ca:8080` in the dev setups we have, and it
 *     will be wrong for a public plain-http host. Set the var there.
 */
export function publicGemmaUrl(path: string): string {
  const explicit = import.meta.env.VITE_GEMMA_PUBLIC_URL;
  if (explicit) return String(explicit).replace(/\/+$/, "") + path;

  // `https:` is the same signal rule 3 applies to the configured base,
  // and it has to be applied here too. Excluding loopback alone was
  // narrower than "unless we're on a dev host" claimed: a Vite dev
  // server started with `--host` is reached at `http://192.168.x.x:5183`
  // or at the box's own hostname, neither of which is loopback, so the
  // origin sailed through and UCSC was handed an address only the
  // office can reach — the very failure this function exists to stop.
  // Loopback stays excluded for the rare dev setup terminating TLS
  // locally.
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  if (
    /^https:\/\//i.test(origin) &&
    !/^https:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$)/i.test(origin)
  ) {
    return origin + path;
  }

  if (/^https:\/\//i.test(baseUrl)) return baseUrl + path;
  return "";
}

/** Legacy Gemma gene page — works for both NCBI-id and Gemma-internal
 *  id. Prefer the NCBI id when known: it's stable across taxa and
 *  rebuilds, and the URL is shareable. Returns null when neither id
 *  is present so the caller can render the symbol as plain text. */
export function geneUrl(opts: {
  ncbiId?: number | string | null;
  geneId?: number | string | null;
}): string | null {
  if (opts.ncbiId != null) {
    return gemmaUrl(`/gene/showGene.html?ncbiId=${opts.ncbiId}`);
  }
  if (opts.geneId != null) {
    return gemmaUrl(`/gene/showGene.html?id=${opts.geneId}`);
  }
  return null;
}

/** Legacy Gemma probe (CompositeSequence) page — meaningful only for
 *  microarray-style platforms. Returns null when the id is missing
 *  (sequencing platforms use the gene id directly as the design
 *  element, so the probe link is redundant). */
export function compositeSequenceUrl(id: number | string | null | undefined): string | null {
  if (id == null) return null;
  return gemmaUrl(`/arrays/compositeSequence/show.html?id=${id}`);
}

export const excludedCategories: string[] = [
  "http://mged.sourceforge.net/ontologies/MGEDOntology.owl#BioSourceType",
  "http://mged.sourceforge.net/ontologies/MGEDOntology.owl#LabelCompound",
  "http://mged.sourceforge.net/ontologies/MGEDOntology.owl#MaterialType",
  "http://purl.obolibrary.org/obo/CHEBI_23367",
  "http://purl.obolibrary.org/obo/GO_0007610",
  "http://purl.obolibrary.org/obo/GO_0008150",
  "http://purl.obolibrary.org/obo/OBI_0000272",
  "http://purl.obolibrary.org/obo/OBI_0100051",
  "http://purl.obolibrary.org/obo/OBI_0302893",
  "http://purl.obolibrary.org/obo/SO_0001024",
  "http://purl.obolibrary.org/obo/UO_0000003",
  "http://www.ebi.ac.uk/efo/EFO_0000246",
  "http://www.ebi.ac.uk/efo/EFO_0000322",
  "http://www.ebi.ac.uk/efo/EFO_0000352",
  "http://www.ebi.ac.uk/efo/EFO_0000410",
  "http://www.ebi.ac.uk/efo/EFO_0000428",
  "http://www.ebi.ac.uk/efo/EFO_0000470",
  "http://www.ebi.ac.uk/efo/EFO_0000507",
  "http://www.ebi.ac.uk/efo/EFO_0000523",
  "http://www.ebi.ac.uk/efo/EFO_0000542",
  "http://www.ebi.ac.uk/efo/EFO_0000562",
  "http://www.ebi.ac.uk/efo/EFO_0000651",
  "http://www.ebi.ac.uk/efo/EFO_0000724",
  "http://www.ebi.ac.uk/efo/EFO_0001444",
  "http://www.ebi.ac.uk/efo/EFO_0001702",
  "http://www.ebi.ac.uk/efo/EFO_0004425",
  "http://www.ebi.ac.uk/efo/EFO_0004444",
  "http://www.ebi.ac.uk/efo/EFO_0005066",
  "http://www.ebi.ac.uk/efo/EFO_0005067",
  "http://www.ebi.ac.uk/efo/EFO_0005136",
];

export const categoriesConfiguration: Record<string, { excludeFreeTextTerms?: boolean }> = {
  "http://www.ebi.ac.uk/efo/EFO_0000513":     { excludeFreeTextTerms: true }, // genotype
  "http://purl.obolibrary.org/obo/PATO_0000047": { excludeFreeTextTerms: true }, // biological sex
  "http://www.ebi.ac.uk/efo/EFO_0000399":     { excludeFreeTextTerms: true }, // dev stage
  "http://www.ebi.ac.uk/efo/EFO_0002755":     { excludeFreeTextTerms: true }, // diet
  "http://purl.obolibrary.org/obo/OBI_0000181": { excludeFreeTextTerms: true }, // population
  "http://purl.obolibrary.org/obo/CLO_0000031": { excludeFreeTextTerms: true }, // cell lines
  "http://www.ebi.ac.uk/efo/EFO_0005135":     { excludeFreeTextTerms: true }, // strains
  "http://www.ebi.ac.uk/efo/EFO_0000727":     { excludeFreeTextTerms: true }, // treatments
  "http://purl.obolibrary.org/obo/OBI_0000070": { excludeFreeTextTerms: true }, // assay
};

export const excludedTerms: string[] = [
  "http://purl.obolibrary.org/obo/SO_0000287",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00003",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00004",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00007",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00122",
  "http://purl.obolibrary.org/obo/OBI_0000025",
  "http://purl.obolibrary.org/obo/OBI_0000220",
  "http://purl.obolibrary.org/obo/PATO_0000048",
  "http://purl.obolibrary.org/obo/PATO_0000049",
  "http://purl.obolibrary.org/obo/PATO_0000261",
  "http://purl.obolibrary.org/obo/PATO_0000937",
  "http://purl.obolibrary.org/obo/PATO_0001178",
  "http://purl.obolibrary.org/obo/PATO_0001397",
  "http://purl.obolibrary.org/obo/PATO_0002011",
  "http://purl.obolibrary.org/obo/PATO_0002104",
  "http://purl.obolibrary.org/obo/PATO_0002353",
  "http://purl.obolibrary.org/obo/PATO_0002122",
  "http://www.ebi.ac.uk/efo/EFO_0000562",
  "http://www.ebi.ac.uk/efo/EFO_0001461",
  "http://www.ebi.ac.uk/efo/EFO_0001646",
  "http://www.ebi.ac.uk/efo/EFO_0004425",
  "http://www.ebi.ac.uk/efo/EFO_0004952",
  "http://www.ebi.ac.uk/efo/EFO_0004972",
  "http://www.ebi.ac.uk/efo/EFO_0004973",
  "http://www.ebi.ac.uk/efo/EFO_0005168",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00013",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00014",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00022",
];

export const annotationSelectorOrderArray: string[] = [
  "http://www.ebi.ac.uk/efo/EFO_0000408", // disease
  "http://www.ebi.ac.uk/efo/EFO_0000513", // genotype
  "http://www.ebi.ac.uk/efo/EFO_0000727", // treatment
  "http://www.ebi.ac.uk/efo/EFO_0000635", // organism part
  "http://www.ebi.ac.uk/efo/EFO_0000324", // cell type
  "http://www.ebi.ac.uk/efo/EFO_0005135", // strain
  "http://purl.obolibrary.org/obo/CLO_0000031", // cell line
  "http://www.ebi.ac.uk/efo/EFO_0000399", // dev stage
  "http://purl.obolibrary.org/obo/PATO_0000047", // biological sex
  "http://gemma.msl.ubc.ca/ont/TGEMO_00101", // disease model
  "http://www.ebi.ac.uk/efo/EFO_0002755", // diet
  "http://www.ebi.ac.uk/efo/EFO_0000246", // age
  "http://purl.obolibrary.org/obo/OBI_0000181", // population
  "http://www.ebi.ac.uk/efo/EFO_0002571", // medical procedure
  "http://purl.obolibrary.org/obo/OBI_0000070", // assay
];

export interface OntologySource {
  name: string;
  pattern: RegExp;
  getExternalUrl: (uri: string) => string;
}

export const ontologySources: OntologySource[] = [
  {
    name: "Gemma Ontology",
    pattern: /http:\/\/gemma\.msl\.ubc\.ca\//,
    getExternalUrl: (uri) => uri.replace("http://gemma.msl.ubc.ca", baseUrl || "https://gemma.msl.ubc.ca"),
  },
  {
    name: "Experimental Factor Ontology",
    pattern: /http:\/\/www\.ebi\.ac\.uk\/efo\/EFO_.+/,
    getExternalUrl: (uri) => "https://www.ebi.ac.uk/ols/ontologies/efo/terms?iri=" + encodeURIComponent(uri),
  },
  {
    name: "OBI",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/OBI_.+/,
    getExternalUrl: (uri) => "https://ontobee.org/ontology/OBI?iri=" + encodeURIComponent(uri),
  },
  {
    name: "PATO",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/PATO_.+/,
    getExternalUrl: (uri) => "https://ontobee.org/ontology/PATO?iri=" + encodeURIComponent(uri),
  },
  {
    name: "CLO",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/CLO_.+/,
    getExternalUrl: (uri) => "https://ontobee.org/ontology/CLO?iri=" + encodeURIComponent(uri),
  },
  {
    name: "MONDO",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/MONDO_.+/,
    getExternalUrl: (uri) => "https://www.ebi.ac.uk/ols/ontologies/mondo/terms?iri=" + encodeURIComponent(uri),
  },
  {
    name: "ChEBI",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/CHEBI_.+/,
    getExternalUrl: (uri) => uri.replace("http://purl.obolibrary.org/obo/CHEBI_", "https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:"),
  },
  {
    name: "HANCESTRO",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/HANCESTRO_.+/,
    getExternalUrl: (uri) => "https://ontobee.org/ontology/HANCESTRO?iri=" + encodeURIComponent(uri),
  },
  {
    name: "NCBI Gene",
    pattern: /http:\/\/purl\.org\/commons\/record\/ncbi_gene\/.+/,
    getExternalUrl: (uri) => uri.replace("http://purl.org/commons/record/ncbi_gene/", "https://www.ncbi.nlm.nih.gov/gene/"),
  },
  {
    name: "Uberon",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/UBERON_.+/,
    getExternalUrl: (uri) => "https://www.ebi.ac.uk/ols/ontologies/uberon/terms?iri=" + encodeURIComponent(uri),
  },
  {
    name: "Cell Ontology",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/CL_.+/,
    getExternalUrl: (uri) => "https://www.ebi.ac.uk/ols/ontologies/cl/terms?iri=" + encodeURIComponent(uri),
  },
  {
    name: "GO",
    pattern: /http:\/\/purl\.obolibrary\.org\/obo\/GO_.+/,
    getExternalUrl: (uri) => uri.replace("http://purl.obolibrary.org/obo/GO_", "https://amigo.geneontology.org/amigo/term/GO:"),
  },
];

const PUBLICATION_FIELDS: Record<string, string> = {
  name: "name",
  abstractText: "abstract text",
  authorList: "author lists",
  "chemicals.name": "chemicals name",
  "chemicals.registryNumber": "chemicals registry number",
  fullTextUri: "full text URI",
  "keywords.term": "keywords",
  "meshTerms.term": "mesh terms",
  "pubAccession.accession": "accession",
  title: "title",
};

export const HIGHLIGHT_LABELS: Record<string, string> = {
  shortName: "short name",
  "bioAssays.name": "sample name",
  "bioAssays.description": "sample description",
  "bioAssays.accession.accession": "sample accession",
  "bioAssays.sampleUsed.name": "sample name",
  "bioAssays.sampleUsed.characteristics.value": "sample annotation",
  "bioAssays.sampleUsed.characteristics.valueUri": "sample annotation URI",
  "characteristics.value": "annotation",
  "characteristics.valueUri": "annotation URI",
  "experimentalDesign.name": "experimental design name",
  "experimentalDesign.description": "experimental design description",
  "experimentalDesign.experimentalFactors.name": "experimental factors name",
  "experimentalDesign.experimentalFactors.description": "experimental factors description",
  "experimentalDesign.experimentalFactors.category.categoryUri": "experimental factors category URI",
  "experimentalDesign.experimentalFactors.category.category": "experimental factors category",
  "experimentalDesign.experimentalFactors.factorValues.characteristics.value": "experimental factors annotation",
  "experimentalDesign.experimentalFactors.factorValues.characteristics.valueUri": "experimental factors annotation URI",
  ...Object.fromEntries(Object.entries(PUBLICATION_FIELDS).map(([k, v]) => ["primaryPublication." + k, "primary publication " + v])),
  ...Object.fromEntries(Object.entries(PUBLICATION_FIELDS).map(([k, v]) => ["otherRelevantPublications." + k, "other publication " + v])),
};

/**
 * Hardcoded fallback taxa (used until /rest/v2/datasets/taxa loads).
 * The Vue browser does the same.
 */
export const fallbackTaxa: Taxon[] = [
  { id: 1, commonName: "human", scientificName: "Homo sapiens" },
  { id: 2, commonName: "mouse", scientificName: "Mus musculus" },
  { id: 3, commonName: "rat",   scientificName: "Rattus norvegicus" },
];

/**
 * The taxa this UI shows platforms for.
 *
 * `/taxa` lists 48 — everything a sequence was ever imported against,
 * down to `synthetic construct` and `Homo sapiens/Mus musculus
 * xenograft` — but Gemma curates three. The other 45 carry 16 platforms
 * between them and NOT ONE has an experiment on it (measured on
 * gemma2 2026-08-24: 670 platforms, 654 across human / mouse / rat).
 *
 * Kept separate from `fallbackTaxa` above despite listing the same
 * three: that one is "what to show until /taxa answers", this one is
 * "what belongs in the catalogue at all". Extending one should not
 * quietly move the other.
 *
 * Ids, not names. Only these three carry a `commonName` — every other
 * taxon has null — so a name check has to fall back to the scientific
 * name, and `Rattus rattus` (id 79) sits one letter away from the rat
 * this app means.
 */
export const SUPPORTED_TAXON_IDS: ReadonlySet<number> = new Set([1, 2, 3]);

/** True when a record's taxon is one this UI covers. Falls back to the
 *  scientific name when no id came down. */
export function isSupportedTaxon(
  t: { id?: number | null; scientificName?: string | null } | null | undefined,
): boolean {
  if (!t) return false;
  if (t.id != null) return SUPPORTED_TAXON_IDS.has(t.id);
  return fallbackTaxa.some((f) => f.scientificName === t.scientificName);
}

/**
 * A dataset's taxon as a REST path/query param — for scoping gene
 * lookups to the organism the dataset is on. Common name first (the
 * visitor-facing form), then scientific name, then the id; all three
 * resolve server-side. ``undefined`` when the record carries no taxon,
 * which callers must treat as "don't scope" rather than "no taxon" —
 * an unscoped gene lookup ranks across species.
 */
export function taxonPathParam(
  t:
    | { id?: number | null; commonName?: string | null; scientificName?: string | null }
    | null
    | undefined,
): string | undefined {
  if (!t) return undefined;
  return (
    t.commonName?.toLowerCase() ??
    t.scientificName?.toLowerCase() ??
    (t.id != null ? String(t.id) : undefined)
  );
}
