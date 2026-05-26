/**
 * Real Gemma copy — single source of truth so every home variant
 * pulls from the same well. Phrasing borrowed / adapted from the
 * existing gemma.msl.ubc.ca site so we don't ship marketing prose
 * the lab hasn't seen.
 *
 * Edit here; the variants will re-render.
 */

export const COPY = {
  /** Short, factual one-liner — fits a hero tagline. */
  tagline:
    "Curated and re-analyzed gene expression data — primarily human, mouse, and rat.",

  /** A slightly longer "what is Gemma" paragraph for cards or
   *  full-width strips. Plain language. */
  about:
    "Gemma is a database of curated and re-analyzed expression studies. We re-process raw data, harmonize sample-level annotations against ontologies, and publish results through a public website, a REST API, and the gemma.R / gemmapy clients. The aim is to make published expression data actually usable for meta-analysis and re-use.",

  /** Two-sentence pitch for what curators / analysts do here. */
  whoFor:
    "Researchers use Gemma to find datasets relevant to their question, browse curated annotations, and pull harmonized expression matrices into their own analyses. Curators use it to triage incoming GEO submissions, propose factor designs, and audit agent-assisted annotation work.",

  /** A short list of "what's actually in the corpus" — for the
   *  numbers strip / sidebar. Don't put live counts here; those
   *  come from useGemmaSummary. */
  corpusBlurb:
    "Most datasets are from GEO and ArrayExpress; a smaller portion are direct lab submissions. Coverage spans microarray and RNA-seq across the major model organisms.",

  /** Cite Gemma — for the footer / about strip. */
  citation:
    "Lim N, Tesar S, Belmadani M, et al. Curation of over 10,000 transcriptomic studies to enable data reuse. Database (Oxford). 2021.",

  /** Links shared across variants. */
  links: {
    docs: "https://pavlidislab.github.io/Gemma/",
    rest: "https://gemma.msl.ubc.ca/resources/restapidocs/",
    github: "https://github.com/PavlidisLab",
    lab: "https://www.chibi.ubc.ca/faculty/pavlidis-paul/",
    rClient: "https://github.com/PavlidisLab/gemma.R",
    pyClient: "https://github.com/PavlidisLab/gemmapy",
    legacyHome: "https://gemma.msl.ubc.ca/",
  },
} as const;

/** Three-column "general info" block shown by default just below
 *  the recently-updated ticker on the home page. Folded away by
 *  curators / API users who already know what Gemma is and want
 *  the stats / breakdowns below directly.
 *
 *  Each column has a distinct accent colour (orange / blue /
 *  emerald) — visual anchor without crowding the brutalist
 *  palette. Item shapes are structured so the UI can lead with a
 *  bold "lead" / chip and follow with a muted "body" / hint —
 *  scanability over prose.
 */
export const GENERAL_INFO = {
  idea: {
    title: "What Gemma is",
    accent: "orange", // identity colour, matches the favicon
    /** One-line essence — rendered large + bold at the top. */
    lead: "Curated and re-analysed gene-expression data — human, mouse, and rat.",
    /** Supporting paragraphs, rendered as separate <p> elements
     *  so each idea has its own block of breathing room. */
    body: [
      "A repository of public gene-expression studies, re-analysed end-to-end so the data is actually usable for meta-analysis.",
      "We re-process raw sequencing and array data, then harmonise sample-level annotations against community ontologies.",
      "Results are published through this website, a REST API, and the gemma.R / gemmapy clients.",
    ],
  },
  provide: {
    title: "What we provide",
    accent: "blue", // data + analysis blue
    /** Two-column ``<dl>``: <dt>lead</dt> <dd>body</dd>. Bodies
     *  trimmed to ~1 line each so the panel reads as a tight
     *  reference table, not a wall of text. */
    items: [
      { lead: "Datasets",    body: "Microarray, RNA-seq, single-cell — re-processed." },
      { lead: "Annotations", body: "Harmonised to MONDO, EFO, UBERON, CL, CHEBI." },
      { lead: "Analyses",    body: "Pre-computed DEA contrasts." },
      { lead: "Quality",     body: "GEEQ scores and provenance." },
      { lead: "Coverage",    body: "Human, mouse, rat." },
    ],
  },
  how: {
    title: "How to access",
    accent: "emerald", // action / how-to colour
    /** Each item: <mono tag chip> <link label> — <hint>. */
    items: [
      { tag: "WEB", label: "Browse the corpus", hint: "search + filter UI", href: "/browser", external: false },
      { tag: "REST", label: "REST API", hint: "programmatic queries", href: "https://gemma.msl.ubc.ca/resources/restapidocs/", external: true },
      { tag: "R", label: "gemma.R", hint: "R client", href: "https://github.com/PavlidisLab/gemma.R", external: true },
      { tag: "PY", label: "gemmapy", hint: "Python client", href: "https://github.com/PavlidisLab/gemmapy", external: true },
      { tag: "MCP", label: "gemma-mcp", hint: "AI-agent server", href: "https://github.com/PavlidisLab/gemma-mcp", external: true },
      { tag: "DOC", label: "Documentation", hint: "guides + reference", href: "https://pavlidislab.github.io/Gemma/", external: true },
    ],
  },
} as const;

/** Top-line navigation surfaces shown on every variant.
 *  Each variant decides its own visual treatment.
 *  `to: null` means the page isn't built yet — variants render a
 *  grayed-out card. */
export const SURFACES: ReadonlyArray<{
  to: string | null;
  label: string;
  blurb: string;
}> = [
  {
    to: "/browser",
    label: "Datasets",
    blurb: "Search and filter ~25K experiments by taxon, technology, and ontology annotation.",
  },
  {
    to: "/platforms",
    label: "Platforms",
    blurb: "Microarray and sequencing platforms — manufacturer, technology, taxon.",
  },
  {
    to: "/genes",
    label: "Genes",
    blurb: "Per-gene expression and differential expression results across datasets.",
  },
  {
    to: "/about",
    label: "About",
    blurb: "Pipeline, citation, team, licenses, and programmatic access.",
  },
];
