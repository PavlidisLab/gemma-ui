/**
 * The staleness rule, alone and away from any rendering.
 *
 * 🛑 It fires iff both ANNOTATION versions are present and differ.
 * Nothing else, ever. The rule lives in one function for one reason:
 * the failure it replaced was a second definition of "stale" — the
 * corpus set hash — which moves whenever ANY dataset changes and so
 * reported 499 correct pages as stale for one real edit.
 */
import { describe, expect, it } from "vitest";
import type { Design } from "@/features/experiment/types";

import {
  annotationVersionOf,
  baselineOf,
  currencyOf,
  goldDataVersionOf,
} from "./designVersion";

/** The shape the store serves, snakeified by `api.client`. */
function design(over: Record<string, unknown> = {}): Design {
  return {
    experiment_id: 1658,
    experiment_short_name: "GSE11630",
    factors: [],
    biomaterials: [],
    tags: [],
    gold_data_version: "pg500-ceed814d51df",
    annotation_version: "76a6c5b55d9c",
    baseline: {
      annotation_version: "76a6c5b55d9c",
      source: "sidecar",
      set_name: "pg500-ceed814d51df",
    },
    ...over,
  } as unknown as Design;
}

describe("the one real warning", () => {
  it("fires when this dataset's version differs from the baseline's", () => {
    expect(
      currencyOf(
        design({
          baseline: {
            annotation_version: "2d8ee6b87835",
            source: "sidecar",
            set_name: "pg500-ceed814d51df",
          },
        }),
      ),
    ).toBe("stale");
  });

  it("stays quiet when they match", () => {
    expect(currencyOf(design())).toBe("current");
  });

  it("never fires off the set name, however far the two have drifted", () => {
    // 🛑 The regression. The set hash moves when ANY member changes, so
    // a page keyed on it warns 499 times per real edit.
    expect(
      currencyOf(
        design({
          gold_data_version: "pg500-OLD",
          baseline: {
            annotation_version: "76a6c5b55d9c",
            source: "sidecar",
            set_name: "pg500-ceed814d51df",
          },
        }),
      ),
    ).toBe("current");
  });
});

describe("the three silences, which are not one silence", () => {
  it("a configured baseline that does not list this dataset is an answer, not a warning", () => {
    // 534 stored rows against a 500-member set.
    expect(
      currencyOf(
        design({
          baseline: { annotation_version: null, source: "sidecar", set_name: "pg500-x" },
        }),
      ),
    ).toBe("not-in-set");
  });

  it("no baseline at all makes no claim", () => {
    // Production: there is no curated set to be current against.
    expect(
      currencyOf(
        design({
          baseline: { annotation_version: null, source: "unconfigured", set_name: "" },
        }),
      ),
    ).toBe("unknown");
  });

  it("a broken baseline is unknown, not 'not in the set'", () => {
    for (const source of ["missing", "ambiguous", "unreadable"]) {
      expect(
        currencyOf(
          design({ baseline: { annotation_version: null, source, set_name: "" } }),
        ),
      ).toBe("unknown");
    }
  });

  it("an unstamped row is unknown, never stale", () => {
    // The store's 534 rows carry no annotation_version until the next
    // landing stamps them. An absent version is not a stale one.
    expect(currencyOf(design({ annotation_version: "" }))).toBe("unknown");
  });

  it("a payload predating the whole field set says nothing", () => {
    expect(currencyOf(design({ baseline: undefined }))).toBe("unknown");
    expect(currencyOf(null)).toBe("unknown");
  });
});

describe("reading the fields defensively", () => {
  it("keeps the two version primitives apart", () => {
    const d = design();
    expect(goldDataVersionOf(d)).toBe("pg500-ceed814d51df");
    expect(annotationVersionOf(d)).toBe("76a6c5b55d9c");
    expect(baselineOf(d)?.set_name).toBe("pg500-ceed814d51df");
  });

  it("treats empty strings as absent, because the store defaults to them", () => {
    expect(goldDataVersionOf(design({ gold_data_version: "" }))).toBeNull();
    expect(annotationVersionOf(design({ annotation_version: "" }))).toBeNull();
  });
});
