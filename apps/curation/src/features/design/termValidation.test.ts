import { describe, expect, it } from "vitest";

import type { ValidateTermsResponse } from "@/api/validateTerms";

import { termKey, type TermRef } from "./collectTerms";
import {
  buildRun,
  markStateFor,
  runIsStale,
  statusEarnsInlineMark,
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

  // 17 of the 120 non-canonical gold rows are `unknown` — gene records
  // and GO/NBO terms the index doesn't carry. Marking them would be 17
  // false alarms, which is how a mark stops being believed.
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
  it("lists non-ok rows worst first, carrying the location", () => {
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
      "unknown",
    ]);
    expect(rows[0].ref?.where).toBe("cell line");
    expect(rows[2].ref?.where).toBe("genotype · subject");
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
