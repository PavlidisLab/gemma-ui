/**
 * Chip-picker option sets for the disposition dialogs (Dismiss /
 * Accept / Not-sure). Each chip carries a wire-stable `key` (mapping
 * straight to the server's `DismissReason` / `AcceptReason` /
 * `NotSureReason` enums) plus the curator-facing label and a short
 * help string for hover.
 *
 * Ordering of chips is by curator-usage frequency, NOT enum order —
 * the most-common reason is the first thing the eye lands on so the
 * modal answer is quick. The per-finding-code routing
 * (`dismissChipsFor` / `acceptChipsFor`) swaps in calibration-flavoured
 * sets when the finding's `issue_code` calls for TP/FP/FN/TN framing
 * instead of generic curation-urgency framing.
 *
 * Background: pre-routing, calibration findings fell through to the
 * generic chip sets, and amanda ended up routing 19/20 v7b factor-
 * gold-miss dismisses through `weak_evidence` (the closest-feeling
 * chip in the wrong vocab). See CALIBRATION_CHIP_GAP_HANDOFF.md.
 */

import type { DialogChip } from "./DismissDialog";
import type { AuditFinding } from "@/api/auditTypes";

// ---------------------------------------------------------------------------
// Generic chip sets — used when the finding isn't a calibration code
// ---------------------------------------------------------------------------

// Ordered by curator-usage frequency, not enum order, so the modal
// answer is the first chip the eye lands on. Cross-curator data
// (CALIBRATION_CHIP_GAP_HANDOFF.md, 2026-05-14) showed `weak_evidence`
// is the right chip for the bulk of dismisses curators were routing
// through `other` — leading with it cuts the `other` rate.
export const DISMISS_CHIPS: DialogChip[] = [
  { key: "weak_evidence",       label: "Weak evidence",      help: "agent's evidence doesn't support the finding" },
  { key: "redundant",           label: "Redundant",          help: "finding duplicates an issue already noted elsewhere" },
  { key: "out_of_scope",        label: "Out of scope",       help: "valid finding but outside this curation pass" },
  { key: "accepted_elsewhere",  label: "Accepted elsewhere", help: "the change was already made via a different finding" },
  { key: "wont_fix",            label: "Won't fix",          help: "acknowledged but intentionally not acted on" },
  { key: "other",               label: "Other",              help: "doesn't fit the above — add a note" },
];

export const ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced", label: "Well evidenced", help: "strong evidence in the paper or data" },
  { key: "fills_gap",      label: "Fills gap",      help: "adds information absent from current curation" },
  { key: "more_specific",  label: "More specific",  help: "more precise than the existing entry" },
  { key: "other",          label: "Other",          help: "doesn't fit the above — add a note" },
];

export const NOT_SURE_CHIPS: DialogChip[] = [
  { key: "need_more_data",    label: "Need more data",    help: "not enough information to decide" },
  { key: "need_expert",       label: "Need expert",       help: "requires domain expertise to evaluate" },
  { key: "pending_update",    label: "Pending update",    help: "waiting on an upstream change before acting" },
  { key: "other",             label: "Other",             help: "doesn't fit the above — add a note" },
];

// ---------------------------------------------------------------------------
// Calibration chip sets — TP / FP / FN / TN framing for cal_* findings
// ---------------------------------------------------------------------------

// Calibration-specific chip sets. In Mode C (evaluation), dispositions
// judge the agent's accuracy relative to gold — not curation-urgency.
// Chips are framed from the agent's perspective: FN/FP/TN/TP.
//
//   calibration_gold_only_miss: gold has X, agent didn't propose X.
//     Disagree → agent FN (should have proposed it)
//     Accept   → agent TN (correctly omitted; gold was wrong)
//
//   calibration_agent_extra: agent proposed X, gold doesn't have X.
//     Disagree → agent FP (should not have proposed it)
//     Accept   → agent TP (correctly proposed; gold was missing it)

