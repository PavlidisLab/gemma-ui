/**
 * Diagnostics tab — real expression-data QC for the curator and
 * downstream users. Four panels mirroring the legacy Gemma ExtJS
 * Diagnostics tab, in the same left-to-right order curators are used
 * to:
 *
 *   Sample correlation │ PCA scree │ PC × factor │ Mean-Variance
 *
 * The design-validity / pre-publish checklist content that used to
 * live under "Diagnostics" moved to the sibling "Quality control"
 * tab on 2026-05-23.
 *
 * Each panel reads its own endpoint (see `@/api/diagnostics`) and
 * renders an empty state when the data isn't computed yet — so the
 * panel ships before bro lands all four endpoints.
 *
 * Single-cell-specific diagnostics (cluster QC, neighborhood graph)
 * are deliberately NOT here — they belong on the Single-cell tab.
 */

import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";

export function DiagnosticsPanel({ experimentId }: { experimentId: number }) {
  return (
    <div className="space-y-3">
      {/* 4-up on lg, 2×2 on md, stacked on sm. The legacy tab was
          always 4-up; on a 13" laptop that crowds the matrix. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <SampleCorrelationCard experimentId={experimentId} />
        <PcaScreeCard experimentId={experimentId} />
        <PcFactorCard experimentId={experimentId} />
        <MeanVarianceCard experimentId={experimentId} />
      </div>
      <PreprocessingMetadataFooter experimentId={experimentId} />
    </div>
  );
}

/** Bottom-of-tab footer — mirrors the legacy Diagnostics tab's
 *  "Preprocessing metadata: Not available for this experiment"
 *  line. When the curation REST exposes a preprocessing-metadata
 *  endpoint (run date, normalization method, filter rules, etc.)
 *  this expands to surface those. For now it just acknowledges the
 *  legacy footer's existence — the four panels above are the
 *  load-bearing content. */
function PreprocessingMetadataFooter({
  experimentId: _experimentId,
}: {
  experimentId: number;
}) {
  return (
    <div className="card px-3 py-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3">
      <span className="font-semibold text-slate-700 dark:text-slate-300">
        Preprocessing metadata
      </span>
      <span className="italic">
        endpoint not yet wired — bro to expose run date, normalization
        method, and filter rules.
      </span>
    </div>
  );
}
