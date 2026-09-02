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

/** A dataset's platforms, arranged for display. */
export interface PlatformDisplay<P> {
  /** The platforms to LEAD with — what the data was submitted on. */
  primary: P[];
  /** What Gemma switched them onto, or `[]` when nothing was switched
   *  and so there is no mapping to explain. */
  mappedTo: P[];
}

/**
 * Decide which platforms lead and which are the in-house mapping.
 *
 * The submitted platform is the fact about the experiment; the one
 * Gemma quantified onto is plumbing. So GPL24247 (Illumina NovaSeq
 * 6000) leads and `Generic_mouse_ncbiIds` follows, which inverts how
 * Gemma 1.0 orders the same two lines.
 *
 * 🛑 `originals` empty means **nothing was switched**, not "unknown".
 * The server excludes a recorded original that equals the platform in
 * use, so a non-empty answer always names a real change and an empty
 * one means `inUse` already IS the original. Treating empty as "we
 * don't know" would hide the platform on every unswitched dataset.
 */
export function platformDisplay<P>(
  inUse: P[] | null | undefined,
  originals: P[] | null | undefined,
): PlatformDisplay<P> {
  const used = inUse ?? [];
  const orig = originals ?? [];
  return orig.length > 0
    ? { primary: orig, mappedTo: used }
    : { primary: used, mappedTo: [] };
}

/**
 * Does this platform publish an annotation file (the element → gene
 * mapping at `/platforms/{id}/annotations`)?
 *
 * Everything with an element set does; `SEQUENCING` platforms do not,
 * and the route 404s for them — they carry no elements to map
 * (`numberOfElements` is null). Measured across every populated
 * technology type on gemma2 2.9.4 (2026-09-01):
 *
 *   ONECOLOR   GPL96, GPL1355            200
 *   TWOCOLOR   GPL890                    200
 *   DUALMODE   GPL1310                   200
 *   GENELIST   Generic_human_ncbiIds     200
 *   SEQUENCING GPL16791, GPL11154        404
 *
 * A predicate rather than an inline check in the page so the type table
 * above is testable without rendering anything. Unknown / missing type
 * ⇒ true: offering a link that might 404 beats hiding one that works,
 * and `OTHER` has no members in the corpus to measure.
 */
export function platformHasAnnotationFile(
  technologyType: string | null | undefined,
): boolean {
  const t = (technologyType ?? "").trim().toUpperCase();
  if (!t) return true;
  return !RNA_SEQ_TECHNOLOGY_TYPES.includes(t);
}

/**
 * Pick the generic (gene-list) platform out of a set of candidates —
 * the platform whose annotation file stands in for one that has none.
 *
 * A sequencing platform carries no element set, so it publishes no
 * annotation file (`platformHasAnnotationFile` above). What its data is
 * quantified onto does: Gemma switches RNA-seq datasets onto a generic
 * gene-list platform, and that platform's element → gene mapping is the
 * one that applies. So the sequencing platform page links there instead
 * of showing nothing.
 *
 * Feed it either set and it answers the same way:
 *
 *   - the platforms this platform's datasets actually sit on
 *     (`getSwitchedToPlatforms`) — the factual answer, no `taxonId`;
 *   - every generic Gemma publishes (`getGenericPlatforms`) restricted
 *     to `taxonId` — the fallback when the platform has no datasets.
 *
 * 🛑 Do NOT pass `taxonId` alongside the switched-onto set. It would
 * discard the one case the query exists to catch: GPL20797 (*Rattus
 * rattus*) is quantified onto `Generic_rat_ncbiIds` (*Rattus
 * norvegicus*), a different taxon and a perfectly correct answer.
 *
 * Most datasets wins when a taxon has more than one generic — mouse
 * has `Generic_mouse_ncbiIds` (7529 datasets) and
 * `Generic_mouse_ensemblIds` (1) — with the lower id breaking a tie so
 * the pick is stable across renders. Null when nothing qualifies:
 * measured on 2.9.4, 15 sequencing platforms are of taxa with no
 * generic at all, and inventing a link for them would be worse than
 * the sentence that stands in its place.
 */
export interface GenericPlatformCandidate {
  id: number;
  technologyType?: string | null;
  taxon?: { id?: number | null } | null;
  numberOfExpressionExperiments?: number | null;
}

export function pickGenericPlatform<P extends GenericPlatformCandidate>(
  candidates: readonly P[] | null | undefined,
  taxonId?: number | null,
): P | null {
  const eligible = (candidates ?? []).filter((c) => {
    if ((c.technologyType ?? "").trim().toUpperCase() !== "GENELIST") return false;
    return taxonId == null || c.taxon?.id === taxonId;
  });
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) =>
      (b.numberOfExpressionExperiments ?? 0) - (a.numberOfExpressionExperiments ?? 0) ||
      a.id - b.id,
  )[0];
}

/**
 * Which of the three annotation files to serve — the route's `type`
 * parameter. Spellings are the server's own; it rejects anything else
 * with `Unknown annotation file type 'x'. Expected one of: standard,
 * bioProcess, noParents.`
 */
export type PlatformAnnotationFileType = "standard" | "bioProcess" | "noParents";

export interface PlatformAnnotationFileVariant {
  type: PlatformAnnotationFileType;
  label: string;
  /** What the GOTerms column holds — the only column that differs. */
  description: string;
}

/**
 * The three annotation files, widest first.
 *
 * Only the `GOTerms` column differs; every file has the same rows and
 * the same seven columns, so a reader picks purely on how much GO they
 * want. Measured on GPL96 / gemma2 2.9.4 (2026-09-01), all 22283
 * elements, mean GO terms per element:
 *
 *   standard    78.4   20.9 MB   every term, inferred ancestors included
 *   noParents   17.0    5.8 MB   direct annotations only
 *   bioProcess   8.3    3.7 MB   direct annotations, biological process only
 *
 * They nest exactly — bioProcess ⊆ noParents ⊆ standard, checked
 * element-by-element across the whole platform — so "narrower" is the
 * honest way to describe them, not "different".
 */
export const PLATFORM_ANNOTATION_FILE_VARIANTS: readonly PlatformAnnotationFileVariant[] = [
  {
    type: "standard",
    label: "All GO terms",
    description:
      "Every GO term, including the ancestors inferred from each direct annotation.",
  },
  {
    type: "noParents",
    label: "Direct terms only",
    description:
      "Only the terms annotated directly — no inferred ancestors. ~5× smaller.",
  },
  {
    type: "bioProcess",
    label: "Biological process only",
    description:
      "Direct terms from the biological process aspect alone — no molecular function, no cellular component.",
  },
];
