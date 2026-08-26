/**
 * Action-aware button labels for finding cards.
 *
 * Companion to `defenderLean.ts` / `leanButtonKinds`. Those modules
 * pick which of the (keep, accept) buttons reads as PRIMARY
 * (highlighted) vs SECONDARY based on the defender's lean. This
 * module picks the TEXT on those same two buttons based on the
 * SHAPE of the action the finding proposes.
 *
 * Canonical screenshot (design review 2026-05-21): an "Add tag — disease
 * model: Alzheimer disease MONDO:0004975" finding still rendered
 * the legacy `keep current` / `adopt Auditor's` pair. But for an
 * ADD action there IS no "current" value — the curator is choosing
 * whether to add or not add. The label should be `don't add`.
 * Similarly:
 *
 *   | action shape | keep button   | accept button |
 *   |--------------|---------------|---------------|
 *   | add          | "don't add"   | "add"         |
 *   | remove       | "don't remove"| "remove"      |
 *   | change       | "don't change"| "adopt"       |
 *   | match        | "disagree"    | "confirm"     |
 *
 * Principle: the button text describes THE ACTION THE CURATOR TAKES
 * by clicking it, not the generic verb ("keep / accept"). The
 * highlighted-side mapping from `leanButtonKinds` is unaffected;
 * only the text changes here.
 *
 * Action shape is derived from `finding.issue_code` (and
 * `finding.apply_action.kind` when present, for future-proofing
 * against issue-code-without-apply-action shapes). The mapping:
 *
 *   calibration_factor_extra            → add     (add a NEW factor)
 *   calibration_agent_extra             → add     (add a NEW tag)
 *   calibration_factor_gold_only_miss   → remove  (drop an existing factor)
 *   calibration_gold_only_miss          → remove  (drop an existing tag)
 *   calibration_factor_match_near       → change  (edit existing FV details)
 *   calibration_factor_match_close      → change  (older alias for near)
 *   calibration_factor_partition_mismatch → change (reorganize FVs)
 *   calibration_factor_rename           → change  (rename existing factor)
 *   calibration_factor_match_exact      → match
 *   calibration_match                   → match   (tag exact match)
 *   anything else                       → change  (safe default — a
 *                                                  generic disagreement
 *                                                  is a change-or-keep
 *                                                  decision)
 *
 * The default deliberately lands on "change" so unknown issue codes
 * don't render an action-mismatched label; "don't change" reads
 * cleanly even for ambiguous shapes.
 */

import type { AuditFinding } from "@/api/auditTypes";

export type ActionShape = "add" | "remove" | "change" | "match" | "decide";

/**
 * The agent's reason for having no executable remedy, when it gave one.
 *
 * 🛑 **Keyed on SHAPE, not on the kind's name.** The fallback verb was
 * called `needs_curator_decision` and is being renamed (Paul,
 * 2026-08-25: *"needs_curator_decision is meaningless … something like
 * `action_needed_but_not_categorized` for cases that aren't
 * expressible"*). Matching the string would break on the rename and
 * again on the next one. Matching "carries a blocked reason" does not.
 *
 * Measured over the 268 apply_actions in the store 2026-08-25: the
 * field is present on 33 of 33 fallback actions and on 0 of the other
 * 235. It is the discriminator whether or not it was designed as one.
 *
 * Read off the payload structurally because the TS union discriminates
 * on `kind`, and adding a member for a kind whose name is in motion
 * would pin exactly what must stay loose.
 */
export function blockedReasonOf(finding: AuditFinding): string | null {
  const aa = finding.apply_action as
    | { blocked_reason?: unknown }
    | null
    | undefined;
  const raw = aa?.blocked_reason;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Optional context for ``findingActionShape``. When ``goldEmpty``
 *  is true, a ``*_match`` finding's shape downgrades from ``"match"``
 *  to ``"add"`` — the curator's display baseline (polished_gold /
 *  preboard / etc.) doesn't carry the entity even though the
 *  audit-time baseline (often live Gemma) did, so the curator's
 *  action is genuinely "add this", not "confirm this match". Mirrors
 *  ``findingActionLabel({ goldEmpty })`` (ed4f25f, 2026-06-16) — this
 *  is the action-row half of that same downgrade-on-empty-gold fix. */
export interface FindingActionShapeContext {
  goldEmpty?: boolean;
}

