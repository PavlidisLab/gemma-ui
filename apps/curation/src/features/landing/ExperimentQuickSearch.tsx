import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useDatasets,
  useDatasetSearch,
  datasetMatchesQuery,
} from "@/api/datasets";
import { experimentTicketsQueryOptions, type Ticket } from "@/api/tickets";
import { navigate } from "@/routes";
import { Spinner } from "@/components/ui/Spinner";
import { TicketPickerModal } from "./TicketPickerModal";
import { cn } from "@/lib/cn";

/**
 * "Find an experiment" — accession, short name, title or taxon across
 * the whole curation catalogue.
 *
 * Lifted out of ``CuratorDashboard`` 2026-08-20 so the app header can
 * carry the same box (Paul: *"we have room here to add a
 * search-for-experiment box that works like the one on the
 * dashboard"*). 🛑 Extracted rather than reimplemented — the useful
 * part of this is not the input, it is everything behind submit:
 *
 *  - the catalogue-still-loading guard, without which an early Enter
 *    reads the empty match list as "not one hit" and bounces to the
 *    browse page, losing the straight jump for what really is a single
 *    hit;
 *  - "no matches" being distinguishable from "no catalogue yet", which
 *    otherwise look identical on a cold cache and the wrong one
 *    arrives first;
 *  - resolving ticket context on a single hit, because experiments ↔
 *    tickets is many-to-many: 0 opens plain, 1 opens with it live,
 *    and >1 has to ask.
 *
 * A second copy of that would drift on the first change to any of the
 * three.
 */
