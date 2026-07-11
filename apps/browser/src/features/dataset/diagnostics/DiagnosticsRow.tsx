/**
 * Four-up diagnostics row that lives inside the Expression tab in
 * place of the legacy standalone PCA-scree section. Same four-panel
 * granularity as the curation app's Diagnostics tab:
 *
 *   Sample correlation │ PCA scree │ PC × factor │ Mean-variance
 *
 * Each card hits its own /datasets/{id}/* endpoint and renders an
 * empty state when the data isn't computed yet, so the row ships
 * before every Gemma build serves all four. Layout: 2×2 on md+,
 * stacked on sm. Went from a single 4-up row to two rows of two on
 * 2026-07-11 so each plot renders wide enough to read rather than
 * crushing four across a laptop viewport.
 */

import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";

export function DiagnosticsRow({ datasetId }: { datasetId: number }) {
  // 2×2 on md+, stacked on sm. Two rows of two give each plot roughly
  // half the content width — enough to read on a laptop — instead of
  // the old 4-across squeeze.
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <SampleCorrelationCard datasetId={datasetId} />
      <PcaScreeCard datasetId={datasetId} />
      <PcFactorCard datasetId={datasetId} />
      <MeanVarianceCard datasetId={datasetId} />
    </div>
  );
}
