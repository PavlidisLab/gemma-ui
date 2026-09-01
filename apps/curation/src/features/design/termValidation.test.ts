import { describe, expect, it } from "vitest";

import type {
  TermValidationResult,
  ValidateTermsResponse,
} from "@/api/validateTerms";

import { termKey, type TermRef } from "./collectTerms";
import {
  buildRun,
  markStateFor,
  runIsStale,
  rebindTargetFor,
  statusEarnsInlineMark,
  successorFor,
  summaryRows,
  verdictFor,
} from "./termValidation";

const HEK_S = "http://purl.obolibrary.org/obo/EFO_0022515";

function ref(label: string, uri: string, where = "cell line"): TermRef {
  return {
    id: termKey(label, uri),
    label,
    uri,
    origin: "tag",
    where,
  };
}

function response(
  results: ValidateTermsResponse["results"],
  counts?: ValidateTermsResponse["counts"],
): ValidateTermsResponse {
  return { results, counts };
}

describe("termValidation — verdict lookup", () => {
  it("finds a verdict by the (label, uri) pair", () => {
    const r = ref("Hek293F", HEK_S);
    const run = buildRun(
      [r],
      response([
        {
          id: r.id,
          status: "label_mismatch",
          canonical_label: "HEK-293S",
        },
      ]),
    );
    expect(verdictFor(run, "Hek293F", HEK_S)?.status).toBe("label_mismatch");
  });

  // Keying by the pair means an edited label stops matching, so the
  // verdict is correctly no longer claimed about what's on screen.
  // What the chip renders in its place is NOT "nothing" — see
  // ``markStateFor`` and the "an edit must not read as a fix" block.
  it("stops claiming a verdict once the label is edited", () => {
    const r = ref("Hek293F", HEK_S);
    const run = buildRun(
      [r],
      response([{ id: r.id, status: "label_mismatch" }]),
    );
    expect(verdictFor(run, "HEK-293F", HEK_S)).toBeNull();
  });

  it("returns null with no run at all", () => {
    expect(verdictFor(null, "anything", HEK_S)).toBeNull();
  });

  it("returns null for a free-text term with no URI", () => {
    const r = ref("Hek293F", HEK_S);
    const run = buildRun([r], response([{ id: r.id, status: "ok" }]));
    expect(verdictFor(run, "Hek293F", null)).toBeNull();
  });
});

describe("termValidation — which statuses earn an inline mark", () => {
  it("marks label_mismatch", () => {
    expect(statusEarnsInlineMark("label_mismatch")).toBe(true);
  });

  // The index having no entry for a URI is silence, not a finding —
  // `disease` / EFO_0000408 is a Gemma standard category obsoleted
  // upstream, so it lands here while being entirely correct. Marking
  // it is how a mark stops being believed.
  it("does NOT mark unknown — the index not carrying a term is not an error", () => {
    expect(statusEarnsInlineMark("unknown")).toBe(false);
  });

  // Since the agent's label test is membership rather than equality,
  // non_canonical is mostly legitimate synonyms on correct data.
  it("does NOT mark non_canonical inline", () => {
    expect(statusEarnsInlineMark("non_canonical")).toBe(false);
  });

  it("does NOT mark ok", () => {
    expect(statusEarnsInlineMark("ok")).toBe(false);
  });
});

