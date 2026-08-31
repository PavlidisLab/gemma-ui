/**
 * "Our pipeline, or the authors of the study?" — Paul, 2026-08-31, of a
 * single-cell tab showing eleven cell types and no idea where they came
 * from.
 *
 * The answer lives in the assignment's PROTOCOL, which never reaches the
 * wire (a LAZY `@ManyToOne` built outside its transaction), so this
 * reads the display `name` instead. That makes it a stopgap matching on
 * a string nobody promised to keep — which is exactly why the mapping is
 * pinned, and why anything unrecognised must come back `unknown` rather
 * than defaulting to either side.
 *
 * Names are measured on gemma2; the protocol vocabulary is gembro's
 * count over all 949 assignments on prod.
 */
import { describe, expect, it } from "vitest";

import { assignmentOrigin, groundedCount } from "./cellTypeAssignment";

describe("assignmentOrigin", () => {
  it("names ours from the pipeline family", () => {
    // eid 44580, verbatim.
    expect(assignmentOrigin("sc-pipeline-2.0.0-family")).toBe("pipeline");
    // The other protocol versions in the corpus — 151 assignments
    // between them, so the older names must not fall through.
    expect(assignmentOrigin("sc-pipeline-1.1.2")).toBe("pipeline");
    expect(assignmentOrigin("sc-pipeline-2.0.0dev")).toBe("pipeline");
    expect(assignmentOrigin("sc-pipeline-1.2.0")).toBe("pipeline");
  });

  it("names the authors", () => {
    // eid 66278, verbatim. 223 assignments carry the author-submitted
    // protocol over 214 dimensions.
    expect(assignmentOrigin("Author-submitted annotations")).toBe("authors");
  });

  it("🛑 declines to guess rather than defaulting to ours", () => {
    // 10 assignments on prod have no protocol at all, and the name is a
    // display string that can change without notice. A wrong provenance
    // claim is worse than none.
    expect(assignmentOrigin("some future thing")).toBe("unknown");
    expect(assignmentOrigin("")).toBe("unknown");
    expect(assignmentOrigin(null)).toBe("unknown");
    expect(assignmentOrigin(undefined)).toBe("unknown");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(assignmentOrigin("  AUTHOR-SUBMITTED ANNOTATIONS  ")).toBe("authors");
    expect(assignmentOrigin("SC-Pipeline-2.0.0")).toBe("pipeline");
  });
});

describe("groundedCount", () => {
  it("counts terms, not provenance — the two are separate axes", () => {
    // 66278: author-submitted AND entirely ungrounded. 44580: ours AND
    // fully grounded. The correlation is real and is NOT the signal —
    // reading grounding as authorship is the inference this refuses.
    expect(
      groundedCount({
        name: "Author-submitted annotations",
        cell_types: [
          { value: "Astrocytes", value_uri: null },
          { value: "OPCs", value_uri: null },
        ],
      }),
    ).toBe(0);
    expect(
      groundedCount({
        name: "sc-pipeline-2.0.0-family",
        cell_types: [
          { value: "astrocyte", value_uri: "http://purl.obolibrary.org/obo/CL_0000127" },
          { value: "OPCs", value_uri: null },
        ],
      }),
    ).toBe(1);
  });

  it("an assignment with no cell types is zero, not a crash", () => {
    expect(groundedCount({})).toBe(0);
  });
});
