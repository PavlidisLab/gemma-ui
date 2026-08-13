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
 * generic chip sets, and Curator A ended up routing 19/20 v7b factor-
 * gold-miss dismisses through `weak_evidence` (the closest-feeling
 * chip in the wrong vocab).
 */

import type { DialogChip } from "./DismissDialog";
import type { AuditFinding } from "@/api/auditTypes";

// ---------------------------------------------------------------------------
// Generic chip sets — used when the finding isn't a calibration code
// ---------------------------------------------------------------------------

// Ordered by curator-usage frequency, not enum order, so the modal
// answer is the first chip the eye lands on. Cross-curator data
// (2026-05-14) showed `weak_evidence` is the right chip for the bulk
// of dismisses curators were routing through `other` — leading with
// it cuts the `other` rate.
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
// chip-gap by case-count across curators (~50 cases pre-landing).
// Used for both tag and factor gold-miss findings (server gate
// accepts both).
// 2026-06-14 vocab expansion per design review + the agents-side open-enum wire:
// "Structure correct, FVs need work" and "Wrong partition, factor right"
// reflect what curators actually say when they disagree with a
// remove-factor proposal. These join the existing
// `agent_real_miss` / `missed_evidence` chips; agent-side gates are
// now permissive (`DismissReason: str`), so new slugs ship without
// coordination.
// FACTOR-side removal dismiss — curator says "don't remove the
// factor"; the factor / its FVs / its partition need to stay
// (possibly with fixes). Factor concepts: FVs, partition, structure.
export const CAL_MISS_FACTOR_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_real_miss",            label: "Factor needed",         help: "the factor + its FVs are correct; agent should have proposed it" },
  { key: "structure_correct_fvs_wrong", label: "Structure correct, FVs need work", help: "the factor category is right but the FV labels / values need fixing — don't remove" },
  { key: "wrong_partition",            label: "Wrong partition",       help: "the factor exists but the sample assignment to FVs is wrong — don't remove" },
  { key: "missed_evidence",            label: "Missed evidence",       help: "agent overlooked supporting evidence in the paper/data" },
  { key: "borderline",                 label: "Borderline",            help: "close call — could reasonably go either way" },
  { key: "other",                      label: "Other",                 help: "add a note" },
];

// TAG-side removal dismiss — curator says "don't remove the tag";
// the tag is correct and should stay. Tags have NO factor values,
// NO partition, NO structure — chips that talk about FVs/partition
// don't apply. Per design review 2026-06-15: "tags don't have factor values
// or levels or structure GET IT RIGHT" and earlier: "When prompted
// to _remove_ a tag, the _reject_ would be by ('keep') 'Agent
// missed it' pretty much."
export const CAL_MISS_TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_missed_it",     label: "Agent missed it",     help: "the tag is correct and applies; agent should have kept it" },
  { key: "tag_applies_broadly", label: "Applies broadly",     help: "the tag covers the profiled samples — countering a 'subset only' rationale" },
  { key: "missed_evidence",     label: "Missed evidence",     help: "agent overlooked supporting evidence in the paper/data" },
  { key: "borderline",          label: "Borderline",          help: "close call — could reasonably go either way" },
  { key: "other",               label: "Other",               help: "add a note" },
];

/** @deprecated Use ``CAL_MISS_FACTOR_DISMISS_CHIPS`` (factor-side)
 *  or ``CAL_MISS_TAG_DISMISS_CHIPS`` (tag-side). Kept as an alias
 *  for any external import; remove once consumers settle on the
 *  split-by-target_kind sets. Routes per target_kind via
 *  ``dismissChipsFor``. */
