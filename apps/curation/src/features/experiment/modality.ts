import type { Design } from "./types";

/**
 * Strong study-modality classification. Curation rules differ
 * sharply between modalities (single-cell experiments need
 * cell-type tag handling; microarrays don't have a platform-
 * stand-in problem; etc.), so the banner displays this as a
 * primary chip.
 *
 * Detection precedence:
 *
 * 1. ``Design.technology_type`` — Gemma's own classifier
 *    (``ONECOLOR`` / ``TWOCOLOR`` → microarray, ``SEQUENCING``
 *    → some flavour of RNA-seq). This is authoritative for
 *    microarrays. ``SEQUENCING`` doesn't distinguish bulk from
 *    single-cell, so we then fall through to step 2 to refine.
 *
 * 2. ``assay``-category tags on the Design — Gemma's own tag
 *    inference. Useful for separating single-cell from bulk
 *    when ``technology_type == SEQUENCING``.
 *
 * 3. ``Design.assay`` / ``original_platform`` / ``platform``
 *    string regex. Last-resort heuristics for stand-ins like
 *    ``GENELIST`` where steps 1 + 2 didn't pin a modality.
 *
 * Returns ``"unknown"`` when nothing fires — better than guessing
 * wrong. The chip's hint copy explains.
 */
export type Modality =
  | "single-cell"
  | "bulk-rnaseq"
  | "microarray"
  | "unknown";

const SINGLE_CELL_RX =
  /(single[- ]?(cell|nucleus|nuclei)|sc[- ]?rna|sn[- ]?rna|10x\s*genomics|chromium|drop[- ]?seq|smart[- ]?seq|cell\s*ranger|seurat|scanpy)/i;

const RNASEQ_RX =
  /(rna[- ]?seq|sequencing|illumina (hi|next|nova|mi)seq|nextseq|hiseq|novaseq|miseq|genome analyzer|bgi|dnbseq|mgiseq|nanopore|pacbio|ion torrent)/i;

const MICROARRAY_RX =
  /(microarray|affymetrix|affx|agilent|gpl\d|expression beadchip|cytoscan|illumina (?:bead|human|mouse|rat|ref)|humanht|humanref|humanwg|mousewg|mouseref|mouseht|hg[- ]?u\d|mg[- ]?u\d|mu11k|mouse\d{3}|rat\d{3}|moex|mogene|moe430|huex|hugene|hueex|hg[- ]?focus|primeview|clariom)/i;

export function inferModality(design: Design | null | undefined): Modality {
  if (!design) return "unknown";

  // 1. Authoritative classifier from Gemma itself.
  const tt = (design.technology_type || "").trim().toUpperCase();
  if (tt === "ONECOLOR" || tt === "TWOCOLOR" || tt === "DUALMODE")
    return "microarray";
  // SEQUENCING means RNA-seq but doesn't distinguish bulk from
  // single-cell — fall through to tag/text inference below.

  // 2. assay-category tags. Strongest signal for distinguishing
  // single-cell from bulk RNA-seq, and for SEQUENCING/GENELIST
  // experiments that need a more specific call.
  //
  // ``GENELIST`` is Gemma's placeholder when the array_design is
  // a generic stand-in — used **exclusively for sequencing**
  // experiments, never for microarray. So we treat it the same
  // way as SEQUENCING here: refine to single-cell if tags say
  // so, otherwise default to bulk-rnaseq.
  const isSequencingTT = tt === "SEQUENCING" || tt === "GENELIST";
  const tagBlob = (design.tags ?? [])
    .filter((t) => (t.category.label || "").toLowerCase() === "assay")
    .map((t) => t.value.label)
    .join(" ");
  if (tagBlob) {
    if (SINGLE_CELL_RX.test(tagBlob)) return "single-cell";
    if (isSequencingTT) return "bulk-rnaseq";
    if (MICROARRAY_RX.test(tagBlob)) return "microarray";
    if (RNASEQ_RX.test(tagBlob)) return "bulk-rnaseq";
  }

  // 3. Free-text fallback (assay + platform names). Only used
  // when steps 1 + 2 didn't settle it (typically OTHER, or
  // when technology_type is missing entirely).
  const assay = (design.assay || "").trim();
  const original = (design.original_platform || "").trim();
  const platform = (design.platform || "").trim();
  const blob = `${assay} ${original} ${platform}`;

  if (SINGLE_CELL_RX.test(blob)) return "single-cell";
  if (isSequencingTT) return "bulk-rnaseq";
  // Microarray check before generic RNA-seq, because some array
  // platforms include "Illumina" in their name.
  if (MICROARRAY_RX.test(blob)) return "microarray";
  if (RNASEQ_RX.test(blob)) return "bulk-rnaseq";

  return "unknown";
}

/** Display label + a short hover hint for the modality chip. */
export function modalityLabel(m: Modality): { label: string; hint: string } {
  switch (m) {
    case "single-cell":
      return {
        label: "single-cell",
        hint:
          "Single-cell or single-nucleus RNA-seq. Cell-type tags need special handling; design factors apply at the source-sample level, not the cell-type bucket.",
      };
    case "bulk-rnaseq":
      return {
        label: "bulk RNA-seq",
        hint:
          "Bulk RNA sequencing. Gemma often shows a generic array_design as a stand-in; the original_platform names the actual sequencer.",
      };
    case "microarray":
      return {
        label: "microarray",
        hint:
          "Microarray expression. Platform identifies the array model (Affymetrix / Illumina BeadChip / Agilent).",
      };
    default:
      return {
        label: "unknown modality",
        hint:
          "Couldn't classify the assay from tags / platform / assay strings. Verify on Gemma.",
      };
  }
}