/** Map a finding to one of four action shapes. Drives the button-
 *  label text on the finding card (keep vs accept). */
export function findingActionShape(
  finding: AuditFinding,
  ctx?: FindingActionShapeContext,
): ActionShape {
  // An action that says outright it has no remedy is a decision, and
  // that beats anything the issue code implies — including the
  // goldEmpty downgrade below, which would otherwise turn it into an
  // "add" whose Add button cannot add. This is the case that rendered
  // "adopt Auditor's" on a finding where every auditor field is null.
  if (blockedReasonOf(finding)) return "decide";
  const goldEmpty = !!ctx?.goldEmpty;
  const code = finding.issue_code;
  // Match-downgrade: when the displayed gold baseline doesn't carry
  // the entity (goldEmpty), every match-shaped code reads as an Add.
  // Title already downgrades via ``findingActionLabel({ goldEmpty })``;
  // the action row, dismiss vocab, and apply path must follow so
  // Agree actually adds the entity to the draft.
  if (goldEmpty) {
    if (
      code === "calibration_match" ||
      code === "calibration_factor_match_exact" ||
      code === "calibration_factor_match_near" ||
      code === "calibration_factor_match_close" ||
      code === "calibration_factor_match" ||
      code === "factor_proposed_match_with_design" ||
      code === "tag_proposed_match_with_design"
    ) {
      return "add";
    }
  }
  if (code === "calibration_factor_extra") return "add";
  if (code === "calibration_agent_extra") return "add";
  if (code === "calibration_factor_gold_only_miss") return "remove";
  if (code === "calibration_gold_only_miss") return "remove";
  if (code === "calibration_factor_match_near") return "change";
  if (code === "calibration_factor_match_close") return "change";
  if (code === "calibration_factor_partition_mismatch") return "change";
  if (code === "calibration_factor_rename") return "change";
  if (code === "calibration_factor_match_exact") return "match";
  if (code === "calibration_match") return "match";
  // Tag-side match codes. These were never listed, so they fell to
  // the "change" default and rendered "don't change" / "adopt
  // Auditor's" on a card whose whole content is "both sides already
  // agree" — reported 2026-08-09 on GSE198756's `developmental stage:
  // embryo stage`. A match gets ONE "Confirm all"; Reject and Park
  // stay available as escape hatches (design review 2026-06-11:
  // "reject should be an option, even if the proposal is 'close'").
  //
  // ``_near`` genuinely is a change (the agent proposes a different
  // term for the same slot) and was landing on the right default by
  // accident. Listed explicitly so it stays right on purpose.
  if (code === "calibration_tag_match_exact") return "match";
  if (code === "calibration_tag_match_near") return "change";
  // Legacy `calibration_factor_match` at ok severity is a match;
  // at minor it's an actionable near-match (change). Keep symmetric
  // with `factorMatchVariant` in factorMatch.ts.
  if (code === "calibration_factor_match") {
    return finding.severity === "ok" ? "match" : "change";
  }
  // Entity-frame proposer (agents-repo commit 923b663). Mirrors the
  // calibration_* shapes but framed as "agent proposes X against the
  // existing design" rather than "calibration delta vs gold":
  //   *_proposed_new           → add    (agent proposes a new element)
  //   *_proposed_match_*       → match  (agent's proposal matches design)
  //   *_partition_mismatch     → change (matched category, levels diverge)
  //   *_design_missing_from_agent → match (recall gap; curator confirms
  //                              the design's call is correct — "remove"
  //                              would read as "drop it from the design",
  //                              the opposite of what the curator does)
  //   characteristic_proposed_replacement → change (cleaner value
  //                              supersedes one raw BM column)
  //   characteristic_proposed_merge       → change (consolidates
  //                              multiple raw BM columns into one)
  if (code === "factor_proposed_new") return "add";
  if (code === "factor_proposed_match_with_design") return "match";
  if (code === "factor_proposed_match_partition_mismatch") return "change";
  // Same factor (by sample partition) with disagreeing category:
  // accept = keep the existing curation's category; reject = switch
  // to the agent's. "change" reads better than "match" because
  // there's a real either/or rather than a confirmation.
  if (code === "factor_proposed_match_category_mismatch") return "change";
  if (code === "factor_design_missing_from_agent") return "match";
  if (code === "tag_proposed_new") return "add";
  if (code === "tag_proposed_match_with_design") return "match";
  if (code === "tag_design_missing_from_agent") return "match";
  if (code === "characteristic_proposed_replacement") return "change";
  if (code === "characteristic_proposed_merge") return "change";
  // Boss-dropped findings (post-boss pack provenance): the agent
  // proposed the entity, the boss said drop. The finding surfaces
  // the drop so the curator can confirm or override.
  //   "adopt" -> confirm the boss's drop (entity stays out)
  //   "keep"  -> override; agent's original proposal stands
  // The "remove" chip pair ("remove" / "don't remove") fits cleanly.
  if (code === "factor_dropped_by_boss") return "remove";
  if (code === "tag_dropped_by_boss") return "remove";
  if (code === "characteristic_dropped_by_boss") return "remove";
  return "change";
}

