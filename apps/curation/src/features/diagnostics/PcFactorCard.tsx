/**
 * PC × factor association — curator-side wrapper. Math + bars live in
 * @gemma/diagnostics; this wrapper joins the SVD result against the
 * curator's in-memory design draft (biomaterial short_name keyed) and
 * passes the neutral inputs into the shared computePcFactorAssociations.
 *
 * The choice of short_name as the sample key is curation-specific —
 * the draft tracks biomaterials by short_name across edits — and is
 * why the wrapper, not the shared helper, owns the join. The browser
 * wrapper uses bioMaterialId for the same reason.
 */

import { useMemo, useState } from "react";
import {
  PanelCard,
  PanelEmpty,
  PanelLoading,
  PanelError,
  PcFactorBars,
  PcValuePlot,
  type PcValuePoint,
  computePcFactorAssociations,
  type AssocFactor,
  type CategoricalLevel,
  type ContinuousLevel,
} from "@gemma/diagnostics";
import { useDatasetSvd, bioAssayScoresFromSvd, useScanDates } from "@/api/diagnostics";
import { useEscapeKey } from "@gemma/ui";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { continuousFvValue } from "./heatmapPayload";
import type { Design } from "@/features/experiment/types";

const N_PCS = 3;

/** The scan-date factor's label. Exported-by-constant rather than
 *  matched as a string in two places: the dialog formats this one's
 *  axis as dates, and a typo would silently show epoch milliseconds. */
const DATE_RUN_LABEL = "Date run";