// For calibration_*_gold_only_miss: "Disagree" means curator thinks
// gold is right (agent made a FN). Chips explain WHY — the verdict is
// already implied.
//
// `agent_real_miss` leads the list because it's the largest single
// chip-gap by case-count across curators (~50 cases pre-landing;
// see CALIBRATION_CHIP_GAP_HANDOFF.md). Used for both tag and
// factor gold-miss findings (server gate accepts both).
export const CAL_MISS_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_real_miss", label: "Agent missed it",  help: "the curator's gold tag is well-supported; agent's omission was an error" },
  { key: "missed_evidence", label: "Missed evidence",  help: "agent overlooked supporting evidence in the paper/data" },
  { key: "borderline",      label: "Borderline",       help: "close call — could reasonably go either way" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_*_gold_only_miss: "Accept (remove)" means curator
// thinks gold is wrong (agent TN). Chips explain WHY.
export const CAL_MISS_ACCEPT_CHIPS: DialogChip[] = [
  { key: "gold_was_wrong",  label: "Gold wrong",       help: "Gemma's existing tag is incorrect or outdated" },
  { key: "borderline",      label: "Borderline",       help: "close call — acceptable to remove" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_agent_extra (tag-side): "Disagree" means curator
// thinks the agent over-proposed (agent FP). Chips explain WHY.
//
// `not_sample_applicable` leads — amanda's 8 v18 cases + cross-curator
// confirmation. `redundant_with_bm_source` is tag-only per the server
// gate (factor extras don't show this shape).
export const CAL_EXTRA_TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "not_sample_applicable",  label: "Subset only",                help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "no_evidence",            label: "No evidence",                help: "no supporting evidence in the paper/data" },
  // Server wire key stays `redundant_with_bm_source` (validator
  // contract), but the curator-facing label is now category-neutral.
  // The same reason fires for: a BM characteristic carrying the term
  // (cell line, organism part, sample source, etc.), a factor value
  // with full sample coverage (every sample has the term — making
  // the tag a constant), or any other curation surface that already
  // captures what the agent proposed.
  { key: "redundant_with_bm_source", label: "Redundant",                help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "out_of_scope",           label: "Out of scope",               help: "outside the scope of this tag category" },
  { key: "borderline",             label: "Borderline",                 help: "close call — could reasonably go either way" },
  { key: "other",                  label: "Other",                      help: "add a note" },
];
// For calibration_factor_extra: subset of the tag-side chips. The
// new `not_sample_applicable` / `redundant_with_bm_source` chips
// don't apply — factor values define their sample groupings
// explicitly, and BM-source redundancy is a tag concept.
export const CAL_EXTRA_FACTOR_DISMISS_CHIPS: DialogChip[] = [
  { key: "no_evidence",     label: "No evidence",      help: "no supporting evidence in the paper/data" },
  { key: "out_of_scope",    label: "Out of scope",     help: "outside the scope of this factor category" },
  { key: "borderline",      label: "Borderline",       help: "close call — could reasonably go either way" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_agent_extra: "Accept (add)" means curator agrees
// with agent (agent TP). Chips explain WHY.
export const CAL_EXTRA_ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced",  label: "Well evidenced",   help: "strong evidence in the paper or data" },
  { key: "fills_gap",       label: "Fills gap",        help: "adds information absent from current gold" },
  { key: "borderline",      label: "Borderline",       help: "close call — acceptable to add" },
  { key: "other",           label: "Other",            help: "add a note" },
];

// Tag-target dismiss vocab — generic dismissals PLUS the two
// tag-shape-specific chips (`not_sample_applicable` / "Subset only" +
// `redundant_with_bm_source` / "Redundant"). Used for tag-target
// findings that aren't `calibration_agent_extra` (which has its own
// `CAL_EXTRA_TAG_DISMISS_CHIPS` set above). Per Paul 2026-06-12: "a
// disposition for a tag like 'Only applies to some samples' would be
// more helpful than 'weak evidence' or 'out of scope'." Server-side
// gate for both chips widened from `{calibration_agent_extra}` to
// any tag-target finding per bro's 2026-06-12 schema update; safe to
// surface here without 422 risk.
export const TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "not_sample_applicable",  label: "Subset only",        help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "redundant_with_bm_source", label: "Redundant",        help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "weak_evidence",       label: "Weak evidence",      help: "agent's evidence doesn't support the finding" },
  { key: "redundant",           label: "Redundant (other)",  help: "finding duplicates an issue already noted elsewhere" },
  { key: "out_of_scope",        label: "Out of scope",       help: "valid finding but outside this curation pass" },
  { key: "accepted_elsewhere",  label: "Accepted elsewhere", help: "the change was already made via a different finding" },
  { key: "wont_fix",            label: "Won't fix",          help: "acknowledged but intentionally not acted on" },
  { key: "other",               label: "Other",              help: "doesn't fit the above — add a note" },
];

// ---------------------------------------------------------------------------
// Per-issue-code chip routers — pick the right set for the finding
// ---------------------------------------------------------------------------

/** Factor variants share the calibration chip sets with their tag
 *  counterparts — same TP/FP/FN/TN framing, same curator rationales
 *  in practice. Without this routing the factor codes fall through
 *  to the generic DISMISS_CHIPS / ACCEPT_CHIPS, which is how amanda
 *  ended up routing 19/20 v7b factor-gold-miss dismisses through
 *  `weak_evidence` (the closest-feeling chip in the wrong vocab) —
 *  see CALIBRATION_CHIP_GAP_HANDOFF.md, "Discoverability ask".
 *
 *  Tag-target findings outside ``calibration_agent_extra`` route to
 *  ``TAG_DISMISS_CHIPS`` — the generic vocab plus "Subset only" and
 *  "Redundant" (server-side gate widened 2026-06-12 per
 *  UIB_HANDOFF_2026_06_12_DISMISS_REASON_GATE_WIDEN.md). */
export function dismissChipsFor(
  finding: Pick<AuditFinding, "issue_code" | "target_kind">,
): DialogChip[] {
  const issueCode = finding.issue_code;
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  )
    return CAL_MISS_DISMISS_CHIPS;
  if (issueCode === "calibration_agent_extra")
    return CAL_EXTRA_TAG_DISMISS_CHIPS;
  if (issueCode === "calibration_factor_extra")
    return CAL_EXTRA_FACTOR_DISMISS_CHIPS;
  if (finding.target_kind === "tag") return TAG_DISMISS_CHIPS;
  return DISMISS_CHIPS;
}

export function acceptChipsFor(issueCode: string): DialogChip[] {
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  )
    return CAL_MISS_ACCEPT_CHIPS;
  if (
    issueCode === "calibration_agent_extra" ||
    issueCode === "calibration_factor_extra"
  )
    return CAL_EXTRA_ACCEPT_CHIPS;
  return ACCEPT_CHIPS;
}
