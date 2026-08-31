/**
 * The `/rest/v2/datasets` limit cap.
 *
 * Measured on gemma2 `96e7a5d790`, 2026-08-31:
 *   ?ids=9474,5381&limit=200  -> 400 "The provided limit cannot exceed 100."
 *   ?ids=9474,5381&limit=100  -> 200
 * The `ids` list is NOT what is refused — the same 400 comes back with
 * two ids — so a fix that chunks ids would not have helped.
 */
import { describe, expect, it } from "vitest";
import { maxDatasetPageSize, MAX_DATASET_PAGE_SIZE, __test } from "./workflow";

describe("maxDatasetPageSize", () => {
  it("caps remote at Gemma's documented 100", () => {
    expect(maxDatasetPageSize("remote")).toBe(100);
  });

  it("keeps the local store's raised 1000", () => {
    // 🛑 Not a blanket clamp: the store raised its cap on purpose so a
    // typical ticket fits one page. Clamping both modes to 100 would
    // quietly undo that.
    expect(maxDatasetPageSize("local")).toBe(1000);
  });

  it("the two modes genuinely differ — that difference IS the bug", () => {
    expect(MAX_DATASET_PAGE_SIZE.local).toBeGreaterThan(
      MAX_DATASET_PAGE_SIZE.remote,
    );
  });
});

describe("datasetListPath — where an id-scoped list lives", () => {
  const qs = "sort=-lastUpdated&limit=100&offset=0";

  it("🛑 remote puts the ids in the PATH, because Gemma has no ids param", () => {
    // Measured 2026-08-31: `/datasets?ids=9474,5381,27103` answered 100
    // rows of totalElements 23547 — the parameter is dropped, not
    // rejected, so the queue rendered the corpus and looked fine.
    expect(__test.datasetListPath("remote", "9474,5381", qs)).toBe(
      `/rest/v2/datasets/9474%2C5381?${qs}`,
    );
  });

  it("local keeps ?ids= — the store implements it", () => {
    // Not "fixed" for both: clamping the shape to Gemma's would break
    // the backend that actually supports the query parameter.
    expect(__test.datasetListPath("local", "9474,5381", qs)).toBe(
      `/rest/v2/datasets?${qs}`,
    );
  });

  it("an unscoped list is the plain collection in either mode", () => {
    expect(__test.datasetListPath("remote", undefined, qs)).toBe(
      `/rest/v2/datasets?${qs}`,
    );
    expect(__test.datasetListPath("local", undefined, qs)).toBe(
      `/rest/v2/datasets?${qs}`,
    );
  });
});
