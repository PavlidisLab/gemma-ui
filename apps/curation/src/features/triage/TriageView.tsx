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
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useCreateTicket,
  useFinalizeTriage,
  usePatchTicketTarget,
} from "@/api/tickets";
import type {
  Ticket,
  TicketTarget,
  TicketTargetTriageDisposition,
  TriageFinalizeResponse,
} from "@/api/tickets";
import { DispositionPicker } from "@/components/ui/DispositionPicker";
import {
  followUpTicketBody,
  nextStageFor,
} from "@/features/tickets/nextStage";
import { TriageCloseDialog } from "./TriageCloseDialog";
import { navigate } from "@/routes";
import {
  decisionLabels,
  parsePayload,
  type CandidateMeta,
  type DisplayField,
} from "@/features/triage/triagePayload";

type Filter = "all" | "undecided" | "include" | "exclude" | "unsure";

export function TriageView({ ticket }: { ticket: Ticket }) {
  const parsed = useMemo(() => parsePayload(ticket.payload_json), [
    ticket.payload_json,
  ]);
  const [filter, setFilter] = useState<Filter>("undecided");
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [finalized, setFinalized] = useState<TriageFinalizeResponse | null>(
    null,
  );
  /** The follow-up ticket the unsure rows were carried into, if any.
   *  Held so the finalized summary can NAME it — a curator who just
   *  escalated seven candidates needs the id of the thing that now
   *  holds them, not a claim that triage is done. */
  const [carriedTo, setCarriedTo] = useState<Ticket | null>(null);
  const bulkPatch = usePatchTicketTarget(ticket.id);
  const createTicket = useCreateTicket();

  const { confirmLabel, rejectLabel } = decisionLabels(parsed);
  const PAGE_SIZE = 25;

  // Every target on a screen ticket is a candidate — render them all,
  // not just GEO accessions (mode-B/EE screens carry EXPRESSION_EXPERIMENT
  // targets, and mixed-type tickets are legal).
  const triageTargets = ticket.targets;
  const metaOf = (t: TicketTarget) =>
    parsed.candidates[String(t.target_id)];

  // Generic mode: any candidate carrying ``display_fields`` opts the whole
  // ticket into the self-describing card renderer. Legacy GEO-scrape
  // tickets (no display_fields) keep the fixed table.
  const generic = triageTargets.some(
    (t) => (metaOf(t)?.display_fields?.length ?? 0) > 0,
  );

  // Facet dropdowns, derived from the tier/badge fields the agent
  // attached — one per field label with ≥2 distinct values (e.g.
  // Confidence, Found via, LLM, Full text). Matches the original
  // page's multi-facet filtering without hardcoding any facet.
  const facetDefs = useMemo(() => {
    const values = new Map<string, Set<string>>();
    const present = new Map<string, number>();
    let total = 0;
    for (const t of triageTargets) {
      total++;
      const here = new Set<string>();
      for (const f of metaOf(t)?.display_fields ?? []) {
        if (f.type !== "tier" && f.type !== "badge") continue;
        if (!values.has(f.label)) values.set(f.label, new Set());
        values.get(f.label)!.add(String(f.value));
        here.add(f.label);
      }
      for (const l of here) present.set(l, (present.get(l) ?? 0) + 1);
    }
    const defs: { label: string; options: string[] }[] = [];
    for (const [label, vals] of values) {
      const options = [...vals];
      if ((present.get(label) ?? 0) < total) options.push("(none)");
      if (options.length >= 2) defs.push({ label, options });
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageTargets, parsed.candidates]);

  const counts = useMemo(() => {
    let inc = 0, exc = 0, uns = 0, und = 0;
    for (const t of triageTargets) {
      const d = t.triage_disposition ?? null;
      if (d === "include") inc++;
      else if (d === "exclude") exc++;
      // `unsure` is REVIEWED-and-unresolved and must not fall into
      // `undecided`. Writing this loop with a bare `else` is the
      // natural mistake and would put a curator's work product back in
      // the nobody-has-looked bucket.
      else if (d === "unsure") uns++;
      else und++;
    }
    return {
      include: inc,
      exclude: exc,
      unsure: uns,
      undecided: und,
      total: triageTargets.length,
    };
  }, [triageTargets]);

  const q = search.trim().toLowerCase();
  const filtered = triageTargets.filter((t) => {
    // disposition tab
    const d = t.triage_disposition ?? null;
    if (filter === "undecided" && d !== null) return false;
    if (filter === "include" && d !== "include") return false;
    if (filter === "exclude" && d !== "exclude") return false;
    if (filter === "unsure" && d !== "unsure") return false;
    const meta = metaOf(t);
    // facet dropdowns (tier / badge fields)
    for (const [label, sel] of Object.entries(facets)) {
      if (!sel || sel === "all") continue;
      const vals = (meta?.display_fields ?? [])
        .filter(
          (f) =>
            (f.type === "tier" || f.type === "badge") && f.label === label,
        )
        .map((f) => String(f.value));
      if (sel === "(none)") {
        if (vals.length) return false;
      } else if (!vals.includes(sel)) {
        return false;
      }
    }
    // free-text search across accession + all field values
    if (q) {
      const hay = [
        meta?.accession ?? "",
        ...(meta?.display_fields ?? []).map((f) => String(f.value ?? "")),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllFiltered = () =>
    setSelected(new Set(filtered.map((t) => t.target_id)));
  const clearSelection = () => setSelected(new Set());
  const applyBulk = (d: TicketTargetTriageDisposition) => {
    if (
      selected.size > 100 &&
      !window.confirm(`Apply "${d}" to ${selected.size} rows?`)
    )
      return;
    for (const t of triageTargets) {
      if (!selected.has(t.target_id)) continue;
      bulkPatch.mutate({
        target_type: t.target_type,
        target_id: t.target_id,
        patch: {
          triage_disposition: d,
          status: d === null ? "NOT_DONE" : "DONE",
        },
      });
    }
    clearSelection();
  };

  const finalize = useFinalizeTriage(ticket.id);

  /** The two OPEN states, kept apart because they have different
   *  destinations: never-reviewed can take a blanket decision,
   *  `unsure` cannot (see TriageCloseDialog). */
  const openRows = useMemo(() => {
    const neverReviewed = [];
    const unsure = [];
    for (const t of triageTargets) {
      const d = t.triage_disposition ?? null;
      const row = {
        targetId: t.target_id,
        label: metaOf(t)?.accession || String(t.target_id),
        reason: t.triage_disposition_reason ?? null,
      };
      if (d === null) neverReviewed.push(row);
      else if (d === "unsure") unsure.push(row);
    }
    return { neverReviewed, unsure };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageTargets]);

  const closeTicket = async () => {
    try {
      const res = await finalize.mutateAsync();
      setFinalized(res);
    } catch {
      // Error chip below surfaces details.
    }
  };

  const handleFinalize = async () => {
    // Undecided rows used to be swept to "excluded" by a confirm that
    // only offered cancel. Make it a choice, and show what it lands on.
    // `unsure` blocks the close too — it is reviewed-but-unresolved,
    // which the follow-up ticket can no more act on than an untouched
    // row. `undecidedRows` carries both.
    if (openRows.neverReviewed.length > 0 || openRows.unsure.length > 0) {
      setCloseOpen(true);
      return;
    }
    await closeTicket();
  };

  /** Apply one disposition to every never-reviewed row, then close.
   *  Patches go through the same mutation the bulk bar uses, so the
   *  status/disposition coupling stays in one place. */
  const resolveNeverReviewedThenClose = async (d: "include" | "exclude") => {
    setClosing(true);
    try {
      await Promise.all(
        openRows.neverReviewed.map((r) => {
          const t = triageTargets.find((x) => x.target_id === r.targetId)!;
          return bulkPatch.mutateAsync({
            target_type: t.target_type,
            target_id: t.target_id,
            patch: { triage_disposition: d, status: "DONE" },
          });
        }),
      );
      // Unsure rows may still be open — re-open the dialog rather than
      // closing the ticket out from under them.
      if (openRows.unsure.length === 0) {
        setCloseOpen(false);
        await closeTicket();
      }
    } finally {
      setClosing(false);
    }
  };

  /** Spawn a follow-up SCREENING ticket carrying ONLY the unsure rows,
   *  then close this one. The subset is expressible because
   *  ``TicketCreate.targets`` is a plain list — there is no
   *  inherit-everything behaviour to work around. An assignee makes it
   *  an escalation; blank keeps it with the same owner.
   *
   *  The destination + payload come from ``nextStageFor`` /
   *  ``followUpTicketBody``, shared with the ticket-detail close flow.
   *  That is also where the follow-up picks up the parent's
   *  ``priority`` — spawning it by hand here used to drop it, so the
   *  leftovers of an URGENT screen came back NORMAL. */
  const carryUnsureForward = async (assignee: string) => {
    const stage = nextStageFor(ticket);
    if (!stage) return;
    setClosing(true);
    try {
      const created = await createTicket.mutateAsync(
        followUpTicketBody(
          stage,
          ticket,
          openRows.unsure.map(
            (r) => triageTargets.find((x) => x.target_id === r.targetId)!,
          ),
          { assignee },
        ),
      );
      setCloseOpen(false);
      setCarriedTo(created);
      await closeTicket();
    } finally {
      setClosing(false);
    }
  };

  return (
    <section className="space-y-4">
      {parsed.screen_summary ? (
        <div className="card p-3 text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border-l-2 border-l-blue-400">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            What this screen did:{" "}
          </span>
          {parsed.screen_summary}
        </div>
      ) : null}

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
          label={`To review (${counts.undecided})`}
          active={filter === "undecided"}
          onClick={() => { setFilter("undecided"); setPage(0); }}
        />
        <FilterButton
          label={`${confirmLabel} (${counts.include})`}
          active={filter === "include"}
          onClick={() => { setFilter("include"); setPage(0); }}
        />
        <FilterButton
          label={`${rejectLabel} (${counts.exclude})`}
          active={filter === "exclude"}
          onClick={() => { setFilter("exclude"); setPage(0); }}
        />
        {/* Only shown once something is unsure — an empty bucket is
            noise on the common ticket, and the tab appearing IS the
            signal that a leftover class exists. */}
        {counts.unsure > 0 ? (
          <FilterButton
            label={`Unsure (${counts.unsure})`}
            active={filter === "unsure"}
            onClick={() => { setFilter("unsure"); setPage(0); }}
          />
        ) : null}
        <FilterButton
          label={`All (${counts.total})`}
          active={filter === "all"}
          onClick={() => { setFilter("all"); setPage(0); }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="search accession, paper, text…"
          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 min-w-[200px]"
        />
        {facetDefs.map((fd) => (
          <select
            key={fd.label}
            value={facets[fd.label] ?? "all"}
            onChange={(e) => {
              setFacets((prev) => ({ ...prev, [fd.label]: e.target.value }));
              setPage(0);
            }}
            className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
            title={`Filter by ${fd.label}`}
          >
            <option value="all">{fd.label.toLowerCase()}: all</option>
            {fd.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ))}
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

      <TriageCloseDialog
        open={closeOpen}
        neverReviewed={openRows.neverReviewed}
        unsure={openRows.unsure}
        includedCount={counts.include}
        excludedCount={counts.exclude}
        busy={closing || finalize.isPending || createTicket.isPending}
        onResolveNeverReviewed={resolveNeverReviewedThenClose}
        onCarryForward={carryUnsureForward}
        onCancel={() => {
          setCloseOpen(false);
          // Drop them on the "To review" tab rather than just closing
          // the dialog — "go back and decide" should land the curator
          // where the undecided rows are, not where they were.
          setFilter("undecided");
          setPage(0);
        }}
      />

      {finalize.isError ? (
        <div className="text-xs text-rose-700 dark:text-rose-400">
          finalize failed: {(finalize.error as Error).message}
        </div>
      ) : null}

      {finalized ? (
        <FinalizedSummary res={finalized} carriedTo={carriedTo} />
      ) : null}

      {/* Bulk bar is about SELECTION, not about which renderer the
          ticket opted into — it used to be gated on ``generic``, so a
          legacy GEO-scrape ticket (no ``display_fields``) had no
          select-all and no way to decide more than one row at a time.
          Ticket 180 is exactly that shape: 19 candidates, zero
          display_fields. */}
      {filtered.length > 0 ? (
        <div
          className={
            "flex items-center gap-3 flex-wrap text-xs px-3 py-2 rounded " +
            (selected.size > 0
              ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
              : "text-slate-600 dark:text-slate-300")
          }
        >
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.size >= filtered.length}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    selected.size > 0 && selected.size < filtered.length;
              }}
              onChange={(e) =>
                e.target.checked ? selectAllFiltered() : clearSelection()
              }
            />
            Select all {filtered.length}
          </label>
          {selected.size > 0 ? (
            <>
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {selected.size} selected
              </span>
              <button
                type="button"
                className="btn primary text-xs"
                onClick={() => applyBulk("include")}
              >
                {confirmLabel} selected
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                onClick={() => applyBulk("exclude")}
              >
                {rejectLabel} selected
              </button>
              {/* Undecide in bulk. A decision is reversible one row at
                  a time (click the lit side again); without this the
                  only way to undo a mis-aimed bulk apply was to walk
                  the rows back by hand. */}
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => applyBulk(null)}
                title="Set the selected rows back to undecided"
              >
                Undecide selected
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">
              — tip: filter first, then Select all to decide in bulk
            </span>
          )}
        </div>
      ) : null}

      <Pager
        page={safePage}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        onPage={setPage}
      />

      {filtered.length === 0 ? (
        <div className="card px-3 py-6 text-center italic text-slate-500 text-xs">
          No candidates match the current filter.
        </div>
      ) : generic ? (
        <div className="space-y-3">
          {paged.map((t) => (
            <CandidateCard
              key={t.target_id}
              ticketId={ticket.id}
              target={t}
              meta={metaOf(t)}
              confirmLabel={confirmLabel}
              rejectLabel={rejectLabel}
              selected={selected.has(t.target_id)}
              onToggleSelect={() => toggleSelect(t.target_id)}
            />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800 text-left text-slate-700 dark:text-slate-200">
              <tr>
                <th className="px-2 py-2 w-7" />
                <th className="px-3 py-2 font-medium">GSE</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Taxon</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Matched</th>
                <th className="px-3 py-2 font-medium">Samples</th>
                <th className="px-3 py-2 font-medium">PMIDs</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-2 py-2 w-6" />
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => (
                <TriageRow
                  key={t.target_id}
                  ticketId={ticket.id}
                  target={t}
                  meta={metaOf(t)}
                  confirmLabel={confirmLabel}
                  rejectLabel={rejectLabel}
                  selected={selected.has(t.target_id)}
                  onToggleSelect={() => toggleSelect(t.target_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        page={safePage}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        onPage={setPage}
      />
    </section>
  );
}

/** Prev / range / Next pager. Rendered both above and below the
 *  candidate list (design review: page-through nav belongs at the top and the
 *  bottom). Self-hides when the whole filtered set fits one page. */
function Pager({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-xs text-slate-600 dark:text-slate-300">
      <button
        type="button"
        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 disabled:opacity-40"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
      >
        ‹ Prev
      </button>
      <span>
        {page * pageSize + 1}–{Math.min(total, page * pageSize + pageSize)} of{" "}
        {total}
      </span>
      <button
        type="button"
        className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 disabled:opacity-40"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount - 1}
      >
        Next ›
      </button>
    </div>
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
  confirmLabel,
  rejectLabel,
  selected,
  onToggleSelect,
}: {
  ticketId: number;
  target: TicketTarget;
  meta: CandidateMeta | undefined;
  /** The ticket's own decision verbs. The GEO-scrape table used to
   *  render the DispositionPicker's defaults, so a ticket that specced
   *  "Confirm / Reject" still showed "Include / Exclude" here. */
  confirmLabel: string;
  rejectLabel: string;
  selected: boolean;
  onToggleSelect: () => void;
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

  const apply = (
    next: TicketTargetTriageDisposition,
    reason?: string,
  ) => {
    patch.mutate({
      target_type: "GEO_ACCESSION",
      target_id: target.target_id,
      patch: {
        triage_disposition: next,
        // `unsure` counts as decided — the coupling keys on the
        // decision being non-null, not on which decision it is.
        status: next === null ? "NOT_DONE" : "DONE",
        ...(reason ? { triage_disposition_reason: reason } : {}),
      },
    });
  };

  const detailHref =
    meta?.preboarding_id != null
      ? `#/experiments/preboarding:${meta.preboarding_id}?ticket=${ticketId}`
      : null;

  // The whole row opens the candidate. The accession link below is the
  // real, keyboard-reachable control; this just widens the target to
  // the full row for a mouse, because a 10px "view ↗" was the only way
  // in and nobody should have to aim at that. Clicks that land on
  // something interactive, or that finish a drag-select, are left
  // alone — same trade-off the samples table makes with its row gutter.
  const onRowClick = (e: ReactMouseEvent<HTMLTableRowElement>) => {
    if (!detailHref) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("a,button,input,label,select,textarea")
    )
      return;
    if (window.getSelection()?.toString()) return;
    navigate(detailHref);
  };

  return (
    <tr
      className={
        "border-t border-slate-200 dark:border-slate-700 align-top " +
        (detailHref
          ? "cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-900/20"
          : "")
      }
      onClick={onRowClick}
    >
      <td className="px-2 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${accession}`}
        />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {/* The accession opens OUR page. It used to link out to NCBI,
            which meant the most prominent thing on the row navigated
            away from the app and the way further in was a 10px link
            underneath. GEO is still one click, just no longer the
            default one. */}
        <div className="font-mono text-blue-700 dark:text-blue-300">
          {detailHref ? (
            <a
              href={detailHref}
              className="hover:underline"
              title="Open this candidate — full identifying metadata, and the decision."
            >
              {accession}
            </a>
          ) : (
            <span className="text-slate-700 dark:text-slate-200">
              {accession}
            </span>
          )}
        </div>
        <div className="mt-0.5">
          <a
            href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
            title="Open the GEO record at NCBI in a new tab"
          >
            GEO ↗
          </a>
        </div>
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
          confirmLabel={confirmLabel}
          rejectLabel={rejectLabel}
          showUnsure
          reason={target.triage_disposition_reason}
        />
        {patch.isError ? (
          <div className="text-[10px] text-rose-700 mt-1">
            {(patch.error as Error).message}
          </div>
        ) : null}
      </td>
      {/* Trailing chevron — says "this row goes somewhere" without
          making the curator hunt for a link to prove it. */}
      <td className="px-2 py-2 align-middle text-right">
        {detailHref ? (
          <a
            href={detailHref}
            className="inline-block px-1 text-slate-400 hover:text-blue-700 dark:hover:text-blue-300 text-base leading-none"
            aria-label={`Open ${accession}`}
            title="Open this candidate"
          >
            ›
          </a>
        ) : null}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Generic display_fields renderer — the self-describing card path.
// ---------------------------------------------------------------------------

const GROUP_ORDER = ["study", "paper", "decision"];
const GROUP_LABEL: Record<string, string> = {
  study: "Study",
  paper: "Candidate paper",
  decision: "Why surfaced",
};

function tierTone(value: string): string {
  const v = value.toLowerCase();
  if (v === "high")
    return "border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
  if (v === "medium" || v === "med")
    return "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  if (v === "low")
    return "border-rose-400 bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100";
  return "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
}

function FieldChip({ f }: { f: DisplayField }) {
  const text = String(f.value);
  const tone =
    f.type === "tier"
      ? tierTone(text)
      : "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return (
    <span
      title={f.label}
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${tone}`}
    >
      {f.type === "tier" ? `${f.label}: ${text}` : text}
    </span>
  );
}

// Paint producer-supplied overlap terms in a contrasting, theme-aware mark so
// the shared surname / institution token / content word lights up on both
// sides. Case-insensitive, word-boundary-anchored, longest-first so a term is
// never swallowed by a shorter prefix. Returns the original string untouched
// when there is nothing to highlight.
function highlightTerms(
  text: string,
  terms: string[] | undefined,
): ReactNode {
  if (!terms || terms.length === 0 || !text) return text;
  const uniq = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
  if (uniq.length === 0) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = uniq
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join("|");
  // \b works for the ASCII/gene-symbol tokens the producer emits.
  const re = new RegExp(`(\\b(?:${pattern})\\b)`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-sm bg-amber-200 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function FieldRow({ f }: { f: DisplayField }) {
  const text = String(f.value);
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1.5">
        {f.label}
      </span>
      {f.type === "link" && f.href ? (
        <a
          href={f.href}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 dark:text-blue-300 hover:underline break-all"
        >
          {text}
        </a>
      ) : f.type === "longtext" ? (
        <div className="mt-0.5 text-slate-700 dark:text-slate-300 max-h-28 overflow-auto whitespace-pre-wrap">
          {highlightTerms(text, f.highlight)}
        </div>
      ) : (
        <span className="text-slate-800 dark:text-slate-200">
          {highlightTerms(text, f.highlight)}
        </span>
      )}
    </div>
  );
}

/** A candidate rendered from its self-describing ``display_fields`` —
 *  chips (tier/badge) float to the header, everything else groups into
 *  panels. Domain-agnostic: pub-finder, TF-perturbation, and cell-line
 *  screens all render through this one component. */
function CandidateCard({
  ticketId,
  target,
  meta,
  confirmLabel,
  rejectLabel,
  selected,
  onToggleSelect,
}: {
  ticketId: number;
  target: TicketTarget;
  meta: CandidateMeta | undefined;
  confirmLabel: string;
  rejectLabel: string;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const patch = usePatchTicketTarget(ticketId);
  const [preview, setPreview] = useState(false);
  const fields = meta?.display_fields ?? [];
  const accession = meta?.accession ?? `target ${target.target_id}`;
  const studyTitle = (
    meta?.identifying_metadata as { title?: string } | null | undefined
  )?.title;
  const disposition = target.triage_disposition ?? null;

  const apply = (
    next: TicketTargetTriageDisposition,
    reason?: string,
  ) => {
    patch.mutate({
      target_type: target.target_type,
      target_id: target.target_id,
      patch: {
        triage_disposition: next,
        // `unsure` counts as decided — the coupling keys on the
        // decision being non-null, not on which decision it is.
        status: next === null ? "NOT_DONE" : "DONE",
        ...(reason ? { triage_disposition_reason: reason } : {}),
      },
    });
  };

  // All fields group into the body panels (incl. tier/badge chips) so
  // the header stays clean — accession + full title + actions only.
  const seen = new Set<string>();
  const groupKeys = [
    ...GROUP_ORDER,
    ...fields.map((f) => f.group ?? ""),
  ].filter((g) => {
    if (seen.has(g)) return false;
    seen.add(g);
    return fields.some((f) => (f.group ?? "") === g);
  });

  return (
    <div
      className={
        "card overflow-hidden" +
        (selected ? " ring-2 ring-blue-400 dark:ring-blue-500" : "")
      }
    >
      <div className="flex items-start gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 shrink-0 cursor-pointer"
          title="Select for bulk action"
        />
        <a
          href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono font-semibold text-blue-700 dark:text-blue-300 hover:underline shrink-0 pt-0.5"
        >
          {accession}
        </a>
        {studyTitle ? (
          <span className="text-[13px] font-medium text-slate-900 dark:text-slate-100 flex-1 min-w-0 pt-0.5">
            {studyTitle}
          </span>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline"
            title="View the study in the curation UI (read-only, pulled from Gemma REST)"
          >
            View study
          </button>
          <a
            href={`https://gemma.msl.ubc.ca/expressionExperiment/showExpressionExperiment.html?shortName=${accession}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline"
            title="Open this study in Gemma"
          >
            Gemma ↗
          </a>
          <DispositionPicker
            value={disposition}
            onChange={apply}
            disabled={patch.isPending}
            confirmLabel={confirmLabel}
            rejectLabel={rejectLabel}
            showUnsure
            reason={target.triage_disposition_reason}
          />
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-x-5 gap-y-3 px-3 py-2.5 text-xs">
        {groupKeys.map((g) => {
          const gfields = fields.filter((f) => (f.group ?? "") === g);
          const gchips = gfields.filter(
            (f) => f.type === "tier" || f.type === "badge",
          );
          const grows = gfields.filter(
            (f) => f.type !== "tier" && f.type !== "badge",
          );
          return (
            <div key={g} className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                {GROUP_LABEL[g] ?? g}
              </div>
              <div className="space-y-1.5">
                {gchips.length ? (
                  <div className="flex flex-wrap gap-1">
                    {gchips.map((f, i) => (
                      <FieldChip key={i} f={f} />
                    ))}
                  </div>
                ) : null}
                {grows.map((f, i) => (
                  <FieldRow key={i} f={f} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {patch.isError ? (
        <div className="px-3 pb-2 text-[10px] text-rose-700">
          {(patch.error as Error).message}
        </div>
      ) : null}
      {preview ? (
        <StudyPreview accession={accession} onClose={() => setPreview(false)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only study preview — pulls the experiment straight from Gemma REST
// (via the /gemma-ro proxy) and renders it read-only. Spike for the
// "view the study in the curation UI, nothing editable" requirement.
// ---------------------------------------------------------------------------

interface GemmaDataset {
  id?: number;
  name?: string;
  description?: string;
  accession?: string;
  externalDatabase?: string;
  numberOfBioAssays?: number;
  numberOfArrayDesigns?: number;
  technologyType?: string;
  isPublic?: boolean;
  troubled?: boolean;
  taxon?: { scientificName?: string; commonName?: string };
  geeq?: { publicQualityScore?: number; publicSuitabilityScore?: number };
  characteristics?: { value?: string; valueUri?: string }[];
}

function StudyPreview({
  accession,
  onClose,
}: {
  accession: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    data?: GemmaDataset;
  }>({ loading: true });

  useEffect(() => {
    let alive = true;
    fetch(`/gemma-ro/datasets/${encodeURIComponent(accession)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (alive)
          setState({ loading: false, data: (j?.data ?? [])[0] as GemmaDataset });
      })
      .catch((e) => {
        if (alive) setState({ loading: false, error: String(e.message ?? e) });
      });
    return () => {
      alive = false;
    };
  }, [accession]);

  const d = state.data;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[85vh] overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <a
            href={`https://gemma.msl.ubc.ca/expressionExperiment/showExpressionExperiment.html?shortName=${accession}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono font-semibold text-blue-700 dark:text-blue-300 hover:underline"
          >
            {accession}
          </a>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
              read-only · Gemma REST
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        {state.loading ? (
          <div className="text-xs italic text-slate-500 py-8 text-center">
            loading from Gemma…
          </div>
        ) : state.error ? (
          <div className="text-xs text-rose-700 py-8 text-center">
            could not load from Gemma: {state.error}
          </div>
        ) : d ? (
          <StudyReadonlyBody d={d} />
        ) : (
          <div className="text-xs italic text-slate-500 py-8 text-center">
            not found in Gemma
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 w-32 shrink-0">{label}</span>
      <span className="text-slate-800 dark:text-slate-200">{children}</span>
    </div>
  );
}

function StudyReadonlyBody({ d }: { d: GemmaDataset }) {
  const taxon = d.taxon?.scientificName ?? d.taxon?.commonName;
  const q = d.geeq?.publicQualityScore;
  const s = d.geeq?.publicSuitabilityScore;
  const chars = d.characteristics ?? [];
  return (
    <div className="space-y-3 text-xs">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {d.name}
      </div>
      <div className="space-y-1">
        <PreviewRow label="Gemma id">{d.id}</PreviewRow>
        <PreviewRow label="Source">
          {d.externalDatabase} {d.accession}
        </PreviewRow>
        {taxon ? <PreviewRow label="Taxon">{taxon}</PreviewRow> : null}
        <PreviewRow label="Assays">{d.numberOfBioAssays ?? "—"}</PreviewRow>
        <PreviewRow label="Platforms">
          {d.numberOfArrayDesigns ?? "—"}
        </PreviewRow>
        {d.technologyType ? (
          <PreviewRow label="Technology">{d.technologyType}</PreviewRow>
        ) : null}
        {q != null ? (
          <PreviewRow label="GEEQ quality">{q.toFixed(2)}</PreviewRow>
        ) : null}
        {s != null ? (
          <PreviewRow label="GEEQ suitability">{s.toFixed(2)}</PreviewRow>
        ) : null}
        <PreviewRow label="Public">{String(d.isPublic)}</PreviewRow>
        <PreviewRow label="Troubled">{String(d.troubled)}</PreviewRow>
      </div>
      {d.description ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Description
          </div>
          <div className="max-h-40 overflow-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">
            {d.description}
          </div>
        </div>
      ) : null}
      {chars.length ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Annotations ({chars.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {chars.slice(0, 40).map((c, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                {c.value ?? c.valueUri ?? "—"}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FinalizedSummary({
  res,
  carriedTo,
}: {
  res: TriageFinalizeResponse;
  /** Follow-up ticket the unsure rows went into, when the curator
   *  carried them forward. Null on a plain close. */
  carriedTo: Ticket | null;
}) {
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
      {carriedTo ? (
        // The escalation is the part the curator can't reconstruct
        // later: which ticket holds the rows they couldn't resolve,
        // and who it went to. Name it and link it.
        <div className="text-amber-800 dark:text-amber-200">
          {carriedTo.targets.length} unresolved carried into{" "}
          <a
            href={`#/tickets/${carriedTo.id}`}
            className="font-medium underline underline-offset-2"
          >
            ticket #{carriedTo.id}
          </a>
          {carriedTo.assignee_name ? ` · assigned to ${carriedTo.assignee_name}` : null}
        </div>
      ) : null}
      <div className="text-emerald-800/80 dark:text-emerald-200/80 italic">
        Run ``scripts/run_triage_followup.py --ticket-id {res.ticket_id}`` to
        spawn the curation ticket.
      </div>
    </div>
  );
}
