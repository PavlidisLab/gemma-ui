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
import type {
  AuditFinding,
  DismissReason,
  DispositionStatus,
} from "@/api/auditTypes";
import type { Design, Tag } from "@/features/experiment/types";
import { isProtectedTagCategory } from "@/features/experiment/types";
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
  /** Disposition status the action implies. Defaults to ``"accepted"``
   *  in the caller — most apply actions are agree + structurally fix.
   *  ``calibration_gold_only_miss`` apply is the inverse: removing
   *  the tag *disagrees* with the finding (the agent was right; the
   *  gold curation is wrong), so it sets ``"dismissed"`` with
   *  ``curator_wrong`` as the reason. */
  dispositionStatus?: DispositionStatus;
  /** Required when ``dispositionStatus === "dismissed"``. Pairs with
   *  the existing closed enum on the disposition PATCH. */
  dismissReason?: DismissReason;
}

/** Resolve an apply action for a finding. Returns null only when
 *  there's nothing actionable AND the target_id is unparseable —
 *  the UI hides the button in that case rather than rendering a
 *  no-op. */
export function resolveApplyAction(
  finding: AuditFinding,
): ApplyAction | null {
  // Calibration findings carry a custom target_id shape
  // (``calibration:<status>:<category>/<value>``) the standard
  // parser doesn't recognise, so we handle them ahead of the
  // ``parseTargetId`` branch. Both apply paths are real
  // mutations — adding or removing an experiment tag — so the
  // curator's "Apply" click writes the change into the design
  // draft, then the disposition PATCH stamps applied_fix.
  const calibrationApply = resolveCalibrationApply(finding);
  if (calibrationApply) return calibrationApply;

  const parsed = parseTargetId(finding.target_id);
  if (!parsed) return null;
  // Mutating handlers for non-calibration findings go here, keyed
  // on (issue_code, target_kind). None ship in Phase 1 outside
  // calibration — when the structured-fix schema lands for the
  // judges that already have a clean fix shape, drop the handler
  // in alongside the calibration branch.
  return focusOnly(parsed);
}

/** Pull (category, value) labels out of a calibration finding's
 *  target_id. Format set agents-side in
 *  ``scripts/build_calibration_batch.py``:
 *  ``calibration:<status>:<category>/<value>``. Returns null when
 *  the shape doesn't match — caller falls back to focus-only. */
function parseCalibrationTargetId(
  targetId: string,
): { status: string; category: string; value: string } | null {
  if (!targetId.startsWith("calibration:")) return null;
  const rest = targetId.slice("calibration:".length);
  const colon = rest.indexOf(":");
  if (colon === -1) return null;
  const status = rest.slice(0, colon);
  const tail = rest.slice(colon + 1);
  const slash = tail.indexOf("/");
  if (slash === -1) return null;
  return {
    status,
    category: tail.slice(0, slash),
    value: tail.slice(slash + 1),
  };
}

/** Lower-case both sides of a label compare. Used by the calibration
 *  remove-path so a curator-typed "C57BL/6J" matches a gold-side
 *  "c57bl/6j" — Gemma's import sometimes case-shifts.   */
function labelEq(a: string | null | undefined, b: string): boolean {
  return (a || "").trim().toLowerCase() === b.trim().toLowerCase();
}

/** Apply-action for the three calibration issue codes. Returns null
 *  when the finding isn't a calibration one or the target_id doesn't
 *  parse — the standard handler chain takes over from there.
 *
 *  - ``calibration_agent_extra``: the agent proposed a tag the gold
 *    doesn't have. Apply = add the tag (using ``proposer_term``'s
 *    URI when present so the new chip lands resolved, not free-text).
 *  - ``calibration_gold_only_miss``: the gold has a tag the agent
 *    didn't propose. Apply = remove the tag (but only when the
 *    curator's verdict is "agent was right; gold is wrong" — the
 *    UI gates this behind the ``Apply`` click, which the curator
 *    only takes after agreeing the agent's absence is correct).
 *  - ``calibration_match``: nothing to apply (both sides have it);
 *    falls through to focus-only.
 */
