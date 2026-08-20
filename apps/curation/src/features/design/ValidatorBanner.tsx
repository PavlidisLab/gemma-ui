import type { ReactNode } from "react";
import {
  MAX_STATEMENT_PAIRS,
  type Design,
  type DesignValidationState,
} from "@/features/experiment/types";

/**
 * Compact summary of the validator state. Green for ok; amber for any
 * warning. Per-factor details are listed underneath when warnings exist.
 *
 * Each per-factor warning row is a button — clicking it selects the
 * offending factor in the FactorList so the curator lands on the
 * actual problem rather than scrolling.
 */
export function ValidatorBanner({
  design,
  state,
  onSelectFactor,
}: {
  design: Design;
  state: DesignValidationState;
  /** Optional jump-to-factor handler. When omitted, rows render as plain text. */
  onSelectFactor?: (factorId: number) => void;
}) {
  // Soft signals from the proposer — uncertain-baseline factors,
  // for now. Rendered separately from the amber warnings list with
  // a slate (not amber) tone so they read as "consider this" rather
  // than "fix this." Empty for designs without per-factor agent
  // hints (curator-built factors, pre-baseline-relevance proposals).
  const softFactors = state.factors.filter((s) => s.baseline_uncertain);
  // Advisory, so deliberately NOT routed through ``warningsFor`` —
  // that list only renders on the ``!ok`` path, and an over-full
  // statement group on an otherwise-clean design has to still be
  // visible.
  const overfullFactors = state.factors.filter(
    (s) => s.overfull_statement_groups.length > 0,
  );
  // More than one marked baseline. Legal — a dataset that is really two
  // experiments in one carries a reference per sub-experiment, and
  // Gemma's split clones the flag onto each — so this asks whether it
  // was intended rather than calling it wrong. Advisory channel for the
  // same reason as the two above: it has to stay visible on a design
  // that is otherwise clean, which the amber list is not.
  //
  // ANY factor, deliberately un-gated by ``baseline_required`` (Paul,
  // 2026-08-19: "just flag any >1-baseline factor to the curator").
  // Block / batch / cell-type / cell-line factors carry
  // ``baseline_required: false`` because nothing should ASK them for a
  // baseline — but two marks already sitting on one is worth a look
  // wherever it happens, and more surprising there, not less. Gemma
  // agrees: its DEA counts explicitly marked values, not categories.
  const multiBaselineFactors = state.factors.filter(
    (s) => s.baseline_count > 1,
  );
  // Factor values nothing is assigned to. Advisory for the same reason
  // as the three above — it has to stay visible on a design that is
  // otherwise clean, and a design CAN be clean with one: "every sample
  // assigned" says nothing about a level that holds none.
  const emptyFvFactors = state.factors.filter(
    (s) => s.empty_factor_values.length > 0,
  );

  if (state.ok) {
    return (
      <div className="rounded-lg border bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700/60">
        <div className="px-3 py-2 text-xs text-emerald-900 space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold">✓ design valid</span>
            {state.factors.map((s) => (
              <span key={s.factor_id}>
                {/* Was a hardcoded "1 baseline". A valid design may carry
                    two references, or none marked at all where Gemma
                    detects one — both printed as "1", the banner
                    contradicting the cards. */}
                {nameOf(design, s.factor_id)}: {baselineSummary(s)} · all{" "}
                {design.biomaterials.length} samples assigned
              </span>
            ))}
          </div>
          {softFactors.length > 0 ? (
            <FactorNotes
              factors={softFactors}
              design={design}
              onSelectFactor={onSelectFactor}
              heading="agent flagged"
              noteFor={baselineUncertainNote}
              titleFor={(s) => s.baseline_uncertain_reason}
            />
          ) : null}
          {overfullFactors.length > 0 ? (
            <FactorNotes
              factors={overfullFactors}
              design={design}
              onSelectFactor={onSelectFactor}
              heading="over Gemma's statement limit"
              noteFor={overfullStatementNote}
            />
          ) : null}
          {multiBaselineFactors.length > 0 ? (
            <FactorNotes
              factors={multiBaselineFactors}
              design={design}
              onSelectFactor={onSelectFactor}
              heading="more than one baseline"
              noteFor={(s) => multiBaselineNote(s, design)}
            />
          ) : null}
          {emptyFvFactors.length > 0 ? (
            <FactorNotes
              factors={emptyFvFactors}
              design={design}
              onSelectFactor={onSelectFactor}
              heading="factor value with no samples"
              noteFor={emptyFactorValueNote}
            />
          ) : null}
        </div>
      </div>
    );
  }

  // Empty design — no factors at all. Distinct from "has warnings"
  // (where we'd want to list them). Don't claim validity; render a
  // gentle "no factors yet" prompt so the curator knows where they
  // are in the workflow. Caught 2026-04-29 after a curator
  // accepted-then-rejected a proposal cycle and landed on an empty
  // design that was previously claimed "valid".
  if (state.factors.length === 0) {
    return (
      <div className="card border-slate-200 bg-slate-50/60">
        <div className="px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold">No factors yet.</span>{" "}
          Accept a proposal from the sidebar or add factors manually
          on the Design tab.
        </div>
      </div>
    );
  }
  // Group factors by their issue set so e.g. three blank factors
  // each yelling "no baseline; 12 unassigned" collapse into one
  // bullet listing all three names. Factors with no issues are
  // skipped entirely.
  const groups: { warnings: string[]; factorIds: number[] }[] = [];
  const groupByKey = new Map<string, (typeof groups)[number]>();
  for (const s of state.factors) {
    const warnings = warningsFor(s);
    if (warnings.length === 0) continue;
    const key = warnings.join("|");
    const existing = groupByKey.get(key);
    if (existing) {
      existing.factorIds.push(s.factor_id);
    } else {
      const g = { warnings, factorIds: [s.factor_id] };
      groupByKey.set(key, g);
      groups.push(g);
    }
  }
  return (
    <div className="card border-amber-200 bg-amber-50/40">
      <div className="px-3 py-2 text-xs text-amber-900 space-y-1">
        <div>
          <div className="font-semibold mb-1">⚠ design has warnings</div>
          <ul className="space-y-0.5 list-disc list-inside">
            {groups.map((g, i) => (
              <li key={i}>
                {g.factorIds.map((fid, idx) => {
                  const { label, missing } = displayNameOf(design, fid);
                  const labelEl = (
                    <span
                      className={
                        missing ? "italic text-amber-900/70" : "font-medium"
                      }
                    >
                      {label}
                    </span>
                  );
                  const node = onSelectFactor ? (
                    <button
                      type="button"
                      onClick={() => onSelectFactor(fid)}
                      className="text-left hover:text-amber-950 hover:underline underline-offset-2"
                      title="Jump to this factor"
                    >
                      {labelEl}
                    </button>
                  ) : (
                    labelEl
                  );
                  return (
                    <span key={fid}>
                      {idx > 0 ? ", " : null}
                      {node}
                    </span>
                  );
                })}
                : {g.warnings.join("; ")}
              </li>
            ))}
          </ul>
        </div>
        {softFactors.length > 0 ? (
          <FactorNotes
            factors={softFactors}
            design={design}
            onSelectFactor={onSelectFactor}
            heading="agent flagged"
            noteFor={baselineUncertainNote}
            titleFor={(s) => s.baseline_uncertain_reason}
          />
        ) : null}
        {overfullFactors.length > 0 ? (
          <FactorNotes
            factors={overfullFactors}
            design={design}
            onSelectFactor={onSelectFactor}
            heading="over Gemma's statement limit"
            noteFor={overfullStatementNote}
          />
        ) : null}
        {multiBaselineFactors.length > 0 ? (
          <FactorNotes
            factors={multiBaselineFactors}
            design={design}
            onSelectFactor={onSelectFactor}
            heading="more than one baseline"
            noteFor={(s) => multiBaselineNote(s, design)}
          />
        ) : null}
        {emptyFvFactors.length > 0 ? (
          <FactorNotes
            factors={emptyFvFactors}
            design={design}
            onSelectFactor={onSelectFactor}
            heading="factor value with no samples"
            noteFor={emptyFactorValueNote}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Slate-toned advisory subsection. Signals the curator should
 *  consider but that aren't blocking — read as "consider this"
 *  rather than "fix this", explicitly distinct from the amber
 *  warnings list.
 *
 *  This is the only channel that survives a VALID design: the amber
 *  list renders solely on the ``!ok`` path, so anything routed
 *  through ``warningsFor`` is invisible the moment nothing else is
 *  wrong. Advisories that must be seen regardless belong here.
 *
 *  Was hardwired to the proposer's uncertain-baseline note under an
 *  "agent flagged" heading; parameterized 2026-08-15 when the
 *  over-full statement groups needed the same treatment and were not
 *  agent-flagged. */
function FactorNotes({
  factors,
  design,
  onSelectFactor,
  heading,
  noteFor,
  titleFor,
}: {
  factors: DesignValidationState["factors"];
  design: Design;
  onSelectFactor?: (factorId: number) => void;
  heading: string;
  noteFor: (s: DesignValidationState["factors"][number]) => ReactNode;
  titleFor?: (s: DesignValidationState["factors"][number]) => string;
}) {
  return (
    <div className="pt-1 mt-1 border-t border-slate-200/70 text-slate-600">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
        {heading}
      </div>
      <ul className="space-y-0.5 list-disc list-inside">
        {factors.map((s) => {
          const { label, missing } = displayNameOf(design, s.factor_id);
          const title = titleFor?.(s) ?? "";
          const labelEl = (
            <span
              className={
                missing
                  ? "italic text-slate-500"
                  : "font-medium text-slate-700"
              }
            >
              {label}
            </span>
          );
          const node = onSelectFactor ? (
            <button
              type="button"
              onClick={() => onSelectFactor(s.factor_id)}
              className="text-left hover:text-slate-900 hover:underline underline-offset-2"
              title={title || "Jump to this factor"}
            >
              {labelEl}
            </button>
          ) : (
            <span title={title}>{labelEl}</span>
          );
          return (
            <li key={s.factor_id}>
              {node}: {noteFor(s)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How the valid-design banner states the baseline situation. Three
 *  real cases, and the old copy printed all of them as "1 baseline":
 *  nothing marked but Gemma detects one (the common case — marking is
 *  optional), exactly one marked, and more than one marked (legal, for
 *  a dataset holding two experiments). */
function baselineSummary(s: DesignValidationState["factors"][number]): string {
  if (s.baseline_count === 0) {
    return s.gemma_auto_baseline.length > 0
      ? "baseline detected by Gemma"
      : "no baseline";
  }
  return s.baseline_count === 1
    ? "1 baseline"
    : `${s.baseline_count} baselines`;
}

/** More than one FV marked baseline. Legal, so this asks rather than
 *  scolds — Paul, 2026-08-19: flag it "not as an error, just as a, did
 *  you need to do this?"
 *
 *  It still has to name the consequence, and then the ACTION. Gemma's
 *  DEA throws ``MultipleBaselinesRequireSubsetException`` on a
 *  multi-baseline factor unless a subset factor is configured (gemma
 *  backend, 2026-08-19) — it used to silently pick whichever baseline it
 *  reached first. Per Paul: two baselines "strongly supports that the
 *  curator needs to select a 'subset by' factor". So the note names the
 *  control that does it — the design tab's "Experiment-wide decisions"
 *  pane, whose ``SubsetRecommendationsBlock`` writes exactly this.
 *
 *  And it checks first. An accepted ``SubsetRecommendation`` carrying a
 *  ``by_factor_id`` IS the curator's subset-by choice, so a note that
 *  keeps demanding one after they made it is the nag this channel is
 *  supposed to avoid. (An earlier draft of this claimed the draft
 *  couldn't know — it can; ``subset_recommendations`` rides on the
 *  design.) What it deliberately does NOT claim is that Gemma's own DEA
 *  config is set: this is the curation-side decision that drives it,
 *  not the analysis config itself. */
function multiBaselineNote(
  s: DesignValidationState["factors"][number],
  design: Design,
): ReactNode {
  const accepted = (design.subset_recommendations ?? []).filter(
    (r) => r.status === "accepted" && typeof r.by_factor_id === "number",
  );
  const byFactor = accepted
    .map((r) => design.factors.find((f) => f.id === r.by_factor_id))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => f.name || f.category?.label || `factor ${f.id}`);

  return (
    <>
      {s.baseline_count} values marked baseline — did you need more than
      one?
      <span className="text-slate-500 italic">
        {" "}
        — legitimate when this dataset is really two experiments in one,
        each with its own reference level. Gemma then refuses a
        multiple-baseline contrast rather than picking one, so this
        factor needs a subset before DEA can run.{" "}
        {byFactor.length > 0 ? (
          <>subset by {byFactor.join(", ")} is recorded.</>
        ) : (
          <>
            No subset recorded yet — choose a “subset by” factor under
            Experiment-wide decisions. If it isn’t two experiments, one
            of these marks is probably left over.
          </>
        )}
      </span>
    </>
  );
}

/** The proposer's uncertain-baseline note. */
function baselineUncertainNote(
  s: DesignValidationState["factors"][number],
): ReactNode {
  return (
    <>
      baseline uncertain
      {s.baseline_uncertain_reason ? (
        <span className="text-slate-500 italic">
          {" "}
          — {s.baseline_uncertain_reason}
        </span>
      ) : null}
    </>
  );
}

/** Subjects carrying more predicate/object pairs than Gemma's two
 *  slots hold. The editor no longer lets one be built, so these came
 *  in from an agent proposal or an older snapshot. */
function overfullStatementNote(
  s: DesignValidationState["factors"][number],
): ReactNode {
  const groups = s.overfull_statement_groups;
  const listed = groups
    .slice(0, 3)
    .map((g) => `"${g.subject}" (${g.pairs})`)
    .join(", ");
  return (
    <>
      {groups.length === 1 ? "a subject carries" : `${groups.length} subjects carry`}{" "}
      more than {MAX_STATEMENT_PAIRS} predicate/object pairs — {listed}
      {groups.length > 3 ? ", …" : ""}
      <span className="text-slate-500 italic">
        {" "}
        — Gemma holds two per subject; split the extras into their own
        statements before this design is written back.
      </span>
    </>
  );
}

/** Levels with no samples on them. Not a blocker — a value the curator
 *  added a moment ago and hasn't assigned yet is exactly this shape, and
 *  scolding them mid-build is the nag this channel exists to avoid. It
 *  names the consequence instead, which is downstream and quiet: Gemma
 *  has nothing to contrast at that level, so the level drops out of the
 *  analysis without saying so. */
function emptyFactorValueNote(
  s: DesignValidationState["factors"][number],
): ReactNode {
  const empties = s.empty_factor_values;
  const listed = empties
    .slice(0, 3)
    .map((e) => `"${e.label}"`)
    .join(", ");
  return (
    <>
      {empties.length === 1
        ? "1 value is not assigned to any samples"
        : `${empties.length} values are not assigned to any samples`}{" "}
      — {listed}
      {empties.length > 3 ? ", …" : ""}
      <span className="text-slate-500 italic">
        {" "}
        — an empty level contributes nothing to a differential-expression
        contrast and won't appear in the analysis. Assign samples to it,
        or delete it.
      </span>
    </>
  );
}

function warningsFor(s: DesignValidationState["factors"][number]): string[] {
  const warnings: string[] = [];
  // Silent when Gemma's own detector already reads a baseline off this
  // factor — an unmarked "reference substance role" control, "wild type
  // genotype", or "female" on a sex factor. Marking it changes nothing
  // downstream, so asking is busywork.
  if (
    s.baseline_required &&
    s.baseline_count === 0 &&
    s.gemma_auto_baseline.length === 0
  )
    warnings.push("no baseline marked");
  // More than one marked baseline is deliberately NOT a warning — it is
  // legal, and it is the right answer for a two-experiments-in-one
  // dataset. It surfaces as a slate ``FactorNotes`` row asking whether
  // the curator meant it. See ``multiBaselineNote``.
  if (s.nonstandard_marked_baseline) {
    const { label, standard } = s.nonstandard_marked_baseline;
    warnings.push(
      `baseline is marked "${label}", but Gemma's standard reference here ` +
        `is "${standard}" — an explicit mark overrides it, so check this ` +
        `is deliberate`,
    );
  }
  if (s.unassigned_biomaterials.length > 0)
    warnings.push(`${s.unassigned_biomaterials.length} unassigned`);
  if (s.duplicate_assignments.length > 0)
    warnings.push(
      `${s.duplicate_assignments.length} duplicate assignment(s)`,
    );
  if (s.factor_missing_description)
    warnings.push("no factor description — factors should be described");
  if (s.unknown_predicates > 0)
    warnings.push(
      `${s.unknown_predicates} statement(s) whose predicate isn't a preset ontology term`,
    );
  if (s.statements_missing_category > 0)
    warnings.push(
      `${s.statements_missing_category} statement(s) missing category — will inherit from factor on commit`,
    );
  if (s.deprecated_baseline_fvs.length > 0) {
    const labels = s.deprecated_baseline_fvs
      .map((d) => `"${d.label}"`)
      .join(", ");
    warnings.push(
      `non-canonical baseline term (${labels}) — this IS the baseline and DEA will use it; the guideline just prefers control / wild type genotype / reference subject role / reference substance role / initial time point for new work.`,
    );
  }
  if (s.forbidden_category) {
    warnings.push(s.forbidden_category);
  }
  if (s.ungrounded_categories.length > 0) {
    // Split factor-scope from statement-scope so the message names the
    // right thing. Dedupe labels within each scope.
    const factorLabels = [
      ...new Set(
        s.ungrounded_categories
          .filter((u) => u.scope === "factor")
          .map((u) => u.label),
      ),
    ];
    const stmtLabels = [
      ...new Set(
        s.ungrounded_categories
          .filter((u) => u.scope === "statement")
          .map((u) => u.label),
      ),
    ];
    if (factorLabels.length > 0)
      warnings.push(
        `factor category is free text (${factorLabels
          .map((l) => `"${l}"`)
          .join(", ")}) — must be a grounded ontology term`,
      );
    if (stmtLabels.length > 0)
      warnings.push(
        `statement category is free text (${stmtLabels
          .map((l) => `"${l}"`)
          .join(", ")}) — must be a grounded ontology term`,
      );
  }
  if (s.ontology_violations.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const v of s.ontology_violations) {
      if (!grouped.has(v.rule)) grouped.set(v.rule, []);
      grouped.get(v.rule)!.push(v.label);
    }
    for (const [rule, labels] of grouped) {
      warnings.push(`${rule} (${labels.map((l) => `"${l}"`).join(", ")})`);
    }
  }
  return warnings;
}

function nameOf(design: Design, factorId: number): string {
  return design.factors.find((f) => f.id === factorId)?.name ?? `factor#${factorId}`;
}

/**
 * Like ``nameOf``, but distinguishes an empty-string name from a
 * present one — the curator can add a factor and not name it yet,
 * which renders as a bullet starting with ":". Returns a stable
 * placeholder + a flag the caller uses to italicise.
 */
function displayNameOf(
  design: Design,
  factorId: number,
): { label: string; missing: boolean } {
  const f = design.factors.find((x) => x.id === factorId);
  if (!f) return { label: `factor#${factorId}`, missing: true };
  const trimmed = (f.name || "").trim();
  if (!trimmed) return { label: `(unnamed factor#${factorId})`, missing: true };
  return { label: trimmed, missing: false };
}
