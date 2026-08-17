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
 * once the agents-side structured-fix schema ships in
 * `AUDIT_FEATURE.md`. The registry shape below is deliberately
 * small so adding a per-issue-code handler is one switch arm.
 *
 * Handlers never set the disposition themselves — the caller does
 * that after the action completes (status: "accepted", with
 * `applied_fix` populated when the action mutated).
 */
import type {
  AuditFinding,
  AuditReport,
  DismissReason,
  DispositionStatus,
} from "@/api/auditTypes";
import type {
  Design,
  Factor,
  FactorValue,
  OntologyTerm,
  Statement,
  Tag,
} from "@/features/experiment/types";
import { isProtectedTagCategory } from "@/features/experiment/types";
import type { FactorProposal, StatementProposal } from "@/api/types";
import {
  computeFvCorrespondence,
  factorProposalFromApplyAction,
  factorProposalFromRename,
  isCloseFactorMatch,
  isExactFactorMatch,
  pickGoldFactor,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";
import {
  addContinuousFactorFromCharacteristic,
  adoptNearMatchAgentFactor,
  modifyTag,
  setFactorFields,
  setFvLabel,
  setStatement,
} from "@/features/design/mutations";
import {
  factorTarget,
  parseTargetId,
  slug,
  type ParsedTargetId,
} from "./targetIds";
import { findingProposedUris } from "./findingHelpers";

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
  /** When set, the caller MUST surface this message to the curator
   *  and only run ``mutate`` after explicit confirmation. Used today
   *  by ``calibration_factor_extra`` when an existing factor in the
   *  draft shares the proposal's category but has a different FV
   *  partition — silently adding a second factor with the same name
   *  is confusing (Cy reported 2026-06-05). Until we decide whether
   *  the right semantics is merge-FVs or add-second, the curator
   *  confirms each case. */
  confirmMessage?: string;
  /** Override target for the post-apply focus jump. Defaults to
   *  ``finding.target_id`` when the caller doesn't read this. Use
   *  for factor-add applies where the finding's target_id might
   *  point at gold / proposer space — the curator should land on
   *  the NEW factor in the design tab so the FVs are visible. The reviewer
   *  2026-06-13/14 flagged twice that accepting a proposed factor
   *  failed to surface its FVs because the focus jump didn't land
   *  on the just-added factor. */
  focusTargetId?: string;
}

/** Resolve an apply action for a finding. Returns null only when
 *  there's nothing actionable AND the target_id is unparseable —
 *  the UI hides the button in that case rather than rendering a
 *  no-op.
 *
 *  ``report`` is optional — passed only when the caller wants
 *  factor-level apply handlers (extra / gold_only_miss) which need
 *  the comparison_proposal to resolve the agent's full factor shape
 *  and need the live design to guard against already-applied
 *  mutations. Tag-level handlers don't need either; they're left
 *  using only the finding's structured fields. */
