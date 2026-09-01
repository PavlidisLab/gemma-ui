/**
 * @vitest-environment jsdom
 *
 * `useCategories` asks Gemma which categories it accepts, and until
 * 2026-08-31 it asked the wrong route: `/rest/v2/categories`, a
 * RootWebService alias that 302s to `/datasets/categories` — the
 * dataset usage facet. Three things went wrong at once and none of
 * them threw: the fields are named differently (`category` / `uri`
 * never filled), the envelope carries pagination siblings so
 * `unwrapGemmaEnvelope` keeps it WRAPPED and the caller got an object
 * where it expects an array, and the list itself is the wrong list —
 * a truncated usage ranking rather than the 28 categories Gemma
 * publishes.
 *
 * The reason it survived: dev runs against the local curation server,
 * which serves the shape the caller wants at whatever path it is asked
 * for. Only real Gemma tells these two routes apart. So these tests
 * pin the ROUTE and the SHAPE, with bodies captured verbatim from
 * gemma2 2.9.4 (2026-08-31).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { CATEGORIES_ROUTE, fetchCategories } from "./categories";

/** `/rest/v2/annotations/categories` — `AnnotationCategoryValueObject`,
 *  `{data}` and nothing else, so the client unwraps it to a bare array.
 *  Two of the real 28 rows. */
const PUBLISHED = {
  data: [
    {
      uri: "http://www.ebi.ac.uk/efo/EFO_0000408",
      label: "obsolete_disease",
      preferredPrefixes: ["MONDO_", "EFO_"],
      excludedPrefixes: ["GO_"],
    },
    {
      uri: "http://www.ebi.ac.uk/efo/EFO_0000399",
      label: "developmental stage",
      preferredPrefixes: ["UBERON_", "EFO_"],
      excludedPrefixes: ["GO_"],
    },
  ],
};

/** What `/rest/v2/categories` answers with instead: the usage facet,
 *  wrong field names, and six pagination siblings that stop the
 *  envelope from being unwrapped at all. */
const USAGE_FACET = {
  data: [
    {
      categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000408",
      category: "disease",
      numberOfExpressionExperiments: 7435,
    },
  ],
  filter: null,
  groupBy: null,
  sort: null,
  limit: 20,
  query: null,
  inferredTerms: null,
};

function respondWith(body: unknown) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

// `fetchCategories` is the real query function `useCategories` installs
// and `CATEGORIES_ROUTE` the real route string, both imported rather
// than restated — a test that spells the URL out itself keeps passing
// while the code drifts away from it, which is how the old facet test
// stayed green through this whole bug.

describe("the published category list", () => {
  it("🛑 asks /annotations/categories, not the /categories alias", async () => {
    const seen = respondWith(PUBLISHED);
    await fetchCategories();
    // The literal, so a silent re-point fails here and not just in prod.
    expect(CATEGORIES_ROUTE).toBe("/rest/v2/annotations/categories");
    expect(seen[0]).toContain(CATEGORIES_ROUTE);
    // The alias 302s to the usage facet. Hitting it is the bug.
    expect(seen[0]).not.toMatch(/\/rest\/v2\/categories(\?|$)/);
  });

  it("unwraps to a bare array of {label, uri}", async () => {
    respondWith(PUBLISHED);
    const list = await fetchCategories();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe("obsolete_disease");
    expect(list[0].uri).toBe("http://www.ebi.ac.uk/efo/EFO_0000408");
  });

  it("keeps the obsolete_disease spelling — the render layer strips it", async () => {
    // `stripObsoletePrefix` renders this as "disease" and
    // `categoryVerdict` forgives the deprecation. Both need the raw
    // published label to arrive intact; the usage facet's `disease`
    // would make them dead code.
    respondWith(PUBLISHED);
    const list = await fetchCategories();
    expect(list.map((c) => c.label)).toContain("obsolete_disease");
  });

  it("🛑 the usage facet would not survive this contract", async () => {
    // Guarding the shape, not just the URL: if someone points this back
    // at `/rest/v2/categories`, the response fails here rather than
    // rendering a picker full of blanks. `unwrapGemmaEnvelope` leaves
    // the pagination-bearing envelope wrapped, so what comes back is
    // not even an array.
    respondWith(USAGE_FACET);
    const wrong = (await fetchCategories()) as unknown;
    expect(Array.isArray(wrong)).toBe(false);
    const rows = (wrong as { data: Array<Record<string, unknown>> }).data;
    expect(rows[0].label).toBeUndefined();
    expect(rows[0].uri).toBeUndefined();
  });
});