export const CAL_MISS_DISMISS_CHIPS = CAL_MISS_FACTOR_DISMISS_CHIPS;
// For calibration_*_gold_only_miss: "Accept (remove)" means curator
// agrees with agent's removal. Chips align with the reasons a
// curator would normally remove a current tag, per design review 2026-06-15:
// "it should be the same reasons that we remove the 'current':
// agent is right but we can be more specific; the current is
// redundant; or the current is wrong." Open-enum on the wire —
// new slugs ship without agent-side coordination.
// Measured curator use (local-curator only): current_wrong 23,
// current_redundant 21, more_specific_available 4. Leading with
// `current_wrong` rather than `current_redundant`, which is how this
// list had it.
export const CAL_MISS_ACCEPT_CHIPS: DialogChip[] = [
  { key: "current_wrong",          label: "Current wrong",          help: "the current tag is incorrect or outdated — agent's removal is right" },
  { key: "current_redundant",      label: "Current redundant",      help: "the current tag is already captured elsewhere — by a biomaterial characteristic, a factor value, or another tag" },
  { key: "more_specific_available", label: "More specific available", help: "agent's removal is right because a finer-grained tag better captures this (often paired with an add proposal elsewhere)" },
  { key: "borderline",             label: "Borderline",             help: "close call — acceptable to remove" },
  { key: "other",                  label: "Other",                  help: "add a note" },
];

/**
 * FACTOR-side removal accept — the curator agrees to drop an
 * already-curated factor.
 *
 * This set exists because the dismiss side was split by `target_kind`
 * in 2026-06-15 ("tags don't have factor values or levels or
 * structure") and the ACCEPT side never was, so agreeing to remove a
 * FACTOR was offering tag-flavoured reasons about "the current tag".
 *
 * 🛑 **Removing a curated factor outright is very rare** — 1 of 20
 * factor gold-only-miss rows in the corpus, against 19 "keep it". So a
 * broad `current_wrong` is the wrong shape here: when the answer is
 * this rare, the interesting question is always *which* rare thing,
 * and a catch-all would collapse the distinction that made it worth
 * recording.
 *
 * `swapped_for_other_proposal` leads, per Paul 2026-08-13: factors
 * still fail to line up between agent and gold, so a removal is often
 * not a judgement about the factor at all — the same axis is arriving
 * under another proposal and the removal is bookkeeping. That
 * distinction matters beyond the UI: such a row is a MATCHER artifact
 * and is not evidence that the curated factor was wrong, so it should
 * not be scored as one.
 */
