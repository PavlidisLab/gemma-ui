/**
 * Clause-label canonicalisation.
 *
 * The case these exist for, measured on GSE44608 / 13506: a faithful
 * re-send of Gemma's OWN stored statement is refused —
 * `CLO_0037209` is stored as "derived from cell" and resolves to
 * "derives from cell". One stale label refuses a commit touching a row
 * the curator never opened, because the whole design travels in one
 * document.
 */
import { describe, expect, it } from "vitest";
import {
  applyCanonicalLabels,
  collectStatementTerms,
} from "./canonicalLabels";
import type { CurationDocument } from "./curationCommit";
import type { TermValidationResult } from "./validateTerms";

const PRED = "http://purl.obolibrary.org/obo/CLO_0037209";
const OBJ = "http://purl.obolibrary.org/obo/CL_0000047";
const SUBJ = "http://purl.obolibrary.org/obo/CLO_0008697";

const doc = (): CurationDocument => ({
  design: {
    factors: {
      items: [
        {
          gemmaId: 27418,
          name: "cell line",
          factorValues: {
            items: [
              {
                gemmaId: 143387,
                freeTextLabel: "R1 cell derived primary passage",
                statements: {
                  items: [
                    {
                      gemmaId: 30165836,
                      subject: { label: "R1 cell", uri: SUBJ },
                      predicate: { label: "derived from cell", uri: PRED },
                      object: { label: "neuronal stem cell", uri: OBJ },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
});

const key = (uri: string, label: string) => JSON.stringify([uri, label]);

const VERDICTS: TermValidationResult[] = [
  {
    id: key(PRED, "derived from cell"),
    status: "label_mismatch",
    canonical_label: "derives from cell",
  },
  {
    id: key(OBJ, "neuronal stem cell"),
    status: "non_canonical",
    canonical_label: "neural stem cell",
  },
  { id: key(SUBJ, "R1 cell"), status: "ok", canonical_label: "R1 cell" },
];

const stmt = (d: CurationDocument) =>
  d.design?.factors?.items?.[0].factorValues?.items?.[0].statements?.items?.[0];

describe("collectStatementTerms", () => {
  it("collects every clause term as a (uri, label) pair", () => {
    const items = collectStatementTerms(doc());
    expect(items.map((i) => i.label).sort()).toEqual([
      "R1 cell",
      "derived from cell",
      "neuronal stem cell",
    ]);
  });

  it("deduplicates a term repeated across statements", () => {
    const d = doc();
    const items = d.design!.factors!.items![0].factorValues!.items!;
    items.push({ ...items[0], gemmaId: 143388 });
    expect(collectStatementTerms(d)).toHaveLength(3);
  });

  it("🛑 does NOT collect a factor name or a factor value's free text", () => {
    // Those are the curator's to write. Only Gemma's stored clause
    // terms are ours to repair.
    const labels = collectStatementTerms(doc()).map((i) => i.label);
    expect(labels).not.toContain("cell line");
    expect(labels).not.toContain("R1 cell derived primary passage");
  });

  it("skips a term missing either half of the pair", () => {
    const d = doc();
    stmt(d)!.object = { label: "no uri here" };
    expect(collectStatementTerms(d).map((i) => i.label)).not.toContain(
      "no uri here",
    );
  });
});

describe("applyCanonicalLabels", () => {
  it("🛑 does NOT rewrite a label_mismatch, even one that looks obvious", () => {
    // `derived from cell` -> `derives from cell` is plainly a verb-form
    // variant, but the classifier cannot tell that from a real concept
    // swap: cab's sweep found `ventromedial hypothalamus` ->
    // `ventromedial nucleus of hypothalamus` under the same verdict.
    // 483 experiments carry this pair and they stay blocked by Gemma's
    // own 400, which is the honest outcome.
    const out = applyCanonicalLabels(doc(), VERDICTS);
    expect(stmt(out)!.predicate!.label).toBe("derived from cell");
  });

  it("🛑 does NOT rewrite an obsolete term", () => {
    // Its "canonical" form is the deprecation notice — auto-rewriting
    // would put "obsolete Tumor-derived cell line" in front of a
    // curator. An obsolete term needs re-terming, not relabelling.
    const d = doc();
    const out = applyCanonicalLabels(d, [
      {
        id: key(OBJ, "neuronal stem cell"),
        status: "obsolete",
        canonical_label: "obsolete Tumor-derived cell line",
      },
    ]);
    expect(out).toBe(d);
  });

  it("rewrites a non_canonical to the preferred form", () => {
    const out = applyCanonicalLabels(doc(), VERDICTS);
    expect(stmt(out)!.object!.label).toBe("neural stem cell");
  });

  it("🛑 leaves an `ok` verdict alone", () => {
    // Gemma's check is case- and whitespace-tolerant, so rewriting
    // these would churn the payload for nothing.
    const out = applyCanonicalLabels(doc(), VERDICTS);
    expect(stmt(out)!.subject!.label).toBe("R1 cell");
  });

  it("never touches the URI, only the label", () => {
    const out = applyCanonicalLabels(doc(), VERDICTS);
    expect(stmt(out)!.predicate!.uri).toBe(PRED);
    expect(stmt(out)!.object!.uri).toBe(OBJ);
  });

  it("returns the document unchanged when nothing needs repair", () => {
    const d = doc();
    const out = applyCanonicalLabels(d, [
      { id: key(PRED, "derived from cell"), status: "ok" },
    ]);
    expect(out).toBe(d);
  });

  it("ignores a verdict carrying no canonical label", () => {
    const d = doc();
    const out = applyCanonicalLabels(d, [
      { id: key(PRED, "derived from cell"), status: "unknown" },
    ]);
    expect(out).toBe(d);
  });

  it("🛑 does NOT rewrite an `unknown`, even with a canonical form offered", () => {
    // The largest single population is `Heterozygous` -> `heterozygous`
    // (292 rows, GENO_0000135) and it arrives as `unknown` — nothing
    // vouches for it, so nothing here acts on it.
    const d = doc();
    const out = applyCanonicalLabels(d, [
      {
        id: key(OBJ, "neuronal stem cell"),
        status: "unknown",
        canonical_label: "neural stem cell",
      },
    ]);
    expect(out).toBe(d);
  });

  it("🛑 keys on the PAIR — the same URI under a different stored label is untouched", () => {
    const d = doc();
    stmt(d)!.predicate = { label: "some other spelling", uri: PRED };
    const out = applyCanonicalLabels(d, VERDICTS);
    expect(stmt(out)!.predicate!.label).toBe("some other spelling");
  });

  it("leaves the rest of the document identical", () => {
    const out = applyCanonicalLabels(doc(), VERDICTS);
    const f = out.design!.factors!.items![0];
    expect(f.name).toBe("cell line");
    expect(f.factorValues!.items![0].freeTextLabel).toBe(
      "R1 cell derived primary passage",
    );
    expect(stmt(out)!.gemmaId).toBe(30165836);
  });
});
