/**
 * PCA scree panel — bar chart of fraction-of-variance per PC.
 * Replicates the legacy Gemma ExtJS scree but with the Pavlab-flat
 * palette (blue ACCENT instead of the old coral) and click-to-zoom
 * into the top-loaded-gene heatmap for any PC.
 *
 * Click handler:
 *   - clicking a bar opens a popup with a heatmap of the top-N
 *     gene loadings on that PC, rendered via the shared @gemma/
 *     heatmap widget. Popup waits on /svd/loadings?pc=… — see the
 *     diagnostics endpoint handoff.
 */

import { useMemo, useState } from "react";
import { HeatmapWidget } from "@gemma/heatmap";
import type { HeatmapData } from "@gemma/heatmap";
import { PanelCard, PanelEmpty, PanelLoading, PanelError } from "./PanelCard";
import {
  useDatasetSvd,
  usePcLoadings,
  type PcLoadings,
} from "@/api/diagnostics";

const ACCENT = "#2563eb";
const ACCENT_HOVER = "#1d4ed8";
const SUBTLE = "#6b7280";
const GRID = "#e5e7eb";
const TEXT = "#1f2937";

const MAX_BARS = 10;

export function PcaScreeCard({ experimentId }: { experimentId: number }) {
  const { data, isLoading, error } = useDatasetSvd(experimentId);
  const [openPc, setOpenPc] = useState<number | null>(null);

  let body;
  if (isLoading) {
    body = <PanelLoading />;
  } else if (error) {
    body = <PanelError message={(error as Error).message} />;
  } else if (!data || !data.variances || data.variances.length === 0) {
    body = (
      <PanelEmpty reason="No PCA available (HTTP 404 or empty variances). Either this dataset's SVDResult hasn't been computed, or the dataset has too few samples." />
    );
  } else {
    body = (
      <ScreeChart
        variances={data.variances}
        onBarClick={(pc) => setOpenPc(pc)}
      />
    );
  }

  return (
    <>
      <PanelCard
        title="PCA scree"
        footer={
          data?.variances ? (
            <>
              <span>
                click a bar → top-loaded genes on that PC
              </span>
              <span className="ml-auto">
                <a
                  href={`/rest/v2/datasets/${experimentId}/svd`}
                  className="text-blue-700 dark:text-blue-300 hover:underline"
                  download
                  title="raw SVD JSON (eigenvalues + per-PC scores)"
                >
                  download eigengenes ↓
                </a>
              </span>
            </>
          ) : null
        }
      >
        {body}
      </PanelCard>
      {openPc !== null ? (
        <PcLoadingsPopup
          experimentId={experimentId}
          pc={openPc}
          onClose={() => setOpenPc(null)}
        />
      ) : null}
    </>
  );
}

