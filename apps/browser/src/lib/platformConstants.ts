export const MICROARRAY_TECHNOLOGY_TYPES = ["ONECOLOR", "TWOCOLOR", "DUALMODE"];
export const RNA_SEQ_TECHNOLOGY_TYPES = ["SEQUENCING"];
export const OTHER_TECHNOLOGY_TYPES = ["GENELIST", "OTHER"];

export const TECHNOLOGY_TYPES = [
  ...MICROARRAY_TECHNOLOGY_TYPES,
  ...RNA_SEQ_TECHNOLOGY_TYPES,
  ...OTHER_TECHNOLOGY_TYPES,
];

export type TopTechGroup = readonly [id: string, label: string, members: readonly string[]];

export const TOP_TECHNOLOGY_TYPES: TopTechGroup[] = [
  ["RNA_SEQ", "RNA-Seq", RNA_SEQ_TECHNOLOGY_TYPES] as const,
  ["MICROARRAY", "Microarray", MICROARRAY_TECHNOLOGY_TYPES] as const,
  ["OTHER", "Other", OTHER_TECHNOLOGY_TYPES] as const,
];

/**
 * Annotation-driven additions to the technology-type tree.
 * Each entry maps a category-URI → term-URI → { parent: tech-type }.
 * The Vue version uses these to surface single-cell / single-nucleus
 * picks alongside SEQUENCING in the platform selector.
 */
export const TECH_ADDITIONS: Record<string, Record<string, { parent: string }>> = {
  "http://purl.obolibrary.org/obo/OBI_0000070": {
    "http://purl.obolibrary.org/obo/OBI_0003109": { parent: "SEQUENCING" }, // single nucleus
    "http://purl.obolibrary.org/obo/OBI_0002631": { parent: "SEQUENCING" }, // single cell
    "http://purl.obolibrary.org/obo/OBI_0003090": { parent: "SEQUENCING" }, // bulk RNA-seq
  },
};

/**
 * Subgroup labels under a top-level tech type. Each subgroup bundles
 * one or more assay-annotation URIs (from TECH_ADDITIONS) and is shown
 * as a single checkbox row that toggles all of its underlying terms.
 *
 * RNA-Seq splits into "Single-cell / nucleus" (sc + sn) and "Bulk".
 * Microarray and Other have no subgroups — they fall back to listing
 * individual platforms.
 */
export interface TechSubgroup {
  id: string;        // stable key
  label: string;
  termUris: string[];
}

export const TECH_SUBGROUPS: Record<string, TechSubgroup[]> = {
  RNA_SEQ: [
    {
      id: "RNA_SEQ_SC",
      label: "Single-cell / single-nucleus",
      termUris: [
        "http://purl.obolibrary.org/obo/OBI_0002631", // single cell
        "http://purl.obolibrary.org/obo/OBI_0003109", // single nucleus
      ],
    },
    {
      id: "RNA_SEQ_BULK",
      label: "Bulk",
      termUris: [
        "http://purl.obolibrary.org/obo/OBI_0003090", // bulk RNA-seq
      ],
    },
  ],
};
