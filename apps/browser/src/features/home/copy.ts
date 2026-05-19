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
