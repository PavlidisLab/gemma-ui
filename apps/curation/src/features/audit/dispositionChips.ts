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
  { key: "weak_evidence",      added: "2026-06-11T03:09:04Z", label: "Weak evidence",      help: "agent's evidence doesn't support the finding" },
  { key: "redundant",          added: "2026-06-11T03:09:04Z", label: "Redundant",          help: "finding duplicates an issue already noted elsewhere" },
  { key: "out_of_scope",       added: "2026-06-11T03:09:04Z", label: "Out of scope",       help: "valid finding but outside this curation pass" },
  { key: "accepted_elsewhere", added: "2026-06-11T03:09:04Z", label: "Accepted elsewhere", help: "the change was already made via a different finding" },
  { key: "wont_fix",           added: "2026-06-11T03:09:04Z", label: "Won't fix",          help: "acknowledged but intentionally not acted on" },
  { key: "other",              added: "2026-06-11T03:09:04Z", label: "Other",              help: "doesn't fit the above — add a note" },
];

export const ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced", added: "2026-06-11T03:09:04Z", label: "Well evidenced", help: "strong evidence in the paper or data" },
  { key: "fills_gap",      added: "2026-06-11T03:09:04Z", label: "Fills gap",      help: "adds information absent from current curation" },
  { key: "more_specific",  added: "2026-06-11T03:09:04Z", label: "More specific",  help: "more precise than the existing entry" },
  { key: "other",          added: "2026-06-11T03:09:04Z", label: "Other",          help: "doesn't fit the above — add a note" },
];

export const NOT_SURE_CHIPS: DialogChip[] = [
  { key: "need_more_data", added: "2026-06-11T03:09:04Z", label: "Need more data", help: "not enough information to decide" },
  { key: "need_expert",    added: "2026-06-11T03:09:04Z", label: "Need expert",    help: "requires domain expertise to evaluate" },
  { key: "pending_update", added: "2026-06-11T03:09:04Z", label: "Pending update", help: "waiting on an upstream change before acting" },
  { key: "other",          added: "2026-06-11T03:09:04Z", label: "Other",          help: "doesn't fit the above — add a note" },
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
// `agent_real_miss` leads both this set and the tag one below: it's
// the largest single chip-gap by case-count across curators (~50
// cases pre-landing) and the server gate accepts it for either
// target_kind.
/**
 * FACTOR-side removal dismiss — the curator says "don't remove this
 * factor". Every chip therefore ends in the factor staying; what they
 * distinguish is whether anything about it still needs fixing.
 *
 * 2026-08-17 rewrite. All 19 human dispositions on this code family
 * went to `agent_real_miss`; the other four chips had never been
 * picked once, and two of them read against the decision the dialog
 * had just made:
 *
 *  - "Wrong partition" here meant KEEP the factor (fix its sample
 *    assignment), while `partition_wrong` / "Partition wrong" on the
 *    ACCEPT side below means REMOVE it. Same two words, opposite
 *    outcome, one dialog apart.
 *  - "Factor needed" never said needed for what, and its help
 *    ("agent should have proposed it") scored the agent on a card
 *    whose question is only whether the factor stays.
 *
 * So the labels now lead with the outcome — keep — and name the fix
 * after it.
 *
 * 🛑 **The zero-use counts above are not evidence and must not be
 * reused as such** (cab, 2026-08-17). All 19 rows are
 * `deriveDismissReason`'s default with no note attached, which is the
 * signature of a dialog that was never opened, not of chips that were
 * offered and refused. The control: on `calibration_gold_only_miss`
 * ACCEPTS, where curators demonstrably do reach the dialog, the
 * derived default `gold_was_wrong` has zero uses while 58 rows spread
 * across five chips with 21 notes. Reached ⇒ spread; bypassed ⇒ 100%
 * default, no notes. `DERIVED_REASON_NOTE` now marks the derived rows
 * so this stops being unreadable.
 *
 * What survives that correction, on non-count grounds:
 *  - The relabel — "Wrong partition" meaning keep here while
 *    "Partition wrong" one dialog over means remove was backwards
 *    whatever the counts.
 *  - Dropping "Missed evidence", now argued from the TAG dialog
 *    instead — the one remove-dismiss dialog that was genuinely used.
 *    There, 7 curators answered "it's right, and here's where it says
 *    so" as top-chip + evidence note against 1 who took the chip.
 *  - NOT dropping "Borderline", which this set had removed for being a
 *    dumping ground. Same tag evidence says otherwise: 4 real uses
 *    with substantive notes, all of them one specific doubt. Restored
 *    with the tag set's label. Deleting a chip on the strength of an
 *    unopened dialog was the actual error here.
 */
export const CAL_MISS_FACTOR_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_real_miss",             added: "2026-06-16T16:09:06Z", label: "Factor is correct — keep it",                help: "the factor and its FVs are right as they stand; nothing needs fixing, the agent simply didn't propose it" },
  { key: "structure_correct_fvs_wrong", added: "2026-06-16T16:09:06Z", label: "Keep it, but the FV labels need work",       help: "the factor's category is right — the FV labels / values are what need fixing" },
  { key: "wrong_partition",             added: "2026-06-16T16:09:06Z", label: "Keep it, but the samples are grouped wrong", help: "the factor's category is right — which samples sit in which FV is what needs fixing" },
  { key: "borderline",                  added: "2026-06-16T16:09:06Z", label: "Keep it, but I'm not certain",               help: "keeping it on balance — the evidence doesn't quite settle the call. Say what's unresolved in the note." },
  { key: "other",                       added: "2026-06-16T16:09:06Z", label: "Other",                                      help: "add a note" },
];