export const CAL_MISS_FACTOR_ACCEPT_CHIPS: DialogChip[] = [
  { key: "swapped_for_other_proposal", label: "Swapping with another proposal", help: "the same axis is being added by a different proposal — this removal is bookkeeping, not a judgement that the factor was wrong. NOT evidence the curated factor was incorrect." },
  { key: "partition_wrong",        label: "Partition wrong",        help: "the factor's sample groupings are wrong — the axis may be real but this partition of the samples isn't" },
  { key: "current_redundant",      label: "Already covered",        help: "another factor / tag / characteristic already captures this axis" },
  { key: "more_specific_available", label: "More specific available", help: "a finer-grained factor better captures this (usually paired with an add proposal elsewhere)" },
  { key: "not_a_real_axis",        label: "Not a real axis",        help: "the factor doesn't describe an experimental variable at all — the genuinely-remove-it case, and the rare one" },
  { key: "borderline",             label: "Borderline",             help: "close call — acceptable to remove" },
  { key: "other",                  label: "Other",                  help: "add a note" },
];
// For calibration_agent_extra (tag-side): "Disagree" means curator
// thinks the agent over-proposed (agent FP). Chips explain WHY.
//
// `not_sample_applicable` leads — Curator A's 8 v18 cases + cross-curator
// confirmation. `redundant_with_bm_source` is tag-only per the server
// gate (factor extras don't show this shape).
// 2026-08-13 vocabulary revision, from all 456 stored dispositions.
// Three findings drove it:
//
//  1. `other` ran 20/225 on the dismiss side, and its notes were not
//     miscellaneous — 11 said some version of "garbage" (twice with
//     typos, i.e. hand-typed repeatedly), 14 said "about".
//  2. Curators picked a chip that CONTRADICTS their own note —
//     `not_sample_applicable | garbage`, `out_of_scope | garbage`,
//     `out_of_scope | wrong`. So the stored data was actively
//     misleading, not merely coarse: anyone counting subset-only
//     proposals was counting invalid-category ones.
//  3. "garbage" turned out to be one specific thing. Pulling the
//     target_ids: `tag:region/…`, `tag:condition/…`,
//     `tag:array-type/…`, `tag:passage/…`, `tag:karyotype/…`,
//     `tag:diagnosis/…`, `tag:pooled-sample/…`, `tag:theiler-stage/…`
//     — NONE of those categories are in
//     `curation_rules.CANONICAL_EETAG_CATEGORIES`. It is not a
//     severity ("badly wrong") but a KIND: not a valid annotation at
//     all. That matters because it implies a different fix on the
//     agents side — constrain the allow-list, not improve grounding.
//
// Chips are named for the fix they imply wherever that was possible.
// Ordered by MEASURED curator use (local-curator rows only — the
// `agent-triage` reviewer writes its own reason keys and those must
// not drive what a human is offered first). Counts as of 2026-08-13;
// the new keys are placed by where their cases were hiding.
//
// Two deliberate exceptions to frequency order, both at the bottom:
// `other` (16) and `borderline` (13) were the two most-used chips
// after `redundant`, and that is the SYMPTOM this revision fixes —
// ranking a dumping ground by its frequency keeps it the path of
// least resistance. They stay available, last.
export const CAL_EXTRA_TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "redundant_with_bm_source", label: "Redundant / already covered", help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "invalid_annotation",     label: "Badly wrong",                help: "not a valid annotation — the category isn't a Gemma EFC (region / condition / passage / karyotype …), or the value belongs to a different category entirely (a chemical under genotype)" },
  { key: "aboutism",               label: "Aboutism",                   help: "a claim about what the study is ABOUT, not a feature of the profiled samples — the tags guideline's \"don't tag claims from the abstract\"" },
  { key: "out_of_scope_correct",   label: "Correct but out of scope",   help: "true of the samples, but not something we curate here — the agent's modelling is fine, the scope rule is what it missed" },
  { key: "no_evidence",            label: "No evidence",                help: "no supporting evidence in the paper/data" },
  { key: "not_sample_applicable",  label: "Subset only",                help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "wrong",                  label: "Wrong",                      help: "well-formed, but not true of these samples — the agent picked an incorrect term or value" },
  { key: "wrong_category",         label: "Right value, wrong category", help: "the value is correct but filed under the wrong EFC — recategorise rather than drop" },
  { key: "out_of_scope_wrong",     label: "Wrong and out of scope",     help: "neither true nor in scope — no credit either way" },
  // Kept last, deliberately. It ran 13 times here and its notes show it was
  // the path of least resistance rather than a verdict — `borderline |
  // covered`, `borderline | close`. With the specific options above it
  // there is somewhere better to land; leaving it in place (rather
  // than removing it outright) keeps the stored rows readable. The
  // wire key `redundant_with_bm_source` (now shown first) stays as-is
  // per the validator contract, though its label is category-neutral:
  // it fires for a BM characteristic, a fully-covering factor value,
  // or any other surface that already captures the proposed term.
  { key: "borderline",             label: "Borderline",                 help: "genuinely a close call — prefer one of the specific reasons above where one fits" },
  { key: "other",                  label: "Other",                      help: "add a note" },
];
// For calibration_factor_extra: subset of the tag-side chips. The
// new `not_sample_applicable` / `redundant_with_bm_source` chips
// don't apply — factor values define their sample groupings
// explicitly, and BM-source redundancy is a tag concept.
// 2026-06-14 vocab expansion per design review. "Already covered", "Wrong
// shape", "FVs wrong" reflect the dominant reasons curators decline
// to add a proposed factor — going beyond "no evidence" / "out of
// scope" which both undershoot the real reasoning. Open-enum on the
// wire means new slugs ship without an agent-side PR.
export const CAL_EXTRA_FACTOR_DISMISS_CHIPS: DialogChip[] = [
  { key: "already_covered", label: "Already covered",  help: "an existing factor / tag / characteristic already captures this" },
  { key: "wrong_shape",     label: "Wrong shape",      help: "the axis is real but the agent's partition / FV breakdown doesn't match the experiment" },
  { key: "fvs_wrong",       label: "FVs need work",        help: "would add but the FV labels need work — want a redo, not as-is" },
  { key: "no_evidence",     label: "No evidence",      help: "no supporting evidence in the paper/data" },
  { key: "out_of_scope",    label: "Out of scope",     help: "outside the scope of this factor category" },
  { key: "borderline",      label: "Borderline",       help: "close call — could reasonably go either way" },
  { key: "other",           label: "Other",            help: "add a note" },
];

