/**
 * The submitter's own text for a sample, separated from the two lines
 * Gemma appends to it on import.
 *
 * `BioAssay.description` arrives shaped like this, consistently across
 * the corpus (sampled on gemma2, 2026-09-16):
 *
 * ```
 *  gfp neg. sorted cells from 3 disected e14.5 cortecies Treatment, type=wait
 * Source GEO sample is GSM135782
 * Last updated (according to GEO): Sep 12 2006
 * ```
 *
 * Only the first part is the submitter's. The other two repeat the
 * accession the row already shows and carry a date worth its own field,
 * so leaving them inline costs two lines of every sample's description
 * and buries the sentence a reader came for.
 *
 * Nothing is discarded — `geoLastUpdated` comes back beside the text
 * and the accession line is the accession, which every caller has.
 */
export interface SampleDescription {
  /** The submitter's text, trimmed. Empty when there is none. */
  text: string;
  /** GEO's own last-updated string, verbatim ("Sep 12 2006"), or null. */
  geoLastUpdated: string | null;
}

const SOURCE_LINE = /^\s*Source\s+GEO\s+sample\s+is\s+\S+\s*$/i;
const UPDATED_LINE = /^\s*Last\s+updated\s*\(according\s+to\s+GEO\)\s*:\s*(.*)$/i;

export function parseSampleDescription(
  raw: string | null | undefined,
): SampleDescription {
  const lines = (raw ?? "").split(/\r?\n/);
  const kept: string[] = [];
  let geoLastUpdated: string | null = null;
  for (const line of lines) {
    const m = line.match(UPDATED_LINE);
    if (m) {
      const v = m[1].trim();
      if (v) geoLastUpdated = v;
      continue;
    }
    if (SOURCE_LINE.test(line)) continue;
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), geoLastUpdated };
}

/**
 * One line of it, for a table cell. Newlines become " · " so a
 * multi-line description still reads as one row rather than collapsing
 * into run-together words.
 */
export function sampleDescriptionOneLine(
  raw: string | null | undefined,
): string {
  return parseSampleDescription(raw)
    .text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" · ");
}