export function ExperimentQuickSearch({
  onSelect,
  variant = "page",
  placeholder,
  className,
}: {
  /** Where a resolved hit goes. The dashboard routes through its own
   *  selection handler; the header navigates. */
  onSelect: (experimentId: number | string, ticketId?: number) => void;
  /** ``page`` — the dashboard's full-width row with a Search button and
   *  a match readout beside it. ``compact`` — the header's single
   *  input, submitting on Enter, with the readout as a tooltip so it
   *  cannot reflow the nav bar. */
  variant?: "page" | "compact";
  placeholder?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  // ``isLoading`` is the no-data-yet state — exactly "there is nothing
  // to match against". A background revalidation keeps the cached
  // catalogue and leaves it false, which is right: those matches are
  // real.
  const {
    data: datasets,
    isLoading: catalogueLoading,
    isError: catalogueFailed,
  } = useDatasets();
  const [query, setQuery] = useState("");
  // While resolving a single hit's ticket context (an async call),
  // disable the form so a double-submit can't fire two navigations.
  const [resolving, setResolving] = useState(false);
  const [ticketPicker, setTicketPicker] = useState<{
    experimentId: number | string;
    experimentName: string;
    tickets: Ticket[];
  } | null>(null);

  // 🛑 In remote mode the matching happens on the SERVER.
  //
  // The catalogue this box filters is a bounded prefix of Gemma's
  // ~25,700 (`REMOTE_CATALOGUE_CAP`), so a client-side filter answers
  // "no matches" for anything past the cut — GSE107613 is real, sits at
  // id 14164, and this box said nothing about it. Gemma's `query=`
  // searches the whole corpus, by accession and by title.
  //
  // Local mode keeps filtering in the browser: the store is ~600 rows
  // already in hand, and a round trip per keystroke would be a
  // regression there.
  const search = useDatasetSearch(query);
  const matches = useMemo(
    () =>
      !query.trim()
        ? []
        : search.data
          ? search.data
          : (datasets ?? []).filter((r) => datasetMatchesQuery(r, query)),
    [datasets, query, search.data],
  );
  // "Nothing to match against yet" now has two sources: the catalogue
  // still loading (local) and the search still in flight (remote). Both
  // must read as "still looking" rather than "no matches", which is the
  // wrong answer given confidently and the one that arrives first.
  const pending = catalogueLoading || (search.isFetching && !search.data);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      navigate("#/all-experiments");
      return;
    }
    // Guarded here as well as on the button because Enter submits a
    // form past a disabled one.
    if (pending) return;
    // Many (or zero) hits → hand off to the browse table with the
    // filter pre-applied; the curator disambiguates there.
    if (matches.length !== 1) {
      navigate(`#/all-experiments?q=${encodeURIComponent(q)}`);
      return;
    }
    const exp = matches[0];
    setResolving(true);
    let openTickets: Ticket[];
    try {
      const tks = await qc.fetchQuery(
        experimentTicketsQueryOptions(exp.experiment_id),
      );
      openTickets = tks.filter(
        (t) => t.state === "OPEN" || t.state === "IN_PROGRESS",
      );
    } catch {
      // Endpoint unavailable / transient error — degrade to opening the
      // experiment plain rather than blocking the jump.
      openTickets = [];
    } finally {
      setResolving(false);
    }
    if (openTickets.length === 1) {
      onSelect(exp.experiment_id, openTickets[0].id);
    } else if (openTickets.length > 1) {
      setTicketPicker({
        experimentId: exp.experiment_id,
        experimentName: exp.short_name,
        tickets: openTickets,
      });
    } else {
      onSelect(exp.experiment_id);
    }
  }

  /** The match readout, as words. One source for the visible strip and
   *  the compact variant's tooltip so they cannot disagree. */
  const readout: string | null = !query.trim()
    ? null
    : pending
      ? "searching…"
      : catalogueFailed || search.isError
        ? "couldn't reach the catalogue"
        : matches.length === 0
          ? "no matches"
          : matches.length === 1
            ? `1 match → opens ${matches[0].short_name}`
            : `${matches.length} matches → browse`;

  const picker = ticketPicker ? (
    <TicketPickerModal
      experimentName={ticketPicker.experimentName}
      tickets={ticketPicker.tickets}
      onPick={(ticketId) => {
        const { experimentId } = ticketPicker;
        setTicketPicker(null);
        onSelect(experimentId, ticketId);
      }}
      onOpenPlain={() => {
        const { experimentId } = ticketPicker;
        setTicketPicker(null);
        onSelect(experimentId);
      }}
      onCancel={() => setTicketPicker(null)}
    />
  ) : null;

  if (variant === "compact") {
    return (
      <>
        <form onSubmit={runSearch} className={cn("relative", className)}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder ?? "Find an experiment…"}
            aria-label="Find an experiment"
            // The readout rides on the input rather than beside it: a
            // strip that appears mid-typing would reflow the whole nav
            // bar on every keystroke.
            title={readout ?? undefined}
            disabled={resolving}
            className={cn(
              // `pr-12` leaves room for BOTH the match count and the
              // native `type="search"` clear glyph, which sits at the
              // far right on WebKit — the count was landing underneath
              // it and reading as part of the button.
              "w-48 lg:w-64 text-xs border rounded pl-2 pr-12 py-1",
              "border-slate-300 bg-white text-slate-800 placeholder:text-slate-400",
              "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60",
            )}
          />
          {/* A one-word state, only when there is something to say. The
              curator is mid-nav here and cannot see a match count that
              only exists in a tooltip. */}
          {query.trim() && !resolving ? (
            <span
              className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400 dark:text-slate-500"
              aria-hidden
            >
              {pending
                ? "…"
                : catalogueFailed
                  ? "!"
                  : matches.length === 0
                    ? "0"
                    : matches.length}
            </span>
          ) : null}
        </form>
        {picker}
      </>
    );
  }

  return (
    <>
      <form onSubmit={runSearch} className={cn("flex items-center gap-2", className)}>
        <div className="relative flex-1 max-w-2xl">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              placeholder ??
              "Find an experiment — accession (e.g. GSE277000), title, or taxon…"
            }
            aria-label="Find an experiment"
            className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded px-3 py-2 bg-white dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={resolving || pending}
          className="text-sm px-3 py-2 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
          title={pending ? "Looking…" : undefined}
        >
          {resolving ? "Opening…" : "Search"}
        </button>
        {readout ? (
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums inline-flex items-center gap-1.5">
            {pending ? <Spinner size={11} /> : null}
            {readout}
          </span>
        ) : null}
      </form>
      {picker}
    </>
  );
}
