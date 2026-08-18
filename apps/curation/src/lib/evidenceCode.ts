/**
 * GO evidence codes, in words.
 *
 * Gemma stamps the same small vocabulary on two different assertions —
 * a tag (`AnnotationValueObject.evidenceCode`) and a publication link
 * (`PUBLICATION_ASSOCIATION.evidenceCode`) — and the code means the
 * same thing on both: how much anybody actually checked. So it reads
 * the same words on both, from here, rather than each surface keeping
 * its own list and drifting.
 *
 * Promoted out of `TagBar` 2026-08-17, when the publication provenance
 * disc needed the second reader. Unknown codes render verbatim: the
 * vocabulary is Gemma's and it is longer than the part we have copy
 * for, and a code we cannot name is still worth showing.
 */

/** `IIA` — the tell that a provenance was inferred from the import
 *  path rather than verified. Gemma's 2026-08-17 backfill stamped it on
 *  23,066 GEO publication links and said so in their own evidence text;
 *  every GEO link written from then on carries `TAS` instead. Exported
 *  so a caller can single it out without matching a bare string. */
export const INFERRED_IMPORT_CODE = "IIA";

export function evidenceCodeName(code: string | null | undefined): string {
  const c = (code || "").trim().toUpperCase();
  if (!c) return "";
  if (c === "IC") return "Inferred by Curator";
  if (c === INFERRED_IMPORT_CODE) return "Inferred from Imported Annotation (GEO)";
  if (c === "TAS") return "Traceable Author Statement";
  if (c === "IEA") return "Inferred from Electronic Annotation";
  if (c === "IDA") return "Inferred from Direct Assay";
  return c;
}
