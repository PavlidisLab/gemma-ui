/**
 * Brutalist grid variant — sharp blocks, asymmetric layout.
 *
 * Design intent (v4 — fixed panels + plots popup, 2026-08-21):
 *   - Hero stats row: Datasets, Platforms, Samples, Result sets
 *     (DEA), Ontology terms — each in its own block.
 *   - "What we provide" and "How to access", side by side.
 *   - One row of two panels that hold still: annotation coverage,
 *     and recent activity (the week's counts, then one worked
 *     example). Each block fills progressively as its query
 *     resolves — no whole-page block-on-slowest.
 *   - Everything distributional lives behind "More plots".
 *   - White page. Annotation coverage and recent activity sit on
 *     shaded blocks, not outlines; elsewhere subtle grey dividers and
 *     whitespace. No rounded corners, no shadows.
 *   - Single accent (blue-700) for hover affordances only.
 */

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GENERAL_INFO } from "../copy";
import { useMe, useLogout } from "@/api/auth";
import { getDatasetAnnotations } from "@/api/endpoints";
import { AboutModal } from "@/features/about/AboutModal";
import { SearchBox } from "@/features/shared/SearchBox";
import { gemmaLockup } from "@gemma/assets";
import { isBaselineTerm } from "@/lib/baseline";
// Museum card temporarily hidden 2026-09-15 — see MuseumCard below.
// import { museumUrl } from "@/lib/gemmaConfig";
// import museumArt from "../museum-human-cell-cycle.png";
import { tintForIndex } from "@/lib/valueTint";
import { InfoBadge } from "../panels";
import { MorePlotsModal, GENOTYPE_CATEGORY_URI } from "../MorePlotsModal";
import {
  useGemmaSummary,
  fmtCount,
  cleanExperimentTitle,
  type GemmaSummary,
  type RecentDataset,
} from "../useGemmaSummary";

export function HomeBrutalist() {
  const s = useGemmaSummary();
  const [plotsOpen, setPlotsOpen] = useState(false);
  return (
    <div
      className="h-full overflow-y-auto bg-white text-stone-950"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-px">
        {/* Wordmark + tagline — single block, no inversion */}
        <Masthead />

        {/* Hero search — primary entry point to the corpus. */}
        <div className="px-1 pt-1 pb-2">
          <SearchBox
            variant="hero"
            placeholder="Search data sets by name, accession, topic, or leave blank to browse the collection"
          />
        </div>

        {/* Hero stats — 5 metrics + about column */}
        <StatsRow s={s} />

        {/* General info — what we provide, how to access it, and the
            museum card. */}
        <GeneralInfo />

        {/* One row of two shaded blocks, no outlines: annotation
            coverage (with the "More plots" entry point under it), then
            recent activity across the last two columns. The distribution
            plots live behind "More plots". */}
        <div className={`grid grid-cols-1 md:grid-cols-2 ${THREE_COLUMNS} gap-3 pt-6`}>
          <div className="bg-stone-100 py-4">
            <AnnotationCoverageBreakdown s={s} />
            <button
              type="button"
              onClick={() => setPlotsOpen(true)}
              className="mt-4 mx-5 text-[11px] text-stone-600 hover:text-blue-700 focus:outline-none focus:ring-1 focus:ring-stone-600"
            >
              More plots →
            </button>
          </div>
          <div className="lg:col-span-2 bg-stone-100 py-4">
            <RecentActivityCard
              items={s.recentDatasets}
              updatedThisWeek={s.updatedThisWeek}
              added={s.added}
              updatedSince={s.updatedSince}
            />
          </div>
        </div>

        <MorePlotsModal
          open={plotsOpen}
          onClose={() => setPlotsOpen(false)}
          s={s}
        />

        {/* Surface buttons removed 2026-05-26 — the reviewer: redundant with
            the stat tiles up top. Datasets / Platforms / Genes
            perturbed tiles are now hot links to /browser /
            /platforms / /genes. About lives on the Masthead. */}

        {/* Home-page footer strip removed 2026-05-26 — the shared
            <Footer> now carries the Pavlidis-lab attribution +
            Docs / REST / GitHub quick-links. The snapshot-date
            "stats as of …" hint moved to the (i) tooltips on the
            individual tiles, which is where it was most useful. */}
      </div>
    </div>
  );
}