function resolveCalibrationApply(finding: AuditFinding): ApplyAction | null {
  const code = finding.issue_code;
  if (
    code !== "calibration_agent_extra" &&
    code !== "calibration_gold_only_miss"
  ) {
    return null;
  }
  const t = parseCalibrationTargetId(finding.target_id);
  if (!t) return null;

  if (code === "calibration_agent_extra") {
    // Build a populated Tag from the proposer's term when we have
    // one; fall back to the target_id labels (free-text) otherwise.
    // ``proposer_term`` is set on calibration_agent_extra per the
    // agent-side build_calibration_batch wiring. Disposition is
    // "accepted" — curator agreed the agent was right + applied
    // the addition.
    const term = finding.proposer_term;
    const valueLabel = term?.label || t.value;
    const valueUri = term?.uri ?? null;
    const categoryLabel = t.category;
    const tooltip = valueUri
      ? `Add tag "${categoryLabel}: ${valueLabel}" (${valueUri}) to the design and agree with the finding`
      : `Add tag "${categoryLabel}: ${valueLabel}" (free-text — resolve later) and agree with the finding`;
    return {
      mutates: true,
      label: "Apply (add) →",
      tooltip,
      successMessage: `Added tag "${categoryLabel}: ${valueLabel}". Commit the draft to save.`,
      mutate: (draft) =>
        addPopulatedTag(draft, categoryLabel, valueLabel, valueUri),
      appliedFix: `add ${categoryLabel}: ${valueLabel}`,
    };
  }

  // calibration_gold_only_miss — removing the tag *disagrees* with
  // the finding ("Did the agent miss X?" → "no, agent was right;
  // gold over-tagged"). Disposition is "dismissed" with
  // ``curator_wrong`` as the reason so eval can split this from
  // auditor-side errors.
  //
  // Guard: assay / technology-type tags are load-time invariants
  // (Gemma's import attaches them); the curator can't remove them
  // from the UI even via the audit-apply path. Fall through to the
  // standard focus-only handler so the curator can still inspect
  // and disagree manually with a free-text note.
  if (isProtectedTagCategory(t.category)) {
    return null;
  }
  const tooltip =
    `Remove tag "${t.category}: ${t.value}" from the design and ` +
    `mark this disagreed (agent was right; existing curation was wrong).`;
  return {
    mutates: true,
    label: "Apply (remove) →",
    tooltip,
    successMessage:
      `Removed tag "${t.category}: ${t.value}". Commit the draft to save.`,
    mutate: (draft) => removeTagByLabels(draft, t.category, t.value),
    appliedFix: `remove ${t.category}: ${t.value}`,
    dispositionStatus: "dismissed",
    dismissReason: "curator_wrong",
  };
}

/** Append a populated Tag to the draft if no existing direct tag
 *  matches by (category, value) labels. Curator-asserted by
 *  definition (IC) — same provenance stamp as ``addTag`` /
 *  ``applyProposalToDesign``. Skips inferred tags when checking for
 *  duplicates so an inferred BioMaterial-source tag with the same
 *  label doesn't block the curator from promoting it. */
function addPopulatedTag(
  design: Design,
  categoryLabel: string,
  valueLabel: string,
  valueUri: string | null,
): Design {
  const existing = design.tags ?? [];
  const dup = existing.some(
    (t) =>
      !t.inferred &&
      labelEq(t.category?.label, categoryLabel) &&
      labelEq(t.value?.label, valueLabel),
  );
  if (dup) return design;
  let next = 0;
  for (const t of existing) if (t.id > next) next = t.id;
  const newTag: Tag = {
    id: next + 1,
    category: { label: categoryLabel, uri: null },
    value: { label: valueLabel, uri: valueUri },
    inferred: false,
    evidence_code: "IC",
  };
  return { ...design, tags: [...existing, newTag] };
}

/** Drop direct (curator-attached) tags whose (category, value)
 *  labels match. Inferred tags stay — those are auto-derived from
 *  BM characteristics / FV sources and disappear when the underlying
 *  signal does, not when the curator dispositions the audit.
 *
 *  Protected categories (assay / technology type) are never removed
 *  by this path even when the labels match — the apply handler
 *  guards earlier, but this is the second line of defence in case
 *  another caller threads the helper directly. */
function removeTagByLabels(
  design: Design,
  categoryLabel: string,
  valueLabel: string,
): Design {
  if (isProtectedTagCategory(categoryLabel)) return design;
  return {
    ...design,
    tags: (design.tags ?? []).filter(
      (t) =>
        t.inferred ||
        !labelEq(t.category?.label, categoryLabel) ||
        !labelEq(t.value?.label, valueLabel),
    ),
  };
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