// Factor match disagree — "the agent says match, I say not." These
// cards already say "Confirm" / "Not a match" (per the 2026-06-14
// button-label refactor); the chips name the WHY for the not-a-match.
export const FACTOR_MATCH_DISMISS_CHIPS: DialogChip[] = [
  { key: "category_mismatch",  label: "Different category", help: "agent and the gold factor name different things" },
  { key: "partition_mismatch", label: "Different partition", help: "same category, different sample groupings" },
  { key: "synonym_only",       label: "Synonym, not same",  help: "labels are close but not semantically equivalent" },
  // Design review 2026-06-14: the "keep" decision has more than one shape —
  // agent could be flat-out wrong OR agent could be close enough that
  // the disagreement isn't load-bearing. Recording the distinction
  // helps the calibration analytics tell "real curator-vs-agent
  // disagreement" from "we landed somewhere different but it's fine."
  { key: "agent_close_enough", label: "TMTOWTDI", help: "There's More Than One Way To Do It — agent's call was reasonable, but I'm keeping the current curation. Not a real disagreement; signals to calibration analytics that this was a legitimate-either-way call." },
  // 🛑 The four below say the AGENT WINS, on a dialog whose verb is
  // "dismiss". That inversion is not cosmetic: stored rows read
  // `dismissed | keep_agent_close | "cell type is better category,
  // accepted that change."` — the curator adopted the agent's version
  // and anything reading `status` sees a rejection. `keep_agent_*`
  // already existed for exactly this reason; the reason field was
  // carrying a contradiction of the status because the verb pair
  // could not express "which version wins".
  //
  // The right fix is a verb — keep current / take the agent's /
  // equivalent / neither — which is a wire change and is filed with
  // the agents side. Until then the KEY is unambiguous even where the
  // status isn't, and these split the "agent is better" case by the
  // fix it implies, since the observed reasons differ: better
  // category, better grounding, more specific, better shape.
  { key: "keep_agent_better_category", label: "Agent's is better — category", help: "adopting the agent's version: it files this under the right EFC (\"cell type is better category\")" },
  { key: "keep_agent_better_grounding", label: "Agent's is better — grounding", help: "adopting the agent's version: better ontology binding for the same idea" },
  { key: "keep_agent_more_specific",   label: "Agent's is better — more specific", help: "adopting the agent's version: finer-grained and still correct" },
  { key: "keep_agent_equivalent",      label: "Equivalent",         help: "same thing in a different surface form — NOT a disagreement. Distinct from keeping the current one, because for calibration this means the agent was right and was scored as a miss." },
  { key: "neither_correct",            label: "Neither is right",   help: "both the agent's and the current version are wrong — the fix is a third thing" },
  { key: "borderline",         label: "Borderline",         help: "close call" },
  { key: "other",              label: "Other",              help: "add a note" },
];

// Tag match disagree — same "Not a match" framing but with a
// tag-flavoured why. "Different partition" doesn't apply (tags don't
// have FV partitions); the right tag-side analog is "doesn't apply
// to all samples." Design review 2026-06-14: "i thought we agreed on reject
// causes like 'doesn't apply to all samples' — 'different partitions'
// doesn't make sense for tag."
export const TAG_MATCH_DISMISS_CHIPS: DialogChip[] = [
  { key: "category_mismatch",     label: "Different category",      help: "agent and the gold tag name different things" },
  { key: "not_sample_applicable", label: "Doesn't apply to all samples", help: "tag is partial — applies only to a subset of profiled samples" },
  { key: "synonym_only",          label: "Synonym, not same",       help: "labels are close but not semantically equivalent" },
  // Same agent-wins family as the factor set above — see the note
  // there on why these live on a "dismiss" dialog and why that is the
  // thing being fixed rather than the vocabulary.
  { key: "keep_agent_better_category", label: "Agent's is better — category", help: "adopting the agent's version: it files this under the right EFC" },
  { key: "keep_agent_better_grounding", label: "Agent's is better — grounding", help: "adopting the agent's version: better ontology binding for the same idea" },
  { key: "keep_agent_more_specific",   label: "Agent's is better — more specific", help: "adopting the agent's version: finer-grained and still correct" },
  { key: "keep_agent_equivalent",      label: "Equivalent",         help: "same thing in a different surface form — NOT a disagreement, and distinct from keeping the current one: for calibration this means the agent was right and was scored as a miss." },
  { key: "neither_correct",            label: "Neither is right",   help: "both versions are wrong — the fix is a third thing" },
  { key: "borderline",            label: "Borderline",              help: "close call" },
  { key: "other",                 label: "Other",                   help: "add a note" },
];

