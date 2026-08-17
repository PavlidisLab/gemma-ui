import { useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { DesignDraftContext } from "@/features/design/DesignDraftContext";
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
import { resolveCuration } from "./resolveCuration";
import { seedStamp } from "./seedStamp";
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
  const {
    baseline,
    comparator,
    setBaseline,
    setComparator,
    pinnedBaseline,
    pinnedBaselineUnavailable,
  } = useChipState({
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
      // ``flex-wrap``: when the strip runs out of room it breaks
      // between chips. Every chip below is ``whitespace-nowrap``, so
      // "Local-Curator polished" can't come apart across three lines
      // the way it used to.
      //
      // The strip is the header's widest tenant and it competes with
      // the ticket chip for what's left of the row, so it stays SMALL —
      // see the sizing note on ``ChipDropdown``. Buying a row by taking
      // width off the ticket chip instead was tried and reverted: on a
      // narrow window both gave at once and the header ended up with a
      // crushed ticket title AND a wrapped strip.
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
      role="region"
      aria-label="Comparison source selection"
    >
      {baselineLocked ? (
        <ChipLabel slotLabel="Viewing" value={baseline} curations={curations} />
      ) : (
        <ChipDropdown
          slot="baseline"
          slotLabel="Viewing"
          value={baseline}
          otherSlotValue={comparator}
          onChange={setBaseline}
          sources={universe.sources}
          availability={universe.availability}
          curations={curations}
        />
      )}
      {/* Sits with the BASELINE chip, not after the pair: it modifies
          the baseline ("this is the seed"), and when the header runs
          out of room the strip breaks between groups, so the note
          wraps together with the chip it describes. */}
      <CuratingOnTopNote baseline={baseline} curations={curations} />
      <ChipDropdown
        slot="comparator"
        slotLabel={comparatorSlotLabel(mode, comparator)}
        value={comparator}
        otherSlotValue={baseline}
        onChange={setComparator}
        sources={universe.sources}
        availability={universe.availability}
        curations={curations}
      />
      <PinnedBaselineNote
        pinned={pinnedBaseline}
        current={baseline}
        unavailable={pinnedBaselineUnavailable}
        curations={curations}
        onRestore={setBaseline}
      />
      <DiffSummaryReadout
        summary={diff.summary}
        isLoading={diff.isLoading}
      />
    </div>
  );
}

/** "You are curating on top of X."
 *
 *  A ticket's baseline is not a view the curator picked — it names
 *  what the curation is built on top of. It seeds the buffer for a
 *  fresh curation, and once the curator commits, the page shows their
 *  own design instead: commits write /design and the curator's own
 *  polished row, never the seed. The baseline chip keeps naming the
 *  seed, so without this note the chip would name one thing while the
 *  page rendered another — the disconnect ``9b5d1f5`` closed.
 *
 *  The note does NOT repeat the seed's name: it renders beside the
 *  baseline chip, which already names it, and the repetition was
 *  costing a whole wrapped header row. What it adds instead is WHICH
 *  seed — a version stamp, so two curators on the same ticket can
 *  tell whether they started from the same gold.
 *
 *  Neutral, not amber: nothing is wrong here. Amber is reserved for
 *  the pinned-baseline warning below, where a finding may not match
 *  what is on screen.
 *
 *  Reads the context directly rather than through ``useDesignDraft``
 *  so the strip still renders if it is ever mounted outside the
 *  draft provider. */
function CuratingOnTopNote({
  baseline,
  curations,
}: {
  baseline: Source;
  curations: readonly CurationRow[];
}) {
  const draft = useContext(DesignDraftContext);
  const seed = draft?.curatingOnTopOf;
  if (!seed) return null;
  const row = resolveCuration(baseline, curations);
  const stamp = seedStamp(row);
  return (
    <span
      className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border whitespace-nowrap text-[10px] border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
      title={
        `This curation was started from ${seed}` +
        (stamp ? ` (${stamp})` : "") +
        ` and you have committed on top of it, so the page shows YOUR ` +
        `design — not ${seed} as it stands now. Select ${seed} in the ` +
        `comparator to see it.` +
        (row?.created_at ? `\n\n${seed} version: ${row.created_at}` : "")
      }
    >
      curating on top
      {stamp ? (
        <>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span className="font-semibold">{stamp}</span>
        </>
      ) : null}
    </span>
  );
}

/** "Findings computed against X — you are viewing Y."
 *
 *  A ticket pins the baseline its findings were computed against; the
 *  strip opens on it. The selector stays live — comparing freely is
 *  the point of a review — so the only thing that has to be fixed is
 *  that the two states used to look identical. Reviewing ticket 168
 *  with the selector on Local-Curator polished re-asked a question
 *  gold-polished had already answered, and nothing on screen marked
 *  the difference (handoff
 *  ``AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE.md``).
 *
 *  Amber = warning, per the house palette rule. Silent when the
 *  reviewer is on the pinned baseline, which is the normal case. */
function PinnedBaselineNote({
  pinned,
  current,
  unavailable,
  curations,
  onRestore,
}: {
  pinned: Source | null;
  current: Source;
  unavailable: boolean;
  curations?: readonly CurationRow[];
  onRestore: (s: Source) => void;
}) {
  if (!pinned) return null;
  if (pinned === current && !unavailable) return null;
  const pinnedName = sourceLabel(pinned, curations);
  const currentName = sourceLabel(current, curations);
  // One line, always: the strip rides inside the sticky header row,
  // and a wrapped sentence there pushes the whole header apart. The
  // chip states the mismatch; the full "you are viewing …" sentence
  // lives in the title, and clicking restores the pinned baseline.
  const frame =
    "inline-flex items-baseline gap-1 px-2 py-0.5 rounded border whitespace-nowrap border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100";
  if (unavailable) {
    return (
      <span
        className={frame}
        title={`This ticket's findings were computed against ${pinnedName}, which isn't loaded for this experiment. You are viewing ${currentName}, so a finding may describe a difference this baseline doesn't have.`}
      >
        ticket baseline <span className="font-semibold">{pinnedName}</span> not
        loaded here
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onRestore(pinned)}
      className={cn(frame, "hover:border-amber-400 dark:hover:border-amber-600")}
      title={`This ticket's findings were computed against ${pinnedName}. You are viewing ${currentName}, so a finding may already be resolved in what you see — or describe a difference this baseline doesn't have.\n\nClick to switch back to ${pinnedName}.`}
    >
      findings used <span className="font-semibold">{pinnedName}</span>
      <span className="underline underline-offset-2">switch back</span>
    </button>
  );
}

/** Compact "Δ +2 tags, +1 factor" readout. Renders only when both
 *  slots resolve to a Design — i.e. an actual diff is computable.
 *  Empty diff (counts all zero) is the regression-test signal:
 *  matching sources show "no differences" in green.
 *
 *  Flows inline after the chips rather than ``ml-auto``-ing to the far
 *  right: the strip lives inside the header row, and an auto margin
 *  there claims every remaining pixel of the line, which pushed the
 *  readout onto a row of its own and stranded it under the nav. It
 *  also belongs next to the pair it is diffing. */
function DiffSummaryReadout({
  summary,
  isLoading,
}: {
  summary: SemanticDiffSummary | null;
  isLoading: boolean;
}) {
  if (summary === null) {
    // Nothing to say and nothing loading → render nothing at all. An
    // empty span is still a flex item and still takes a gap.
    if (!isLoading) return null;
    return (
      <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400 whitespace-nowrap">
        diffing…
      </span>
    );
  }
  if (summary.empty) {
    return (
      <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
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
    <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-baseline gap-2 whitespace-nowrap">
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
      {/* Sentence case with a colon, not the old uppercase tracking:
          "Viewing: Gold polished" reads as a sentence about the chip
          beside it, where "BASELINE" read as a field name in a form. */}
      <span
        className={cn(
          "text-[11px] font-semibold whitespace-nowrap",
          palette.label,
        )}
      >
        {slotLabel}:
      </span>
      <span
        className={cn(
          // Matches ChipDropdown sizing so locked + selectable chips
          // line up visually in the strip.
          "inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed text-[12px] font-medium opacity-90 whitespace-nowrap",
          palette.chip,
        )}
        title={provTitle || undefined}
      >
        {sourceLabel(value, curations)}
      </span>
    </div>
  );
}

/** The comparator slot's leading label.
 *
 *  It used to read off the MODE alone, which meant the ordinary review
 *  pair (a polished baseline against the agent's proposal) came out as
 *  "Audit" — jargon for the thing the chip beside it already names in
 *  plain words (Paul, 2026-08-16). So the label now follows what is
 *  actually IN the slot: the agent's proposal reads "Proposal"
 *  whichever mode it produces.
 *
 *  Everything else stays "Comparing", deliberately: the comparator also
 *  takes another curator's polished row (the Cy-vs-Am tiebreak
 *  workflow), and calling that a "Proposal" would be a plain lie about
 *  whose work it is. Identity keeps its own name — comparing a source
 *  with itself is the regression check, not a comparison anyone means
 *  to be reading. */
/** Drop the slot's own word off the end of a chip's value, so the pair
 *  doesn't read "Proposal: agent proposal" (Paul, 2026-08-16 — "reduce
 *  the repetition").
 *
 *  It bites in exactly one place: ``sourceLabel``'s bare fallback for an
 *  agent run IS the string "agent proposal", used when the run carries
 *  neither a sha nor a date to identify it by. A run that HAS one reads
 *  "agent v1.1-87-g5344f2e 8/13" and is left alone, as is every
 *  polished / preboard label. Display only — the dropdown, the
 *  tooltips and the diff all keep the full name. */
function withoutSlotWord(label: string, slotLabel: string): string {
  const trimmed = label
    .replace(new RegExp(`\\s*\\b${slotLabel}\\b\\s*$`, "i"), "")
    .trim();
  return trimmed || label;
}

function comparatorSlotLabel(
  mode: ReturnType<typeof modeOf>,
  comparator: Source,
): string {
  if (mode === "identity") return "Regression check";
  if (mode === "proposal" || comparator === "agent_proposal") return "Proposal";
  return "Comparing";
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
      {/* Sentence case with a colon, not the old uppercase tracking:
          "Viewing: Gold polished" reads as a sentence about the chip
          beside it, where "BASELINE" read as a field name in a form. */}
      <span
        className={cn(
          "text-[11px] font-semibold whitespace-nowrap",
          palette.label,
        )}
      >
        {slotLabel}:
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // Sizing has been round-tripped twice. Design review
          // 2026-05-27 round 2 asked for a bigger trigger ("the little
          // triggers to change the baseline/audit are too small
          // again"), and at 14px/px-3 the pair went back to costing the
          // header two and three rows on a ticket-context page. This is
          // the settlement: 12px on a filled, bordered chip with a
          // caret still reads as a button, and the whole strip now sits
          // on one row beside a ticket chip. Don't grow it back without
          // re-checking the header at ~1900px with a ticket open.
          "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[12px] font-medium whitespace-nowrap",
          palette.chip,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={sourceTooltip(value, curations) || undefined}
      >
        {/* Capped + truncating: an agent label carries its git describe
            ("agent v1.1-156-g30f57d9-dirty 8/13") and runs three times
            the width of "Gold polished", which is enough on its own to
            push the header past what it can seat. The dropdown lists
            every label in full. */}
        <span className="truncate max-w-[14rem]">
          {withoutSlotWord(sourceLabel(value, curations), slotLabel)}
        </span>
        <span className="opacity-70 text-[9px]">▾</span>
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

