// The annotation facet panel — the categories and terms the Browser's
// side panel offers to filter by — reads four fields Gemma renamed with
// no aliases. `21420e9` fixed the third route that serves them and
// missed these two, and the failure was silent in the worst way:
// `getCategoriesWithChildren` derives each category's id from
// `classUri || className`, got `""` for every row, dropped every row
// for having no children, and returned an EMPTY panel. An empty panel
// is indistinguishable from a filter that legitimately matched nothing.
//
// So the regression these tests exist to catch is not "are the names
// mapped" in the abstract — it is "does a verbatim wire response still
// produce a populated panel". The last test is the one that would have
// failed before the fix.
//
// Fixtures are verbatim rows measured on gemma2 2.9.4 (2026-08-31),
// plus the pre-rename shape an older Gemma still serves. Nothing here
// touches the network; `scripts/check-annotation-contract.mjs` is the
// opt-in probe that re-validates these fixtures against a live server.
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  getAnnotationsByCategory,
  getCategories,
  getCategoriesWithChildren,
  normalizeAnnotationTerm,
  normalizeCategory,
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

/** What an older Gemma serves on both facet routes. */
const LEGACY_CATEGORY = {
  classUri: ORGANISM_PART,
  className: "organism part",
  numberOfExpressionExperiments: 15194,
};
const LEGACY_TERM = {
  classUri: ORGANISM_PART,
  className: "organism part",
  termUri: BRAIN,
  termName: "brain",
  numberOfExpressionExperiments: 2021,
};

function jsonOnce(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizeCategory", () => {
  it("reads the renamed fields — the panel was empty without this", () => {
    const c = normalizeCategory(WIRE_CATEGORY);
    expect(c.classUri).toBe(ORGANISM_PART);
    expect(c.className).toBe("organism part");
    expect(c.numberOfExpressionExperiments).toBe(15194);
  });

  it("still reads an older Gemma — coalescing is why this is safe to ship", () => {
    expect(normalizeCategory(LEGACY_CATEGORY).className).toBe("organism part");
    expect(normalizeCategory(LEGACY_CATEGORY).classUri).toBe(ORGANISM_PART);
  });

  it("keeps a category that has a label and no uri", () => {
    // `getCategoryId` falls back to the lowercased label, which is the
    // only handle the uncategorized rows have. Losing the label here
    // is what made them unaddressable.
    const c = normalizeCategory(WIRE_CATEGORY_NO_URI);
    expect(c.classUri).toBeNull();
    expect(c.className).toBe("BioSource");
  });

  it("yields nulls, not undefined, on an empty row", () => {
    expect(normalizeCategory({})).toEqual({
      className: null,
      classUri: null,
      numberOfExpressionExperiments: undefined,
    });
  });
});

describe("normalizeAnnotationTerm", () => {
  it("reads the renamed fields", () => {
    const t = normalizeAnnotationTerm(WIRE_TERM);
    expect(t.className).toBe("organism part");
    expect(t.classUri).toBe(ORGANISM_PART);
    expect(t.termName).toBe("brain");
    expect(t.termUri).toBe(BRAIN);
  });

  it("still reads an older Gemma", () => {
    const t = normalizeAnnotationTerm(LEGACY_TERM);
    expect(t.termName).toBe("brain");
    expect(t.termUri).toBe(BRAIN);
  });

  it("carries the count through — the facet row renders it", () => {
    expect(normalizeAnnotationTerm(WIRE_TERM).numberOfExpressionExperiments).toBe(2021);
  });
});

describe("getCategories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps on the way out, so consumers keep reading the names they read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [WIRE_CATEGORY] })));
    const r = await getCategories({ filter: [], applyExclusions: false });
    expect(r.data).toEqual([
      {
        classUri: ORGANISM_PART,
        className: "organism part",
        numberOfExpressionExperiments: 15194,
      },
    ]);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the term rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ data: [WIRE_TERM] })));
    const r = await getAnnotationsByCategory({
      category: ORGANISM_PART,
      filter: [],
      applyExclusions: false,
    });
    expect(r.data.map((t) => t.termName)).toEqual(["brain"]);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    // The regression. Before the adapter, `catId` was `""` for every
    // row, every category came back childless, and the filter below
    // dropped all of them — an empty panel, no error, nothing in the
    // console.
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
    // The childless-drop is deliberate and must survive the fix: a
    // category with nothing under it is noise in the panel. It just
    // has to mean "no terms", not "we couldn't read the id".
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