// Factor partition-mismatch ("Modify FVs") disagree — curator
// thinks the existing partition is correct OR wants a merge instead
// of a structural rewrite.
export const FACTOR_PARTITION_DISMISS_CHIPS: DialogChip[] = [
  { key: "current_partition_correct", label: "Current partition correct", help: "agent's proposed partition is wrong" },
  { key: "merge_instead",             label: "Want merge instead",       help: "adopt the agent's FVs into the existing factor without overwriting structure" },
  { key: "agent_close_enough",        label: "TMTOWTDI",                 help: "There's More Than One Way To Do It — agent's partition is reasonable, but I'm keeping the current one. Not a real disagreement; signals to calibration analytics that this was a legitimate-either-way call." },
  { key: "borderline",                label: "Borderline",               help: "close call" },
  { key: "other",                     label: "Other",                    help: "add a note" },
];
// For calibration_agent_extra: "Accept (add)" means curator agrees
// with agent (agent TP). Chips explain WHY.
// "Accepted with reservation" is the one addition here, and it comes
// straight out of the notes: curators accepted and then wrote the
// caveat in prose because there was nowhere to put it — "PARTIAL
// credit only", "right but borderline", "sort-of a swap … not a full
// error", and three separate "OK — but the best form would be a
// STATEMENT". That last group is a distinct, recurring situation:
// right content, wrong SHAPE. Splitting it out means calibration can
// tell "the agent was right" from "the agent was right enough to keep
// but not right enough to score", which a bare `accepted` cannot.
// `well_evidenced` is 70 of 78 measured accepts — it stays first by a
// wide margin. `accepted_with_reservation` is placed second on an
// estimate rather than a count: its cases exist (4 "correct_improvement",
// 2 "correct_but_statement_better", 1 "partial_credit", plus the prose
// caveats) but were spread across keys and notes, so there is no single
// figure to rank it by.
export const CAL_EXTRA_ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced",  label: "Well evidenced",   help: "strong evidence in the paper or data" },
  { key: "accepted_with_reservation", label: "Accepted with reservation", help: "keeping it, but it isn't the ideal form — partial credit, or it would be better as an S-P-O statement, or a more specific term exists. Say which in the note." },
  { key: "fills_gap",       label: "Fills gap",        help: "adds information absent from current gold" },
  { key: "borderline",      label: "Borderline",       help: "close call — acceptable to add" },
  { key: "other",           label: "Other",            help: "add a note" },
];

// Tag-target dismiss vocab — generic dismissals PLUS the two
// tag-shape-specific chips (`not_sample_applicable` / "Subset only" +
// `redundant_with_bm_source` / "Redundant"). Used for tag-target
// findings that aren't `calibration_agent_extra` (which has its own
// `CAL_EXTRA_TAG_DISMISS_CHIPS` set above). Per design review 2026-06-12: "a
// disposition for a tag like 'Only applies to some samples' would be
// more helpful than 'weak evidence' or 'out of scope'." Server-side
// gate for both chips widened from `{calibration_agent_extra}` to
// any tag-target finding per the agents-side 2026-06-12 schema update; safe to
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
 *  to the generic DISMISS_CHIPS / ACCEPT_CHIPS, which is how Curator A
 *  ended up routing 19/20 v7b factor-gold-miss dismisses through
 *  `weak_evidence` (the closest-feeling chip in the wrong vocab).
 *
 *  Tag-target findings outside ``calibration_agent_extra`` route to
 *  ``TAG_DISMISS_CHIPS`` — the generic vocab plus "Subset only" and
 *  "Redundant" (server-side gate widened 2026-06-12). */
