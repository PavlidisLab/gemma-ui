/**
 * PC ↔ factor association panel. Grouped bars: one group per factor,
 * three bars per group (PC1 / PC2 / PC3, darkest → lightest blue).
 * Replicates the legacy Gemma ExtJS "PCA+Factors" panel — same bar
 * grouping convention but with the flat palette.
 *
 * Computed client-side from /svd (bioAssayScores) + the design
 * draft (per-biomaterial factor assignments). For categorical
 * factors we use η² (variance explained, ratio of between-group SS
 * to total SS) so the bars are in [0, 1] and comparable across
 * factors. For continuous factors we use |Pearson r| (also [0, 1]).
 *
 * Why client-side: the numbers are tiny (≤20 PCs × ≤10 factors); a
 * server roundtrip + new endpoint is overkill. If bro ever caches
 * these in PCAAnalysis, we can switch the data source without
 * changing the render.
 */

import { useMemo } from "react";
import { PanelCard, PanelEmpty, PanelLoading, PanelError } from "./PanelCard";
import { useDatasetSvd, bioAssayScoresFromSvd } from "@/api/diagnostics";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import type { Design, Factor } from "@/features/experiment/types";

const PC_COLORS = ["#1e3a8a", "#3b82f6", "#93c5fd"]; // blue-900 / 500 / 300
const TEXT = "#1f2937";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";

const N_PCS = 3;

export function PcFactorCard({ experimentId }: { experimentId: number | string }) {
  const { data: svd, isLoading, error } = useDatasetSvd(experimentId);
  const { draft } = useDesignDraft();

  const rows = useMemo(() => {
    const scores = bioAssayScoresFromSvd(svd);
    if (!scores || !draft) return null;
    return computePcFactorAssociations(scores, draft, N_PCS);
  }, [svd, draft]);

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
    body = <PanelEmpty reason="No factor assignments overlap with bio-assays in the SVD." />;
  } else {
    body = <PcFactorBars rows={rows} />;
  }

  return (
    <PanelCard title="PC × factor" footer={<span>top {N_PCS} PCs · η² for categorical, |r| for continuous</span>}>
      {body}
    </PanelCard>
  );
}

interface PcFactorRow {
  factor: Factor;
  /** Per-PC association strength in [0, 1]. */
  values: number[];
}