/**
 * TAG-side removal dismiss — curator says "don't remove the tag".
 * Tags have NO factor values, NO partition, NO structure, so the
 * factor set's fix-chips don't apply. Per design review 2026-06-15:
 * "tags don't have factor values or levels or structure GET IT
 * RIGHT" and earlier: "When prompted to _remove_ a tag, the _reject_
 * would be by ('keep') 'Agent missed it' pretty much."
 *
 * 2026-08-17: same outcome-first relabel as the factor set above, but
 * NOT the same pruning — the stored rows say the tag vocabulary is
 * being used, and used differently:
 *
 *  - `borderline` is alive here (4 uses vs 0 on the factor side) and
 *    its notes are all one specific thing — uncertainty about whether
 *    the tag really covers every sample ("not completely clear this
 *    covers all these mice"). That is the inverse of
 *    `tag_applies_broadly`, so it earns its place; the label now says
 *    what it meant instead of grading the call.
 *  - `missed_evidence` goes, for the factor set's reason plus a
 *    sharper one: 7 curators answered "the tag is right, and here is
 *    where it says so" as `agent_missed_it` + an evidence note ("GEO
 *    record says E15-16", "methods section says male PMC6826131")
 *    against 1 who reached for the chip. The note channel already
 *    carries the citation; a chip that only re-labels it splits the
 *    same answer two ways. Key stays valid on the wire and the one
 *    stored row still displays.
 *  - `wont_fix` shows up on 6 stored rows but is NOT missing from
 *    this list — it is written by the close-review sweep
 *    (`AuditSidebarPanel.tsx`, IMPLICIT_REJECT_NOTE), never picked by
 *    a curator. Don't "restore" it here.
 */
