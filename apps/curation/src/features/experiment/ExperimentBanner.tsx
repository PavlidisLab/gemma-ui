import type { ReactNode } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { ExperimentSetChips } from "./banner/ExperimentSetChips";
import { ExperimentGroupChips } from "./banner/ExperimentGroupChips";
import { BannerStatusChips, NotesButton } from "./banner/BannerStatusChips";
import { ModalityIndicator, PlatformLine } from "./banner/PlatformLine";
import { PublishButton } from "./banner/PublishButton";
import { TitleEditor } from "./banner/NameEditors";
import { inferModality } from "@/features/experiment/modality";

export type TabId =
  | "overview"
  | "design"
  | "samples"
  | "qc"
  | "diagnostics"
  | "qt"
  | "history"
  | "pipeline"
  | "single-cell";

// Order mirrors the Confluence Experiment Checklist workflow:
// design / sample details before QC, real expression diagnostics
// next, QT after, history last. Tags moved into Overview 2026-04-30.
// The single-cell tab is conditionally rendered (modality ===
// "single-cell"). Naming split 2026-05-23: the legacy "Diagnostics"
// tab was design-validity / pre-publish checklist content — that
// moved to "Quality control"; the new "Diagnostics" tab carries the
// real expression QC (sample correlation / PCA / M-V).
export const EXPERIMENT_TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "design", label: "Design setup" },
  { id: "samples", label: "Sample details" },
  { id: "qc", label: "Quality control" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "qt", label: "Quantitation types" },
  { id: "single-cell", label: "Single-cell" },
  { id: "history", label: "History" },
  { id: "pipeline", label: "Pipeline" },
];

/**
 * Top metadata strip for an experiment, plus the tab bar. Metadata
 * comes through props from the active design draft (taxon, sample
 * count, platform, publications, …). The tab bar is controlled —
 * App owns `activeTab` and renders the matching body.
 */
