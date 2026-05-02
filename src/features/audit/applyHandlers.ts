/**
 * Per-finding "Apply & focus" action resolver.
 *
 * Given a finding, returns a small descriptor the UI uses to render
 * the primary action button on the finding card. Two flavours:
 *
 *  - **Mutating action** (`mutates: true`): runs `mutate(draft)`
 *    inside the design-draft commit pipeline so the curator still
 *    reviews + commits via CommitBar. Sets `appliedFix` so the
 *    accept-with-edit field on the disposition PATCH carries the
 *    canonical text of what was applied.
 *  - **Focus-only action** (`mutates: false`): no draft change,
 *    just navigates + scrolls to the element. Used when the right
 *    fix is messy / context-dependent and the curator should make
 *    the call in the editor.
 *
 * Phase 1 is focus-only across the board. Real mutating handlers
 * (e.g. `missing_factor` → lift the factor out of
 * `comparison_proposal`, `missing_fv` → addFactorValue, etc.) land
 * once my brother's structured-fix schema ships in
 * `AUDIT_FEATURE.md`. The registry shape below is deliberately
 * small so adding a per-issue-code handler is one switch arm.
 *
 * Handlers never set the disposition themselves — the caller does
 * that after the action completes (status: "accepted", with
 * `applied_fix` populated when the action mutated).
 */
import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import { parseTargetId, type ParsedTargetId } from "./targetIds";

export interface ApplyAction {
  /** Whether the action mutates the design draft (true) or just
   *  scrolls the curator's eye to the right element (false). The
   *  primary button label switches on this:
   *    true  → "Apply & focus →"
   *    false → "Focus →"
   *  Curators shouldn't have to read tooltips to know if a click
   *  changes their work. */
  mutates: boolean;
  /** Pre-canned text for the primary button. Includes the arrow so
   *  callers don't double-up. */
  label: string;
  /** Tooltip describing what the action will do. */
  tooltip: string;
  /** Toast text after the action runs. Empty string → no toast. */
  successMessage: string;
  /** Optional draft mutator. Required iff `mutates === true`. */
  mutate?: (draft: Design) => Design;
  /** Canonical fix text to send as `applied_fix` on the disposition
   *  PATCH. Populated for mutating actions; empty for focus-only.
   *  When the curator edits before applying (future UI), the edited
   *  text wins. */
  appliedFix?: string;
}

/** Resolve an apply action for a finding. Returns null only when
 *  the target_id is unparseable — the UI hides the button in that
 *  case rather than rendering a no-op. */
export function resolveApplyAction(
  finding: AuditFinding,
): ApplyAction | null {
  const parsed = parseTargetId(finding.target_id);
  if (!parsed) return null;
  // Mutating handlers go here, keyed on (issue_code, target_kind).
  // None ship in Phase 1 — see file header. When the structured-fix
  // schema lands, replace this comment with a switch like:
  //
  //   if (finding.issue_code === "missing_factor" && comparison) {
  //     return liftFactorFromProposal(finding, comparison);
  //   }
  return focusOnly(parsed);
}

function focusOnly(parsed: ParsedTargetId): ApplyAction {
  return {
    mutates: false,
    label: "Focus →",
    tooltip: focusTooltip(parsed),
    successMessage: "",
  };
}

function focusTooltip(parsed: ParsedTargetId): string {
  switch (parsed.kind) {
    case "factor":
      return "open the design tab and scroll to this factor";
    case "fv":
      return "open the design tab, select the parent factor, and scroll to this FV";
    case "tag":
      return "open the overview tab and scroll to this tag";
    case "assignment":
      return "open the samples tab and scroll to this sample";
    case "experiment":
      return "open the overview tab";
    case "statement":
      return "open the design tab and scroll to the parent FV";
  }
}
