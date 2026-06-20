/**
 * Four-up diagnostics row that lives inside the Expression tab in
 * place of the legacy standalone PCA-scree section. Same four-panel
 * granularity as the curation app's Diagnostics tab:
 *
 *   Sample correlation │ PCA scree │ PC × factor │ Mean-variance
 *
 * Each card hits its own /datasets/{id}/* endpoint and renders an
 * empty state when the data isn't computed yet, so the row ships
 * before every Gemma build serves all four. Layout: 4-up on lg,
 * 2×2 on md, stacked on sm. The 4-up trigger was xl (1280px) until
 * 2026-05-27; dropped to lg (1024px) so normal desktop windows
 * land on 4-up instead of getting the larger 2×2 cards.
 */

import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";

export function DiagnosticsRow({ datasetId }: { datasetId: number }) {
  // At lg+ the 4-col row needs ~320px per card to render plots
  // legibly; if the page's 1200px content cap doesn't give us that,
  // overflow-x sideways rather than crushing the cards. md (2-col)
  // and sm (stacked) never need scroll.
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(4,minmax(320px,1fr))] gap-3">
        <SampleCorrelationCard datasetId={datasetId} />
        <PcaScreeCard datasetId={datasetId} />
        <PcFactorCard datasetId={datasetId} />
        <MeanVarianceCard datasetId={datasetId} />
      </div>
    </div>
  );
}