/** Optional context for ``dismissChipsFor``. When ``goldEmpty`` is
 *  true, a ``*_match`` finding's dismiss chips downgrade to the
 *  add-side vocabulary (Subset only / No evidence / Redundant /
 *  Out of scope) so the dialog matches the downgraded card title.
 *  Mirrors ``findingActionLabel({ goldEmpty })`` and
 *  ``findingActionShape({ goldEmpty })`` (2026-06-16). */
export interface DismissChipsContext {
  goldEmpty?: boolean;
}

export function dismissChipsFor(
  finding: Pick<AuditFinding, "issue_code" | "target_kind">,
  ctx?: DismissChipsContext,
): DialogChip[] {
  const issueCode = finding.issue_code;
  const goldEmpty = !!ctx?.goldEmpty;
  // Match-downgrade: when displayed gold is empty, a *_match finding's
  // dismiss vocab follows the add-side path. Tag and factor split
  // mirrors the calibration_agent_extra / calibration_factor_extra
  // branches below.
  if (
    goldEmpty &&
    (issueCode === "calibration_match" ||
      issueCode === "calibration_factor_match_exact" ||
      issueCode === "calibration_factor_match_near" ||
      issueCode === "calibration_factor_match_close" ||
      issueCode === "calibration_factor_match" ||
      issueCode === "factor_proposed_match_with_design" ||
      issueCode === "tag_proposed_match_with_design")
  ) {
    return finding.target_kind === "tag"
      ? CAL_EXTRA_TAG_DISMISS_CHIPS
      : CAL_EXTRA_FACTOR_DISMISS_CHIPS;
  }
  // Remove-factor / remove-tag: curator disagrees with the removal.
  // Split per ``target_kind`` — tags and factors share the issue_code
  // family but have entirely different vocabularies (tags have no
  // FVs / partition / structure). Design review 2026-06-15: "tags don't have
  // factor values or levels or structure GET IT RIGHT".
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss" ||
    // Entity-frame mirror of gold_only_miss — same disagree-with-
    // removal framing.
    issueCode === "factor_design_missing_from_agent" ||
    issueCode === "tag_design_missing_from_agent"
  ) {
    return finding.target_kind === "tag"
      ? CAL_MISS_TAG_DISMISS_CHIPS
      : CAL_MISS_FACTOR_DISMISS_CHIPS;
  }
  // Add-factor / add-tag: curator disagrees with the addition.
  if (
    issueCode === "calibration_agent_extra" ||
    issueCode === "tag_proposed_new" ||
    issueCode === "missing_tag"
  )
    return CAL_EXTRA_TAG_DISMISS_CHIPS;
  if (
    issueCode === "calibration_factor_extra" ||
    issueCode === "augmentation_factor_extra" ||
    issueCode === "factor_proposed_new"
  )
    return CAL_EXTRA_FACTOR_DISMISS_CHIPS;
  // Match disagree — "not a match" path. Factor-match codes get the
  // factor-flavoured set ("Different partition" is meaningful here);
  // tag-match codes get the tag-flavoured set where the partition
  // chip is replaced with "Doesn't apply to all samples."
  if (
    issueCode === "calibration_factor_match_exact" ||
    issueCode === "calibration_factor_match_near" ||
    issueCode === "calibration_factor_match" ||
    issueCode === "factor_proposed_match_with_design"
  )
    return FACTOR_MATCH_DISMISS_CHIPS;
  if (
    issueCode === "calibration_match" ||
    issueCode === "tag_proposed_match_with_design"
  )
    return TAG_MATCH_DISMISS_CHIPS;
  // Partition-mismatch disagree — "don't modify" path.
  if (
    issueCode === "calibration_factor_partition_mismatch" ||
    issueCode === "factor_proposed_match_partition_mismatch" ||
    issueCode === "factor_proposed_match_category_mismatch" ||
    issueCode === "calibration_factor_rename"
  )
    return FACTOR_PARTITION_DISMISS_CHIPS;
  if (finding.target_kind === "tag") return TAG_DISMISS_CHIPS;
  return DISMISS_CHIPS;
}

