import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FvDisplayRow, type FvDisplayLike } from "@gemma/ontology";

/**
 * Statements on one factor value that share a subject render with the
 * subject written once, whether they are one stored statement's pairs
 * or separate stored statements.
 *
 * Fixture: GSE244113 FV 368965 as `/datasets/GSE244113/design` served it
 * on 2026-09-15 — statement 56988465 (dose + duration, two rows) and
 * 56988464 (derives from, one row), all on `protein` (CHEBI_36080).
 */

const termRenderer = ({ label }: { label: string }) => (
  <span data-term="">{label}</span>
);

const CHEBI_PROTEIN = "http://purl.obolibrary.org/obo/CHEBI_36080";
const treatment = { label: "treatment", uri: "http://www.ebi.ac.uk/efo/EFO_0000727" };
const protein = { label: "protein", uri: CHEBI_PROTEIN };

function count(html: string, text: string): number {
  return html.split(`<span data-term="">${text}</span>`).length - 1;
}

describe("FvDisplayRow — shared subjects", () => {
  it("writes the subject once across two stored statements", () => {
    const fv: FvDisplayLike = {
      free_text_label: "",
      statements: [
        { category: treatment, subject: protein, predicate: { label: "delivered at dose" }, object: { label: "500 ng/mL" } },
        { category: treatment, subject: protein, predicate: { label: "delivered for duration" }, object: { label: "20 h" } },
        { category: treatment, subject: protein, predicate: { label: "derives from" }, object: { label: "Gzmb [mouse] granzyme B" } },
      ],
    };
    const html = renderToStaticMarkup(<FvDisplayRow fv={fv} termRenderer={termRenderer} />);
    expect(count(html, "protein")).toBe(1);
    for (const text of ["500 ng/mL", "20 h", "Gzmb [mouse] granzyme B"]) {
      expect(count(html, text)).toBe(1);
    }
  });

  it("writes a non-head subject once when two statements share it", () => {
    const tnf = { label: "TNF", uri: "http://example.org/tnf" };
    const fv: FvDisplayLike = {
      free_text_label: "",
      statements: [
        { category: treatment, subject: protein, predicate: { label: "derives from" }, object: { label: "Gzmb" } },
        { category: treatment, subject: tnf, predicate: { label: "delivered at dose" }, object: { label: "10 ng/mL" } },
        { category: treatment, subject: tnf, predicate: { label: "delivered for duration" }, object: { label: "2 h" } },
      ],
    };
    const html = renderToStaticMarkup(<FvDisplayRow fv={fv} termRenderer={termRenderer} />);
    expect(count(html, "protein")).toBe(1);
    expect(count(html, "TNF")).toBe(1);
  });
});
