/**
 * Read-only landing surface for a preboarded candidate — a dataset
 * that's been queued in local_api but not yet imported as a full
 * ExpressionExperiment with a design / samples / factors. A richer
 * surface is anticipated later; for now this stops the Shell from trying
 * to fetch `/design` (which 422s on the prefixed id) and surfaces
 * the basic identifying metadata local_api carries.
 *
 * Renders inside the same monorepo TopBar/HealthChip chrome the rest
 * of the app uses; navigation back to the group queue is via the
 * `?group=<id>` query param threaded in by the workflow page.
 */

import type { ReactNode } from "react";
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
  /** Rich GEO-derived metadata decoded from
   *  ``preboarding.identifying_metadata``. Populated by the
   *  agents-side geo-scrape ingest (2026-06-02). Shape:
   *  ``{title, summary, overallDesign, organisms, platform,
   *  platforms, seriesType, libraryStrategy, librarySource,
   *  numSamples, releaseDate, pubMedIds, meshHeadings,
   *  sampleDetails, scrapedAt}``. Surfaced inline below the
   *  thin-row fields so curators can triage a fresh preboard
   *  without leaving this surface. */
  identifying_metadata?: IdentifyingMetadata | null;
}

/** Decoded ``identifying_metadata`` blob. Both casings appear in
 *  practice: the wire shape is camelCase (Gemma's
 *  ``buildIdentifyingMetadata`` writes camel; local-api round-trips
 *  the JSON string verbatim), but the API client's ``snakeify`` pass
 *  recursively converts response keys before components see them.
 *  We accept either casing so the same reader works against the API
 *  GET path AND against ``ticket.payload_json.candidates`` (which is
 *  a JSON string parsed client-side without snakeify). */
interface IdentifyingMetadata {
  title?: string;
  summary?: string;
  overallDesign?: string;
  overall_design?: string;
  organisms?: string[];
  platform?: string;
  platforms?: string[];
  seriesType?: string;
  series_type?: string;
  libraryStrategy?: string;
  library_strategy?: string;
  librarySource?: string;
  library_source?: string;
  numSamples?: number;
  num_samples?: number;
  releaseDate?: string;
  release_date?: string;
  pubMedIds?: (string | number)[];
  pub_med_ids?: (string | number)[];
  meshHeadings?: string[];
  mesh_headings?: string[];
  sampleDetails?: string;
  sample_details?: string;
  scrapedAt?: string;
  scraped_at?: string;
}

function pickIm(
  im: IdentifyingMetadata | null | undefined,
): {
  title?: string;
  summary?: string;
  overallDesign?: string;
  organisms?: string[];
  platforms: string[];
  platform?: string;
  seriesType?: string;
  libraryStrategy?: string;
  librarySource?: string;
  releaseDate?: string;
  pubMedIds: (string | number)[];
  meshHeadings: string[];
  sampleDetails?: string;
} {
  if (!im) {
    return {
      platforms: [],
      pubMedIds: [],
      meshHeadings: [],
    };
  }
  return {
    title: im.title,
    summary: im.summary,
    overallDesign: im.overallDesign ?? im.overall_design,
    organisms: im.organisms,
    platforms: im.platforms ?? [],
    platform: im.platform,
    seriesType: im.seriesType ?? im.series_type,
    libraryStrategy: im.libraryStrategy ?? im.library_strategy,
    librarySource: im.librarySource ?? im.library_source,
    releaseDate: im.releaseDate ?? im.release_date,
    pubMedIds: im.pubMedIds ?? im.pub_med_ids ?? [],
    meshHeadings: im.meshHeadings ?? im.mesh_headings ?? [],
    sampleDetails: im.sampleDetails ?? im.sample_details,
  };
}

