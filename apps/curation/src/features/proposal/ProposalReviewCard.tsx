import { useState } from "react";
import { cn } from "@/lib/cn";
import { Term } from "@/components/ui/Term";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { FactorProposal, TagProposal } from "@/api/types";
import type { ProposalDisposition } from "./proposalDispositions";

/**
 * Per-element review card for the new proposal-review surface —
 * mirrors ``CompactFindingCard`` (audit sidebar) so the curator
 * uses the same chrome to review proposals as they do for audits.
 *
 * Sky tint for factor cards, emerald for tag cards. Header shows
 * a small status badge (+/✎/✕/⏸ glyph) keyed to the current
 * disposition. Body is a read-only chip view of what's proposed;
 * the curator does the actual editing in the Design / Tags
 * panels — this card just guides the disposition decision.
 *
 * Phase 1: retain / reject / park are user-pickable; ``edited``
 * is reserved for the future draft-diff path. Per Paul
 * 2026-05-21: "we need to record what was rejected, retained,
 * edited from the proposal (sent back to agent to learn)".
 */

type CardKind = "factor" | "tag";

interface BaseProps {
  disposition: ProposalDisposition;
  onDispose: (d: ProposalDisposition) => void;
  /** Optional curator note attached to this element's disposition.
   *  Defaults to empty; the curator can toggle a tiny inline
   *  textarea via the "add note" affordance. */
  note?: string;
  onNoteChange?: (note: string) => void;
}

