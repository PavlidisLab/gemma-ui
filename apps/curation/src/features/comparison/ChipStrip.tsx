import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  ALL_SOURCES,
  isPairAllowed,
  isSourceValidInSlot,
  modeOf,
  SOURCE_LABEL,
  type SlotKind,
  type Source,
} from "./sources";
import { useChipState } from "./useChipState";
import {
  useSourceAvailability,
  type AvailabilityMap,
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
  const availability = useSourceAvailability(experimentId);
  const mode = modeOf(baseline, comparator);
  const diff = useChipDiffSummary(experimentId, baseline, comparator);

  // In edit mode the curator is working a calibration package; the
  // baseline they're editing IS the package's anchored state. Spec
  // section "Edit vs review mode" — baseline becomes informational
  // (display-only), comparator stays selectable. In review mode both
  // chips stay selectable so the curator can audit / compare freely.
  const baselineLocked = flow === "edit";

  return (
    <div
      className="w-full bg-slate-50 border-b border-slate-200 px-4 py-1.5 text-sm flex items-center gap-4 dark:bg-slate-900/40 dark:border-slate-700"
      role="region"
      aria-label="Comparison source selection"
    >
      {baselineLocked ? (
        <ChipLabel slotLabel="Baseline" value={baseline} />
      ) : (
        <ChipDropdown
          slot="baseline"
          slotLabel="Baseline"
          value={baseline}
          otherSlotValue={comparator}
          onChange={setBaseline}
          availability={availability}
        />
      )}
      <ChipDropdown
        slot="comparator"
        slotLabel={comparatorSlotLabel(mode)}
        value={comparator}
        otherSlotValue={baseline}
        onChange={setComparator}
        availability={availability}
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
}: {
  slotLabel: string;
  value: Source;
}) {
  const palette = SLOT_PALETTE.baseline;
  return (
    <div
      className="relative inline-flex items-baseline gap-2"
      title="Baseline is fixed in edit mode — switch to a review/audit context to change it"
    >
      <span
        className={cn(
          "text-[11px] uppercase tracking-wide font-semibold",
          palette.label,
        )}
      >
        {slotLabel}
      </span>
      <span
        className={cn(
          "inline-flex items-baseline gap-1 px-2 py-0.5 rounded border border-dashed text-[13px] opacity-90",
          palette.chip,
        )}
      >
        {SOURCE_LABEL[value]}
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
  availability,
}: {
  slot: SlotKind;
  slotLabel: string;
  value: Source;
  otherSlotValue: Source;
  onChange: (s: Source) => void;
  availability: AvailabilityMap;
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
    <div ref={ref} className="relative inline-flex items-baseline gap-2">
      <span
        className={cn(
          "text-[11px] uppercase tracking-wide font-semibold",
          palette.label,
        )}
      >
        {slotLabel}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-baseline gap-1 px-2 py-0.5 rounded border text-[13px]",
          palette.chip,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{SOURCE_LABEL[value]}</span>
        <span className="opacity-60 text-[10px]">▾</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={`${slotLabel} source`}
          className="absolute left-0 top-full mt-1 z-50 min-w-[14rem] rounded border border-slate-300 bg-white shadow-lg py-1 text-[13px] dark:bg-slate-800 dark:border-slate-600"
        >
          {ALL_SOURCES.map((s) => {
            const slotValid = isSourceValidInSlot(slot, s);
            const pairValid =
              slot === "baseline"
                ? isPairAllowed(s, otherSlotValue)
                : isPairAllowed(otherSlotValue, s);
            const avail = availability[s];
            const disabled = !slotValid || !pairValid || !avail.available;
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
                title={menuItemTooltip(s, slot, slotValid, pairValid, avail)}
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
                  {SOURCE_LABEL[s]}
                  {avail.comingSoon ? (
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
    return "baseline=empty + comparator=Gemma preboard isn't a coherent pair (per spec)";
  }
  if (!avail.available) return avail.reason;
  return undefined;
}