function ScreeChart({
  variances,
  onBarClick,
}: {
  variances: number[];
  onBarClick: (pc: number) => void;
}) {
  const shown = variances.slice(0, MAX_BARS);
  // SVG geometry: 220x180 viewBox, fluid via preserveAspectRatio.
  const W = 220;
  const H = 180;
  const padL = 26;
  const padR = 6;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...shown, 0.05);
  const barGap = 2;
  const barW = (innerW - barGap * (shown.length - 1)) / shown.length;
  // Y-axis ticks at nice fractions.
  const yTicks = niceTicks(0, max, 4);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      {/* Y gridlines + tick labels */}
      {yTicks.map((t) => {
        const y = padT + innerH * (1 - t / max);
        return (
          <g key={t}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth={0.5}
            />
            <text
              x={padL - 3}
              y={y + 3}
              fontSize={7}
              fill={SUBTLE}
              textAnchor="end"
              fontFamily="-apple-system, sans-serif"
            >
              {fmtPct(t)}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {shown.map((v, i) => {
        const x = padL + i * (barW + barGap);
        const barH = innerH * (v / max);
        const y = padT + innerH - barH;
        return (
          <g
            key={i}
            className="cursor-pointer"
            onClick={() => onBarClick(i + 1)}
          >
            <title>
              {`PC${i + 1}: ${(v * 100).toFixed(1)}% variance — click for top-loaded genes`}
            </title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill={ACCENT}
              className="hover:fill-blue-700"
              style={{ transition: "fill 80ms" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.fill = ACCENT_HOVER)
              }
              onMouseLeave={(e) => (e.currentTarget.style.fill = ACCENT)}
            />
            <text
              x={x + barW / 2}
              y={padT + innerH + 8}
              fontSize={7}
              fill={SUBTLE}
              textAnchor="middle"
              fontFamily="-apple-system, sans-serif"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {/* Y-axis label */}
      <text
        x={6}
        y={padT + innerH / 2}
        fontSize={7.5}
        fill={TEXT}
        textAnchor="middle"
        transform={`rotate(-90 6 ${padT + innerH / 2})`}
        fontFamily="-apple-system, sans-serif"
      >
        fraction of variance
      </text>
      {/* X-axis label */}
      <text
        x={padL + innerW / 2}
        y={H - 4}
        fontSize={7.5}
        fill={TEXT}
        textAnchor="middle"
        fontFamily="-apple-system, sans-serif"
      >
        component
      </text>
    </svg>
  );
}

/**
 * PC-loadings popup. The wire ships `rows[]` (top-N probe loadings)
 * + `bioAssayScores` (per-sample PC score). We reconstruct a
 * meaningful per-(probe, sample) heatmap as the **rank-1 PC
 * projection**: `cell = loading[probe] × score[sample]`. This is
 * the contribution of each (probe, sample) pair to PC-N — sign and
 * magnitude both matter, hence a diverging palette.
 *
 * Why not pull the actual expression values for the top-loaded
 * probes from `/datasets/{id}/expressions/...` and render those?
 * The rank-1 projection IS the load-bearing signal — it's exactly
 * what PC-N "sees" — without a second endpoint roundtrip. Future
 * version could overlay real expression alongside.
 */
function PcLoadingsPopup({
  experimentId,
  pc,
  onClose,
}: {
  experimentId: number;
  pc: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = usePcLoadings(experimentId, pc, 50);
  const heatmap = useMemo(() => (data ? buildProjectionHeatmap(data) : null), [data]);
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded shadow-lg max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            Top-loaded probes on PC{pc}
            {data ? (
              <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                · cell = loading × sample score (rank-1 PC{pc} projection)
              </span>
            ) : null}
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
        <div className="flex-1 min-h-[400px] overflow-auto p-3">
          {isLoading ? (
            <div className="text-xs text-slate-500 italic">loading…</div>
          ) : error ? (
            <div className="text-xs text-rose-700">
              {(error as Error).message}
            </div>
          ) : !data || !heatmap ? (
            <div className="text-xs text-slate-500 italic">
              No SVD loadings available for this experiment yet.
            </div>
          ) : (
            <HeatmapWidget
              data={heatmap}
              chrome={false}
              showControls={true}
              showLegend={true}
              showTooltip={true}
              showDownload={true}
              defaultPalette="ambsky"
              defaultClip={Math.max(...heatmap.values.flat().map((v) => Math.abs(v ?? 0))) || 1}
              defaultRowScale={false}
              defaultMaxHeight={14}
              defaultMaxWidth={14}
              defaultFitMode="squeeze"
              downloadFilenameStem={`pc${pc}-loadings`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Build the rank-1 projection matrix from PC loadings + sample
 *  scores. Cell[r][c] = rows[r].loading × bio_assay_scores[c]. */
function buildProjectionHeatmap(d: PcLoadings): HeatmapData {
  const sampleEntries = Object.entries(d.bio_assay_scores);
  const colLabels = sampleEntries.map(([id]) => id);
  const sampleScores = sampleEntries.map(([, score]) => score);
  const rowLabels = d.rows.map(
    (r, i) =>
      r.gene_symbol ||
      r.design_element_name ||
      (r.design_element_id != null
        ? `probe ${r.design_element_id}`
        : `row ${i + 1}`),
  );
  const values: (number | null)[][] = d.rows.map((r) =>
    sampleScores.map((s) => r.loading * s),
  );
  return { rowLabels, colLabels, values };
}

function niceTicks(min: number, max: number, count: number): number[] {
  const step = (max - min) / count;
  // Round step to a nice fraction (1, 2, 5 × 10^n).
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  const niceStep =
    norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const finalStep = niceStep * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + finalStep * 0.5; v += finalStep) {
    ticks.push(Number(v.toPrecision(6)));
  }
  return ticks;
}

function fmtPct(v: number): string {
  if (v === 0) return "0";
  if (v < 0.01) return v.toFixed(3);
  if (v < 0.1) return v.toFixed(2);
  return v.toFixed(1);
}
