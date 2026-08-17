import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ApiError } from "@/api/client";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { setDesignTitle } from "@/features/design/mutations";
import { useCurationDetails } from "@/api/curation";
import { useMe } from "@/api/session";
import { useTicket } from "@/api/tickets";
import {
  useDatasetVisibility,
  usePublishExperiment,
  useRenameExperiment,
} from "@/api/datasets";
import { Pencil as PencilIcon } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { experimentPageUrl, platformPageUrl } from "@/lib/gemmaUrls";
import {
  inferModality,
  modalityLabel,
  type Modality,
} from "@/features/experiment/modality";
import { cn } from "@/lib/cn";
import type { ExternalSource } from "@/features/experiment/types";
import { useExperimentGroups, useGroup } from "@/api/workflow";
import { experimentRoute, navigate, workflowRoute } from "@/routes";
import { StatusDisc, type StatusDiscTone } from "@/components/ui/StatusDisc";
import { readDirtyExperimentIds } from "@/features/design/draftCache";
import type {
  ExperimentAuditStatus,
  ExperimentSummary,
  Group,
  GroupType,
} from "@/api/workflowTypes";

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
  shortName,
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
  loadedAt,
  loadedBy,
  externalSource,
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
  shortName: string;
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
  loadedAt: string;
  loadedBy: string;
  /** Where the dataset came from — GEO, CELLxGENE, ArrayExpress,
   *  etc. ``null`` for direct uploads. */
  externalSource: ExternalSource | null;
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
  const sourceLink = externalSourceLink(externalSource);
  // ``experimentPageUrl`` reads ``VITE_GEMMA_WEB_URL`` so a staging
  // / preview build (pointed at a different Gemma deployment) just
  // sets the env var; no prop plumbing.
  const gemmaUrl = experimentPageUrl(experimentId);

  return (
    <section className="bg-white border-b border-slate-200">
      {/* Identity only — title + the one-line meta. The action cluster
          used to sit here as a second column, which is what left the
          right-hand side of the rows below it empty; it now rides the
          comparison row further down. A long title gets the full width
          back as a side effect. */}
      <div className="mx-auto w-full px-4 pt-3 pb-1.5">
        <div className="min-w-0">
          {/* Title rides the first row (after accession + modality
              badge) to save a row of vertical space (design review 2026-06-21);
              it wraps under the accession on a narrow viewport. */}
          <div className="flex items-baseline gap-3 flex-wrap">
            <ShortNameEditor
              experimentId={experimentId}
              shortName={shortName}
            />
            <ModalityIndicator />
            <TitleEditor title={title} />
          </div>
          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
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
            {externalSource ? (
              sourceLink ? (
                <a
                  href={sourceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline"
                  title={`source: ${externalSource.database} ${externalSource.accession}`}
                >
                  {/* Just the database name. The accession was printed
                      here too, which made it the THIRD copy on screen —
                      the pinned header says "Curating GSE33744", the
                      title row repeats it, and this link said it again
                      (Paul, 2026-08-16: "reduce the repetition"). What
                      the link adds is WHERE it goes, not which record;
                      the tooltip still spells the accession out. */}
                  {externalSource.database} ↗
                </a>
              ) : (
                <span title="external source recorded but no canonical URL available">
                  source: {externalSource.database} {externalSource.accession}
                </span>
              )
            ) : (
              <span
                className="italic text-slate-500"
                title="dataset not imported from an external database (direct upload)"
              >
                direct upload
              </span>
            )}
            <a
              href={gemmaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
              title="open on Gemma"
            >
              view on Gemma ↗
            </a>
            {/* Compact "Loaded …" pill. The raw loadedAt string from
                Gemma's REST is an ISO with microseconds + timezone
                (e.g. "2026-04-16 07:32:35.224000+00:00") — render
                the date short, full datetime in the title tooltip.
                Suppress the "by …" tail when loadedBy is empty
                (most imports don't carry a loader name). */}
            {loadedAt ? (
              <span
                className="text-slate-500"
                title={
                  loadedAt + (loadedBy ? ` · by ${loadedBy}` : "")
                }
              >
                loaded {formatLoadedAt(loadedAt)}
                {loadedBy ? (
                  <>
                    {" by "}
                    <span className="font-medium text-slate-700">
                      {loadedBy}
                    </span>
                  </>
                ) : null}
              </span>
            ) : null}

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

/**
 * Click-to-edit display of an experiment's ``short_name``. Replaces
 * what used to be a linked h1 — the link duplicated the
 * "view on Gemma ↗" affordance in the metadata row, and the title
 * is the natural home for the (rarely-needed) rename action.
 *
 * Affordance: read mode shows the name in the h1's chrome with a
 * pencil icon that reveals on hover. Click anywhere on the chip (or
 * the icon) → enters edit mode. Enter saves; Escape cancels; blur
 * commits unless the value is unchanged. Save flow surfaces inline
 * errors for the two cases that matter:
 *   - 409 (name already in use) — the unique-across-Gemma constraint
 *   - 404 (endpoint not implemented yet on this backend)
 * Other errors render the server's detail or message verbatim.
 *
 * On success, the design + datasets caches invalidate so the rest of
 * the UI repaints with the new name without a reload.
 */
function ShortNameEditor({
  experimentId,
  shortName,
}: {
  experimentId: number | string;
  shortName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shortName);
  const inputRef = useRef<HTMLInputElement>(null);
  const rename = useRenameExperiment(experimentId);

  useEffect(() => {
    if (!editing) {
      setDraft(shortName);
      rename.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, shortName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (!next || next === shortName) {
      setEditing(false);
      return;
    }
    rename.mutate(next, {
      onSuccess: () => setEditing(false),
      // onError keeps editing=true so the inline error is visible
      // next to the still-focused input.
    });
  }

  if (!editing) {
    // Pencil-on-hover edit. The short_name text itself is plain
    // selectable content (curators frequently select-copy the
    // accession to paste into Slack / tickets / wiki), so we gate
    // the click into edit mode on the pencil affordance — matches
    // the description editor's pattern. Hover reveals the pencil
    // and a subtle dashed underline as the discoverability cue.
    return (
      <h1 className="text-lg font-semibold text-slate-900 inline-flex items-baseline gap-1 group">
        <span
          className="border-b border-dashed border-transparent group-hover:border-slate-400"
          title={shortName}
        >
          {shortName}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="rename short_name — must be unique across Gemma"
          aria-label="rename short_name"
          className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity self-center shrink-0"
        >
          <PencilIcon className="h-3 w-3" aria-hidden />
        </button>
      </h1>
    );
  }

  const err = rename.error;
  const errMsg =
    err instanceof ApiError
      ? err.status === 409
        ? `"${draft.trim()}" is already in use — short_name must be unique across Gemma`
        : err.status === 404
          ? "rename endpoint not yet available"
          : err.detail || err.message
      : err
        ? (err as Error).message
        : null;

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // Defer slightly so a click on Save / Cancel can run
            // before blur tears down the editor. ``commit`` itself
            // no-ops when the value matches the current short_name.
            window.setTimeout(() => {
              if (!rename.isPending) commit();
            }, 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.preventDefault();
            } else if (e.key === "Escape") {
              setEditing(false);
              e.preventDefault();
            }
          }}
          disabled={rename.isPending}
          spellCheck={false}
          className="text-lg font-semibold text-slate-900 border border-blue-300 rounded px-1 py-0 min-w-[14ch] outline-none focus:border-blue-500 disabled:opacity-60"
          aria-label="short_name"
        />
        {rename.isPending ? (
          <Spinner />
        ) : (
          <>
            <button
              type="button"
              className="text-[11px] text-blue-700 hover:underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commit}
            >
              save
            </button>
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-slate-800"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing(false)}
            >
              cancel
            </button>
          </>
        )}
      </span>
      {errMsg ? (
        <span className="text-[11px] text-rose-700 mt-0.5" role="alert">
          {errMsg}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Re-pull this experiment's design from real Gemma. Only meaningful
 * in **local mode** — in remote mode the UI is already talking to
 * Gemma directly, so there's nothing to "refresh from Gemma". Hidden
 * outside local mode rather than shown-disabled, since the action
 * would be a no-op there.
 *
 * Destructive on uncommitted edits — the imported Design replaces
 * whatever's currently in the local backend. Gated by a confirmation
 * modal that warns about the draft when the diff is dirty.
 */

/**
 * Click-to-edit display of the experiment title (the human-readable
 * descriptive name — e.g. "A STAT5B-driven mouse model of
 * hepatosplenic γδ T cell lymphoma…"). The title lives on the
 * design draft and edits flow through the normal commit pipeline
 * (no separate REST call) — saves stage on the draft, the floating
 * CommitBar materialises a "save" affordance, and the commit lands
 * via the usual draft-commit POST.
 *
 * Same single-click + pencil-on-hover affordance as ShortNameEditor.
 * Plain text in read mode; click → input → Enter saves / Esc cancels
 * / blur commits.
 */
function TitleEditor({ title }: { title: string }) {
  const { draft, apply } = useDesignDraft();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setD(title);
  }, [editing, title]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = d.trim();
    if (next !== title && draft) apply(setDesignTitle(draft, next));
    setEditing(false);
  }

  if (!editing) {
    // Title can be long (full study sentence); curators routinely
    // select-copy chunks of it. Same pattern as short_name — text
    // stays plain selectable, pencil is the click target. Empty
    // state lets the placeholder act as the affordance since
    // there's nothing to select.
    const isEmpty = !title;
    return (
      <h2 className="text-sm font-semibold text-slate-900 leading-snug inline-flex items-baseline gap-1 group">
        {isEmpty ? (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }}
            className="italic text-slate-400 font-normal cursor-pointer hover:underline"
            title="click to add title"
          >
            (no title — click to add)
          </span>
        ) : (
          <>
            <span className="border-b border-dashed border-transparent group-hover:border-slate-400">
              {title}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="edit title"
              aria-label="edit title"
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity self-center shrink-0"
            >
              <PencilIcon className="h-3 w-3" aria-hidden />
            </button>
          </>
        )}
      </h2>
    );
  }
  return (
    <input
      ref={inputRef}
      value={d}
      onChange={(e) => setD(e.target.value)}
      onBlur={() => {
        window.setTimeout(commit, 100);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.preventDefault();
        } else if (e.key === "Escape") {
          setEditing(false);
          e.preventDefault();
        }
      }}
      spellCheck
      className="w-full text-sm font-semibold text-slate-900 leading-snug border border-blue-300 rounded px-1 py-0 outline-none focus:border-blue-500"
      aria-label="experiment title"
    />
  );
}

/**
 * Chips listing the workflow Groups (sets) this experiment is a
 * member of. Renders inline in the banner action row, before the
 * Status button. Each chip toggles a popover that lets the curator
 * navigate within the set — prev/next, search, click to jump.
 *
 * Hidden when the experiment isn't in any group (most freshly-
 * loaded experiments). Pluralised label ("Set" vs "Sets") so a
 * single membership doesn't read as a count.
 *
 * Chip-render path uses the lightweight ``useExperimentGroups`` call
 * (no member summaries). The popover does its own ``useGroup`` call
 * with ``include_summaries=true`` so the per-member metadata only
 * gets fetched when the curator actually opens the navigator.
 */
function ExperimentGroupChips({
  experimentId,
  groupContext,
}: {
  experimentId: number | string;
  groupContext?: string;
}) {
  const { data: groups } = useExperimentGroups(experimentId);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!switcherOpen) return;
    function onPointer(e: MouseEvent) {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setSwitcherOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  if (!groups || groups.length === 0) return null;

  // Show ONE chip prominently — the active set context if the URL
  // has one, otherwise the first set. When the experiment belongs
  // to more than one set, a small "+ N other" pill next to the
  // primary chip opens a switch dropdown listing the others.
  // Earlier shape was a flex-wrap row of all chips which didn't
  // scale past 3 sets and made the active one hard to find.
  const activeGroup = groupContext
    ? groups.find((g) => g.id === groupContext)
    : null;
  const primary = activeGroup ?? groups[0];
  const others = groups.filter((g) => g.id !== primary.id);

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
        {activeGroup ? "In set" : "Set"}
      </span>
      <SetChip
        key={primary.id}
        group={primary}
        currentExperimentId={experimentId}
        isActiveContext={!!activeGroup}
        open={openGroupId === primary.id}
        onToggle={() =>
          setOpenGroupId((prev) => (prev === primary.id ? null : primary.id))
        }
        onClose={() => setOpenGroupId(null)}
      />
      {others.length > 0 ? (
        <span ref={switcherRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="inline-flex items-baseline gap-0.5 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            title={`Switch to one of ${others.length} other set${others.length === 1 ? "" : "s"} this experiment belongs to`}
          >
            + {others.length} other
            <span className="text-slate-400 dark:text-slate-500 ml-0.5">
              ▾
            </span>
          </button>
          {switcherOpen ? (
            <SetSwitchDropdown
              experimentId={experimentId}
              activeGroupId={primary.id}
              groups={groups}
              onClose={() => setSwitcherOpen(false)}
            />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Dropdown listing every group the experiment belongs to, with the
 *  active one marked. Click a non-active row to navigate to that
 *  set's context (preserves the active tab via experimentRoute +
 *  the group= query param). */
function SetSwitchDropdown({
  experimentId,
  activeGroupId,
  groups,
  onClose,
}: {
  experimentId: number | string;
  activeGroupId: string;
  groups: Group[];
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Switch set context"
      className="absolute right-0 top-full mt-1 z-30 min-w-[20rem] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg py-1 text-xs"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
        This experiment belongs to {groups.length} set
        {groups.length === 1 ? "" : "s"}
      </div>
      {groups.map((g) => {
        const isActive = g.id === activeGroupId;
        return (
          <button
            key={g.id}
            type="button"
            disabled={isActive}
            onClick={() => {
              onClose();
              navigate(experimentRoute(experimentId, undefined, g.id));
            }}
            className={cn(
              "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
              isActive
                ? "bg-slate-100 dark:bg-slate-700 cursor-default"
                : "hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer",
            )}
          >
            <span
              className={cn(
                "w-3 text-emerald-600 dark:text-emerald-400 font-bold",
                !isActive && "opacity-0",
              )}
              aria-hidden
            >
              ✓
            </span>
            <span className="flex-1 min-w-0">
              <span
                className={cn(
                  "block",
                  isActive
                    ? "text-slate-900 dark:text-slate-100 font-medium"
                    : "text-slate-700 dark:text-slate-200",
                )}
              >
                {g.name}
              </span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                {g.type} · {g.member_count} member
                {g.member_count === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A single Set chip + its anchored navigator popover. The chip is
 *  a button (not a link) so click toggles the popover; the popover's
 *  header carries an explicit "Open in Workflow" link for the case
 *  where the curator wants the full tab view. */
function SetChip({
  group,
  currentExperimentId,
  isActiveContext = false,
  open,
  onToggle,
  onClose,
}: {
  group: Group;
  currentExperimentId: number | string;
  /** True when this group matches the URL's ``?group=<id>`` context.
   *  Surfaces as a small active-context indicator on the chip so the
   *  curator can tell which set the inline prev/next is anchored to. */
  isActiveContext?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  // Dismiss on outside-click + Escape; same pattern as the Why
  // popover in ProposalCardV2.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer",
          groupTypeChipCls(group.type),
          open && "ring-2 ring-offset-1 ring-slate-400/40",
          isActiveContext && !open && "ring-1 ring-slate-400/60",
        )}
        title={
          isActiveContext
            ? `${group.name} · ${group.type} · ${group.member_count} member${
                group.member_count === 1 ? "" : "s"
              } — active set context (prev/next anchored here)`
            : `${group.name} · ${group.type} · ${group.member_count} member${
                group.member_count === 1 ? "" : "s"
              } — click to navigate`
        }
      >
        {isActiveContext ? (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-300"
            aria-label="active set context"
          />
        ) : null}
        <span className="font-medium truncate max-w-[28ch]">{group.name}</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
          {group.member_count}
        </span>
      </button>
      {open ? (
        <SetNavigatorPopover
          groupId={group.id}
          currentExperimentId={currentExperimentId}
          anchorRef={wrapRef}
          onClose={onClose}
        />
      ) : null}
    </span>
  );
}

/** Anchored popover: header + position indicator + prev/next +
 *  search + scrollable member list. Opens when a Set chip is
 *  clicked; closes on outside-click / Escape (handled by parent).
 *
 *  Lifts ``include_summaries=true`` on its own ``useGroup`` call
 *  rather than depending on the chip-render path's lightweight data,
 *  so per-member metadata only loads when the curator opens the
 *  navigator. */
function SetNavigatorPopover({
  groupId,
  currentExperimentId,
  anchorRef,
  onClose,
}: {
  groupId: string;
  currentExperimentId: number | string;
  /** Ref to the chip's outer wrapper. Used to measure the trigger
   *  position so the popover can flip above when below would
   *  overflow the viewport bottom. (The popover itself is
   *  ``absolute`` from this wrapper, so we don't move; we toggle
   *  ``top-full mt-1`` ↔ ``bottom-full mb-1``.) */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { data: group, isLoading } = useGroup(groupId, {
    includeSummaries: true,
  });
  const [query, setQuery] = useState("");
  const summaries = group?.member_summaries ?? null;
  // Local-draft signal for the per-row "uncommitted" disc. Read on
  // every render — cheap (one localStorage scan, no JSON parse) and
  // the popover only mounts when the curator opens it, so the cost
  // is bounded. Recomputes on each open so a draft committed in
  // another tab between opens reflects accurately.
  const dirtyDraftIds = useMemo(() => readDirtyExperimentIds(), [group]);
  // Vertical-flip decision. Measured against an estimate (the popover
  // is ~360-400px tall depending on member count + search hits);
  // close enough for the keep-on-screen heuristic, and the popover's
  // ``max-h-72`` on its body keeps the absolute height bounded.
  const [flipUp, setFlipUp] = useState(false);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const POPOVER_H_ESTIMATE = 380;
    const margin = 8;
    setFlipUp(
      rect.bottom + POPOVER_H_ESTIMATE + margin > window.innerHeight &&
        rect.top > POPOVER_H_ESTIMATE,
    );
  }, [anchorRef]);

  // Index of the curator's current experiment within the set's
  // ordered member list. ``-1`` when this experiment isn't a member
  // (shouldn't happen — the chip wouldn't render — but defensive).
  const currentIdx =
    summaries?.findIndex((s) => s.experiment_id === currentExperimentId) ?? -1;

  // Open onto the current experiment — centre its row in the list
  // viewport once it first renders (members load async, so this can't
  // be a mount-only effect). The one-shot guard keeps later filter
  // typing from yanking the scroll back. Scroll is contained to the
  // <ul> so it never nudges the page or the popover.
  const listRef = useRef<HTMLUListElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current) return;
    const list = listRef.current;
    const row = currentRowRef.current;
    if (!list || !row) return;
    const offset =
      row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
    didScrollRef.current = true;
  }, [summaries]);

  const goToIndex = useCallback(
    (idx: number) => {
      if (!summaries || summaries.length === 0) return;
      // Wrap at ends so [/] never dead-ends the curator.
      const wrapped =
        ((idx % summaries.length) + summaries.length) % summaries.length;
      const target = summaries[wrapped];
      if (!target || target.experiment_id <= 0) return;
      // Anchor the URL's group context to this group so subsequent
      // tab switches / inline prev-next stay in-set without the
      // curator having to re-pick the group.
      navigate(experimentRoute(target.experiment_id, undefined, groupId));
      onClose();
    },
    [summaries, onClose, groupId],
  );

  // Keyboard prev/next: ``[`` and ``]`` while the popover is open.
  // Active only when the popover is open (parent gates render); we
  // bind on document so the shortcut works regardless of focus —
  // including while the (autoFocus'd) search input has focus, since
  // a curator filtering on accession/title never types literal
  // brackets and the popover hint promises ``[``/``]`` will work.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "[") {
        e.preventDefault();
        goToIndex(currentIdx - 1);
      } else if (e.key === "]") {
        e.preventDefault();
        goToIndex(currentIdx + 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goToIndex, currentIdx]);

  // Filter the member list by free-text query against short_name +
  // title. Required given "sets could be large." Case-insensitive
  // substring match — light enough that we don't need a debounce.
  const filtered = useMemo(() => {
    if (!summaries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.short_name.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q),
    );
  }, [summaries, query]);

  return (
    <div
      role="dialog"
      aria-label={`${group?.name ?? "Set"} navigator`}
      className={cn(
        "absolute z-30 right-0 w-96 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg text-xs dark:bg-slate-900 dark:border-slate-700",
        flipUp ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {group?.name ?? "Loading…"}
          </span>
          {group ? (
            <span
              className={cn(
                "inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-semibold border",
                groupTypeChipCls(group.type),
              )}
            >
              {group.type}
            </span>
          ) : null}
          <span className="ml-auto">
            <a
              href={workflowRoute(groupId)}
              className="text-blue-700 hover:underline text-[11px] dark:text-blue-300"
              onClick={onClose}
            >
              Open in Workflow ↗
            </a>
          </span>
        </div>
        {summaries && summaries.length > 0 ? (
          // Retired 2026-05-17: dropped the ← / → buttons. The member
          // list below is the primary navigator (click to jump); [ / ]
          // keyboard shortcuts still work for power users. Just the
          // bare position readout remains so the curator knows where
          // they are in the set without a chrome-heavy paginator.
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {currentIdx >= 0
              ? `${currentIdx + 1} of ${summaries.length}  ·  [ and ] keys to navigate`
              : `not in set · ${summaries.length} member${
                  summaries.length === 1 ? "" : "s"
                }`}
          </div>
        ) : null}
      </div>
      <div className="p-2 border-b border-slate-100 dark:border-slate-700">
        <input
          type="search"
          placeholder="Filter by accession or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400"
          // Don't grab keyboard prev/next while typing.
          autoFocus
        />
      </div>
      <ul
        ref={listRef}
        className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
      >
        {isLoading || !group ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            loading members…
          </li>
        ) : !summaries ? (
          // member_summaries should always come back when we asked for
          // them; this branch is for older agents that don't honour the
          // flag. Render the chip-only fallback so the popover doesn't
          // stay empty.
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            Member metadata unavailable. Open in Workflow for the full
            list.
          </li>
        ) : filtered.length === 0 ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            No members match "{query}".
          </li>
        ) : (
          filtered.map((m) => (
            <SetMemberRow
              key={`${m.experiment_id}-${m.short_name}`}
              summary={m}
              isCurrent={m.experiment_id === currentExperimentId}
              rowRef={
                m.experiment_id === currentExperimentId
                  ? currentRowRef
                  : undefined
              }
              hasLocalDraft={dirtyDraftIds.has(String(m.experiment_id))}
              onClick={() => {
                if (m.experiment_id <= 0) return;
                navigate(
                  experimentRoute(m.experiment_id, undefined, groupId),
                );
                onClose();
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

/** One member-list row: short_name + title + status pills.
 *  Highlighted when the row is the curator's current experiment.
 *  Disabled (no click) for placeholder / non-numeric members
 *  (screening-group candidate UUIDs). */
function SetMemberRow({
  summary,
  isCurrent,
  hasLocalDraft,
  rowRef,
  onClick,
}: {
  summary: ExperimentSummary;
  isCurrent: boolean;
  rowRef?: RefObject<HTMLLIElement>;
  /** This curator has an uncommitted local draft for this
   *  experiment (presence of a ``gca:draft:<id>`` key in
   *  localStorage). Takes precedence over the server-side
   *  in_progress audit signal when present — uncommitted local
   *  work is the more urgent state. */
  hasLocalDraft: boolean;
  onClick: () => void;
}) {
  const isPlaceholder = summary.experiment_id <= 0;
  const Component = isPlaceholder ? "div" : "button";
  return (
    <li ref={rowRef}>
      <Component
        type={isPlaceholder ? undefined : "button"}
        onClick={isPlaceholder ? undefined : onClick}
        className={cn(
          "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
          !isPlaceholder && "hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800",
          isCurrent &&
            "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50",
          isPlaceholder && "opacity-60 cursor-default",
        )}
        title={isPlaceholder ? "non-numeric member id" : `Open ${summary.short_name}`}
      >
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums shrink-0",
            isCurrent
              ? "font-semibold text-blue-900 dark:text-blue-200"
              : "text-slate-700 dark:text-slate-200",
          )}
        >
          {summary.short_name}
        </span>
        <span className="flex-1 truncate text-slate-600 dark:text-slate-400 text-[11px]">
          {summary.title || (isPlaceholder ? "" : "(no title)")}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          {summary.audit_status || hasLocalDraft ? (
            <StatusDisc
              tone={memberRowDiscTone(summary.audit_status, hasLocalDraft)}
              title={memberRowDiscTitle(summary.audit_status, hasLocalDraft)}
            />
          ) : null}
          {summary.troubled ? (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"
              title="troubled"
            />
          ) : null}
          {summary.needs_attention ? (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
              title="needs attention"
            />
          ) : null}
          {summary.is_public ? (
            <span
              className="text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
              title="public"
            >
              pub
            </span>
          ) : null}
        </span>
      </Component>
    </li>
  );
}

/** Compose the per-member StatusDisc tone.
 *
 *  Semantics aligned with the progress bar + workflow row disc
 *  (design review 2026-05-25 refinement):
 *    done        = review closed AND no uncommitted local draft
 *    uncommitted = local draft present (curator has touched but
 *                  not finished)
 *    untouched   = no curator activity — INCLUDES the server's
 *                  ``audit_status="in_progress"`` rows that exist
 *                  from calibration import but haven't seen any
 *                  curator action. Until the agents side lands
 *                  ``has_curator_activity``, the local-draft
 *                  cache is the only signal we trust for
 *                  "curator started." */
function memberRowDiscTone(
  auditStatus: ExperimentAuditStatus | undefined,
  hasLocalDraft: boolean,
): StatusDiscTone {
  if (auditStatus === "closed" && !hasLocalDraft) return "done";
  if (hasLocalDraft) return "uncommitted";
  return "untouched";
}

/** Tooltip copy that pairs with ``memberRowDiscTone``. */
function memberRowDiscTitle(
  auditStatus: ExperimentAuditStatus | undefined,
  hasLocalDraft: boolean,
): string {
  if (auditStatus === "closed" && hasLocalDraft) {
    return "review closed but uncommitted local changes remain";
  }
  if (auditStatus === "closed") return "review closed";
  if (hasLocalDraft) return "uncommitted local changes";
  if (auditStatus === "in_progress") {
    return "proposal exists but not yet touched";
  }
  return "untouched — no review yet";
}

/** Tone the group chip by its workflow type. Mirrors the funnel
 *  intent — screening = neutral early-stage, pipeline = active
 *  processing, review = closing out. Dark-mode variants are
 *  required since the banner surfaces sit directly on the dark
 *  background; light-mode-only fills wash out / lose contrast. */
function groupTypeChipCls(type: GroupType): string {
  switch (type) {
    case "screening":
      return (
        "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100 " +
        "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/70"
      );
    case "pipeline":
      return (
        "bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100 " +
        "dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900/50"
      );
    case "review":
      return (
        "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 " +
        "dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      );
    default:
      return (
        "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100 " +
        "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/70"
      );
  }
}

/**
 * Compact "Apr 16 07:32" rendering of an ISO timestamp. Falls back
 * to the raw string when parsing fails — better noise than "Invalid
 * Date" in the banner. Full timestamp with microseconds rides in
 * the parent's ``title`` tooltip.
 */
function formatLoadedAt(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Resolve the link to the external source for an ExternalSource.
 * Prefers the stored `uri` (server-supplied, canonical). Falls back
 * to a per-database default for the major sources so the banner
 * can still link out when older payloads don't carry `uri`.
 *
 * Returns ``null`` for unknown databases without a stored URI — we
 * show the accession as text rather than guess a URL.
 */
function externalSourceLink(src: ExternalSource | null): string | null {
  if (!src) return null;
  if (src.uri) return src.uri;
  const acc = src.accession.trim();
  if (!acc) return null;
  switch (src.database.toUpperCase()) {
    case "GEO":
      return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(acc)}`;
    case "ARRAYEXPRESS":
      return `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(acc)}`;
    case "CELLXGENE":
      // CELLxGENE accessions are dataset UUIDs.
      return `https://cellxgene.cziscience.com/datasets/${encodeURIComponent(acc)}`;
    case "SRA":
      return `https://www.ncbi.nlm.nih.gov/sra/?term=${encodeURIComponent(acc)}`;
    default:
      return null;
  }
}

/**
 * Inline status chips that sit alongside the Status button in the
 * banner action row. Surfaces the three experiment-level state
 * flags a curator should see at a glance — needs-attention,
 * troubled, public/private — without forcing them to open the
 * status modal. Clicking any chip opens the modal so they can
 * resolve / change it.
 *
 * The public/private chip used to live in TopBar (top-right);
 * moved here 2026-05-23 so all status flags read as one cluster.
 * Per design review: "our Public/Private thing should be near other status
 * flags like troubled/unusable".
 */
function BannerStatusChips({
  experimentId,
  onOpenStatus,
}: {
  experimentId: number | string;
  /** Called when a chip is clicked — opens the curation-status
   *  modal where the flag can be cleared / the note edited. */
  onOpenStatus: () => void;
}) {
  const { data: details } = useCurationDetails(experimentId);
  const visibility = useDatasetVisibility(experimentId);
  const troubled = !!details?.troubled;
  const needsAttention = !!details?.needs_attention;
  const visibilityState: "private" | "public" | "unknown" =
    visibility.isLoading || visibility.error
      ? "unknown"
      : visibility.data?.is_public
        ? "public"
        : "private";
  return (
    <div className="flex items-center gap-1">
      {troubled ? (
        <StatusChip
          tone="rose"
          label="troubled"
          title="Known data issue with this experiment. Click to open status."
          onClick={onOpenStatus}
        />
      ) : null}
      {needsAttention ? (
        <StatusChip
          tone="amber"
          label="needs attention"
          title="A curator needs to look at this. Click to open status."
          onClick={onOpenStatus}
        />
      ) : null}
      {/* Visibility chip is informational only — clicking it used
          to open the status modal, but visibility lives in Gemma
          (toggled via Publish / admin unpublish), not in the
          curator's status-notes surface. Design review 2026-05-25: "for
          now, that badge should just be informational". Drop
          ``onClick`` so StatusChip renders as a <span>; reinstate
          when a real visibility-editor flow lands. */}
      <StatusChip
        tone={
          visibilityState === "public"
            ? "rose"
            : visibilityState === "private"
              ? "emerald"
              : "slate"
        }
        label={
          visibilityState === "unknown"
            ? "status unknown"
            : visibilityState
        }
        title={
          visibilityState === "public"
            ? "Public — visible to all Gemma users."
            : visibilityState === "private"
              ? "Private — only visible to curators."
              : "Public/private state is not yet retrievable from Gemma's REST API."
        }
      />
    </div>
  );
}

/** Single status chip used by BannerStatusChips. Clickable; tone
 *  picks the palette. Compact pill so multiple fit in the banner
 *  action row without pushing other actions off-screen. */
function StatusChip({
  tone,
  label,
  title,
  onClick,
}: {
  tone: "rose" | "amber" | "emerald" | "slate";
  label: string;
  title?: string;
  onClick?: () => void;
}) {
  const palette = {
    rose: "bg-rose-100 text-rose-900 border-rose-300 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-700 dark:hover:bg-rose-900/60",
    amber:
      "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/60",
    emerald:
      "bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900/60",
    slate:
      "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700/80",
  }[tone];
  const Tag: keyof JSX.IntrinsicElements = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border",
        palette,
        onClick ? "cursor-pointer" : "",
      )}
    >
      {label}
    </Tag>
  );
}

/**
 * Status button — the primary "open curation-status modal" entry
 * point. Compact pill in the banner action row; the inline
 * BannerStatusChips (above) carry the at-a-glance signal so this
 * stays a plain action button instead of ringed + dotted.
 */
function NotesButton({
  experimentId,
  open,
  onToggle,
}: {
  experimentId: number | string;
  open: boolean;
  onToggle: () => void;
}) {
  const { data: details } = useCurationDetails(experimentId);
  const hasNote = !!details?.curation_note?.trim();
  // Note-preview tooltip: lets a curator hover the Status button to
  // peek at the scratchpad without opening the modal. Flag state is
  // already surfaced by BannerStatusChips, so this only shows the
  // note preview when one exists.
  const title = hasNote
    ? `${details!.curation_note.split(/\r?\n/).length} line${
        details!.curation_note.split(/\r?\n/).length === 1 ? "" : "s"
      } of notes — first line: ${details!.curation_note
        .split(/\r?\n/, 1)[0]
        .slice(0, 120)}`
    : open
      ? "close curation status"
      : "open curation status";
  return (
    <button
      type="button"
      className="btn text-xs !px-2 !py-1"
      onClick={onToggle}
      title={title}
    >
      Status
      {hasNote ? (
        <span
          className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500/70 align-middle"
          aria-label="has curation note"
        />
      ) : null}
    </button>
  );
}

/**
 * "Save draft" button in the experiment banner. Mirrors the
 * CommitBar at the bottom: disabled when there are no pending
 * changes, shows the count + a small dirty dot when there are.
 * Clicking commits the shared design draft via
 * `useDesignDraft().commit()`.
 *
 * Discard / saveError surfacing stays exclusively on the bottom
 * CommitBar to avoid duplicating both the success and error
 * affordances at top + bottom.
 */
/**
 * Strong modality chip for the banner. Single-cell / bulk RNA-seq
 * / microarray classification — at a glance, before the curator
 * scrolls. Reads the draft (not just the saved server state) so
 * edits to assay-tag inferences are reflected immediately.
 */
function ModalityIndicator() {
  const { draft } = useDesignDraft();
  const m = inferModality(draft);
  const { label, hint } = modalityLabel(m);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-bold px-2 py-0.5 rounded border",
        modalityClasses(m),
      )}
      title={hint}
    >
      {label}
    </span>
  );
}

function modalityClasses(m: Modality): string {
  switch (m) {
    case "single-cell":
      return "bg-violet-100 text-violet-900 border-violet-300";
    case "bulk-rnaseq":
      return "bg-sky-100 text-sky-900 border-sky-300";
    case "microarray":
      return "bg-amber-100 text-amber-900 border-amber-300";
    default:
      return "bg-slate-100 text-slate-700 border-slate-300";
  }
}

/**
 * Platform line for the banner metadata strip. Replaces a naive
 * ``{assay} · {platform}`` render that was showing curators
 * misleading text — for RNA-seq experiments Gemma stores a
 * ``Generic platform for Mus musculus, indexed by NCBI IDs``
 * stand-in array_design, and the technology_type field carries the
 * machine code (``GENELIST`` / ``SEQUENCING`` / ``ONECOLOR`` / …)
 * that's not the curator's vocabulary.
 *
 * Behaviour:
 *
 *   - Modality already shows up as the chip next to the title, so
 *     we don't repeat the technology_type code here.
 *   - For real wet-lab platforms (microarrays, named sequencers
 *     when Gemma has them) we render the platform name as a link
 *     to the Gemma platform record.
 *   - For Gemma stub platforms (``Generic_*`` short_name, or
 *     ``GENELIST`` / ``OTHER`` technology_type with a stub-shaped
 *     name) we suppress the misleading "Generic platform for…"
 *     text and surface only a subdued "Gemma platform: <link>" so
 *     the curator can still navigate to the platform record but
 *     isn't fooled into thinking the experiment is on that array.
 *   - When ``original_platform`` differs from ``platform`` (Gemma
 *     auto-switched the array_design — common for older platforms
 *     that have been merged into a successor) we surface it as
 *     "originally <name>" so the curator sees the source-DB
 *     identity. Linked when we have a short_name / id.
 */
function PlatformLine({
  technologyType,
  assay,
  platform,
  platformShortName,
  platformId,
  originalPlatform,
  originalPlatformShortName,
  originalPlatformId,
}: {
  technologyType: string;
  assay: string;
  platform: string;
  platformShortName: string;
  platformId: number | null;
  originalPlatform: string;
  originalPlatformShortName: string;
  originalPlatformId: number | null;
}) {
  // Gemma stub detection: technology_type is GENELIST / OTHER, or
  // the short_name starts with "Generic_". The latter catches stubs
  // that arrived without a tech_type field (older imports, manual
  // uploads). Empty platform string is also "no info to show".
  const tt = (technologyType || "").toUpperCase();
  const isStub =
    !platform ||
    tt === "GENELIST" ||
    tt === "OTHER" ||
    /^Generic[_ ]/i.test(platformShortName);
  const platformUrl = platformPageUrl(platformShortName, platformId);
  const origUrl = platformPageUrl(
    originalPlatformShortName,
    originalPlatformId,
  );
  const showOriginal =
    !!originalPlatform &&
    originalPlatform !== platform &&
    !/^Generic[_ ]/i.test(originalPlatformShortName);

  if (isStub) {
    // Suppress the misleading "Generic platform for…" name; surface
    // only a subdued link to the Gemma platform record so curators
    // can still get there. If there's no link target either, drop
    // the line entirely — the modality chip already says RNA-seq.
    if (!platformUrl) return null;
    return (
      <span className="text-slate-400">
        platform:{" "}
        <a
          href={platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 hover:text-slate-700 hover:underline"
          title="Gemma stand-in platform — open the platform record"
        >
          {platformShortName || "Gemma stub"}
          <span className="ml-0.5">↗</span>
        </a>
      </span>
    );
  }

  // Real platform — name as link.
  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
      {platformUrl ? (
        <a
          href={platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 hover:underline"
          title={`open platform ${platformShortName || ""} on Gemma`}
        >
          {platform}
          <span className="ml-0.5 text-[10px]">↗</span>
        </a>
      ) : (
        <span>{platform}</span>
      )}
      {showOriginal ? (
        <span className="text-slate-400 italic">
          (originally{" "}
          {origUrl ? (
            <a
              href={origUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-700 hover:underline not-italic"
            >
              {originalPlatform}
            </a>
          ) : (
            originalPlatform
          )}
          )
        </span>
      ) : null}
      {/* Fallback: surface the raw assay code only when the
          modality classifier isn't going to disambiguate (i.e.
          the chip would say "unknown"). Avoids the redundant
          GENELIST / ONECOLOR strings in the common case. */}
      {assay && tt === "" ? (
        <span className="text-slate-400">· {assay}</span>
      ) : null}
    </span>
  );
}

/**
 * Publish button. Flipping an experiment public is destructive in
 * the "everyone can see this now" sense — gate behind a
 * ConfirmModal. The mutation hits ``POST /rest/v2/datasets/{id}/publish``
 * (same URL as the curation mock; real Gemma exposes the
 * read-side `isPublic` on the EE VO so the disabled-when-public
 * branch below works against either).
 *
 * Disabled when:
 *   - there are uncommitted draft changes (commit first),
 *   - the experiment is already public.
 */
function PublishButton({ experimentId }: { experimentId: number | string }) {
  const { diff } = useDesignDraft();
  const me = useMe();
  const reviewer = me.data?.username ?? "";
  const visibility = useDatasetVisibility(experimentId);
  const publish = usePublishExperiment(experimentId, reviewer);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPublic = visibility.data?.is_public ?? false;
  // Force-disabled until the end-to-end publish pipeline is wired
  // up — the local POST works but the real Gemma side isn't ready
  // and shipping an active button that no-ops misleads curators
  // (design review 2026-05-25). Once the backend lands, drop the
  // ``notWiredUp`` override and restore the gated logic below.
  const notWiredUp = true;
  const dirty = diff.isDirty;
  const disabled =
    notWiredUp || isPublic || dirty || publish.isPending;

  const title = notWiredUp
    ? "publish pipeline isn't wired up yet — coming soon"
    : isPublic
      ? "already public"
      : dirty
        ? "save your draft changes before publishing"
        : publish.isPending
          ? "publishing…"
          : "make this experiment visible to all Gemma users";

  return (
    <>
      <button
        type="button"
        className="btn text-xs !px-2 !py-1"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        title={title}
      >
        {publish.isPending ? "publishing…" : isPublic ? "published" : "publish"}
      </button>
      <ConfirmModal
        open={confirming}
        title="Publish this experiment?"
        body="Makes it visible to all Gemma users. Unpublishing requires admin access in Gemma."
        confirmLabel="publish"
        cancelLabel="cancel"
        destructive={false}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          setErrorMsg(null);
          publish.mutate(undefined, {
            onError: (err) => {
              // Prefer the typed ApiError.detail (FastAPI's
              // ``{detail: "..."}`` payload — usually the actionable
              // bit, e.g. "missing required field X" or "already
              // published"). Fall back to the message for other
              // error shapes.
              const detail =
                err instanceof ApiError ? err.detail || err.message
                : err instanceof Error ? err.message
                : String(err);
              setErrorMsg(detail || "publish failed");
            },
          });
        }}
      />
      {errorMsg ? (
        <button
          type="button"
          className="text-xs text-rose-700 underline-offset-2 hover:underline max-w-md truncate text-left"
          title={errorMsg + " — click to dismiss"}
          onClick={() => setErrorMsg(null)}
        >
          publish failed: {errorMsg}
        </button>
      ) : null}
    </>
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

/** Banner chip surfacing the active Ticket context. Renders a
 *  back-link to the ticket detail page + the curator's position
 *  within the ticket's targets ("3/20"), with prev/next arrows
 *  walking the target list — same workflow as the group navigator
 *  for sets. */
export function TicketContextChip({
  experimentId,
  ticketContext,
}: {
  experimentId: number | string;
  ticketContext: string;
}) {
  const ticketId = parseInt(ticketContext, 10);
  const { data: ticket } = useTicket(Number.isFinite(ticketId) ? ticketId : null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  // Outside-click + Escape dismissal — same pattern as SetChip.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ticket) return null;
  const expTargets = ticket.targets.filter(
    (t) => t.target_type === "EXPRESSION_EXPERIMENT",
  );
  const currentNumericId =
    typeof experimentId === "number"
      ? experimentId
      : parseInt(String(experimentId), 10);
  const idx = expTargets.findIndex((t) => t.target_id === currentNumericId);
  const total = expTargets.length;
  const chipLabel =
    ticket.title.length > 32 ? `${ticket.title.slice(0, 32)}…` : ticket.title;

  // Prev / next navigation around the position counter — replaces
  // the popover-only "[ and ] keys to navigate" hint, which the reviewer
  // 2026-06-14 called "not that useful." The chip itself is now a
  // direct back-link to the ticket detail page (no popover trigger);
  // the popover hangs off the counter / ▾ glyph instead.
  const currentTarget = idx >= 0 ? expTargets[idx] : null;
  const prevTarget = idx > 0 ? expTargets[idx - 1] : null;
  const nextTarget = idx >= 0 && idx < total - 1 ? expTargets[idx + 1] : null;
  function navigateTo(targetId: number): void {
    navigate(`#/experiments/${targetId}?ticket=${ticketId}`);
  }
  // Layout per design review 2026-06-14:
  //   [← Ticket]   [Boss-critic 200 …]   ‹ 12/200 ›
  //   ───────────  ───────────────────  ───────────
  //   plain        dropdown trigger     counter + prev/next
  //   back-link    (opens popover)      (free-floating)
  //
  // The back-link is a bare "← Ticket" — no title baked in. The
  // title lives on the dropdown trigger box next to it. Three
  // separate concerns, three visually distinct affordances.
  // Status pill drops out of this row — surface lives in the
  // popover member list per-row.
  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-2 text-[11px]">
      <a
        href={`#/tickets/${ticketId}`}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer no-underline",
          "border-violet-300 bg-violet-100 text-violet-800",
          "hover:bg-violet-200 hover:no-underline",
          "dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
        )}
        title={`Back to ticket: ${ticket.title}`}
      >
        <span aria-hidden>←</span>
        <span>Ticket</span>
      </a>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer",
          "border-violet-300 bg-violet-100 text-violet-800",
          "hover:bg-violet-200",
          "dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
          "max-w-[20rem]",
          open && "ring-2 ring-offset-1 ring-violet-400/50",
        )}
        title={`${ticket.title} — click for ticket members`}
      >
        <span className="truncate">{chipLabel}</span>
        <span aria-hidden className="text-violet-700/70 dark:text-violet-300/70">
          ▾
        </span>
      </button>
      <button
        type="button"
        onClick={() => prevTarget && navigateTo(prevTarget.target_id)}
        disabled={!prevTarget}
        title="Previous member (also: [ key)"
        aria-label="previous member"
        className="text-[14px] font-bold leading-none text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-slate-100 dark:disabled:text-slate-600 px-0.5"
      >
        ‹
      </button>
      <span
        className="font-mono tabular-nums text-slate-700 dark:text-slate-200 select-none"
        title={`Member ${idx >= 0 ? idx + 1 : "?"} of ${total}`}
      >
        {idx >= 0 ? idx + 1 : "?"}/{total}
      </span>
      <button
        type="button"
        onClick={() => nextTarget && navigateTo(nextTarget.target_id)}
        disabled={!nextTarget}
        title="Next member (also: ] key)"
        aria-label="next member"
        className="text-[14px] font-bold leading-none text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-slate-100 dark:disabled:text-slate-600 px-0.5"
      >
        ›
      </button>
      <TicketTargetStatusDot status={currentTarget?.status ?? null} />
      {open ? (
        <TicketNavigatorPopover
          ticketId={ticketId}
          ticketTitle={ticket.title}
          targets={expTargets}
          currentExperimentId={currentNumericId}
          anchorRef={wrapRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

/** Tiny coloured circle conveying the current experiment's status on
 *  the ticket. Compact form-factor — fits in the header nav cluster
 *  next to ‹ N/M ›. Tooltip carries the human-readable label. */
function TicketTargetStatusDot({
  status,
}: {
  status: "NOT_DONE" | "UNDERWAY" | "DONE" | null | undefined;
}) {
  if (!status) return null;
  const map = {
    NOT_DONE: { cls: "bg-slate-400 dark:bg-slate-500", label: "Not started" },
    UNDERWAY: { cls: "bg-amber-500", label: "Started" },
    DONE: { cls: "bg-emerald-500", label: "Done" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${m.cls}`}
      title={`This experiment's status on the ticket: ${m.label}`}
      aria-label={m.label}
    />
  );
}

/** Anchored dropdown listing every EE target on the ticket, with the
 *  current one highlighted. Mirrors ``SetNavigatorPopover``'s shape
 *  (header / position readout / search filter / scrollable list) so
 *  the navigator feels the same whether the curator is set-walking
 *  or ticket-walking. The set version handles screening-group
 *  placeholders + uncommitted-draft hints that don't apply to
 *  tickets, so we keep this as a sibling rather than refactoring
 *  ``SetMemberRow`` into a single generic. */
function TicketNavigatorPopover({
  ticketId,
  ticketTitle,
  targets,
  currentExperimentId,
  anchorRef,
  onClose,
}: {
  ticketId: number;
  ticketTitle: string;
  targets: Array<{
    target_id: number;
    display_label?: string;
    display_name?: string;
    status?: "NOT_DONE" | "UNDERWAY" | "DONE";
  }>;
  currentExperimentId: number;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Vertical-flip if too close to bottom of viewport (same heuristic
  // as SetNavigatorPopover; popover is similar height).
  const [flipUp, setFlipUp] = useState(false);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const POPOVER_H_ESTIMATE = 380;
    const margin = 8;
    setFlipUp(
      rect.bottom + POPOVER_H_ESTIMATE + margin > window.innerHeight &&
        rect.top > POPOVER_H_ESTIMATE,
    );
  }, [anchorRef]);

  const currentIdx = targets.findIndex(
    (t) => t.target_id === currentExperimentId,
  );

  // Open onto the current experiment — centre its row in the list
  // viewport on mount instead of always starting at the top, so the
  // popover reflects the "30/200" position the curator is sitting on.
  // Scroll is contained to the <ul> (set scrollTop directly) so it
  // never nudges the page or the absolutely-positioned popover.
  const listRef = useRef<HTMLUListElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = currentRowRef.current;
    if (!list || !row) return;
    const offset =
      row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
  }, []);

  const goToIndex = useCallback(
    (idx: number) => {
      if (targets.length === 0) return;
      const wrapped = ((idx % targets.length) + targets.length) % targets.length;
      const target = targets[wrapped];
      if (!target) return;
      window.location.hash = `#/experiments/${target.target_id}?ticket=${ticketId}`;
      onClose();
    },
    [targets, ticketId, onClose],
  );

  // [ / ] keyboard prev-next while the popover is open. Same UX
  // as SetNavigatorPopover; curator never types literal brackets
  // when filtering by accession.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "[") {
        e.preventDefault();
        goToIndex(currentIdx - 1);
      } else if (e.key === "]") {
        e.preventDefault();
        goToIndex(currentIdx + 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goToIndex, currentIdx]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter(
      (t) =>
        (t.display_label ?? "").toLowerCase().includes(q) ||
        (t.display_name ?? "").toLowerCase().includes(q),
    );
  }, [targets, query]);

  return (
    <div
      role="dialog"
      aria-label={`Ticket ${ticketId} navigator`}
      className={cn(
        "absolute z-30 left-0 w-96 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg text-xs dark:bg-slate-900 dark:border-slate-700",
        flipUp ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {ticketTitle}
          </span>
          <span className="ml-auto">
            <a
              href={`#/tickets/${ticketId}`}
              className="text-blue-700 hover:underline text-[11px] dark:text-blue-300"
              onClick={onClose}
            >
              Open ticket ↗
            </a>
          </span>
        </div>
        {/* Progress indication — Design review 2026-06-14: the popover should
            still surface the curator's position in the ticket.
            Dropped the "[ and ] keys to navigate" tail since those
            are now click affordances next to the chip. */}
        {targets.length > 0 ? (
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {currentIdx >= 0
              ? `${currentIdx + 1} of ${targets.length}`
              : `not on ticket · ${targets.length} member${
                  targets.length === 1 ? "" : "s"
                }`}
          </div>
        ) : null}
      </div>
      <div className="p-2 border-b border-slate-100 dark:border-slate-700">
        <input
          type="search"
          placeholder="Filter by accession or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400"
          autoFocus
        />
      </div>
      <ul
        ref={listRef}
        className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            No members match "{query}".
          </li>
        ) : (
          filtered.map((t) => (
            <TicketMemberRow
              key={t.target_id}
              target={t}
              isCurrent={t.target_id === currentExperimentId}
              rowRef={
                t.target_id === currentExperimentId ? currentRowRef : undefined
              }
              onClick={() => {
                window.location.hash = `#/experiments/${t.target_id}?ticket=${ticketId}`;
                onClose();
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function TicketMemberRow({
  target,
  isCurrent,
  rowRef,
  onClick,
}: {
  target: {
    target_id: number;
    display_label?: string;
    display_name?: string;
    status?: "NOT_DONE" | "UNDERWAY" | "DONE";
  };
  isCurrent: boolean;
  rowRef?: RefObject<HTMLLIElement>;
  onClick: () => void;
}) {
  return (
    <li ref={rowRef}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
          "hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800",
          isCurrent &&
            "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50",
        )}
        title={`Open ${target.display_label ?? target.target_id}`}
      >
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums shrink-0",
            isCurrent
              ? "font-semibold text-blue-900 dark:text-blue-200"
              : "text-slate-700 dark:text-slate-200",
          )}
        >
          {target.display_label ?? String(target.target_id)}
        </span>
        <span className="flex-1 truncate text-slate-600 dark:text-slate-400 text-[11px]">
          {target.display_name || "(no title)"}
        </span>
        {target.status ? (
          // Status disc — same visual language as the set-navigator
          // popover. Per design review 2026-06-11: "we used to have little
          // circles." The earlier uppercase text label drifted from
          // the set-navigator's disc convention.
          <StatusDisc
            tone={
              target.status === "DONE"
                ? "done"
                : target.status === "UNDERWAY"
                  ? "draft"
                  : "untouched"
            }
            title={
              target.status === "DONE"
                ? "done"
                : target.status === "UNDERWAY"
                  ? "in progress"
                  : "todo"
            }
          />
        ) : null}
      </button>
    </li>
  );
}
