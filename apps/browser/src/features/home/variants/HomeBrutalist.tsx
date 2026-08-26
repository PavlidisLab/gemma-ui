/**
 * Brutalist grid variant — sharp blocks, asymmetric layout.
 *
 * Design intent (v4 — fixed panels + plots popup, 2026-08-21):
 *   - Hero stats row: Datasets, Platforms, Samples, Result sets
 *     (DEA), Ontology terms — each in its own block.
 *   - "What Gemma is / provide / how to access", collapsible.
 *   - One row of two panels that hold still: annotation coverage,
 *     and recent activity (the week's counts, then one worked
 *     example). Each block fills progressively as its query
 *     resolves — no whole-page block-on-slowest.
 *   - Everything distributional lives behind "More plots".
 *   - Hard 1px borders, no rounded corners, no shadows.
 *   - Single accent (blue-700) for hover affordances only.
 */

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GENERAL_INFO } from "../copy";
import { useMe, useLogout } from "@/api/auth";
import { getDatasetAnnotations } from "@/api/endpoints";
import {
  LoginModal,
  SIGN_IN_BUTTON_COLOR,
} from "@/features/shared/LoginModal";
import { AboutModal } from "@/features/about/AboutModal";
import { SearchBox } from "@/features/shared/SearchBox";
import { gemmaMarkAmber, ubcLogo } from "@gemma/assets";
import { isBaselineTerm } from "@/lib/baseline";
import { tintForIndex } from "@/lib/valueTint";
import { InfoBadge, Panel } from "../panels";
import { MorePlotsModal } from "../MorePlotsModal";
import {
  useGemmaSummary,
  fmtCount,
  cleanExperimentTitle,
  type GemmaSummary,
  type RecentDataset,
} from "../useGemmaSummary";