export function ExperimentBanner({
  experimentId,
  title,
  taxon,
  nSamples,
  assay,
  technologyType,
  platform,
  platformShortName,
  platformId,
  originalPlatform,
  originalPlatformShortName,
  originalPlatformId,
  activeTab,
  onTabChange,
  notesOpen,
  onToggleNotes,
  groupContext,
  ticketContext: _ticketContext,
  commitBar,
  comparisonStrip,
}: {
  experimentId: number | string;
  /* No ``shortName`` — the accession is the pinned header's now, and
     the banner rendering it too was the duplication. ``ShortNameEditor``
     is exported from this file and mounted up there. */
  title: string;
  taxon: string;
  nSamples: number;
  assay: string;
  /** Gemma technology classifier — ``ONECOLOR`` / ``TWOCOLOR`` /
   *  ``DUALMODE`` (microarray), ``SEQUENCING`` / ``GENELIST``
   *  (RNA-seq, often with a generic stand-in array_design),
   *  ``OTHER``. We use it to decide whether to surface the
   *  array_design as a real platform or as a stub link. */
  technologyType: string;
  platform: string;
  platformShortName: string;
  platformId: number | null;
  originalPlatform: string;
  originalPlatformShortName: string;
  originalPlatformId: number | null;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  /** Active workflow Group context (URL ``?group=<id>``). When set,
   *  the action row renders an inline prev/next nav cluster anchored
   *  to that group; member-link navigations preserve the param so
   *  the curator stays in-set. */
  groupContext?: string;
  /** Active Ticket context (URL ``?ticket=<id>``). When set, the
   *  banner renders a ticket breadcrumb + prev/next walking the
   *  ticket's targets. Mutually exclusive with ``groupContext`` in
   *  practice. */
  ticketContext?: string;
  /** Inline commit-status chip rendered in the action row. App-level
   *  composition pulls in the design draft + validation. Renders
   *  null when the draft is clean, so passing it always is fine. */
  commitBar?: ReactNode;
  /** The baseline / comparator chip strip + its diff readout, on its
   *  own row above the tabs. Passed in rather than mounted here
   *  because the strip needs route + flow context that App owns —
   *  same composition the ``commitBar`` slot uses. */
  comparisonStrip?: ReactNode;
}) {

  return (
    <section className="bg-white border-b border-slate-200">
      {/* Identity only — title + the one-line meta. The action cluster
          used to sit here as a second column, which is what left the
          right-hand side of the rows below it empty; it now rides the
          comparison row further down. A long title gets the full width
          back as a side effect. */}
      <div className="mx-auto w-full px-4 pt-3 pb-1.5">
        <div className="min-w-0">
          {/* Modality badge, then the title. The accession led this row
              until 2026-08-16 and now appears once, in the pinned header
              ("the short name doesn't need to be listed twice" — Paul).
              The editor itself moved there rather than being deleted, so
              rename and select-copy survive the de-duplication. */}
          <div className="flex items-baseline gap-3 flex-wrap">
            <ModalityIndicator />
            <TitleEditor title={title} />
            <ExperimentSetChips experimentId={experimentId} />
          </div>
          {/* ``items-center`` matters here now that the row mixes plain
              text with bordered chips. Flex defaults to `stretch`, so
              each child grew to the tallest item's height and the text
              sat at the TOP of its stretched box while the chips
              centred inside theirs — the two ran on visibly different
              baselines. */}
          <div className="mt-1 text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{taxon}</span>
            <span>{nSamples} samples</span>
            <CellTypeCountChip />
            <PlatformLine
              technologyType={technologyType}
              assay={assay}
              platform={platform}
              platformShortName={platformShortName}
              platformId={platformId}
              originalPlatform={originalPlatform}
              originalPlatformShortName={originalPlatformShortName}
              originalPlatformId={originalPlatformId}
            />
            {/* 🛑 The source link, both Gemma front-ends and the load
                date left this line on 2026-08-31 for a "Source & links"
                card above Publications on the Overview
                (`overview/SourceLinksCard.tsx`). The row carries
                identity facts, the comparison strip AND the action
                cluster, and those six items were what made it reflow at
                ordinary widths (Paul: "this line of stuff is too packed,
                it flips out too easily").

                What stays is what is read at a glance — taxon, sample
                count, platform. Link-outs are consulted deliberately, so
                a card costs nothing and buys the row back. Do not move
                them back here without moving something else out. */}

            {/* The comparison strip and the action cluster ride the
                META line rather than claiming rows of their own.

                Comparison state — "what am I looking at, and against
                what" — lived in the app-global AppHeader until
                2026-08-16, where it was the widest tenant of a row it
                had no business being on: that header carries app-global
                chrome (brand, nav, session) and this is
                experiment-scoped. Moving it down here bought the header
                its line back but spent a line to do it, and the strip
                plus the buttons then sat on two full-width rows that
                each used well under half their width, with a tall empty
                band between (Paul, 2026-08-16: "make better use of the
                width — instead of adding rows").

                So all three share this line: identity facts, then what
                is being compared, then what you can do about it, with
                the actions pushed right by ``ml-auto``. The banner is
                back to the three rows it had before the strip arrived,
                and the header keeps its line. Everything is
                ``flex-wrap``, so a narrow window breaks between groups
                instead of clipping. */}
            <span aria-hidden className="text-slate-300 select-none">
              |
            </span>
            {comparisonStrip}
            <div className="flex items-center justify-end gap-2 shrink-0 ml-auto">
              {commitBar}
          {/* Set picker + navigator collapsed into a single control:
             ExperimentGroupChips is now the only set surface. Each chip
             shows the set name + member count, and the chip's popover
             carries prev/next + member-list navigation. The standalone
             `← 1/42 →` SetNavCluster was redundant when the experiment
             was a member of multiple sets — curator was looking at
             three set chips PLUS a separate paginator for "the active
             one", with the same data echoed twice. Open the active
             chip to navigate. */}
          {/* TicketContextChip moved 2026-06-14 — the reviewer: "would it make
             sense to consolidate this so that the breadcrumb is also
             the drop-down ui?" The same component now mounts in
             AppHeader next to the Dashboard button, doubling as the
             back-affordance + the member-popover trigger. Was a
             separate violet pill here. */}
          <ExperimentGroupChips
            experimentId={experimentId}
            groupContext={groupContext}
          />
          <BannerStatusChips
            experimentId={experimentId}
            onOpenStatus={onToggleNotes}
          />
          <NotesButton
            experimentId={experimentId}
            open={notesOpen}
            onToggle={onToggleNotes}
          />
          {/*
            Removed the disabled "history" stub. The History tab in
            the tab bar below already opens the audit trail (with a
            link-out to Gemma's full DWR history); a banner-level
            duplicate that didn't work was just clutter.
          */}
          {/*
            ``SaveDraftButton`` retired here — the floating CommitBar
            (``SharedCommitBar`` in App.tsx) covers the same action
            with a richer surface (discard + per-factor baseline
            overrides + change summary), and showing both invited the
            collision the curator noticed in the top-right.
           */}
          {/* ``ResyncButton`` ("re-import from Gemma") retired
              2026-05-26 — the reviewer: pulling data from remote into local
              via the UI is too confusing. The functionality lived in
              the local-mode dev escape hatch; if needed it returns
              via a CLI / admin path. ``useImportFromGemma`` kept on
              the data-layer for ImportPrompt's 404 fallback. */}
              <PublishButton experimentId={experimentId} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full px-4">
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
          <ExperimentTabs activeTab={activeTab} onTabChange={onTabChange} />
        </nav>
      </div>
    </section>
  );
}

