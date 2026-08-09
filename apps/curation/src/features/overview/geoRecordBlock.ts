/**
 * The legacy GEO-record block glued onto ``description``.
 *
 * Older stored designs end with the GEO series record folded into the
 * description verbatim:
 *
 *     === GEO record (series-level, verbatim) ===
 *     Title: …             ← the banner's title
 *     Summary: …           ← usually the description head, above
 *     Overall design: …    ← the design (GEO) row
 *     Organisms: …         ← Subject + assay's taxon
 *     PMIDs: …             ← the Publications card
 *     URL: …               ← the banner's source link
 *
 * Two jobs here: dig the design paragraph back out for the
 * ``design (GEO)`` row when a pack carries no ``overall_design``
 * field, and drop the block from the description's READ view when
 * every line of it is recoverable elsewhere on the page.
 *
 * **The gate is per-label, not per-block.** Checking "does the design
 * paragraph match the row" and then hiding the whole block assumes the
 * other five labels agree with the page, and on real data they often
 * don't: the block's PMID list can be longer than ``publications``, its
 * ``Title:`` can be GEO's rather than Gemma's, its ``Organisms:`` can
 * name two species where the design carries one. Each label is checked
 * against what the page actually shows, and one line we can't place
 * keeps the block whole — hiding it would then be hiding the only copy.
 *
 * (The same distinction decided the agents-side de-fold: of 365 folded
 * rows, 317 were rewritten and 48 refused for exactly these reasons —
 * ``AGENTS_REPLY_2026_08_09_DESCRIPTION_DEFOLD.md``. Those 48 are the
 * only rows this read view still meets, so a block-shaped gate would
 * have been hiding a loss on nearly every row it fired on.)
 */
import { taxonNamesMatch } from "@/lib/taxon";

/** The fold's fixed metadata footer, which follows the design
 *  paragraph. Bounds the paragraph in ``overallDesignFromDescription``. */
const DESCRIPTION_FOOTER_LABELS = ["Organisms", "PMIDs", "URL"] as const;

/** Every label the fold emits. A block containing anything else is one
 *  we don't understand, and an unknown line is never hidden. */
const GEO_RECORD_LABELS = [
  "Title",
  "Summary",
  "Overall design",
  ...DESCRIPTION_FOOTER_LABELS,
] as const;

type GeoRecordLabel = (typeof GEO_RECORD_LABELS)[number];

export const GEO_RECORD_MARKER = /^=+\s*GEO record\b.*$/im;

const labelRe = (label: string) => new RegExp(`^${label}:\\s*(.*)$`, "i");

const normalizeProse = (s: string) =>
  s.replace(/\s+/g, " ").trim().toLowerCase();

/** Legacy fallback for the ``design (GEO)`` row: older stored designs
 *  FOLDED the GEO series overall design into ``description`` as a
 *  ``\n\nOverall design: …`` tail, before it moved to its own
 *  ``overall_design`` field. Pull it back out for those. Returns "" when
 *  no such section is present.
 *
 *  The fold appended a fixed footer AFTER the design paragraph, so
 *  running to end-of-string swept ``Organisms:`` / ``PMIDs:`` / ``URL:``
 *  into the row — the design paragraph with a taxon, a PMID list and a
 *  GEO URL glued on, all three of which the banner already renders. Cut
 *  at the footer.
 *
 *  Bounded by the footer's LITERAL labels, not by a "looks like a
 *  heading" shape: real design prose contains its own ``Label:`` lines,
 *  and a generic rule truncates the paragraph mid-thought. Three
 *  anchors, all confirmed agent-side as design text and not chrome:
 *  GSE188549's design OPENS with ``Bulk RNA Seq:`` (a generic rule
 *  empties the row), GSE270880 carries ``Two conditions: siControl and
 *  TSPO knockdown`` mid-paragraph, and GSE55238's ``Infection protocol:``
 *  line is a SECOND ``!Series_overall_design`` — GEO may emit that field
 *  more than once and MINiML parsing joins the lines, so the label is
 *  the submitter's, inside the design. */
export function overallDesignFromDescription(
  desc: string | null | undefined,
): string {
  if (!desc) return "";
  const m = desc.match(/Overall design:\s*([\s\S]*)$/i);
  if (!m) return "";
  const lines = m[1].split("\n");
  const footer = lines.findIndex((line) =>
    DESCRIPTION_FOOTER_LABELS.some((label) => labelRe(label).test(line.trim())),
  );
  return (footer === -1 ? lines : lines.slice(0, footer)).join("\n").trim();
}