describe("termValidation — summary", () => {
  it("lists reportable rows worst first, carrying the location", () => {
    const a = ref("Hek293F", HEK_S, "cell line");
    const b = ref("OCI-AML3", "CLO:0009853", "cell line");
    const c = ref("Trp53", "ncbi_gene/22059", "genotype · subject");
    const d = ref("B cell", "CL:0000236", "cell type");
    const run = buildRun(
      [a, b, c, d],
      response([
        { id: c.id, status: "unknown" },
        { id: d.id, status: "ok" },
        { id: b.id, status: "non_canonical" },
        { id: a.id, status: "label_mismatch" },
      ]),
    );
    const rows = summaryRows(run);
    expect(rows.map((r) => r.result.status)).toEqual([
      "label_mismatch",
      "non_canonical",
    ]);
    expect(rows[0].ref?.where).toBe("cell line");
    expect(rows[1].ref?.where).toBe("cell line");
  });

  // "This term is dead" outranks "this term is spelled a non-preferred
  // way", and both sit under an outright wrong label.
  it("ranks obsolete between label_mismatch and non_canonical", () => {
    const a = ref("Hek293F", HEK_S, "cell line");
    const b = ref("OCI-AML3", "CLO:0009853", "cell line");
    const c = ref("old staging", "EFO:0000410", "tag");
    const run = buildRun(
      [a, b, c],
      response([
        { id: b.id, status: "non_canonical" },
        { id: c.id, status: "obsolete" },
        { id: a.id, status: "label_mismatch" },
      ]),
    );
    expect(summaryRows(run).map((r) => r.result.status)).toEqual([
      "label_mismatch",
      "obsolete",
      "non_canonical",
    ]);
  });

  // Advisory, not red: the annotation was right when it was made.
  it("does NOT mark obsolete inline", () => {
    expect(statusEarnsInlineMark("obsolete")).toBe(false);
  });

  // A term the index can't name is silence, not a finding. Listing it
  // asks a curator to adjudicate something the panel has no opinion
  // about. The count still shows in the header tally, so nothing is
  // concealed.
  it("does NOT list unknown — a term the index can't name is not a finding", () => {
    const a = ref("Cre recombinase", "http://example.org/not_in_index", "genotype");
    const run = buildRun([a], response([{ id: a.id, status: "unknown" }]));
    expect(summaryRows(run)).toEqual([]);
    expect(run.counts).toEqual({ unknown: 1 });
    expect(run.total).toBe(1);
  });

  it("prefers the server's counts", () => {
    const a = ref("Hek293F", HEK_S);
    const run = buildRun(
      [a],
      response([{ id: a.id, status: "label_mismatch" }], {
        label_mismatch: 1,
        ok: 45,
      }),
    );
    expect(run.counts).toEqual({ label_mismatch: 1, ok: 45 });
  });

  // A clean run has to be distinguishable from a run that never
  // happened, or "no marks" reads as "not checked".
  it("tallies locally when the server omits counts", () => {
    const a = ref("Hek293F", HEK_S);
    const b = ref("B cell", "CL:0000236");
    const run = buildRun(
      [a, b],
      response([
        { id: a.id, status: "ok" },
        { id: b.id, status: "ok" },
      ]),
    );
    expect(run.counts).toEqual({ ok: 2 });
    expect(run.total).toBe(2);
    expect(summaryRows(run)).toEqual([]);
  });
});

// The complaint this came from: a run over GSE74438 reported the
// `disease` tag category as "not checked". EFO_0000408 is
// `obsolete_disease` in current EFO, so the index cannot name it —
// while Gemma goes on using it as the disease category and publishes
// `disease` as its name on /rest/v2/annotations/categories. Suppressing the row
// would only have hidden the symptom; consulting the category list
// answers it.
describe("termValidation — Gemma's category list outranks the index", () => {
  const DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";
  const CATEGORIES = [
    { label: "disease", uri: DISEASE },
    { label: "cell type", uri: "http://www.ebi.ac.uk/efo/EFO_0000324" },
  ];

  it("resolves an unknown category URI to ok, using Gemma's name", () => {
    const a = ref("disease", DISEASE, "disease (category)");
    const run = buildRun(
      [a],
      response([{ id: a.id, status: "unknown" }]),
      CATEGORIES,
    );
    expect(run.byKey.get(a.id)?.status).toBe("ok");
    expect(run.byKey.get(a.id)?.canonical_label).toBe("disease");
    expect(run.counts).toEqual({ ok: 1 });
    expect(summaryRows(run)).toEqual([]);
  });

  // Case and punctuation are formatting, not identity — the same test
  // the agents-side validator applies.
  it("treats a formatting difference as ok, not a mismatch", () => {
    const a = ref("Disease", DISEASE, "disease (category)");
    const run = buildRun(
      [a],
      response([{ id: a.id, status: "unknown" }]),
      CATEGORIES,
    );
    expect(run.byKey.get(a.id)?.status).toBe("ok");
  });

  // The carve-out RESTORES checking to these URIs rather than
  // exempting them: a category URI wearing the wrong name is a real
  // finding, and one the index could not have reported.
  it("reports a label that is not Gemma's name for the category", () => {
    const a = ref("cell line", DISEASE, "cell line (category)");
    const run = buildRun(
      [a],
      response([{ id: a.id, status: "unknown" }]),
      CATEGORIES,
    );
    const rows = summaryRows(run);
    expect(rows.map((r) => r.result.status)).toEqual(["label_mismatch"]);
    // Drives the row's Fix-label button.
    expect(rows[0].result.canonical_label).toBe("disease");
    expect(run.counts).toEqual({ label_mismatch: 1 });
  });

  // Only fills gaps. Over all 28 published categories the index agrees
  // with the list on the 26 it carries, so overriding a verdict the
  // index DID reach buys nothing and could only mask a real mismatch.
  it("never overrides a verdict the index actually reached", () => {
    const a = ref("Hek293F", HEK_S, "cell line");
    const withCat = [...CATEGORIES, { label: "HEK-293S", uri: HEK_S }];
    const run = buildRun(
      [a],
      response([{ id: a.id, status: "label_mismatch" }]),
      withCat,
    );
    expect(run.byKey.get(a.id)?.status).toBe("label_mismatch");
  });

  // Categories not loaded yet (or an offline list) must degrade to the
  // server's verdict, never to a wrong one.
  it("falls back to the server's verdicts with no category list", () => {
    const a = ref("disease", DISEASE, "disease (category)");
    for (const cats of [undefined, null, []]) {
      const run = buildRun(
        [a],
        response([{ id: a.id, status: "unknown" }]),
        cats,
      );
      expect(run.byKey.get(a.id)?.status).toBe("unknown");
      expect(run.counts).toEqual({ unknown: 1 });
    }
  });

  // 🛑 EFO_0000408 is deprecated in EFO AND Gemma's live disease
  // category, both at once. The agents side excludes published
  // categories from `obsolete` itself; this is the client-side half,
  // for categories Gemma publishes that the static table may lag on.
  // Without it the same false alarm returns wearing a new status.
  it("overrides obsolete on a published category, not just unknown", () => {
    const a = ref("disease", DISEASE, "disease (category)");
    const run = buildRun(
      [a],
      response([
        {
          id: a.id,
          status: "obsolete",
          canonical_label: "obsolete_disease",
          replaced_by_uri: "http://purl.obolibrary.org/obo/MONDO_0000001",
          replaced_by_label: "disease",
        },
      ]),
      CATEGORIES,
    );
    expect(run.byKey.get(a.id)?.status).toBe("ok");
    expect(summaryRows(run)).toEqual([]);
    expect(run.counts).toEqual({ ok: 1 });
  });

  // A deprecated term that ISN'T one of Gemma's categories has to come
  // through untouched — that is the whole point of the new verdict.
  it("leaves a non-category obsolete verdict alone", () => {
    const a = ref("old staging", "http://www.ebi.ac.uk/efo/EFO_0000410", "tag");
    const run = buildRun(
      [a],
      response([
        {
          id: a.id,
          status: "obsolete",
          replaced_by_label: "disease staging",
          replaced_by_uri: "http://purl.obolibrary.org/obo/MONDO_0000002",
        },
      ]),
      CATEGORIES,
    );
    expect(run.byKey.get(a.id)?.status).toBe("obsolete");
    expect(summaryRows(run).map((r) => r.result.status)).toEqual(["obsolete"]);
  });

  // A header tally that disagrees with the rows is worse than either.
  it("moves the tally with the override", () => {
    const a = ref("disease", DISEASE, "disease (category)");
    const b = ref("B cell", "CL:0000236", "cell type");
    const run = buildRun(
      [a, b],
      response(
        [
          { id: a.id, status: "unknown" },
          { id: b.id, status: "ok" },
        ],
        { unknown: 1, ok: 1 },
      ),
      CATEGORIES,
    );
    expect(run.counts).toEqual({ ok: 2 });
  });
});

