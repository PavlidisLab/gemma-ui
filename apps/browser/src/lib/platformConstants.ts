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

/** Category URI for the assay annotation — the one that says whether a
 *  dataset is bulk RNA-seq, single-cell, single-nucleus, or an array. */
export const ASSAY_CATEGORY_URI = "http://purl.obolibrary.org/obo/OBI_0000070";

/**
 * What KIND of data a dataset holds, for a reader.
 *
 * 🛑 Not the platform's `technologyType`. Gemma maps sequencing data
 * onto generic gene-list platforms, so a perfectly ordinary RNA-seq
 * dataset reports `GENELIST` — which this file's own
 * `TOP_TECHNOLOGY_TYPES` labels "Other". Telling a reader their
 * bulk RNA-seq experiment is "Other" is worse than saying nothing.
 *
 * The dataset's own `assay` characteristic is the honest answer and is
 * already curated: `bulk RNA-seq assay` (OBI_0003090), single cell
 * (OBI_0002631), single nucleus (OBI_0003109) — the same three URIs
 * `TECH_ADDITIONS` above uses to split the platform selector.
 *
 * Returns null when the dataset carries no assay annotation, so the
 * caller can fall back to the platform's type rather than assert.
 */
export function assayKindLabel(
  characteristics: Array<{ category?: string | null; categoryUri?: string | null; value?: string | null }> | null | undefined,
): string | null {
  for (const c of characteristics ?? []) {
    const isAssay =
      c.categoryUri === ASSAY_CATEGORY_URI ||
      (c.category ?? "").trim().toLowerCase() === "assay";
    if (!isAssay) continue;
    const v = (c.value ?? "").trim();
    if (v) return v;
  }
  return null;
}

/** Friendly name for a raw platform technology type — `SEQUENCING` →
 *  "RNA-Seq". Used only as the fallback when a dataset has no assay
 *  annotation; see `assayKindLabel` for why it is not the first
 *  choice. */
export function technologyTypeLabel(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t) return null;
  for (const [, label, members] of TOP_TECHNOLOGY_TYPES) {
    if (members.includes(t)) return label;
  }
  return null;
}

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

/**
 * The path segment that addresses a platform in our routes.
 *
 * 🛑 Six platform short names contain a forward slash —
 * `HG-U133A/B/Plus_2`, `MG-U74A/B/C`, `HuGene-FL/A/B/C/D`, `G4410A/B`,
 * `RAE230A/B`, `NIA_Mouse_17K_A/B` — carrying 75 datasets between them.
 * A slash cannot ride in a path segment: Apache rejects the encoded
 * form (`AllowEncodedSlashes` defaults off) with a **404** before it
 * proxies, and Tomcat rejects it again with a 400. The 404 reads as "no
 * such platform" rather than "malformed URL", so the break does not
 * announce itself.
 *
 * The numeric id addresses every platform and a well-formed short name
 * stays supported, so prefer the readable form and fall back to the id
 * only when the name cannot survive a path.
 */
export function platformRouteParam(
  p: { id: number; shortName?: string | null } | null | undefined,
): string {
  if (!p) return "";
  const shortName = (p.shortName ?? "").trim();
  return shortName && !/[/?#%]/.test(shortName) ? shortName : String(p.id);
}