export const CAL_MISS_TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_missed_it",     added: "2026-06-16T16:09:06Z", label: "Tag is correct — keep it",            help: "the tag is right and applies as it stands; the agent simply proposed dropping it" },
  { key: "tag_applies_broadly", added: "2026-06-16T16:09:06Z", label: "Keep it — it covers all the samples", help: "the tag holds for every profiled sample — answers a 'subset only' rationale for removing it" },
  { key: "borderline",          added: "2026-06-16T16:09:06Z", label: "Keep it, but I'm not certain",        help: "keeping it on balance — the evidence doesn't quite settle whether it covers every sample. Say what's unresolved in the note." },
  { key: "other",               added: "2026-06-16T16:09:06Z", label: "Other",                               help: "add a note" },
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
// `aboutism` added 2026-08-17 (cab). The 08-13 revision put that chip on
// `CAL_EXTRA_TAG_DISMISS_CHIPS` only — but 10 of the 12 "about" notes in
// the store are on THIS dialog: a curator agreeing to remove a curated
// tag *because* it's a claim about what the study is about rather than a
// feature of the samples. With nowhere to land they split three ways
// (`current_wrong` 6, `other` 3, `current_redundant` 1), so the single
// most recognisable removal rationale in the corpus was being recorded
// as three different judgements. Same shape as the split this file
// already carries a note about: a fix landed on the dismiss side in
// 2026-06-15 and the accept side was missed.
export const CAL_MISS_ACCEPT_CHIPS: DialogChip[] = [
  { key: "current_wrong",           added: "2026-06-16T16:04:09Z", label: "Current wrong",           help: "the current tag is incorrect or outdated — agent's removal is right" },
  { key: "current_redundant",       added: "2026-06-16T16:04:09Z", label: "Current redundant",       help: "the current tag is already captured elsewhere — by a biomaterial characteristic, a factor value, or another tag" },
  { key: "aboutism",                added: "2026-08-17T20:04:16Z", label: "Aboutism",                help: "a claim about what the study is ABOUT, not a feature of the profiled samples — the tags guideline's \"don't tag claims from the abstract\". Removing it is right." },
  { key: "more_specific_available", added: "2026-06-16T16:04:09Z", label: "More specific available", help: "agent's removal is right because a finer-grained tag better captures this (often paired with an add proposal elsewhere)" },
  { key: "borderline",              added: "2026-06-11T03:09:04Z", label: "Borderline",              help: "close call — acceptable to remove" },
  { key: "other",                   added: "2026-06-11T03:09:04Z", label: "Other",                   help: "add a note" },
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
  { key: "swapped_for_other_proposal", added: "2026-08-13T20:46:39Z", label: "Swapping with another proposal", help: "the same axis is being added by a different proposal — this removal is bookkeeping, not a judgement that the factor was wrong. NOT evidence the curated factor was incorrect." },
  { key: "partition_wrong",            added: "2026-08-13T20:46:39Z", label: "Partition wrong",                help: "the factor's sample groupings are wrong — the axis may be real but this partition of the samples isn't" },
  { key: "current_redundant",          added: "2026-08-13T20:46:39Z", label: "Already covered",                help: "another factor / tag / characteristic already captures this axis" },
  { key: "more_specific_available",    added: "2026-08-13T20:46:39Z", label: "More specific available",        help: "a finer-grained factor better captures this (usually paired with an add proposal elsewhere)" },
  { key: "not_a_real_axis",            added: "2026-08-13T20:46:39Z", label: "Not a real axis",                help: "the factor doesn't describe an experimental variable at all — the genuinely-remove-it case, and the rare one" },
  { key: "borderline",                 added: "2026-08-13T20:46:39Z", label: "Borderline",                     help: "close call — acceptable to remove" },
  { key: "other",                      added: "2026-08-13T20:46:39Z", label: "Other",                          help: "add a note" },
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
  { key: "redundant_with_bm_source", added: "2026-06-11T03:09:04Z", label: "Redundant / already covered", help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "invalid_annotation",       added: "2026-08-13T20:46:39Z", label: "Badly wrong",                 help: "not a valid annotation — the category isn't a Gemma EFC (region / condition / passage / karyotype …), or the value belongs to a different category entirely (a chemical under genotype)" },
  { key: "aboutism",                 added: "2026-08-13T20:46:39Z", label: "Aboutism",                    help: "a claim about what the study is ABOUT, not a feature of the profiled samples — the tags guideline's \"don't tag claims from the abstract\"" },
  { key: "out_of_scope_correct",     added: "2026-08-13T20:46:39Z", label: "Correct but out of scope",    help: "true of the samples, but not something we curate here — the agent's modelling is fine, the scope rule is what it missed" },
  { key: "no_evidence",              added: "2026-06-11T03:09:04Z", label: "No evidence",                 help: "no supporting evidence in the paper/data" },
  { key: "not_sample_applicable",    added: "2026-06-11T03:09:04Z", label: "Subset only",                 help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "wrong",                    added: "2026-08-13T20:46:39Z", label: "Wrong",                       help: "well-formed, but not true of these samples — the agent picked an incorrect term or value" },
  { key: "wrong_category",           added: "2026-08-13T20:46:39Z", label: "Right value, wrong category", help: "the value is correct but filed under the wrong EFC — recategorise rather than drop" },
  { key: "out_of_scope_wrong",       added: "2026-08-13T20:46:39Z", label: "Wrong and out of scope",      help: "neither true nor in scope — no credit either way" },
  // Kept last, deliberately. It ran 13 times here and its notes show it was
  // the path of least resistance rather than a verdict — `borderline |
  // covered`, `borderline | close`. With the specific options above it
  // there is somewhere better to land; leaving it in place (rather
  // than removing it outright) keeps the stored rows readable. The
  // wire key `redundant_with_bm_source` (now shown first) stays as-is
  // per the validator contract, though its label is category-neutral:
  // it fires for a BM characteristic, a fully-covering factor value,
  // or any other surface that already captures the proposed term.
  { key: "borderline",               added: "2026-06-11T03:09:04Z", label: "Borderline",                  help: "genuinely a close call — prefer one of the specific reasons above where one fits" },
  { key: "other",                    added: "2026-06-11T03:09:04Z", label: "Other",                       help: "add a note" },
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
  { key: "already_covered", added: "2026-06-14T19:13:59Z", label: "Already covered", help: "an existing factor / tag / characteristic already captures this" },
  { key: "wrong_shape",     added: "2026-06-14T19:13:59Z", label: "Wrong shape",     help: "the axis is real but the agent's partition / FV breakdown doesn't match the experiment" },
  { key: "fvs_wrong",       added: "2026-06-14T19:13:59Z", label: "FVs need work",   help: "would add but the FV labels need work — want a redo, not as-is" },
  { key: "no_evidence",     added: "2026-06-11T03:09:04Z", label: "No evidence",     help: "no supporting evidence in the paper/data" },
  { key: "out_of_scope",    added: "2026-06-11T03:09:04Z", label: "Out of scope",    help: "outside the scope of this factor category" },
  { key: "borderline",      added: "2026-06-11T03:09:04Z", label: "Borderline",      help: "close call — could reasonably go either way" },
  { key: "other",           added: "2026-06-11T03:09:04Z", label: "Other",           help: "add a note" },
];

