// The annotation facet panel — the categories and terms the Browser's
// side panel offers to filter by — reads four fields Gemma renamed with
// no aliases. `21420e9` fixed the third route that serves them and
// missed these two, and the failure was silent in the worst way:
// `getCategoriesWithChildren` derives each category's id from
// `classUri || className`, got `""` for every row, dropped every row for
// having no children, and returned an EMPTY panel. An empty panel is
// indistinguishable from a filter that legitimately matched nothing.
//
// `annotationRenameCompat.test.ts` already pins the coalescing functions
// themselves — pre-rename, post-rename, both-present, and recursion into
// children. This file deliberately does NOT repeat that. It covers the
// two things those unit tests cannot see:
//
//   1. that the two facet ROUTES actually run their response through one
//      of them — a perfect `withCategoryCompat` helps nothing if
//      `getCategories` forgets to call it, which is precisely the shape
//      of the original bug;
//   2. that a verbatim wire response comes out the far end as a
//      POPULATED panel.
//
// The last two tests are the ones that would have failed before the fix.
// Fixtures are verbatim rows measured on gemma2 2.9.4 (2026-08-31).
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  getAnnotationsByCategory,
  getCategories,
  getCategoriesWithChildren,
} from "./endpoints";

const ORGANISM_PART = "http://www.ebi.ac.uk/efo/EFO_0000635";
const BRAIN = "http://purl.obolibrary.org/obo/UBERON_0000955";

/** `GET /datasets/categories` — `CategoryWithUsageStatisticsValueObject`.
 *  `classUri` / `className` are absent entirely, not null. */
const WIRE_CATEGORY = {
  categoryUri: ORGANISM_PART,
  category: "organism part",
  numberOfExpressionExperiments: 15194,
};

/** The same route's uncategorized row: a label and no URI at all. It has
 *  to survive, because the category id falls back to the label. */
const WIRE_CATEGORY_NO_URI = {
  categoryUri: null,
  category: "BioSource",
  numberOfExpressionExperiments: 23289,
};

/** `GET /datasets/annotations` — `AnnotationWithUsageStatisticsValueObject`. */
const WIRE_TERM = {
  categoryUri: ORGANISM_PART,
  category: "organism part",
  valueUri: BRAIN,
  value: "brain",
  evidenceCode: "IIA",
  numberOfExpressionExperiments: 2021,
};

function jsonOnce(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("getCategories", () => {
  it("🛑 runs its response through the compat adapter", async () => {
    // Not a test of the adapter — a test that this route calls it. The
    // old-named fields are what every consumer downstream reads.
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [WIRE_CATEGORY] })));
    const r = await getCategories({ filter: [], applyExclusions: false });
    expect(r.data[0].className).toBe("organism part");
    expect(r.data[0].classUri).toBe(ORGANISM_PART);
    expect(r.data[0].numberOfExpressionExperiments).toBe(15194);
  });

  it("keeps a category that has a label and no uri", async () => {
    // `getCategoryId` falls back to the lowercased label, which is the
    // only handle the uncategorized rows have.
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [WIRE_CATEGORY_NO_URI] })));
    const r = await getCategories({ filter: [], applyExclusions: false });
    expect(r.data[0].classUri).toBeNull();
    expect(r.data[0].className).toBe("BioSource");
  });

  it("keeps the pagination siblings the envelope carries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOnce({ data: [WIRE_CATEGORY], limit: 20, inferredTerms: [] })),
    );
    const r = await getCategories({ filter: [], applyExclusions: false });
    expect(r.limit).toBe(20);
  });
});

describe("getAnnotationsByCategory", () => {
  it("🛑 runs its response through the compat adapter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [WIRE_TERM] })));
    const r = await getAnnotationsByCategory({
      category: ORGANISM_PART,
      filter: [],
      applyExclusions: false,
    });
    expect(r.data[0].termName).toBe("brain");
    expect(r.data[0].termUri).toBe(BRAIN);
    expect(r.data[0].classUri).toBe(ORGANISM_PART);
  });

  it("an empty response is not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [] })));
    const r = await getAnnotationsByCategory({
      category: ORGANISM_PART,
      filter: [],
      applyExclusions: false,
    });
    expect(r.data).toEqual([]);
  });
});

describe("getCategoriesWithChildren", () => {
  /** Both facet calls, in the order `getCategoriesWithChildren` makes
   *  them: categories first, then one term call per category. */
  function stubFacetRoutes() {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes("/datasets/categories")) {
          return jsonOnce({ data: [WIRE_CATEGORY, WIRE_CATEGORY_NO_URI] });
        }
        return jsonOnce({ data: [WIRE_TERM] });
      }),
    );
    return urls;
  }

  it("🛑 builds a populated panel from a verbatim wire response", async () => {
    // The regression. Before the adapter reached this route, `catId` was
    // `""` for every row, every category came back childless, and the
    // filter below dropped all of them — an empty panel, no error,
    // nothing in the console.
    const urls = stubFacetRoutes();
    const panel = await getCategoriesWithChildren({ filter: [], applyExclusions: false });

    expect(panel).toHaveLength(2);
    expect(panel.map((c) => c.className)).toEqual(["organism part", "BioSource"]);
    expect(panel[0].children.map((t) => t.termName)).toEqual(["brain"]);
    expect(urls[0]).toContain("/datasets/categories");
  });

  it("🛑 asks for each category's terms by the id it derived", async () => {
    // The empty `catId` never even reached the wire — the code returned
    // early. Asserting the outgoing `category` param is what pins that
    // down: a blank one here means the rename regressed again.
    const urls = stubFacetRoutes();
    await getCategoriesWithChildren({ filter: [], applyExclusions: false });

    const termCalls = urls.filter((u) => u.includes("/datasets/annotations"));
    expect(termCalls).toHaveLength(2);
    expect(termCalls[0]).toContain(`category=${encodeURIComponent(ORGANISM_PART)}`);
    // No URI on the row, so the id is the lowercased label.
    expect(termCalls[1]).toContain("category=biosource");
  });

  it("drops a category whose terms all fell outside the filter", async () => {
    // The childless-drop is deliberate and must survive: a category with
    // nothing under it is noise in the panel. It just has to mean "no
    // terms", not "we couldn't read the id".
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/datasets/categories")
          ? jsonOnce({ data: [WIRE_CATEGORY] })
          : jsonOnce({ data: [] }),
      ),
    );
    const panel = await getCategoriesWithChildren({ filter: [], applyExclusions: false });
    expect(panel).toEqual([]);
  });
});