/** What the rest of the page is showing, for the per-label check. */
export interface GeoRecordPageContext {
  /** The text in the ``design (GEO)`` row. */
  overallDesign: string;
  /** The title in the banner. */
  title?: string | null;
  /** The taxon in Subject + assay — common name (``"mouse"``) or
   *  scientific (``"Mus musculus"``); either is compared properly. */
  taxon?: string | null;
  /** PubMed ids in the Publications card. */
  pubmedIds?: readonly string[];
  /** The accession the banner's source link points at. */
  accession?: string | null;
}

interface GeoRecordEntry {
  label: GeoRecordLabel;
  value: string;
}

/** Split the block into ``Label: value`` entries. Continuation lines
 *  (the submitter's own ``Label:`` lines inside a paragraph, wrapped
 *  prose) attach to the entry above. Returns null when the block holds
 *  a line that belongs to no entry — loose prose before any label. */
function parseGeoRecordBlock(block: string): GeoRecordEntry[] | null {
  const entries: GeoRecordEntry[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || GEO_RECORD_MARKER.test(line)) continue;
    const label = GEO_RECORD_LABELS.find((l) => labelRe(l).test(line));
    if (label) {
      entries.push({ label, value: line.match(labelRe(label))?.[1] ?? "" });
      continue;
    }
    const current = entries[entries.length - 1];
    if (!current) return null;
    current.value = `${current.value}\n${line}`.trim();
  }
  return entries;
}

/** Is this one entry's content readable somewhere else on the page? */
function entryIsRecoverable(
  entry: GeoRecordEntry,
  head: string,
  ctx: GeoRecordPageContext,
): boolean {
  const value = entry.value.trim();
  if (!value) return true;
  switch (entry.label) {
    case "Title": {
      // Gemma's title and GEO's are often reworded versions of each
      // other; containment either way is close enough to call it shown.
      // Where they genuinely differ, the GEO title exists only here.
      const shown = normalizeProse(ctx.title ?? "");
      const mine = normalizeProse(value);
      return !!shown && (shown === mine || shown.includes(mine) || mine.includes(shown));
    }
    case "Summary":
      // The description head above the block usually IS this summary.
      // Partly-present doesn't count — that loses the rest.
      return normalizeProse(head).includes(normalizeProse(value));
    case "Overall design":
      return (
        !!ctx.overallDesign &&
        normalizeProse(value) === normalizeProse(ctx.overallDesign)
      );
    case "Organisms":
      // May list several species where the design carries one taxon;
      // every one of them has to be the taxon on the page. The block
      // is then the only record of the second species — GSE19179.1 is
      // a human breast-cancer line titrated into mouse astrocytes,
      // stored as ``taxon: mouse``. When the store grows a
      // series-level ``organisms`` list (agents side has it in the
      // benchmark, and it's proposed for Gemma's SOURCE_METADATA
      // blob), compare against that instead and these strip honestly.
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((organism) => taxonNamesMatch(organism, ctx.taxon));
    case "PMIDs": {
      // The block's list routinely runs longer than Publications — the
      // extra id is then reachable nowhere else on the page.
      const shown = new Set((ctx.pubmedIds ?? []).map((id) => id.trim()));
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((id) => shown.has(id));
    }
    case "URL": {
      // Split sub-series carry a suffixed short name (``GSE25299.2``)
      // while the block's URL addresses the base series GEO actually
      // holds — 9 of the surviving 31. The banner shows the suffixed
      // name, which contains the base, so the link is still reachable.
      // Suffix-stripping is a stand-in for ``base_accession`` /
      // ``is_split_subseries``, which the agents side already carries
      // and has asked Gemma to put on SOURCE_METADATA; read those
      // instead once they reach this design.
      const base = (ctx.accession ?? "").replace(/\.\d+$/, "");
      return !!base && value.includes(base);
    }
  }
}

/** The description as the READ view should show it — the GEO-record
 *  block dropped when every label in it is recoverable elsewhere on the
 *  page, and left alone otherwise. Never used for the editor, which
 *  always opens on the full stored text, so an edit can't silently
 *  rewrite the description. */
export function descriptionWithoutGeoRecordBlock(
  desc: string | null | undefined,
  ctx: GeoRecordPageContext,
): string {
  const text = desc ?? "";
  // Prefer the block marker so the "=== GEO record ===" header and its
  // Title: line go with it; fall back to the bare fold header for rows
  // whose fold carries no marker.
  const marker = text.match(GEO_RECORD_MARKER);
  const cut = marker?.index ?? text.search(/^\s*Overall design:/im);
  if (cut < 0) return text;
  const head = text.slice(0, cut);
  const entries = parseGeoRecordBlock(text.slice(cut));
  if (!entries) return text;
  if (!entries.every((e) => entryIsRecoverable(e, head, ctx))) return text;
  return head.trimEnd();
}
