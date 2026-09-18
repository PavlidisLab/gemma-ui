/**
 * A small, fixed corpus for the browse page's render tests, and the
 * routes that serve it.
 *
 * The browse page issues a dozen requests on mount — the rows, the
 * taxon / platform / category facets, one `/datasets/count` per library
 * strategy, one platform list per microarray channel, `/me` — and every
 * facet answers for "the current filter minus my own clauses". The
 * routes here answer all of them from one fixture set so a spec can
 * mount the page with one call and then read the WIRE: what filter each
 * request carried, and whether a request was made at all.
 */
import { renderRoute, type RenderRouteResult } from "./renderRoute";
import {
  envelope,
  filterOf,
  installGemmaFetch,
  page,
  paramOf,
  type GemmaFetchStub,
  type StubRoute,
} from "./gemmaFetch";

export const HUMAN = {
  id: 1,
  commonName: "human",
  scientificName: "Homo sapiens",
  numberOfExpressionExperiments: 12_000,
};
export const MOUSE = {
  id: 2,
  commonName: "mouse",
  scientificName: "Mus musculus",
  numberOfExpressionExperiments: 9_000,
};
export const TAXA = [HUMAN, MOUSE];

export const ROWS = [
  {
    id: 1658,
    shortName: "GSE11630",
    name: "Peripheral blood of patients with coronary artery disease",
    description: "Whole blood from 58 patients.",
    numberOfBioAssays: 58,
    taxon: HUMAN,
    lastUpdated: "2026-01-02T00:00:00Z",
    isPublic: true,
    troubled: false,
    geeq: null,
  },
  {
    id: 91442,
    shortName: "GSE270825",
    name: "Cortex of the mouse after chronic stress",
    description: "Prefrontal cortex, 12 animals.",
    numberOfBioAssays: 12,
    taxon: MOUSE,
    lastUpdated: "2026-02-03T00:00:00Z",
    isPublic: true,
    troubled: false,
    geeq: null,
  },
];

/** `numberOfExpressionExperimentsForTechnologyType` is the same on every
 *  platform of a type — the selector sums it once per type. */
export const GPL96 = {
  id: 1,
  shortName: "GPL96",
  name: "Affymetrix GeneChip Human Genome U133A Array",
  technologyType: "ONECOLOR",
  numberOfExpressionExperiments: 400,
  numberOfExpressionExperimentsForTechnologyType: 7_000,
};
export const GPL6480 = {
  id: 7,
  shortName: "GPL6480",
  name: "Agilent-014850 Whole Human Genome Microarray 4x44K G4112F",
  technologyType: "TWOCOLOR",
  numberOfExpressionExperiments: 90,
  numberOfExpressionExperimentsForTechnologyType: 800,
};
export const GENERIC_HUMAN = {
  id: 1_000,
  shortName: "Generic_human_ncbiIds",
  name: "Generic platform for human",
  technologyType: "SEQUENCING",
  numberOfExpressionExperiments: 5_000,
  numberOfExpressionExperimentsForTechnologyType: 6_000,
};
export const PLATFORMS = [GPL96, GPL6480, GENERIC_HUMAN];

export const ORGANISM_PART = "http://www.ebi.ac.uk/efo/EFO_0000635";
export const BRAIN = "http://purl.obolibrary.org/obo/UBERON_0000955";
export const LIVER = "http://purl.obolibrary.org/obo/UBERON_0002107";

/** Wire spelling — `/datasets/categories` and `/datasets/annotations`
 *  serve `category` / `value`, which the adapters rename. */
const CATEGORIES = [
  { category: "organism part", categoryUri: ORGANISM_PART, numberOfExpressionExperiments: 5_000 },
];
const TERMS = [
  { category: "organism part", categoryUri: ORGANISM_PART, value: "brain", valueUri: BRAIN, numberOfExpressionExperiments: 900 },
  { category: "organism part", categoryUri: ORGANISM_PART, value: "liver", valueUri: LIVER, numberOfExpressionExperiments: 300 },
];