// Factor match disagree — "the agent says match, I say not." These
// cards already say "Confirm" / "Not a match" (per the 2026-06-14
// button-label refactor); the chips name the WHY for the not-a-match.
export const FACTOR_MATCH_DISMISS_CHIPS: DialogChip[] = [
  { key: "category_mismatch",           added: "2026-06-14T19:13:59Z", label: "Different category",                help: "agent and the gold factor name different things" },
  { key: "partition_mismatch",          added: "2026-06-14T19:13:59Z", label: "Different partition",               help: "same category, different sample groupings" },
  { key: "synonym_only",                added: "2026-06-14T19:13:59Z", label: "Synonym, not same",                 help: "labels are close but not semantically equivalent" },
  // Design review 2026-06-14: the "keep" decision has more than one shape —
  // agent could be flat-out wrong OR agent could be close enough that
  // the disagreement isn't load-bearing. Recording the distinction
  // helps the calibration analytics tell "real curator-vs-agent
  // disagreement" from "we landed somewhere different but it's fine."
  { key: "agent_close_enough",          added: "2026-06-14T23:14:29Z", label: "TMTOWTDI",                          help: "There's More Than One Way To Do It — agent's call was reasonable, but I'm keeping the current curation. Not a real disagreement; signals to calibration analytics that this was a legitimate-either-way call." },
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
  { key: "keep_agent_better_category",  added: "2026-08-13T20:46:39Z", label: "Agent's is better — category",      help: "adopting the agent's version: it files this under the right EFC (\"cell type is better category\")" },
  { key: "keep_agent_better_grounding", added: "2026-08-13T20:46:39Z", label: "Agent's is better — grounding",     help: "adopting the agent's version: better ontology binding for the same idea" },
  { key: "keep_agent_more_specific",    added: "2026-08-13T20:46:39Z", label: "Agent's is better — more specific", help: "adopting the agent's version: finer-grained and still correct" },
  { key: "keep_agent_equivalent",       added: "2026-08-13T20:46:39Z", label: "Equivalent",                        help: "same thing in a different surface form — NOT a disagreement. Distinct from keeping the current one, because for calibration this means the agent was right and was scored as a miss." },
  { key: "neither_correct",             added: "2026-08-13T20:46:39Z", label: "Neither is right",                  help: "both the agent's and the current version are wrong — the fix is a third thing" },
  { key: "borderline",                  added: "2026-06-14T19:13:59Z", label: "Borderline",                        help: "close call" },
  { key: "other",                       added: "2026-06-14T19:13:59Z", label: "Other",                             help: "add a note" },
];

