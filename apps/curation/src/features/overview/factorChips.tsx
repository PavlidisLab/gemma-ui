/**
 * Factor chips for the Overview header, and the tooltip bodies they
 * share with the Design card's crosstab cells.
 *
 * Extracted from ``OverviewPanel.tsx`` 2026-08-09. ``DesignSummary``
 * pulls ``FvCellTooltipBody`` from here — that shared edge is why this
 * family became its own module rather than travelling with either
 * caller. Pure move.
 */
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { shortenUri } from "@/lib/curie";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import type { Factor, FactorValue, OntologyTerm } from "@/features/experiment/types";
/** Compact factor chips for the overview header — one small sky-tinted
 *  card per factor. Mirrors the audit sidebar's factor-card tint so
 *  curator and non-curator views read the same "this is a factor"
 *  signal. Clicking jumps to the Design tab with that factor focused.
 *
 *  Renders one row positioned right after ``sample source`` in the
 *  TagBar so the structural design surface is visible alongside the
 *  tag annotations. Per design review 2026-05-21: factors used to render
 *  somewhere in the overview area as blue cards; this restores them
 *  as a dedicated row below SAMPLE SOURCE.
 */
export function FactorsRow({
  factors,
  experimentId,
}: {
  factors: Factor[];
  experimentId: number | string;
}) {
  if (factors.length === 0) return null;
  return (
    <div className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5">
      <span
        className="text-[10px] uppercase tracking-wide text-slate-500 mr-1 min-w-[5.5rem]"
        title="experimental design factors — categorical axes of the study"
      >
        factors
      </span>
      {factors.map((f) => (
        <FactorChip key={f.id} factor={f} experimentId={experimentId} />
      ))}
    </div>
  );
}

/** Rich tooltip body for a FactorChip hover. Categorical factors
 *  get a bulleted FV list (baselines sorted to the END); continuous
 *  factors get a numeric range or sample-count summary. Rendered
 *  through the styled ``Tooltip`` portal — small enough to scan, big
 *  enough to enumerate a 6-level cohort without overflow. */
