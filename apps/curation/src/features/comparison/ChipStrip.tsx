import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  isPairAllowed,
  isSourceValidInSlot,
  modeOf,
  sourceLabel,
  sourceTooltip,
  type SlotKind,
  type Source,
} from "./sources";
import { useChipState } from "./useChipState";
import {
  useCurations,
  useSourceUniverse,
  type AvailabilityMap,
  type CurationRow,
} from "./useSourceAvailability";
import { useChipDiffSummary } from "./useChipDiff";
import type { SemanticDiffSummary } from "@/features/design/diff";

/** Baseline / comparator chip-strip — the canonical "what am I
 *  looking at?" surface for the curation comparison view. Replaces
 *  the amber ``ComparisonModeBanner``.
 *
 *  Spec: ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``. */
export function ChipStrip({
  experimentId,
  flow,
  tab,
  groupContext,
  ticketContext,
}: {
  experimentId: number | string;
  flow: "edit" | "review";
  tab?: string;
  groupContext?: string;
  ticketContext?: string;
}) {
  const { baseline, comparator, setBaseline, setComparator } = useChipState({
    experimentId,
    flow,
    tab,
    groupContext,
    ticketContext,
  });
  const universe = useSourceUniverse(experimentId);
  const mode = modeOf(baseline, comparator);
  const diff = useChipDiffSummary(experimentId, baseline, comparator);
  // Full curation payloads — used only to derive the self-documenting
  // run-provenance tooltip on the value chips (agent runs). Cheap +
  // cached; shares the query with the finding panel.
  const curations = useCurations(experimentId).data ?? [];

  // In edit mode the curator is working a calibration package; the
  // baseline they're editing IS the package's anchored state. Spec
  // section "Edit vs review mode" — baseline becomes informational
  // (display-only), comparator stays selectable. In review mode both
  // chips stay selectable so the curator can audit / compare freely.
  const baselineLocked = flow === "edit";

  // Mode pill ("Reviewing proposal" / "Editing local design") dropped
  // 2026-06-14 per design review: "Perhaps because the 'reviewing proposal'
  // might not even be needed. It's just curation, what makes it
  // special is what we're comparing to." The chip pair below already
  // communicates the mode — the curator reads "BASELINE Gemma · AUDIT
  // agent original proposal" and infers "I'm reviewing the agent's
  // proposal" without a redundant pill.

  return (
    <div
      className="inline-flex items-center gap-2 text-[11px]"
      role="region"
      aria-label="Comparison source selection"
    >
      {baselineLocked ? (
        <ChipLabel slotLabel="Baseline" value={baseline} curations={curations} />
      ) : (
        <ChipDropdown
          slot="baseline"
          slotLabel="Baseline"
          value={baseline}
          otherSlotValue={comparator}
          onChange={setBaseline}
          sources={universe.sources}
          availability={universe.availability}
          curations={curations}
        />
      )}
      <ChipDropdown
        slot="comparator"
        slotLabel={comparatorSlotLabel(mode)}
        value={comparator}
        otherSlotValue={baseline}
        onChange={setComparator}
        sources={universe.sources}
        availability={universe.availability}
        curations={curations}
      />
      <DiffSummaryReadout
        summary={diff.summary}
        isLoading={diff.isLoading}
      />
    </div>
  );
}

/** Compact "Δ +2 tags, +1 factor" readout. Renders only when both
 *  slots resolve to a Design — i.e. an actual diff is computable.
 *  Empty diff (counts all zero) is the regression-test signal:
 *  matching sources show "no differences" in green. */
function DiffSummaryReadout({
  summary,
  isLoading,
}: {
  summary: SemanticDiffSummary | null;
  isLoading: boolean;
}) {
  if (summary === null) {
    return (
      <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-400">
        {isLoading ? "diffing…" : ""}
      </span>
    );
  }
  if (summary.empty) {
    return (
      <span className="ml-auto text-[11px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold">
        no differences
      </span>
    );
  }
  const tagParts: string[] = [];
  if (summary.addedTags) tagParts.push(`+${summary.addedTags}`);
  if (summary.removedTags) tagParts.push(`-${summary.removedTags}`);
  if (summary.modifiedTags) tagParts.push(`~${summary.modifiedTags}`);
  const factorParts: string[] = [];
  if (summary.addedFactors) factorParts.push(`+${summary.addedFactors}`);
  if (summary.removedFactors) factorParts.push(`-${summary.removedFactors}`);
  if (summary.modifiedFactors) factorParts.push(`~${summary.modifiedFactors}`);

  return (
    <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-baseline gap-3">
      {tagParts.length ? (
        <span>
          tags <span className="font-mono font-semibold">{tagParts.join(" ")}</span>
        </span>
      ) : null}
      {factorParts.length ? (
        <span>
          factors <span className="font-mono font-semibold">{factorParts.join(" ")}</span>
        </span>
      ) : null}
    </span>
  );
}

/** Read-only chip — same visual frame as a ChipDropdown but no
 *  dropdown affordance. Used for the baseline slot in edit mode
 *  per the spec. Keeps the slot's palette so the strip stays
 *  visually coherent; dashed border signals "not interactive". */