/** Button-text pair for a given action shape. Both fields are
 *  always populated even for `match` (`adopt` is unused there but
 *  callers that read both fields stay simple). */
export function actionLabels(shape: ActionShape): {
  keep: string;
  adopt: string;
} {
  if (shape === "add") return { keep: "don't add", adopt: "add" };
  if (shape === "remove") return { keep: "don't remove", adopt: "remove" };
  // The keep side of a match is a DISAGREEMENT — it opens the reason
  // picker, because taking "current" over a claimed match means the
  // curator rejects the match assessment. It used to read "confirm"
  // too, which put two identically-labelled buttons on any row that
  // didn't collapse the pair, and clicking one opened a dialog titled
  // "Disagree" (reported 2026-08-09). Rows that DO collapse render the
  // single ``adopt`` verb and never show this.
  if (shape === "match") return { keep: "disagree", adopt: "confirm" };
  // Both sides are TERMINAL, and that is the point. Neither mutates —
  // the resolver returns `mutates: false` for this shape — so each
  // records a ruling and leaves the draft alone.
  //
  // 🛑 The adopt side said "needs action" and that was a lie about
  // where the click went. It maps to `accepted`, so a curator saying
  // "someone must still do something" had the finding stamped HANDLED
  // — the opposite of what they meant, and it then stopped looking
  // unanswered. "I've addressed this" makes `accepted` true: the
  // curator did the work (in the design editor, in Gemma, wherever)
  // and is recording that, not requesting it. Paul, 2026-08-26.
  //
  // What is still missing is the genuinely non-terminal answer —
  // "someone must do this and it is not done". That is what `Park`
  // exists for, and it is dormant behind `SHOW_PARK_AFFORDANCE`
  // pending exactly this flow (auditPresentation.ts, hidden
  // 2026-06-14). Do NOT fake it by routing an adopt to
  // `needs_more_info`; the pile it belongs in already has a queue
  // filter ("Needs info", `workflow/dispositionFilter.ts`) waiting for
  // a button that sets it.
  if (shape === "decide") {
    return { keep: "no action needed", adopt: "I've addressed this" };
  }
  // change (default)
  return { keep: "don't change", adopt: "adopt" };
}

/** Full accept-button text including a possessive suffix when it
 *  reads naturally. The legacy pattern was
 *  ``${actionLbls.adopt} ${identities.proposer}'s`` everywhere,
 *  but for a REMOVE action that renders as ``remove Auditor's`` —
 *  a hanging possessive with nothing for it to modify (the curator
 *  isn't removing something OF the auditor's; they're removing the
 *  existing tag that the auditor proposed should go).
 *
 *  Rule (design review 2026-06-08):
 *    add / change → "<verb> <Proposer>'s"  (adopt Auditor's, add Auditor's)
 *    remove       → "<verb>"               ("remove" alone)
 *    match        → "<verb>"               ("confirm" alone)
 *
 *  Use this helper instead of inlining the template at call sites.
 */
export function acceptLabel(
  shape: ActionShape,
  proposerIdentity: string,
): string {
  const lbls = actionLabels(shape);
  // No possessive on a decide: there is no proposal of the auditor's
  // to take, which is the entire content of the finding. "needs action
  // Auditor's" is the hanging-possessive bug the remove case already
  // documents, in its worst form.
  if (shape === "remove" || shape === "match" || shape === "decide") {
    return lbls.adopt;
  }
  return `${lbls.adopt} ${proposerIdentity}'s`;
}
