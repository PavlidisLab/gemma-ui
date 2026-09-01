// A dataset's annotation chips read four fields Gemma has renamed, and
// the route hides every ungrounded row unless asked not to. Both are
// silent failures: the renamed fields render as blank chips, and the
// hidden rows look exactly like a dataset that has none.
//
// Fixtures are verbatim rows measured on gemma2 `0293d82c47`
// (eid 38390, 2026-08-31), plus the pre-rename shape an older Gemma
// still serves.
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  getDatasetAnnotations,
  withDatasetAnnotationCompat,
} from "./endpoints";

/** Current shape. `className` / `termName` / `classUri` / `termUri` are
 *  absent entirely — not null, absent. */
const RENAMED = {
  objectClass: "ExperimentTag",
  category: "treatment",
  categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
  value: "tamoxifen",
  valueUri: "http://purl.obolibrary.org/obo/CHEBI_41774",
};

/** The ungrounded row the default response omits — stored since the
 *  original load, `CHARACTERISTIC.ID 39131052`, evidence code IC. */
const UNGROUNDED = {
  objectClass: "ExperimentTag",
  category: "strain",
  categoryUri: null,
  value: "Ascl1CreERT2/Ai14",
  valueUri: null,
};

/** What an older Gemma serves. */
const LEGACY = {
  objectClass: "FactorValue",
  className: "organism part",
  classUri: "http://www.ebi.ac.uk/efo/EFO_0000635",
  termName: "larynx",
  termUri: "http://purl.obolibrary.org/obo/UBERON_0001737",
};

describe("withDatasetAnnotationCompat", () => {
  it("reads the renamed fields — the chips were blank without this", () => {
    const a = withDatasetAnnotationCompat(RENAMED);
    expect(a.className).toBe("treatment");
    expect(a.classUri).toBe("http://www.ebi.ac.uk/efo/EFO_0000727");
    expect(a.termName).toBe("tamoxifen");
    expect(a.termUri).toBe("http://purl.obolibrary.org/obo/CHEBI_41774");
  });

  it("still reads an older Gemma — coalescing is why this is safe to ship", () => {
    const a = withDatasetAnnotationCompat(LEGACY);
    expect(a.className).toBe("organism part");
    expect(a.termName).toBe("larynx");
    expect(a.termUri).toBe("http://purl.obolibrary.org/obo/UBERON_0001737");
  });

  it("keeps an ungrounded row with a null uri rather than dropping it", () => {
    // A null `termUri` is what free text looks like. The chip renders
    // it and `isSelectable` leaves it unclickable, because it is not in
    // the available-annotation tree — no special case needed.
    const a = withDatasetAnnotationCompat(UNGROUNDED);
    expect(a.termName).toBe("Ascl1CreERT2/Ai14");
    expect(a.termUri).toBeNull();
    expect(a.className).toBe("strain");
  });

  it("never yields undefined where the type promises a string", () => {
    const a = withDatasetAnnotationCompat({});
    expect(a).toEqual({
      objectClass: "",
      className: "",
      classUri: null,
      termName: "",
      termUri: null,
    });
  });
});

describe("getDatasetAnnotations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("🛑 asks for free text — the default response omits ungrounded rows", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ data: [RENAMED, UNGROUNDED] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const r = await getDatasetAnnotations(38390);

    expect(seen[0]).toContain("/datasets/38390/annotations");
    expect(seen[0]).toContain("includeFreeText=true");
    // Mapped on the way out, so every consumer keeps reading the names
    // it already reads.
    expect(r.data.map((a) => a.termName)).toEqual([
      "tamoxifen",
      "Ascl1CreERT2/Ai14",
    ]);
  });

  it("an empty response is not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const r = await getDatasetAnnotations(1);
    expect(r.data).toEqual([]);
  });
});
