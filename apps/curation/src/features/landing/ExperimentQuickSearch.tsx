import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import {
  clearRecentExperiments,
  getRecentExperiments,
  resolveRecentExperiments,
  type RecentExperiment,
} from "./recentExperiments";
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
 *
 * An empty, focused box drops a "recent" list (Paul, 2026-09-16) — the
 * datasets opened in this browser, newest first, from
 * ``recentExperiments.ts``. Both surfaces get it from this one
 * component: the dashboard's full-width row and the header's compact
 * box are the same component, so the list, the keyboard handling and
 * the ticket resolution behind a pick cannot drift between them.
 */
export function ExperimentQuickSearch({
  onSelect,
  variant = "page",
  placeholder,
  className,
  excludeExperimentId,
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
  /** The experiment already on screen, dropped from the recent list.
   *  The header box sits inside a dataset, and that dataset is by
   *  definition the newest entry — offering "go where you already are"
   *  costs the first row of the list. */
  excludeExperimentId?: number | string | null;
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

  // ---- Recent datasets -------------------------------------------
  const inputRef = useRef<HTMLInputElement>(null);
  // Unique per instance: the dashboard suppresses the header's copy, but
  // two boxes on one page would otherwise both claim the same id and
  // `aria-controls` would point at whichever rendered first.
  const listId = `${useId()}-recents`;
  const [focused, setFocused] = useState(false);
  const [stored, setStored] = useState<RecentExperiment[]>([]);
  /** Which row the arrow keys are on. ``-1`` = none, which is what
   *  Enter needs to see to run the search instead of opening a row. */
  const [highlight, setHighlight] = useState(-1);

  // Re-read on every focus rather than once on mount: the other copy
  // of this box, or another tab, may have recorded a visit since.
  useEffect(() => {
    if (focused) setStored(getRecentExperiments());
  }, [focused]);

  const recents = useMemo(
    () => resolveRecentExperiments(stored, datasets ?? [], excludeExperimentId),
    [stored, datasets, excludeExperimentId],
  );
  // Only on an empty box — once there is a query, the match readout is
  // the answer and a list of unrelated datasets under it is noise.
  //
  // 🛑 Opens with NO rows too. The header box drops the dataset the
  // curator is already in, so on a fresh browser the one recorded visit
  // is the one excluded and the list resolves to nothing — and a focused
  // box that renders nothing at all is indistinguishable from the
  // feature being broken (which is exactly how it read on first use).
  // The panel says what it is and what fills it instead.
  const recentsOpen = focused && !query.trim() && !resolving;

  useEffect(() => {
    if (!recentsOpen) setHighlight(-1);
  }, [recentsOpen]);

  /** The rows are picked with the pointer down held inert (see the list's
   *  ``onMouseDown``), so this runs with focus still in the input. */
  function pickRecent(r: RecentExperiment) {
    setFocused(false);
    setHighlight(-1);
    inputRef.current?.blur();
    void openExperiment(r.id, r.label);
  }

  function onRecentsKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false);
      setHighlight(-1);
      return;
    }
    if (!recentsOpen) return;
    if (e.key === "ArrowDown") {
      setHighlight((h) => Math.min(h + 1, recents.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      // Arrowing up off the first row returns to "nothing targeted", so
      // the next Enter searches rather than opening a row the curator
      // has stepped back off.
      setHighlight((h) => (h <= 0 ? -1 : h - 1));
      e.preventDefault();
    } else if (e.key === "Enter" && highlight >= 0 && recents[highlight]) {
      // Ahead of the form's submit, which an empty box sends to the
      // browse page.
      e.preventDefault();
      pickRecent(recents[highlight]);
    }
  }

  const recentList = recentsOpen ? (
    <RecentDropdown
      items={recents}
      highlight={highlight}
      id={listId}
      align={variant === "compact" ? "right" : "left"}
      onHover={setHighlight}
      onPick={pickRecent}
      canClear={stored.length > 0}
      emptyHint={
        excludeExperimentId == null
          ? "Datasets you open show up here."
          : "Datasets you open show up here — apart from this one."
      }
      onClear={() => {
        clearRecentExperiments();
        setStored([]);
        inputRef.current?.focus();
      }}
    />
  ) : null;

  /** An Enter pressed before the catalogue arrived, held rather than
   *  dropped.
   *
   *  🛑 The guard below used to `return` outright, so an Enter typed
   *  while the count still read "…" did NOTHING and the curator had to
   *  press it again once it read "1". The guard is right — an empty
   *  match list on a cold cache is "not loaded", not "no hits", and
   *  acting on it bounces a real single hit to the browse page — but
   *  silently discarding the keystroke is not: an Enter that does
   *  nothing is indistinguishable from one the box never received.
   *
   *  Holds the QUERY, not a flag: if the curator keeps typing while it
   *  waits, they have moved on and the stale intent is dropped rather
   *  than firing on a string they no longer mean. */
  const [queuedQuery, setQueuedQuery] = useState<string | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    await submit(query.trim());
  }

  /** Open one experiment, with whatever ticket context it has. Shared
   *  by the single-hit jump and a recent-list pick so the two cannot
   *  land a curator in the same dataset with different context. */
  async function openExperiment(
    experimentId: number | string,
    experimentName: string,
  ) {
    setResolving(true);
    let openTickets: Ticket[];
    try {
      const tks = await qc.fetchQuery(
        experimentTicketsQueryOptions(experimentId),
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
      onSelect(experimentId, openTickets[0].id);
    } else if (openTickets.length > 1) {
      setTicketPicker({
        experimentId,
        experimentName,
        tickets: openTickets,
      });
    } else {
      onSelect(experimentId);
    }
  }

  async function submit(q: string) {
    if (!q) {
      navigate("#/all-experiments");
      return;
    }
    // Guarded here as well as on the button because Enter submits a
    // form past a disabled one.
    if (pending) {
      setQueuedQuery(q);
      return;
    }
    // Many (or zero) hits → hand off to the browse table with the
    // filter pre-applied; the curator disambiguates there.
    if (matches.length !== 1) {
      navigate(`#/all-experiments?q=${encodeURIComponent(q)}`);
      return;
    }
    const exp = matches[0];
    await openExperiment(exp.experiment_id, exp.short_name);
  }

  // Fire the held Enter the moment there is something to match against.
  // Only when the box still holds what was submitted — see `queuedQuery`.
  useEffect(() => {
    if (queuedQuery === null || pending) return;
    setQueuedQuery(null);
    if (queuedQuery === query.trim()) void submit(queuedQuery);
    // `submit` reads the current `matches`, which is what has just
    // arrived; re-running on every render would re-fire the same intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedQuery, pending]);

  /** The match readout, as words. One source for the visible strip and
   *  the compact variant's tooltip so they cannot disagree. */
  const readout: string | null = !query.trim()
    ? null
    : queuedQuery !== null
      ? "searching, then opening…"
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
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onRecentsKeyDown}
            placeholder={placeholder ?? "Find an experiment…"}
            aria-label="Find an experiment"
            aria-expanded={recentsOpen}
            aria-controls={recentsOpen ? listId : undefined}
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
          {recentList}
        </form>
        {picker}
      </>
    );
  }

  return (
    <>
      <form
        onSubmit={runSearch}
        className={cn("flex items-center gap-2", className)}
      >
        <div className="relative flex-1 max-w-2xl">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onRecentsKeyDown}
            placeholder={
              placeholder ??
              "Find an experiment — accession (e.g. GSE277000), title, or taxon…"
            }
            aria-label="Find an experiment"
            aria-expanded={recentsOpen}
            aria-controls={recentsOpen ? listId : undefined}
            className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded px-3 py-2 bg-white dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {recentList}
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