export function FactorChipTooltipBody({ factor }: { factor: Factor }) {
  const label = factor.category?.label || factor.name || "factor";
  const fvs = factor.factor_values ?? [];
  const isContinuous = factor.type === "continuous";

  let rangeText: string | null = null;
  if (isContinuous && fvs.length > 0) {
    const numericVals = fvs
      .map((fv) => Number((fv.free_text_label || "").trim()))
      .filter((n) => Number.isFinite(n));
    if (numericVals.length > 0) {
      const lo = Math.min(...numericVals);
      const hi = Math.max(...numericVals);
      rangeText =
        lo === hi
          ? `value ${lo} · ${numericVals.length} samples`
          : `range ${lo} – ${hi} · ${fvs.length} samples`;
    } else {
      rangeText = `${fvs.length} sample value${fvs.length === 1 ? "" : "s"}`;
    }
  }

  const sortedFvs = isContinuous
    ? []
    : [...fvs].sort(
        (a, b) => (a.is_baseline ? 1 : 0) - (b.is_baseline ? 1 : 0),
      );

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold text-sky-300">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          {isContinuous
            ? "continuous"
            : `${fvs.length} level${fvs.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {rangeText ? (
        <div className="text-[11px] text-slate-200 font-mono">{rangeText}</div>
      ) : null}
      {sortedFvs.length > 0 ? (
        <ul className="space-y-0.5">
          {sortedFvs.map((fv) => {
            const lab = (fv.free_text_label || "").trim() || "(unlabeled)";
            const n = fv.biomaterial_short_names?.length ?? 0;
            return (
              <li
                key={fv.id}
                className="flex items-baseline gap-1.5 text-[11px]"
              >
                <span
                  className={cn(
                    "w-2.5 inline-block text-center shrink-0 leading-none",
                    fv.is_baseline
                      ? "text-amber-400"
                      : "text-sky-300/80 dark:text-sky-400/80",
                  )}
                  title={
                    fv.is_baseline
                      ? "baseline (reference level)"
                      : "factor level"
                  }
                >
                  {fv.is_baseline ? "▂" : "○"}
                </span>
                <span className="flex-1 min-w-0 break-words">{lab}</span>
                {n > 0 ? (
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {n}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="text-[10px] text-slate-400 italic pt-0.5">
        Click to focus in the Design tab →
      </div>
    </div>
  );
}

/** Compact ontology-vs-free-text term span for the FV-cell hover.
 *  Grounded terms (with a URI) render emerald with their CURIE; free
 *  text renders italic slate — the same convention the tag chips use,
 *  so "annotated with an ontology term" reads identically everywhere. */
export function FvTermSpan({ term }: { term?: OntologyTerm | null }) {
  if (!term?.label) return null;
  const uri = term.uri || null;
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={uri ? "text-emerald-300 font-medium" : "italic text-slate-300"}>
        {term.label}
      </span>
      {uri ? (
        <span className="font-mono text-[9px] text-emerald-400/70">
          {shortenUri(uri)}
        </span>
      ) : null}
    </span>
  );
}

/** Rich hover for a Design-summary FV cell: the factor value's actual
 *  curation — its statements as subject · predicate · object, which
 *  terms are ontology-anchored (CURIE) vs free text, the baseline flag,
 *  and the sample count. Lets a curator judge the curation state
 *  (grounded? structured?) from the overview without opening the Design
 *  tab (design review 2026-07-20). Rendered through the dark ``Tooltip`` portal,
 *  same as ``FactorChipTooltipBody``. */
export function FvCellTooltipBody({ factor, fv }: { factor: Factor; fv: FactorValue }) {
  const label = (fv.free_text_label || "").trim() || "(unlabelled FV)";
  const n = fv.biomaterial_short_names?.length ?? 0;
  const statements = fv.statements ?? [];
  const catLabel = factor.category?.label || factor.name || "factor";
  return (
    <div className="space-y-1.5 max-w-[24rem]">
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold text-sky-300 break-words">{label}</span>
        {fv.is_baseline ? (
          <span className="text-[9px] uppercase tracking-wide text-amber-400">
            baseline
          </span>
        ) : null}
        {n > 0 ? (
          <span className="text-[10px] text-slate-400 font-mono ml-auto shrink-0">
            {n} sample{n === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {catLabel}
      </div>
      {statements.length > 0 ? (
        <ul className="space-y-1">
          {statements.map((s, i) => (
            <li key={i} className="text-[11px] flex flex-wrap items-baseline gap-1">
              <FvTermSpan term={s.subject} />
              {s.predicate?.label ? (
                <span className="font-mono text-[9px] text-slate-400">
                  · {s.predicate.label} ·
                </span>
              ) : null}
              <FvTermSpan term={s.object} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[11px] italic text-slate-300">
          no structured statements — free-text value
        </div>
      )}
    </div>
  );
}

export function FactorChip({
  factor,
  experimentId,
}: {
  factor: Factor;
  experimentId: number | string;
}) {
  const label = factor.category?.label || factor.name || "factor";
  const fvCount = factor.factor_values?.length ?? 0;
  const isContinuous = factor.type === "continuous";
  return (
    <Tooltip label={<FactorChipTooltipBody factor={factor} />}>
      <button
        type="button"
        onClick={() =>
          // Jump to the Design tab and focus this factor — reuses
          // the audit-focus event channel so the Shell handles tab
          // switch + scroll-into-view + ring-flash.
          requestAuditFocus(experimentId, `factor:${label.toLowerCase()}`)
        }
        className={cn(
          "inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border text-[11px]",
          "bg-sky-50 border-sky-300 text-sky-900",
          "dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100",
          "hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors",
        )}
      >
        <span className="font-medium">{label}</span>
        <span className="text-[10px] text-sky-700/80 dark:text-sky-300/80">
          {isContinuous ? "cont." : `(${fvCount})`}
        </span>
      </button>
    </Tooltip>
  );
}