/**
 * Tab bar. Most tabs are always visible; ``single-cell`` is gated on
 * the inferred modality so it only appears for single-cell / single-
 * nucleus experiments. Content is placeholder today.
 */
function ExperimentTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}) {
  const { draft } = useDesignDraft();
  const modality = inferModality(draft);
  const isSingleCell = modality === "single-cell";
  const visibleTabs = EXPERIMENT_TABS.filter((t) =>
    t.id === "single-cell" ? isSingleCell : true,
  );
  return (
    <>
      {visibleTabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTabChange(t.id)}
          className={
            "px-3 py-2 text-sm cursor-pointer border-b-2 bg-transparent " +
            (t.id === activeTab
              ? "border-blue-700 text-slate-900 font-medium"
              : "border-transparent text-slate-600 hover:text-slate-900")
          }
        >
          {t.label}
        </button>
      ))}
    </>
  );
}

/**
 * Cell-type count chip in the banner metadata strip. Only renders when
 * the modality is single-cell / single-nucleus AND the draft carries
 * any ``cell type`` tags. Reads from useDesignDraft so it picks up
 * curator edits (e.g. accepting a proposer's cell-type tag set)
 * without a refetch. List of cell types lives in the tooltip; the
 * Single-cell tab and Overview TagBar carry the full surface.
 */
function CellTypeCountChip() {
  const { draft } = useDesignDraft();
  const modality = inferModality(draft);
  if (modality !== "single-cell") return null;
  const cellTypeTags = (draft?.tags ?? []).filter(
    (t) => (t.category?.label || "").trim().toLowerCase() === "cell type",
  );
  if (cellTypeTags.length === 0) return null;
  const labels = cellTypeTags
    .map((t) => t.value?.label)
    .filter((s): s is string => !!s);
  return (
    <span
      className="inline-flex items-center gap-1 text-violet-800 dark:text-violet-300"
      title={
        labels.length > 0
          ? `cell types:\n• ${labels.join("\n• ")}`
          : `${cellTypeTags.length} cell type(s)`
      }
    >
      <span className="text-[10px] uppercase tracking-wide font-semibold px-1 py-0 rounded border border-violet-200 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/30">
        {cellTypeTags.length} cell types
      </span>
    </span>
  );
}

/** Header bar above the banner.
 *
 *  Currently a no-op. The breadcrumb, signed-in/mode/health cluster,
 *  and SettingsMenu have all migrated to the global AppHeader. Kept
 *  as a render no-op (rather than removed) so the three callers in
 *  App.tsx don't need to be touched in this pass; a follow-up can
 *  drop the call sites and this export. */
export function TopBar(_props: {
  experimentId: number | string;
  experimentShortName: string;
  reviewer: string;
}) {
  return null;
}

// Re-exported rather than moved out of reach: `TicketContextChip` is
// part of the banner's surface (AppHeader mounts it beside the
// Dashboard button), it is just no longer defined here.
export { TicketContextChip } from "./banner/TicketContextChip";

// Re-exported: these are the banner's surface even though they are no
// longer defined here. `ShortNameEditor` mounts in AppHeader, the two
// formatters are shared with the Overview's Source & links card, and
// `TicketContextChip` mounts beside the Dashboard button.
export { ShortNameEditor } from "./banner/NameEditors";
export { formatLoadedAt, externalSourceLink } from "./banner/bannerFormat";
