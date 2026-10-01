/**
 * Pin the Gemma REST API for an e2e spec.
 *
 * The app fetches relative `/rest/v2/…` paths, so one route handler
 * covers the whole backend. Fixtures are plain JSON in this file rather
 * than a recorded HAR (the curation suite's approach): that suite
 * replays a real curation store it can re-record against, while this
 * app reads a live public corpus whose contents change under it —
 * there is nothing stable to record, and a hand-written payload states
 * exactly what the spec is about.
 *
 * 🛑 The fixtures are the WIRE SHAPE, and nothing checks them against
 * the real Gemma. When a field changes server-side, these keep passing
 * — same trade the curation HARs make, and the reason `api-shape`
 * style @live specs exist there. Keep them minimal: a field that no
 * assertion depends on is a field that will quietly go stale.
 *
 * Call before `page.goto`.
 */
import type { Page, Route } from "@playwright/test";

/** Gemma's 200 envelope with the paging fields the tables read. */
export function page_<T>(rows: T[], totalElements = rows.length) {
  return {
    data: rows,
    offset: 0,
    limit: rows.length,
    totalElements,
    sort: { orderBy: "id", direction: "+" },
  };
}

export const HUMAN = {
  id: 1,
  commonName: "human",
  scientificName: "Homo sapiens",
};
export const MOUSE = {
  id: 2,
  commonName: "mouse",
  scientificName: "Mus musculus",
};

/** The dataset both specs browse to and open. */
export const DATASET = {
  id: 1658,
  shortName: "GSE11630",
  name: "Peripheral blood of patients with coronary artery disease",
  description: "Whole blood drawn before and after the procedure.",
  numberOfBioAssays: 58,
  taxon: HUMAN,
  isPublic: true,
  troubled: false,
  lastUpdated: "2026-01-02T00:00:00Z",
  characteristics: [],
  geeq: null,
  libraryStrategies: [{ value: "RNA-Seq", numberOfBioAssays: 58 }],
  extractedMolecules: [{ value: "polyARNA", numberOfBioAssays: 58 }],
};

export const OTHER_DATASET = {
  id: 91442,
  shortName: "GSE270825",
  name: "Cortex of the mouse after chronic stress",
  numberOfBioAssays: 12,
  taxon: MOUSE,
  isPublic: true,
  troubled: false,
  lastUpdated: "2026-02-03T00:00:00Z",
  characteristics: [],
  geeq: null,
};

export const SAMPLES = [
  {
    id: 1,
    name: "GSM123456",
    accession: { accession: "GSM123456" },
    description: "Whole blood, patient 1, before the procedure",
    libraryStrategy: "RNA-Seq",
    sampleUsed: { id: 1, name: "GSM123456", characteristics: [] },
    arrayDesignUsed: { id: 5, shortName: "GPL570" },
  },
  {
    id: 2,
    name: "GSM123457",
    accession: { accession: "GSM123457" },
    description: "Whole blood, patient 1, after the procedure",
    libraryStrategy: "RNA-Seq",
    sampleUsed: { id: 2, name: "GSM123457", characteristics: [] },
    arrayDesignUsed: { id: 5, shortName: "GPL570" },
  },
];

export interface GemmaMockOptions {
  /** Rows for `/datasets` (the browse table). */
  datasets?: unknown[];
  /** Total the pager reports; defaults to the row count. */
  total?: number;
  /** The row `/datasets/{id}` answers with. */
  dataset?: unknown;
  /** Rows for `/datasets/{id}/samples`. */
  samples?: unknown[];
  /** Every URL the page requested, appended as they arrive. */
  calls?: string[];
}

/**
 * Serve the fixtures for every `/rest/v2` call this app makes.
 *
 * An unrouted path answers an empty envelope rather than failing the
 * request: a page pulls a dozen optional things (publications,
 * pipeline status, diagnostics, annotations) and a spec pins one of
 * them. "The server knows nothing about that" is a real state this app
 * has to render, and it keeps a spec about the header from depending
 * on a fixture for the footer.
 */
export async function mockGemma(
  pg: Page,
  opts: GemmaMockOptions = {},
): Promise<void> {
  const datasets = opts.datasets ?? [DATASET, OTHER_DATASET];
  const dataset = opts.dataset ?? DATASET;
  const samples = opts.samples ?? SAMPLES;

  await pg.route("**/rest/v2/**", async (route: Route) => {
    const url = route.request().url();
    opts.calls?.push(url);
    const path = new URL(url).pathname;

    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (/\/datasets\/taxa$/.test(path)) {
      return json(
        page_([
          { ...HUMAN, count: 12_000 },
          { ...MOUSE, count: 9_000 },
        ]),
      );
    }
    if (/\/datasets\/[^/]+\/samples$/.test(path)) return json(page_(samples));
    if (/\/datasets\/[^/]+$/.test(path) && !/\/datasets\/(taxa|platforms|categories|annotations|count)$/.test(path)) {
      return json(page_([dataset]));
    }
    if (/\/datasets$/.test(path)) {
      return json(page_(datasets, opts.total ?? datasets.length));
    }
    return json(page_([]));
  });
}