/** Column template for the shaded-card row: annotation coverage, then
 *  recent activity across the last two tracks.
 *
 *  The info row above used to share it, back when a third card (the
 *  museum) filled the 15rem track — see GeneralInfo. */
const THREE_COLUMNS =
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,15rem)]";

/** Card linking out to the Museum of Gene Expression, with one of its
 *  exhibits in miniature. The image is the canvas art of the exhibit
 *  "The human cell cycle" (key ``whitfield2002``), rendered by the
 *  museum's own drawHeatmap and exported without its frame or dark
 *  margin (2026-09-14).
 *
 *  Temporarily hidden 2026-09-15. To restore: uncomment this function,
 *  the museumUrl / museumArt imports at the top of the file, and the
 *  <MuseumCard /> render in GeneralInfo. */
// function MuseumCard() {
//   return (
//     <a
//       href={museumUrl}
//       target="_blank"
//       rel="noopener noreferrer"
//       className="group block px-5 py-4 hover:no-underline"
//     >
//       <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-stone-900 font-semibold group-hover:text-blue-700">
//         Visit the Museum of Gene Expression
//         <span aria-hidden className="ml-1 font-normal text-stone-500 group-hover:text-blue-700">
//           ↗
//         </span>
//       </div>
//       <img src={museumArt} alt="" className="block w-full h-auto" />
//     </a>
//   );
// }

