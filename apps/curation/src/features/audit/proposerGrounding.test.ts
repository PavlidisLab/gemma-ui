import { describe, expect, it } from "vitest";
import { proposerTermFor, proposerTermsForFactor } from "./proposerGrounding";
import type { AuditReport } from "@/api/auditTypes";

/** The shape sandbox 9001's audit actually carries, snakeified by the
 *  client: evidence.comparison_proposal.factors[].factor_values[]
 *  .statements[].subject. `wild type` is grounded, `Utrn -/-` is not. */
const report = {
  evidence: {
    comparison_proposal: {
      factors: [
        {
          category: { label: "treatment" },
          factor_values: [
            {
              free_text_label: "vehicle",
              statements: [
                {
                  subject: {
                    label: "reference substance role",
                    uri: "http://purl.obolibrary.org/obo/OBI_0000025",
                  },
                },
              ],
            },
          ],
        },
        {
          category: { label: "genotype" },
          factor_values: [
            {
              free_text_label: "wild type",
              statements: [
                {
                  subject: {
                    label: "wild type genotype",
                    uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
                  },
                },
              ],
            },
            {
              free_text_label: "Utrn -/-",
              statements: [{ subject: { label: "mutant genotype", uri: "" } }],
            },
          ],
        },
      ],
    },
  },
} as unknown as AuditReport;

describe("proposerTermsForFactor", () => {
  it("finds the proposer's grounded term for the right factor", () => {
    const m = proposerTermsForFactor(report, "genotype");
    expect(m.get("wild type")).toEqual({
      label: "wild type genotype",
      uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
    });
  });

  it("🛑 skips a proposer row with a label but no URI", () => {
    // `mutant genotype` grounds nothing. Offering it would move free
    // text around while implying it had been resolved.
    expect(proposerTermsForFactor(report, "genotype").has("utrn -/-")).toBe(false);
  });

  it("does not leak terms across factors", () => {
    const m = proposerTermsForFactor(report, "genotype");
    expect(m.has("vehicle")).toBe(false);
    expect(proposerTermsForFactor(report, "treatment").has("wild type")).toBe(false);
  });

  it("matches labels case- and whitespace-insensitively", () => {
    expect(proposerTermsForFactor(report, "  GENOTYPE ").get("wild type")).toBeTruthy();
  });

  it("is empty for an absent proposal rather than throwing", () => {
    expect(proposerTermsForFactor(null, "genotype").size).toBe(0);
    expect(proposerTermsForFactor({} as AuditReport, "genotype").size).toBe(0);
    expect(proposerTermsForFactor(report, "").size).toBe(0);
  });
});

describe("proposerTermFor", () => {
  it("offers the term when the value carries no URI", () => {
    expect(proposerTermFor(report, "genotype", "wild type", [])?.uri).toBe(
      "http://www.ebi.ac.uk/efo/EFO_0005168",
    );
    expect(proposerTermFor(report, "genotype", "wild type", [null, ""])?.uri).toBeTruthy();
  });

  it("🛑 offers nothing when the value is ALREADY grounded", () => {
    // Same URI would be noise; a different one is a disagreement, and
    // that is a different card — not something a one-click adopt
    // should silently settle.
    expect(
      proposerTermFor(report, "genotype", "wild type", [
        "http://www.ebi.ac.uk/efo/EFO_0005168",
      ]),
    ).toBeNull();
    expect(
      proposerTermFor(report, "genotype", "wild type", [
        "http://purl.obolibrary.org/obo/SOMETHING_ELSE",
      ]),
    ).toBeNull();
  });

  it("offers nothing for a value the proposer did not ground", () => {
    expect(proposerTermFor(report, "genotype", "Utrn -/-", [])).toBeNull();
    expect(proposerTermFor(report, "genotype", "not a value", [])).toBeNull();
  });
});
