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
 * panel ships before the agents side lands all four endpoints.
 *
 * Single-cell-specific diagnostics (cluster QC, neighborhood graph)
 * are deliberately NOT here — they belong on the Single-cell tab.
 */

import { useState } from "react";
import {
  hasDiagnosticsOptIn,
  setDiagnosticsOptIn,
} from "@/lib/diagnosticsCache";
import { SampleCorrelationCard } from "./SampleCorrelationCard";
import { PcaScreeCard } from "./PcaScreeCard";
import { PcFactorCard } from "./PcFactorCard";
import { MeanVarianceCard } from "./MeanVarianceCard";
import { useGemmaMode } from "@/lib/gemmaMode";

// Temporary opt-in gate (the reviewer, 2026-05-24): the four panels each hit
// a separate gemma-rest endpoint that can be heavy. While we're doing
// unrelated work, default the tab to a "click to fetch" affordance so
// switching tabs doesn't fire four diagnostics requests. Drop this
// gate (render the cards unconditionally) when the bandwidth concern
// goes away.
export function DiagnosticsPanel({ experimentId }: { experimentId: number | string }) {
  const { mode } = useGemmaMode();
  // 🛑 Not per-mount state. It was, and navigating away then back put
  // the tab into "Diagnostics are not loaded yet" with the data still
  // in TanStack's cache — nothing had been dropped, the panel had just
  // forgotten it had asked, and the button re-fetched nothing (Paul,
  // 2026-09-01). The flag is per EXPERIMENT because the cost the gate
  // guards against is real again on a different dataset, and because
  // it makes a scoped clear possible (`paperDismissal.ts` convention).
  // Read, never latched: walking to a sibling experiment keeps this tab
  // mounted (feedback_walk_between_experiments_keeps_the_tab), so a
  // `useState` initializer would carry the previous dataset's opt-in
  // across and fire four requests the curator never asked for here.
  const [optedInThisMount, setOptedInThisMount] = useState<string | null>(null);
  const key = String(experimentId);
  const fetched = optedInThisMount === key || hasDiagnosticsOptIn(experimentId);
  // Local mode runs against local_api which doesn't compute SVD /
  // sample-correlation / mean-variance — those are gemma-rest only.
  // Render an explicit unavailable state instead of letting the
  // cards 404 individually. Re-enabled automatically when the UI
  // points at a real Gemma backend (remote / mixed mode).
  if (mode === "local") {
    return (
      <div className="space-y-3">
        <div className="card px-4 py-10 flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-sm text-slate-700 dark:text-slate-200">
            Diagnostics are not available in local mode.
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
            Sample correlation, PCA scree, PC × factor, and mean-variance
            are computed by Gemma's preprocessor — they need expression
            data the local server doesn't carry. Switch to remote mode
            (or open the experiment in a real Gemma instance) to see
            these.
          </span>
        </div>
        <PreprocessingMetadataFooter experimentId={experimentId} />
      </div>
    );
  }
  if (!fetched) {
    return (
      <div className="space-y-3">
        <div className="card px-4 py-10 flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-sm text-slate-700 dark:text-slate-200">
            Diagnostics are not loaded yet.
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
            Sample correlation · PCA scree · PC × factor · Mean-variance.
            Each panel hits a separate gemma-rest endpoint; opt in here to
            avoid running them on every tab switch.
          </span>
          <button
            type="button"
            onClick={() => {
              setDiagnosticsOptIn(experimentId);
              setOptedInThisMount(key);
            }}
            className="mt-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
          >
            Fetch diagnostics
          </button>
        </div>
        <PreprocessingMetadataFooter experimentId={experimentId} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* One row on lg+ with a 4:2:3:3 column ratio (heatmap : scree :
          PC×factor : mean-variance) so width matches each plot's needs;
          2×2 on md; stacked on sm. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[4fr_2fr_3fr_3fr] gap-3">
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
  experimentId: number | string;
}) {
  return (
    <div className="card px-3 py-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3">
      <span className="font-semibold text-slate-700 dark:text-slate-300">
        Preprocessing metadata
      </span>
      <span className="italic">
        endpoint not yet wired — the agents side to expose run date, normalization
        method, and filter rules.
      </span>
    </div>
  );
}
