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
import { usePipelineStatus } from "@/api/workflow";
import { statusLabel } from "@/features/workflow/PipelinePanel";
import { useQuantitationTypes } from "@/api/quantitation";
import { HelpPopup } from "@/components/ui/HelpPopup";

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

/** Bottom-of-tab footer, answering "how old is what I am looking at,
 *  and what data were these panels computed from".
 *
 *  Two of the three fields the legacy footer promised are already on
 *  the wire and are read here; the third is not, and says so.
 *
 *  🛑 **There is no normalization METHOD name in Gemma** — nothing
 *  stores "quantile" or "RMA", and no field is rendered for one. What
 *  is recorded is the preferred quantitation type's flag set, and that
 *  is what this shows. (`ExperimentalDesign.normalizationDescription`
 *  exists as a free-text column and no loader has ever written to it.)
 *
 *  🛑 **Do not warn on a count of `is_preferred`.** Gemma marks one
 *  preferred QT per vector type, so every dataset has two — 120 of 120
 *  sampled on 2026-09-02, and 0 of 120 had two within one vector type.
 *  A bare count reproduces 1.0's `hasMultiplePreferredQuantitationTypes`
 *  warning as an alarm that fires on everything.
 *
 *  Still absent, both from `pipeline-status`: `preprocess.processedVectors`
 *  (which carries `quantileNormalized`, the one normalization fact
 *  Gemma does store) and `sampleCorrelation.filterAttrition` (the
 *  per-stage filter row counts). Both are built and unshipped — gembro,
 *  2026-09-02 — so the filtering row states its absence rather than
 *  rendering a 0, which would read as "every row was filtered out".
 */
export function PreprocessingMetadataFooter({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: pipeline } = usePipelineStatus(experimentId);
  const { data: qts } = useQuantitationTypes(experimentId);

  const preprocess = pipeline?.analysis?.preprocessing;

  // The QT the four panels above were computed from. `is_masked_preferred`
  // is Gemma's mark for the processed (missing-value-masked) vectors, and
  // there is exactly one per dataset — unlike `is_preferred`, which also
  // marks the raw QT the run started from.
  const processed =
    qts?.find((q) => q.is_masked_preferred) ??
    qts?.find(
      (q) => q.is_preferred && q.vector_type?.endsWith("ProcessedExpressionDataVector"),
    );

  return (
    <div className="card px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="section-h">Preprocessing metadata</span>
        <HelpPopup title="Preprocessing metadata" size="md">
          <div className="space-y-1.5 leading-snug">
            <p>What the four panels above were computed from, and when.</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-semibold">Preprocessed</span> — when
                Gemma last computed the processed expression data.{" "}
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  Stale
                </span>{" "}
                means that run succeeded and its input changed afterwards
                — the design was edited, or a sample was flagged as an
                outlier. Neither reprocesses anything, so the panels above
                may not reflect the design you are looking at.
              </li>
              <li>
                <span className="font-semibold">Data</span> — the
                quantitation type the panels were computed from, then its
                scale, type and storage. Gemma records no normalization
                <em> method</em>, so there is no field for one.
              </li>
              <li>
                The five terms are flags on that quantitation type.{" "}
                <span className="line-through">Struck</span> means false —
                recorded and not set, as opposed to not recorded.{" "}
                <span className="font-semibold">Recomputed from raw</span>{" "}
                means Gemma reprocessed the submitter&rsquo;s raw files
                instead of using the values they supplied.
              </li>
              <li>
                <span className="font-semibold">Filtering</span> — which
                probes were dropped before the correlation matrix. Gemma
                does not record this yet, for any dataset.
              </li>
            </ul>
          </div>
        </HelpPopup>
      </div>
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
        <FooterTerm>Preprocessed</FooterTerm>
        <dd className="flex items-center gap-2 flex-wrap">
          {preprocess ? (
            <>
              <span
                className="text-slate-700 dark:text-slate-200"
                title={preprocess.last_run ?? undefined}
              >
                {formatRunDate(preprocess.last_run)}
              </span>
              {statusLabel(preprocess.status)}
            </>
          ) : (
            <Absent>not reported</Absent>
          )}
        </dd>

        <FooterTerm>Data</FooterTerm>
        <dd>
          {processed ? (
            <>
              <div className="text-slate-700 dark:text-slate-200">
                {processed.name?.trim() || "(unnamed quantitation type)"}
                <span className="ml-2 text-slate-400 dark:text-slate-500">
                  {[processed.scale, processed.type, processed.representation]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {/* Every flag every time, true or false. Dropping the false
                  ones would make "not batch-corrected" and "not recorded"
                  look the same. */}
              <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1">
                <QtFlag on={processed.is_normalized}>normalized</QtFlag>
                <QtFlag on={processed.is_background_subtracted}>background-subtracted</QtFlag>
                <QtFlag on={processed.is_batch_corrected}>batch-corrected</QtFlag>
                <QtFlag on={processed.is_recomputed_from_raw_data}>recomputed from raw</QtFlag>
                <QtFlag on={processed.is_ratio}>ratio</QtFlag>
              </div>
            </>
          ) : (
            <Absent>no preferred quantitation type reported</Absent>
          )}
        </dd>

        <FooterTerm>Filtering</FooterTerm>
        <dd>
          <Absent>not recorded for this dataset</Absent>
        </dd>
      </dl>
    </div>
  );
}

function FooterTerm({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-slate-400 dark:text-slate-500 uppercase tracking-wide text-[10px] font-semibold">
      {children}
    </dt>
  );
}

/** Nothing to show, and saying so is the content. Never a spinner and
 *  never a zero — see the block comment above. */
function Absent({ children }: { children: React.ReactNode }) {
  return <span className="italic text-slate-400 dark:text-slate-500">{children}</span>;
}

/** A recorded boolean, shown whether it holds or not: dark when true,
 *  dim when false. Mirrors the yes/no reading of the Quantitation types
 *  tab, which lists the same flags for every QT. */
function QtFlag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      title={`${String(children)}: ${on ? "yes" : "no"}`}
      className={
        on
          ? "text-slate-700 dark:text-slate-200"
          : "text-slate-300 dark:text-slate-600 line-through decoration-1"
      }
    >
      {children}
    </span>
  );
}

/** `null` is "never run", which is not the same as a date we failed to
 *  parse — an unparseable string is shown verbatim rather than as an
 *  em dash. */
function formatRunDate(iso: string | null): string {
  if (!iso) return "never run";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
