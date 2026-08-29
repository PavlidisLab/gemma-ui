/**
 * The GEO record read from Gemma.
 *
 * Three properties are pinned here because each one, if it broke, would
 * be invisible on screen rather than loud:
 *
 *  1. The sample join is by GSM accession. On a split subseries the
 *     document is the ORIGINAL SERIES record, so `samples[]` carries
 *     samples this dataset does not have — 53 of 500 measured.
 *  2. "Constant across samples" is computed over the INTERSECTION with
 *     this dataset. Over the whole document, a sibling subseries can
 *     suppress a row that is constant here or contribute one that is not.
 *  3. Arrays and `characteristics` stay out of the constant rows: the
 *     row renders a string, and a constant characteristic already has a
 *     surface in the tag block.
 */
import { describe, expect, it } from "vitest";

import {
  constantGeoFields,
  geoFieldLabel,
  geoSampleFor,
  type SourceMetadataDoc,
} from "./sourceMetadata";

const doc: SourceMetadataDoc = {
  accession: "GSE1024",
  samples: [
    {
      accession: "GSM1",
      title: "sample one",
      growth_protocol: "grown in RPMI",
      treatment_protocol: "MOG35-55/CFA",
      source_name: "spleen",
      characteristics: { shRNA: "control", "Units of Amount": "ug" },
      supplementary_files: ["a.CEL", "b.CEL"],
    },
    {
      accession: "GSM2",
      title: "sample two",
      growth_protocol: "grown in RPMI",
      treatment_protocol: "MOG35-55/CFA",
      source_name: "lymph node",
      characteristics: { shRNA: "control", "Units of Amount": "ug" },
      supplementary_files: ["c.CEL"],
    },
    // Belongs to a sibling subseries — present in the GEO series record,
    // absent from this Gemma dataset.
    {
      accession: "GSM99",
      title: "someone else's sample",
      growth_protocol: "grown in DMEM",
      treatment_protocol: "MOG35-55/CFA",
      source_name: "spleen",
    },
  ],
};

const mine = ["GSM1", "GSM2"];

describe("geoSampleFor", () => {
  it("joins on the GSM accession, case-insensitively", () => {
    expect(geoSampleFor(doc, "GSM2")?.title).toBe("sample two");
    expect(geoSampleFor(doc, "gsm2")?.title).toBe("sample two");
  });

  it("returns null for a sample the record does not carry", () => {
    expect(geoSampleFor(doc, "GSM_NOT_HERE")).toBeNull();
    expect(geoSampleFor(doc, "")).toBeNull();
    expect(geoSampleFor(undefined, "GSM1")).toBeNull();
  });
});

describe("constantGeoFields", () => {
  it("keeps a field identical on every sample of THIS dataset", () => {
    const rows = constantGeoFields(doc, mine);
    expect(rows.find((r) => r.key === "growth_protocol")?.text).toBe(
      "grown in RPMI",
    );
  });

  it("drops a field that varies across this dataset's samples", () => {
    const rows = constantGeoFields(doc, mine);
    expect(rows.some((r) => r.key === "source_name")).toBe(false);
  });

  it("🛑 ignores samples outside this dataset — the split-subseries case", () => {
    // GSM99 has a different growth protocol. Counted, it would suppress
    // a row that IS constant here.
    const rows = constantGeoFields(doc, mine);
    expect(rows.some((r) => r.key === "growth_protocol")).toBe(true);

    // And with GSM99 genuinely in the dataset, the row correctly goes.
    const withSibling = constantGeoFields(doc, [...mine, "GSM99"]);
    expect(withSibling.some((r) => r.key === "growth_protocol")).toBe(false);
    // treatment_protocol is constant across all three, so it survives —
    // proving the first assertion is about the join, not about dropping
    // everything once a third sample appears.
    expect(withSibling.some((r) => r.key === "treatment_protocol")).toBe(true);
  });

  it("never offers identity fields as experiment-wide context", () => {
    // `title` differs here anyway; `accession` is unique by definition.
    // Both are excluded by name so a dataset whose samples happen to
    // share a title cannot produce a "title (GEO)" row.
    const sameTitle: SourceMetadataDoc = {
      samples: [
        { accession: "GSM1", title: "identical", description: "identical" },
        { accession: "GSM2", title: "identical", description: "identical" },
      ],
    };
    const keys = constantGeoFields(sameTitle, mine).map((r) => r.key);
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("accession");
    expect(keys).not.toContain("description");
  });

  it("excludes arrays and characteristics", () => {
    const keys = constantGeoFields(doc, mine).map((r) => r.key);
    // `characteristics` is constant on both samples and is still out —
    // it has its own surface, and two names for one fact reads as two.
    expect(keys).not.toContain("characteristics");
    // A constant array would render as a run-together string in a row
    // that types as string.
    expect(keys).not.toContain("supplementary_files");
  });

  it("returns nothing when no sample of this dataset is in the record", () => {
    expect(constantGeoFields(doc, ["GSM_OTHER"])).toEqual([]);
    expect(constantGeoFields(undefined, mine)).toEqual([]);
  });
});

describe("geoFieldLabel", () => {
  it("says whose words these are", () => {
    expect(geoFieldLabel("growth_protocol")).toBe("growth (GEO)");
    expect(geoFieldLabel("data_processing")).toBe("data processing (GEO)");
    expect(geoFieldLabel("instrument_model")).toBe("instrument model (GEO)");
  });
});