export function resolveApplyAction(
  finding: AuditFinding,
  ctx?: {
    report?: AuditReport | null;
    design?: Design | null;
    /** When true, ``*_match`` codes route through the add-shaped
     *  mutator (the displayed gold baseline doesn't carry the entity
     *  even though the audit-time baseline did). Match-downgrade —
     *  see ``findingActionShape({ goldEmpty })`` and
     *  MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16. The editor / card
     *  computes this via ``findingDisplayedGoldEmpty(finding, draft)``
     *  and threads it in. */
    goldEmpty?: boolean;
  },
): ApplyAction | null {
  const goldEmpty = !!ctx?.goldEmpty;
  // Proposer-mode "add_tag" findings ship a structured
  // ``apply_action`` from the agent (tag_llm_judge.py emits
  // ``ApplyAction(kind="add_tag", new_category, new_value)``).
  // Resolve straight from that — avoids hand-parsing target_id
  // and works for the ``missing_tag`` code path that doesn't go
  // through the calibration target_id shape.
  const proposalApply = resolveProposalApply(finding, ctx?.design ?? null);
  if (proposalApply) return proposalApply;

  // Calibration findings carry a custom target_id shape
  // (``calibration:<status>:<category>/<value>``) the standard
  // parser doesn't recognise, so we handle them ahead of the
  // ``parseTargetId`` branch. Both apply paths are real
  // mutations — adding or removing an experiment tag — so the
  // curator's "Apply" click writes the change into the design
  // draft, then the disposition PATCH stamps applied_fix.
  const calibrationApply = resolveCalibrationApply(
    finding,
    ctx?.design ?? null,
    { goldEmpty },
  );
  if (calibrationApply) return calibrationApply;

  // Factor-level calibration apply: agent_extra → add factor;
  // gold_only_miss → remove factor. Requires report (for the agent
  // factor proposal) and the current design (for idempotency).
  if (ctx?.report || ctx?.design) {
    const factorApply = resolveFactorCalibrationApply(
      finding,
      ctx.report ?? null,
      ctx.design ?? null,
      { goldEmpty },
    );
    if (factorApply) return factorApply;
  }

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

/** Is this ``(category, value[, uri])`` already a REAL tag on the design?
 *
 *  The single "is it already there?" test for this module. Both the
 *  resolver arms that decide whether to OFFER an add and the mutator
 *  guard that refuses to APPEND a duplicate go through here, because
 *  they have to agree: a resolver that offers "Agree (add)" over a guard
 *  that then silently declines is a no-op click, which is the failure
 *  this module keeps re-growing. Four hand-rolled copies had already
 *  drifted apart on both rules below.
 *
 *  Two rules, both deliberate:
 *
 *   - **Inferred rows don't count.** An inferred chip is a projection of
 *     a sample characteristic, not a stored experiment tag, so a value
 *     present only as a projection is still curatable into a real tag.
 *     What happens once both exist is a DISPLAY question and already
 *     answered elsewhere: TagBar shows the direct chip with a violet
 *     redundancy glint when every sample carries the same grounded term.
 *     Surfacing an overlap is not a reason to block creating one.
 *   - **URIs are compared only when BOTH sides carry one.** The same
 *     words under a different ontology term are a different concept and
 *     remain addable; when either side is ungrounded there is no URI
 *     evidence to disagree on, so the labels decide. */
function tagAlreadyOnDesign(
  design: Design | null | undefined,
  categoryLabel: string,
  valueLabel: string,
  valueUri: string | null,
): boolean {
  return (design?.tags ?? []).some((t) => {
    if (t.inferred) return false;
    if (!labelEq(t.category?.label, categoryLabel)) return false;
    if (!labelEq(t.value?.label, valueLabel)) return false;
    if (valueUri && t.value?.uri) return t.value.uri === valueUri;
    return true;
  });
}

/** Exact URI equality (trimmed). The finding's ``proposer_term.uri``
 *  (the agent's wrong bind) and the FV's stored statement URI both
 *  originate from the same Gemma import, so an exact compare is enough
 *  to pin the wrong-bind FV. */
function uriEq(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}

/** Apply-action for proposer-mode findings that carry a structured
 *  ``apply_action`` payload from the agent.
 *
 *  Today's coverage: ``kind="add_tag"`` (proposer says "add this
 *  tag", emitted by ``missing_tag`` from the tag judge),
 *  ``kind="remove_tag"`` (entity-frame proposer), and
 *  ``kind="replace_tag"`` (tag swap — remove the baseline tag id then
 *  add the same-concept replacement). All mirror the
 *  calibration_agent_extra path's idempotency + tooltip + appliedFix
 *  shape so the per-card Agree button reads consistently across
 *  audit and proposal modes.
 *
 *  Other ``apply_action.kind`` values (add_factor, add_fv, …) fall
 *  through to null — calibration branch + focusOnly handle them, and
 *  the proposer judges that ship them aren't wired up to a clean
 *  mutator yet. */
function resolveProposalApply(
  finding: AuditFinding,
  design: Design | null,
): ApplyAction | null {
  const aa = finding.apply_action;
  if (!aa) return null;
  // ``remove_tag`` (entity-frame proposer, 2026-06-07+) — agent says
  // "remove the finding's target tag". Pair with the slug-shaped
  // target_id (``tag:<cat-slug>/<val-slug>``) to find the design
  // tag and remove by id. Falls through to null when the target_id
  // doesn't parse OR no design tag matches the slugs (caller's
  // chain takes over — calibration branch handles the same shape
  // as a fallback when no structured apply_action ships).
  if (aa.kind === "remove_tag") {
    const slugMatch = finding.target_id.match(/^tag:([^/]+)\/(.+)$/);
    if (!slugMatch || !design) return null;
    const [, categorySlug, valueSlug] = slugMatch;
    const target = (design.tags ?? []).find(
      (t) =>
        slug(t.category?.label) === categorySlug &&
        slug(t.value?.label) === valueSlug,
    );
    if (!target) {
      return {
        mutates: false,
        label: "✓ Already removed",
        tooltip:
          `No tag matches "${categorySlug} / ${valueSlug}" on the current ` +
          `draft. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    if (isProtectedTagCategory(target.category?.label)) return null;
    const catLabel = target.category?.label ?? categorySlug;
    const valLabel = target.value?.label ?? valueSlug;
    return {
      mutates: true,
      label: "Agree (remove) →",
      tooltip: `Agree → remove tag "${catLabel}: ${valLabel}" from the design.`,
      successMessage: `Removed tag "${catLabel}: ${valLabel}". Commit the draft to save.`,
      mutate: (draft) => removeTagById(draft, target.id),
      appliedFix: `remove ${catLabel}: ${valLabel}`,
    };
  }
  // ``replace_tag`` (tag SWAP, 2026-06-20) — agent says "replace the
  // existing baseline tag (``target_id = "tag:N"``) with this
  // same-concept term under a different URI". GSE154383: drop
  // ``disease model: brain ischemia`` MONDO:0005299, add
  // ``cerebral ischemia`` MONDO:0002679. Compose the existing remove +
  // add mutators so the curator's "adopt" actually rewrites the draft;
  // before this it fell through to a no-op Focus → (the agents-side
  // UIB_HANDOFF_2026_06_20_TAG_SWAP_CURRENT_SIDE_FROM_TARGETID.md).
  if (aa.kind === "replace_tag") {
    if (!design) return null;
    // Statement-bearing modify (calibration_tag_match_near, 2026-07-13):
    // the proposed tag matches an existing one but its structured
    // statements moved (a bare ``genotype: Utrn`` gains
    // ``Utrn · has_genotype · Heterozygous``). Modify the matched tag
    // IN PLACE — preserve its id, overwrite category / value / statements
    // with the proposed set (replace-with-proposed, spec §7). This must
    // run before the id-based swap path below: the near-match target_id
    // can be slug-shaped, and the swap path would remove+add (losing the
    // id) and drop the statements.
    const aaMod = aa as {
      new_category?: unknown;
      new_category_uri?: unknown;
      new_value?: unknown;
      new_value_uri?: unknown;
      statements?: unknown;
    };
    const proposedStatements = proposedTagStatements(finding, aaMod.statements);
    const hasStatements = proposedStatements.length > 0;
    const isNumericTarget = /^tag:\d+$/.test(finding.target_id);
    // Proposed category / value (OPTIONAL): a statement-only near-match
    // keeps the tag's existing category + value; a value/concept
    // near-match moves the value (e.g. strain: C57BL/10 → mdx).
    const newCatLabel =
      typeof aaMod.new_category === "string" ? aaMod.new_category.trim() : "";
    const newCatUri =
      typeof aaMod.new_category_uri === "string" ? aaMod.new_category_uri : null;
    const newValLabel = (
      finding.proposer_term?.label ||
      (typeof aaMod.new_value === "string" ? aaMod.new_value : "")
    ).trim();
    const newValUri =
      finding.proposer_term?.uri ??
      (typeof aaMod.new_value_uri === "string" ? aaMod.new_value_uri : null);
    const modCategory: OntologyTerm | undefined = newCatLabel
      ? { label: newCatLabel, uri: newCatUri }
      : undefined;
    const modValue: OntologyTerm | undefined = newValLabel
      ? { label: newValLabel, uri: newValUri }
      : undefined;
    // Modify the matched tag IN PLACE (preserve id, replace-with-proposed):
    //  - statement near-match (statements moved) — any target shape, OR
    //  - value / category near-match addressed by a SLUG target_id
    //    (strain: C57BL/10 → mdx). The numeric ``tag:N`` swap path below
    //    keeps its remove+add semantics for back-compat.
    // Runs before the id-based swap: near-match target_ids are slug-shaped,
    // and the swap path can't resolve them (returns null → "adopt Auditor's"
    // silently no-op'd — Design review 2026-07-13, the strain value near-match).
    if (hasStatements || (!isNumericTarget && (modCategory || modValue))) {
      const targetTag = resolveTagByTarget(finding, design);
      if (!targetTag) {
        // Nothing to modify — the tag is gone from the draft. Surface as
        // already-applied rather than fall through to the swap path.
        return {
          mutates: false,
          label: "✓ Already applied",
          tooltip:
            "The tag this modifies is no longer on the draft. " +
            "Agree to disposition without re-applying.",
          successMessage: "",
        };
      }
      if (isProtectedTagCategory(targetTag.category?.label)) return null;
      // Never let a modify move a tag INTO a protected category.
      if (newCatLabel && isProtectedTagCategory(newCatLabel)) return null;
      const statements: Statement[] | undefined = hasStatements
        ? toDesignStatements(proposedStatements)
        : undefined;
      const tagLabel = `${targetTag.category?.label}: ${targetTag.value?.label}`;
      // Tags the composed tag subsumes — removed in the SAME mutation,
      // never on their own. Empty until the producer ships the field.
      const superseded = supersededTags(aa, design, targetTag.id);
      const supersedeNote =
        superseded.length > 0
          ? ` Also removes ${superseded.length} tag${
              superseded.length === 1 ? "" : "s"
            } it covers (${superseded.map(tagLabelOf).join(", ")}).`
          : "";
      const dropSuperseded = (d: Design): Design =>
        superseded.reduce((acc, t) => removeTagById(acc, t.id), d);
      // Idempotency: nothing proposed actually differs from the tag.
      const statementsSame =
        !statements ||
        statementSetsEqual(targetTag.statements ?? [], statements);
      const categorySame =
        !modCategory || labelEq(modCategory.label, targetTag.category?.label);
      const valueSame =
        !modValue ||
        (labelEq(modValue.label, targetTag.value?.label) &&
          (modValue.uri ?? null) === (targetTag.value?.uri ?? null));
      if (statementsSame && categorySame && valueSame) {
        // The composed tag is already in place — but its subsumed tags
        // may not have come off yet (a reload between the two halves of
        // an earlier apply). Finishing the job is still the right
        // action; only when there is nothing left to remove is this a
        // true no-op.
        if (superseded.length === 0) {
          return {
            mutates: false,
            label: "✓ Already applied",
            tooltip: `Tag "${tagLabel}" already matches the proposal.`,
            successMessage: "",
          };
        }
        return {
          mutates: true,
          label: "Agree (adopt) →",
          tooltip:
            `Tag "${tagLabel}" already matches the proposal.` + supersedeNote,
          successMessage: `Removed ${superseded.length} tag${
            superseded.length === 1 ? "" : "s"
          } covered by "${tagLabel}". Commit the draft to save.`,
          mutate: dropSuperseded,
          appliedFix: `remove tags covered by ${tagLabel}: ${superseded
            .map(tagLabelOf)
            .join("; ")}`,
        };
      }
      const fixParts: string[] = [];
      if (modValue) fixParts.push(`value → ${modValue.label}`);
      if (modCategory) fixParts.push(`category → ${modCategory.label}`);
      if (statements) fixParts.push(statements.map(statementLabel).join("; "));
      if (superseded.length > 0) {
        fixParts.push(`supersedes ${superseded.map(tagLabelOf).join("; ")}`);
      }
      return {
        mutates: true,
        label: "Agree (adopt) →",
        tooltip: `Agree → update tag "${tagLabel}" to the proposal.` + supersedeNote,
        successMessage:
          `Updated tag "${tagLabel}"${
            superseded.length > 0
              ? ` and removed ${superseded.length} tag${
                  superseded.length === 1 ? "" : "s"
                } it covers`
              : ""
          }. Commit the draft to save.`,
        mutate: (draft) =>
          dropSuperseded(
            modifyTag(draft, targetTag.id, {
              category: modCategory,
              value: modValue,
              statements,
            }),
          ),
        appliedFix: `modify ${tagLabel}: ${fixParts.join("; ")}`,
      };
    }
    const idMatch = finding.target_id.match(/^tag:(\d+)$/);
    if (!idMatch) return null; // need the baseline id to swap against
    const baselineId = Number(idMatch[1]);
    const baseline = (design.tags ?? []).find((t) => t.id === baselineId) ?? null;
    const a = aa as {
      new_category?: unknown;
      new_value?: unknown;
      new_value_uri?: unknown;
    };
    // Proposed side: prefer proposer_term, fall back to apply_action.
    const categoryLabel = (
      typeof a.new_category === "string"
        ? a.new_category
        : baseline?.category?.label ?? ""
    ).trim();
    const valueLabel = (
      finding.proposer_term?.label ||
      (typeof a.new_value === "string" ? a.new_value : "")
    ).trim();
    const valueUri =
      finding.proposer_term?.uri ??
      (typeof a.new_value_uri === "string" ? a.new_value_uri : null);
    if (!categoryLabel || !valueLabel) return null;
    // Never swap a protected (assay / technology-type) tag, on either
    // the baseline or the replacement side.
    if (baseline && isProtectedTagCategory(baseline.category?.label)) {
      return null;
    }
    if (isProtectedTagCategory(categoryLabel)) return null;
    const baseLabel = baseline
      ? `${baseline.category?.label}: ${baseline.value?.label}`
      : `tag #${baselineId}`;
    // An ungrounded replacement (no ontology URI) must NOT be added —
    // doing so drops a free-text, non-ontology tag onto the design,
    // which is what surfaced as "removing a hallucinated tag added a
    // random tag instead" (GSE193284, UIB_HANDOFF_2026_06_25 B2;
    // regression from the 2026-06-20 tag-swap landing). Degrade to a
    // pure removal of the baseline — the curator can attach a grounded
    // replacement manually. The grounded swap path below is unchanged.
    const grounded = !!(valueUri && String(valueUri).trim());
    if (!grounded) {
      if (!baseline) {
        return {
          mutates: false,
          label: "✓ Already applied",
          tooltip: `Baseline tag "${baseLabel}" is already removed.`,
          successMessage: "",
        };
      }
      return {
        mutates: true,
        label: "Agree (remove) →",
        tooltip:
          `Agree → remove "${baseLabel}". The proposed replacement ` +
          `"${categoryLabel}: ${valueLabel}" isn't grounded to an ontology ` +
          `term, so it is NOT added — attach a grounded tag manually if you ` +
          `want one.`,
        successMessage: `Removed "${baseLabel}" (ungrounded replacement not added). Commit the draft to save.`,
        mutate: (draft) => removeTagById(draft, baseline.id),
        appliedFix: `remove ${baseLabel} (ungrounded replacement skipped)`,
      };
    }
    // Idempotency: baseline already gone AND replacement already on the
    // draft → nothing to do, surface as already-applied.
    const replacementPresent = tagAlreadyOnDesign(design, categoryLabel, valueLabel, valueUri);
    if (!baseline && replacementPresent) {
      return {
        mutates: false,
        label: "✓ Already applied",
        tooltip:
          `Tag "${categoryLabel}: ${valueLabel}" already replaces the ` +
          `baseline. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    return {
      mutates: true,
      label: "Agree (swap) →",
      tooltip: `Agree → replace "${baseLabel}" with "${categoryLabel}: ${valueLabel}" (${valueUri}).`,
      successMessage: `Swapped "${baseLabel}" → "${categoryLabel}: ${valueLabel}". Commit the draft to save.`,
      // Remove the baseline by id, then add the replacement.
      // ``addPopulatedTag`` dedups so a manually-present replacement
      // won't double-add.
      mutate: (draft) =>
        addPopulatedTag(
          baseline ? removeTagById(draft, baseline.id) : draft,
          categoryLabel,
          valueLabel,
          valueUri,
        ),
      appliedFix: `replace ${baseLabel} → ${categoryLabel}: ${valueLabel}`,
    };
  }
  if (aa.kind !== "add_tag") return null;
  const action = aa as Extract<typeof aa, { kind: "add_tag" }>;
  const categoryLabel = (action.new_category || "").trim();
  const valueLabel = (action.new_value || "").trim();
  if (!categoryLabel || !valueLabel) return null;
  // Shared resolver — the card renders from this same function, so
  // what Agree writes is what the curator was shown. Do not inline the
  // precedence here again.
  const valueUri = findingProposedUris(finding).valueUri;
  // Statement-bearing add (e.g. ``genotype: Dmd`` carrying
  // ``Dmd · has_genotype · mdx``): thread the proposed statements onto
  // the new tag so they survive apply and become visible + editable in
  // the design editor. Distinct from the reverted existing-tag mod
  // (those go through ``replace_tag``); this is add-of-new only. See
  // TAG_STATEMENT_ADD_TAG_APPLY_BUG_2026_07_13.md.
  const addStatements: Statement[] = toDesignStatements(
    proposedTagStatements(finding, action.statements),
  );

  const alreadyApplied = tagAlreadyOnDesign(design, categoryLabel, valueLabel, valueUri);
  if (alreadyApplied) {
    return {
      mutates: false,
      label: "✓ Already in draft",
      tooltip:
        `Tag "${categoryLabel}: ${valueLabel}" is already on the design. ` +
        `Agree to disposition without re-applying.`,
      successMessage: "",
    };
  }
  const tooltip = valueUri
    ? `Agree → add tag "${categoryLabel}: ${valueLabel}" (${valueUri}) to the design.`
    : `Agree → add tag "${categoryLabel}: ${valueLabel}" (free-text — resolve later) to the design.`;
  const addFixSuffix =
    addStatements.length > 0
      ? `: ${addStatements.map(statementLabel).join("; ")}`
      : "";
  return {
    mutates: true,
    label: "Agree (add) →",
    tooltip,
    successMessage: `Added tag "${categoryLabel}: ${valueLabel}". Commit the draft to save.`,
    mutate: (draft) =>
      addPopulatedTag(
        draft,
        categoryLabel,
        valueLabel,
        valueUri,
        addStatements,
      ),
    appliedFix: `add ${categoryLabel}: ${valueLabel}${addFixSuffix}`,
  };
}

/** Apply-action for the three calibration issue codes. Returns null
 *  when the finding isn't a calibration one or the target_id doesn't
 *  parse — the standard handler chain takes over from there.
 *
 *  - ``calibration_agent_extra``: the agent proposed a tag the gold
 *    doesn't have. Apply = add the tag (using ``proposer_term``'s
 *    URI when present so the new chip lands resolved, not free-text).
 *  - ``calibration_gold_only_miss``: the gold has a tag the agent
 *    didn't propose. Apply = remove the tag (curator's "agree, this
 *    should be removed"). target_id comes in two shapes:
 *    ``tag:<existing_id>`` when the gold tag is already in the
 *    design (numeric id from storage), or
 *    ``calibration:miss:<cat>/<val>`` when no existing-id match was
 *    found. Both branches converge on a remove-mutate.
 *  - ``calibration_match``: nothing to apply (both sides have it);
 *    falls through to focus-only.
 */
function resolveCalibrationApply(
  finding: AuditFinding,
  design: Design | null,
  opts?: { goldEmpty?: boolean },
): ApplyAction | null {
  const code = finding.issue_code;
  const goldEmpty = !!opts?.goldEmpty;
  // Match-downgrade: a ``calibration_match`` viewed against a
  // baseline that lacks the tag is curator-actionable as an add.
  // Route through the same add-tag path ``calibration_agent_extra``
  // uses so Agree actually mutates the draft (was no-op pre-handoff).
  // Per MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16.
  const matchDowngradeAsAdd =
    goldEmpty &&
    (code === "calibration_match" ||
      code === "tag_proposed_match_with_design");
  if (
    code !== "calibration_agent_extra" &&
    code !== "calibration_gold_only_miss" &&
    !matchDowngradeAsAdd
  ) {
    return null;
  }

  // gold_only_miss with a numeric ``tag:<id>`` target_id — the
  // standard slug parser doesn't recognise the bare-id form
  // (it expects ``tag:cat/val``) and the calibration prefix
  // parser only catches ``calibration:miss:...``. Handle the id
  // form explicitly so the mutation runs against the actual
  // existing tag rather than a label match that may be off.
  if (code === "calibration_gold_only_miss") {
    const idMatch = finding.target_id.match(/^tag:(\d+)$/);
    if (idMatch) {
      const tagId = Number(idMatch[1]);
      return {
        mutates: true,
        label: "Agree (remove) →",
        tooltip:
          `Agree → remove this tag from the design (existing curation ` +
          `had it; agent did not propose it).`,
        successMessage:
          "Removed the tag. Commit the draft to save.",
        mutate: (draft) => removeTagById(draft, tagId),
        appliedFix: `remove tag #${tagId}`,
      };
    }
    // Entity-frame proposer (2026-06-07+) emits slugged
    // ``tag:<category-slug>/<value-slug>`` target_ids — mirrors
    // ``tag_target()`` in
    // ``gemma_curation_agents/agents/audit/target_ids.py``. The
    // numeric-id branch above doesn't catch these, and the
    // calibration-prefix parser only handles ``calibration:miss:…``,
    // so the resolver chain previously fell through to focus-only
    // and the "remove" button did nothing. Look up the matching tag
    // by slug (handles "cell-type" vs "cell type" label drift via
    // ``slug()``'s whitespace-collapse) and remove by id.
    const slugMatch = finding.target_id.match(/^tag:([^/]+)\/(.+)$/);
    if (slugMatch && design) {
      const [, categorySlug, valueSlug] = slugMatch;
      // Same permissive fallback as the calibration:miss branch
      // below — strict slug match first, then alphanumeric-only key
      // (design review 2026-06-12 remove-tag walkthrough).
      const normalize = (s: string | null | undefined) =>
        (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const catKey = normalize(categorySlug);
      const valKey = normalize(valueSlug);
      const target = (design.tags ?? []).find(
        (t) =>
          (slug(t.category?.label) === categorySlug &&
            slug(t.value?.label) === valueSlug) ||
          (normalize(t.category?.label) === catKey &&
            normalize(t.value?.label) === valKey),
      );
      if (target && !isProtectedTagCategory(target.category?.label)) {
        const catLabel = target.category?.label ?? categorySlug;
        const valLabel = target.value?.label ?? valueSlug;
        return {
          mutates: true,
          label: "Agree (remove) →",
          tooltip:
            `Agree → remove tag "${catLabel}: ${valLabel}" from the design ` +
            `(existing curation had it; agent did not propose it).`,
          successMessage:
            `Removed tag "${catLabel}: ${valLabel}". Commit the draft to save.`,
          mutate: (draft) => removeTagById(draft, target.id),
          appliedFix: `remove ${catLabel}: ${valLabel}`,
        };
      }
      // Slug parses but no matching tag on the draft → idempotent
      // "already removed" so the curator can disposition without a
      // dangling Apply click.
      if (!target) {
        return {
          mutates: false,
          label: "✓ Already removed",
          tooltip:
            `No tag matches "${categorySlug} / ${valueSlug}" on the current ` +
            `draft. Agree to disposition without re-applying.`,
          successMessage: "",
        };
      }
    }
  }

  // Match-downgrade: ``calibration_match`` viewed against an empty
  // displayed gold baseline routes through an add-tag mutator. The
  // target_id is ``tag:<cat-slug>/<val-slug>`` (NOT the calibration
  // prefix), and the (category, value) labels come from
  // ``finding.proposer_term`` when populated, falling back to the
  // backticked rationale token (``cell type: astrocyte``) the
  // calibration builder emits. Per MATCH_DOWNGRADE_ACTION_HANDOFF.
  if (matchDowngradeAsAdd) {
    const term = finding.proposer_term;
    let categoryLabel = (term?.label ? "" : "").trim();
    let valueLabel = (term?.label ?? "").trim();
    const valueUri: string | null = term?.uri ?? null;
    if (!valueLabel) {
      // Fall back to the rationale's first backticked ``cat: val`` —
      // calibration_match's standard rationale shape ("Is
      // `cell type: astrocyte` correctly assigned?").
      const tok = finding.rationale?.match(/`([^`]+)`/)?.[1] ?? "";
      const colon = tok.indexOf(":");
      if (colon !== -1) {
        categoryLabel = tok.slice(0, colon).trim();
        valueLabel = tok.slice(colon + 1).trim();
      }
    }
    // proposer_term holds the value; the category lives on
    // ``proposer_term_category`` when shipped, or we fall back to
    // the target_id slug (de-slugged best-effort by replacing dashes
    // with spaces — UI-side cosmetic only, the URI is what matters).
    if (!categoryLabel) {
      const slugMatch = finding.target_id.match(/^tag:([^/]+)\//);
      if (slugMatch) categoryLabel = slugMatch[1].replace(/-/g, " ");
    }
    if (!categoryLabel || !valueLabel) return null;
    const alreadyApplied = tagAlreadyOnDesign(design, categoryLabel, valueLabel, valueUri);
    if (alreadyApplied) {
      return {
        mutates: false,
        label: "✓ Already in draft",
        tooltip:
          `Tag "${categoryLabel}: ${valueLabel}" is already on the design. ` +
          `Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    const tooltip = valueUri
      ? `Agree → add tag "${categoryLabel}: ${valueLabel}" (${valueUri}) to the design.`
      : `Agree → add tag "${categoryLabel}: ${valueLabel}" (free-text — resolve later) to the design.`;
    return {
      mutates: true,
      label: "Agree (add) →",
      tooltip,
      successMessage: `Added tag "${categoryLabel}: ${valueLabel}". Commit the draft to save.`,
      mutate: (draft) =>
        addPopulatedTag(draft, categoryLabel, valueLabel, valueUri),
      appliedFix: `add ${categoryLabel}: ${valueLabel}`,
    };
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
    // Idempotency: same `(category, value)` pair already on the
    // design → "Already in draft". Matches on label (case-
    // insensitive) AND — when both sides have a URI — on URI too.
    // Tags without URIs match by label alone. See
    // HANDOFF_2026-05-19_INTER_CURATOR_AUDIT_FOLLOWUPS §3.
    const alreadyApplied = tagAlreadyOnDesign(design, categoryLabel, valueLabel, valueUri);
    if (alreadyApplied) {
      return {
        mutates: false,
        label: "✓ Already in draft",
        tooltip:
          `Tag "${categoryLabel}: ${valueLabel}" is already on the design. ` +
          `Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    const tooltip = valueUri
      ? `Agree → add tag "${categoryLabel}: ${valueLabel}" (${valueUri}) to the design.`
      : `Agree → add tag "${categoryLabel}: ${valueLabel}" (free-text — resolve later) to the design.`;
    return {
      mutates: true,
      label: "Agree (add) →",
      tooltip,
      successMessage: `Added tag "${categoryLabel}: ${valueLabel}". Commit the draft to save.`,
      mutate: (draft) =>
        addPopulatedTag(draft, categoryLabel, valueLabel, valueUri),
      appliedFix: `add ${categoryLabel}: ${valueLabel}`,
    };
  }

  // calibration_gold_only_miss — the agent didn't propose X but the
  // gold has it. Curator's verdict is "agent was right; remove X
  // from the curation". With the agents-side question-form rationale
  // ("Did the agent miss X?" / future "Should X be removed?"),
  // pressing Agree on this finding maps to *do the deletion*; the
  // disposition lands accepted+resolved because the curator
  // agreed-and-acted. (Previously this stamped dismissed +
  // curator_wrong; flipped so Agree→delete reads coherently.
  // Curators who actually believe gold is right just don't press
  // Agree — they Disagree with no_action.) See
  // CALIBRATION_GOLD_ONLY_MISS_DISPOSITION_FLIP_HANDOFF.md for
  // the rationale-text alignment ask.
  //
  // Guard: assay / technology-type tags are load-time invariants
  // (Gemma's import attaches them); the curator can't remove them
  // from the UI even via the audit-apply path. Fall through to the
  // standard focus-only handler so the curator can still inspect
  // and disagree manually with a free-text note.
  if (isProtectedTagCategory(t.category)) {
    return null;
  }
  // Idempotency + lookup: the agent's target_id slugs the labels
  // (whitespace → "-"), but the design tag's labels are the
  // curator's free-text — "border-associated macrophage" (space)
  // vs "border-associated-macrophage" (slug). A bare lowercase+trim
  // compare missed those cases and the "remove" button silently
  // no-op'd. Look up the gold tag by slug so space-vs-dash drift
  // resolves uniformly; remove by id once found. Per design review 2026-06-11.
  //
  // Permissive fallback (design review 2026-06-12 — "I clicked remove tag and
  // nothing happened"): when the strict slug match misses, fall back
  // to a key that ignores ALL non-alphanumeric characters
  // ("developmental_stage" / "developmental stage" / "developmental-
  // stage" all collapse to "developmentalstage"). The slug() function
  // only handles whitespace → dash, so underscores in a target_id and
  // spaces in a design tag's label still failed strict match. After
  // the loose key matches, the card emits the right mutator instead
  // of the misleading "Already removed" idempotent path that left the
  // tag in place but resolved the card.
  const targetCategorySlug = slug(t.category);
  const targetValueSlug = slug(t.value);
  const normalize = (s: string | null | undefined) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const targetCategoryKey = normalize(t.category);
  const targetValueKey = normalize(t.value);
  const goldTag = (design?.tags ?? []).find(
    (tag) =>
      (slug(tag.category?.label) === targetCategorySlug &&
        slug(tag.value?.label) === targetValueSlug) ||
      (normalize(tag.category?.label) === targetCategoryKey &&
        normalize(tag.value?.label) === targetValueKey),
  );
  if (!goldTag && design) {
    return {
      mutates: false,
      label: "✓ Already removed",
      tooltip:
        `Tag "${t.category}: ${t.value}" is not on the design. Agree to ` +
        `disposition without re-applying.`,
      successMessage: "",
    };
  }
  const catLabel = goldTag?.category?.label ?? t.category;
  const valLabel = goldTag?.value?.label ?? t.value;
  const tooltip =
    `Agree → remove tag "${catLabel}: ${valLabel}" from the design.`;
  return {
    mutates: true,
    label: "Agree (remove) →",
    tooltip,
    successMessage:
      `Removed tag "${catLabel}: ${valLabel}". Commit the draft to save.`,
    mutate: goldTag
      ? (draft) => removeTagById(draft, goldTag.id)
      : (draft) => removeTagByLabels(draft, t.category, t.value),
    appliedFix: `remove ${catLabel}: ${valLabel}`,
  };
}

/** Factor-side calibration apply: add the agent's proposed factor
 *  on calibration_factor_extra, remove the gold factor on
 *  calibration_factor_gold_only_miss. Both paths are idempotent —
 *  if the resulting state already matches the curator's "agree"
 *  verdict (factor already in / out of the draft), the handler
 *  returns a focus-only action with an "already applied" label so
 *  the curator doesn't double-add or render a dead button.
 *
 *  Multi-factor-same-category designs (e.g. GSE93824's two
 *  ``genotype`` factors) are disambiguated by biomaterial-set
 *  identity, not by category label alone — adding a "genotype"
 *  proposal whose biomaterials match an existing "genotype"
 *  factor exactly is treated as already-applied; adding one with a
 *  different biomaterial partition is a genuine new factor. */
function resolveFactorCalibrationApply(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
  opts?: { goldEmpty?: boolean },
): ApplyAction | null {
  if (finding.target_kind !== "factor") return null;
  const code = finding.issue_code;
  if (!design) return null;
  const goldEmpty = !!opts?.goldEmpty;

  // Factual mis-binding on a MATCHED factor: the agent bound the wrong
  // gene / strain / cell-line on one FV. Apply = rebind that single FV
  // to the correct entity (relabel + statement subject-URI). Flag-only
  // findings (multi-bind disagreements) ship no ``apply_action`` and
  // fall through to focus-only. See
  // UIB_HANDOFF_2026_07_18_FACTOR_MISBINDING_APPLY_RENAME_FV.md.
  if (code === "calibration_factor_misbinding") {
    return resolveFactorMisbindingApply(finding, design);
  }

  // Match-downgrade (factor side): a ``*_match_*`` finding viewed
  // against an empty displayed gold baseline routes through the
  // add-factor path the ``calibration_factor_extra`` branch below
  // uses — there's no gold factor for ``resolveNearMatchApply`` to
  // mutate in place. Per MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16.
  if (
    goldEmpty &&
    (isExactFactorMatch(finding) ||
      isCloseFactorMatch(finding) ||
      code === "calibration_factor_match" ||
      code === "factor_proposed_match_with_design")
  ) {
    // Fall through to the add-factor branch below by re-tagging
    // the effective code locally. The original ``finding.issue_code``
    // stays unchanged on the wire — only the apply routing flips.
  } else if (
    isExactFactorMatch(finding) ||
    isCloseFactorMatch(finding) ||
    code === "calibration_factor_rename"
  ) {
    // Near / close / legacy-rename factor match: the agent and Gemma
    // paired against the same partition but drift exists at the
    // category-label or FV level. Curator's Agree = adopt the agent's
    // labels/URIs onto the existing Gemma factor in place (a rename +
    // FV relabel). Replaces the previous focus-only fallback so the
    // curator can act on a near-match card without bouncing to the
    // Preview button or the Design tab.
    return resolveNearMatchApply(finding, report, design);
  }

  const effectiveAddCode =
    code === "calibration_factor_extra" ||
    code === "augmentation_factor_extra" ||
    code === "factor_proposed_new" ||
    // Match-downgrade routes match codes through the add path.
    (goldEmpty &&
      (isExactFactorMatch(finding) ||
        isCloseFactorMatch(finding) ||
        code === "calibration_factor_match" ||
        code === "factor_proposed_match_with_design"));

  if (
    !effectiveAddCode &&
    code !== "calibration_factor_gold_only_miss" &&
    code !== "calibration_factor_partition_mismatch"
  ) {
    return null;
  }

  // *_factor_extra / factor_proposed_new — add the agent's factor to
  // the draft. ``factor_proposed_new`` is the entity-frame proposer
  // analog of ``calibration_factor_extra``: same resolver path (find
  // the agent factor via agent_target_index → comparison_proposal),
  // same idempotency check, same mutator. Without this branch the
  // proposal-side Agree button records the disposition but never
  // mutates the draft — the curator clicks Agree, the card greys, and
  // the factor never appears in Design setup. Design review 2026-06-14.
  //
  // Match-downgrade additions (goldEmpty): ``effectiveAddCode``
  // includes the match codes when the displayed baseline lacks the
  // factor; same add-factor mutator handles those.
  if (effectiveAddCode) {
    const cp = report?.evidence?.comparison_proposal ?? null;
    // Pull a label hint from the rationale's first backticked token
    // so older audits without agent_target_index still resolve.
    const labelHint =
      finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
    // Prefer the finding's OWN add-factor payload — it carries the
    // correct FVs regardless of agent_target_index. Falling back to
    // the comparison-proposal resolver only when the payload is
    // absent (older audits) avoids the multi-same-category collapse
    // (GSE225864 ``genotype`` panel: KO/P301S Agree would otherwise
    // ADD the first ``genotype`` factor, A152T). See
    // factorProposalFromApplyAction.
    const proposal =
      factorProposalFromApplyAction(finding) ??
      resolveAgentFactor(finding, cp, labelHint);
    if (!proposal) return null;
    // Idempotency: if an existing factor already covers this exact
    // partition + carries the same FV labels, the add would be a
    // no-op or a duplicate. Surface as "already applied" so the
    // curator doesn't get a useless mutate-click.
    //
    // Earlier this check matched on (category label, biomaterial
    // UNION set) only — partition-equivalent factors with DIFFERENT
    // FV labels (e.g. agent says ``genotype: [WT, Rag1, PHIL]`` and
    // gold has ``genotype: [WT, Rag2, eosinophil-DTA]`` over the
    // same samples) fired "Already in draft" wrongly. The curator
    // would Agree against a phantom, ending up with the gold factor
    // unchanged but the disposition recorded as accepted-without-
    // action — design state no longer matched the recorded
    // verdict. See HANDOFF_2026-05-19_INTER_CURATOR_AUDIT_FOLLOWUPS
    // §3 (GSE67136 worked example).
    //
    // Current check requires a bijection on (FV label, FV
    // biomaterial-set) tuples — captures partition + labels in one
    // signature. Two factors are "already applied" iff their FV
    // signature sets are equal.
    //
    // NUL joins the two halves of the key because it can't occur in a
    // label or a biomaterial name, so the signature is unambiguous.
    // Keep it spelled as the ``\u0000`` ESCAPE: a raw NUL byte in the
    // source makes grep classify this entire file as binary and skip it
    // without saying so, which hides every symbol in here from a repo
    // search (and from any dead-code sweep that relies on one).
    const fvSig = (
      fvs: { free_text_label: string; biomaterial_short_names: string[] }[],
    ) =>
      new Set(
        fvs.map(
          (fv) =>
            `${(fv.free_text_label || "").toLowerCase().trim()}\u0000${[
              ...fv.biomaterial_short_names,
            ]
              .sort()
              .join("|")}`,
        ),
      );
    const pSig = fvSig(proposal.factor_values);
    const alreadyApplied = (design.factors ?? []).some((f) => {
      if (
        f.category.label.toLowerCase().trim() !==
        proposal.category.label.toLowerCase().trim()
      ) {
        return false;
      }
      if (f.factor_values.length !== proposal.factor_values.length) {
        return false;
      }
      const fSig = fvSig(f.factor_values);
      if (fSig.size !== pSig.size) return false;
      for (const s of pSig) if (!fSig.has(s)) return false;
      return true;
    });
    if (alreadyApplied) {
      return {
        mutates: false,
        label: "✓ Already in draft",
        tooltip:
          `An existing factor with category "${proposal.category.label}" already covers ` +
          `the same biomaterials this proposal would have added. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    // Category-name clash guard: a factor with the same category
    // label exists but is NOT already-applied — either a different
    // partition or different FV labels. Adding silently would give
    // the design two factors named the same. Surface as a warning
    // in the tooltip so the curator knows the add is genuinely new,
    // not duplicating.
    const nameClash = (design.factors ?? []).some(
      (f) =>
        f.category.label.toLowerCase().trim() ===
        proposal.category.label.toLowerCase().trim(),
    );
    return {
      mutates: true,
      label: "Agree (add) →",
      tooltip: nameClash
        ? `Agree → add a SECOND factor "${proposal.category.label}" to the design (an existing factor shares the category label but differs in partition or FV labels).`
        : `Agree → add factor "${proposal.category.label}" (${proposal.factor_values.length} value${
            proposal.factor_values.length === 1 ? "" : "s"
          }) to the design.`,
      successMessage: `Added factor "${proposal.category.label}". Commit the draft to save.`,
      mutate: (draft) => addFactorFromProposal(draft, proposal),
      // Focus jumps to the just-added factor (target id derived from
      // the proposal's category) regardless of what the finding's
      // target_id points at on the gold / proposer side. Without this
      // override the design tab opens collapsed on whatever the
      // finding anchored to instead of the new factor, hiding its FVs.
      focusTargetId: factorTarget(proposal.category.label),
      // On name clash, force the caller to confirm before mutating.
      // Cy flagged 2026-06-05 that silent second-add was confusing.
      // Until we decide between merge-FVs vs add-second semantics,
      // every clash requires explicit curator OK.
      ...(nameClash
        ? {
            confirmMessage:
              `An existing factor "${proposal.category.label}" is already in the design ` +
              `with a different FV partition.\n\n` +
              `Clicking OK will add the agent's proposal as a SECOND factor ` +
              `with the same category label (two "${proposal.category.label}" ` +
              `factors in the design). This is rarely what you want — usually ` +
              `you'd merge the new FVs into the existing factor by hand instead.\n\n` +
              `Add the second factor anyway?`,
          }
        : {}),
      appliedFix: `add factor ${proposal.category.label}`,
    };
  }

  // calibration_factor_partition_mismatch — agent and gold share the
  // category but the partition (FV breakdown) disagrees. ``direction``
  // says agent_finer (3 levels vs gold's 2) or agent_coarser (gold's
  // 3 vs agent's 2). Both adopt-shaped: replace gold's FV partition
  // with the agent's, preserving FV ids by biomaterial-set match
  // (so downstream refs survive where possible). Cross-cutting falls
  // through to null — it's not a single-factor replace, the curator
  // has to disambiguate manually (the dedicated cross-cutting card
  // body handles that). Design review 2026-06-14: clicking "adopt Auditor's
  // finer levels" on GSE9649 organism_part disposition-PATCHed but
  // left the design at 2 levels — same class of bug as the
  // ComparisonFactorCard "Proposal is better" fix; partition_mismatch
  // just wasn't routed through any mutator. */
  if (code === "calibration_factor_partition_mismatch") {
    const pm = finding.partition_mismatch;
    if (!pm) return null;
    // Cross-cutting needs the agent to split into multiple factors,
    // which isn't a single-factor replace. Defer to the dedicated
    // card body's UI; no automatic apply. Exception: the
    // "degenerate" cross-cutting case where only ONE gold factor is
    // spanned (the agent classified ``cross_cutting`` because no
    // FV pair hit Jaccard ≥ 0.8 but there's still just one gold
    // factor in scope) — treat as a regular partition_mismatch
    // and adopt-shape applies safely. GSE448 population +
    // biological_sex are the canonical examples.
    if (
      pm.direction === "cross_cutting" &&
      (pm.cross_cutting_golds?.length ?? 0) > 1
    ) {
      return null;
    }
    const cp = report?.evidence?.comparison_proposal ?? null;
    const labelHint =
      pm.agent?.category?.label ??
      finding.rationale?.match(/`([^`]+)`/)?.[1] ??
      null;
    const proposal = resolveAgentFactor(finding, cp, labelHint);
    if (!proposal) return null;
    // Locate the gold factor by category (label / URI) — same
    // lookup ``adoptNearMatchAgentFactor`` uses internally, mirrored
    // here for the idempotency + tooltip strings. No-op when gold
    // already carries the agent's partition (identical FV signature).
    const goldSlug = (
      pm.gold?.category?.label ?? proposal.category.label
    )
      .toLowerCase()
      .trim();
    const goldFactor =
      resolveGoldFactor(finding, design.factors, goldSlug) ??
      (design.factors ?? []).find(
        (f) =>
          (f.category.label || "").toLowerCase().trim() === goldSlug,
      ) ??
      null;
    if (!goldFactor) {
      return {
        mutates: false,
        label: "✓ Factor not in draft",
        tooltip:
          `No factor "${goldSlug}" in the current draft. Agree to ` +
          `disposition without re-applying.`,
        successMessage: "",
      };
    }
    // Idempotency: same FV-signature bijection check as the
    // factor_extra branch. If gold already carries the agent's exact
    // partition, surface as already-applied.
    const fvSig = (
      fvs: { free_text_label: string; biomaterial_short_names: string[] }[],
    ) =>
      new Set(
        fvs.map(
          (fv) =>
            `${(fv.free_text_label || "").toLowerCase().trim()} ${[
              ...fv.biomaterial_short_names,
            ]
              .sort()
              .join("|")}`,
        ),
      );
    const gSig = fvSig(goldFactor.factor_values);
    const pSig = fvSig(proposal.factor_values);
    let same = goldFactor.factor_values.length === proposal.factor_values.length
      && gSig.size === pSig.size;
    if (same) {
      for (const s of pSig) {
        if (!gSig.has(s)) {
          same = false;
          break;
        }
      }
    }
    if (same) {
      return {
        mutates: false,
        label: "✓ Already applied",
        tooltip:
          `Factor "${goldFactor.category.label}" already carries the ` +
          `agent's partition. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    const directionPhrase =
      pm.direction === "agent_finer"
        ? "finer levels"
        : pm.direction === "agent_coarser"
          ? "fewer levels"
          : "partition";
    return {
      mutates: true,
      label: "Agree →",
      tooltip:
        `Agree → adopt agent's ${directionPhrase} on factor ` +
        `"${goldFactor.category.label}" (${goldFactor.factor_values.length} → ` +
        `${proposal.factor_values.length} values). Preserves FV ids where ` +
        `biomaterial sets match. Commit the draft to save.`,
      successMessage:
        `Adopted agent's ${directionPhrase} on factor ` +
        `"${proposal.category.label}". Commit to save.`,
      // 🛑 The target hint is not optional here. Without it
      // ``adoptNearMatchAgentFactor`` re-resolves the landing factor
      // from the AGENT's category — which only matches when both
      // sides already agree on it, and a partition mismatch routinely
      // comes with a recategorization (16 of the 100 partition_mismatch
      // findings in the local store). GSE96826 (eid 15112) is the
      // reported case: the agent proposes `genotype` over Gemma's
      // `disease`, the lookup found nothing, the mutator returned the
      // design untouched, and the disposition PATCHed as accepted —
      // "I tried to adopt the agent's 3-level proposal and it didn't
      // change it" (2026-08-17). Same failure class as the
      // ComparisonFactorCard fix of 2026-08-09, which is where this
      // hint shape comes from. ``goldFactor`` is resolved out of the
      // draft above, so its id is the authoritative landing pad;
      // label + URI ride along as fallbacks for a draft that was
      // rebuilt between resolve and apply.
      mutate: (draft) =>
        adoptNearMatchAgentFactor(draft, proposal, {
          factorId: goldFactor.id,
          categoryLabel: goldFactor.category.label,
          categoryUri: goldFactor.category.uri ?? null,
        }),
      appliedFix:
        `adopt agent partition on factor ${proposal.category.label} ` +
        `(${goldFactor.factor_values.length} → ${proposal.factor_values.length} values)`,
      focusTargetId: factorTarget(proposal.category.label),
    };
  }

  // calibration_factor_gold_only_miss — remove the gold factor the
  // agent didn't propose. target_id slug = factor:<category-slug>.
  // Multi-factor-same-category: pick the gold factor whose
  // biomaterial set best matches the rationale-implied subset.
  // (Best-effort. Falls through to focus-only when ambiguous and
  // no agent factor in cp can disambiguate.)
  if (code === "calibration_factor_gold_only_miss") {
    const goldSlug =
      finding.rationale?.match(/`([^`]+)`/)?.[1]?.toLowerCase().trim() ?? "";
    if (!goldSlug) return null;
    // Index-first via gold_target_index (agents-repo 3868a09); slug
    // + biomaterial-overlap fallback for older audits.
    const indexed = resolveGoldFactor(finding, design.factors, goldSlug);
    if (indexed) {
      return {
        mutates: true,
        label: "Agree (remove) →",
        tooltip: `Agree → remove factor "${indexed.category.label}" (id=${indexed.id}, ${indexed.factor_values.length} values) from the design.`,
        successMessage: `Removed factor "${indexed.category.label}". Commit the draft to save.`,
        mutate: (draft) => removeFactorById(draft, indexed.id),
        appliedFix: `remove factor ${indexed.category.label} (id=${indexed.id})`,
      };
    }
    const candidates = (design.factors ?? []).filter(
      (f) => f.category.label.toLowerCase().trim() === goldSlug,
    );
    if (candidates.length === 0) {
      return {
        mutates: false,
        label: "✓ Already removed",
        tooltip: `No factor "${goldSlug}" in the current draft. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    if (candidates.length === 1) {
      const target = candidates[0];
      return {
        mutates: true,
        label: "Agree (remove) →",
        tooltip: `Agree → remove factor "${target.category.label}" from the design.`,
        successMessage: `Removed factor "${target.category.label}". Commit the draft to save.`,
        mutate: (draft) => removeFactorById(draft, target.id),
        appliedFix: `remove factor ${target.category.label}`,
      };
    }
    // Multi-candidate fallback: biomaterial overlap (legacy audits
    // only — modern wires resolve via gold_target_index above).
    const cp = report?.evidence?.comparison_proposal ?? null;
    if (!cp?.factors?.length) return null;
    const agentBms = new Set(
      cp.factors.flatMap((af) =>
        af.factor_values.flatMap((fv) => fv.biomaterial_short_names),
      ),
    );
    let leastOverlap = Infinity;
    let pick: Factor | null = null;
    for (const g of candidates) {
      let overlap = 0;
      for (const gfv of g.factor_values) {
        for (const bm of gfv.biomaterial_short_names) {
          if (agentBms.has(bm)) overlap++;
        }
      }
      if (overlap < leastOverlap) {
        leastOverlap = overlap;
        pick = g;
      }
    }
    if (!pick) return null;
    return {
      mutates: true,
      label: "Agree (remove) →",
      tooltip: `Agree → remove factor "${pick.category.label}" (id=${pick.id}, ${pick.factor_values.length} values) from the design. Disambiguated from a duplicate-category sibling by biomaterial overlap (legacy audit — no gold_target_index).`,
      successMessage: `Removed factor "${pick.category.label}". Commit the draft to save.`,
      mutate: (draft) => removeFactorById(draft, pick!.id),
      appliedFix: `remove factor ${pick.category.label} (id=${pick.id})`,
    };
  }

  return null;
}

/** Agree on a factor match-near / match-close / rename finding by
 *  replacing the aligned Gemma factor's label + FV labels with the
 *  agent's version. The Gemma factor's *identity* (id, structure)
 *  stays — only the labels change — so downstream references
 *  (audit dots, sample-table FV chips) keep working without
 *  reroute. */
function resolveNearMatchApply(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design,
): ApplyAction | null {
  const cp = report?.evidence?.comparison_proposal ?? null;
  const labelHint =
    finding.rename?.agent.category.label ??
    finding.rationale?.match(/`([^`]+)`/)?.[1] ??
    null;
  // Prefer the comparison-proposal resolution when it lands; fall back
  // to the finding's own rename payload when it doesn't. On a replayed
  // static calibration batch ``comparison_proposal`` is often absent,
  // so ``resolveAgentFactor`` returns null and Agree was silently inert
  // (UIB_HANDOFF_2026_06_25 B1). ``factorProposalFromRename`` rebuilds
  // the proposal from ``finding.rename`` — which ships on the finding —
  // so the apply mutates regardless. Path 1 of replaceFactorWithProposal
  // then uses finding.rename.fv_pairs for the FV relabels.
  const proposal =
    resolveAgentFactor(finding, cp, labelHint) ??
    factorProposalFromRename(finding);
  if (!proposal) return null;
  // Aligned gold factor — index-first via gold_target_index (agents-
  // repo 3868a09); slug + biomaterial-overlap fallback for older
  // audits that pre-date the field.
  const goldSlug = (
    finding.rename?.gold.category.label ??
    finding.rationale?.match(/`([^`]+)`/g)?.[1]?.replace(/`/g, "") ??
    proposal.category.label
  )
    .toLowerCase()
    .trim();
  let goldFactor: Factor | undefined;
  const indexedGold = resolveGoldFactor(finding, design.factors, goldSlug);
  if (indexedGold) {
    goldFactor = indexedGold;
  } else {
    const candidates = (design.factors ?? []).filter(
      (f) => f.category.label.toLowerCase().trim() === goldSlug,
    );
    // For rename findings the gold and agent labels differ — fall
    // back to the agent category slug if the gold slug didn't match.
    const fallbackCandidates =
      candidates.length === 0
        ? (design.factors ?? []).filter(
            (f) =>
              f.category.label.toLowerCase().trim() ===
              proposal.category.label.toLowerCase().trim(),
          )
        : candidates;
    goldFactor = pickGoldFactor(proposal, fallbackCandidates);
  }
  if (!goldFactor) return null;

  // The resolved gold factor may be SYNTHETIC — ``resolveGoldFactor``
  // falls back to ``synthesizeGoldFactorFromRename`` (id ``-1``) when
  // the curator's baseline doesn't carry the factor, so the card can
  // still render both sides. There is nothing in the draft to rename in
  // that case: ``replaceFactorWithProposal`` would find no factor with
  // that id and hand the draft straight back, while this action still
  // claimed ``mutates: true`` and fired an "Adopted agent's labels …
  // Commit to save" toast for a design that never changed. Say so
  // instead, matching the ``calibration_factor_partition_mismatch``
  // branch's handling of the same situation.
  const goldInDraft = (design.factors ?? []).some(
    (f) => f.id === goldFactor.id,
  );
  if (!goldInDraft) {
    return {
      mutates: false,
      label: "✓ Factor not in draft",
      tooltip:
        `No factor "${goldFactor.category.label}" in the current draft — ` +
        `there is nothing to rename. Agree to disposition without ` +
        `re-applying.`,
      successMessage: "",
    };
  }

  // Idempotency: if the gold factor already matches the agent's
  // labels + URIs and there's no FV-level drift, the apply is a
  // no-op. Surface as focus-only with "Already applied" so a second
  // Agree click doesn't render a dead button.
  const sameCategoryLabel =
    goldFactor.category.label.toLowerCase().trim() ===
    proposal.category.label.toLowerCase().trim();
  const sameCategoryUri =
    (goldFactor.category.uri ?? null) === (proposal.category.uri ?? null);
  const { hasDrift } = computeFvCorrespondence(proposal, goldFactor);
  if (sameCategoryLabel && sameCategoryUri && !hasDrift) {
    return {
      mutates: false,
      label: "✓ Already applied",
      tooltip:
        `The Gemma factor "${goldFactor.category.label}" already carries the agent's ` +
        `category + FV labels. Agree to disposition without re-applying.`,
      successMessage: "",
    };
  }

  // Pass the rename payload's authoritative FV pairing through to
  // the mutator when present. ``finding.rename.fv_pairs`` is the
  // agent's committed (agent FV ↔ gold FV) mapping for renames; we
  // trust it over the UI's biomaterial-overlap fallback because the
  // agent had full context at proposal time. Falls back to overlap
  // pairing for code paths that don't ship a rename payload (older
  // near matches, current _close findings pre-pairing-handoff).
  const fvPairs = finding.rename?.fv_pairs ?? null;
  return {
    mutates: true,
    label: "Agree →",
    tooltip:
      `Agree → replace Gemma's factor "${goldFactor.category.label}" with the agent's version ` +
      `(category label, URI, and FV labels). The factor keeps its id and structure; only the ` +
      `labels change. Commit the draft to save; the floating bar's undo rolls it back.`,
    successMessage: `Adopted agent's labels on factor "${proposal.category.label}". Commit to save.`,
    mutate: (draft) =>
      replaceFactorWithProposal(draft, goldFactor.id, proposal, fvPairs),
    appliedFix: `rename factor → ${proposal.category.label}; adopt agent FV labels`,
  };
}

/** Replace the labels + URIs on the gold factor (identified by
 *  ``goldFactorId``) with the agent's proposal.
 *
 *  Pairing precedence:
 *    1. ``fvPairs`` — agent's authoritative (agent FV ↔ gold FV)
 *       mapping from ``finding.rename.fv_pairs``. We trust this
 *       when present; no UI guessing.
 *    2. Biomaterial-set identity — strict partition match. Under
 *       the stricter near-match gate this is bijective by
 *       construction.
 *    3. Highest biomaterial overlap — last-resort fallback for
 *       partial-partition cases (shouldn't happen post-2026-05-18
 *       gate but kept defensive).
 *
 *  Statements aren't rewritten in-place here (that would clobber
 *  URIs the curator might have refined); that's a follow-up. */
function replaceFactorWithProposal(
  design: Design,
  goldFactorId: number,
  proposal: FactorProposal,
  fvPairs: import("@/api/auditTypes").FvPair[] | null,
): Design {
  const gold = (design.factors ?? []).find((f) => f.id === goldFactorId);
  if (!gold) return design;
  // Factor-level update: category (label + URI) + name.
  let next = setFactorFields(design, gold.id, {
    category: {
      label: proposal.category.label,
      uri: proposal.category.uri ?? null,
    },
    name: proposal.name_in_design || proposal.category.label,
  });
  const renamed = next.factors.find((f) => f.id === gold.id);
  if (!renamed) return next;

  // Path 1: agent's authoritative FV pairing. Each pair carries
  // (agent.label, gold.label); the curator's verdict is "adopt
  // agent label on whichever gold FV currently has gold.label".
  // No biomaterial guessing.
  if (fvPairs && fvPairs.length > 0) {
    for (const pair of fvPairs) {
      const aLab = pair.agent.label?.trim() || "";
      const gLab = pair.gold.label?.trim() || "";
      if (!aLab || !gLab || aLab === gLab) continue;
      const gfv = renamed.factor_values.find(
        (v) =>
          (v.free_text_label || "").toLowerCase().trim() ===
          gLab.toLowerCase(),
      );
      if (gfv) next = setFvLabel(next, gold.id, gfv.id, aLab);
    }
    return next;
  }

  // Path 2/3: pair by biomaterial set when the agent didn't ship a
  // fv_pairs payload. Iterate against the freshly-renamed factor
  // (``next``, not ``design``) so we see the post-rename id state.
  const consumed = new Set<number>();
  for (const afv of proposal.factor_values ?? []) {
    const aKey = [...new Set(afv.biomaterial_short_names)].sort().join("|");
    let best: FactorValue | null = null;
    for (const gfv of renamed.factor_values) {
      if (consumed.has(gfv.id)) continue;
      const gKey = [...new Set(gfv.biomaterial_short_names)].sort().join("|");
      if (gKey === aKey) {
        best = gfv;
        break;
      }
    }
    if (!best) {
      const aBms = new Set(afv.biomaterial_short_names);
      let bestOverlap = 0;
      for (const gfv of renamed.factor_values) {
        if (consumed.has(gfv.id)) continue;
        let n = 0;
        for (const bm of gfv.biomaterial_short_names) {
          if (aBms.has(bm)) n++;
        }
        if (n > bestOverlap) {
          bestOverlap = n;
          best = gfv;
        }
      }
    }
    if (!best) continue;
    consumed.add(best.id);
    const newLabel = afv.free_text_label || "";
    if (newLabel && newLabel !== best.free_text_label) {
      next = setFvLabel(next, gold.id, best.id, newLabel);
    }
  }
  return next;
}

/** Where the agent's wrong bind sits on the draft — the FV plus the
 *  statement slot (index + subject/object role) that carries it.
 *  ``statementIndex === -1`` means the wrong bind was on the FV label
 *  only (no statement), so the rebind is a plain relabel. */
type MisbindHit = {
  factorId: number;
  fvId: number;
  statementIndex: number;
  role: "subject" | "object";
};

/** Rebind a single factor value to the correct entity — the apply for
 *  ``calibration_factor_misbinding``. The agent bound the wrong
 *  gene / strain / cell-line on an otherwise-MATCHED factor; on Agree
 *  we relabel the FV the agent got wrong (located by ``proposer_term``,
 *  the wrong bind) to ``new_value`` and rebind its statement subject to
 *  ``new_value_uri``. Returns null on a flag-only finding (no
 *  ``apply_action``) or when the wrong-bind FV can't be located — the
 *  caller falls back to focus-only. */
function resolveFactorMisbindingApply(
  finding: AuditFinding,
  design: Design,
): ApplyAction | null {
  const aa = finding.apply_action;
  if (!aa || aa.kind !== "rename_fv") return null;
  // The union's forward-compat catch-all (``{kind: string}``) overlaps
  // ``kind: "rename_fv"``, so narrow explicitly — same Extract cast the
  // ``add_tag`` branch uses.
  const action = aa as Extract<typeof aa, { kind: "rename_fv" }>;
  const newValue = (action.new_value ?? "").trim();
  if (!newValue) return null;
  const newValueUri = action.new_value_uri ?? null;

  const wrongUri = finding.proposer_term?.uri ?? null;
  const wrongLabel = finding.proposer_term?.label ?? null;
  if (!wrongUri && !wrongLabel) return null;

  // Scope to the matched factor when it resolves to a real draft factor;
  // otherwise search every factor. The wrong-bind term (a gene / strain
  // / cell-line URI) is specific enough to locate the FV by content,
  // which sidesteps the audit-time factor-id fragility — ``target_id``
  // points at the gold id, not necessarily a draft id (the
  // phantom-factor-match lesson, 2026-07-01).
  const labelHint = finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
  const scoped = resolveGoldFactor(finding, design.factors, labelHint);
  const scopedReal =
    scoped && (design.factors ?? []).some((f) => f.id === scoped.id)
      ? scoped
      : null;

  const locate = (factors: Factor[]): MisbindHit | null => {
    // Pass 1: URI match on a statement role — the strongest signal.
    if (wrongUri) {
      for (const f of factors) {
        for (const fv of f.factor_values) {
          for (let i = 0; i < fv.statements.length; i++) {
            const s = fv.statements[i];
            if (uriEq(s.subject?.uri, wrongUri)) {
              return { factorId: f.id, fvId: fv.id, statementIndex: i, role: "subject" };
            }
            if (uriEq(s.object?.uri, wrongUri)) {
              return { factorId: f.id, fvId: fv.id, statementIndex: i, role: "object" };
            }
          }
        }
      }
    }
    // Pass 2: label match — a statement role label, then the FV label
    // (older packages without a grounded proposer URI).
    if (wrongLabel) {
      for (const f of factors) {
        for (const fv of f.factor_values) {
          for (let i = 0; i < fv.statements.length; i++) {
            const s = fv.statements[i];
            if (labelEq(s.subject?.label, wrongLabel)) {
              return { factorId: f.id, fvId: fv.id, statementIndex: i, role: "subject" };
            }
            if (labelEq(s.object?.label, wrongLabel)) {
              return { factorId: f.id, fvId: fv.id, statementIndex: i, role: "object" };
            }
          }
          if (labelEq(fv.free_text_label, wrongLabel)) {
            return { factorId: f.id, fvId: fv.id, statementIndex: -1, role: "subject" };
          }
        }
      }
    }
    return null;
  };

  const hit =
    (scopedReal && locate([scopedReal])) || locate(design.factors ?? []);

  if (!hit) {
    // Idempotency: the FV is already rebound to the correct entity (the
    // wrong term is gone, the corrected one is present). Surface as
    // "already applied" so a second Agree click isn't a dead button.
    const alreadyRebound = (design.factors ?? []).some((f) =>
      f.factor_values.some(
        (fv) =>
          labelEq(fv.free_text_label, newValue) ||
          fv.statements.some(
            (s) =>
              uriEq(s.subject?.uri, newValueUri) ||
              uriEq(s.object?.uri, newValueUri),
          ),
      ),
    );
    if (alreadyRebound) {
      return {
        mutates: false,
        label: "✓ Already applied",
        tooltip: `This factor value is already bound to "${newValue}". Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    return null;
  }

  const factor = (design.factors ?? []).find((f) => f.id === hit.factorId);
  const factorLabel = factor?.category.label ?? "factor";
  const fromLabel = wrongLabel ?? "the agent's bind";
  return {
    mutates: true,
    label: "Agree →",
    tooltip:
      `Agree → rebind the factor value from "${fromLabel}" to "${newValue}"` +
      `${newValueUri ? ` (${newValueUri})` : ""} on factor "${factorLabel}". ` +
      `The FV keeps its id and sample assignments; only the bound entity ` +
      `changes. Commit the draft to save.`,
    successMessage: `Rebound "${fromLabel}" → "${newValue}" on factor "${factorLabel}". Commit to save.`,
    mutate: (draft) =>
      rebindFactorValue(
        draft,
        hit.factorId,
        hit.fvId,
        hit.statementIndex,
        hit.role,
        newValue,
        newValueUri,
      ),
    appliedFix:
      finding.suggested_fix?.trim() || `rebind ${fromLabel} → ${newValue}`,
  };
}

/** Rebind one FV to a corrected entity: patch the matched statement
 *  role (subject / object) to the new (label, uri) and force the FV
 *  label. ``statementIndex < 0`` means the wrong bind was on the FV
 *  label only (no statement) — relabel only. */
function rebindFactorValue(
  design: Design,
  factorId: number,
  fvId: number,
  statementIndex: number,
  role: "subject" | "object",
  newValue: string,
  newValueUri: string | null,
): Design {
  let next = design;
  if (statementIndex >= 0) {
    const fv = next.factors
      .find((f) => f.id === factorId)
      ?.factor_values.find((v) => v.id === fvId);
    const current = fv?.statements[statementIndex];
    if (current) {
      const term: OntologyTerm = { label: newValue, uri: newValueUri };
      const patched: Statement = {
        ...current,
        ...(role === "object" ? { object: term } : { subject: term }),
      };
      next = setStatement(next, factorId, fvId, statementIndex, patched);
    }
  }
  // Force the FV label regardless — ``setStatement`` only auto-syncs the
  // label off an auto-derived primary-subject statement, so a customised
  // label or an object-role rebind wouldn't otherwise update.
  next = setFvLabel(next, factorId, fvId, newValue);
  return next;
}

/** Append a populated Factor to the draft from an agent factor
 *  proposal. Mirrors the retired ``proposalFactorsToDesignFactors``
 *  on the audit side — same id-allocation strategy (next-after-max)
 *  and same baseline-inference rule. Curator-asserted (IC). */
/** Walk ``design.biomaterials[].characteristics`` looking for a key
 *  that matches the agent's continuous-factor proposal. Match order:
 *  exact match → case-insensitive → fuzzy (alphanumeric-only collapse,
 *  so "time point" / "time_point" / "timepoint" all match a "timepoint"
 *  proposal). Returns the actual key string from the design (preserves
 *  the curator-facing casing / spacing) so the caller can pass it
 *  straight to ``addContinuousFactorFromCharacteristic``. */
function resolveContinuousCharacteristicKey(
  design: Design,
  proposalCategory: string,
): string | null {
  const allKeys = new Set<string>();
  for (const bm of design.biomaterials ?? []) {
    for (const k of Object.keys(bm.characteristics ?? {})) allKeys.add(k);
  }
  if (allKeys.has(proposalCategory)) return proposalCategory;
  const targetLc = proposalCategory.trim().toLowerCase();
  for (const k of allKeys) {
    if (k.trim().toLowerCase() === targetLc) return k;
  }
  const loose = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const targetLoose = loose(proposalCategory);
  for (const k of allKeys) {
    if (loose(k) === targetLoose) return k;
  }
  return null;
}

/** Build a Factor from a FactorProposal and append it to ``design``.
 *  Continuous-factor proposals are promoted to per-sample FVs via
 *  ``addContinuousFactorFromCharacteristic`` when the agent shipped
 *  only a placeholder FV. Exported so ``ComparisonFactorCard`` can
 *  reuse it for the match-downgrade add-path
 *  (MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16). */
export function addFactorFromProposal(
  design: Design,
  proposal: FactorProposal,
): Design {
  // Continuous-factor branch: the agent ships ONE placeholder FV
  // ("<continuous, populated from characteristic>") with empty
  // biomaterials + null numeric_value. Blindly adding it produces a
  // single-empty-FV factor that's invisible to the curator and breaks
  // the sample table. Per design review 2026-06-13: "accepting the agent's
  // suggestion for a continuous factor fails to do anything".
  //
  // Promote to per-sample FVs via ``addContinuousFactorFromCharacteristic``:
  // walks ``design.biomaterials[i].characteristics`` for a key matching
  // the factor's category (case-insensitive; underscore/space tolerant)
  // and emits one FV per BM carrying that characteristic.
  if (proposal.factor_type === "continuous") {
    const fvs = proposal.factor_values ?? [];
    const placeholderOnly =
      fvs.length === 0 ||
      (fvs.length === 1 &&
        (fvs[0].biomaterial_short_names ?? []).length === 0);
    if (placeholderOnly) {
      const characteristicKey = resolveContinuousCharacteristicKey(
        design,
        proposal.category.label,
      );
      if (characteristicKey) {
        const { design: next } = addContinuousFactorFromCharacteristic(
          design,
          characteristicKey,
          {
            name: proposal.name_in_design || proposal.category.label,
            category: {
              label: proposal.category.label,
              uri: proposal.category.uri ?? null,
            },
          },
        );
        return next;
      }
      // Couldn't find a matching characteristic — fall through to the
      // generic add (still better than dropping the curator's click
      // silently). The factor lands with the placeholder FV; the
      // curator can rename / re-bind from the design editor.
    }
  }

  const nextFactorId =
    (design.factors ?? []).reduce((m, f) => Math.max(m, f.id), 0) + 1;
  let nextFvId =
    (design.factors ?? [])
      .flatMap((f) => f.factor_values)
      .reduce((m, fv) => Math.max(m, fv.id), 0) + 1;
  const factor_values: FactorValue[] = (proposal.factor_values ?? []).map(
    (fv) => ({
      id: nextFvId++,
      free_text_label: fv.free_text_label,
      is_baseline: !!fv.is_baseline,
      numeric_value: fv.numeric_value ?? null,
      biomaterial_short_names: [...(fv.biomaterial_short_names ?? [])],
      statements: toDesignStatements(fv.statements ?? [], {
        label: proposal.category.label,
        uri: proposal.category.uri ?? null,
      }),
    }),
  );
  const newFactor: Factor = {
    id: nextFactorId,
    name: proposal.name_in_design || proposal.category.label,
    category: {
      label: proposal.category.label,
      uri: proposal.category.uri ?? null,
    },
    // Carry the agent's ≤80-char ``description`` (the subtitle the
    // proposal card surfaces — "Lipopolysaccharide (LPS) vs vehicle
    // control") onto the new factor so the curator doesn't have to
    // re-type it after Agree. Design review 2026-06-11: he saw the description
    // on the card, clicked Agree, and the resulting factor landed with
    // an empty description — the subtitle was being dropped at the
    // mutator boundary. Empty string when the proposal didn't carry one
    // (older audits, structural-only adds).
    description: (proposal.description ?? "").trim(),
    type: proposal.factor_type === "continuous" ? "continuous" : "categorical",
    baseline_relevance: proposal.baseline_relevance,
    baseline_relevance_reason: proposal.baseline_relevance_reason,
    factor_values,
  };
  return { ...design, factors: [...(design.factors ?? []), newFactor] };
}

/** Drop a factor by id. Used by the gold_only_miss apply path so
 *  multi-factor-same-category designs can target a specific
 *  duplicate without label-matching against its sibling. */
function removeFactorById(design: Design, factorId: number): Design {
  return {
    ...design,
    factors: (design.factors ?? []).filter((f) => f.id !== factorId),
  };
}

/** Append a populated Tag to the draft if no existing direct tag
 *  matches by (category, value) labels. Curator-asserted by
 *  definition (IC) — same provenance stamp as ``addTag`` /
 *  ``applyProposalToDesign``. Skips inferred tags when checking for
 *  duplicates so an inferred BioMaterial-source tag with the same
 *  label doesn't block the curator from promoting it. */
/** The proposed statement set for a tag apply. Prefers
 *  ``apply_action.statements`` but falls back to the finding's
 *  ``proposer_statements`` — the agent reliably populates the render
 *  field (so the card + Current↔Proposed delta show the S·P·O) but
 *  often leaves ``apply_action.statements`` null, which silently no-op'd
 *  the apply (Utrn near-match + Dmd add on GSE84876, 2026-07-13). Both
 *  fields carry the same ``StatementProposal`` shape and mean the same
 *  thing — the statements the curator is adopting — so either is
 *  authoritative. */
function proposedTagStatements(
  finding: AuditFinding,
  applyActionStatements: unknown,
): StatementProposal[] {
  const fromAction = Array.isArray(applyActionStatements)
    ? (applyActionStatements as StatementProposal[])
    : [];
  if (fromAction.length > 0) return fromAction;
  return finding.proposer_statements ?? [];
}

/** Convert proposer ``StatementProposal[]`` to the design ``Statement``
 *  shape, dropping entries without a subject.
 *
 *  ``categoryOverride`` forces every statement onto one category —
 *  what the add-factor path wants, since statements on a new factor's
 *  FVs take that factor's category. Omitted, each statement keeps its
 *  own. */
function toDesignStatements(
  proposed: StatementProposal[],
  categoryOverride?: OntologyTerm,
): Statement[] {
  return proposed
    .filter((s) => s?.subject?.label)
    .map((s) => ({
      category: categoryOverride ?? s.category ?? null,
      subject: s.subject,
      predicate: s.predicate ?? null,
      object: s.object ?? null,
    }));
}

/** Resolve the existing design tag a finding targets, for the
 *  ``replace_tag`` statement-modify path. Handles both target_id
 *  shapes tag findings use: the numeric ``tag:<id>`` (id join) and the
 *  slug-shaped ``tag:<cat>/<val>`` / ``calibration:*:<cat>/<val>``
 *  (parsed by ``parseTargetId``). Returns null when neither resolves —
 *  the caller then treats the modify as already-applied. */
function resolveTagByTarget(finding: AuditFinding, design: Design): Tag | null {
  return resolveTagByTargetId(finding.target_id, design);
}

/** The same resolution keyed by a bare target_id string rather than a
 *  finding. Split out for ``replace_tag``'s supersede set, whose
 *  entries are target_ids of OTHER tags — the composed tag's own
 *  finding can't resolve them. */
function resolveTagByTargetId(targetId: string, design: Design): Tag | null {
  const idMatch = targetId.match(/^tag:(\d+)$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    return (design.tags ?? []).find((t) => t.id === id) ?? null;
  }
  const parsed = parseTargetId(targetId);
  if (parsed?.kind === "tag") {
    return (
      (design.tags ?? []).find(
        (t) =>
          slug(t.category?.label) === parsed.categorySlug &&
          slug(t.value?.label) === parsed.valueSlug,
      ) ?? null
    );
  }
  return null;
}

/**
 * Tags a ``replace_tag`` declares it SUBSUMES — the ones that should
 * come off the draft in the same click that lands the composed tag.
 *
 * Motivating case (ticket 189, GSE245515, 2026-08-17): the correct
 * annotation is one composed tag, ``glutamatergic neuron —derives from
 * cell (CLO_0037209)→ induced pluripotent stem cell line cell``, which
 * subsumes the two bare tags ``cell type: glutamatergic neuron`` and
 * ``cell line: induced pluripotent stem cell line cell``. It shipped as
 * a `replace_tag` plus a companion remove-tag card carrying no apply
 * action, so the curator made one decision and then had to chase the
 * leftovers by hand.
 *
 * ⚠️ The two directions are NOT symmetric. Collapsing two tags into one
 * tag-plus-statement is a win; dropping a statement to reach "one tag"
 * is a loss. So a supersede set is only ever honoured as part of
 * applying the composed tag that carries the detail — never as a
 * standalone tidy-up. That is enforced structurally here: the removals
 * are folded into the SAME mutator as the modify, and the caller has no
 * way to run them alone.
 *
 * Wire shape: ``apply_action.supersedes`` — a list of target_ids
 * (``tag:<id>`` or ``tag:<cat-slug>/<val-slug>``). Not emitted by any
 * producer yet (the agents-side ``ApplyAction`` is ``_Strict``, so it
 * needs the field added there first — asked for in
 * UI_PARTITION_SWAP_HAS_NO_APPLY_PATH_2026_08_17 §1b). Until then this
 * resolves to an empty list on every finding and nothing changes.
 *
 * Entries that don't resolve, name the target tag itself, or point at a
 * protected category are dropped rather than guessed at.
 */
function supersededTags(
  aa: unknown,
  design: Design,
  targetTagId: number | null,
): Tag[] {
  const declared =
    aa && typeof aa === "object"
      ? (aa as { supersedes?: unknown }).supersedes
      : undefined;
  const raw = Array.isArray(declared) ? declared : [];
  const out: Tag[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const tag = resolveTagByTargetId(entry.trim(), design);
    if (!tag) continue;
    if (targetTagId != null && tag.id === targetTagId) continue;
    if (isProtectedTagCategory(tag.category?.label)) continue;
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push(tag);
  }
  return out;
}

function tagLabelOf(t: Tag): string {
  return `${t.category?.label ?? "?"}: ${t.value?.label ?? "?"}`;
}

/** One statement's identity signature — ``subject|predicate|object``,
 *  URI-or-label per slot, lowercased. Mirrors the agents-side
 *  ``_stmt_key`` (URI-precedence) so the UI's idempotency check agrees
 *  with the finding generator's notion of "same statement". */
function statementSignature(s: {
  subject?: OntologyTerm | null;
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
}): string {
  const part = (t?: OntologyTerm | null) =>
    (t?.uri || t?.label || "").trim().toLowerCase();
  return `${part(s.subject)}|${part(s.predicate)}|${part(s.object)}`;
}

/** Order-insensitive set equality over statement signatures — two tags
 *  with the same statements in a different order are equal. */
function statementSetsEqual(a: Statement[], b: Statement[]): boolean {
  const sa = a.map(statementSignature).sort();
  const sb = b.map(statementSignature).sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** Human-readable ``subject · predicate · object`` for the
 *  ``applied_fix`` disposition text. */
function statementLabel(s: Statement): string {
  return [s.subject?.label, s.predicate?.label, s.object?.label]
    .filter(Boolean)
    .join(" · ");
}

function addPopulatedTag(
  design: Design,
  categoryLabel: string,
  valueLabel: string,
  valueUri: string | null,
  /** Statements for a genuinely-new statement-bearing tag (add of a
   *  ``genotype: Dmd`` that carries ``Dmd · has_genotype · mdx``).
   *  Empty / omitted leaves the tag flat. */
  statements?: Statement[],
): Design {
  const existing = design.tags ?? [];
  if (tagAlreadyOnDesign(design, categoryLabel, valueLabel, valueUri)) {
    return design;
  }
  let next = 0;
  for (const t of existing) if (t.id > next) next = t.id;
  const newTag: Tag = {
    id: next + 1,
    category: { label: categoryLabel, uri: null },
    value: { label: valueLabel, uri: valueUri },
    ...(statements && statements.length > 0 ? { statements } : {}),
    inferred: false,
    evidence_code: "IC",
  };
  return { ...design, tags: [...existing, newTag] };
}

/** Drop the tag whose (category, value) labels match. Removes both
 *  direct (curator-attached) and inferred chips so the curator's
 *  "agree, gold over-tagged" verdict actually clears the chip from
 *  the visible design. Inferred BM-derived chips will reappear from
 *  the source on the next read; the curator can resolve that
 *  upstream — for the audit-disposition flow what matters is that
 *  Agree → tag gone gives immediate visual feedback.
 *
 *  Protected categories (assay / technology type) are never removed
 *  even when the labels match — the apply handler guards earlier,
 *  but this is the second line of defence in case another caller
 *  threads the helper directly. */
function removeTagByLabels(
  design: Design,
  categoryLabel: string,
  valueLabel: string,
): Design {
  if (isProtectedTagCategory(categoryLabel)) return design;
  // Compare by slug so the same target_id-shaped labels (whitespace
  // collapsed to "-") still match design tags with the curator's
  // original spacing. ``labelEq``'s bare lowercase+trim wasn't enough
  // — see Design review 2026-06-11 (the "remove doesn't remove" walkthrough).
  const catSlug = slug(categoryLabel);
  const valSlug = slug(valueLabel);
  return {
    ...design,
    tags: (design.tags ?? []).filter(
      (t) =>
        slug(t.category?.label) !== catSlug ||
        slug(t.value?.label) !== valSlug,
    ),
  };
}

/** Drop the tag with this id. Used when the audit finding carries
 *  ``target_id = "tag:<existing_id>"`` (the standard agent-side
 *  shape for gold-only-miss against an existing design tag). Does
 *  the same protected-category guard as the label path so an assay
 *  tag can't be removed by id either. */
function removeTagById(design: Design, tagId: number): Design {
  const target = (design.tags ?? []).find((t) => t.id === tagId);
  if (!target) return design;
  if (isProtectedTagCategory(target.category?.label)) return design;
  return {
    ...design,
    tags: (design.tags ?? []).filter((t) => t.id !== tagId),
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
    case "characteristic":
      // Entity-frame proposer characteristic finding — anchors to the
      // raw BM column(s) the agent proposes to clean / merge. No
      // dedicated tab yet; the overview tab carries the characteristics
      // block, so route there.
      return "open the overview tab and scroll to the source characteristic column(s)";
    case "assignment":
      return "open the samples tab and scroll to this sample";
    case "experiment":
      return "open the overview tab";
    case "statement":
      return "open the design tab and scroll to the parent FV";
  }
}
