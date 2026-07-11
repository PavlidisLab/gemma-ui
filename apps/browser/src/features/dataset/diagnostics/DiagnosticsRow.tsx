/**
 * Four-up diagnostics row that lives inside the Expression tab in
 * place of the legacy standalone PCA-scree section. Same four-panel
 * granularity as the curation app's Diagnostics tab:
 *
 *   Sample correlation │ PCA scree │ PC × factor │ Mean-variance
 *
 * Each card hits its own /datasets/{id}/* endpoint and renders an
 * empty state when the data isn't computed yet, so the row ships
 * before every Gemma build serves all four. Layout: single row on lg+
 * with a 4:2:3:3 column ratio (heatmap : scree : PC×factor :
 * mean-variance) so each plot gets width matched to its content — the
 * square correlation matrix needs the widest slot, the scree the
 * narrowest. Falls back to 2×2 on md and stacked on sm.
 */

import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";

export function DiagnosticsRow({ datasetId }: { datasetId: number }) {
  // One row on lg+ with a 4:2:3:3 column ratio; 2×2 on md; stacked on
  // sm. The fr ratios distribute width by plot: heatmap widest (4),
  // scree narrowest (2), the two others medium (3 each).
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[4fr_2fr_3fr_3fr] gap-3">
      <SampleCorrelationCard datasetId={datasetId} />
      <PcaScreeCard datasetId={datasetId} />
      <PcFactorCard datasetId={datasetId} />
      <MeanVarianceCard datasetId={datasetId} />
    </div>
  );
}