/** The recent-datasets list under the box.
 *
 *  Anchored ``absolute`` to the input's wrapper rather than portalled:
 *  neither surface renders this box inside an ``overflow-auto`` panel
 *  (the dashboard row and the app header are both top-level chrome),
 *  which is the case `OntologyTermPicker` portals to escape. */
function RecentDropdown({
  id,
  items,
  highlight,
  align,
  onHover,
  onPick,
  canClear,
  emptyHint,
  onClear,
}: {
  id: string;
  items: RecentExperiment[];
  highlight: number;
  /** The compact box sits at the right end of the header; a
   *  left-anchored list would hang off the window. */
  align: "left" | "right";
  onHover: (index: number) => void;
  onPick: (item: RecentExperiment) => void;
  /** Nothing stored — no rows AND no ``clear``, which would otherwise
   *  offer to forget an empty list. */
  canClear: boolean;
  /** What the panel says with no rows. Worded by the caller because the
   *  header box excludes the dataset on screen and the dashboard has no
   *  dataset to exclude. */
  emptyHint: string;
  onClear: () => void;
}) {
  return (
    <div
      id={id}
      className={cn(
        "absolute top-full z-50 mt-1 overflow-hidden rounded border shadow-lg",
        "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
        align === "right" ? "right-0 w-80" : "left-0 w-full",
      )}
      // Keeps focus in the input, so the click that picks a row lands
      // before any blur can close the list out from under it.
      onMouseDown={(e) => e.preventDefault()}
      onMouseLeave={() => onHover(-1)}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Recent
        </span>
        {canClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-slate-400 hover:text-slate-700 hover:underline dark:text-slate-500 dark:hover:text-slate-200"
            title="Forget the datasets opened in this browser"
          >
            clear
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          {emptyHint}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Recently opened datasets"
          className="max-h-80 overflow-auto py-1"
        >
          {items.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onClick={() => onPick(r)}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "block w-full px-3 py-1.5 text-left",
                  i === highlight
                    ? "bg-blue-50 dark:bg-slate-800"
                    : "bg-transparent",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                    {r.label}
                  </span>
                  {r.taxon ? (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {r.taxon}
                    </span>
                  ) : null}
                </span>
                {r.title ? (
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {r.title}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
