/**
 * Action-aware button labels for finding cards.
 *
 * Companion to `defenderLean.ts` / `leanButtonKinds`. Those modules
 * pick which of the (keep, accept) buttons reads as PRIMARY
 * (highlighted) vs SECONDARY based on the defender's lean. This
 * module picks the TEXT on those same two buttons based on the
 * SHAPE of the action the finding proposes.
 *
 * Canonical screenshot (Paul 2026-05-21): an "Add tag — disease
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
 *   | match        | "confirm"     | —             |
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

export type ActionShape = "add" | "remove" | "change" | "match";

/** Map a finding to one of four action shapes. Drives the button-
 *  label text on the finding card (keep vs accept). */
export function findingActionShape(finding: AuditFinding): ActionShape {
  const code = finding.issue_code;
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
  if (shape === "match") return { keep: "confirm", adopt: "confirm" };
  // change (default)
  return { keep: "don't change", adopt: "adopt" };
}
