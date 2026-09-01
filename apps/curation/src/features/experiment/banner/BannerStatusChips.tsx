import { useCurationDetails } from "@/api/curation";
import { useDatasetVisibility } from "@/api/datasets";
import { cn } from "@/lib/cn";

/** Curation-status chips and the notes toggle. Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged. */

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
export function BannerStatusChips({
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
            ? "emerald"
            : visibilityState === "private"
              ? "rose"
              : "slate"
        }
        // 🛑 "private" names a STATE and sits beside "troubled" and
        // "needs attention", which name WORK. A curator who has just
        // committed reads a state chip as nothing to do and stops —
        // and an unpublished experiment is not a finished one. Paul:
        // "it should have some indication that this still has to be
        // done, otherwise curator will think they are done", and then:
        // "it should be more obvious!"
        //
        // So the private case says what is outstanding, in the cluster
        // whose other members are outstanding things. "public" stays a
        // plain state — there is nothing left to do there.
        label={
          visibilityState === "unknown"
            ? "status unknown"
            : visibilityState === "private"
              ? "not published"
              : visibilityState
        }
        title={
          visibilityState === "public"
            ? "Public — visible to all Gemma users."
            : visibilityState === "private"
              ? "STILL TO DO — not published, so this curation is not finished. Only curators can see it."
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
export function NotesButton({
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