export function HomeBrutalist() {
  const s = useGemmaSummary();
  // General-info section starts expanded on first load (per design review);
  // power users can fold it away once they know what Gemma is.
  const [infoOpen, setInfoOpen] = useState(true);
  const [plotsOpen, setPlotsOpen] = useState(false);
  return (
    <div
      className="h-full overflow-y-auto bg-stone-100 text-stone-950"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-px">
        {/* Wordmark + tagline — single block, no inversion */}
        <Masthead />

        {/* Hero search — primary entry point to the corpus. */}
        <div className="px-1 pt-1 pb-2">
          <SearchBox
            variant="hero"
            placeholder="Search datasets — by name, accession, or gene…"
          />
        </div>

        {/* Hero stats — 5 metrics + about column */}
        <StatsRow s={s} />

        {/* General info — three columns. Collapsible so curators /
            API users can fold it away and focus on the breakdowns
            and charts below. */}
        <GeneralInfo open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} />

        {/* Two fixed panels, one row: annotation coverage on the left,
            the recent-activity panel on the right. This replaced a
            pair of auto-rotating carousels — two showcases cycling
            beside each other meant nothing on the row held still long
            enough to read. The distribution plots they used to hide
            now live behind "More plots", where they can be looked at
            deliberately. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
          <Panel>
            <AnnotationCoverageBreakdown s={s} />
          </Panel>
          <Panel>
            <RecentActivityCard
              items={s.recentDatasets}
              updatedThisWeek={s.updatedThisWeek}
              added={s.added}
              updatedSince={s.updatedSince}
            />
          </Panel>
        </div>

        <button
          type="button"
          onClick={() => setPlotsOpen(true)}
          className="w-full border border-stone-950 border-t-0 bg-stone-100 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-stone-600 hover:bg-stone-200 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
        >
          More plots →
        </button>
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
    <div className="grid grid-cols-2 md:grid-cols-10 gap-px bg-stone-950">
      <StatBlock
        label="Datasets"
        value={fmtCount(s.datasets, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={datasetsFootnote}
        to="/browser"
        hint="Public expression experiments in Gemma. The footnote shows the number of distinct external accessions behind the corpus — slightly smaller than the dataset count because Gemma sometimes splits one GEO submission into two experiments when the submission actually contains two distinct studies. Almost all are from GEO (the per-source breakdown isn't shown because it's ≈99.9% GEO)."
      />
      <StatBlock
        label="Platforms"
        value={fmtCount(s.platforms, "full", homeLoading)}
        cols="md:col-span-2"
        to="/platforms"
        hint="Distinct microarray + sequencing platforms (array designs) referenced by at least one dataset."
      />
      <StatBlock
        label="Samples"
        value={fmtCount(s.samples, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={samplesFootnote}
        hint="Total biomaterials across all public experiments. Footnote splits samples by the technology that produced them (single-cell vs. bulk RNA-seq vs. microarray)."
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
        hint="Differential-expression contrasts Gemma has computed across all public datasets. Each contrast is one pairwise comparison (e.g. 'diseased vs. control'); a single result set typically carries several contrasts (one per factor-value pair). Footnote shows the result-set count for orientation."
      />
      <StatBlock
        label="Ontology terms"
        value={fmtCount(s.ontologyTerms, "full", ontologyLoading)}
        cols="md:col-span-2"
        hint="Distinct ontology-backed terms used to annotate the corpus. Free-text variants (un-resolved strings) are excluded."
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
  type Row = { label: string; value: number | null; hint: string };
  // Two ordered columns (the design review's grouping): anatomical / model-system
  // terms on the left, disease / exposure / perturbation terms on the
  // right.
  const columns: Row[][] = [
    [
      {
        label: "Tissues",
        value: c.tissues,
        hint: "distinct organism-part terms (typically UBERON)",
      },
      {
        label: "Cell types",
        value: c.cellTypes,
        hint: "distinct cell-type terms (typically Cell Ontology / CL)",
      },
      {
        label: "Cell lines",
        value: c.cellLines,
        hint: "distinct cell-line ontology terms (CLO)",
      },
      {
        label: "Strains",
        value: c.strains,
        hint: "distinct strain ontology terms (common in mouse studies)",
      },
    ],
    [
      {
        label: "Diseases",
        value: c.diseases,
        hint: "distinct disease ontology terms used to annotate experiments",
      },
      {
        label: "Pathogens",
        value: pathogens,
        hint: "Distinct NCBITaxon pathogen annotations (viruses, bacteria, parasites) used in infection / immune-response studies — a sub-bucket of the broader Treatment category.",
      },
      {
        label: "Approved drugs",
        value: s.drugs,
        hint: "Distinct CHEBI-anchored drug / chemical annotations. Narrower than the full Treatment category (which also includes pathogens, biologics, and other exposures).",
      },
      {
        label: "Perturbed genes",
        value: s.geneManipulated,
        hint: "Distinct gene URIs annotated as perturbation targets across the corpus — knockouts, knockdowns, overexpression.",
      },
    ],
  ];
  return (
    <div className="bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        Annotation coverage · distinct ontology terms in use
      </div>
      <div className="grid grid-cols-2 gap-px bg-stone-300">
        {columns.map((col, ci) => (
          <table key={ci} className="w-full text-sm bg-stone-100">
            <tbody>
              {col.map((r) => (
                <tr
                  key={r.label}
                  className="border-t border-stone-200 first:border-t-0"
                >
                  <td className="px-4 py-2 text-stone-800">
                    <span className="inline-flex items-center">
                      {r.label}
                      <InfoBadge hint={r.hint} />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-stone-950">
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
      current ? getDatasetAnnotations(current.id, signal) : Promise.resolve(null),
    enabled: !!current,
    staleTime: 10 * 60_000,
  });

  const chips = useMemo(() => {
    const rows = annsQ.data?.data ?? [];
    const seen = new Set<string>();
    const out: Array<{ category: string; term: string; uri: string | null }> = [];
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
      className="bg-stone-100"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300">
        <span className="text-stone-900 font-semibold">Recent activity</span>
        <Link
          to="/browser"
          search={{ sort: "-lastUpdated" }}
          className="text-stone-600 hover:text-blue-700 hover:no-underline normal-case tracking-normal text-[11px]"
        >
          see all →
        </Link>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3 border-b border-stone-300">
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
      <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-stone-500">
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
        <div className="px-5 py-4 text-stone-500 text-xs italic">
          loading…
        </div>
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
// Masthead brand: the mark plus the word set in type. It replaced
// gemma-logo-text.png, which baked mark and wordmark into one raster.
//
// The wordmark, the tagline and the right-side controls all sit on ONE
// baseline, and the browser is what computes it: the row aligns on
// `last baseline`, so nothing here needs to know where the baseline falls.
//
// This used to be done by hand — a MASTHEAD_LINE_DESCENT ratio subtracted as
// a margin — and it could not be made correct. The share of a `leading-none`
// line box sitting below the baseline is a property of the FACE, not a
// constant: measured in-browser it is 0.087 for system-ui/Segoe UI, 0.152 for
// Arial, 0.174 for Inter. This app asks for `"Inter", ui-sans-serif,
// system-ui` but ships no @font-face for Inter, so which face actually
// renders depends on what the visitor has installed — one hardcoded ratio is
// wrong for most of them. (The shipped 0.1196 matched none of the three, and
// left the mark 1.5px high on a machine that resolved to system-ui.)
//
// The mark needs no ratio either: it is an inline replaced box, and
// `vertical-align: baseline` puts an inline image's BOTTOM EDGE on the text
// baseline by definition — exactly the alignment wanted, for free.
//
// `last baseline` (not `baseline`) matters once the tagline wraps: at higher
// zoom the row narrows and the tagline breaks onto 2+ lines. First-baseline
// alignment would pin line 1 and let the rest spill DOWN past the wordmark;
// anchoring the last line keeps the bottom line on the wordmark baseline and
// stacks earlier lines upward.
const MASTHEAD_WORDMARK_SIZE = 46;
const MASTHEAD_MARK_HEIGHT = 46;
// Gap between mark and word. A margin rather than flex `gap`, because the
// two are inline boxes sharing a line, not flex items.
const MASTHEAD_MARK_GAP = 12;
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="border-b border-stone-950 bg-stone-100">
      {/* One shared baseline across the wordmark, the tagline and the
          right-side controls — `last baseline` on this row, resolved by the
          browser from the face that actually rendered. The UBC logo opts out
          with `self-end` so it still pins to the masthead rule. */}
      <div className="flex gap-3 flex-wrap" style={LAST_BASELINE}>
        {/* Mark + typed wordmark. There is no wordmark-only cut of the mark,
            so the word is set in the UI face. Both are inline boxes on one
            line, so `align-baseline` on the image drops its bottom edge onto
            that line's baseline — the mark rides the line the letters sit on
            without anything here measuring the font. */}
        <div className="whitespace-nowrap">
          <img
            src={gemmaMarkAmber}
            alt=""
            style={{ height: MASTHEAD_MARK_HEIGHT }}
            className="inline-block w-auto align-baseline"
          />
          <span
            className="inline-block font-semibold tracking-tight text-stone-950 leading-none align-baseline"
            style={{
              fontSize: MASTHEAD_WORDMARK_SIZE,
              marginLeft: MASTHEAD_MARK_GAP,
            }}
          >
            Gemma
          </span>
        </div>

        <div
          className="flex-1 min-w-0 flex gap-6 leading-none"
          style={LAST_BASELINE}
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600 leading-none">
            Database of curated and re-analyzed gene expression studies
          </span>

          <div className="flex-1 min-w-0" />

          {/* About + auth — same baseline as the tagline. */}
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="text-[12px] text-stone-600 hover:text-stone-900 hover:no-underline bg-transparent border-none cursor-pointer p-0"
            >
              About
            </button>
            {me.isPending && !me.data ? null : user ? (
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
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                // `leading-none -mb-1` cancels the button's below-baseline
                // padding (mirrors `py-1`) so, in the shared baseline row,
                // its padded box doesn't drag the tagline's baseline up off
                // the wordmark. Visual padding is unchanged.
                className={`text-[12px] leading-none -mb-1 px-2.5 py-1 rounded ${SIGN_IN_BUTTON_COLOR}`}
              >
                Sign in
              </button>
            )}
          </div>
        </div>

        {/* UBC logo — pinned to the masthead rule. A replaced box has no
            text baseline to share, so it opts out of the row's baseline
            alignment and bottom-aligns instead. */}
        <a
          href="https://www.ubc.ca/"
          target="_blank"
          rel="noopener noreferrer"
          className="self-end"
        >
          <img
            src={ubcLogo}
            alt="University of British Columbia"
            style={{ height: 40 }}
            className="block w-auto"
          />
        </a>
      </div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

function GeneralInfo({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="my-3 border-2 border-stone-950 bg-stone-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="general-info-body"
        className="w-full flex items-baseline gap-2 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300 hover:bg-stone-50"
      >
        <span className="text-stone-900 font-semibold">About Gemma</span>
        <span className="text-blue-700 normal-case tracking-normal text-[11px] font-medium">
          {open ? "▾ hide" : "▸ show"}
        </span>
      </button>
      {open ? (
        <div
          id="general-info-body"
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-300"
        >
          {/* Column 1 — identity / mission. */}
          <InfoColumn
            title={GENERAL_INFO.idea.title}
            accent={GENERAL_INFO.idea.accent}
          >
            <p className="text-[15px] font-semibold text-stone-900 leading-snug mb-3">
              {GENERAL_INFO.idea.lead}
            </p>
            <div className="space-y-2 text-sm text-stone-600 leading-relaxed">
              {GENERAL_INFO.idea.body.map((para) => (
                <p key={para}>{para}</p>
              ))}
            </div>
          </InfoColumn>

          {/* Column 2 — data + analysis catalogue. Two-column
              definition list: bold lead on the left, muted body on
              the right. Bullets dropped — the typography +
              grid alignment carry enough structure on their own. */}
          <InfoColumn
            title={GENERAL_INFO.provide.title}
            accent={GENERAL_INFO.provide.accent}
          >
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

          {/* Column 3 — access surfaces. Same compact dl pattern
              as Column 2: tag column on the left, link in the
              middle, muted hint on the right. Tight rows, no
              heavy filled chips — outlined tag at the same scale
              as the body text. */}
          <InfoColumn
            title={GENERAL_INFO.how.title}
            accent={GENERAL_INFO.how.accent}
          >
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
        </div>
      ) : null}
    </div>
  );
}

/** Per-column accent — small coloured bar on the left edge +
 *  matching tinted title dot. Anchors the column visually
 *  without competing with the body content. Three accents:
 *  orange (identity), blue (data), emerald (action). */
function InfoColumn({
  title,
  accent,
  children,
}: {
  title: string;
  accent: "orange" | "blue" | "emerald";
  children: React.ReactNode;
}) {
  const accentClass =
    accent === "orange"
      ? "bg-orange-500"
      : accent === "blue"
        ? "bg-blue-700"
        : "bg-emerald-600";
  return (
    <div className="bg-stone-100 relative pl-5 pr-5 py-4">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${accentClass}`}
      />
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block w-2 h-2 ${accentClass}`}
        />
        <span className="text-stone-900 font-semibold">{title}</span>
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
  const baseCls = `${cols} bg-stone-100 px-5 py-4 flex flex-col`;
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

