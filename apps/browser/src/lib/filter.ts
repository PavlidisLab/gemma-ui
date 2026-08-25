// Ported from src/lib/filter.js. Semantics match the Vue browser
// EXCEPT for one deliberate divergence, documented at
// `annotationClauses` below: a term is now bound to the category it was
// picked from — in both directions, included and excluded — which the
// Vue version could not express. Everything else should still be kept
// in step.
//
// Returns a DNF-shaped filter: outer array = ANDed clauses, each
// inner array = ORed sub-clauses. The API then joins them with
// " and " / " or " on the wire.

import pluralize from "pluralize";
import type { AnnotationTerm, Category, SearchSettings } from "./types";
import { getCategoryId } from "./utils";
import {
  MICROARRAY_TECHNOLOGY_TYPES,
  RNA_SEQ_TECHNOLOGY_TYPES,
} from "./platformConstants";

const MAX_URIS_IN_CLAUSE = 200;

export function capitalizeFirstLetter(str: string): string {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Quote a value for the Gemma filter grammar when it carries anything
 *  `STRING` can't hold. Exported because every filter clause built
 *  anywhere in the app needs it — `elementNameFilter` shipped without
 *  it and 400d on any probe search containing a space. */
export function quoteIfNecessary(s: string): string {
  if (s.match(/[(), "]/) || s.length === 0) {
    // FilterArg.g4: `CHAR_IN_QUOTE: CHAR | [(), ] | '\\"'` — a quote
    // inside a quoted string escapes as \" . This used to substitute a
    // lone backslash for the quote, which still lexes (CHAR admits a
    // bare backslash) and so corrupted the value silently rather than
    // erroring.
    return '"' + s.replaceAll('"', '\\"') + '"';
  }
  return s;
}

export function generateFilter(s: SearchSettings): string[][] {
  const filter: string[][] = [];

  // Taxon
  if (s.taxon.length === 1) {
    filter.push([`taxon.id = ${s.taxon[0].id}`]);
  } else if (s.taxon.length > 0) {
    filter.push([`taxon.id in (${s.taxon.map((t) => t.id).join(",")})`]);
  }

  // Platforms + technology types
  if (s.platforms.length > 0 || s.technologyTypes.length > 0) {
    const platformIds = s.platforms.map((p) => p.id);
    const clause: string[] = [];
    if (s.platforms.length > 0) {
      clause.push(`bioAssays.arrayDesignUsed.id in (${platformIds.join(",")})`);
      clause.push(`bioAssays.originalPlatform.id in (${platformIds.join(",")})`);
    }
    if (s.technologyTypes.length > 0) {
      clause.push(`bioAssays.originalPlatform.technologyType in (${s.technologyTypes.join(",")})`);
      clause.push(`bioAssays.arrayDesignUsed.technologyType in (${s.technologyTypes.join(",")})`);
    }
    filter.push(clause);
  }

  // Categories (whole-category include)
  if (s.categories.length > 0) {
    let categories = s.categories;
    if (categories.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many categories (${categories.length}); retaining first ${MAX_URIS_IN_CLAUSE}.`);
      categories = categories.slice(0, MAX_URIS_IN_CLAUSE);
    }
    for (const c of categories) {
      if (c.classUri) {
        filter.push([`allCharacteristics.categoryUri = ${quoteIfNecessary(c.classUri)}`]);
      } else if (c.className) {
        filter.push([`allCharacteristics.category = ${quoteIfNecessary(c.className)}`]);
      } else {
        console.warn("Selection of the 'Uncategorized' category is not supported");
      }
    }
  }

  // Annotations (per-category)
  if (s.annotations.length > 0) {
    for (const clause of annotationClauses(s.annotations, "any")) {
      filter.push(clause);
    }
  }

  // Negative categories — one clause each, rather than one `none(...)`
  // over a comma-joined list. Identical semantics ("no characteristic
  // whose category is in {A, B}" is "none A" AND "none B") and it makes
  // each exclusion independently removable, which is what lets the
  // facet fetch drop a category's own exclusion when listing that
  // category's terms. See getCategoriesWithChildren.
  if (s.negativeCategories.length > 0) {
    let nc = s.negativeCategories;
    if (nc.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many negative categories (${nc.length}); retaining first ${MAX_URIS_IN_CLAUSE}.`);
      nc = nc.slice(0, MAX_URIS_IN_CLAUSE);
    }
    for (const c of nc) {
      const clause = negativeCategoryClause(c);
      if (clause) filter.push([clause]);
      else console.warn("Exclusion of the 'Uncategorized' category is not supported.");
    }
  }

  // Negative annotations (per-category, same binding as the positive
  // branch — see annotationClauses)
  if (s.negativeAnnotations.length > 0) {
    for (const clause of annotationClauses(s.negativeAnnotations, "none")) {
      filter.push(clause);
    }
  }

  // Safety: refuse to ship monster filters.
  const numberOfClauses = filter.reduce((s2, f2) => s2 + f2.length, 0);
  if (numberOfClauses > 100) {
    console.error(`Too many clauses (${numberOfClauses}) in filter.`);
    return [];
  }
  return filter;
}

/**
 * The clause that excludes an entire category — every term in it, not
 * just the ones a facet response happened to list.
 *
 * Exported because the annotation facet has to be able to identify and
 * drop it: listing the terms under a category you've excluded returns
 * nothing by construction, which collapses the category out of the side
 * panel and leaves no way to un-exclude it. `getCategoriesWithChildren`
 * strips exactly this clause from that category's own children fetch.
 * Matching on the emitted string is why it lives here rather than being
 * reconstructed at the call site.
 *
 * Returns null for an uncategorised entry, which has nothing to name.
 */
export function negativeCategoryClause(c: Category): string | null {
  if (c.classUri) {
    return `none(allCharacteristics.categoryUri = ${quoteIfNecessary(c.classUri)})`;
  }
  if (c.className) {
    return `none(allCharacteristics.category = ${quoteIfNecessary(c.className)})`;
  }
  return null;
}

/**
 * Clauses for one set of annotation selections, grouped by the category
 * each term was picked under, with the value bound to that category
 * INSIDE one characteristic via a quantifier.
 *
 * `mode` is that quantifier: `any` for included terms, `none` for
 * excluded ones. Both directions bind, which is the deliberate
 * divergence from the Vue browser — it carried a FIXME here and emitted
 * the category and the value as two independent clauses, because Gemma
 * REST could not express the conjunction. Two clauses mean "has some
 * characteristic categorised X AND has some characteristic valued Y",
 * which matches a dataset where those are DIFFERENT characteristics:
 * picking Disease › Alzheimer's also matched datasets annotated with
 * Alzheimer's under some other category, as long as they carried any
 * disease annotation at all.
 *
 * Gemma REST gained the quantifier on 2026-08-22. Counts drop slightly
 * and are strictly more correct — Disease › Alzheimer's went 329 → 314.
 * Measured on TNF as a perturbed gene, where the difference is starker:
 * value-only 72, two loose clauses 51, quantified 39.
 *
 * `none` binds for the same reason and, in the negative direction, so
 * that the two are exact complements: on gemma2, 23,547 datasets total,
 * `any(...)` 314, `none(...)` 23,233. Unbound the exclusion removed 411
 * — strictly more than the include added — so ticking and unticking the
 * same side-panel row did not return you to where you started.
 *
 * `all(...)` is rejected by the server over a conjunction (400):
 * "every element satisfies A and B" negates to a disjunction the
 * subquery cannot hold. `any` and `none` are the usable ones.
 *
 * The two modes differ in how a group's URI-valued and free-text halves
 * combine. Included terms OR — a dataset matching either belongs in the
 * results. Excluded terms AND — both have to go, and `none(A) or
 * none(B)` would keep a dataset that carries A as long as it lacks B.
 * Hence `string[][]`: `any` returns one ORed clause per group, `none`
 * returns each sub-clause in its own ANDed slot.
 */
function annotationClauses(
  terms: AnnotationTerm[],
  mode: "any" | "none",
): string[][] {
  const groups = new Map<string, AnnotationTerm[]>();
  for (const a of terms) {
    const k = getCategoryId(a) ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  const noun = mode === "none" ? "excluded annotations" : "annotations";
  const out: string[][] = [];

  for (const [categoryId, items] of groups) {
    const categoryUri = items.find((t) => t.classUri !== null)?.classUri ?? null;
    const categoryName = items.find((t) => t.classUri === null)?.className ?? null;
    const catClause =
      categoryUri !== null
        ? `allCharacteristics.categoryUri = ${quoteIfNecessary(categoryId)}`
        : categoryName !== null
          ? `allCharacteristics.category = ${quoteIfNecessary(categoryId)}`
          : null;
    if (catClause === null) {
      // Uncategorized terms have nothing to bind to; they still filter
      // on value alone. An exclusion still needs its `none(...)` — the
      // quantifier is what makes it negative, the binding is separate.
      console.warn("Selection of the 'Uncategorized' category is not supported.");
    }

    /** Bind one value clause to this group's category, when it has one. */
    const bind = (valueClause: string) =>
      catClause === null
        ? mode === "none"
          ? `none(${valueClause})`
          : valueClause
        : `${mode}(${valueClause} and ${catClause})`;

    let termUris = items.filter((t) => t.termUri !== null).map((t) => t.termUri!) as string[];
    let termNames = items.filter((t) => t.termUri === null).map((t) => t.termName!).filter(Boolean) as string[];

    const f: string[] = [];
    if (termUris.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many ${noun} (${termUris.length}) under ${categoryId}; retaining first ${MAX_URIS_IN_CLAUSE}.`);
      termUris = termUris.slice(0, MAX_URIS_IN_CLAUSE);
    }
    if (termUris.length > 0) {
      f.push(bind(`allCharacteristics.valueUri in (${termUris.map(quoteIfNecessary).join(", ")})`));
    }
    if (termNames.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many ${noun} (${termNames.length}) under ${categoryId}; retaining first ${MAX_URIS_IN_CLAUSE}.`);
      termNames = termNames.slice(0, MAX_URIS_IN_CLAUSE);
    }
    if (termNames.length > 0) {
      f.push(bind(`allCharacteristics.value in (${termNames.map(quoteIfNecessary).join(", ")})`));
    }

    // A group with a category but no usable terms would otherwise push
    // an empty clause, which joins to "" and corrupts the filter string.
    if (f.length === 0) continue;
    if (mode === "none") {
      for (const c of f) out.push([c]);
    } else {
      out.push(f);
    }
  }

  return out;
}

export function generateFilterSummary(s: SearchSettings): string {
  const parts: string[] = [];
  if (s.query) parts.push("query");
  if (s.taxon.length > 0) parts.push("taxa");
  if (s.platforms.length > 0 || s.technologyTypes.length > 0) parts.push("platforms");
  if (
    s.categories.length > 0 ||
    s.annotations.length > 0 ||
    s.negativeAnnotations.length > 0 ||
    s.negativeCategories.length > 0
  ) {
    parts.push("annotations");
  }
  return parts.length > 0 ? "Filters applied: " + parts.join(", ") : "";
}

function formatTerm(uri: string): string {
  return new URL(uri).pathname.split("/").pop()!.replace("_", ":");
}

export function generateFilterDescription(
  s: SearchSettings,
  inferredTermLabelsByCategory: Record<string, Record<string, string>> = {},
): string {
  const filter: Array<{ key: string; value: string | string[] }> = [];

  if (s.query) filter.push({ key: "Query", value: `"${s.query}"` });

  if (s.taxon.length > 0) {
    filter.push({ key: "Taxa", value: s.taxon.map((t) => t.commonName).join(" OR ") });
  }

  if (s.platforms.length > 0 || s.technologyTypes.length > 0) {
    const platformValues = s.platforms.map((p) => p.name ?? String(p.id));
    if (s.technologyTypes && RNA_SEQ_TECHNOLOGY_TYPES.every((t) => s.technologyTypes.includes(t))) {
      platformValues.unshift("RNA-Seq");
    }
    if (s.technologyTypes && MICROARRAY_TECHNOLOGY_TYPES.every((t) => s.technologyTypes.includes(t))) {
      platformValues.unshift("Microarray");
    }
    filter.push({ key: "Platforms", value: platformValues });
  }

  if (s.categories.length > 0) {
    for (const cat of s.categories) {
      if (cat.className) filter.push({ key: pluralize(cat.className), value: "ANY" });
      else if (cat.classUri) filter.push({ key: cat.classUri, value: "ANY" });
      else filter.push({ key: "Uncategorized", value: "ANY" });
    }
  }

  function processGroups(annots: AnnotationTerm[]): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    for (const a of annots) {
      const { classUri, className } = a;
      let key: string;
      if (className) key = capitalizeFirstLetter(pluralize(className));
      else if (classUri) key = formatTerm(classUri);
      else key = "Uncategorized";
      if (!groups[key]) groups[key] = [capitalizeFirstLetter(a.termName ?? "")];
      else groups[key].push(capitalizeFirstLetter(a.termName ?? ""));

      if (
        classUri &&
        inferredTermLabelsByCategory[classUri] &&
        a.termUri &&
        a.termUri in inferredTermLabelsByCategory[classUri]
      ) {
        delete inferredTermLabelsByCategory[classUri][a.termUri];
      }
    }
    for (const classUri in inferredTermLabelsByCategory) {
      const inferred = Object.values(inferredTermLabelsByCategory[classUri]);
      if (!inferred.length) continue;
      const className = annots.find((a) => a.classUri === classUri)?.className ?? null;
      let key: string;
      if (className) key = capitalizeFirstLetter(pluralize(className));
      else if (classUri) key = formatTerm(classUri);
      else key = "Uncategorized";
      const list = groups[key];
      if (!list) continue;
      const maxToDisplay = 6 - list.length;
      if (maxToDisplay > 0) list.push(...inferred.slice(0, maxToDisplay).map(capitalizeFirstLetter));
      if (inferred.length > maxToDisplay) list.push(`${inferred.length - maxToDisplay} more terms...`);
    }
    return groups;
  }

  if (s.annotations.length > 0) {
    const g = processGroups(s.annotations);
    for (const k in g) filter.push({ key: k, value: g[k] });
  }
  if (s.negativeAnnotations.length > 0) {
    const g = processGroups(s.negativeAnnotations);
    for (const k in g) filter.push({ key: "NOT " + k, value: g[k] });
  }
  if (s.negativeCategories.length > 0) {
    for (const cat of s.negativeCategories) {
      if (cat.className) filter.push({ key: "NOT " + pluralize(cat.className), value: "ANY" });
      else if (cat.classUri) filter.push({ key: "NOT " + cat.classUri, value: "ANY" });
      else filter.push({ key: "NOT Uncategorized", value: "ANY" });
    }
  }

  return filter
    .map(({ key, value }) =>
      Array.isArray(value) ? `${key}: ${value.join(" OR ")}` : `${key}: ${value}`,
    )
    .join("\n AND \n");
}

// Re-export for callers that prefer reading from here.
export type { Category, AnnotationTerm };
