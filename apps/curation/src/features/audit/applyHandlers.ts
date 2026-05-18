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
  AuditReport,
  DismissReason,
  DispositionStatus,
} from "@/api/auditTypes";
import type {
  Design,
  Factor,
  FactorValue,
  Tag,
} from "@/features/experiment/types";
import { isProtectedTagCategory } from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";
import { resolveAgentFactor } from "./factorMatch";
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
  ctx?: { report?: AuditReport | null; design?: Design | null },
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

  // Factor-level calibration apply: agent_extra → add factor;
  // gold_only_miss → remove factor. Requires report (for the agent
  // factor proposal) and the current design (for idempotency).
  if (ctx?.report || ctx?.design) {
    const factorApply = resolveFactorCalibrationApply(
      finding,
      ctx.report ?? null,
      ctx.design ?? null,
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
function resolveCalibrationApply(finding: AuditFinding): ApplyAction | null {
  const code = finding.issue_code;
  if (
    code !== "calibration_agent_extra" &&
    code !== "calibration_gold_only_miss"
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
  // from the curation". With brother's question-form rationale
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
  const tooltip =
    `Agree → remove tag "${t.category}: ${t.value}" from the design.`;
  return {
    mutates: true,
    label: "Agree (remove) →",
    tooltip,
    successMessage:
      `Removed tag "${t.category}: ${t.value}". Commit the draft to save.`,
    mutate: (draft) => removeTagByLabels(draft, t.category, t.value),
    appliedFix: `remove ${t.category}: ${t.value}`,
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
): ApplyAction | null {
  if (finding.target_kind !== "factor") return null;
  const code = finding.issue_code;
  if (
    code !== "calibration_factor_extra" &&
    code !== "calibration_factor_gold_only_miss"
  ) {
    return null;
  }
  if (!design) return null;

  // calibration_factor_extra — add the agent's factor to the draft.
  if (code === "calibration_factor_extra") {
    const cp = report?.evidence?.comparison_proposal ?? null;
    // Pull a label hint from the rationale's first backticked token
    // so older audits without agent_target_index still resolve.
    const labelHint =
      finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
    const proposal = resolveAgentFactor(finding, cp, labelHint);
    if (!proposal) return null;
    const proposalBms = new Set(
      proposal.factor_values.flatMap((fv) => fv.biomaterial_short_names),
    );
    // Idempotency: if an existing factor already covers this exact
    // partition (same biomaterial set, same category label), the
    // add would be a no-op or a duplicate. Surface as
    // "already applied" so the curator doesn't get a useless
    // mutate-click.
    const alreadyApplied = (design.factors ?? []).some((f) => {
      if (
        f.category.label.toLowerCase().trim() !==
        proposal.category.label.toLowerCase().trim()
      ) {
        return false;
      }
      const fBms = new Set(
        f.factor_values.flatMap((fv) => fv.biomaterial_short_names),
      );
      if (fBms.size !== proposalBms.size) return false;
      for (const bm of proposalBms) if (!fBms.has(bm)) return false;
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
    // label but a DIFFERENT partition exists. Adding silently would
    // give the design two factors named the same. Surface as a
    // warning in the tooltip so the curator knows the add is
    // genuinely new, not duplicating.
    const nameClash = (design.factors ?? []).some(
      (f) =>
        f.category.label.toLowerCase().trim() ===
        proposal.category.label.toLowerCase().trim(),
    );
    return {
      mutates: true,
      label: "Agree (add) →",
      tooltip: nameClash
        ? `Agree → add a SECOND factor "${proposal.category.label}" to the design (an existing factor shares the category label but covers different biomaterials).`
        : `Agree → add factor "${proposal.category.label}" (${proposal.factor_values.length} value${
            proposal.factor_values.length === 1 ? "" : "s"
          }) to the design.`,
      successMessage: `Added factor "${proposal.category.label}". Commit the draft to save.`,
      mutate: (draft) => addFactorFromProposal(draft, proposal),
      appliedFix: `add factor ${proposal.category.label}`,
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
    const candidates = (design.factors ?? []).filter(
      (f) => f.category.label.toLowerCase().trim() === goldSlug,
    );
    if (candidates.length === 0) {
      // Already removed (or never present) → idempotent no-op.
      return {
        mutates: false,
        label: "✓ Already removed",
        tooltip: `No factor "${goldSlug}" in the current draft. Agree to disposition without re-applying.`,
        successMessage: "",
      };
    }
    // Single candidate: unambiguous removal.
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
    // Multi-candidate (same category label): pick by biomaterial
    // overlap against the agent's factors. The gold factor whose
    // biomaterials overlap LEAST with what the agent proposed is
    // the one the agent missed — that's the remove target.
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
      tooltip: `Agree → remove factor "${pick.category.label}" (id=${pick.id}, ${pick.factor_values.length} values) from the design. Disambiguated from a duplicate-category sibling by biomaterial overlap.`,
      successMessage: `Removed factor "${pick.category.label}". Commit the draft to save.`,
      mutate: (draft) => removeFactorById(draft, pick!.id),
      appliedFix: `remove factor ${pick.category.label} (id=${pick.id})`,
    };
  }

  return null;
}

/** Append a populated Factor to the draft from an agent factor
 *  proposal. Mirrors the retired ``proposalFactorsToDesignFactors``
 *  on the audit side — same id-allocation strategy (next-after-max)
 *  and same baseline-inference rule. Curator-asserted (IC). */
function addFactorFromProposal(
  design: Design,
  proposal: FactorProposal,
): Design {
  let nextFactorId =
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
      biomaterial_short_names: [...fv.biomaterial_short_names],
      statements: (fv.statements ?? []).map((s) => ({
        category: {
          label: proposal.category.label,
          uri: proposal.category.uri ?? null,
        },
        subject: { label: s.subject.label, uri: s.subject.uri ?? null },
        predicate: s.predicate
          ? { label: s.predicate.label, uri: s.predicate.uri ?? null }
          : null,
        object: s.object
          ? { label: s.object.label, uri: s.object.uri ?? null }
          : null,
      })),
    }),
  );
  const newFactor: Factor = {
    id: nextFactorId,
    name: proposal.name_in_design || proposal.category.label,
    category: {
      label: proposal.category.label,
      uri: proposal.category.uri ?? null,
    },
    description: "",
    type: proposal.factor_type === "continuous" ? "continuous" : "categorical",
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
  return {
    ...design,
    tags: (design.tags ?? []).filter(
      (t) =>
        !labelEq(t.category?.label, categoryLabel) ||
        !labelEq(t.value?.label, valueLabel),
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
    case "assignment":
      return "open the samples tab and scroll to this sample";
    case "experiment":
      return "open the overview tab";
    case "statement":
      return "open the design tab and scroll to the parent FV";
  }
}