export function acceptChipsFor(
  issueCode: string,
  targetKind?: AuditFinding["target_kind"],
): DialogChip[] {
  // Factor-side removal gets its own vocabulary — the dismiss side was
  // split by target_kind in 2026-06-15 and the accept side was missed,
  // so agreeing to remove a FACTOR offered reasons about "the current
  // tag". See CAL_MISS_FACTOR_ACCEPT_CHIPS for why a broad
  // `current_wrong` is the wrong shape when the action is this rare.
  if (
    targetKind === "factor" &&
    (issueCode === "calibration_factor_gold_only_miss" ||
      issueCode === "factor_design_missing_from_agent")
  )
    return CAL_MISS_FACTOR_ACCEPT_CHIPS;
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss" ||
    issueCode === "factor_design_missing_from_agent" ||
    issueCode === "tag_design_missing_from_agent"
  )
    return CAL_MISS_ACCEPT_CHIPS;
  if (
    issueCode === "calibration_agent_extra" ||
    issueCode === "calibration_factor_extra" ||
    issueCode === "augmentation_factor_extra" ||
    issueCode === "factor_proposed_new" ||
    issueCode === "tag_proposed_new" ||
    issueCode === "missing_tag"
  )
    return CAL_EXTRA_ACCEPT_CHIPS;
  return ACCEPT_CHIPS;
}

// ---------------------------------------------------------------------------
// Legacy key remap
// ---------------------------------------------------------------------------

/**
 * Old disposition key → the 2026-08-13 key that replaces it.
 *
 * 456 stored dispositions predate the revision. Most just need
 * renaming, but a subset are **wrong rather than coarse** — a curator
 * picked the nearest chip and then contradicted it in the note:
 *
 *     not_sample_applicable | "garbage"
 *     not_sample_applicable | "comletely malformed"
 *     out_of_scope          | "garbage"
 *     out_of_scope          | "wrong"
 *     out_of_scope          | "about"
 *
 * Those cannot be remapped from the key alone — the key says
 * "subset only" and the truth is "invalid annotation". Anything
 * recovering them has to read the NOTE, which is why
 * {@link remapFromNote} exists beside this and why neither is applied
 * automatically. A key-only remap would silently launder the bad rows
 * into confident new keys.
 *
 * Deliberately NOT a rename of `borderline`: it was a dumping ground
 * (19 uses, notes like "covered" and "close"), so its stored rows mean
 * different things and only the note can separate them.
 */
export const LEGACY_DISPOSITION_KEY_REMAP: Record<string, string> = {
  // Split for no reason a curator could see — same idea, two keys.
  already_covered: "redundant_with_bm_source",
  // Factor/tag split of one concept.
  agent_real_miss: "agent_missed_it",
  // `out_of_scope` never distinguished whether the claim was true.
  // Mapped to the correct-but-out-of-scope side because that is what
  // its help text described; rows whose note says otherwise are
  // caught by `remapFromNote`.
  out_of_scope: "out_of_scope_correct",
  malformed: "invalid_annotation",
};

/**
 * Recover the true reason from a note where the stored key is known
 * to be unreliable. Returns `null` when the note says nothing useful —
 * an honest "still ambiguous" rather than a guess.
 *
 * Only consulted for rows whose key is one of the overloaded ones;
 * a curator who picked a specific chip meant it.
 */
export function remapFromNote(note: string | null | undefined): string | null {
  const n = (note ?? "").trim().toLowerCase();
  if (!n) return null;
  // "garbage" x9 plus two typos, and "malformed" x3 — all turned out
  // to be invented categories rather than merely wrong values.
  if (/garba|garbate|malformed/.test(n)) return "invalid_annotation";
  if (n === "about" || /don'?t curate ['"]?about/.test(n)) return "aboutism";
  if (/\bcategor/.test(n)) return "wrong_category";
  return null;
}

/** Keys whose stored rows are known to be unreliable — see the remap
 *  notes above. Consult {@link remapFromNote} for these before
 *  trusting the key in any analysis. */
export const OVERLOADED_LEGACY_KEYS: ReadonlySet<string> = new Set([
  "other",
  "out_of_scope",
  "not_sample_applicable",
  "borderline",
]);
