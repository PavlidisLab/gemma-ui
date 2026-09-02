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
  normalizeDatasetAnnotation,
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

describe("normalizeDatasetAnnotation", () => {
  it("reads the renamed fields — the chips were blank without this", () => {
    const a = normalizeDatasetAnnotation(RENAMED);
    expect(a.className).toBe("treatment");
    expect(a.classUri).toBe("http://www.ebi.ac.uk/efo/EFO_0000727");
    expect(a.termName).toBe("tamoxifen");
    expect(a.termUri).toBe("http://purl.obolibrary.org/obo/CHEBI_41774");
  });

  it("still reads an older Gemma — coalescing is why this is safe to ship", () => {
    const a = normalizeDatasetAnnotation(LEGACY);
    expect(a.className).toBe("organism part");
    expect(a.termName).toBe("larynx");
    expect(a.termUri).toBe("http://purl.obolibrary.org/obo/UBERON_0001737");
  });

  it("keeps an ungrounded row with a null uri rather than dropping it", () => {
    // A null `termUri` is what free text looks like. The chip renders
    // it and `isSelectable` leaves it unclickable, because it is not in
    // the available-annotation tree — no special case needed.
    const a = normalizeDatasetAnnotation(UNGROUNDED);
    expect(a.termName).toBe("Ascl1CreERT2/Ai14");
    expect(a.termUri).toBeNull();
    expect(a.className).toBe("strain");
  });

  it("never yields undefined where the type promises a string", () => {
    const a = normalizeDatasetAnnotation({});
    expect(a).toEqual({
      statements: [],
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

describe("normalizeDatasetAnnotation — statements", () => {
  it("keeps both of Gemma's numbered pairs, in order", () => {
    // eid 27773's control genotype: the second pair is the ONLY thing
    // distinguishing it from the other tetO-hTDP43∆NLS value.
    const a = normalizeDatasetAnnotation({
      objectClass: "FactorValue",
      category: "genotype",
      value: "tetO-hTDP43\u2206NLS",
      predicate: "has_genotype",
      predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
      object: "Heterozygous",
      objectUri: "http://purl.obolibrary.org/obo/GENO_0000135",
      secondPredicate: "has role",
      secondPredicateUri: "http://purl.obolibrary.org/obo/RO_0000087",
      secondObject: "control",
      secondObjectUri: "http://www.ebi.ac.uk/efo/EFO_0001461",
    });
    expect(a.statements).toHaveLength(2);
    expect(a.statements[0].predicate).toBe("has_genotype");
    expect(a.statements[1].object).toBe("control");
  });

  it("keeps a single pair", () => {
    const a = normalizeDatasetAnnotation({
      objectClass: "FactorValue",
      value: "Tardbp [mouse] TAR DNA binding protein",
      predicate: "has modifier",
      object: "peptide 15",
    });
    expect(a.statements).toEqual([
      {
        predicate: "has modifier",
        predicateUri: null,
        object: "peptide 15",
        objectUri: null,
      },
    ]);
  });

  it("yields no statement for a bare term", () => {
    expect(
      normalizeDatasetAnnotation({ objectClass: "ExperimentTag", value: "x" })
        .statements,
    ).toEqual([]);
  });

  it("keeps an object with no predicate, and a predicate with no object", () => {
    // Half a pair is still something the payload said; dropping it
    // would hide a curator's partial statement.
    expect(
      normalizeDatasetAnnotation({ object: "control" }).statements,
    ).toHaveLength(1);
    expect(
      normalizeDatasetAnnotation({ predicate: "has role" }).statements,
    ).toHaveLength(1);
  });

  it("does not promote the second slot when the first is empty", () => {
    const a = normalizeDatasetAnnotation({
      secondPredicate: "has role",
      secondObject: "control",
    });
    expect(a.statements).toHaveLength(1);
    expect(a.statements[0].predicate).toBe("has role");
  });
});