function ChipLabel({
  slotLabel,
  value,
  curations,
}: {
  slotLabel: string;
  value: Source;
  curations?: readonly CurationRow[];
}) {
  const palette = SLOT_PALETTE.baseline;
  // Prefer the self-documenting run-provenance tooltip when the value
  // is an agent run; fall back to the fixed-baseline explanation.
  const provTitle = sourceTooltip(value, curations);
  return (
    <div
      className="relative inline-flex items-center gap-2"
      title="Baseline is fixed in curation mode — switch to a review context to change it"
    >
      <span
        className={cn(
          "text-[12px] uppercase tracking-wide font-semibold",
          palette.label,
        )}
      >
        {slotLabel}
      </span>
      <span
        className={cn(
          // Matches ChipDropdown sizing so locked + selectable chips
          // line up visually in the strip.
          "inline-flex items-center gap-1 px-3 py-1 rounded border border-dashed text-[14px] font-medium opacity-90",
          palette.chip,
        )}
        title={provTitle || undefined}
      >
        {sourceLabel(value, curations)}
      </span>
    </div>
  );
}

/** The comparator slot's leading label mirrors the spec's
 *  panel-header table: a "proposes" comparator reads as "Proposal",
 *  a "differs from baseline" comparator reads as "Audit". Identity
 *  pair is the regression check. Empty / bare modes fall back to
 *  the generic "Comparator" since no specific framing applies yet. */
function comparatorSlotLabel(mode: ReturnType<typeof modeOf>): string {
  switch (mode) {
    case "proposal":
      return "Proposal";
    case "audit":
      return "Audit";
    case "identity":
      return "Regression check";
    case "bare":
    case "degenerate":
      return "Comparator";
  }
}

/** Tailwind palette per slot — emerald = canonical baseline state;
 *  amber = the audit/proposal/comparator. Mirrors the spec's
 *  "who's saying what" framing (the baseline is the established
 *  truth; the comparator is the thing being claimed against it). */
const SLOT_PALETTE: Record<SlotKind, { chip: string; label: string }> = {
  baseline: {
    chip:
      "border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-100 dark:hover:border-emerald-600",
    label: "text-emerald-700 dark:text-emerald-300",
  },
  comparator: {
    chip:
      "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100 dark:hover:border-amber-600",
    label: "text-amber-700 dark:text-amber-300",
  },
};

function ChipDropdown({
  slot,
  slotLabel,
  value,
  otherSlotValue,
  onChange,
  sources,
  availability,
  curations,
}: {
  slot: SlotKind;
  slotLabel: string;
  value: Source;
  otherSlotValue: Source;
  onChange: (s: Source) => void;
  sources: readonly Source[];
  availability: AvailabilityMap;
  curations?: readonly CurationRow[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const palette = SLOT_PALETTE[slot];

  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">
      <span
        className={cn(
          "text-[12px] uppercase tracking-wide font-semibold",
          palette.label,
        )}
      >
        {slotLabel}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // Larger trigger — Design review 2026-05-27 round 2: "the little
          // triggers to change the baseline/audit are too small again".
          // Bumped padding + font size so the clickable target reads
          // as a button at a glance.
          "inline-flex items-center gap-1.5 px-3 py-1 rounded border text-[14px] font-medium",
          palette.chip,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={sourceTooltip(value, curations) || undefined}
      >
        <span>{sourceLabel(value, curations)}</span>
        <span className="opacity-70 text-[11px]">▾</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={`${slotLabel} source`}
          className="absolute left-0 top-full mt-1 z-50 min-w-[14rem] rounded border border-slate-300 bg-white shadow-lg py-1 text-[13px] dark:bg-slate-800 dark:border-slate-600"
        >
          {sources.filter((s) => {
            if (!isSourceValidInSlot(slot, s)) return false;
            // Hide unavailable options entirely (per 2026-06-01
            // feedback: "only the relevant options are to be shown").
            // Always show the currently-selected source so the
            // dropdown doesn't lose its anchor on a transient
            // availability change.
            const avail = availability[s];
            return (avail?.available ?? false) || s === value;
          }).map((s) => {
            const pairValid =
              slot === "baseline"
                ? isPairAllowed(s, otherSlotValue)
                : isPairAllowed(otherSlotValue, s);
            const avail = availability[s] ?? {
              available: false,
              reason: "unknown source",
              comingSoon: false,
            };
            const disabled = !pairValid || !avail.available;
            const isSelected = s === value;
            return (
              <button
                type="button"
                key={s}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onChange(s);
                  setOpen(false);
                }}
                title={
                  menuItemTooltip(s, slot, true, pairValid, avail) ??
                  (sourceTooltip(s, curations) || undefined)
                }
                className={cn(
                  "w-full text-left px-3 py-1.5 flex items-baseline justify-between gap-3",
                  disabled
                    ? "text-slate-400 italic cursor-not-allowed dark:text-slate-500"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700",
                  isSelected && !disabled && "font-semibold",
                )}
                role="option"
                aria-selected={isSelected}
                aria-disabled={disabled}
              >
                <span>
                  {sourceLabel(s, curations)}
                  {avail?.comingSoon ? (
                    <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
                      coming soon
                    </span>
                  ) : null}
                </span>
                {isSelected && !disabled ? (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    selected
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function menuItemTooltip(
  source: Source,
  slot: SlotKind,
  slotValid: boolean,
  pairValid: boolean,
  avail: { available: boolean; reason: string; comingSoon: boolean },
): string | undefined {
  if (!slotValid) {
    if (slot === "baseline" && source === "agent_proposal") {
      return "agent's proposal is a proposal, not a canonical state — can only sit in the comparator slot";
    }
    return "not valid for this slot";
  }
  if (!pairValid) {
    return "baseline=empty + comparator=Gemma isn't a coherent pair (per spec)";
  }
  if (!avail.available) return avail.reason;
  return undefined;
}

