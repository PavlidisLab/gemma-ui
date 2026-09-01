import { describe, expect, it } from "vitest";
import { sourceFieldLabel } from "./sourceMetadata";

describe("sourceFieldLabel", () => {
  it("names the provider it was given", () => {
    // Gemma models the origin as `externalSource.database`; CELLxGENE
    // is one of the values that will appear there.
    expect(sourceFieldLabel("growth_protocol", "CELLxGENE")).toBe(
      "growth (CELLxGENE)",
    );
  });

  it("defaults to GEO, which is what the corpus is", () => {
    // All 100 datasets sampled on gemma2 2026-08-31 report GEO. The
    // default is a measurement, not an assumption baked into the text.
    expect(sourceFieldLabel("growth_protocol")).toBe("growth (GEO)");
  });

  it("keeps the key readable and drops the redundant 'protocol'", () => {
    expect(sourceFieldLabel("data_processing")).toBe("data processing (GEO)");
    expect(sourceFieldLabel("extract_protocol")).toBe("extract (GEO)");
  });

  it("🛑 never renders an empty label for a key it cannot prettify", () => {
    // `protocol` alone would strip to "" — the key survives instead, so
    // a row can never appear as a bare "(GEO)".
    expect(sourceFieldLabel("protocol")).toBe("protocol (GEO)");
  });
});
