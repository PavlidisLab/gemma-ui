import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useStickyState } from "@/lib/useStickyState";
import { useEscape } from "@/lib/useEscape";
import { Pill } from "@/components/ui/Pill";
import { Term } from "@/components/ui/Term";
import type {
  CuratorCheckboxes,
  CuratorFeedback,
  IssueTag,
  Proposal,
  ProposalStatus,
  SubtaskDecision,
} from "@/api/types";
import type { Biomaterial } from "@/features/experiment/types";
import { useReviewProposal, useTriggerProposal } from "@/api/proposals";
import { useProposeStream } from "@/api/proposeStream";
import { ApiError } from "@/api/client";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  addPublication,
  applyProposalToDesign,
  deletePublication,
  removeAppliedProposalFromDesign,
} from "@/features/design/mutations";
import {
  extractPaperMeta,
  pmidFromPaperSource,
} from "@/features/proposal/paperEvidence";
import { markPaperDismissed } from "@/features/proposal/paperDismissal";
import { IssueTagInline } from "@/features/proposal/IssueTagInline";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { useProposalReview } from "@/features/proposal/ProposalReviewContext";
import { navigate, experimentRoute } from "@/routes";
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  MODEL_TIER_ORDER,
  tierForProviderModel,
  type ModelTier,
} from "@/lib/modelTiers";

// ---------------------------------------------------------------------------
// Dataset-summary badge — surfaces operational metadata (batch info,
// individual count) without polluting the proposal's tag list. Per
// Paul (2026-04-29): batch / individual / subject / replicate are
// not curator EE tags; they're cohort bookkeeping. The tag proposer
// drops them; this strip reports on them so the curator still sees
// the underlying data.
// ---------------------------------------------------------------------------

interface DatasetSummary {
  nSamples: number;
  nIndividuals: number | null;   // null = couldn't infer
  hasBatch: boolean;
  batchKey: string;              // characteristic key that signalled batch presence
}

/** Infer dataset-level metadata from per-sample characteristics.
 *  Permissive about which characteristic keys count — we look at
 *  common patterns Gemma uses. */
function summariseDataset(biomaterials: Biomaterial[]): DatasetSummary {
  const out: DatasetSummary = {
    nSamples: biomaterials.length,
    nIndividuals: null,
    hasBatch: false,
    batchKey: "",
  };

  const individualKeys = [
    "individual",
    "subject",
    "subject id",
    "subject_id",
    "donor",
    "donor id",
    "donor_id",
    "patient",
    "patient id",
    "patient_id",
  ];
  const batchKeys = ["batch", "block", "processing batch", "run", "library batch"];

  // Walk one sample's keys to find which canonical individual / batch
  // key (if any) is present. Then count distinct values across all
  // samples for that key.
  const sampleKeys = new Set<string>();
  for (const b of biomaterials) {
    for (const k of Object.keys(b.characteristics || {})) {
      sampleKeys.add(k.toLowerCase());
    }
  }

  const matchedIndividualKey = individualKeys.find((k) => sampleKeys.has(k));
  if (matchedIndividualKey) {
    const values = new Set<string>();
    for (const b of biomaterials) {
      for (const [k, v] of Object.entries(b.characteristics || {})) {
        if (k.toLowerCase() === matchedIndividualKey && v) {
          values.add(String(v));
        }
      }
    }
    out.nIndividuals = values.size > 0 ? values.size : null;
  }

  const matchedBatchKey = batchKeys.find((k) => sampleKeys.has(k));
  if (matchedBatchKey) {
    out.hasBatch = true;
    out.batchKey = matchedBatchKey;
  }

  return out;
}