describe("termValidation — an edit must not read as a fix", () => {
  // The whole hazard in one test. Hek293F is marked because
  // EFO_0022515 is actually HEK-293S. The curator retypes the label.
  // Nothing is fixed — the binding still points at the wrong line —
  // so the chip must NOT go quietly clean.
  const original = ref("Hek293F", HEK_S);
  const run = () =>
    buildRun(
      [original],
      response([
        {
          id: original.id,
          status: "label_mismatch",
          canonical_label: "HEK-293S",
        },
      ]),
    );

  it("shows the verdict while the pair is unchanged", () => {
    const s = markStateFor(run(), "Hek293F", HEK_S);
    expect(s?.kind).toBe("verdict");
    expect(s?.kind === "verdict" && s.result.status).toBe("label_mismatch");
  });

  it("goes STALE — not clean — once the label is edited", () => {
    expect(markStateFor(run(), "HEK-293F", HEK_S)).toEqual({ kind: "stale" });
  });

  it("still distinguishes a term that was never checked at all", () => {
    expect(
      markStateFor(run(), "liver", "http://purl.obolibrary.org/obo/UBERON_0002107"),
    ).toBeNull();
  });

  it("run is stale when a term is edited", () => {
    expect(runIsStale(run(), [ref("HEK-293F", HEK_S)])).toBe(true);
  });

  // The per-chip cue can't see these three — the chip has no verdict
  // and no way to know it should have one — so the banner has to.
  it("run is stale when a term is added", () => {
    expect(runIsStale(run(), [original, ref("B cell", "CL:0000236")])).toBe(
      true,
    );
  });

  it("run is stale when a term is deleted", () => {
    expect(runIsStale(run(), [])).toBe(true);
  });

  it("run is stale when the URI is rebound to another term", () => {
    expect(
      runIsStale(run(), [
        ref("Hek293F", "http://purl.obolibrary.org/obo/EFO_0022564"),
      ]),
    ).toBe(true);
  });

  it("run is NOT stale when nothing term-shaped changed", () => {
    expect(runIsStale(run(), [original])).toBe(false);
  });
});