export function PreboardingDetailPage({
  experimentId,
  groupContext,
  ticketContext,
  preloaded,
  embedded = false,
}: {
  experimentId: string | number;
  groupContext?: string;
  /** ID of the parent ticket the curator drilled in from (the
   *  ``?ticket=`` query param from ``parseRoute``). When set, the
   *  back button routes to ``#/tickets/<id>`` instead of the
   *  workflow page; matches the way the design editor handles
   *  ticket-scoped navigation. Triage rows on a SCREENING ticket
   *  always carry this. */
  ticketContext?: string;
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

            {(() => {
              const im = pickIm(data.identifying_metadata);
              return (
                <>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <Field
                      label="Organism"
                      value={
                        im.organisms?.join(", ") || data.taxon_common_name
                      }
                    />
                    <Field
                      label="Study type"
                      value={
                        im.seriesType || data.assay || data.technology_type
                      }
                    />
                    <Field
                      label="Samples"
                      value={
                        typeof data.number_of_bio_assays === "number"
                          ? String(data.number_of_bio_assays)
                          : undefined
                      }
                    />
                    <Field label="Library strategy" value={im.libraryStrategy} />
                    <Field label="Library source" value={im.librarySource} />
                    <Field
                      label="Platform"
                      value={
                        im.platforms.join(", ") ||
                        im.platform ||
                        data.platform_short_name
                      }
                    />
                    <Field label="Release date" value={im.releaseDate} />
                    <Field label="Source" value={data.external_database} />
                    <Field label="Accession" value={data.accession} />
                  </div>

                  {im.summary ? (
                    <Section title="Summary">
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {im.summary}
                      </p>
                    </Section>
                  ) : null}

                  {im.overallDesign ? (
                    <Section title="Overall design">
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {im.overallDesign}
                      </p>
                    </Section>
                  ) : null}

                  {im.sampleDetails ? (
                    <Section title="Sample details">
                      <p className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                        {im.sampleDetails}
                      </p>
                      <p className="mt-1 text-[10px] italic text-slate-500">
                        GEO's flat semicolon-joined characteristic list — not
                        per-sample, but the cheap-to-scrape view. Per-sample
                        load comes via the iteration-batch deep-fetch.
                      </p>
                    </Section>
                  ) : null}

                  {im.meshHeadings.length > 0 ? (
                    <Section title="MeSH headings">
                      <div className="flex flex-wrap gap-1.5">
                        {im.meshHeadings.map((m) => (
                          <span
                            key={m}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </Section>
                  ) : null}

                  {im.pubMedIds.length > 0 ? (
                    <Section title="Publications">
                      <div className="flex flex-wrap gap-3 text-sm">
                        {im.pubMedIds.map((p) => (
                          <a
                            key={String(p)}
                            href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 dark:text-blue-300 hover:underline"
                          >
                            PMID {p} ↗
                          </a>
                        ))}
                      </div>
                    </Section>
                  ) : null}
                </>
              );
            })()}

            {data.description ? (
              <Section title="Description">
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {data.description}
                </p>
              </Section>
            ) : null}

            <div className="flex flex-wrap gap-3 text-xs">
              <a
                href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${data.accession ?? data.short_name}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 dark:text-blue-300 hover:underline"
              >
                Open on GEO ↗
              </a>
              {data.external_uri ? (
                <a
                  href={data.external_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 dark:text-blue-300 hover:underline"
                >
                  External source ↗
                </a>
              ) : null}
            </div>

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

  // Back-button destination — prefer the ticket the curator drilled
  // in from; otherwise the group set; otherwise the workflow page.
  // Keeps the breadcrumb honest: SCREENING-triage rows always carry
  // ``ticketContext`` so "back" actually returns to the triage table.
  const backTarget = ticketContext
    ? `#/tickets/${ticketContext}`
    : workflowRoute(groupContext);
  const backLabel = ticketContext
    ? `ticket #${ticketContext}`
    : groupContext
      ? "set"
      : "workflow";
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(backTarget)}
          className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
        >
          ← back to {backLabel}
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

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}
