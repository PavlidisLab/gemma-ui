// Reducer + helpers for the SearchSettings state model.

import type {
  AnnotationTerm,
  Category,
  Platform,
  SearchSettings,
  Taxon,
} from "@/lib/types";
import { emptySearchSettings } from "@/lib/types";
import {
  MICROARRAY_TECHNOLOGY_TYPES,
  RNA_SEQ_TECHNOLOGY_TYPES,
} from "@/lib/platformConstants";

export type SearchAction =
  | { type: "setQuery"; value: string | undefined }
  | { type: "setCurrentQuery"; value: string }
  | { type: "setTaxon"; value: Taxon[] }
  | { type: "setPlatforms"; value: Platform[] }
  | { type: "setTechnologyTypes"; value: string[] }
  | { type: "setAnnotations"; value: AnnotationTerm[] }
  | { type: "setNegativeAnnotations"; value: AnnotationTerm[] }
  | { type: "setCategories"; value: Category[] }
  | { type: "setNegativeCategories"; value: Category[] }
  | { type: "setIgnoreExcludedTerms"; value: boolean }
  | { type: "reset" }
  | { type: "load"; value: SearchSettings };

export function searchReducer(state: SearchSettings, action: SearchAction): SearchSettings {
  switch (action.type) {
    case "setQuery":           return { ...state, query: action.value, currentQuery: action.value ?? "" };
    case "setCurrentQuery":    return { ...state, currentQuery: action.value };
    case "setTaxon":           return { ...state, taxon: action.value };
    case "setPlatforms":       return { ...state, platforms: action.value };
    case "setTechnologyTypes": return { ...state, technologyTypes: action.value };
    case "setAnnotations":     return { ...state, annotations: action.value };
    case "setNegativeAnnotations": return { ...state, negativeAnnotations: action.value };
    case "setCategories":      return { ...state, categories: action.value };
    case "setNegativeCategories": return { ...state, negativeCategories: action.value };
    case "setIgnoreExcludedTerms": return { ...state, ignoreExcludedTerms: action.value };
    case "reset":              return emptySearchSettings();
    case "load":               return action.value;
  }
}

export function makeInitialSettings(params: {
  query?: string;
  initialTaxon?: string;
  preset?: string;
  taxa?: Taxon[];
  /** Whole-category include, seeded from ``?categoryUri=`` — the home
   *  page's factor-value chart links here. Seeded straight into
   *  ``categories`` rather than ANDed on as a loose clause so the side
   *  panel shows it selected and the visitor can clear it the same way
   *  they'd clear a category they picked themselves. */
  categoryUri?: string;
  categoryLabel?: string;
  /** One annotation term to arrive selected (``?annotationUri=``). The
   *  home page's perturbed-gene chart links here. When present the
   *  category scopes this term instead of standing on its own — a
   *  whole-category include would widen the result far past the term
   *  the visitor clicked. */
  annotationUri?: string;
  annotationLabel?: string;
}): SearchSettings {
  const base = emptySearchSettings();
  base.query = params.query;
  base.currentQuery = params.query ?? "";

  if (params.initialTaxon && params.taxa) {
    const lc = params.initialTaxon.toLowerCase();
    const match = params.taxa.find(
      (t) =>
        String(t.id) === params.initialTaxon ||
        t.commonName?.toLowerCase() === lc ||
        t.scientificName?.toLowerCase() === lc,
    );
    if (match) base.taxon = [match];
  }

  // Technology presets. ``scrnaseq`` predates the others (it's a
  // legacy Vue URL); ``rnaseq`` / ``microarray`` were added so the
  // home page's samples-by-technology rows have somewhere to point.
  if (params.preset === "rnaseq") {
    base.technologyTypes = [...RNA_SEQ_TECHNOLOGY_TYPES];
  }

  if (params.preset === "microarray") {
    base.technologyTypes = [...MICROARRAY_TECHNOLOGY_TYPES];
  }

  if (params.preset === "scrnaseq") {
    base.technologyTypes = ["SEQUENCING"];
    // The Vue browser also seeds two technology-annotation platform URIs
    // for scrnaseq — we surface this via annotations rather than mutating
    // platforms here, since they're URIs not numeric platform IDs.
    base.annotations = [
      {
        classUri: "http://purl.obolibrary.org/obo/OBI_0000070",
        className: "assay",
        termUri: "http://purl.obolibrary.org/obo/OBI_0003109",
        termName: "single nucleus RNA sequencing assay",
      },
      {
        classUri: "http://purl.obolibrary.org/obo/OBI_0000070",
        className: "assay",
        termUri: "http://purl.obolibrary.org/obo/OBI_0002631",
        termName: "single cell RNA sequencing assay",
      },
    ];
  }

  if (params.annotationUri) {
    base.annotations = [
      ...base.annotations,
      {
        classUri: params.categoryUri ?? null,
        className: params.categoryLabel ?? null,
        termUri: params.annotationUri,
        termName: params.annotationLabel ?? null,
      },
    ];
  } else if (params.categoryUri) {
    base.categories = [
      { classUri: params.categoryUri, className: params.categoryLabel ?? null },
    ];
  }

  return base;
}
