import { useMemo } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { validateDesign } from "@/features/experiment/types";
import { PrePublishChecklist } from "./PrePublishChecklist";
import type { Design, Factor } from "@/features/experiment/types";

/**
 * Design-level diagnostics — summary stats a curator can use to
 * spot-check an experiment before publishing.
 *
 * Out of scope for now: sample-correlation QC, batch-effect
 * detection, outlier flagging. Those need server-side computation
 * over the expression matrix and are noted at the bottom of this
 * panel as deferred.
 */
export function DiagnosticsPanel({ experimentId }: { experimentId: number }) {
  // Read the in-memory draft, not the saved server design — otherwise
  // uncommitted factor adds / FV reassignments don't show up in
  // diagnostics ("factors: 0" while samples are visibly assigned).
  // Mirrors what the rest of the experiment tabs do.
  const { draft: design, isLoading, loadError } = useDesignDraft();

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading diagnostics…</div>
    );
  }
  if (loadError || !design) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load design for experiment {experimentId}:{" "}
        {loadError ?? "unknown"}
      </div>
    );
  }

  return <Body design={design} experimentId={experimentId} />;
}

function Body({
  design,
  experimentId,
}: {
  design: Design;
  experimentId: number;
}) {
  const validation = useMemo(() => validateDesign(design), [design]);

  // Per-factor sample counts and coverage. "Covered" = the union of
  // biomaterials assigned to any FV in this factor (samples can be
  // legitimately unassigned in *some* factors and not others, so
  // factor-by-factor coverage is more useful than a global number).
  const factorStats = useMemo(
    () => design.factors.map((f) => factorStat(f, design.biomaterials.length)),
    [design.factors, design.biomaterials.length],
  );

  // Cohort-level: which characteristic keys vary, which don't.
  const charDist = useMemo(
    () => characteristicDistribution(design),
    [design],
  );

  return (
    <div className="space-y-4">
      <PrePublishChecklist experimentId={experimentId} />

      <ValidationSummary validation={validation} factors={design.factors} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="biomaterials" value={design.biomaterials.length} />
        <StatCard
          label="bio_assays"
          value={design.biomaterials.reduce(
            (n, b) => n + (b.bio_assays?.length ?? 0),
            0,
          )}
          hint="total assays attached across all samples"
        />
        <StatCard label="factors" value={design.factors.length} />
        <StatCard
          label="experiment tags"
          value={design.tags?.length ?? 0}
          hint="experiment-level annotations"
        />
      </div>

      <div className="card">
        <div className="px-3 py-2 border-b border-slate-200">
          <span className="section-h">Per-factor coverage</span>
        </div>
        {factorStats.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500 italic">
            No factors defined.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">factor</th>
                <th className="text-left font-medium px-3 py-1.5">category</th>
                <th className="text-left font-medium px-3 py-1.5 w-16">FVs</th>
                <th className="text-left font-medium px-3 py-1.5 w-24">baseline</th>
                <th className="text-left font-medium px-3 py-1.5 w-32">coverage</th>
                <th className="text-left font-medium px-3 py-1.5">FV distribution</th>
              </tr>
            </thead>
            <tbody>
              {factorStats.map((s) => (
                <tr key={s.factor.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-medium">
                    {s.factor.name || (
                      <span className="italic text-slate-400">(unnamed)</span>
                    )}
                    {s.isContinuous ? (
                      <span
                        className="ml-1.5 inline-block text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded bg-sky-100 text-sky-800"
                        title="continuous factor — one measurement per sample"
                      >
                        cont
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-emerald-800">
                    {s.factor.category.label || (
                      <span className="italic text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{s.factor.factor_values.length}</td>
                  <td className="px-3 py-1.5">
                    {s.isContinuous ? (
                      <span
                        className="text-slate-400 italic"
                        title="baseline doesn't apply to continuous factors"
                      >
                        n/a
                      </span>
                    ) : s.baselineCount === 1 ? (
                      <span className="text-emerald-800">✓ one</span>
                    ) : s.baselineCount === 0 ? (
                      <span className="text-amber-800">missing</span>
                    ) : (
                      <span className="text-amber-800">{s.baselineCount} marked</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        s.coveragePct === 100
                          ? "text-emerald-800"
                          : "text-amber-800"
                      }
                    >
                      {s.assigned} / {s.total} ({s.coveragePct}%)
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {s.isContinuous ? (
                      s.numericSummary ? (
                        <span className="whitespace-nowrap">
                          <span className="text-slate-500">n=</span>
                          <span className="font-medium">
                            {s.numericSummary.n}
                          </span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-500">range </span>
                          <span className="font-medium">
                            {fmtNum(s.numericSummary.min)}–
                            {fmtNum(s.numericSummary.max)}
                          </span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-500">mean </span>
                          <span className="font-medium">
                            {fmtNum(s.numericSummary.mean)}
                          </span>
                          {s.numericSummary.nNonNumeric > 0 ? (
                            <span
                              className="ml-2 text-amber-700"
                              title="FVs whose label didn't parse as a number"
                            >
                              · {s.numericSummary.nNonNumeric} non-numeric
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">
                          no numeric values
                        </span>
                      )
                    ) : (
                      s.fvDist.map((d, i) => (
                        <span key={d.id} className="mr-2 whitespace-nowrap">
                          <span className="text-slate-500">{d.label}:</span>{" "}
                          <span className="font-medium">{d.count}</span>
                          {i < s.fvDist.length - 1 ? "" : null}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="px-3 py-2 border-b border-slate-200">
          <span className="section-h">Characteristics across samples</span>
        </div>
        {charDist.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500 italic">
            No characteristics on any biomaterial.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">key</th>
                <th className="text-left font-medium px-3 py-1.5 w-20">distinct</th>
                <th className="text-left font-medium px-3 py-1.5 w-24">missing</th>
                <th className="text-left font-medium px-3 py-1.5">values (top)</th>
              </tr>
            </thead>
            <tbody>
              {charDist.map((d) => (
                <tr key={d.key} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-mono">{d.key}</td>
                  <td className="px-3 py-1.5">{d.distinctValues}</td>
                  <td className="px-3 py-1.5">
                    {d.missing === 0 ? (
                      <span className="text-emerald-800">none</span>
                    ) : (
                      <span className="text-amber-800">{d.missing}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {d.topValues.map((v) => (
                      <span key={v.value} className="mr-3 whitespace-nowrap">
                        <span className="text-slate-500">{v.value || "(blank)"}:</span>{" "}
                        <span className="font-medium">{v.count}</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-slate-500 mt-1">{hint}</div> : null}
    </div>
  );
}

function ValidationSummary({
  validation,
  factors,
}: {
  validation: ReturnType<typeof validateDesign>;
  factors: Factor[];
}) {
  const factorCount = factors.length;
  if (validation.ok) {
    return (
      <div className="card border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs text-emerald-900">
        <span className="font-semibold">✓ design valid</span>
        {factorCount > 0 ? (
          <span className="ml-2 text-emerald-900/80">
            all {factorCount} factor{factorCount === 1 ? "" : "s"} have a single baseline and full sample coverage
          </span>
        ) : null}
      </div>
    );
  }
  // Per-factor issue list, surfaced inline so the curator can see
  // *why* the validator is amber without switching to the Design
  // tab. Mirrors the FactorValidationState shape from
  // ``validateDesign``.
  const factorRows = factors
    .map((f, i) => ({ factor: f, state: validation.factors[i] }))
    .filter(({ state }) => factorIssueCount(state) > 0);
  const totalIssues = factorRows.reduce(
    (n, { state }) => n + factorIssueCount(state),
    0,
  );
  // Empty-design branch: ``validateDesign`` flips ``ok=false`` when
  // the design has zero factors (so an accept-then-reject doesn't
  // leave a hollow "✓ design valid"). When that's the only reason
  // the validator is amber, ``factorRows`` is empty and totalIssues
  // is 0 — surfacing "⚠ design has 0 issues" reads as nonsense.
  // Render the actual root cause instead.
  if (factorCount === 0) {
    return (
      <div className="card border-amber-200 bg-amber-50/40 px-3 py-2 text-xs text-amber-900 space-y-1">
        <div className="font-semibold">⚠ design has no factors</div>
        <div className="text-amber-900/70 italic">
          Add at least one factor on the Design tab — or accept the
          agent's proposal once it lands.
        </div>
      </div>
    );
  }
  return (
    <div className="card border-amber-200 bg-amber-50/40 px-3 py-2 text-xs text-amber-900 space-y-1.5">
      <div>
        <span className="font-semibold">
          ⚠ design has {totalIssues} issue{totalIssues === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {factorRows.map(({ factor, state }) => (
          <li key={factor.id}>
            <div className="font-medium text-amber-900">
              {factor.name || (
                <span className="italic text-amber-900/70">(unnamed)</span>
              )}
              {factor.category.label ? (
                <span className="ml-1 text-amber-900/70 font-normal">
                  · {factor.category.label}
                </span>
              ) : null}
            </div>
            <ul className="list-disc pl-5 text-amber-900/90 space-y-0.5">
              {factorIssueLines(state).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="text-amber-900/70 italic">
        Resolve on the Design tab.
      </div>
    </div>
  );
}

function factorIssueCount(s: ReturnType<typeof validateDesign>["factors"][number]): number {
  return (
    (s.baseline_required && s.baseline_count !== 1 ? 1 : 0) +
    (s.unassigned_biomaterials.length > 0 ? 1 : 0) +
    (s.duplicate_assignments.length > 0 ? 1 : 0) +
    (s.unknown_predicates > 0 ? 1 : 0) +
    (s.statements_missing_category > 0 ? 1 : 0) +
    (s.deprecated_baseline_fvs.length > 0 ? 1 : 0) +
    (s.ontology_violations.length > 0 ? 1 : 0) +
    (s.forbidden_category != null ? 1 : 0)
  );
}

function factorIssueLines(
  s: ReturnType<typeof validateDesign>["factors"][number],
): string[] {
  const out: string[] = [];
  if (s.baseline_required && s.baseline_count !== 1) {
    out.push(
      s.baseline_count === 0
        ? "no baseline FV marked"
        : `${s.baseline_count} baseline FVs marked — exactly 1 expected`,
    );
  }
  if (s.unassigned_biomaterials.length > 0) {
    out.push(
      `${s.unassigned_biomaterials.length} sample${s.unassigned_biomaterials.length === 1 ? "" : "s"} unassigned`,
    );
  }
  if (s.duplicate_assignments.length > 0) {
    out.push(
      `${s.duplicate_assignments.length} sample${s.duplicate_assignments.length === 1 ? "" : "s"} assigned to multiple FVs`,
    );
  }
  if (s.unknown_predicates > 0) {
    out.push(
      `${s.unknown_predicates} statement${s.unknown_predicates === 1 ? "" : "s"} use predicates outside the curated allow-list`,
    );
  }
  if (s.statements_missing_category > 0) {
    out.push(
      `${s.statements_missing_category} statement${s.statements_missing_category === 1 ? "" : "s"} missing a category`,
    );
  }
  for (const dep of s.deprecated_baseline_fvs) {
    out.push(`deprecated baseline label: "${dep.label}"`);
  }
  for (const v of s.ontology_violations) {
    out.push(`${v.label}: ${v.rule}`);
  }
  if (s.forbidden_category) {
    out.push(s.forbidden_category);
  }
  return out;
}

interface FactorStat {
  factor: Factor;
  isContinuous: boolean;
  baselineCount: number;
  assigned: number;
  total: number;
  coveragePct: number;
  /** Categorical: per-FV sample counts for the distribution column.
   *  Empty for continuous factors — see `numericSummary` instead. */
  fvDist: { id: number; label: string; count: number }[];
  /** Continuous-only: aggregate stats over the per-sample numeric
   *  measurements. ``null`` when the factor is categorical or when
   *  no FV label parsed as a number. */
  numericSummary: {
    n: number;
    nNonNumeric: number;
    min: number;
    max: number;
    mean: number;
  } | null;
}

function factorStat(factor: Factor, totalBiomaterials: number): FactorStat {
  const isContinuous = factor.type === "continuous";
  let baselineCount = 0;
  const assigned = new Set<string>();
  const fvDist: FactorStat["fvDist"] = [];
  const numericValues: number[] = [];
  let nNonNumeric = 0;
  for (const fv of factor.factor_values) {
    if (fv.is_baseline) baselineCount++;
    for (const sn of fv.biomaterial_short_names) assigned.add(sn);
    if (isContinuous) {
      // Continuous FVs carry one measurement each. ``free_text_label``
      // is the canonical string form; subject.label is the fallback
      // when the proposer wrote the number into the statement.
      const raw =
        fv.free_text_label || fv.statements?.[0]?.subject?.label || "";
      const n = Number(raw);
      if (Number.isFinite(n)) numericValues.push(n);
      else if (raw !== "") nNonNumeric++;
    } else {
      fvDist.push({
        id: fv.id,
        label: fv.free_text_label || `FV ${fv.id}`,
        count: fv.biomaterial_short_names.length,
      });
    }
  }
  fvDist.sort((a, b) => b.count - a.count);
  const coveragePct =
    totalBiomaterials === 0
      ? 0
      : Math.round((assigned.size / totalBiomaterials) * 100);
  const numericSummary =
    isContinuous && numericValues.length > 0
      ? {
          n: numericValues.length,
          nNonNumeric,
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          mean:
            numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
        }
      : null;
  return {
    factor,
    isContinuous,
    baselineCount,
    assigned: assigned.size,
    total: totalBiomaterials,
    coveragePct,
    fvDist,
    numericSummary,
  };
}

/** Compact numeric formatter for the continuous-factor summary.
 *  Integers render bare; non-integers get up to 3 sig-figs so a
 *  range like "0.123–87.4" doesn't blow up to a decimal wall. */
function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x)) return String(x);
  return Number(x.toPrecision(3)).toString();
}

function characteristicDistribution(
  design: Design,
): { key: string; distinctValues: number; missing: number; topValues: { value: string; count: number }[] }[] {
  const seen: string[] = [];
  const valuesByKey = new Map<string, Map<string, number>>();
  for (const b of design.biomaterials) {
    const seenThisRow = new Set<string>();
    for (const [k, v] of Object.entries(b.characteristics ?? {})) {
      seenThisRow.add(k);
      if (!valuesByKey.has(k)) {
        valuesByKey.set(k, new Map());
        seen.push(k);
      }
      const m = valuesByKey.get(k)!;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  const total = design.biomaterials.length;
  return seen.map((k) => {
    const m = valuesByKey.get(k)!;
    const entries = Array.from(m.entries()).sort(
      ([, a], [, b]) => b - a,
    );
    const populated = entries.reduce((n, [, c]) => n + c, 0);
    return {
      key: k,
      distinctValues: m.size,
      missing: total - populated,
      topValues: entries.slice(0, 6).map(([value, count]) => ({ value, count })),
    };
  });
}

