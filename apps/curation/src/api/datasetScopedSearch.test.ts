/**
 * Searching inside a ticket's queue.
 *
 * 🛑 The ids-in-path route rejects `query` — measured on gemma2
 * `41f45962c5`, `/datasets/{ids}?query=…` answers
 * `400 Unknown query parameter 'query'`. Every search typed into a
 * ticket's queue in remote mode failed that way and the list went on
 * showing the previous unfiltered page, so it read as "the search does
 * nothing" rather than as an error.
 *
 * The URL shape is the whole fix, so the URL shape is what is pinned.
 */
import { describe, expect, it } from "vitest";

import { __test } from "./workflow";

const { datasetListPath, idScopeFilter } = __test;

describe("idScopeFilter", () => {
  it("expresses an id scope as a filter clause", () => {
    // Verified against a known hit: query=dissecting with
    // `id in (20728,1,2)` returns exactly GSE185024.1.
    expect(idScopeFilter("20728,1,2")).toBe("id in (20728,1,2)");
  });
});

describe("datasetListPath", () => {
  it("keeps the path form when there is no search", () => {
    // It works and it is fast — 500 ids, 0.18 s — so nothing changes
    // for the ordinary ticket page load.
    expect(datasetListPath("remote", "1,2,3", "limit=20")).toBe(
      "/rest/v2/datasets/1%2C2%2C3?limit=20",
    );
  });

  it("🛑 leaves the path form when the caller moved the scope to a filter", () => {
    // The caller passes `undefined` for ids in that case; sending both
    // would put the scope in the path AND reject the query again.
    expect(
      datasetListPath("remote", undefined, "query=dissecting&filter=id+in+%281%29"),
    ).toBe("/rest/v2/datasets?query=dissecting&filter=id+in+%281%29");
  });

  it("local mode never uses the path form — ids ride as a parameter", () => {
    expect(datasetListPath("local", "1,2,3", "ids=1%2C2%2C3&limit=20")).toBe(
      "/rest/v2/datasets?ids=1%2C2%2C3&limit=20",
    );
  });
});