function MetadataBadge({ summary }: { summary: DatasetSummary }) {
  const parts: { label: string; title: string }[] = [];
  parts.push({
    label: `${summary.nSamples} samples`,
    title: `${summary.nSamples} biomaterials in this experiment`,
  });
  if (summary.nIndividuals !== null) {
    parts.push({
      label: `${summary.nIndividuals} individuals`,
      title: `${summary.nIndividuals} distinct subjects across ${summary.nSamples} biomaterials`,
    });
  }
  if (summary.hasBatch) {
    parts.push({
      label: "has batch info",
      title: `batch annotation present on per-sample characteristic '${summary.batchKey}' — see the design tab`,
    });
  }
  return (
    <div className="px-3 py-1.5 border-b border-slate-100 text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.map((p, i) => (
        <span key={i} title={p.title}>
          {p.label}
          {i < parts.length - 1 ? " ·" : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * v2 layout for the agent-proposal sidebar card.
 *
 * Differences from ``ProposalCard`` (v1):
 *
 *   - **Triage strip.** S1 verdicts (design / split / subset) render
 *     as inline badges at the top of the card. The full rationale
 *     and Confluence citation live in the badge's ``title`` tooltip.
 *     Replaces v1's "agent decisions" expander for the gating
 *     decisions.
 *   - **Variance scan output is split.** Kept candidates surface as
 *     the "?" tooltip on the matching factor row — the curator hovers
 *     to see *why* the agent picked this category. Dropped candidates
 *     (categories the proposer chose not to promote to EFCs) collect
 *     under a **"Varied but not used"** expander inside the Factors
 *     section, with an on-demand ``why?`` button per row (endpoint
 *     wiring lands in slice 4).
 *   - **Per-FV chips for finer-grained verdicts.** S6 (baseline pick)
 *     and S10 (term validation) decisions attach to the FV pinpointed
 *     by ``target_id`` rather than rendering in a separate panel.
 *
 * Slice 1 scope: structural skeleton + decision routing. Term
 * coloring, feedback-area merge, action-verb rename, and the
 * preview-accept dry run land in subsequent slices.
 */

// ---------------------------------------------------------------------------
// Decision routing — bucket SubtaskDecisions by their subtask prefix and
// per-row target_id so we can render each in the right place.
// ---------------------------------------------------------------------------

interface RoutedDecisions {
  /** S1_design_verdict / S1_split_verdict / S1_subset_verdict — the three
   *  Triage badges. Keyed by the subtask field for direct lookup.
   *  ``S8_dea_usability`` (experiment-level, empty target_id) also
   *  rides this strip when it lands as ``not_usable``. */
  triage: Record<string, SubtaskDecision | undefined>;
  /** S3 candidates the proposer kept as factors. Keyed by lowercased
   *  category label so the factor row can attach the matching evidence
   *  via ``?`` tooltip. */
  s3KeptByCategory: Map<string, SubtaskDecision>;
  /** S3 candidates the proposer dropped — collected for the
   *  "Varied but not used" subsection. */
  s3Dropped: SubtaskDecision[];
  /** Per-target_id decisions (S6 baseline, S10 term validation, etc.)
   *  keyed by ``target_id`` for placement next to the row they're
   *  about. */
  byTargetId: Map<string, SubtaskDecision[]>;
  /** All decisions whose target_id falls under a given FV prefix
   *  (e.g. ``factor:disease/fv:0/subject``), bucketed by the prefix
   *  ``factor:disease/fv:0``. Avoids the O(M·N) inner walk over the
   *  full ``byTargetId`` map for each FV cell. */
  byFvSubpath: Map<string, SubtaskDecision[]>;
  /** Decisions we don't yet route to a specific surface — gate flags,
   *  S2 forbidden-EFC drops, recommend-skip. Render as a fallback
   *  expander so they stay visible. */
  other: SubtaskDecision[];
}

function routeDecisions(
  decisions: SubtaskDecision[] | undefined,
  proposedFactorCategories: string[],
): RoutedDecisions {
  const out: RoutedDecisions = {
    triage: {},
    s3KeptByCategory: new Map(),
    s3Dropped: [],
    byTargetId: new Map(),
    byFvSubpath: new Map(),
    other: [],
  };
  if (!decisions || decisions.length === 0) return out;

  const proposedSet = new Set(
    proposedFactorCategories.map((s) => s.toLowerCase()),
  );

  for (const d of decisions) {
    const subtask = d.subtask || "";

    // Triage: three S1 verdicts share one strip at the top.
    if (
      subtask === "S1_design_verdict" ||
      subtask === "S1_split_verdict" ||
      subtask === "S1_subset_verdict"
    ) {
      out.triage[subtask] = d;
      continue;
    }

    // S8 DEA-usability is experiment-level (empty target_id). Hoist
    // it into the triage strip so a ``not_usable`` verdict surfaces
    // as a one-line warning chip without blocking acceptance — the
    // agents-side guidance is "informational, not a skip; gold
    // curates non-DEA-able experiments routinely (Sample Study)".
    if (subtask === "S8_dea_usability") {
      out.triage[subtask] = d;
      continue;
    }

    // S3 summary line is redundant with the rendered factor rows —
    // its content ("2 candidates: cell line, treatment") is already
    // implied by the factor list above. Skip it entirely so the
    // "other decisions" expander only shows non-redundant content.
    if (subtask === "S3_factor_identifier") {
      continue;
    }

    // S3 candidate rows — bucket as kept or dropped based on whether
    // the category appears in the proposer's actual factor list.
    if (subtask === "S3_factor_candidate") {
      const cat = parseCandidateCategory(d.target_id);
      if (cat && proposedSet.has(cat)) {
        out.s3KeptByCategory.set(cat, d);
      } else if (cat) {
        out.s3Dropped.push(d);
      } else {
        out.other.push(d);
      }
      continue;
    }

    // S3-vs-proposer diff — already implied by the kept/dropped split,
    // so we don't surface it as its own row. Keep in ``other`` for
    // the fallback panel.
    if (subtask === "S3_vs_proposer_diff") {
      out.other.push(d);
      continue;
    }

    // Per-target decisions (S6 baseline picks, S10 term-validator
    // findings). Group by ``target_id`` so the FV row can read its
    // own list. Additionally bucket by FV-path prefix so subpath
    // lookups (``factor:X/fv:N/subject`` for one FV's chips) are
    // O(1) rather than walking the whole map per cell.
    if (d.target_id) {
      const list = out.byTargetId.get(d.target_id) ?? [];
      list.push(d);
      out.byTargetId.set(d.target_id, list);
      const fvMatch = d.target_id.match(/^(factor:[^/]+\/fv:\d+)/);
      if (fvMatch) {
        const fvKey = fvMatch[1];
        const subList = out.byFvSubpath.get(fvKey) ?? [];
        subList.push(d);
        out.byFvSubpath.set(fvKey, subList);
      }
      continue;
    }

    // Anything else (gate flags, recommend-skip, etc.) lands in the
    // fallback expander.
    out.other.push(d);
  }
  return out;
}

/** Extract the category label from an S3_factor_candidate decision's
 *  target_id. Format: ``candidate:<lowercased category label>``. */
function parseCandidateCategory(targetId: string): string {
  const m = targetId.match(/^candidate:(.+)$/);
  return m ? m[1].trim().toLowerCase() : "";
}

/** Map an S1 verdict to a curator-readable chip, or null when there's
 *  nothing actionable to surface. The Triage strip is meant to flag
 *  things the curator should look at, so we hide the affirmative
 *  cases ("design", "single_experiment", "no_subset") entirely.
 *
 *  Subset axis is parsed dynamically — the verdict carries
 *  ``subset_by_<axis>`` where <axis> can be cell line, cell type,
 *  organism part, tissue, etc. Don't hard-code the list. */
function designChipFor(
  verdict: string,
): { label: string; tone: "warn" | "neutral" } | null {
  // Affirmative — design-of-experiment. Nothing to flag.
  if (verdict.startsWith("design")) return null;
  if (verdict.startsWith("sample_study"))
    return { label: "Sample study, not DoE", tone: "warn" };
  if (verdict.startsWith("cell_line_study"))
    return { label: "Cell-line study, not DoE", tone: "warn" };
  if (verdict.startsWith("benchmarking"))
    return { label: "Benchmarking study", tone: "warn" };
  if (verdict.startsWith("single_condition"))
    return { label: "Single condition", tone: "warn" };
  if (verdict.startsWith("unclear"))
    return { label: "Design unclear", tone: "neutral" };
  // Fallback: show a truncated head so we don't silently drop a
  // verdict the agent invented after this code was written.
  const head = verdict.split(/[.\n]/)[0] || verdict;
  return {
    label: head.length <= 32 ? head : head.slice(0, 32).trimEnd() + "…",
    tone: "neutral",
  };
}

function splitChipFor(verdict: string): { label: string; tone: "warn" } | null {
  // "single_experiment" = no split needed — hide.
  if (verdict.startsWith("single_experiment")) return null;
  if (verdict.startsWith("should_split"))
    return { label: "Candidate for splitting", tone: "warn" };
  return null;
}

function subsetChipFor(verdict: string): { label: string; tone: "warn" } | null {
  // "no_subset" = run a single DEA — hide.
  if (verdict.startsWith("no_subset")) return null;
  const m = verdict.match(/^subset_by_([a-z_]+)/);
  if (m) {
    const axis = m[1].replace(/_/g, " ");
    return { label: `Possibly subset by ${axis} for DEA`, tone: "warn" };
  }
  return null;
}

/** S8 DEA-usability verdict starts with ``"usable:"`` or
 *  ``"not_usable:"``. ``usable`` hides — no curator action needed.
 *  ``not_usable`` surfaces as a warning chip; non-DEA-able
 *  experiments (Sample Study, no within-level replicates, …) are
 *  legitimately curated via TGEMO experiment tags, so this is
 *  advisory and never blocks acceptance. */
function deaUsabilityChipFor(
  verdict: string,
): { label: string; tone: "warn" } | null {
  if (verdict.startsWith("usable")) return null;
  if (verdict.startsWith("not_usable"))
    return { label: "Not DEA-usable", tone: "warn" };
  return null;
}

type Confidence = "low" | "medium" | "high";
type LevelKind = "confidence" | "priority";

/** Pull an agent-emitted level marker out of a verdict — confidence
 *  for S1 / S3 summary rows, priority for S3 per-candidate rows —
 *  and return it separately from the cleaned rationale. The bare
 *  word ("high", "medium", "low") buried in parentheses doesn't
 *  read as a level label, so we surface it as a structured
 *  indicator instead. Three shapes show up:
 *    A. "design (high confidence). ..."     — S1 design/split/subset
 *    B. "high confidence: ..."              — S3 candidate-list summary
 *    C. "cell line (high). evidence..."     — S3 per-candidate row
 *                                              (the bare form here is
 *                                              priority, not confidence)
 *  We label the kind so the popover meter can say "priority · high"
 *  rather than mis-stating it as confidence. */
function extractLevel(
  text: string,
): { level: Confidence | null; kind: LevelKind; clean: string } {
  if (!text) return { level: null, kind: "confidence", clean: text };
  // Pattern A — explicit "(<level> confidence)".
  const a = text.match(/\s*\((low|medium|high) confidence\)\.?/i);
  if (a) {
    return {
      level: a[1].toLowerCase() as Confidence,
      kind: "confidence",
      clean: (text.slice(0, a.index) + text.slice(a.index! + a[0].length)).trim(),
    };
  }
  // Pattern B — colon-form "<level> confidence: ...".
  const b = text.match(/\b(low|medium|high) confidence:\s*/i);
  if (b) {
    return {
      level: b[1].toLowerCase() as Confidence,
      kind: "confidence",
      clean: (text.slice(0, b.index) + text.slice(b.index! + b[0].length)).trim(),
    };
  }
  // Pattern C — bare "(<level>)" used as priority on S3 candidate
  // rows. Anchor to a leading space (or start of string) so we
  // don't pull "(low)" out of arbitrary mid-sentence prose. Also
  // eat the trailing period/space so the cleaned rationale starts
  // at the next sentence.
  const c = text.match(/(^|\s)\((low|medium|high)\)\.?\s*/i);
  if (c) {
    const start = c.index! + (c[1] ? c[1].length : 0);
    const end = c.index! + c[0].length;
    return {
      level: c[2].toLowerCase() as Confidence,
      kind: "priority",
      clean: (text.slice(0, start).trimEnd() + " " + text.slice(end)).trim(),
    };
  }
  return { level: null, kind: "confidence", clean: text };
}

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------

/** "?" affordance — a small grey question mark that opens a click
 *  popover with the rationale text. The popover is anchored to the
 *  button, dismissed by click-outside or Escape, and styled so long
 *  rationales (S1 evidence quotes, S3 evidence-quote sentences) wrap
 *  legibly. The native ``title`` tooltip we used previously surfaced
 *  the same string but truncated long rationales unpredictably and
 *  required a hover the curator might not discover. */
function Why({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // Flip to right-anchored when the trigger sits close enough to the
  // right edge of the viewport that a left-anchored popover would
  // overflow + clip. Measured on open from the trigger's bounding
  // rect so the popover lands inside the viewport regardless of
  // which sidebar / column the ``?`` button lives in. (Was a
  // problem on tag chips in the right-hand proposals sidebar —
  // ``w-72`` × 288px popover anchored ``left-0`` ran past the card
  // and clipped on the next sibling boundary.)
  const [flip, setFlip] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const POPOVER_W = 288; // matches ``w-72``

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!text) return null;
  const { level, kind, clean } = extractLevel(text);
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-label="why"
        aria-expanded={open}
        title="show rationale"
        className={`ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[10px] font-semibold cursor-help align-middle ${
          open
            ? "bg-slate-400 text-white"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Measure synchronously before opening so the popover
          // renders in the correct alignment on first paint — no
          // flash from a left-anchored frame collapsing to right.
          if (!open && wrapRef.current) {
            const rect = wrapRef.current.getBoundingClientRect();
            const margin = 8;
            setFlip(rect.left + POPOVER_W > window.innerWidth - margin);
          }
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute z-30 ${flip ? "right-0" : "left-0"} top-full mt-1 w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white shadow-lg p-2 text-xs leading-snug text-slate-700 whitespace-pre-wrap break-words`}
        >
          {clean}
          {level && (
            <div className="mt-2 pt-1.5 border-t border-slate-100 flex justify-end">
              <ConfidenceMeter level={level} kind={kind} />
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/** Three-bar shape-based confidence indicator. Filled bars = level
 *  (low → 1, medium → 2, high → 3). Slate palette only — no
 *  red/green — so the level is conveyed by shape, not hue, and the
 *  scheme is colourblind-safe. Width is roughly 4ch including the
 *  trailing label. */
/** Curator-facing label for each level kind. "Priority" on its own
 *  is vague — the curator-asked question is "important to the
 *  design?", which is what the EFC priority bucket is actually
 *  trying to convey. "Agent confidence" disambiguates the S1/S3
 *  self-assessed confidence from any other confidence in the UI. */
const LEVEL_KIND_LABEL: Record<LevelKind, string> = {
  confidence: "agent confidence",
  priority: "design importance",
};

function ConfidenceMeter({
  level,
  kind = "confidence",
}: {
  level: Confidence;
  kind?: LevelKind;
}) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const label = LEVEL_KIND_LABEL[kind];
  return (
    <span
      className="inline-flex items-end gap-1 text-[10px] text-slate-500"
      aria-label={`${label}: ${level}`}
    >
      <span className="inline-flex items-end gap-px h-3" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={
              "w-1 rounded-sm " +
              (i <= filled ? "bg-slate-500" : "bg-slate-200") +
              (i === 1 ? " h-1.5" : i === 2 ? " h-2" : " h-2.5")
            }
          />
        ))}
      </span>
      <span>{label} · {level}</span>
    </span>
  );
}

/** Triage strip badge. Tone drives colour; ``title`` carries the full
 *  rationale (verdict + citation). ``pos`` / ``warn`` reuse the Pill
 *  variants ``high`` (emerald) / ``medium`` (amber); ``neutral``
 *  renders with slate styling rather than the Pill ``low`` variant
 *  (which is red — too aggressive for a "no action needed" verdict
 *  like ``no_subset``). */
function TriageBadge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "pos" | "warn" | "neutral";
  title: string;
}) {
  if (tone === "neutral") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.7rem] leading-4 bg-slate-100 text-slate-700 cursor-help"
        title={title}
      >
        {label}
      </span>
    );
  }
  const variant: "high" | "medium" = tone === "pos" ? "high" : "medium";
  return (
    <Pill variant={variant} className="cursor-help">
      <span title={title}>{label}</span>
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// ProposalCardV2
// ---------------------------------------------------------------------------

export function ProposalCardV2({
  proposal,
  reviewer,
  triggerProposal,
  proposeStream,
}: {
  proposal: Proposal;
  reviewer: string;
  /**
   * Owned by the parent (App's MainGrid) so the propose mutation
   * survives the card unmounting after the PATCH(needs_changes)
   * succeeds. If the trigger lived inside this component, the
   * card would unmount when the proposal leaves "pending" and
   * mutate() would have nothing to dispatch to. Passing it down
   * also means the sidebar's "+ propose" spinner reflects an
   * in-flight redo and vice versa — one pending state per
   * experiment.
   *
   * Kept around for the in-flight gating reads (``isPending``);
   * the redo flow itself now drives the SSE-streaming endpoint
   * via ``proposeStream`` below so the curator sees live progress
   * instead of staring at the previous run's terminal events.
   */
  triggerProposal: ReturnType<typeof useTriggerProposal>;
  /** Same SSE-driven hook the sidebar's ``+ propose`` button uses.
   *  Redo with notes calls ``start`` here so the progress panel
   *  resets and reflects the redo run. Owned by the parent for
   *  the same lifecycle reason as ``triggerProposal``. */
  proposeStream: ReturnType<typeof useProposeStream>;
}) {
  const review = useReviewProposal(proposal.experiment_id);
  const { saved, draft, apply } = useDesignDraft();
  const toast = useToast();

  // Same exclusion-set machinery as v1 — per-tag and per-FV
  // checkboxes drive the accept-N/M count and the filtered Proposal
  // we apply on accept.
  const [excludedTags, setExcludedTags] = useState<Set<number>>(new Set());
  const [excludedFvs, setExcludedFvs] = useState<Set<string>>(new Set());

  // Per-aspect checkboxes are unused in v2 (replaced by per-row issue
  // tags below) but the schema still expects the field, so we send a
  // null-filled record on submit.
  const emptyCheckboxes: CuratorCheckboxes = {
    design_correct: null,
    tags_correct: null,
    ontology_terms_correct: null,
    sample_assignment_correct: null,
    close_but_not_quite: null,
  };
  // Per-row issue tags. Flat list keyed by ``target_id``; the
  // IssueTagInline component reads its own slice and replaces it on
  // save. Empty by default; most reviews never touch it.
  const [issueTags, setIssueTags] = useState<IssueTag[]>([]);
  function setIssueTagsFor(targetId: string, next: IssueTag[]) {
    setIssueTags((prev) => {
      const others = prev.filter((t) => t.target_id !== targetId);
      return [...others, ...next];
    });
  }
  function getIssueTagsFor(targetId: string): IssueTag[] {
    return issueTags.filter((t) => t.target_id === targetId);
  }
  // Single feedback textarea — its semantics are determined by which
  // action verb the curator clicks (slice 4 design):
  //   - "redo with notes"  → notes are retry instructions for the agent
  //   - "accept" / "reject" → notes are an archival comment for prompt-tuning
  // The schema still has separate ``reviewer_notes`` and ``prompt_feedback``
  // fields. To keep the wire format unchanged while presenting one
  // textarea, we mirror the same string into both on submit: any
  // downstream eval / prompt-tuning consumer that already reads
  // ``prompt_feedback`` keeps working; a future ``/retry`` endpoint
  // that reads the same content (or a dedicated ``instructions``
  // field) is a straightforward extension.
  const [feedback, setFeedback] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [variedOpen, setVariedOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [tab, setTab] = useStickyState<"review" | "decisions" | "details">(
    "proposal.tab",
    "review",
  );
  // (verify-N expander state removed 2026-04-29 — reassignment
  // moved to the Samples tab. The v2 card now exposes a single
  // "review on Samples tab →" button instead of per-factor
  // expanders.)

  // Redo-with-notes confirmation. Opens a modal that shows the
  // typed feedback (so the curator verifies what's about to be
  // sent) and warns when the textarea is empty (re-running with no
  // guidance just burns LLM credits and produces the same proposal).
  const [redoConfirm, setRedoConfirm] = useState(false);
  useEscape(redoConfirm, () => setRedoConfirm(false));
  // True while either propose path is in flight: the legacy
  // synchronous mutation (still on the prop for compat) or the
  // SSE-driven stream the redo flow now uses.
  const redoInFlight =
    triggerProposal.isPending || proposeStream.status === "running";
  // Model tier the retry runs on. Defaults to "standard" (matches
  // the proposer service's design-proposer default); curator can
  // bump to "strong" for a tougher experiment.
  const [retryTier, setRetryTier] =
    useState<ModelTier>(DEFAULT_MODEL_TIER);

  // Curator-edited FV labels. Keyed by ``${factorIdx}:${fvIdx}``;
  // value is the new free_text_label. Clicking the pencil next to a
  // proposed FV label opens an inline input; saving updates this
  // map. ``acceptedFactors`` and the editsForLog Proposal apply the
  // overrides on submit so feedback.edits captures the rename. Just
  // the display label — URI and statements stay unchanged for now;
  // a term-swap affordance (PLAN Class 3) lands later.
  const [labelEdits, setLabelEdits] = useState<Map<string, string>>(
    new Map(),
  );
  function setLabelEdit(factorIdx: number, fvIdx: number, value: string) {
    const key = `${factorIdx}:${fvIdx}`;
    setLabelEdits((prev) => {
      const next = new Map(prev);
      if (value.trim() === "") next.delete(key);
      else next.set(key, value);
      return next;
    });
  }
  function getLabelEdit(
    factorIdx: number,
    fvIdx: number,
  ): string | undefined {
    return labelEdits.get(`${factorIdx}:${fvIdx}`);
  }

  // Curator-driven sample reassignments live in ProposalReviewContext
  // so the Samples tab's per-cell editor can write them too.
  // Reassignments are scoped to the *active* proposal — the one the
  // curator clicked "review on Samples tab" for. When this card
  // isn't the active one, the context shows empty reassignments
  // (it switches when setActiveProposal is called).
  const proposalReview = useProposalReview();
  const isActiveReview =
    proposalReview.activeProposal?.proposal_id === proposal.proposal_id;
  const reassignments = isActiveReview
    ? proposalReview.reassignments
    : new Map<string, number>();
  function getReassignment(
    shortName: string,
    factorIdx: number,
  ): number | undefined {
    if (!isActiveReview) return undefined;
    return proposalReview.getReassignment(shortName, factorIdx);
  }
  function listReassignmentsForFactor(
    factorIdx: number,
  ): Array<{ shortName: string; fvIdx: number }> {
    if (!isActiveReview) return [];
    return proposalReview.listReassignmentsForFactor(factorIdx);
  }

  const decisions = proposal.evidence?.subtask_decisions;
  const proposedFactorCategories = useMemo(
    () => proposal.factors.map((f) => f.category.label || ""),
    [proposal.factors],
  );
  const routed = useMemo(
    () => routeDecisions(decisions, proposedFactorCategories),
    [decisions, proposedFactorCategories],
  );
  // Dataset-level summary computed from the live design's biomaterials.
  // Null until the design loads. We prefer the unedited ``saved``
  // server state — biomaterials are cohort facts, not curator edits,
  // so the draft and saved values agree but ``saved`` is the truthier
  // source.
  const datasetSummary = useMemo(
    () => (saved ? summariseDataset(saved.biomaterials) : null),
    [saved],
  );

  // Per-factor S7 coverage tier ("zero" / "low" / "medium" / "high"),
  // keyed by factor index. Pulled from ``routed.byTargetId`` so we
  // pick up whichever ``S7_factor_coverage`` decision the proposer
  // emitted for each factor. Older proposals (pre-S7) carry no
  // decision — those factors get ``undefined`` and render with no
  // banner / strip. The map is also the input to the auto-uncheck
  // effect below.
  const coverageByFactorIdx = useMemo(() => {
    const m = new Map<number, NonNullable<SubtaskDecision["confidence"]>>();
    proposal.factors.forEach((f, fi) => {
      const targetId = `factor:${f.category.label || "?"}`;
      const decisions = routed.byTargetId.get(targetId) ?? [];
      const cov = decisions.find((d) => d.subtask === "S7_factor_coverage");
      if (cov?.confidence) m.set(fi, cov.confidence);
    });
    return m;
  }, [proposal.factors, routed.byTargetId]);

  // Auto-uncheck factors with ``confidence: "zero"`` on first sight
  // of this proposal. The curator can re-check manually; we don't
  // re-apply on subsequent renders, so their override sticks.
  // Ref-guarded by ``proposal_id`` so a different proposal landing
  // (e.g. after redo-with-notes) re-runs the seeding for its own
  // zero-coverage factors.
  //
  // The ``${fi}:${vi}`` keys are positional — they assume
  // ``proposal.factors`` is stable for the lifetime of a given
  // ``proposal_id``. Today proposals are immutable once submitted
  // (the server doesn't edit a pending proposal in place; redo-
  // with-notes mints a new id), so factor indices don't drift
  // under us. If pending proposals ever grow in-place edits, this
  // effect needs a key strategy keyed on factor identity rather
  // than index.
  const autoUncheckedForProposalId = useRef<string | null>(null);
  useEffect(() => {
    const pid = proposal.proposal_id ?? "";
    if (autoUncheckedForProposalId.current === pid) return;
    autoUncheckedForProposalId.current = pid;
    const toExclude: string[] = [];
    proposal.factors.forEach((f, fi) => {
      if (coverageByFactorIdx.get(fi) !== "zero") return;
      for (let vi = 0; vi < f.factor_values.length; vi++) {
        toExclude.push(`${fi}:${vi}`);
      }
    });
    if (toExclude.length === 0) return;
    setExcludedFvs((prev) => {
      const next = new Set(prev);
      for (const k of toExclude) next.add(k);
      return next;
    });
  }, [proposal.proposal_id, proposal.factors, coverageByFactorIdx]);

  function toggleTag(i: number, include: boolean) {
    setExcludedTags((prev) => {
      const next = new Set(prev);
      if (include) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function toggleFv(factorIdx: number, fvIdx: number, include: boolean) {
    const key = `${factorIdx}:${fvIdx}`;
    setExcludedFvs((prev) => {
      const next = new Set(prev);
      if (include) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function isFvIncluded(factorIdx: number, fvIdx: number) {
    return !excludedFvs.has(`${factorIdx}:${fvIdx}`);
  }

  /** Toggle every FV of one factor in/out of the exclusion set. */
  function toggleFactorAll(factorIdx: number, include: boolean) {
    setExcludedFvs((prev) => {
      const next = new Set(prev);
      const f = proposal.factors[factorIdx];
      for (let v = 0; v < f.factor_values.length; v++) {
        const k = `${factorIdx}:${v}`;
        if (include) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const acceptedTags = proposal.tags.filter((_, i) => !excludedTags.has(i));
  // Apply exclusions + sample reassignments. Two passes:
  //   1) Drop excluded FVs.
  //   2) For each surviving FV, recompute its biomaterial_short_names:
  //      keep originals not reassigned away; add samples whose
  //      reassignment targets this FV. The latter walks the
  //      reassignment map directly (not the agent's biomaterial_short_names
  //      lists) so we capture single-cell siblings the agent never
  //      bucketed in the first place — caught 2026-04-29.
  // A sample reassigned to an excluded FV is dropped (the FV doesn't
  // exist in acceptedFactors, so the sample has nowhere to go).
  const acceptedFactors = proposal.factors
    .map((f, fi) => {
      // Pre-bucket reassignments-targeting-this-factor by destination
      // FV index. Avoids per-FV linear walks over the same map.
      const reassignedToFv = new Map<number, string[]>();
      for (const { shortName, fvIdx } of listReassignmentsForFactor(fi)) {
        const list = reassignedToFv.get(fvIdx) ?? [];
        list.push(shortName);
        reassignedToFv.set(fvIdx, list);
      }
      // Map filter-result index → original index, so the label-override
      // lookup stays correct after we drop excluded FVs.
      const originalVis = f.factor_values
        .map((_, vi) => vi)
        .filter((vi) => isFvIncluded(fi, vi));
      return {
        ...f,
        factor_values: f.factor_values
          .filter((_, vi) => isFvIncluded(fi, vi))
          .map((fv, postFilterIdx) => {
            const originalVi = originalVis[postFilterIdx];
            // Originals that weren't reassigned away.
            const staying = fv.biomaterial_short_names.filter((sn) => {
              const target = getReassignment(sn, fi);
              return target === undefined || target === originalVi;
            });
            // Samples whose reassignment lands on this FV. Includes
            // sc siblings that were never in any FV of this factor —
            // they can't be discovered by walking other FVs.
            const incomingRaw = reassignedToFv.get(originalVi) ?? [];
            const incoming = incomingRaw.filter(
              (sn) => !staying.includes(sn),
            );
            // Label override (✎-rename next to the FV chip).
            const labelOverride = getLabelEdit(fi, originalVi);
            const namesUnchanged =
              incoming.length === 0 &&
              staying.length === fv.biomaterial_short_names.length;
            if (namesUnchanged && labelOverride === undefined) {
              // Nothing changed — keep the original FV reference.
              return fv;
            }
            return {
              ...fv,
              free_text_label: labelOverride ?? fv.free_text_label,
              biomaterial_short_names: [...staying, ...incoming],
            };
          }),
      };
    })
    .filter((f) => f.factor_values.length > 0);
  const acceptCount =
    acceptedTags.length +
    acceptedFactors.reduce((n, f) => n + f.factor_values.length, 0);
  const totalCount =
    proposal.tags.length +
    proposal.factors.reduce((n, f) => n + f.factor_values.length, 0);
  const hasExclusions = excludedTags.size > 0 || excludedFvs.size > 0;

  // Per-aspect "design correct? / tags correct?" checkboxes from v1
  // are gone in v2 — replaced by per-row issue tags via the
  // IssueTagInline affordance, which gives discrete labels scoped to
  // a specific factor / FV / tag instead of a coarse aspect-wide
  // boolean. The schema field stays (we send all-nulls on submit) so
  // the wire format is unchanged.

  function submit(status: ProposalStatus) {
    if (!proposal.proposal_id) return;
    if (status === "rejected" && draft) {
      // Reject retracts a previously-applied accept. Remove any
      // tags/factors from the draft that this proposal contributed
      // (matched by category/value identity, scoped to "not in saved"
      // so pre-existing items survive). No-op for proposals that were
      // never accepted in the first place. Caught 2026-04-30: rejecting
      // after accept left the EE tags lingering on the design.
      let reverted = removeAppliedProposalFromDesign(
        draft,
        saved,
        proposal.tags,
        proposal.factors,
      );
      // Also retract the auto-linked publication added on accept
      // (or auto-applied on first sight by the OverviewPanel),
      // when the proposal carried paper evidence and the publication
      // isn't pre-existing in saved (don't nuke a curator-added
      // publication that happens to share the same PMID).
      const evExcerpt = proposal.evidence?.paper_excerpt ?? "";
      const evSource = proposal.evidence?.paper_source ?? "";
      if (evExcerpt) {
        const meta = extractPaperMeta(evExcerpt);
        const pmid = meta.pubmed_id ?? pmidFromPaperSource(evSource) ?? "";
        const doi = meta.doi ?? "";
        const savedHas = (saved?.publications ?? []).some(
          (p) =>
            (pmid && p.pubmed_id === pmid) ||
            (doi && p.doi === doi),
        );
        if (!savedHas && (pmid || doi)) {
          reverted = deletePublication(reverted, pmid, doi);
        }
      }
      // Mark the auto-apply flag so the OverviewPanel doesn't
      // re-add the publication on the next render after a reject.
      // Pair with the deletePublication above so rejection is a
      // single coherent action.
      if (proposal.proposal_id) {
        markPaperDismissed(proposal.experiment_id, proposal.proposal_id);
      }
      apply(reverted);
    }
    if (status === "accepted" && draft) {
      let next = applyProposalToDesign(
        draft,
        acceptedTags,
        acceptedFactors,
      );
      // Auto-link the agent-fetched paper as a Publication on the
      // design if the proposal carries paper evidence with at least
      // a parseable title or PMID. ``addPublication`` dedups by
      // PMID/DOI, so a curator who's already manually linked the
      // paper doesn't get a duplicate. Without this, a curator
      // accepting a proposal would lose the agent's paper findings
      // — the PROPOSED PAPER card hides on accept (filtered to
      // pending) but nothing else surfaces the paper.
      const evExcerpt = proposal.evidence?.paper_excerpt ?? "";
      const evSource = proposal.evidence?.paper_source ?? "";
      if (evExcerpt) {
        const meta = extractPaperMeta(evExcerpt);
        const pmid = meta.pubmed_id ?? pmidFromPaperSource(evSource);
        if (meta.title || pmid || meta.doi) {
          next = addPublication(next, {
            pubmed_id: pmid ?? "",
            doi: meta.doi ?? "",
            title: meta.title ?? "",
            citation: "",
          });
        }
      }
      apply(next);
      // Apply confirmation. Counts come from the filtered (accepted)
      // tags + factors so unchecked items don't inflate the summary.
      // The proposal card unmounts as the inbox refetches and the
      // proposal leaves "pending"; the toast survives that.
      const nFactors = acceptedFactors.length;
      const nFvs = acceptedFactors.reduce(
        (n, f) => n + f.factor_values.length,
        0,
      );
      const nSamples = acceptedFactors.reduce(
        (n, f) =>
          n +
          f.factor_values.reduce(
            (m, fv) => m + fv.biomaterial_short_names.length,
            0,
          ),
        0,
      );
      const nTags = acceptedTags.length;
      const nReassigned = reassignments.size;
      const parts: string[] = [];
      if (nFactors > 0) {
        parts.push(
          `${nFactors} factor${nFactors === 1 ? "" : "s"} created (${nFvs} FV${nFvs === 1 ? "" : "s"})`,
        );
      }
      if (nSamples > 0) {
        parts.push(`${nSamples} samples assigned`);
      }
      if (nReassigned > 0) {
        parts.push(
          `${nReassigned} curator reassignment${nReassigned === 1 ? "" : "s"}`,
        );
      }
      if (nTags > 0) {
        parts.push(`${nTags} tag${nTags === 1 ? "" : "s"} added`);
      }
      const message =
        parts.length > 0
          ? `Applied · ${parts.join(" · ")}. Commit on the design tab to save.`
          : "Applied (nothing to add). Commit on the design tab if needed.";
      toast.show(message, "success");
    }
    // Log curator edits whenever they diverge from the proposer's
    // output — exclusions, sample reassignments, OR label renames
    // all count. The (proposal, edits) pair is the DPO label
    // downstream; reassignments are the highest-volume signal,
    // label renames the highest-information per edit.
    const hasReassignments = isActiveReview && reassignments.size > 0;
    const hasLabelEdits = labelEdits.size > 0;
    const editsForLog: Proposal | null =
      hasExclusions || hasReassignments || hasLabelEdits
        ? {
            ...proposal,
            tags: acceptedTags,
            factors: acceptedFactors,
          }
        : null;
    // Mirror the single textarea into both schema fields so existing
    // server-side consumers (eval, feedback log, prompt-tuning) keep
    // working without a schema change. ``reviewer_notes`` is the
    // human-readable notes-about-this-review; ``prompt_feedback`` is
    // what the prompt-tuning pipeline reads. Per-row issue tags ride
    // on ``issue_tags``; the mock API silently drops the field today
    // (extra="ignore") — persistence lands once the Python schema
    // picks it up.
    const cf: CuratorFeedback = {
      status,
      reviewer,
      checkboxes: emptyCheckboxes,
      reviewer_notes: feedback,
      prompt_feedback: feedback,
      edits: editsForLog,
      issue_tags: issueTags.length > 0 ? issueTags : undefined,
    };
    review.mutate({ proposalId: proposal.proposal_id, feedback: cf });
    // Accept / reject / needs_changes all close the review session
    // for this proposal — its assignments are no longer "in flight"
    // for the Samples tab to overlay. Done unconditionally; if the
    // mutation later fails the curator can re-open via the card.
    if (isActiveReview) {
      proposalReview.setActiveProposal(null);
    }
  }

  /**
   * Redo-with-notes: PATCH the current proposal as ``needs_changes``
   * and chain a fresh proposer run on top.
   *
   * Until the proposer service grows a ``/retry`` endpoint that
   * threads the curator's notes into the agent prompts, the notes
   * still ride along on the ``needs_changes`` PATCH (the
   * prompt-tuning pipeline reads them) — they just don't shape the
   * new run yet. ``refresh_cache: true`` so the new propose doesn't
   * replay the cached output of the proposal we just rejected.
   */
  async function redoWithNotes() {
    if (!proposal.proposal_id) return;

    const hasReassignments = isActiveReview && reassignments.size > 0;
    const hasLabelEdits = labelEdits.size > 0;
    const editsForLog: Proposal | null =
      hasExclusions || hasReassignments || hasLabelEdits
        ? {
            ...proposal,
            tags: acceptedTags,
            factors: acceptedFactors,
          }
        : null;
    const cf: CuratorFeedback = {
      status: "needs_changes",
      reviewer,
      checkboxes: emptyCheckboxes,
      reviewer_notes: feedback,
      prompt_feedback: feedback,
      edits: editsForLog,
      issue_tags: issueTags.length > 0 ? issueTags : undefined,
    };

    // Close the review session before the awaits so the Samples tab
    // doesn't keep showing reassignment dropdowns for a proposal
    // we're already retiring.
    if (isActiveReview) {
      proposalReview.setActiveProposal(null);
    }

    try {
      await review.mutateAsync({
        proposalId: proposal.proposal_id,
        feedback: cf,
      });
    } catch (err) {
      toast.show(
        `Failed to mark proposal needs_changes: ${(err as Error).message}`,
        "error",
        8000,
      );
      return;
    }

    // Drive the SSE stream so the progress panel resets and reflects
    // *this* run rather than the original propose's terminal events.
    // Previously this fired the synchronous ``triggerProposal.mutate``;
    // the curator stared at "agent done 100%" stamped with the
    // just-rejected proposal_id for the 30-90s the redo took, which
    // looked like a stale cache hit.
    //
    // Body fields:
    //   - ``fresh_skeleton: true`` matches the sidebar "+ propose"
    //     button — without it the proposer silently skips when the
    //     experiment has any curated factors in its Design.
    //   - ``refresh_cache: true`` so the new run doesn't replay the
    //     cached output of the proposal we just retired.
    //   - ``tier`` (not ``model``) — the proposer service resolves
    //     tier → provider model id server-side.
    //   - ``prior_feedback`` threads the curator's note into the
    //     design-proposer prompt (``## Curator feedback from
    //     previous attempt`` block ahead of the candidate-factors
    //     hint). See ``REDO_WITH_NOTES_HANDOFF.md``. Trimmed empty
    //     → null so the agent doesn't get an empty feedback block.
    const trimmedFeedback = feedback.trim();
    proposeStream.start(String(proposal.experiment_id), {
      fresh_skeleton: true,
      refresh_cache: true,
      tier: retryTier,
      prior_feedback: trimmedFeedback || null,
    });
    const tierBlurb =
      retryTier === DEFAULT_MODEL_TIER
        ? ""
        : ` (${MODEL_TIERS[retryTier].label} model)`;
    toast.show(
      trimmedFeedback
        ? `Redo started${tierBlurb}. Notes wired into the new run; fresh cache.`
        : `Redo started${tierBlurb}. The new run uses a fresh cache.`,
      "info",
      6000,
    );
  }

  const skipReason = proposal.evidence?.extra?.skip_reason || "";
  const isSkip = proposal.factors.length === 0;

  return (
    <div className="card">
      {/* ---------------- Header strip ---------------- */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="section-h">Agent proposal</span>
          <Pill variant={proposal.status === "pending" ? "pending" : "accepted"}>
            {proposal.status}
          </Pill>
        </div>
        <span
          className="text-xs text-slate-400 truncate min-w-0 flex-1 text-right inline-flex items-baseline justify-end gap-1.5"
          title={
            // Honest tooltip: the proposer pipeline runs subtasks
            // (haiku) AND the design proposer (sonnet/opus by
            // default) — ``proposal.model`` today is whatever the
            // submitter recorded as the run-level model. The
            // model-tier handoff doc (gemma-curation-agents) specs
            // the eventual fix — splitting this into a
            // ``design_model`` field so the tier chip is unambiguous
            // about the hard step.
            `${proposal.submitted_by} · ${proposal.model ?? "(no model recorded)"} · ${proposal.submitted_at}`
          }
        >
          <span className="truncate">
            {proposal.submitted_by} · {proposal.model ?? "—"}
          </span>
          {(() => {
            const tier = tierForProviderModel(proposal.model);
            if (!tier) return null;
            return (
              <span
                className={
                  "text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border " +
                  (tier === "strong"
                    ? "bg-blue-50 text-blue-800 border-blue-200"
                    : tier === "fast"
                      ? "bg-slate-50 text-slate-600 border-slate-200"
                      : "bg-emerald-50 text-emerald-800 border-emerald-200")
                }
                title={`tier: ${tier} — ${MODEL_TIERS[tier].description}`}
              >
                {tier}
              </span>
            );
          })()}
        </span>
      </div>

      {/* ---------------- Tabs strip ----------------
          Three views over the same proposal: ``review`` (the default
          curator workflow — accept/reject), ``context`` (paper +
          skeleton excerpts the agent read), ``decisions`` (full
          structured rationale per subtask). Only Review shows the
          feedback / action row; Context and Decisions are read-only
          audit panes. */}
      {(() => {
        const ev = proposal.evidence;
        const decisionCount = ev?.subtask_decisions?.length ?? 0;
        const hasRaw = !!(
          ev?.extra?.tag_proposer_raw ||
          ev?.extra?.design_proposer_raw ||
          ev?.extra?.validation ||
          ev?.extra?.design_gate
        );
        const tabs: Array<{
          key: "review" | "decisions" | "details";
          label: string;
          count?: number;
          show: boolean;
        }> = [
          { key: "review", label: "Review", show: true },
          {
            key: "decisions",
            label: "Decisions",
            count: decisionCount || undefined,
            show: decisionCount > 0,
          },
          { key: "details", label: "Details", show: hasRaw },
        ];
        const visible = tabs.filter((t) => t.show);
        if (visible.length <= 1) return null;
        return (
          <div className="px-2 pt-1.5 border-b border-slate-100 flex items-center gap-1">
            {visible.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "text-[11px] px-2 py-1 rounded-t border-b-2 transition-colors",
                  tab === t.key
                    ? "border-blue-500 text-slate-900 font-medium"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                {t.label}
                {typeof t.count === "number" ? (
                  <span className="ml-1 text-[10px] text-slate-400">
                    ({t.count})
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        );
      })()}

      {tab === "review" && (
        <>
      {/* ---------------- Triage strip ----------------
          Only renders chips for non-affirmative verdicts: when the
          design is fine, the study isn't a split candidate, and no
          subsetting is needed, the strip disappears entirely so the
          card stays compact. Each chip's tooltip carries the full
          verdict + citation for curators who want the rationale. */}
      {(() => {
        const dv = routed.triage.S1_design_verdict;
        const sv = routed.triage.S1_split_verdict;
        const subv = routed.triage.S1_subset_verdict;
        const deav = routed.triage.S8_dea_usability;
        const dChip = dv ? designChipFor(dv.verdict) : null;
        const sChip = sv ? splitChipFor(sv.verdict) : null;
        const subChip = subv ? subsetChipFor(subv.verdict) : null;
        const deaChip = deav ? deaUsabilityChipFor(deav.verdict) : null;
        if (!dChip && !sChip && !subChip && !deaChip) return null;
        const titleFor = (d: SubtaskDecision) => {
          const { level, kind, clean } = extractLevel(d.verdict);
          const conf = level ? ` — ${LEVEL_KIND_LABEL[kind]}: ${level}` : "";
          const cite = d.citation ? ` — ${d.citation}` : "";
          return `${clean}${conf}${cite}`;
        };
        return (
          <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">
              Triage
            </span>
            {dChip && dv && (
              <TriageBadge
                label={dChip.label}
                tone={dChip.tone}
                title={titleFor(dv)}
              />
            )}
            {sChip && sv && (
              <TriageBadge
                label={sChip.label}
                tone={sChip.tone}
                title={titleFor(sv)}
              />
            )}
            {subChip && subv && (
              <TriageBadge
                label={subChip.label}
                tone={subChip.tone}
                title={titleFor(subv)}
              />
            )}
            {deaChip && deav && (
              <TriageBadge
                label={deaChip.label}
                tone={deaChip.tone}
                title={titleFor(deav)}
              />
            )}
          </div>
        );
      })()}

      {/* ---------------- Metadata badge ---------------- */}
      {/* Cohort-level metadata (sample count, individual count, batch
          presence) computed from the biomaterials Gemma already has.
          Replaces the would-be batch / individual tag rows the tag
          proposer used to emit. The data lives in the design tab; this
          strip is the curator's at-a-glance hint. */}
      {datasetSummary && datasetSummary.nSamples > 0 ? (
        <MetadataBadge summary={datasetSummary} />
      ) : null}

      {/* ---------------- Skip-reason line ---------------- */}
      {isSkip && (
        <div className="px-3 py-2 border-b border-slate-100 text-xs">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold text-slate-700 shrink-0">
              No design proposed —
            </span>
            <span
              className="text-slate-600 truncate min-w-0 flex-1"
              title={skipReason || "(no skip reason recorded)"}
            >
              {skipReason || "(see decisions for the skip reason)"}
            </span>
            {skipReason ? <Why text={skipReason} /> : null}
          </div>
        </div>
      )}

      {/* ---------------- Factors ---------------- */}
      {proposal.factors.length > 0 ? (
        <div className="px-3 py-2 border-b border-slate-100 text-xs">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-700">
              Factors ({proposal.factors.length} proposed)
            </span>
            {/* Review-on-Samples-tab affordance. Activates this proposal
                in ProposalReviewContext and switches to the Samples
                tab, where the curator can verify and edit per-sample
                FV assignments against the actual sample data
                (characteristics, sample names, BioAssay titles)
                instead of the information-poor card. */}
            <button
              type="button"
              className={
                "text-[11px] px-2 py-1 rounded border transition-colors " +
                (isActiveReview
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-medium"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
              }
              onClick={() => {
                proposalReview.setActiveProposal(proposal);
                navigate(experimentRoute(proposal.experiment_id, "samples"));
              }}
              title={
                isActiveReview
                  ? "this proposal is active on the Samples tab — click to refocus"
                  : "open the Samples tab in proposal-review mode; factor cells become reassignment dropdowns"
              }
            >
              {isActiveReview
                ? `Reviewing in samples table${reassignments.size ? ` · ${reassignments.size} reassigned` : ""}`
                : "Preview in samples table"}
            </button>
          </div>

          {proposal.factors.map((f, fi) => {
            const catKey = (f.category.label || "").toLowerCase();
            const s3Evidence = routed.s3KeptByCategory.get(catKey)?.verdict;
            const factorAllIncluded = f.factor_values.every((_, vi) =>
              isFvIncluded(fi, vi),
            );
            const factorAllExcluded = f.factor_values.every(
              (_, vi) => !isFvIncluded(fi, vi),
            );
            // Sample-count summary across the factor's FVs.
            const sampleCount = f.factor_values.reduce(
              (n, fv) => n + fv.biomaterial_short_names.length,
              0,
            );
            // Collect every per-sample meta record across this
            // factor's FVs. Used to surface "verify N uncertain" —
            // samples whose assignment confidence is low or medium
            // (or whose source flags an LLM guess that the curator
            // should spot-check). Older proposals may not carry
            // meta; treat them as nothing-to-verify.
            const allMeta: Array<{
              fvIdx: number;
              meta: NonNullable<
                typeof f.factor_values[number]["biomaterial_assignment_meta"]
              >[number];
            }> = [];
            for (let vi = 0; vi < f.factor_values.length; vi++) {
              const fv = f.factor_values[vi];
              for (const m of fv.biomaterial_assignment_meta ?? []) {
                allMeta.push({ fvIdx: vi, meta: m });
              }
            }
            const uncertain = allMeta.filter(
              (e) =>
                e.meta.confidence === "low" || e.meta.confidence === "medium",
            );
            // S7 coverage tier from the proposer (if present). Drives
            // the rose / amber banner below + the per-FV chip pass.
            const coverageTier = coverageByFactorIdx.get(fi);
            // Total dataset sample count, for the partial-coverage
            // strip's "N of M uncovered" copy. ``saved`` may not have
            // loaded yet on first render — fall back to ``sampleCount``
            // (which is what the proposer sees in its assignment) so
            // the strip still reads sensibly.
            const datasetTotal =
              saved?.biomaterials.length ?? sampleCount;
            const uncoveredCount = Math.max(0, datasetTotal - sampleCount);
            return (
              <div key={fi} className="mb-2">
                <div className="flex items-baseline gap-1.5">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 mr-1"
                    checked={factorAllIncluded}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !factorAllIncluded && !factorAllExcluded;
                    }}
                    onChange={(e) => toggleFactorAll(fi, e.target.checked)}
                    title="toggle all FVs of this factor"
                    aria-label={`include factor ${f.category.label}`}
                  />
                  <span className="font-medium text-slate-700">
                    {f.category.label}
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    {f.factor_values.length} FV
                    {f.factor_values.length === 1 ? "" : "s"}
                    {sampleCount ? ` · ${sampleCount} samples` : ""}
                  </span>
                  {s3Evidence ? <Why text={s3Evidence} /> : null}
                  <IssueTagInline
                    surface="factor"
                    targetId={`factor:${f.category.label}`}
                    tags={getIssueTagsFor(`factor:${f.category.label}`)}
                    onChange={(next) =>
                      setIssueTagsFor(`factor:${f.category.label}`, next)
                    }
                  />
                </div>
                {/* S7 coverage warnings — only one fires per factor.
                    ``zero``: the factor has no per-sample mapping at
                    all. We auto-uncheck it (above), and surface a loud
                    rose banner explaining why. ``low``/``medium``:
                    partial coverage. Factor stays checked; an amber
                    strip flags the gap so the curator knows samples
                    will be left unassigned by accepting as-is.
                    ``high`` and absent decision render nothing. */}
                {coverageTier === "zero" ? (
                  <div className="ml-5 mt-1 text-[11px] rounded border border-rose-300 bg-rose-50 text-rose-800 px-2 py-1">
                    ⚠ 0 samples — proposer found no per-sample mapping.
                  </div>
                ) : coverageTier === "low" || coverageTier === "medium" ? (
                  <div className="ml-5 mt-1 text-[11px] rounded border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1">
                    ⚠ {uncoveredCount} of {datasetTotal} samples
                    uncovered by this factor ({coverageTier} confidence).
                  </div>
                ) : null}
                <ul className="ml-5 mt-1 space-y-0.5">
                  {f.factor_values.map((fv, vi) => {
                    const included = isFvIncluded(fi, vi);
                    const fvKey = `factor:${f.category.label}/fv:${vi}`;
                    const fvDecisions =
                      routed.byTargetId.get(fvKey) ||
                      // Legacy targets sometimes use the index-based form
                      // ``factor:<idx>/fv:<idx>``; fall back to a scan
                      // over ``byTargetId`` keys for any decision whose
                      // target_id mentions this factor's label.
                      [];
                    // Per-FV chips for S6 baseline picks + S10 term
                    // findings whose target_ids point at sub-paths of
                    // this FV (subject / object / etc.). Pre-bucketed
                    // during routing by ``factor:X/fv:N`` prefix —
                    // O(1) per cell instead of O(M·N) over the
                    // whole byTargetId map.
                    const fvSubDecisions =
                      routed.byFvSubpath.get(
                        `factor:${f.category.label}/fv:${vi}`,
                      ) ?? [];
                    return (
                      <li
                        key={vi}
                        className={
                          "diff-add flex items-baseline gap-1 " +
                          (included ? "" : "opacity-40 line-through")
                        }
                      >
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 mr-1"
                          checked={included}
                          onChange={(e) =>
                            toggleFv(fi, vi, e.target.checked)
                          }
                          title={
                            included
                              ? "uncheck to skip this factor value on accept"
                              : "re-include this factor value"
                          }
                          aria-label={`include factor value ${
                            fv.free_text_label ||
                            fv.statements[0]?.subject.label ||
                            "?"
                          }`}
                        />
                        <EditableFvLabel
                          uri={fv.statements[0]?.subject.uri ?? null}
                          baseline={fv.is_baseline}
                          label={
                            getLabelEdit(fi, vi) ??
                            (fv.free_text_label ||
                              fv.statements[0]?.subject.label ||
                              "?")
                          }
                          edited={getLabelEdit(fi, vi) !== undefined}
                          originalLabel={
                            fv.free_text_label ||
                            fv.statements[0]?.subject.label ||
                            "?"
                          }
                          onCommit={(next) => setLabelEdit(fi, vi, next)}
                        />
                        {fv.is_baseline ? (
                          <Pill variant="baseline" className="ml-1">
                            ★ baseline
                          </Pill>
                        ) : null}
                        {/* Statement-structure indicator. An FV is a
                            list of (subject, predicate, object)
                            triples; multi-statement FVs (e.g. "ULK1
                            and ULK2 double knockout" → two
                            ``has_genotype: knockout`` statements)
                            were invisible from the FV label alone.
                            Show a compact ``·N stmt`` badge when
                            there's more than one. The ``title``
                            spells out each subject so curators get
                            a hover summary; the Decisions tab and
                            Design view carry the full triples for
                            anyone who wants the structure. */}
                        {fv.statements.length > 1 ? (
                          <span
                            className="text-slate-500 text-[10px] ml-1 italic"
                            title={fv.statements
                              .map((s, idx) => `${idx + 1}. ${s.subject?.label || "?"}`)
                              .join("\n")}
                          >
                            ·{fv.statements.length} stmts
                          </span>
                        ) : null}
                        {/* Per-FV decision chips. S10 term-validator
                            findings render in amber; S6 baseline
                            picker renders alongside the baseline pill
                            (already covered by ``is_baseline``).
                            Duplicate findings (one per statement on a
                            multi-statement FV) collapse into a single
                            chip with a ``×N`` count. */}
                        {aggregateFvChips(
                          fvDecisions
                            .concat(fvSubDecisions)
                            .filter(
                              (d) =>
                                d.subtask !== "S6_baseline" &&
                                d.subtask !== "S6_baseline_picker",
                            ),
                        ).map((agg, di) => (
                          <span
                            key={di}
                            className="text-amber-700 text-[10px] ml-1 whitespace-nowrap"
                            title={agg.titles.join("\n")}
                          >
                            ⚠ {agg.label}
                            {agg.count > 1 ? ` ×${agg.count}` : ""}
                          </span>
                        ))}
                        {/* Per-FV "0 samples" chip — only meaningful
                            when the parent factor isn't already
                            zero-coverage (the rose banner above
                            covers that case). Catches the mixed-
                            coverage case: a partially-mapped factor
                            where some FVs are populated and others
                            aren't. Derived from the FV payload, not
                            an agent signal — assignment counts are
                            on the FV directly. */}
                        {coverageTier !== "zero" &&
                        fv.biomaterial_short_names.length === 0 ? (
                          <span
                            className="text-rose-700 text-[10px] ml-1"
                            title="Proposer assigned no samples to this FV. Other FVs in the same factor have assignments — review whether this label is supportable from the source data."
                          >
                            ⚠ 0 samples
                          </span>
                        ) : null}
                        <IssueTagInline
                          surface="fv"
                          targetId={`factor:${f.category.label}/fv:${vi}`}
                          tags={getIssueTagsFor(
                            `factor:${f.category.label}/fv:${vi}`,
                          )}
                          onChange={(next) =>
                            setIssueTagsFor(
                              `factor:${f.category.label}/fv:${vi}`,
                              next,
                            )
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
                {/* Per-factor uncertainty count + count of any
                    curator overrides for this factor. The actual
                    reassignment editor lives on the Samples tab now
                    (per Paul, 2026-04-29) — sample tiles are too
                    information-poor inside the sidebar to make
                    informed reassignment calls. */}
                {(() => {
                  // Exact factorIdx match — listReassignmentsForFactor
                  // splits on the last ``@`` and compares the suffix
                  // exactly, so this doesn't over-count when there are
                  // ≥10 factors (``@1`` would otherwise match ``@10``).
                  const myReassignments = listReassignmentsForFactor(fi).length;
                  if (uncertain.length === 0 && myReassignments === 0) {
                    return null;
                  }
                  return (
                    <div className="ml-5 mt-1 text-[11px] text-slate-500">
                      {uncertain.length > 0 ? (
                        <span className="text-amber-700">
                          {uncertain.length} uncertain
                        </span>
                      ) : null}
                      {uncertain.length > 0 && myReassignments > 0 ? (
                        <span className="mx-1">·</span>
                      ) : null}
                      {myReassignments > 0 ? (
                        <span className="text-amber-700 font-medium">
                          {myReassignments} reassigned
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* "Varied but not used" — dropped Variance-scan candidates.
              Each row carries the variance-scan evidence string; a
              ``why?`` button is wired but the click handler is a
              placeholder until the explain-dropped endpoint lands
              (slice 4). */}
          {routed.s3Dropped.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-700"
                onClick={() => setVariedOpen((v) => !v)}
              >
                {variedOpen ? "▾" : "▸"} Varied but not used as factors (
                {routed.s3Dropped.length})
              </button>
              {variedOpen && (
                <ul className="ml-5 mt-1.5 space-y-1.5 text-[11px] opacity-70">
                  {routed.s3Dropped.map((d, di) => (
                    <li key={di} className="flex items-baseline gap-1.5">
                      <span className="font-medium line-through opacity-60">
                        {parseCandidateCategory(d.target_id) || d.label}
                      </span>
                      <span className="text-slate-500 truncate">
                        — {d.verdict}
                      </span>
                      <button
                        type="button"
                        className="ml-1 text-[10px] text-slate-400 hover:text-slate-700 underline underline-offset-2"
                        title="ask the agent why this candidate was dropped (endpoint pending)"
                        onClick={(e) => e.preventDefault()}
                      >
                        why?
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------- Tags ---------------- */}
      {/* Tags below Factors. Curator's primary review path is design-
          first; tags are secondary annotation derived from / deduped
          against the factors. The tag proposer runs after the design
          proposer in the pipeline, so this also matches the
          generation order. */}
      {proposal.tags.length > 0 ? (
        <div className="px-3 py-2 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700">
              Tags ({proposal.tags.length})
            </span>
          </div>
          <ul className="space-y-1">
            {proposal.tags.map((t, i) => {
              const included = !excludedTags.has(i);
              const tagDecisions = routed.byTargetId.get(`tag:${i}`) || [];
              return (
                <li
                  key={i}
                  className={
                    "diff-add text-xs min-w-0 " +
                    (included ? "" : "opacity-40 line-through")
                  }
                >
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 mr-1"
                      checked={included}
                      onChange={(e) => toggleTag(i, e.target.checked)}
                      title={
                        included
                          ? "uncheck to skip this tag on accept"
                          : "re-include this tag"
                      }
                      aria-label={`include tag ${t.category.label}: ${t.value.label}`}
                    />
                    <span className="text-slate-500">{t.category.label}:</span>
                    <Term uri={t.value.uri ?? null}>{t.value.label}</Term>
                    {tagDecisions.map((d, di) => (
                      <span
                        key={di}
                        className="text-amber-700 text-[10px] ml-1"
                        title={d.verdict}
                      >
                        ⚠ {d.label || "warning"}
                      </span>
                    ))}
                    {t.evidence_quote ? (
                      <Why text={`evidence: "${t.evidence_quote}"`} />
                    ) : null}
                    <IssueTagInline
                      surface="tag"
                      targetId={`tag:${i}`}
                      tags={getIssueTagsFor(`tag:${i}`)}
                      onChange={(next) =>
                        setIssueTagsFor(`tag:${i}`, next)
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* ---------------- Other decisions (fallback) ---------------- */}
      {routed.other.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-100 text-xs">
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
            onClick={() => setOtherOpen((v) => !v)}
            title="other agent decisions not pinned to a specific row"
          >
            {otherOpen ? "▾" : "▸"} other decisions ({routed.other.length})
          </button>
          {otherOpen && (
            <ul className="mt-1 space-y-1">
              {routed.other.map((d, di) => (
                <li key={di} className="text-[11px]">
                  <span className="font-semibold text-slate-700 mr-1">
                    {d.label || d.subtask}
                  </span>
                  <span className="text-slate-600">{d.verdict}</span>
                  {d.citation ? (
                    <span
                      className="ml-1 text-slate-400"
                      title={d.citation_url}
                    >
                      — {d.citation}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- Feedback ---------------- */}
      <div className="px-3 py-2 border-b border-slate-100 text-xs space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-slate-700">Feedback</span>
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
            onClick={() => setMoreOpen((v) => !v)}
          >
            more options
          </button>
        </div>
        <textarea
          placeholder={
            isSkip
              ? `e.g. "treat cell type as the EFC for this atlas" / "the comparison is awake vs anesthetized"`
              : `e.g. "ignore the description, the design is X vs Y" / "rename FV labels to ..." / "drop the biological sex factor"`
          }
          rows={2}
          className="w-full text-xs border border-slate-200 rounded p-1"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <p className="text-[10px] text-slate-500 italic">
          <span title="Click 'redo with notes' to send these as instructions back to the agent for a retry. Click 'accept' or 'reject' to log them for prompt-tuning.">
            Used as retry instructions on{" "}
            <span className="not-italic font-medium">redo with notes</span>;
            logged for prompt-tuning on{" "}
            <span className="not-italic font-medium">accept</span> /{" "}
            <span className="not-italic font-medium">reject</span>.
          </span>
        </p>
        {moreOpen ? (
          <div className="mt-2 p-2 bg-slate-50 rounded text-[11px] space-y-1">
            <p className="text-[10px] text-slate-500 italic">
              Use the <span className="font-medium">+ flag</span> button
              next to any factor / FV / tag to attach a per-row problem
              tag (categorical labels for prompt-tuning). Most reviews
              don't need to.
            </p>
            {issueTags.length > 0 ? (
              <p className="text-[10px] text-amber-700 mt-1">
                {issueTags.length} flag{issueTags.length === 1 ? "" : "s"}{" "}
                attached, will be submitted with this review.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---------------- Action row ---------------- */}
      {/*
        Three verbs:
          - redo with notes : send the feedback to the agent as retry
              instructions and re-run the proposer. Today this still
              hits the existing PATCH(needs_changes) path; once the
              ``/retry`` endpoint lands the click will fire that
              instead.
          - reject          : discard, log feedback for prompt-tuning.
          - accept · apply  : apply the would-be-accepted proposal
              to the design draft and log feedback for prompt-tuning.
              No DB write yet — the CommitBar at the bottom of the
              design tab still gates commit / discard, so this verb
              is itself the curator's "preview in design" step. (A
              separate "preview" verb here used to short-circuit
              into the draft without marking the proposal accepted;
              that created a confusing pending-but-applied state and
              also bypassed Samples-tab reassignments. Removed
              2026-04-29.)
      */}
      <div className="px-3 py-2 flex items-center gap-1 justify-end flex-nowrap">
        <button
          className="btn warn text-xs"
          disabled={review.isPending || redoInFlight}
          onClick={() => setRedoConfirm(true)}
          title={
            redoInFlight
              ? "a redo is already in flight — wait for the new proposal to land"
              : feedback.trim()
                ? "Open redo confirmation. Marks this proposal needs_changes and starts a fresh agent run. Notes are logged on the retired proposal."
                : "Open redo confirmation. With no notes the agent re-runs on the same prompts — the modal will warn before burning LLM credits."
          }
        >
          {redoInFlight ? (
            <span className="inline-flex items-center gap-1">
              <Spinner size={10} />
              redoing…
            </span>
          ) : (
            "redo with notes"
          )}
        </button>
        <button
          className="btn danger text-xs"
          disabled={review.isPending}
          onClick={() => submit("rejected")}
          title="Discard this proposal. Feedback is logged for prompt-tuning."
        >
          reject
        </button>
        <button
          className="btn success text-xs"
          disabled={review.isPending || acceptCount === 0}
          onClick={() => submit("accepted")}
          title={
            acceptCount === 0
              ? "nothing selected to accept"
              : hasExclusions
                ? `accept ${acceptCount} of ${totalCount} item${totalCount === 1 ? "" : "s"} — feedback logged for prompt-tuning`
                : "apply all proposed items to the design draft — feedback logged for prompt-tuning"
          }
        >
          accept{hasExclusions ? ` ${acceptCount}/${totalCount}` : ""} · apply
        </button>
      </div>

      {review.isError ? (
        review.error instanceof ApiError && review.error.status === 404 ? (
          <div className="px-3 py-1.5 text-xs text-slate-600 border-t border-slate-100 bg-slate-50">
            This proposal no longer exists server-side (already rejected,
            or the database was reset). Refreshing the proposals list…
          </div>
        ) : (
          <div className="px-3 py-1.5 text-xs text-rose-700 border-t border-slate-100 bg-rose-50">
            {(review.error as Error).message}
          </div>
        )
      ) : null}

      {/* ---------------- Redo-with-notes confirmation ---------------- */}
      {/*
        Modal opens when the curator clicks the "redo with notes" verb.
        Shows the typed feedback verbatim so the curator can verify
        what's about to be sent. When the textarea is empty we warn —
        re-running with no guidance still uses the same agent prompts
        (the notes don't shape the new run today) and likely produces
        a similar proposal, burning LLM credits. Curator can still
        proceed if they really want to retry as-is. Cancel leaves the
        proposal in pending, untouched.

        Confirm chains: PATCH(needs_changes) for the current
        proposal → POST /propose/{id} with refresh_cache=true to
        kick off a fresh agent run. Notes are stored on the
        retired proposal for prompt-tuning. When the proposer
        service grows a /retry endpoint that threads notes into
        prompts, redoWithNotes will call that instead.
      */}
      {redoConfirm ? (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center px-4"
          onClick={() => setRedoConfirm(false)}
        >
          <div
            className="bg-white rounded shadow-lg max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-800">
                Redo with notes
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700"
                onClick={() => setRedoConfirm(false)}
                aria-label="cancel"
              >
                ×
              </button>
            </div>
            <div className="px-3 py-3 space-y-2 text-sm">
              {feedback.trim() ? (
                <>
                  <p className="text-slate-700">
                    The agent will retry with these instructions:
                  </p>
                  <blockquote className="border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-slate-800 whitespace-pre-wrap break-words text-xs">
                    {feedback}
                  </blockquote>
                  <p className="text-[11px] text-slate-500">
                    The current proposal will be marked{" "}
                    <span className="font-medium">needs changes</span>{" "}
                    and a fresh proposer run will start. Your notes
                    are threaded into the design-proposer prompt as
                    a curator-feedback block, and also logged on the
                    retired proposal for prompt-tuning. The new run
                    uses a fresh cache.
                  </p>
                </>
              ) : (
                <>
                  <div className="bg-rose-50 border border-rose-200 rounded px-2 py-1.5 text-xs text-rose-800">
                    <span className="font-semibold">No notes attached.</span>{" "}
                    The agent will re-run on the same skeleton with
                    the default prompt — without a curator-feedback
                    block to nudge it, likely a similar proposal,
                    just slower and pricier than reusing the cached
                    one.
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Cancel and add a hint in the Feedback box, or
                    proceed if you genuinely want to re-run as-is.
                  </p>
                </>
              )}
              <div className="pt-2 border-t border-slate-100">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
                  Model
                </div>
                <div className="flex flex-col gap-1">
                  {MODEL_TIER_ORDER.map((tier) => {
                    const def = MODEL_TIERS[tier];
                    const isDefault = tier === DEFAULT_MODEL_TIER;
                    return (
                      <label
                        key={tier}
                        className="flex items-start gap-2 text-xs cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5"
                      >
                        <input
                          type="radio"
                          name="retry-model-tier"
                          value={tier}
                          checked={retryTier === tier}
                          onChange={() => setRetryTier(tier)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-800 flex items-baseline gap-1.5">
                            <span className="font-medium">{def.label}</span>
                            <span
                              className="font-mono text-[10px] text-amber-700"
                              title={`relative cost: ${def.costMarker}`}
                            >
                              {def.costMarker}
                            </span>
                            {isDefault ? (
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                default
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {def.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {/*
                  Cost-guard line. Triggers when the curator is about
                  to redo on "strong" AND the previous run was already
                  on strong — second strong run usually means the
                  feedback could be sharpened first. Just a nudge, not
                  a block.
                 */}
                {retryTier === "strong" &&
                tierForProviderModel(proposal.model) === "strong" ? (
                  <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    The previous run was already on{" "}
                    <span className="font-semibold">strong</span>. Consider
                    sharpening the feedback before another strong run —
                    they're the priciest and a similar proposal is likely
                    without new instructions.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn ghost text-xs"
                onClick={() => setRedoConfirm(false)}
              >
                cancel
              </button>
              <button
                type="button"
                className={
                  "text-xs " +
                  (feedback.trim() ? "btn warn" : "btn danger")
                }
                onClick={() => {
                  setRedoConfirm(false);
                  void redoWithNotes();
                }}
                disabled={review.isPending || redoInFlight}
              >
                {review.isPending
                  ? "saving…"
                  : redoInFlight
                    ? "starting redo…"
                    : feedback.trim()
                      ? "redo with these notes"
                      : "redo as-is anyway"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
        </>
      )}

      {tab === "decisions" && <DecisionsTab proposal={proposal} />}

      {tab === "details" && <DetailsTab proposal={proposal} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecisionsTab — full structured rationale across every subtask
// decision the agent emitted, plus the raw LLM extractions / gate
// dumps the proposer wrote alongside (pretty-printed when they
// parse as JSON). Groups subtask decisions by family (S1 triage,
// S3 candidates, S6 baseline, S10 terms, …) so curators can audit
// end-to-end without the chip-tooltip truncation that Review uses.
// ---------------------------------------------------------------------------

/** Quote-key heuristic: when a JSON value belongs to one of these
 *  keys, render it with the "quote from source" pattern (italic +
 *  emerald accent + quotation marks) so it's visually distinct
 *  from the agent's own commentary. Covers both paper quotes and
 *  metadata-derived quotes (sample title, characteristic value,
 *  description fragment, etc.). */
const QUOTE_KEYS = new Set([
  "evidence_quote",
  "evidence",
  "quote",
  "excerpt",
  "citation_quote",
  "source_quote",
  "skeleton_quote",
  "metadata_quote",
  "supporting_quote",
]);

/** Try to JSON-parse a Python-repr-ish string. The agents side
 *  records ``str(dict)`` for the raw extractions today, which is
 *  almost-but-not-JSON (single-quoted, ``True/False/None`` instead
 *  of ``true/false/null``). We do a best-effort transform; if it
 *  still doesn't parse, fall back to the raw string and skip
 *  pretty-printing. */
function tryParseJsonLike(s: string): unknown | null {
  if (!s) return null;
  // First-pass: real JSON.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  // Second-pass: Python-repr → JSON. Naive but works for the
  // dicts the proposer dumps (no embedded apostrophes-in-strings
  // to speak of in the typical case; if it fails we fall back).
  try {
    const swapped = s
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) =>
        JSON.stringify(inner.replace(/\\'/g, "'")),
      );
    return JSON.parse(swapped);
  } catch {
    return null;
  }
}

/** Pretty-print a parsed JSON object with quote-from-source values
 *  highlighted. Recursively walks the structure; for any value
 *  whose key matches ``QUOTE_KEYS`` (or whose parent key does, for
 *  arrays of quotes), renders the value in italics with a left
 *  emerald border. Other values render in monospace as you'd
 *  expect from a JSON pretty-print. */
function PrettyJson({
  value,
  parentKey,
  indent = 0,
}: {
  value: unknown;
  parentKey?: string;
  indent?: number;
}) {
  const pad = "  ".repeat(indent);
  const isQuoteContext =
    !!parentKey && QUOTE_KEYS.has(parentKey.toLowerCase());

  if (value === null) return <span className="text-slate-400">null</span>;
  if (typeof value === "boolean")
    return <span className="text-purple-700">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="text-blue-700">{value}</span>;
  if (typeof value === "string") {
    if (isQuoteContext && value.length > 0) {
      return (
        <span className="text-emerald-900 bg-emerald-50/60 italic border-l-2 border-emerald-400 pl-1.5">
          “{value}”
        </span>
      );
    }
    return <span className="text-slate-700">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return (
      <>
        [
        {value.map((item, i) => (
          <div key={i} style={{ paddingLeft: `${(indent + 1) * 12}px` }}>
            <PrettyJson value={item} parentKey={parentKey} indent={indent + 1} />
            {i < value.length - 1 ? "," : ""}
          </div>
        ))}
        <div style={{ paddingLeft: `${indent * 12}px` }}>]</div>
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span>{"{}"}</span>;
    return (
      <>
        {"{"}
        {entries.map(([k, v], i) => (
          <div key={k} style={{ paddingLeft: `${(indent + 1) * 12}px` }}>
            <span className="text-slate-500">"{k}"</span>:{" "}
            <PrettyJson value={v} parentKey={k} indent={indent + 1} />
            {i < entries.length - 1 ? "," : ""}
          </div>
        ))}
        <div style={{ paddingLeft: `${indent * 12}px` }}>{"}"}</div>
      </>
    );
  }
  return <span>{String(value)}</span>;
  // ``pad`` is unused at the leaf level — kept above for clarity.
  void pad;
}

function RawBlock({ label, body }: { label: string; body: string }) {
  const parsed = tryParseJsonLike(body);
  return (
    <details className="text-[12px]">
      <summary className="text-slate-600 cursor-pointer hover:text-slate-900">
        {label}
      </summary>
      <div className="mt-1 max-h-[32rem] overflow-auto bg-slate-50 border border-slate-200 rounded p-2 text-slate-800 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words">
        {parsed !== null ? (
          <PrettyJson value={parsed} />
        ) : (
          // Fallback: truncated str(dict) that we couldn't parse.
          // Render verbatim so the curator can still read it.
          body
        )}
      </div>
    </details>
  );
}

// Map a SubtaskDecision into a curator-readable Q&A. Each row of
// the Decisions tab reads like a question with a short answer chip
// (Yes / No / Unclear / specific) and the rationale on the line
// below — instead of "Split decision: should_split", which reads
// like a noun phrase nobody asked for. Subtasks the humanizer
// doesn't know about fall back to ``label || subtask`` as the
// question and the verdict head as the answer, so newly-added
// agent steps still render legibly.
function humanizeDecision(d: SubtaskDecision): {
  question: string;
  answer: string;
  answerKind: "yes" | "no" | "maybe" | "info";
  rationale: string;
} {
  const subtask = d.subtask || "";
  const verdict = (d.verdict || "").trim();
  const head = (verdict.split(/[.\n]/)[0] || verdict).trim();
  const periodIdx = verdict.indexOf(".");
  const rationale =
    periodIdx >= 0 ? verdict.slice(periodIdx + 1).trim() : "";
  const humanHead = head.replace(/_/g, " ");

  switch (subtask) {
    case "S1_design_verdict":
      if (head.startsWith("design"))
        return {
          question: "Has a valid experimental design?",
          answer: "Yes",
          answerKind: "yes",
          rationale,
        };
      if (head.startsWith("unclear"))
        return {
          question: "Has a valid experimental design?",
          answer: "Unclear",
          answerKind: "maybe",
          rationale,
        };
      return {
        question: "Has a valid experimental design?",
        answer: `No — ${humanHead}`,
        answerKind: "no",
        rationale,
      };
    case "S1_split_verdict":
      if (head.startsWith("single_experiment"))
        return {
          question: "Candidate for splitting?",
          answer: "No",
          answerKind: "no",
          rationale,
        };
      if (head.startsWith("should_split"))
        return {
          question: "Candidate for splitting?",
          answer: "Yes",
          answerKind: "yes",
          rationale,
        };
      return {
        question: "Candidate for splitting?",
        answer: humanHead,
        answerKind: "maybe",
        rationale,
      };
    case "S1_subset_verdict": {
      if (head.startsWith("no_subset"))
        return {
          question: "Subset DEAs needed?",
          answer: "No",
          answerKind: "no",
          rationale,
        };
      const m = head.match(/^subset_by_([a-z_]+)/);
      if (m)
        return {
          question: "Subset DEAs needed?",
          answer: `Yes — by ${m[1].replace(/_/g, " ")}`,
          answerKind: "yes",
          rationale,
        };
      return {
        question: "Subset DEAs needed?",
        answer: humanHead || "Unclear",
        answerKind: "maybe",
        rationale,
      };
    }
    case "S1_design_detector":
      return {
        question: "Design detector",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "S2_forbidden_efc":
      return {
        question: "Forbidden EFC dropped?",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "S3_factor_identifier":
      return {
        question: "Factor identifier summary",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "S3_factor_candidate":
      return {
        question: d.label || "Factor candidate",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "S3_vs_proposer_diff":
      return {
        question: "S3 vs proposer divergence",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "S5_continuous_populator": {
      // Verdict shapes:
      //   "continuous factor 'age'; populated from characteristic 'age': 35 distinct value(s) across 41 sample(s)"
      //   "NOT POPULATED: <reason>"
      const notPopulated = verdict.startsWith("NOT POPULATED");
      return {
        question: "Continuous factor populated?",
        answer: notPopulated ? "No" : "Yes",
        answerKind: notPopulated ? "no" : "yes",
        rationale: notPopulated
          ? verdict.replace(/^NOT POPULATED:\s*/i, "").trim()
          : verdict,
      };
    }
    case "S8_dea_usability": {
      // Verdict starts with "usable:" or "not_usable:" then names
      // the supporting / unsupporting factors. Informational —
      // never blocks acceptance.
      const notUsable = head.startsWith("not_usable");
      return {
        question: "Suitable for DEA?",
        answer: notUsable ? "No" : "Yes",
        answerKind: notUsable ? "no" : "yes",
        rationale: verdict.replace(/^(not_)?usable:\s*/i, "").trim(),
      };
    }
    case "S10_term_validator":
      return {
        question: "Term valid in Gemma?",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    case "design_recommend_skip":
      return {
        question: "Recommend skipping?",
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
    default:
      if (subtask.startsWith("design_gate_")) {
        const gate = subtask
          .replace("design_gate_", "")
          .replace(/_/g, " ");
        return {
          question: `Design gate: ${gate}`,
          answer: humanHead,
          answerKind: "info",
          rationale,
        };
      }
      return {
        question: d.label || subtask,
        answer: humanHead,
        answerKind: "info",
        rationale,
      };
  }
}

function answerChipClass(kind: "yes" | "no" | "maybe" | "info"): string {
  switch (kind) {
    case "yes":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "no":
      return "bg-slate-100 text-slate-700 border-slate-300";
    case "maybe":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "info":
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function DecisionsTab({ proposal }: { proposal: Proposal }) {
  const decisions = proposal.evidence?.subtask_decisions ?? [];
  if (decisions.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-slate-500 italic">
        No structured decisions on this proposal.
      </div>
    );
  }
  // Group by the leading "Sx" prefix of the subtask string so
  // related decisions cluster (S3 factor candidates land together,
  // S1 triage rows land together). Anything without a prefix —
  // ``design_gate_*``, ``design_recommend_skip`` — falls under
  // "Pipeline" since it's pipeline-level state, not a numbered
  // subtask.
  const groups = new Map<string, SubtaskDecision[]>();
  for (const d of decisions) {
    const m = (d.subtask || "").match(/^(S\d+)/);
    const k = m ? m[1] : "Pipeline";
    const list = groups.get(k) ?? [];
    list.push(d);
    groups.set(k, list);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === "Pipeline") return 1;
    if (b === "Pipeline") return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  return (
    <div className="px-3 py-3 space-y-3 text-xs">
      {order.map((k) => (
        <section key={k}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
            {k === "S1"
              ? "Triage"
              : k === "S2"
                ? "Forbidden EFCs"
                : k === "S3"
                  ? "Factor candidates"
                  : k === "S5"
                    ? "Continuous-factor population"
                    : k === "S8"
                      ? "DEA usability"
                      : k === "S10"
                        ? "Term validation"
                        : k}
          </div>
          <ul className="space-y-1.5">
            {groups.get(k)!.map((d, i) => {
              const h = humanizeDecision(d);
              return (
                <li
                  key={i}
                  className="border border-slate-200 rounded p-2 bg-slate-50/50"
                >
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-slate-800">{h.question}</span>
                    <span
                      className={cn(
                        "text-[11px] font-medium px-1.5 py-0.5 rounded border",
                        answerChipClass(h.answerKind),
                      )}
                    >
                      {h.answer}
                    </span>
                    {d.target_id ? (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {d.target_id}
                      </span>
                    ) : null}
                  </div>
                  {h.rationale ? (
                    <div className="mt-1 text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                      {h.rationale}
                    </div>
                  ) : null}
                  {d.citation ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {d.citation_url ? (
                        <a
                          href={d.citation_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline"
                        >
                          {d.citation}
                        </a>
                      ) : (
                        d.citation
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailsTab — raw LLM extractions and gate dumps. These are the
// proposer's structured output before the humanizer simplified it,
// kept around as the deepest level of audit trail. Pretty-printed
// when parseable as JSON; ``evidence_quote``-shaped values
// highlighted as actual paper / metadata quotes.
// ---------------------------------------------------------------------------

function DetailsTab({ proposal }: { proposal: Proposal }) {
  const extra = proposal.evidence?.extra || {};
  const rawTag = extra.tag_proposer_raw || "";
  const rawDesign = extra.design_proposer_raw || "";
  const validation = extra.validation || "";
  const designGate = extra.design_gate || "";
  if (!rawTag && !rawDesign && !validation && !designGate) {
    return (
      <div className="px-3 py-3 text-xs text-slate-500 italic">
        No raw extractions stored on this proposal.
      </div>
    );
  }
  return (
    <div className="px-3 py-3 space-y-2 text-xs">
      <p className="text-[11px] text-slate-500">
        Raw output from the LLM and pipeline gates. Quoted text from
        the paper or sample metadata renders as{" "}
        <span className="italic text-emerald-900 bg-emerald-50/60 border-l-2 border-emerald-400 pl-1">
          highlighted
        </span>
        .
      </p>
      <div className="space-y-1.5">
        {designGate ? <RawBlock label="design gate" body={designGate} /> : null}
        {rawDesign ? (
          <RawBlock label="design proposer raw" body={rawDesign} />
        ) : null}
        {rawTag ? <RawBlock label="tag proposer raw" body={rawTag} /> : null}
        {validation ? <RawBlock label="validation" body={validation} /> : null}
      </div>
    </div>
  );
}

/**
 * FV label rendered as a Term chip with an inline ✎ that toggles to
 * an editable input. Curators rename "mock" → "uninfected" or fix a
 * typo in the proposed label without leaving the card.
 *
 * Edits are local to the card (live in ``labelEdits`` state); on
 * accept the corrected label rides on ``feedback.edits.factors[*].
 * factor_values[*].free_text_label``. The URI / statements are
 * unchanged — pure label rename. Term-swap (changing which ontology
 * URI the FV resolves to) is a separate slice.
 */
function EditableFvLabel({
  uri,
  baseline,
  label,
  edited,
  originalLabel,
  onCommit,
}: {
  uri: string | null;
  baseline: boolean;
  label: string;
  /** True when ``label`` is a curator override (differs from the
   *  proposer's original); we render a subtle "edited" cue + a
   *  revert affordance. */
  edited: boolean;
  /** Proposer's original label, used for the revert tooltip. */
  originalLabel: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when the parent's source-of-truth label
  // changes (e.g. a sibling edit re-renders us). Only when not
  // editing — otherwise the curator's keystrokes get clobbered.
  useEffect(() => {
    if (!editing) setDraft(label);
  }, [editing, label]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== label) onCommit(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(label);
            setEditing(false);
          }
        }}
        className={
          "term px-1.5 py-0.5 text-xs bg-white border-blue-300 " +
          "outline-none focus:border-blue-500 min-w-[6rem]"
        }
      />
    );
  }
  return (
    <span className="inline-flex items-baseline gap-0.5">
      {/*
        The chip itself is the click target — double-click opens
        the inline rename input. Matches the pattern the design-tab
        OntologyTermPicker uses; no separate pencil affordance, so
        the curator only ever sees one way to edit a label and
        doesn't have to figure out which icon does what.
      */}
      <span
        role="button"
        tabIndex={0}
        onDoubleClick={() => {
          setDraft(label);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDraft(label);
            setEditing(true);
          }
        }}
        title={
          edited
            ? `${label} (curator-edited; original: ${originalLabel}) — double-click to edit`
            : "double-click to edit label"
        }
        className="cursor-text"
      >
        {/* Baseline status is signalled by a sibling pill, not by
            tinting the Term itself — green is reserved for the
            "ontology-resolved" cue. The ``baseline`` prop is still
            useful for the parent's tooltip / aria text. */}
        <Term uri={uri}>{label}</Term>
      </span>
      {edited ? (
        <button
          type="button"
          onClick={() => onCommit(originalLabel)}
          className="text-amber-600 hover:text-amber-800 text-[10px] leading-none px-0.5"
          title={`revert to proposer's original: "${originalLabel}"`}
          aria-label="revert label"
        >
          ↺
        </button>
      ) : null}
    </span>
  );
}

/** Friendly chip label for a per-target SubtaskDecision. The
 *  decision's ``label`` is usually fine; we trim a couple of
 *  recognised prefixes so the chip stays scannable. */
function chipLabelFor(d: SubtaskDecision): string {
  const lab = d.label || d.subtask || "warning";
  if (d.subtask === "S10_term_validator") {
    if (d.verdict.includes("free-text")) return "free-text";
    if (d.verdict.includes("not in Gemma")) return "not-in-index";
    if (d.verdict.includes("novel")) return "novel";
  }
  return lab.replace(/^Term validator$/i, "term");
}

/** Bucket per-FV decision chips so duplicate findings collapse into
 *  one chip with a ``×N`` count. Without this, an FV with two
 *  statements that both fail term validation renders two identical
 *  ``⚠ free-text`` chips next to each other (the ULK1 + ULK2
 *  double-knockout case). One chip plus a count is more scannable
 *  and frees space for a separate statement-structure indicator. */
function aggregateFvChips(
  decisions: SubtaskDecision[],
): { label: string; count: number; titles: string[] }[] {
  const buckets = new Map<
    string,
    { label: string; count: number; titles: string[] }
  >();
  for (const d of decisions) {
    const label = chipLabelFor(d);
    const existing = buckets.get(label);
    if (existing) {
      existing.count++;
      existing.titles.push(d.verdict);
    } else {
      buckets.set(label, { label, count: 1, titles: [d.verdict] });
    }
  }
  return [...buckets.values()];
}
