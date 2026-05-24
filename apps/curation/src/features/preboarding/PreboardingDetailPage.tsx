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
}

export function PreboardingDetailPage({
  experimentId,
  groupContext,
}: {
  experimentId: string;
  groupContext?: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["preboarding-detail", experimentId],
    queryFn: () =>
      api.get<PreboardingRow>(
        `/rest/v2/datasets/${encodeURIComponent(experimentId)}`,
      ),
    enabled: !!experimentId,
  });

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
          {experimentId}
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {isLoading ? (
          <div className="text-sm text-slate-500">loading candidate…</div>
        ) : error ? (
          <div className="text-sm text-rose-700">
            couldn't load candidate: {(error as Error).message}
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
              <Field label="Technology" value={data.technology_type} />
              <Field
                label="Samples"
                value={
                  typeof data.number_of_bio_assays === "number"
                    ? String(data.number_of_bio_assays)
                    : undefined
                }
              />
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
                Preboarded rows live in the curation database as
                pre-import candidates. Once promoted to a full
                experiment, the design / samples / factors / audit
                trail surfaces become available. The full import
                workflow lives in the workflow page (back link
                above).
              </p>
            </div>
          </>
        )}
      </main>
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