export function PcFactorCard({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: svd, isLoading, error } = useDatasetSvd(experimentId);
  const { draft } = useDesignDraft();
  const { data: scanDates } = useScanDates(experimentId);

  // The factors AND the per-sample inputs, from one pass — the bars
  // state an association and the pop-out shows the samples behind it,
  // so both must come from the same numbers or the plot would be
  // arguing with the bar above it.
  const { rows, assocFactors, samples } = useMemo(() => {
    const scores = bioAssayScoresFromSvd(svd);
    if (!scores || !draft) {
      return { rows: null, assocFactors: [] as AssocFactor[], samples: null };
    }
    const norm = normaliseCurationDraft(scores, draft);
    const dateRun = scanDateFactor(draft, scanDates);
    const factors = dateRun ? [...norm.factors, dateRun] : norm.factors;
    return {
      // `computePcFactorAssociations` drops a factor that scores zero on
      // every component, so the bars and `factors` can differ in length
      // — the pop-out looks its factor up by LABEL, not by index.
      rows: computePcFactorAssociations(norm.samples, factors, N_PCS),
      assocFactors: factors,
      samples: norm.samples,
    };
  }, [svd, draft, scanDates]);

  /** Which bar was opened: its factor label and the 1-based component. */
  const [detail, setDetail] = useState<{ label: string; pc: number } | null>(
    null,
  );

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!svd?.vmatrix || !svd?.bio_assay_ids) {
    body = (
      <PanelEmpty reason="No PCA available — PC↔factor associations need /svd to return bioAssayScores. Check the scree panel for the root cause." />
    );
  } else if (!draft || draft.factors.length === 0) {
    body = (
      <PanelEmpty reason="No factors defined yet. Accept the agent's proposal or add factors on the Design tab." />
    );
  } else if (!rows || rows.length === 0) {
    body = (
      <PanelEmpty reason="No factor assignments overlap with bio-assays in the SVD." />
    );
  } else {
    body = (
      <PcFactorBars
        rows={rows}
        nPcs={N_PCS}
        onBarClick={(i, pc) => setDetail({ label: rows[i].label, pc })}
      />
    );
  }

  return (
    <PanelCard
      title="PC × factor"
      footer={
        <span>
          top {N_PCS} PCs · rank correlation, as Gemma computes it · click a
          bar for the samples
        </span>
      }
    >
      {body}
      {detail ? (
        <PcValueDialog
          detail={detail}
          factors={assocFactors}
          samples={samples}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </PanelCard>
  );
}

/** Adapt the curator's in-memory design draft into the neutral input
 *  shape `computePcFactorAssociations` accepts. Sample-keys are
 *  biomaterial short_names — the draft's stable identifier across
 *  edits. The bio_assay_id → short_name resolution walks
 *  design.biomaterials[].bio_assays[]. */
function normaliseCurationDraft(
  bioAssayScores: Record<string, number[]>,
  design: Design,
): { samples: Map<string, number[]>; factors: AssocFactor[] } {
  // short_name → PC scores (averaged across multiple bioAssays
  // sharing a biomaterial, as in multi-array studies).
  const samples = new Map<string, number[]>();
  for (const bm of design.biomaterials) {
    for (const ba of bm.bio_assays ?? []) {
      // No cast: `bio_assay_id` is on the BioAssay type now. It used to
      // be read through one, which is part of why nobody noticed the
      // field was never populated in remote mode — a cast makes an
      // absent field look like a present one the compiler cannot see.
      const baId = ba.bio_assay_id;
      if (baId == null) continue;
      const scores = bioAssayScores[String(baId)];
      if (scores) {
        samples.set(bm.short_name, scores);
        break;
      }
    }
  }

  const factors: AssocFactor[] = design.factors.map((factor) => {
    const label = factor.name || factor.category.label || "(factor)";
    if (factor.type === "continuous") {
      const levels: ContinuousLevel[] = factor.factor_values.map((fv) => ({
        // Shared with the heatmap's strips — see `continuousFvValue`.
        // NaN for an unfilled value, which `computePcFactorAssociations`
        // drops, so an empty continuous factor contributes nothing
        // rather than a column of zeros.
        x: continuousFvValue(fv) ?? NaN,
        sampleKeys: fv.biomaterial_short_names,
      }));
      return { label, type: "continuous", levels };
    }
    // Gemma codes a level by its factor-value id; a draft value does
    // not reliably carry one, so its position in the factor stands in.
    // Both are arbitrary orderings of an unordered factor, and the
    // Kruskal–Wallis branch inside the statistic is what catches the
    // case where the ordering carries no signal.
    const levels: CategoricalLevel[] = factor.factor_values.map((fv, i) => ({
      sampleKeys: fv.biomaterial_short_names,
      code: i,
      label:
        fv.free_text_label ||
        fv.statements?.[0]?.subject?.label ||
        `level ${i + 1}`,
    }));
    return { label, type: "categorical", levels };
  });

  return { samples, factors };
}

/**
 * "Date run" as a continuous factor: one level per sample, its `x` the
 * scan timestamp. Gemma 1.0 carried this row and it is often the
 * strongest thing on the chart — on GSE143419 it reads 0.72 against
 * PC3 — because a component that tracks the order samples went through
 * the scanner is a processing artefact, not biology.
 *
 * Returns null when no assay reports a date, so the row is absent
 * rather than flat.
 */
function scanDateFactor(
  design: Design,
  scanDates: Map<number, number> | undefined,
): AssocFactor | null {
  if (!scanDates || scanDates.size === 0) return null;
  const levels: ContinuousLevel[] = [];
  for (const bm of design.biomaterials) {
    for (const ba of bm.bio_assays ?? []) {
      const t = ba.bio_assay_id == null ? undefined : scanDates.get(ba.bio_assay_id);
      if (t == null) continue;
      levels.push({ x: t, sampleKeys: [bm.short_name] });
      break;
    }
  }
  if (levels.length < 2) return null;
  return { label: DATE_RUN_LABEL, type: "continuous", levels };
}


/**
 * The samples behind one bar — value against component score.
 *
 * 🛑 Looked up by LABEL, not by bar index.
 * `computePcFactorAssociations` drops a factor that scores zero on
 * every component, so the bars and the factor list can differ in
 * length and an index would silently open the wrong factor.
 */
function PcValueDialog({
  detail,
  factors,
  samples,
  onClose,
}: {
  detail: { label: string; pc: number };
  factors: AssocFactor[];
  samples: Map<string, number[]> | null;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);
  const factor = factors.find((f) => f.label === detail.label);
  const isDate = detail.label === DATE_RUN_LABEL;
  const pointsFor = useMemo(() => {
    return (pc: number): PcValuePoint[] => {
      if (!factor || !samples) return [];
      const out: PcValuePoint[] = [];
      factor.levels.forEach((lvl, i) => {
        const asContinuous = factor.type === "continuous";
        const x = asContinuous ? (lvl as { x: number }).x : undefined;
        for (const key of lvl.sampleKeys) {
          const scores = samples.get(key);
          const y = scores?.[pc - 1];
          if (typeof y !== "number" || !Number.isFinite(y)) continue;
          out.push({
            y,
            label: key,
            ...(asContinuous
              ? { x }
              : { group: (lvl as { label?: string }).label ?? `level ${i + 1}` }),
          });
        }
      });
      return out;
    };
  }, [factor, samples]);
  const nSamples = pointsFor(detail.pc).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded shadow-lg w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {detail.label} × PC1–3
            <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
              · {nSamples} samples ·{" "}
              {factor?.type === "continuous"
                ? "value against component score"
                : "component score by level, median marked"}
            </span>
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </div>
        {/* 🛑 One plot per component, not just the bar that was
            clicked. Gemma 1.0 showed three, and the comparison IS the
            diagnostic — a factor that tracks PC1 and nothing else reads
            very differently from one that tracks all three. Paul,
            2026-09-02: *"the plots don't have to be large. The points
            have to be."* */}
        <div className="p-3 grid grid-cols-3 gap-2 overflow-auto">
          {[1, 2, 3].map((pc) => (
            <div
              key={pc}
              className={
                "h-[300px] rounded " +
                (pc === detail.pc
                  ? "ring-1 ring-blue-400 dark:ring-blue-500"
                  : "")
              }
            >
              <PcValuePlot
                points={pointsFor(pc)}
                kind={factor?.type === "continuous" ? "continuous" : "categorical"}
                // x is the FACTOR's value; the component is the y
                // axis and the ring says which one was clicked.
                xLabel={detail.label}
                yLabel={`PC${pc} score`}
                xFormat={isDate ? fmtDate : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


/** Epoch milliseconds as a date. An axis reading `1172680000000` is a
 *  number nobody can read as a scan date, which is the entire point of
 *  correlating against it. */
function fmtDate(v: number): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}
