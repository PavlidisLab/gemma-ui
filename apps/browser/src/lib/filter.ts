// Ported from src/lib/filter.js. Semantics match the Vue browser
// EXCEPT for one deliberate divergence, documented at the annotation
// branch below: a term is now bound to the category it was picked
// from, which the Vue version could not express. Everything else
// should still be kept in step.
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

function quoteIfNecessary(s: string): string {
  if (s.match(/[(), "]/) || s.length === 0) {
    return '"' + s.replaceAll('"', "\\") + '"';
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
    const groups = new Map<string, AnnotationTerm[]>();
    for (const a of s.annotations) {
      const k = getCategoryId(a) ?? "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(a);
    }
    for (const [categoryId, items] of groups) {
      const categoryUri = items.find((t) => t.classUri !== null)?.classUri ?? null;
      const categoryName = items.find((t) => t.classUri === null)?.className ?? null;

      // The category is bound to the value INSIDE one characteristic,
      // via the `any(...)` quantifier.
      //
      // This is the deliberate divergence from the Vue browser, which
      // carried a FIXME here: it emitted the category and the value as
      // two independent clauses because Gemma REST could not express
      // the conjunction. Two clauses mean "has some characteristic
      // categorised X AND has some characteristic valued Y" — which
      // matches a dataset where those are DIFFERENT characteristics.
      // Picking Disease › Alzheimer's also matched datasets annotated
      // with Alzheimer's under some other category, as long as they
      // carried any disease annotation at all.
      //
      // Gemma REST gained the quantifier on 2026-08-22, so the filter
      // now says what the visitor meant. Counts drop slightly and are
      // strictly more correct — Disease › Alzheimer's went 329 → 314
      // when this landed. Measured on TNF as a perturbed gene, where
      // the difference is starker: value-only 72, two loose clauses
      // 51, quantified 39.
      //
      // `all(...)` over a conjunction is rejected by the server (400):
      // negating "every element satisfies A and B" needs a disjunction
      // the subquery can't hold. `any` and `none` are the usable ones,
      // and the negative branches below already use `none`.
      const catClause =
        categoryUri !== null
          ? `allCharacteristics.categoryUri = ${quoteIfNecessary(categoryId)}`
          : categoryName !== null
            ? `allCharacteristics.category = ${quoteIfNecessary(categoryId)}`
            : null;
      if (catClause === null) {
        // Uncategorized terms have nothing to bind to; they still
        // filter on value alone, as before.
        console.warn("Selection of the 'Uncategorized' category is not supported.");
      }

      let termUris = items.filter((t) => t.termUri !== null).map((t) => t.termUri!) as string[];
      let termNames = items.filter((t) => t.termUri === null).map((t) => t.termName!).filter(Boolean) as string[];

      /** Bind one value clause to this group's category, when it has one. */
      const bind = (valueClause: string) =>
        catClause === null ? valueClause : `any(${valueClause} and ${catClause})`;

      const f: string[] = [];
      if (termUris.length > MAX_URIS_IN_CLAUSE) {
        console.warn(`Too many annotations (${termUris.length}) under ${categoryId}; retaining first ${MAX_URIS_IN_CLAUSE}.`);
        termUris = termUris.slice(0, MAX_URIS_IN_CLAUSE);
      }
      if (termUris.length > 0) {
        f.push(bind(`allCharacteristics.valueUri in (${termUris.map(quoteIfNecessary).join(", ")})`));
      }
      if (termNames.length > MAX_URIS_IN_CLAUSE) {
        console.warn(`Too many annotations (${termNames.length}) under ${categoryId}; retaining first ${MAX_URIS_IN_CLAUSE}.`);
        termNames = termNames.slice(0, MAX_URIS_IN_CLAUSE);
      }
      if (termNames.length > 0) {
        f.push(bind(`allCharacteristics.value in (${termNames.map(quoteIfNecessary).join(", ")})`));
      }
      // A group with a category but no terms would previously push an
      // empty clause, which joins to "" and corrupts the filter string.
      if (f.length > 0) filter.push(f);
    }
  }

  // Negative categories
  if (s.negativeCategories.length > 0) {
    let nc = s.negativeCategories;
    if (nc.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many negative categories (${nc.length}); retaining first ${MAX_URIS_IN_CLAUSE}.`);
      nc = nc.slice(0, MAX_URIS_IN_CLAUSE);
    }
    const idCats = nc.filter((c) => c.classUri);
    const nameCats = nc.filter((c) => c.classUri === null).filter((c) => c.className);
    const idString = idCats.map((c) => c.classUri).join(",");
    const nameString = nameCats.map((c) => c.className).join(",");
    if (idString) filter.push([`none(allCharacteristics.categoryUri in (${idString}))`]);
    if (nameString) filter.push([`none(allCharacteristics.category in (${nameString}))`]);
  }

  // Negative annotations
  if (s.negativeAnnotations.length > 0) {
    let na = s.negativeAnnotations;
    if (na.length > MAX_URIS_IN_CLAUSE) {
      console.warn(`Too many negative annotations (${na.length}); retaining first ${MAX_URIS_IN_CLAUSE}.`);
      na = na.slice(0, MAX_URIS_IN_CLAUSE);
    }
    const idA = na.filter((a) => a.termUri);
    const nameA = na.filter((a) => a.termUri === null).filter((a) => a.termName);
    const idString = idA.map((a) => a.termUri).join(",");
    const nameString = nameA.map((a) => a.termName).join(",");
    if (idString) filter.push([`none(allCharacteristics.valueUri in (${idString}))`]);
    if (nameString) filter.push([`none(allCharacteristics.value in (${nameString}))`]);
  }

  // Safety: refuse to ship monster filters.
  const numberOfClauses = filter.reduce((s2, f2) => s2 + f2.length, 0);
  if (numberOfClauses > 100) {
    console.error(`Too many clauses (${numberOfClauses}) in filter.`);
    return [];
  }
  return filter;
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
