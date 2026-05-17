// Reducer + helpers for the SearchSettings state model.

import type {
  AnnotationTerm,
  Category,
  Platform,
  SearchSettings,
  Taxon,
} from "@/lib/types";
import { emptySearchSettings } from "@/lib/types";

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

  return base;
}
