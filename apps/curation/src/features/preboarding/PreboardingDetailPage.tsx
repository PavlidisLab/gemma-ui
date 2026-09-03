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

import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { navigate, workflowRoute } from "@/routes";
import { useTicket, usePatchTicketTarget } from "@/api/tickets";
import type { TicketTargetTriageDisposition } from "@/api/tickets";
import { DispositionPicker } from "@/components/ui/DispositionPicker";
import {
  decisionLabels,
  findTargetForPreboarding,
  parsePayload,
  preboardingRowId,
  preboardingSiblings,
  ticketPayload,
} from "@/features/triage/triagePayload";
import { isEditableTarget } from "@/lib/isEditableTarget";

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

/**
 * Resolve the ticket decision this candidate page can record, if any.
 *
 * The page knows two things from the URL: its own preboarding row id
 * and (when the curator drilled in from a screen) the ticket id. The
 * mapping between them lives in the ticket's
 * ``payload_json.candidates[<target_id>].preboarding_id`` — the same
 * field the triage row builds its drill-in link from, read back the
 * other way.
 *
 * ``target`` is null whenever there is nothing to decide: no ticket in
 * the URL, a ticket that predates preboard-at-scrape (no ids to match),
 * or a candidate that isn't on this ticket. The caller renders nothing
 * in that case rather than a control that would have nowhere to write.
 */
function usePreboardingDecision(
  experimentId: string | number,
  ticketContext: string | undefined,
) {
  const ticketId = ticketContext ? Number(ticketContext) : null;
  const { data: ticket } = useTicket(
    Number.isFinite(ticketId) ? ticketId : null,
  );
  const patch = usePatchTicketTarget(ticketId ?? 0);
  const rowId = preboardingRowId(experimentId);
  const target = findTargetForPreboarding(ticket, rowId);
  const labels = decisionLabels(parsePayload(ticket ? ticketPayload(ticket) : undefined));
  const siblings = preboardingSiblings(ticket, rowId);
  const go = (id: number | null) => {
    if (id == null) return;
    navigate(`#/experiments/preboarding:${id}?ticket=${ticketId}`);
  };

  // Shift + ← / → walks the queue. Shift-modified so the plain arrows
  // still scroll the page, and suppressed inside text fields.
  useEffect(() => {
    if (siblings.index < 0) return;
    function onKey(e: KeyboardEvent) {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (isEditableTarget(e.target)) return;
      const to = e.key === "ArrowRight" ? siblings.next : siblings.prev;
      if (to == null) return;
      e.preventDefault();
      go(to);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblings.index, siblings.next, siblings.prev, ticketId]);

  return {
    target,
    ...labels,
    siblings,
    go,
    prompt: parsePayload(ticket ? ticketPayload(ticket) : undefined).decision?.prompt,
    disposition: target?.triage_disposition ?? null,
    saving: patch.isPending,
    error: patch.error as Error | null,
    set: (next: TicketTargetTriageDisposition) => {
      if (!target) return;
      patch.mutate({
        target_type: target.target_type,
        target_id: target.target_id,
        // Same write the triage row makes — a decision recorded here
        // and one recorded in the table are the same row in the store.
        patch: {
          triage_disposition: next,
          status: next === null ? "NOT_DONE" : "DONE",
        },
      });
    },
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

  // The decision the ticket is asking for, if we arrived from one. The
  // curator who drilled into a candidate to read it is the curator best
  // placed to decide it — sending them back to the table to click the
  // same two buttons is a round trip for nothing.
  const decision = usePreboardingDecision(experimentId, ticketContext);

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
        {decision.siblings.index >= 0 ? (
          // Queue position + step controls. Visible arrows first (the
          // shortcut is a bonus, not the only way in), with the keys
          // named in the tooltip so they're discoverable.
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={decision.siblings.prev == null}
              onClick={() => decision.go(decision.siblings.prev)}
              title="Previous candidate (Shift + ←)"
              className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-default hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ←
            </button>
            <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {decision.siblings.index + 1} of {decision.siblings.ids.length}
            </span>
            <button
              type="button"
              disabled={decision.siblings.next == null}
              onClick={() => decision.go(decision.siblings.next)}
              title="Next candidate (Shift + →)"
              className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-default hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              →
            </button>
          </div>
        ) : null}
        {decision.target ? (
          // Right-aligned so the decision reads as the page's action,
          // not as another piece of breadcrumb. Only rendered when the
          // ticket gave us a target to write to.
          <div className="ml-auto flex items-center gap-2">
            {decision.prompt ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {decision.prompt}
              </span>
            ) : null}
            {decision.error ? (
              <span
                className="text-xs text-rose-700 dark:text-rose-300"
                title={decision.error.message}
              >
                couldn't save
              </span>
            ) : null}
            <DispositionPicker
              size="md"
              value={decision.disposition}
              onChange={decision.set}
              disabled={decision.saving}
              confirmLabel={decision.confirmLabel}
              rejectLabel={decision.rejectLabel}
            />
          </div>
        ) : null}
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
