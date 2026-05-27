/**
 * Read-only landing surface for a preboarded candidate — a dataset
 * that's been queued in local_api but not yet imported as a full
 * ExpressionExperiment with a design / samples / factors. The cab
 * handoff (HANDOFF_2026-05-24_UI_PREBOARDING_DRILLDOWN.md) anticipates
 * a richer surface later; for now this stops the Shell from trying
 * to fetch `/design` (which 422s on the prefixed id) and surfaces
 * the basic identifying metadata local_api carries.
 *
 * Renders inside the same monorepo TopBar/HealthChip chrome the rest
 * of the app uses; navigation back to the group queue is via the
 * `?group=<id>` query param threaded in by the workflow page.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { navigate, workflowRoute } from "@/routes";

interface PreboardingRow {
  id?: number | string;
  short_name?: string;
  name?: string;
  taxon_common_name?: string;
  technology_type?: string;
  number_of_bio_assays?: number;
  external_uri?: string;
  description?: string;
  // ---- GEO-derived fields populated by the agents-side eutils
  // deep-fetch (shared/geo_eutils.fetch_geo_summary, 2026-05-26).
  // Local-api surfaces these through the WorkflowDatasetRow / direct
  // /datasets/{id} response for preboarded rows; absent on rows
  // imported before the deep-fetch landed.
  /** NCBI eutils ``gdstype`` — short study-type string (e.g.
   *  "Expression profiling by high throughput sequencing"). */
  assay?: string;
  /** Primary platform short name (GPLxxxx). */
  platform_short_name?: string;
  /** Same as ``short_name`` for GEO; kept distinct for non-GEO sources. */
  accession?: string;
  /** "GEO" / "ArrayExpress" / etc. */
  external_database?: string;
}

export function PreboardingDetailPage({
  experimentId,
  groupContext,
  preloaded,
  embedded = false,
}: {
  experimentId: string | number;
  groupContext?: string;
  /** Pre-fetched row, supplied when the parent already has the data
   *  (e.g. Shell mounting this surface for a thin numeric-id EE
   *  whose design draft is already loaded). When provided, skips the
   *  internal /datasets/{id} fetch. */
  preloaded?: PreboardingRow;
  /** When true, render without the page-level chrome (back button,
   *  preboarded chip header, full-screen wrapper). Use this when
   *  mounting inside another shell that already owns the top
   *  banners (Shell's AppHeader + TopBar for numeric-id thin EEs). */
  embedded?: boolean;
}) {
  // Skip the fetch when the caller supplied data. ``enabled`` gating
  // also keeps React Query from firing a duplicate request when
  // ``preloaded`` is provided.
  const { data: fetched, isLoading, error } = useQuery({
    queryKey: ["preboarding-detail", String(experimentId)],
    queryFn: () =>
      api.get<PreboardingRow>(
        `/rest/v2/datasets/${encodeURIComponent(String(experimentId))}`,
      ),
    enabled: !!experimentId && !preloaded,
  });

  const data = preloaded ?? fetched;
  const effectiveLoading = !preloaded && isLoading;
  const effectiveError = !preloaded && error;

  const body = (
    <main className={embedded
      ? "max-w-3xl mx-auto px-6 py-8 space-y-6 flex-1"
      : "max-w-3xl mx-auto px-6 py-8 space-y-6"
    }>
        {effectiveLoading ? (
          <div className="text-sm text-slate-500">loading candidate…</div>
        ) : effectiveError ? (
          <div className="text-sm text-rose-700">
            couldn't load candidate: {(effectiveError as Error).message}
          </div>
        ) : !data ? (
          <div className="text-sm text-slate-500">no data</div>
        ) : (
          <>
            <div>
              <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Accession
              </div>
              <div className="text-lg font-mono text-slate-900 dark:text-slate-100">
                {data.short_name ?? "—"}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Title
              </div>
              <div className="text-base text-slate-800 dark:text-slate-100">
                {data.name ?? <span className="italic text-slate-400">untitled</span>}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <Field label="Organism" value={data.taxon_common_name} />
              <Field
                label="Study type"
                value={data.assay || data.technology_type}
              />
              <Field
                label="Samples"
                value={
                  typeof data.number_of_bio_assays === "number"
                    ? String(data.number_of_bio_assays)
                    : undefined
                }
              />
              <Field label="Platform" value={data.platform_short_name} />
              <Field label="Source" value={data.external_database} />
              <Field label="Accession" value={data.accession} />
            </div>

            {data.description ? (
              <div>
                <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Description
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {data.description}
                </div>
              </div>
            ) : null}

            {data.external_uri ? (
              <div>
                <a
                  href={data.external_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-700 dark:text-blue-300 hover:underline"
                >
                  External source ↗
                </a>
              </div>
            ) : null}

            <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="font-semibold mb-1">
                This candidate hasn't been imported yet.
              </div>
              <p className="text-xs leading-relaxed">
                Preboarded rows carry GEO-derived metadata for
                screening — title, samples, study type, platform,
                publication links. The full design / samples /
                factors / audit-trail surfaces unlock once you load
                this dataset into Gemma. Use the load button on the
                ticket or the per-experiment screen to promote it.
              </p>
            </div>
          </>
        )}
      </main>
  );

  // Embedded mode: caller (e.g. Shell) already owns the global
  // chrome (AppHeader + per-experiment TopBar). Skip the
  // page-level header + min-h-screen wrapper so the body slots
  // straight into the parent layout.
  if (embedded) return body;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(workflowRoute(groupContext))}
          className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
        >
          ← back to {groupContext ? "set" : "workflow"}
        </button>
        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          preboarded
        </span>
        <span className="text-sm font-mono text-slate-500 dark:text-slate-400">
          {String(experimentId)}
        </span>
      </header>
      {body}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
        {label}
      </div>
      <div className="text-slate-800 dark:text-slate-100">
        {value ?? <span className="italic text-slate-400">—</span>}
      </div>
    </div>
  );
}