export function FactorReviewCard({
  factor,
  disposition,
  onDispose,
  note,
  onNoteChange,
}: BaseProps & { factor: FactorProposal }) {
  const fvs = factor.factor_values ?? [];
  const fvCount = fvs.length;
  const isContinuous = factor.factor_type === "continuous";
  const label =
    factor.name_in_design || factor.category?.label || "factor";
  return (
    <ReviewCardShell
      kind="factor"
      disposition={disposition}
      onDispose={onDispose}
      note={note}
      onNoteChange={onNoteChange}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-semibold text-[12px] text-slate-800 dark:text-slate-100">
          {label}
        </span>
        {factor.category?.uri ? (
          <Term uri={factor.category.uri} asLink={false}>
            {factor.category.label || ""}
          </Term>
        ) : (
          <span className="italic text-stone-500 text-[11px]">
            {factor.category?.label || "(no category)"}
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 ml-auto">
          {isContinuous ? "continuous" : `${fvCount} level${fvCount === 1 ? "" : "s"}`}
        </span>
      </div>
      {!isContinuous && fvs.length > 0 ? (
        <ul className="space-y-0.5 pl-1">
          {[...fvs]
            .sort((a, b) => (a.is_baseline ? 1 : 0) - (b.is_baseline ? 1 : 0))
            .map((fv, i) => {
              const lab = (fv.free_text_label || "").trim() || "(unlabeled)";
              const n = fv.biomaterial_short_names?.length ?? 0;
              return (
                <li
                  key={i}
                  className="flex items-baseline gap-1.5 text-[11px]"
                >
                  <span
                    className={cn(
                      "w-2.5 inline-block text-center shrink-0 leading-none",
                      fv.is_baseline
                        ? "text-amber-500 dark:text-amber-400"
                        : "text-sky-500/80 dark:text-sky-400/80",
                    )}
                    title={
                      fv.is_baseline
                        ? "baseline (reference level)"
                        : "factor level"
                    }
                  >
                    {fv.is_baseline ? "▂" : "○"}
                  </span>
                  <span className="flex-1 min-w-0 break-words text-slate-700 dark:text-slate-200">
                    {lab}
                  </span>
                  {n > 0 ? (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono shrink-0">
                      ({n})
                    </span>
                  ) : null}
                </li>
              );
            })}
        </ul>
      ) : null}
    </ReviewCardShell>
  );
}

export function TagReviewCard({
  tag,
  disposition,
  onDispose,
  note,
  onNoteChange,
}: BaseProps & { tag: TagProposal }) {
  return (
    <ReviewCardShell
      kind="tag"
      disposition={disposition}
      onDispose={onDispose}
      note={note}
      onNoteChange={onNoteChange}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <Term uri={tag.category?.uri ?? null} asLink={false}>
          {tag.category?.label || ""}
        </Term>
        <span className="text-slate-400 dark:text-slate-500">:</span>
        <Term uri={tag.value?.uri ?? null} asLink={false}>
          {tag.value?.label || ""}
        </Term>
      </div>
      {tag.evidence_quote ? (
        <div className="text-[10px] italic text-slate-500 dark:text-slate-400 border-l-2 border-slate-300 dark:border-slate-600 pl-2 line-clamp-2">
          “{tag.evidence_quote}”
        </div>
      ) : null}
    </ReviewCardShell>
  );
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

function ReviewCardShell({
  kind,
  disposition,
  onDispose,
  children,
  note,
  onNoteChange,
}: {
  kind: CardKind;
  disposition: ProposalDisposition;
  onDispose: (d: ProposalDisposition) => void;
  children: React.ReactNode;
  note?: string;
  onNoteChange?: (note: string) => void;
}) {
  const tint =
    kind === "factor"
      ? "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/40"
      : "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30";
  const isPending = disposition === "pending";
  const [noteOpen, setNoteOpen] = useState(!!note && note.length > 0);
  return (
    <div
      className={cn(
        // Inline rounded/border instead of ``card`` so the
        // ``html.dark .card`` global doesn't override the dark
        // kind-tint. Per Paul 2026-05-21.
        "rounded-lg border p-2 text-xs space-y-1.5",
        tint,
        !isPending && "opacity-60 hover:opacity-100 transition-opacity",
      )}
    >
      <div className="flex items-start gap-1.5">
        <DispositionBadge disposition={disposition} kind={kind} />
        <div className="flex-1 min-w-0 space-y-1">{children}</div>
      </div>
      <ActionButtons
        disposition={disposition}
        onDispose={onDispose}
        kind={kind}
        noteOpen={noteOpen}
        hasNote={!!note && note.trim().length > 0}
        onToggleNote={
          onNoteChange ? () => setNoteOpen((v) => !v) : undefined
        }
      />
      {noteOpen && onNoteChange ? (
        <textarea
          value={note ?? ""}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="optional note — context, doubts, why you decided this way…"
          rows={2}
          className={cn(
            "w-full text-[11px] rounded border px-1.5 py-1 resize-y leading-snug",
            "bg-white dark:bg-slate-900",
            "border-slate-300 dark:border-slate-600",
            "text-slate-700 dark:text-slate-200",
            "placeholder:text-slate-400 dark:placeholder:text-slate-500",
            "focus:outline-none focus:ring-1 focus:ring-sky-400",
          )}
        />
      ) : null}
    </div>
  );
}

function DispositionBadge({
  disposition,
  kind,
}: {
  disposition: ProposalDisposition;
  kind: CardKind;
}) {
  const config: Record<
    ProposalDisposition,
    { glyph: string; cls: string; label: string }
  > = {
    pending: {
      glyph: "+",
      cls:
        kind === "factor"
          ? "bg-sky-600 text-white border border-sky-700"
          : "bg-emerald-600 text-white border border-emerald-700",
      label: `proposed ${kind} — pending your review`,
    },
    retained: {
      glyph: "✓",
      cls: "bg-emerald-600 text-white border border-emerald-700",
      label: "retained as proposed",
    },
    edited: {
      glyph: "✎",
      cls: "bg-amber-500 text-amber-950 border border-amber-600",
      label: "kept but edited from the proposal",
    },
    rejected: {
      glyph: "✕",
      cls: "bg-rose-600 text-white border border-rose-700",
      label: "rejected — removed from design",
    },
    parked: {
      glyph: "⏸",
      cls: "bg-slate-500 text-white border border-slate-600",
      label: "parked — defer decision",
    },
  };
  const c = config[disposition];
  return <StatusBadge glyph={c.glyph} cls={c.cls} label={c.label} />;
}

function ActionButtons({
  disposition,
  onDispose,
  kind,
  noteOpen,
  hasNote,
  onToggleNote,
}: {
  disposition: ProposalDisposition;
  onDispose: (d: ProposalDisposition) => void;
  kind: CardKind;
  noteOpen: boolean;
  hasNote: boolean;
  /** When undefined, the "note" affordance doesn't render — used
   *  when the parent didn't wire a note handler. */
  onToggleNote?: () => void;
}) {
  const isPending = disposition === "pending";
  const noteButton = onToggleNote ? (
    <button
      type="button"
      onClick={onToggleNote}
      title={
        noteOpen
          ? "hide note"
          : hasNote
            ? "show note"
            : "add an optional note (why you decided this way)"
      }
      className={cn(
        "ml-auto text-[10px] underline-offset-2 hover:underline",
        hasNote
          ? "text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
      )}
    >
      {noteOpen ? "✎ hide note" : hasNote ? "✎ note" : "+ note"}
    </button>
  ) : null;

  if (!isPending) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">
          {disposition === "retained" && "retained"}
          {disposition === "edited" && "kept with edits"}
          {disposition === "rejected" && "rejected"}
          {disposition === "parked" && "parked"}
        </span>
        {noteButton}
        <button
          type="button"
          onClick={() => onDispose("pending")}
          className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 underline-offset-2 hover:underline"
          title="reopen for review"
        >
          undo
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      <button
        type="button"
        onClick={() => onDispose("retained")}
        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
        title={`Keep this proposed ${kind} as-is.`}
      >
        retain
      </button>
      <button
        type="button"
        onClick={() => onDispose("rejected")}
        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-rose-700 border border-rose-300 hover:bg-rose-50 dark:bg-slate-800 dark:text-rose-300 dark:border-rose-700 dark:hover:bg-rose-900/30"
        title={`Reject this proposed ${kind} — remove it from the design.`}
      >
        reject
      </button>
      <button
        type="button"
        onClick={() => onDispose("parked")}
        className="px-2 py-0.5 rounded text-[11px] border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        title="Defer the decision; commit gate stays active."
      >
        park
      </button>
      {noteButton}
    </div>
  );
}