// Tag match disagree — same "Not a match" framing but with a
// tag-flavoured why. "Different partition" doesn't apply (tags don't
// have FV partitions); the right tag-side analog is "doesn't apply
// to all samples." Design review 2026-06-14: "i thought we agreed on reject
// causes like 'doesn't apply to all samples' — 'different partitions'
// doesn't make sense for tag."
export const TAG_MATCH_DISMISS_CHIPS: DialogChip[] = [
  { key: "category_mismatch",           added: "2026-06-14T23:07:40Z", label: "Different category",                help: "agent and the gold tag name different things" },
  { key: "not_sample_applicable",       added: "2026-06-14T23:07:40Z", label: "Doesn't apply to all samples",      help: "tag is partial — applies only to a subset of profiled samples" },
  { key: "synonym_only",                added: "2026-06-14T23:07:40Z", label: "Synonym, not same",                 help: "labels are close but not semantically equivalent" },
  // Same agent-wins family as the factor set above — see the note
  // there on why these live on a "dismiss" dialog and why that is the
  // thing being fixed rather than the vocabulary.
  { key: "keep_agent_better_category",  added: "2026-08-13T20:46:39Z", label: "Agent's is better — category",      help: "adopting the agent's version: it files this under the right EFC" },
  { key: "keep_agent_better_grounding", added: "2026-08-13T20:46:39Z", label: "Agent's is better — grounding",     help: "adopting the agent's version: better ontology binding for the same idea" },
  { key: "keep_agent_more_specific",    added: "2026-08-13T20:46:39Z", label: "Agent's is better — more specific", help: "adopting the agent's version: finer-grained and still correct" },
  { key: "keep_agent_equivalent",       added: "2026-08-13T20:46:39Z", label: "Equivalent",                        help: "same thing in a different surface form — NOT a disagreement, and distinct from keeping the current one: for calibration this means the agent was right and was scored as a miss." },
  { key: "neither_correct",             added: "2026-08-13T20:46:39Z", label: "Neither is right",                  help: "both versions are wrong — the fix is a third thing" },
  { key: "borderline",                  added: "2026-06-14T23:07:40Z", label: "Borderline",                        help: "close call" },
  { key: "other",                       added: "2026-06-14T23:07:40Z", label: "Other",                             help: "add a note" },
];

