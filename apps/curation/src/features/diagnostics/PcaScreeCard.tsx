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

import { useState } from "react";
import { PanelCard, PanelEmpty, PanelLoading, PanelError } from "./PanelCard";
import { useDatasetSvd, usePcLoadings } from "@/api/diagnostics";

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
      <PanelEmpty reason="PCA not yet computed for this experiment. Once preprocessing runs, the scree appears here." />
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
            Top-loaded genes on PC{pc}
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
          ) : !data ? (
            <div className="text-xs text-slate-500 italic">
              PC-loadings endpoint not available yet. When bro lands{" "}
              <code>/svd/loadings?pc={pc}</code>, the heatmap renders
              here via the shared @gemma/heatmap widget.
            </div>
          ) : (
            // Once the endpoint returns a HeatmapPayload-shaped
            // response, hand it straight to <HeatmapWidget payload={data}/>.
            // For now the shape is unconfirmed; render JSON keys so
            // we can sanity-check what bro ships.
            <pre className="text-[10px] font-mono text-slate-700 dark:text-slate-200">
              {JSON.stringify(Object.keys(data), null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
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