// The Re-bind button and the "no successor recorded" cue are the two
// halves of one statement, so they read the same predicate. If they
// ever derived it separately, a row would eventually show both or
// neither.
describe("rebindTargetFor — one predicate behind the button and the cue", () => {
  const DEPRECATED = "http://www.ebi.ac.uk/efo/EFO_0000410";
  const SUCCESSOR = "http://purl.obolibrary.org/obo/MONDO_0000001";

  function editableRef(): TermRef {
    return {
      ...ref("old staging", DEPRECATED, "tag"),
      locator: { kind: "tag_value", tagId: 7 },
    };
  }

  function obsolete(extra: Partial<TermValidationResult> = {}) {
    return {
      id: "x",
      status: "obsolete" as const,
      replaced_by_label: "disease",
      replaced_by_uri: SUCCESSOR,
      ...extra,
    };
  }

  it("returns the successor when the agent named one and the row is editable", () => {
    expect(rebindTargetFor(obsolete(), editableRef())).toEqual({
      label: "disease",
      uri: SUCCESSOR,
    });
  });

  // Not a hypothetical: TGEMO's 5 deprecated terms declare no successor
  // and neither do 10 of CLO's 64, so this branch renders against a
  // backend that carries replaced_by everywhere it exists.
  it("returns null when the verdict names no successor", () => {
    expect(
      rebindTargetFor(
        obsolete({ replaced_by_label: "", replaced_by_uri: "" }),
        editableRef(),
      ),
    ).toBeNull();
    expect(
      rebindTargetFor(
        obsolete({ replaced_by_label: null, replaced_by_uri: null }),
        editableRef(),
      ),
    ).toBeNull();
    // An older agents build omits the fields entirely.
    expect(
      rebindTargetFor(
        { id: "x", status: "obsolete" },
        editableRef(),
      ),
    ).toBeNull();
  });

  // Sample characteristics come off the Gemma import with no locator,
  // so there is nothing to rewrite even when a successor exists.
  it("returns null for a row that can't be edited here", () => {
    expect(rebindTargetFor(obsolete(), ref("old staging", DEPRECATED))).toBeNull();
    expect(rebindTargetFor(obsolete(), null)).toBeNull();
  });

  // Only a deprecated term has a successor. A label_mismatch carrying
  // stray fields must not grow a Re-bind button.
  it("returns null for every other status", () => {
    for (const status of ["ok", "label_mismatch", "non_canonical", "unknown"] as const) {
      expect(rebindTargetFor(obsolete({ status }), editableRef())).toBeNull();
    }
  });

  // The index path stores successors as CURIEs — `CLO:0000457`,
  // `MONDO:0004947` — in a field named `_uri`. Writing one into a
  // binding stores a URI that resolves nowhere, so the button is off;
  // the row still names the term, because "we can't click it for you"
  // and "the ontology named nobody" are different answers.
  it("shows a CURIE successor but will not write it", () => {
    const curie = obsolete({ replaced_by_uri: "CLO:0000457", replaced_by_label: "immortal cat cell line cell" });
    expect(rebindTargetFor(curie, editableRef())).toBeNull();
    const view = successorFor(curie, editableRef());
    expect(view?.uri).toBe("CLO:0000457");
    expect(view?.writable).toBe(false);
    expect(view?.blocked).toMatch(/CURIE/);
  });

  // A URI with no label would write a term whose stored name says
  // nothing — the exact disagreement this panel reports on.
  it("shows an unlabelled successor but will not write it", () => {
    const unlabelled = obsolete({ replaced_by_label: "" });
    expect(rebindTargetFor(unlabelled, editableRef())).toBeNull();
    const view = successorFor(unlabelled, editableRef());
    expect(view?.uri).toBe(SUCCESSOR);
    expect(view?.writable).toBe(false);
    expect(view?.blocked).toMatch(/name/);
  });

  // No locator: nothing to rewrite from here, so there is no repair to
  // explain either. The row reports the successor and stops.
  it("names the successor on a row it can't edit, without a repair cue", () => {
    const view = successorFor(obsolete(), ref("old staging", DEPRECATED));
    expect(view?.uri).toBe(SUCCESSOR);
    expect(view?.writable).toBe(false);
    expect(view?.blocked).toBeNull();
  });

  // No successor at all stays null, so the panel's "no successor
  // recorded" cue keys off absence and nothing else.
  it("returns null when the ontology declares nobody", () => {
    expect(
      successorFor(obsolete({ replaced_by_uri: "", replaced_by_label: "" }), editableRef()),
    ).toBeNull();
    expect(successorFor({ id: "x", status: "obsolete" }, editableRef())).toBeNull();
  });
});
