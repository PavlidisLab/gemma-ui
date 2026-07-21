import type { Design, DesignValidationState } from "@/features/experiment/types";

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

  if (state.ok) {
    return (
      <div className="rounded-lg border bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700/60">
        <div className="px-3 py-2 text-xs text-emerald-900 space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold">✓ design valid</span>
            {state.factors.map((s) => (
              <span key={s.factor_id}>
                {nameOf(design, s.factor_id)}: 1 baseline · all{" "}
                {design.biomaterials.length} samples assigned
              </span>
            ))}
          </div>
          {softFactors.length > 0 ? (
            <SoftFactorNotes
              softFactors={softFactors}
              design={design}
              onSelectFactor={onSelectFactor}
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
          <SoftFactorNotes
            softFactors={softFactors}
            design={design}
            onSelectFactor={onSelectFactor}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Slate-toned "agent flagged" subsection. Used for soft signals
 *  the proposer emitted (uncertain-baseline factors, today) that
 *  the curator should consider but that aren't blocking. Read as
 *  "consider this" rather than "fix this" — explicitly distinct
 *  from the amber warnings list. */
function SoftFactorNotes({
  softFactors,
  design,
  onSelectFactor,
}: {
  softFactors: DesignValidationState["factors"];
  design: Design;
  onSelectFactor?: (factorId: number) => void;
}) {
  return (
    <div className="pt-1 mt-1 border-t border-slate-200/70 text-slate-600">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
        agent flagged
      </div>
      <ul className="space-y-0.5 list-disc list-inside">
        {softFactors.map((s) => {
          const { label, missing } = displayNameOf(design, s.factor_id);
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
              title={s.baseline_uncertain_reason || "Jump to this factor"}
            >
              {labelEl}
            </button>
          ) : (
            <span title={s.baseline_uncertain_reason}>{labelEl}</span>
          );
          return (
            <li key={s.factor_id}>
              {node}: baseline uncertain
              {s.baseline_uncertain_reason ? (
                <span className="text-slate-500 italic">
                  {" "}
                  — {s.baseline_uncertain_reason}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function warningsFor(s: DesignValidationState["factors"][number]): string[] {
  const warnings: string[] = [];
  if (s.baseline_required && s.baseline_count === 0)
    warnings.push("no baseline marked");
  if (s.baseline_required && s.baseline_count > 1)
    warnings.push(`${s.baseline_count} baselines marked (should be 1)`);
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
      `deprecated baseline term used (${labels}) — Gemma's DEA will not auto-pick this. Use control / wild type genotype / reference subject role / reference substance role / initial time point.`,
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