// Factor partition-mismatch ("Modify FVs") disagree — curator
// thinks the existing partition is correct OR wants a merge instead
// of a structural rewrite.
export const FACTOR_PARTITION_DISMISS_CHIPS: DialogChip[] = [
  { key: "current_partition_correct", added: "2026-06-14T19:13:59Z", label: "Current partition correct", help: "agent's proposed partition is wrong" },
  { key: "merge_instead",             added: "2026-06-14T19:13:59Z", label: "Want merge instead",        help: "adopt the agent's FVs into the existing factor without overwriting structure" },
  { key: "agent_close_enough",        added: "2026-06-14T23:14:29Z", label: "TMTOWTDI",                  help: "There's More Than One Way To Do It — agent's partition is reasonable, but I'm keeping the current one. Not a real disagreement; signals to calibration analytics that this was a legitimate-either-way call." },
  { key: "borderline",                added: "2026-06-14T19:13:59Z", label: "Borderline",                help: "close call" },
  { key: "other",                     added: "2026-06-14T19:13:59Z", label: "Other",                     help: "add a note" },
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
  { key: "well_evidenced",            added: "2026-06-11T03:09:04Z", label: "Well evidenced",            help: "strong evidence in the paper or data" },
  { key: "accepted_with_reservation", added: "2026-08-13T20:46:39Z", label: "Accepted with reservation", help: "keeping it, but it isn't the ideal form — partial credit, or it would be better as an S-P-O statement, or a more specific term exists. Say which in the note." },
  { key: "fills_gap",                 added: "2026-06-11T03:09:04Z", label: "Fills gap",                 help: "adds information absent from current gold" },
  { key: "borderline",                added: "2026-06-11T03:09:04Z", label: "Borderline",                help: "close call — acceptable to add" },
  { key: "other",                     added: "2026-06-11T03:09:04Z", label: "Other",                     help: "add a note" },
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
  { key: "not_sample_applicable",    added: "2026-06-13T20:46:38Z", label: "Subset only",        help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "redundant_with_bm_source", added: "2026-06-13T20:46:38Z", label: "Redundant",          help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "weak_evidence",            added: "2026-06-13T20:46:38Z", label: "Weak evidence",      help: "agent's evidence doesn't support the finding" },
  { key: "redundant",                added: "2026-06-13T20:46:38Z", label: "Redundant (other)",  help: "finding duplicates an issue already noted elsewhere" },
  { key: "out_of_scope",             added: "2026-06-13T20:46:38Z", label: "Out of scope",       help: "valid finding but outside this curation pass" },
  { key: "accepted_elsewhere",       added: "2026-06-13T20:46:38Z", label: "Accepted elsewhere", help: "the change was already made via a different finding" },
  { key: "wont_fix",                 added: "2026-06-13T20:46:38Z", label: "Won't fix",          help: "acknowledged but intentionally not acted on" },
  { key: "other",                    added: "2026-06-13T20:46:38Z", label: "Other",              help: "doesn't fit the above — add a note" },
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
// Legacy key remap — MOVED to the agents repo, 2026-08-17
// ---------------------------------------------------------------------------

// `LEGACY_DISPOSITION_KEY_REMAP`, `remapFromNote` and
// `OVERLOADED_LEGACY_KEYS` used to live here. They are gone, not
// forgotten: they now live at
// `gemma-curation-agents/gemma_curation_agents/agents/audit/disposition_reasons.py`
// with every case from this file's tests ported.
//
// They moved because they were never UI code. Nothing here rendered
// them or called them — they had zero runtime consumers, only their
// own unit tests — and the only real consumer is the agents-side
// chip-usage report. They were sitting in TypeScript because that is
// where the 2026-08-13 revision happened to be written.
//
// 🛑 Do NOT re-add a copy here. Two definitions of "how to read a
// stored disposition row honestly" is exactly the drift this file's
// history is a record of. If the UI ever genuinely needs to interpret
// legacy reason keys at runtime, generate from the Python rather than
// re-authoring — and note that the derive table there is DATED
// (`as_of`), because the rule for what a bypass writes changed on
// 2026-08-17 and applying today's rule to older rows misreads picks
// as defaults.
//
// The chip VOCABULARY stays here; that ownership is deliberate
// (2026-06-14). Only the historical-interpretation helpers left.
