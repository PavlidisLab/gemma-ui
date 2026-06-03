/**
 * Triage view — the body of a ``SCREENING`` ticket.
 *
 * The agent's GEO scrape produced a list of candidate accessions
 * (each matching one or more of brain / tfperturb / scbrain). This
 * view walks the curator through the list one row at a time:
 * include or exclude, with the candidate's title + summary +
 * matched criteria visible inline so the decision happens against
 * the curator's eye, not a separate worklist file.
 *
 * Data flow
 * ---------
 * - Candidate metadata lives on the parent ticket's
 *   ``payload_json.candidates`` map (keyed by synthetic target_id
 *   1..N). The scrape script populated this so the UI doesn't have
 *   to round-trip back to Gemma for descriptive fields.
 * - Per-row include/exclude PATCHes the ticket-target via
 *   ``usePatchTicketTarget`` — also flips the row to ``DONE`` so the
 *   header progress bar updates.
 * - "Finalize triage" calls ``useFinalizeTriage`` and shows the
 *   bucketed result; the follow-up runner (``run_triage_followup.py``)
 *   takes the included list and creates the curation ticket.
 */
import { useMemo, useState } from "react";

import {
  useFinalizeTriage,
  usePatchTicketTarget,
} from "@/api/tickets";
import type {
  Ticket,
  TicketTarget,
  TicketTargetTriageDisposition,
  TriageFinalizeResponse,
} from "@/api/tickets";

interface CandidateMeta {
  accession: string;
  identifying_metadata?: Record<string, unknown> | null;
  matched_criteria?: string[];
  source?: string;
  /** Local_api preboarding row id minted at scrape time. When
   *  present, the triage row links to the read-only
   *  PreboardingDetailPage at ``#/experiments/preboarding:<id>``
   *  so the curator can drill into the full identifying metadata
   *  without leaving the triage shell. Null on tickets created
   *  before the preboard-at-scrape change landed. */
  preboarding_id?: number | null;
}

interface ParsedPayload {
  candidates: Record<string, CandidateMeta>;
  scrape_window?: {
    since?: string;
    until?: string;
    criteria?: string[];
  };
}

function parsePayload(payload_json: string | undefined): ParsedPayload {
  if (!payload_json) return { candidates: {} };
  try {
    const obj = JSON.parse(payload_json);
    return {
      candidates: (obj?.candidates as ParsedPayload["candidates"]) ?? {},
      scrape_window: obj?.scrape_window,
    };
  } catch {
    return { candidates: {} };
  }
}

type Filter = "all" | "undecided" | "include" | "exclude";