function PcFactorBars({ rows }: { rows: PcFactorRow[] }) {
  const W = 220;
  const H = 180;
  const padL = 22;
  const padR = 6;
  const padT = 8;
  const padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupGap = 4;
  const groupW = (innerW - groupGap * (rows.length - 1)) / rows.length;
  const barGap = 1;
  const barW = (groupW - barGap * (N_PCS - 1)) / N_PCS;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={padL + innerW}
            y1={padT + innerH * (1 - t)}
            y2={padT + innerH * (1 - t)}
            stroke={GRID}
            strokeWidth={0.5}
          />
          <text
            x={padL - 3}
            y={padT + innerH * (1 - t) + 3}
            fontSize={7}
            fill={SUBTLE}
            textAnchor="end"
            fontFamily="-apple-system, sans-serif"
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {rows.map((r, gi) => {
        const gx = padL + gi * (groupW + groupGap);
        return (
          <g key={gi}>
            {r.values.map((v, pi) => {
              const x = gx + pi * (barW + barGap);
              const h = innerH * Math.min(1, Math.max(0, v));
              return (
                <rect
                  key={pi}
                  x={x}
                  y={padT + innerH - h}
                  width={barW}
                  height={h}
                  fill={PC_COLORS[pi]}
                >
                  <title>
                    {`${r.factor.name || r.factor.category.label}: PC${pi + 1} = ${v.toFixed(3)}`}
                  </title>
                </rect>
              );
            })}
            <text
              x={gx + groupW / 2}
              y={padT + innerH + 10}
              fontSize={7}
              fill={TEXT}
              textAnchor="middle"
              fontFamily="-apple-system, sans-serif"
              transform={`rotate(-25 ${gx + groupW / 2} ${padT + innerH + 10})`}
            >
              {truncate(r.factor.name || r.factor.category.label || "(factor)", 14)}
            </text>
          </g>
        );
      })}
      <text
        x={6}
        y={padT + innerH / 2}
        fontSize={7.5}
        fill={TEXT}
        textAnchor="middle"
        transform={`rotate(-90 6 ${padT + innerH / 2})`}
        fontFamily="-apple-system, sans-serif"
      >
        association
      </text>
      {/* Legend */}
      <g>
        {PC_COLORS.map((c, i) => (
          <g key={i}>
            <rect
              x={padL + i * 38}
              y={H - 8}
              width={8}
              height={5}
              fill={c}
            />
            <text
              x={padL + i * 38 + 10}
              y={H - 4}
              fontSize={7}
              fill={TEXT}
              fontFamily="-apple-system, sans-serif"
            >
              PC{i + 1}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * For each factor + each PC, compute either:
 *   - η² (eta-squared) for categorical factors: between-group SS /
 *     total SS over the per-sample PC scores
 *   - |Pearson r| for continuous factors
 *
 * Both metrics are in [0, 1] so the bars are comparable across
 * factors. Samples that don't appear in `bioAssayScores` are
 * dropped from that factor's row (the SVD may be over a filtered
 * subset).
 */
function computePcFactorAssociations(
  bio_assay_scores: Record<string, number[]>,
  design: Design,
  nPcs: number,
): PcFactorRow[] {
  // Lookup table: biomaterial short_name → array of (PC scores).
  // The SVD is keyed by bioAssayId. We need short_name → bioAssayId
  // resolution via design.biomaterials[].bio_assays[].
  const shortNameToScores = new Map<string, number[]>();
  for (const bm of design.biomaterials) {
    for (const ba of bm.bio_assays ?? []) {
      // Different Gemma payload shapes carry the id key under
      // different names. Probe the most likely fields.
      const baId =
        (ba as { id?: number | string }).id ??
        (ba as { bio_assay_id?: number | string }).bio_assay_id;
      if (baId == null) continue;
      const scores = bio_assay_scores[String(baId)];
      if (scores) {
        shortNameToScores.set(bm.short_name, scores);
        break;
      }
    }
  }

  const out: PcFactorRow[] = [];
  for (const factor of design.factors) {
    const values: number[] = [];
    if (factor.type === "continuous") {
      // Continuous: |Pearson r| between FV numeric value and PC score.
      // FV labels are the per-sample numbers; statements may carry them
      // under subject.label too. We try free_text_label first.
      const samples: { score: number[]; x: number }[] = [];
      for (const fv of factor.factor_values) {
        const raw =
          fv.free_text_label || fv.statements?.[0]?.subject?.label || "";
        const x = Number(raw);
        if (!Number.isFinite(x)) continue;
        for (const sn of fv.biomaterial_short_names) {
          const score = shortNameToScores.get(sn);
          if (score) samples.push({ score, x });
        }
      }
      for (let pc = 0; pc < nPcs; pc++) {
        const xs = samples.map((s) => s.x);
        const ys = samples.map((s) => s.score[pc] ?? 0);
        values.push(Math.abs(pearson(xs, ys)));
      }
    } else {
      // Categorical: η² = SS_between / SS_total.
      const groups = new Map<number, number[][]>(); // fv idx → per-PC arrays
      factor.factor_values.forEach((fv, fvIdx) => {
        const arr: number[][] = Array.from({ length: nPcs }, () => []);
        for (const sn of fv.biomaterial_short_names) {
          const score = shortNameToScores.get(sn);
          if (!score) continue;
          for (let pc = 0; pc < nPcs; pc++) {
            arr[pc].push(score[pc] ?? 0);
          }
        }
        groups.set(fvIdx, arr);
      });
      for (let pc = 0; pc < nPcs; pc++) {
        const allScores: number[] = [];
        for (const arr of groups.values()) allScores.push(...arr[pc]);
        const grand = mean(allScores);
        let ssTotal = 0;
        for (const s of allScores) ssTotal += (s - grand) ** 2;
        let ssBetween = 0;
        for (const arr of groups.values()) {
          if (arr[pc].length === 0) continue;
          const gm = mean(arr[pc]);
          ssBetween += arr[pc].length * (gm - grand) ** 2;
        }
        values.push(ssTotal > 0 ? Math.min(1, ssBetween / ssTotal) : 0);
      }
    }
    out.push({ factor, values });
  }
  return out;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
