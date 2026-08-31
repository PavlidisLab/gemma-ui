// Gemma commit b5c6747f68 (merged, not yet deployed — prod is currently
// 5328441870) renames className→category, classUri→categoryUri,
// termName→value, termUri→valueUri on every annotation-shaped response,
// with no server-side alias. These tests pin the coalescing in
// endpoints.ts that lets the app read either spelling — see the
// `@deprecated` tags on the old fields in lib/types.ts.
import { describe, expect, it } from "vitest";
import {
  withAnnotationTermCompat,
  withCategoryCompat,
  withDatasetAnnotationCompat,
} from "./endpoints";
import type { AnnotationTerm, Category, DatasetAnnotation } from "@/lib/types";

describe("withCategoryCompat", () => {
  it("passes a pre-rename row through unchanged", () => {
    const raw: Category = { classUri: "http://x/disease", className: "disease" };
    expect(withCategoryCompat(raw)).toEqual({
      classUri: "http://x/disease",
      className: "disease",
    });
  });

  it("coalesces a post-rename row onto the old field names", () => {
    const raw: Category = {
      classUri: null,
      className: null,
      categoryUri: "http://x/disease",
      category: "disease",
    };
    const got = withCategoryCompat(raw);
    expect(got.classUri).toBe("http://x/disease");
    expect(got.className).toBe("disease");
  });

  it("prefers the new spelling when a row somehow carries both", () => {
    const raw: Category = {
      classUri: "http://x/old",
      className: "old-name",
      categoryUri: "http://x/new",
      category: "new-name",
    };
    const got = withCategoryCompat(raw);
    expect(got.classUri).toBe("http://x/new");
    expect(got.className).toBe("new-name");
  });
});

describe("withAnnotationTermCompat", () => {
  it("coalesces a post-rename row onto the old field names", () => {
    const raw: AnnotationTerm = {
      classUri: null,
      className: null,
      termUri: null,
      termName: null,
      categoryUri: "http://x/disease",
      category: "disease",
      valueUri: "http://x/alzheimer",
      value: "Alzheimer disease",
    };
    const got = withAnnotationTermCompat(raw);
    expect(got.classUri).toBe("http://x/disease");
    expect(got.className).toBe("disease");
    expect(got.termUri).toBe("http://x/alzheimer");
    expect(got.termName).toBe("Alzheimer disease");
  });

  it("recurses into children", () => {
    const raw: AnnotationTerm = {
      classUri: null,
      className: null,
      termUri: null,
      termName: null,
      category: "disease",
      children: [
        { classUri: null, className: null, termUri: null, termName: null, value: "child term" },
      ],
    };
    const got = withAnnotationTermCompat(raw);
    expect(got.children?.[0].termName).toBe("child term");
  });
});

describe("withDatasetAnnotationCompat", () => {
  const base = { objectClass: "FactorValue" as const };

  it("pre-rename and post-rename rows for the same term coalesce to the same result", () => {
    const preRename: DatasetAnnotation = {
      ...base,
      className: "disease",
      classUri: "http://x/disease",
      termName: "Alzheimer disease",
      termUri: "http://x/alzheimer",
    };
    // A post-rename server doesn't send className/classUri/termName/
    // termUri at all; "" / null here stand in for that absence (the
    // app type keeps className/termName required — see its
    // `@deprecated` comment in lib/types.ts — so there's no literal
    // `undefined` to write). `category`/`value` being present and
    // non-null is what makes them win regardless.
    const postRename: DatasetAnnotation = {
      ...base,
      className: "",
      classUri: null,
      termName: "",
      termUri: null,
      category: "disease",
      categoryUri: "http://x/disease",
      value: "Alzheimer disease",
      valueUri: "http://x/alzheimer",
    };
    // Compare only the old-named fields — everything downstream reads
    // those, regardless of which spelling the row's own server sent.
    const oldFields = (a: DatasetAnnotation) => ({
      className: a.className,
      classUri: a.classUri,
      termName: a.termName,
      termUri: a.termUri,
    });
    expect(oldFields(withDatasetAnnotationCompat(preRename))).toEqual(
      oldFields(withDatasetAnnotationCompat(postRename)),
    );
  });
});