export function TriageView({ ticket }: { ticket: Ticket }) {
  const parsed = useMemo(() => parsePayload(ticket.payload_json), [
    ticket.payload_json,
  ]);
  const [filter, setFilter] = useState<Filter>("undecided");
  const [finalized, setFinalized] = useState<TriageFinalizeResponse | null>(
    null,
  );

  const triageTargets = ticket.targets.filter(
    (t) => t.target_type === "GEO_ACCESSION",
  );

  const counts = useMemo(() => {
    let inc = 0, exc = 0, und = 0;
    for (const t of triageTargets) {
      const d = t.triage_disposition ?? null;
      if (d === "include") inc++;
      else if (d === "exclude") exc++;
      else und++;
    }
    return { include: inc, exclude: exc, undecided: und, total: triageTargets.length };
  }, [triageTargets]);

  const visibleTargets = triageTargets.filter((t) => {
    if (filter === "all") return true;
    const d = t.triage_disposition ?? null;
    if (filter === "undecided") return d === null;
    return d === filter;
  });

  const finalize = useFinalizeTriage(ticket.id);
  const handleFinalize = async () => {
    if (counts.undecided > 0) {
      const ok = window.confirm(
        `${counts.undecided} row(s) still undecided — finalize anyway? ` +
          `Undecided rows are excluded from the follow-up curation ticket.`,
      );
      if (!ok) return;
    }
    try {
      const res = await finalize.mutateAsync();
      setFinalized(res);
    } catch {
      // Error chip below surfaces details.
    }
  };

  return (
    <section className="space-y-4">
      {parsed.scrape_window ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Scrape window:{" "}
          <span className="font-mono">
            {parsed.scrape_window.since} → {parsed.scrape_window.until}
          </span>
          {parsed.scrape_window.criteria?.length ? (
            <>
              {" "}· matchers:{" "}
              {parsed.scrape_window.criteria.map((c) => (
                <CriterionChip key={c} criterion={c} />
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <FilterButton
          label={`Undecided (${counts.undecided})`}
          active={filter === "undecided"}
          onClick={() => setFilter("undecided")}
        />
        <FilterButton
          label={`Included (${counts.include})`}
          active={filter === "include"}
          onClick={() => setFilter("include")}
        />
        <FilterButton
          label={`Excluded (${counts.exclude})`}
          active={filter === "exclude"}
          onClick={() => setFilter("exclude")}
        />
        <FilterButton
          label={`All (${counts.total})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <div className="grow" />
        <button
          type="button"
          className="btn primary text-xs"
          onClick={handleFinalize}
          disabled={finalize.isPending || counts.total === 0}
          title={
            counts.total === 0
              ? "No candidates to triage."
              : "Bucket the candidates and hand the included list off to the follow-up runner."
          }
        >
          {finalize.isPending ? "finalising…" : "Finalize triage"}
        </button>
      </div>

      {finalize.isError ? (
        <div className="text-xs text-rose-700 dark:text-rose-400">
          finalize failed: {(finalize.error as Error).message}
        </div>
      ) : null}

      {finalized ? <FinalizedSummary res={finalized} /> : null}

      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">GSE</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Taxon</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Matched</th>
              <th className="px-3 py-2 font-medium">Samples</th>
              <th className="px-3 py-2 font-medium">PMIDs</th>
              <th className="px-3 py-2 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {visibleTargets.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center italic text-slate-500"
                >
                  No candidates match the current filter.
                </td>
              </tr>
            ) : (
              visibleTargets.map((t) => (
                <TriageRow
                  key={t.target_id}
                  ticketId={ticket.id}
                  target={t}
                  meta={parsed.candidates[String(t.target_id)]}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-2 py-0.5 rounded border border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-400"
          : "px-2 py-0.5 rounded border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      }
    >
      {label}
    </button>
  );
}

function CriterionChip({ criterion }: { criterion: string }) {
  const tone =
    criterion === "brain"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : criterion === "tfperturb"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${tone} mr-1`}>
      {criterion}
    </span>
  );
}

/** Compact study-type label derived from the GEO record fields the
 *  scrape returns. Prioritises the library-side fields (which carry
 *  the modality) over ``seriesType`` (which is verbose). When
 *  ``librarySource`` carries "single cell" the row is flagged
 *  ``sc`` so single-cell experiments stand out from bulk RNA-seq.
 */
function deriveTypeLabel(ident: {
  seriesType?: string;
  series_type?: string;
  libraryStrategy?: string;
  library_strategy?: string;
  librarySource?: string;
  library_source?: string;
}): string {
  const seriesType = (ident.seriesType ?? ident.series_type ?? "").toString();
  const libStrategy =
    (ident.libraryStrategy ?? ident.library_strategy ?? "").toString();
  const libSource =
    (ident.librarySource ?? ident.library_source ?? "").toString();
  const isSingleCell = /single[\s-]?cell/i.test(libSource)
    || /single[\s-]?cell/i.test(seriesType);
  if (libStrategy) {
    return isSingleCell ? `${libStrategy} · sc` : libStrategy;
  }
  if (/by array/i.test(seriesType)) return "Microarray";
  if (/high throughput sequencing/i.test(seriesType)) {
    return isSingleCell ? "Seq · sc" : "Seq";
  }
  // Last resort: truncated raw seriesType so the row stays
  // informative without blowing out the column width.
  return seriesType.length > 28
    ? seriesType.slice(0, 25) + "…"
    : (seriesType || "—");
}

function TriageRow({
  ticketId,
  target,
  meta,
}: {
  ticketId: number;
  target: TicketTarget;
  meta: CandidateMeta | undefined;
}) {
  const patch = usePatchTicketTarget(ticketId);
  const ident = (meta?.identifying_metadata ?? null) as
    | (Record<string, unknown> & {
        title?: string;
        summary?: string;
        numSamples?: number;
        num_samples?: number;
        pubMedIds?: (string | number)[];
        pub_med_ids?: (string | number)[];
        organisms?: string[];
        platform?: string;
        seriesType?: string;
        series_type?: string;
        libraryStrategy?: string;
        library_strategy?: string;
        librarySource?: string;
        library_source?: string;
        releaseDate?: string;
        release_date?: string;
      })
    | null;
  const accession = meta?.accession ?? `target ${target.target_id}`;
  const title = ident?.title ?? "";
  const summary = ident?.summary ?? "";
  const numSamples = ident?.numSamples ?? ident?.num_samples;
  const pmids = (ident?.pubMedIds ?? ident?.pub_med_ids ?? []) as (
    | string
    | number
  )[];
  const organisms = (ident?.organisms ?? []) as string[];
  const taxonLabel = organisms.length === 0
    ? "—"
    : organisms.length === 1
      ? organisms[0]
      : `${organisms[0]} +${organisms.length - 1}`;
  const typeLabel = ident ? deriveTypeLabel(ident) : "—";
  const matched = meta?.matched_criteria ?? [];
  const disposition = target.triage_disposition ?? null;

  const apply = (next: TicketTargetTriageDisposition) => {
    patch.mutate({
      target_type: "GEO_ACCESSION",
      target_id: target.target_id,
      patch: {
        triage_disposition: next,
        status: next === null ? "NOT_DONE" : "DONE",
      },
    });
  };

  return (
    <tr className="border-t border-slate-200 dark:border-slate-700 align-top">
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="font-mono text-blue-700 dark:text-blue-300">
          <a
            href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {accession}
          </a>
        </div>
        {meta?.preboarding_id != null ? (
          <div className="mt-0.5">
            <a
              href={`#/experiments/preboarding:${meta.preboarding_id}?ticket=${ticketId}`}
              className="text-[10px] text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
              title="Open the preboarding record (read-only) — full identifying metadata, no proposer."
            >
              view ↗
            </a>
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2 max-w-[420px]">
        {title ? (
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {title}
          </div>
        ) : null}
        {summary ? (
          <div className="text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-3">
            {summary}
          </div>
        ) : null}
      </td>
      <td
        className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300 italic"
        title={organisms.join(", ") || undefined}
      >
        {taxonLabel}
      </td>
      <td
        className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300"
        title={
          (ident?.seriesType ?? ident?.series_type) as string | undefined
        }
      >
        {typeLabel}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {matched.map((c) => (
          <CriterionChip key={c} criterion={c} />
        ))}
      </td>
      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {numSamples ?? "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {pmids.length === 0 ? (
          <span className="text-slate-500">—</span>
        ) : (
          pmids.slice(0, 3).map((p) => (
            <a
              key={String(p)}
              href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 dark:text-blue-300 hover:underline mr-1.5"
            >
              {p}
            </a>
          ))
        )}
      </td>
      <td className="px-3 py-2">
        <DispositionPicker
          value={disposition}
          onChange={apply}
          disabled={patch.isPending}
        />
        {patch.isError ? (
          <div className="text-[10px] text-rose-700 mt-1">
            {(patch.error as Error).message}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function DispositionPicker({
  value,
  onChange,
  disabled,
}: {
  value: TicketTargetTriageDisposition;
  onChange: (next: TicketTargetTriageDisposition) => void;
  disabled?: boolean;
}) {
  const baseBtn =
    "px-2 py-0.5 rounded border text-[11px] font-medium transition-colors";
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === "include" ? null : "include")}
        className={
          value === "include"
            ? `${baseBtn} border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-400`
            : `${baseBtn} border-slate-300 bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:border-emerald-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600`
        }
        title="Include this GSE in the follow-up curation ticket."
      >
        Include
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === "exclude" ? null : "exclude")}
        className={
          value === "exclude"
            ? `${baseBtn} border-rose-500 bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-400`
            : `${baseBtn} border-slate-300 bg-slate-50 text-slate-700 hover:bg-rose-50 hover:border-rose-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600`
        }
        title="Reject — do not load into Gemma."
      >
        Exclude
      </button>
    </div>
  );
}

function FinalizedSummary({ res }: { res: TriageFinalizeResponse }) {
  return (
    <div className="card p-3 border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700 text-xs space-y-1">
      <div className="font-semibold text-emerald-900 dark:text-emerald-100">
        Triage finalized
      </div>
      <div className="text-emerald-900 dark:text-emerald-100">
        {res.included.length} include · {res.excluded.length} exclude ·{" "}
        {res.undecided_count} undecided
      </div>
      {res.included.length > 0 ? (
        <div className="text-emerald-800 dark:text-emerald-200">
          Included:{" "}
          <span className="font-mono">
            {res.included.map((c) => c.accession).join(", ")}
          </span>
        </div>
      ) : null}
      <div className="text-emerald-800/80 dark:text-emerald-200/80 italic">
        Run ``scripts/run_triage_followup.py --ticket-id {res.ticket_id}`` to
        spawn the curation ticket.
      </div>
    </div>
  );
}