function StatsRow({ s }: { s: GemmaSummary }) {
  // 5 primary tiles. Samples nests a per-technology breakdown
  // under the headline number (footnote prop) instead of claiming
  // an extra tile for samplesByTech. Perturbed-gene coverage lives
  // in the annotation-coverage breakdown below — surfacing it again here would
  // double-count and the gene-search link this tile used to carry
  // resolved to the general gene search, which was confusing.
  const homeLoading = s.datasets === null && !s.isError;
  const ontologyLoading = s.ontologyTerms === null && !s.isError;

  const samplesFootnote = (() => {
    const t = s.samplesByTech;
    const parts: string[] = [];
    if (t.singleCell !== null && t.singleCell > 0)
      parts.push(`single-cell ${fmtCount(t.singleCell, "compact")}`);
    if (t.rnaSeq !== null && t.rnaSeq > 0)
      parts.push(`RNA-seq ${fmtCount(t.rnaSeq, "compact")}`);
    if (t.microarray !== null && t.microarray > 0)
      parts.push(`microarray ${fmtCount(t.microarray, "compact")}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  // Datasets footnote — the reviewer (2026-05-25): drop the per-source
  // breakdown ("99.9% from GEO anyway, the breakdown isn't
  // informative"). Render just a single "from N distinct
  // accessions" line. That count is NOT what
  // datasetsByAccessionSource sums to (which is the per-source
  // dataset count, same total as datasetCount — see the 1:N split
  // hint). It needs a separate distinctAccessionCount field on
  // /stats/home — filed as a follow-up ask. Until then the
  // footnote stays null and the tile shows just the headline.
  const datasetsFootnote = (() => {
    const n = s.distinctAccessionCount;
    if (n === null || n <= 0) return null;
    return `from ${n.toLocaleString()} distinct accessions`;
  })();

  return (
    <div className="grid grid-cols-2 md:grid-cols-10 md:divide-x md:divide-stone-200">
      <StatBlock
        label="Datasets"
        value={fmtCount(s.datasets, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={datasetsFootnote}
        to="/browser"
        hint="Public expression experiments. Accessions number fewer because Gemma splits a GEO series by platform and by species — one accession can carry up to 20 datasets."
      />
      <StatBlock
        label="Platforms"
        value={fmtCount(s.platforms, "full", homeLoading)}
        cols="md:col-span-2"
        to="/platforms"
        hint="Microarray and sequencing platforms referenced by at least one dataset."
      />
      <StatBlock
        label="Samples"
        value={fmtCount(s.samples, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={samplesFootnote}
        hint="Biomaterials across all public experiments; the footnote splits them by technology."
      />
      <StatBlock
        label="DEA contrasts"
        value={fmtCount(
          s.diffExContrasts ?? s.diffExResultSets,
          "full",
          (s.diffExContrasts ?? s.diffExResultSets) === null && !s.isError,
        )}
        cols="md:col-span-2"
        footnote={
          s.diffExContrasts !== null && s.diffExResultSets !== null
            ? `${fmtCount(s.diffExResultSets, "compact")} result sets`
            : null
        }
        hint="Pairwise differential-expression comparisons (e.g. diseased vs. control). One result set usually carries several."
      />
      <StatBlock
        label="Ontology terms"
        value={fmtCount(s.ontologyTerms, "full", ontologyLoading)}
        cols="md:col-span-2"
        hint="Distinct ontology-backed terms annotating the corpus; free text is excluded."
      />
    </div>
  );
}

function AnnotationCoverageBreakdown({ s }: { s: GemmaSummary }) {
  // Eight URI-bound counts (excludeFreeText=true), rendered as a
  // label/value list matching the taxon + technology breakdowns.
  // Five come from /stats/home byAnnotationCategory (disease /
  // organism_part / cell_type / strain / cell_line); the other three
  // pull from siblings on the same snapshot — drugCount (CHEBI subset
  // of treatment), geneManipulatedCount (perturbed gene URIs), and the
  // pathogen sub-bucket termCount inside treatmentSubcategories.
  const c = s.byCategory;
  const loadingOf = (v: number | null) => v === null && !s.isError;
  const pathogens =
    s.treatmentSubcategories.find((t) => t.key === "pathogen")?.termCount ??
    null;
  // A row with a ``cat`` links into the browser with that category
  // already ticked in the side panel (``?categoryUri=``, the same
  // seeding the factor-value chart uses). These are entry points for
  // a first-time visitor, not filters that reproduce the count beside
  // them — the browser's own facet counts datasets, this table counts
  // distinct terms, and Paul's call (2026-09-07) is that landing
  // somewhere relevant beats landing nowhere.
  //
  // ``catOf`` joins by key to ``categoryDistribution``, which is the
  // only place a category's URI travels — ``byAnnotationCategory``
  // ships snake keys and counts, no URIs.
  const categoryUriByKey = new Map(
    s.categoryDistribution
      .filter((r) => r.key && r.categoryUri)
      .map((r) => [r.key as string, { uri: r.categoryUri as string, label: r.category }]),
  );
  const catOf = (key: string) => categoryUriByKey.get(key);
  type Row = {
    label: string;
    value: number | null;
    hint: string;
    cat?: { uri: string; label: string };
  };
  // Two ordered columns (the design review's grouping): anatomical / model-system
  // terms on the left, disease / exposure / perturbation terms on the
  // right.
  const columns: Row[][] = [
    [
      {
        label: "Tissues",
        cat: catOf("organism_part"),
        value: c.tissues,
        hint: "distinct organism-part terms",
      },
      {
        label: "Cell types",
        cat: catOf("cell_type"),
        value: c.cellTypes,
        hint: "distinct cell-type terms",
      },
      {
        label: "Cell lines",
        cat: catOf("cell_line"),
        value: c.cellLines,
        hint: "distinct cell-line terms",
      },
      {
        label: "Strains",
        cat: catOf("strain"),
        value: c.strains,
        hint: "distinct strain terms",
      },
    ],
    [
      {
        label: "Diseases",
        cat: catOf("disease"),
        value: c.diseases,
        hint: "distinct disease terms",
      },
      {
        label: "Pathogens",
        value: pathogens,
        hint: "distinct pathogen terms — a sub-bucket of Treatment",
      },
      {
        label: "Approved drugs",
        value: s.drugs,
        hint: "distinct drug / chemical terms — a sub-bucket of Treatment",
      },
      {
        label: "Perturbed genes",
        value: s.geneManipulated,
        hint: "distinct genes annotated as perturbation targets",
        // Genotype is where Gemma files a perturbed gene, so it is the
        // category to land in — but it carries no ``byAnnotationCategory``
        // key, so the URI comes from the constant the perturbed-gene
        // chart already uses rather than from the join above.
        cat: { uri: GENOTYPE_CATEGORY_URI, label: "genotype" },
      },
    ],
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        <span className="text-stone-900 font-semibold">Annotation coverage</span>
        <span className="normal-case tracking-normal text-[11px] text-stone-500 text-right">
          distinct ontology terms in use
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 px-5">
        {columns.map((col, ci) => (
          <table key={ci} className="w-full text-sm">
            <tbody>
              {col.map((r) => (
                <tr
                  key={r.label}
                  className="border-t border-stone-200 first:border-t-0"
                >
                  <td className="py-2 text-stone-800">
                    <span className="inline-flex items-center">
                      {r.cat ? (
                        <Link
                          to="/browser"
                          search={{
                            categoryUri: r.cat.uri,
                            categoryLabel: r.cat.label,
                          }}
                          title={`Browse datasets annotated with a ${r.cat.label} term`}
                          className="text-stone-800 hover:text-blue-700 hover:underline"
                        >
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                      <InfoBadge hint={r.hint} />
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-stone-950">
                    {fmtCount(r.value, "full", loadingOf(r.value))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

/** User-facing annotation categories to surface as chips in the
 *  Recently-updated card. Anything not in this set is dropped —
 *  Gemma's annotation surface includes a lot of bookkeeping
 *  category labels that aren't interesting to a public visitor. */
const RECENT_CARD_ANNOTATION_CATEGORIES = new Set([
  "disease",
  "organism part",
  "cell type",
  "treatment",
  "genotype",
  "strain",
  "cell line",
  "developmental stage",
  "biological sex",
]);

function RecentActivityCard({
  items,
  updatedThisWeek,
  added,
  updatedSince,
}: {
  items: RecentDataset[];
  updatedThisWeek: number | null;
  added: GemmaSummary["added"];
  updatedSince: string;
}) {
  // Corpus activity for the week on top — each figure links to the
  // set it counts, not to a general listing — and one recently
  // updated experiment as a worked example below.
  //
  // The example cycles through the top-50 every 5 s. Hover pauses;
  // prefers-reduced-motion locks on item 0. Annotation chips fetched
  // lazily for the current experiment via /datasets/{id}/annotations
  // — React Query caches per id so re-visiting one is free.
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // Once someone works the arrows the rotation stops for good — having
  // the card move on 5 s after a deliberate click is the opposite of
  // what that click asked for.
  const [steered, setSteered] = useState(false);
  const ready = items.length > 0;
  const step = (d: number) => {
    setSteered(true);
    setIdx((i) => (i + d + items.length) % Math.max(1, items.length));
  };

  useEffect(() => {
    if (!ready || paused || steered) return;
    if (typeof window !== "undefined" && window.matchMedia) {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (m.matches) return;
    }
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % items.length),
      5000,
    );
    return () => window.clearInterval(t);
  }, [ready, paused, steered, items.length]);

  const current = ready ? items[idx % items.length] : null;

  const annsQ = useQuery({
    queryKey: ["dataset-annotations", current?.id ?? 0],
    queryFn: ({ signal }) =>
      current
        ? getDatasetAnnotations(current.id, signal)
        : Promise.resolve(null),
    enabled: !!current,
    staleTime: 10 * 60_000,
  });

  const chips = useMemo(() => {
    const rows = annsQ.data?.data ?? [];
    const seen = new Set<string>();
    const out: Array<{ category: string; term: string; uri: string | null }> =
      [];
    for (const a of rows) {
      // The category an annotation is SERVING, which is what Gemma
      // reports per annotation — not what the term is ontologically.
      const cat = (a.className ?? "").trim().toLowerCase();
      if (!RECENT_CARD_ANNOTATION_CATEGORIES.has(cat)) continue;
      const term = (a.termName ?? "").trim();
      if (!term) continue;
      // Baseline / reference levels say nothing about what the study
      // is: every controlled design carries "reference subject role"
      // and "wild type genotype", so they crowded out the terms that
      // actually distinguish one experiment from the next.
      if (isBaselineTerm(term, a.termUri)) continue;
      const key = `${cat}|${term.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category: cat, term, uri: a.termUri ?? null });
      if (out.length >= 5) break;
    }
    return out;
  }, [annsQ.data]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        <span className="text-stone-900 font-semibold">Recent activity</span>
        <Link
          to="/browser"
          search={{ sort: "-lastUpdated" }}
          className="text-stone-600 hover:text-blue-700 hover:no-underline normal-case tracking-normal text-[11px]"
        >
          see all →
        </Link>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-2">
        <WeekStat
          count={updatedThisWeek}
          noun="updated this week"
          to="/browser"
          search={{ sort: "-lastUpdated", updatedSince }}
        />
        {/* Plain text, no link: /datasets can't be filtered on a
            creation date, so there is nothing to send a click to. The
            window is whichever one the server found something in —
            "added since 2025-08-21" today, narrowing to a week on its
            own once loading resumes. */}
        {added ? (
          <WeekStat
            count={added.count}
            noun={`added since ${shortDate(added.since)}`}
          />
        ) : null}
      </div>
      {/* Caption the example. Without it the dataset below reads as
          "the" recently updated dataset rather than one of many. The
          arrows say the rest out loud — the card used to rotate on its
          own with nothing on screen offering a way to steer it. */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-1 text-[10px] uppercase tracking-[0.2em] text-stone-500">
        <span>Recently updated</span>
        {ready ? (
          <span className="flex items-center gap-1">
            <StepButton
              label="Previous dataset"
              onClick={() => step(-1)}
              glyph="←"
            />
            <span className="tabular-nums normal-case tracking-normal text-[10px] text-stone-400 w-[4.5rem] text-center">
              {(idx % items.length) + 1} of {items.length}
            </span>
            <StepButton
              label="Next dataset"
              onClick={() => step(1)}
              glyph="→"
            />
          </span>
        ) : null}
      </div>
      {current ? (
        // Only the title navigates. The whole card used to be one
        // anchor, so the annotation chips and the accession — neither
        // of which goes anywhere — lit up on hover and swallowed any
        // attempt to select the text.
        <div key={current.id} className="px-5 py-3 text-stone-900">
          <Link
            to="/dataset/$id"
            params={{ id: current.shortName }}
            title={`${current.shortName} — ${current.name}`}
            className="block text-xs font-semibold leading-snug line-clamp-2 min-h-[2.4em] text-stone-900 hover:text-blue-700 hover:underline"
          >
            {cleanExperimentTitle(current.name)}
          </Link>
          <div className="mt-1.5 flex flex-wrap content-start gap-1 h-[3.2em] overflow-hidden">
            {chips.map((c) => (
              <Link
                key={`${c.category}-${c.term}`}
                to="/browser"
                search={
                  c.uri
                    ? { annotationUri: c.uri, annotationLabel: c.term }
                    : undefined
                }
                title={`${c.category} — browse experiments annotated with ${c.term}`}
                style={{ backgroundColor: categoryTint(c.category) }}
                className="inline-flex items-center text-[10px] leading-none px-1.5 py-0.5 border border-stone-400 text-stone-800 hover:border-stone-900 hover:no-underline"
              >
                {c.term}
              </Link>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-stone-500 inline-flex items-baseline gap-2">
            <span className="font-mono">{current.shortName}</span>
            {current.taxonName ? (
              <>
                <span className="text-stone-400">·</span>
                <span>{current.taxonName}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 text-stone-500 text-xs italic">loading…</div>
      )}
    </div>
  );
}

/** "22 Aug 2025" — the window label on the added-datasets stat.
 *  Rendered in UTC because the server resolves `since` from the
 *  snapshot's `generatedAt`: read in a western timezone, a
 *  small-hours UTC boundary lands on the previous day and the label
 *  stops naming the window it actually counts. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Stable per-category tint, so the same category is the same colour
 *  on every card and a reader learns the palette rather than re-reading
 *  each chip. Deterministic from the label — the categories that reach
 *  here are a fixed whitelist, so a hash gives every one its own hue
 *  without a hand-maintained colour table to fall out of step. */
function categoryTint(category: string): string | undefined {
  const idx = [...RECENT_CARD_ANNOTATION_CATEGORIES].indexOf(category);
  return tintForIndex(idx);
}

/** Arrow control for stepping the recently-updated card. */
function StepButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="px-1 leading-none text-stone-500 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
    >
      {glyph}
    </button>
  );
}

/** One linked activity figure: the count, then the noun it counts.
 *  Renders a dash while the count is still in flight so the row keeps
 *  its shape instead of popping in. */
function WeekStat({
  count,
  noun,
  to,
  search,
}: {
  count: number | null;
  noun: string;
  /** Omitted when no filter can reproduce the figure — the stat then
   *  renders as plain text rather than as a link that goes nowhere
   *  useful. */
  to?: string;
  search?: Record<string, string>;
}) {
  const body = (
    <>
      <span className="text-lg font-semibold tabular-nums text-stone-950">
        {count === null ? "—" : count.toLocaleString()}
      </span>{" "}
      <span className="text-[11px] text-stone-600">datasets {noun}</span>
    </>
  );
  // A plain inline span, not inline-flex: flex makes the space between
  // the number and its noun a zero-width item, so the two ran together
  // as "1,192datasets added".
  if (count === null || !to) return <span>{body}</span>;
  return (
    <Link
      to={to}
      search={search}
      className="inline-flex items-baseline hover:no-underline group"
    >
      <span className="group-hover:text-blue-700">{body}</span>
      <span className="ml-1 text-[11px] text-stone-400 group-hover:text-blue-700">
        →
      </span>
    </Link>
  );
}

/**
 * Page-level masthead — replaces the standard AppBar on the home
 * route + the old wordmark block (design review: those two duplicated the
 * brand mark on the home view). Layout:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ GEMMA               [visual]            [auth][skin]      │
 *   │ Curated · re-analyzed                                     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Visual area is a placeholder slot — a small decorative grid
 * standing in until design ships the real element.
 */
// Masthead brand: the Gemma lockup, one SVG carrying the mark and the
// outlined wordmark. It replaced a mark plus the word set in the UI face,
// which itself replaced gemma-logo-text.png.
//
// The wordmark, the tagline and the right-side controls all sit on ONE
// baseline, and the browser is what computes it: the row aligns on
// `last baseline`, so nothing here needs to know where the FACE's baseline
// falls.
//
// That much used to be done by hand — a MASTHEAD_LINE_DESCENT ratio
// subtracted as a margin — and it could not be made correct. The share of a
// `leading-none` line box sitting below the baseline is a property of the
// face, not a constant: measured in-browser it is 0.087 for
// system-ui/Segoe UI, 0.152 for Arial, 0.174 for Inter. This app asks for
// `"Inter", ui-sans-serif, system-ui` but ships no @font-face for Inter, so
// which face actually renders depends on what the visitor has installed —
// one hardcoded ratio is wrong for most of them. (The shipped 0.1196 matched
// none of the three, and left the mark 1.5px high on a machine that resolved
// to system-ui.)
//
// The lockup does need a ratio, and this one CAN be made correct, because it
// is a property of the artwork rather than of the visitor's font. An inline
// image's BOTTOM EDGE is what `vertical-align: baseline` puts on the text
// baseline, but the lockup's bottom edge is the bottom of the mark, which
// hangs below the wordmark's own baseline — align on the box and the tagline
// drops. Measured off gemma-lockup.svg: the wordmark baseline sits at
// 840/964 of the lockup height, leaving 0.1286 of it below. Pulling that
// much off the bottom margin lets the box's bottom edge land where the
// wordmark baseline is. Re-measure it if the lockup art is ever re-exported.
//
// The wrapper then pays the overhang back as padding. A negative margin
// shrinks the layout box as well as shifting it, so the mark hung 6.7px into
// whatever came next — it overlapped the top border of the hero search box
// below. The padding restores the row height without moving the baseline,
// which is computed from the last line box and doesn't see it.
//
// `last baseline` (not `baseline`) matters once the tagline wraps: at higher
// zoom the row narrows and the tagline breaks onto 2+ lines. First-baseline
// alignment would pin line 1 and let the rest spill DOWN past the wordmark;
// anchoring the last line keeps the bottom line on the wordmark baseline and
// stacks earlier lines upward.
const MASTHEAD_LOCKUP_HEIGHT = 52;
const MASTHEAD_LOCKUP_BASELINE_DROP = 0.1286;
const MASTHEAD_LOCKUP_OVERHANG =
  MASTHEAD_LOCKUP_HEIGHT * MASTHEAD_LOCKUP_BASELINE_DROP;
// Set inline, not as a utility class: Tailwind 3.4's `align-items` plugin
// takes only its fixed keyword set, so `items-[last_baseline]` emits NO rule
// at all and the row silently falls back to `normal` — which stretches the
// tagline row and parks its text 37px above the wordmark baseline. Browsers
// do support the value; only the utility is missing.
const LAST_BASELINE: React.CSSProperties = { alignItems: "last baseline" };

function Masthead() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    /* `pb-1` is clearance for the mark, which hangs below the wordmark
       baseline the rest of the row aligns on — without it the bottom arc
       lands flush on the border. */
    <div className="border-b border-stone-950 pb-1">
      {/* One shared baseline across the wordmark, the tagline and the
          right-side controls — `last baseline` on this row, resolved by the
          browser from the face that actually rendered. */}
      <div className="flex gap-3 flex-wrap" style={LAST_BASELINE}>
        {/* The lockup. `align-baseline` drops an inline image's bottom edge
            onto the line's baseline; the negative bottom margin pushes the
            box down by the part of the lockup that hangs below its own
            wordmark baseline, so the row aligns on the letters rather than
            on the bottom of the mark. The wrapper's matching padding gives
            that overhang its height back, so it doesn't sit on the row
            below. */}
        <div
          className="whitespace-nowrap"
          style={{ paddingBottom: MASTHEAD_LOCKUP_OVERHANG }}
        >
          <img
            src={gemmaLockup}
            alt="Gemma"
            style={{
              height: MASTHEAD_LOCKUP_HEIGHT,
              marginBottom: -MASTHEAD_LOCKUP_OVERHANG,
            }}
            className="inline-block w-auto align-baseline"
          />
        </div>

        <div
          className="flex-1 min-w-0 flex gap-6 leading-none"
          style={LAST_BASELINE}
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600 leading-none">
            Database of curated and re-analyzed gene expression studies
          </span>

          <div className="flex-1 min-w-0" />

          {/* About + signed-in identity — same baseline as the tagline.
              Signing in is the footer's "Internal" link. */}
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="text-[12px] text-stone-600 hover:text-stone-900 hover:no-underline bg-transparent border-none cursor-pointer p-0"
            >
              About
            </button>
            {user ? (
              <span className="text-[12px] text-stone-600 inline-flex items-baseline gap-2">
                <span className="opacity-70">Signed in as</span>
                <span className="font-medium text-stone-900">
                  {user.userName || user.email || "(signed in)"}
                </span>
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  className="opacity-70 hover:opacity-100 bg-transparent border-none cursor-pointer disabled:cursor-progress p-0"
                >
                  {logout.isPending ? "Signing out…" : "Sign out"}
                </button>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

function GeneralInfo() {
  return (
    // Two equal columns, spanning the full row. This used to carry
    // THREE_COLUMNS so its edges lined up with the shaded-card row
    // below, but the third track held the museum card — hidden
    // 2026-09-15 — and an empty 15rem track is not alignment, it is a
    // hole: it squeezed both columns to ~420px at max-w-6xl while the
    // row below spent the same 15rem on recent activity. The two
    // columns now split it, ~546px each, and "how to access" stops
    // truncating its hints.
    //
    // Restoring <MuseumCard /> means putting ${THREE_COLUMNS} back here
    // so the card gets its track.
    <div className="my-3 grid grid-cols-1 md:grid-cols-2 md:gap-x-3">
      {/* Column 1 — data + analysis catalogue. Two-column
          definition list: bold lead on the left, muted body on
          the right. Bullets dropped — the typography +
          grid alignment carry enough structure on their own. */}
      <InfoColumn title={GENERAL_INFO.provide.title}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm leading-snug">
          {GENERAL_INFO.provide.items.map((item) => (
            <div key={item.lead} className="contents">
              <dt className="font-semibold text-stone-900 whitespace-nowrap">
                {item.lead}
              </dt>
              <dd className="text-stone-600">{item.body}</dd>
            </div>
          ))}
        </dl>
      </InfoColumn>

      {/* Column 2 — access surfaces. Same compact dl pattern
          as Column 1: tag column on the left, link in the
          middle, muted hint on the right. Tight rows, no
          heavy filled chips — outlined tag at the same scale
          as the body text. */}
      <InfoColumn title={GENERAL_INFO.how.title}>
        <ul className="grid grid-cols-[2.5rem_auto_1fr] gap-x-3 gap-y-1 text-sm leading-snug">
          {GENERAL_INFO.how.items.map((item) => {
            const labelEl = (
              <span className="font-semibold text-stone-900 group-hover:text-emerald-700 group-hover:underline">
                {item.label}
              </span>
            );
            return (
              <li key={item.label} className="contents">
                <span
                  aria-hidden="true"
                  className="text-[10px] font-mono font-semibold tracking-wide text-stone-500 self-baseline"
                >
                  {item.tag}
                </span>
                {item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-block"
                  >
                    {labelEl}
                    <span
                      aria-hidden
                      className="ml-0.5 text-[0.85em] opacity-60 font-normal text-stone-500"
                    >
                      ↗
                    </span>
                  </a>
                ) : (
                  <Link to={item.href} className="group inline-block">
                    {labelEl}
                  </Link>
                )}
                <span className="text-stone-500 text-xs self-baseline truncate">
                  {item.hint}
                </span>
              </li>
            );
          })}
        </ul>
      </InfoColumn>

      {/* Museum of Gene Expression card temporarily hidden 2026-09-15.
          Its grid track went with it — see the note on this row. */}
      {/* <MuseumCard /> */}
    </div>
  );
}

function InfoColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-900 font-semibold mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

// AccessTag (the heavy filled black chip) removed 2026-05-25 —
// The reviewer: "ugly, poor use of space". The access column now uses a
// flat 3-column grid with the tag rendered as muted mono text in
// line with the other text. Restore from commit af06461 if a
// chip-style treatment is ever wanted again.

function StatBlock({
  label,
  value,
  cols,
  hint,
  hintAria,
  footnote,
  to,
}: {
  label: string;
  value: string;
  cols: string;
  hint?: React.ReactNode;
  /** Plain-text aria-label when ``hint`` is a node. */
  hintAria?: string;
  /** Tiny muted line under the headline number. Used to nest a
   *  secondary breakdown (e.g. samplesByTech under Samples,
   *  perturbed-genes under Genes) without claiming a new tile. */
  footnote?: React.ReactNode;
  /** Optional in-app navigation target. When set the tile renders
   *  as a Link with a subtle hover affordance (blue underline +
   *  bg-stone-50 on the headline). Non-link tiles stay as
   *  static divs. */
  to?: string;
}) {
  // Reserve min-height for the label + footnote slots so values
  // sit on the same horizontal baseline across the row regardless
  // of whether a particular label wraps to two lines (e.g. "GENES
  // PERTURBED") or whether a tile has a footnote at all. mt-auto
  // on the footnote slot pins it to the bottom of the flex column
  // so empty-footnote tiles match the height of populated ones.
  const baseCls = `${cols} px-5 py-4 flex flex-col`;
  const linkCls = `${baseCls} cursor-pointer transition-colors hover:bg-stone-50 group focus:outline-none focus:ring-1 focus:ring-stone-900`;
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-1 flex items-center min-h-[2.4em]">
        <span>{label}</span>
        {hint ? <InfoBadge hint={hint} ariaLabel={hintAria} /> : null}
      </div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight text-stone-950 group-hover:text-blue-700">
        {value}
        {to ? (
          <span
            aria-hidden="true"
            className="ml-2 text-base text-stone-400 group-hover:text-blue-700"
          >
            →
          </span>
        ) : null}
      </div>
      <div className="mt-auto pt-1 text-[10px] text-stone-500 leading-snug min-h-[2.6em]">
        {footnote ?? null}
      </div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={linkCls + " no-underline hover:no-underline"}>
        {body}
      </Link>
    );
  }
  return <div className={baseCls}>{body}</div>;
}