/** Datasets per library strategy, as `/datasets/count` answers when the
 *  filter asks for exactly that one. */
export const STRATEGY_COUNTS: Record<string, number> = {
  MICROARRAY_ONE_COLOR: 7_000,
  MICROARRAY_TWO_COLOR: 800,
  OTHER: 20,
  CHIP_SEQ: 5,
  SSRNA_SEQ: 0,
  MIRNA_SEQ: 40,
  RIBO_SEQ: 0,
  NCRNA_SEQ: 0,
  RIP_SEQ: 0,
};

export const CURATOR = {
  userName: "curator",
  email: "curator@example.org",
  authorities: ["GROUP_USER", "GROUP_CURATOR"],
};

/** Ids the curator-only listing returns — the datasets a visitor is
 *  not shown. */
export const CURATOR_ONLY_IDS = [91442];

export interface BrowseOptions {
  rows?: unknown[];
  total?: number;
  /** Signed in as this user; anonymous when absent. */
  me?: Record<string, unknown>;
  /** Routes consulted before the defaults, for a spec that needs one
   *  request to answer differently (an error, say). */
  extra?: StubRoute[];
}

export function browseRoutes(opts: BrowseOptions = {}): StubRoute[] {
  const rows = opts.rows ?? ROWS;
  const total = opts.total ?? 23_549;
  return [
    ...(opts.extra ?? []),
    ...(opts.me ? [{ match: /\/rest\/v2\/me(\?|$)/, body: envelope(opts.me) }] : []),
    { match: /\/rest\/v2\/datasets\/taxa/, body: page(TAXA) },
    { match: /\/rest\/v2\/datasets\/platforms/, body: page(PLATFORMS) },
    { match: /\/rest\/v2\/datasets\/categories/, body: page(CATEGORIES) },
    { match: /\/rest\/v2\/datasets\/annotations/, body: page(TERMS) },
    {
      match: /\/rest\/v2\/datasets\/count/,
      body: (url: string) => {
        // The clause being counted is a top-level one. A visitor's
        // filter also carries `none(bioAssays.libraryStrategy in
        // (OTHER,CHIP_SEQ))`, which a looser match would count instead.
        const m = /(?:^| and )bioAssays\.libraryStrategy in \(([A-Z_,]+)\)/.exec(
          filterOf(url),
        );
        const n = (m?.[1] ?? "")
          .split(",")
          .reduce((sum, v) => sum + (STRATEGY_COUNTS[v] ?? 0), 0);
        return envelope(n);
      },
    },
    {
      match: /\/rest\/v2\/datasets(\?|$)/,
      body: (url: string) =>
        // `getCuratorOnlyDatasetIds` pages the hidden set in id order.
        paramOf(url, "sort") === "+id"
          ? page(
              ROWS.filter((r) => CURATOR_ONLY_IDS.includes(r.id)),
              CURATOR_ONLY_IDS.length,
            )
          : page(rows, total),
    },
  ];
}

export interface MountedBrowser extends RenderRouteResult {
  stub: GemmaFetchStub;
}

/** Mount `path` against the fixture corpus. Restore `stub` after. */
export function mountBrowser(
  path = "/browser",
  opts: BrowseOptions = {},
): MountedBrowser {
  const stub = installGemmaFetch(browseRoutes(opts));
  return Object.assign(renderRoute(path), { stub });
}

/** Requests for the rows — not the curator-only id listing, which goes
 *  to the same path. */
export const ROW_REQUEST = /\/rest\/v2\/datasets\?(?!.*sort=%2Bid)/;

/** The filter of the most recent request for the rows. */
export function lastRowsFilter(stub: GemmaFetchStub): string {
  const all = stub.requests(ROW_REQUEST);
  return all.length ? filterOf(all[all.length - 1]) : "";
}

/** The most recent request for the rows. */
export function lastRowsRequest(stub: GemmaFetchStub): string {
  const all = stub.requests(ROW_REQUEST);
  return all[all.length - 1] ?? "";
}
