/**
 * Four-up diagnostics row that lives inside the Expression tab in
 * place of the legacy standalone PCA-scree section. Same four-panel
 * granularity as the curation app's Diagnostics tab:
 *
 *   Sample correlation │ PCA scree │ PC × factor │ Mean-variance
 *
 * Each card hits its own /datasets/{id}/* endpoint and renders an
 * empty state when the data isn't computed yet, so the row ships
 * before every Gemma build serves all four. Layout: single row on lg+,
 * 2x2 on md, stacked on sm. Column widths in the component below.
 */

import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";

export function DiagnosticsRow({ datasetId }: { datasetId: number }) {
  // The correlation card gets a bounded px column, not an `fr`: its
  // matrix is square and the panel body is a fixed 420px tall, so past
  // roughly that width the extra is dead space inside the card — the
  // square can only grow as far as the height lets it. Capping the
  // column there and giving the remainder to the other three (whose
  // bars and scatter do use width) is what closes the gap. The other
  // three keep the old 2:3:3 ratio: scree narrowest, the two others
  // medium.
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[40%_1fr_1.4fr_1.4fr] gap-3">
      <SampleCorrelationCard datasetId={datasetId} />
      <PcaScreeCard datasetId={datasetId} />
      <PcFactorCard datasetId={datasetId} />
      <MeanVarianceCard datasetId={datasetId} />
    </div>
  );
}
