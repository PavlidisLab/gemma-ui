import { useState, type ReactNode } from "react";
import { Pill } from "@/components/ui/Pill";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ApiError } from "@/api/client";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useCurationDetails } from "@/api/curation";
import { useLogout, useMe } from "@/api/session";
import { useDatasetVisibility, usePublishExperiment } from "@/api/datasets";
import { SettingsMenu } from "@/features/settings/SettingsMenu";
import { experimentPageUrl, platformPageUrl } from "@/lib/gemmaUrls";
import {
  inferModality,
  modalityLabel,
  type Modality,
} from "@/features/experiment/modality";
import { cn } from "@/lib/cn";
import type { ExternalSource } from "@/features/experiment/types";
import { useExperimentGroups } from "@/api/workflow";
import { workflowRoute } from "@/routes";
import type { GroupType } from "@/api/workflowTypes";

export type TabId =
  | "overview"
  | "design"
  | "samples"
  | "diagnostics"
  | "qt"
  | "history"
  | "pipeline";

// Order mirrors the Confluence Experiment Checklist workflow:
// design / sample details before diagnostics, QT next, history last.
// Tags moved into the Overview tab (curator-attached + inferred chips
// share one editable surface there) — the dedicated Tags tab was
// retired 2026-04-30.
export const EXPERIMENT_TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "design", label: "Design setup" },
  { id: "samples", label: "Sample details" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "qt", label: "Quantitation types" },
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
  commitBar,
}: {
  experimentId: number;
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
  /** Inline commit-status chip rendered in the action row. App-level
   *  composition pulls in the design draft + validation. Renders
   *  null when the draft is clean, so passing it always is fine. */
  commitBar?: ReactNode;
}) {
  const sourceLink = externalSourceLink(externalSource);
  // ``experimentPageUrl`` reads ``VITE_GEMMA_WEB_URL`` so a staging
  // / preview build (e.g. https://staging-gemma.msl.ubc.ca) just
  // sets the env var; no prop plumbing.
  const gemmaUrl = experimentPageUrl(experimentId);

  return (
    <section className="bg-white border-b border-slate-200">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-3 flex gap-4 flex-wrap items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-lg font-semibold text-slate-900">
              <a
                href={gemmaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 hover:underline"
                title="open on Gemma"
              >
                {shortName}
              </a>
            </h1>
            <ModalityIndicator />
            <span className="text-sm text-slate-500">{title}</span>
          </div>
          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>{taxon}</span>
            <span>{nSamples} samples</span>
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
                  {externalSource.database}: {externalSource.accession} ↗
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
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0">
          {commitBar}
          <ExperimentGroupChips experimentId={experimentId} />
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
          <PublishButton experimentId={experimentId} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1800px] px-4">
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
          {EXPERIMENT_TABS.map((t) => (
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
        </nav>
      </div>
    </section>
  );
}

/**
 * Chips listing the workflow Groups (sets) this experiment is a
 * member of. Renders inline in the banner action row, before the
 * Status button. Each chip is a hash-link to the matching Workflow
 * tab view; the popup-navigator behaviour is deferred — for now
 * "Sets are a link to the group" is enough for curators to hop
 * between members via the workflow surface.
 *
 * Hidden when the experiment isn't in any group (most freshly-
 * loaded experiments). Pluralised label ("Set" vs "Sets") so a
 * single membership doesn't read as a count.
 */
function ExperimentGroupChips({
  experimentId,
}: {
  experimentId: number;
}) {
  const { data: groups } = useExperimentGroups(experimentId);
  if (!groups || groups.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500 uppercase tracking-wider text-[10px]">
        {groups.length === 1 ? "Set" : "Sets"}
      </span>
      <span className="inline-flex items-center gap-1 flex-wrap">
        {groups.map((g) => (
          <a
            key={g.id}
            href={workflowRoute(g.id)}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer hover:underline",
              groupTypeChipCls(g.type),
            )}
            title={`${g.name} · ${g.type} · ${g.member_count} member${
              g.member_count === 1 ? "" : "s"
            } — open in workflow`}
          >
            <span className="font-medium truncate max-w-[14ch]">{g.name}</span>
            <span className="text-[10px] text-slate-500 tabular-nums">
              {g.member_count}
            </span>
          </a>
        ))}
      </span>
    </span>
  );
}

/** Tone the group chip by its workflow type. Mirrors the funnel
 *  intent — screening = neutral early-stage, pipeline = active
 *  processing, review = closing out. */
function groupTypeChipCls(type: GroupType): string {
  switch (type) {
    case "screening":
      return "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100";
    case "pipeline":
      return "bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100";
    case "review":
      return "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100";
    default:
      return "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100";
  }
}

function LogoutButton() {
  const logout = useLogout();
  return (
    <button
      type="button"
      className="text-slate-500 hover:text-slate-900 underline disabled:opacity-50"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      title="sign out"
    >
      {logout.isPending ? "signing out…" : "sign out"}
    </button>
  );
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
 * Banner button that toggles the curation-status drawer and
 * surfaces a curator's headline state on the experiment:
 *
 *   - **rose ring** when the experiment is flagged `troubled`
 *     (highest priority: data issues a curator needs to know
 *     about before working on this).
 *   - **amber ring** when flagged `needs_attention` (a curator
 *     needs to look at it; lower priority than troubled).
 *   - **amber dot** when a curation note exists (text in the
 *     scratchpad).
 *   - tooltip with a one-line summary so a curator can decide
 *     whether to open the drawer.
 *
 * The drawer itself surfaces the full CurationDetails — note +
 * both flags + per-aspect last-update metadata.
 */
function NotesButton({
  experimentId,
  open,
  onToggle,
}: {
  experimentId: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { data: details } = useCurationDetails(experimentId);
  const hasNote = !!details?.curation_note?.trim();
  const troubled = !!details?.troubled;
  const needsAttention = !!details?.needs_attention;

  const ringCls = troubled
    ? "ring-2 ring-rose-400"
    : needsAttention || open || hasNote
      ? "ring-2 ring-amber-300"
      : "";

  const titleParts: string[] = [];
  if (troubled) titleParts.push("troubled");
  if (needsAttention) titleParts.push("needs attention");
  if (hasNote) {
    const preview = details!.curation_note.split(/\r?\n/, 1)[0].slice(0, 120);
    const lines = details!.curation_note.split(/\r?\n/).length;
    titleParts.push(
      `${lines} line${lines === 1 ? "" : "s"} of notes — first line: ${preview}`,
    );
  }
  const title =
    titleParts.length === 0
      ? open
        ? "close curation status"
        : "open curation status"
      : titleParts.join(" · ");

  return (
    <button
      type="button"
      className={cn("btn ghost relative", ringCls)}
      onClick={onToggle}
      title={title}
    >
      Status
      {troubled ? (
        <span
          className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-rose-500 align-middle"
          aria-label="troubled"
        />
      ) : needsAttention ? (
        <span
          className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle"
          aria-label="needs attention"
        />
      ) : hasNote ? (
        <span
          className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500/60 align-middle"
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
 * ConfirmModal. The mutation hits the mock's
 * ``POST /rest/v2/datasets/{id}/publish`` endpoint; once wired
 * against real Gemma the same surface should work (subject to the
 * REST gap noted in TODO §14).
 *
 * Disabled when:
 *   - there are uncommitted draft changes (commit first),
 *   - the experiment is already public.
 */
function PublishButton({ experimentId }: { experimentId: number }) {
  const { diff } = useDesignDraft();
  const me = useMe();
  const reviewer = me.data?.username ?? "";
  const visibility = useDatasetVisibility(experimentId);
  const publish = usePublishExperiment(experimentId, reviewer);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPublic = visibility.data?.is_public ?? false;
  const dirty = diff.isDirty;
  const disabled = isPublic || dirty || publish.isPending;

  const title = isPublic
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
        className="btn primary"
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


/** Header bar above the banner. */
export function TopBar({
  experimentId,
  experimentShortName,
  reviewer,
  status: statusOverride,
}: {
  experimentId: number;
  experimentShortName: string;
  reviewer: string;
  /** Optional override. Normally the bar reads visibility from the
   *  curation API itself (mock-tracked; see TODO-gemma-api §14 for
   *  the real-Gemma gap) and renders ``"public"`` / ``"private"``
   *  / ``"unknown"`` automatically. Pass an explicit value only if
   *  you need to force a state (e.g. tests, screenshot fixtures). */
  status?: "private" | "public" | "unknown";
}) {
  const gemmaUrl = experimentPageUrl(experimentId);
  // Visibility query is cheap and cached by react-query, so it's
  // safe to fire here even though the bar lives high in the tree.
  const visibility = useDatasetVisibility(experimentId);
  const status: "private" | "public" | "unknown" =
    statusOverride ??
    (visibility.isLoading || visibility.error
      ? "unknown"
      : visibility.data?.is_public
        ? "public"
        : "private");
  return (
    <header className="border-b border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Gemma</span>
          <span className="text-xs text-slate-400">/</span>
          {/*
            Renamed from "Curation" → "Experiments" — the destination
            is the experiment-list landing page, so the breadcrumb
            now reads "Gemma / Experiments / GSE..." which matches
            what the user gets when they click.
          */}
          <a
            href="#/"
            className="text-sm text-slate-600 hover:underline"
            title="back to experiment list"
          >
            Experiments
          </a>
          <span className="text-xs text-slate-400">/</span>
          <a
            href={gemmaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-700 hover:underline"
            title="open on Gemma"
          >
            {experimentShortName}
          </a>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span
            title={
              status === "unknown"
                ? "Public/private state is not yet retrievable from Gemma's REST API. Verify on Gemma if uncertain."
                : status === "public"
                  ? "Public — visible to all Gemma users. Edit with care; consider making private first."
                  : "Private — only visible to curators."
            }
          >
            <Pill
              variant={status === "public" ? "rejected" : status === "private" ? "accepted" : "needs"}
            >
              {status === "unknown" ? "status unknown" : status}
            </Pill>
          </span>
          <span>
            signed in as <span className="font-medium">{reviewer}</span>
          </span>
          <SettingsMenu />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
