import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import {
  experimentTicketsQueryOptions,
  ticketQueryOptions,
  useAddTicketTargets,
  useRemoveTicketTarget,
  useTicketSearch,
  type Ticket,
  type TicketSearchHit,
} from "@/api/tickets";
import { cn } from "@/lib/cn";
import { CreateTicketForExperimentModal } from "./CreateTicketForExperimentModal";
import {
  forgetRecentTicketId,
  getRecentTicketIds,
  pushRecentTicketId,
  visibleRecentTickets,
} from "./recentTickets";

/**
 * Ticket management for the experiment in front of the curator.
 *
 * Paul, 2026-08-31: *"we are going to make this button do ticket
 * management: it should have a dropdown: add to ticket; make ticket from
 * this experiment … but it also has to take you back to the current
 * ticket. it should show if the dataset is in multiple tickets."*
 *
 * Three sections, in the order a curator needs them:
 *
 *   1. **In these tickets** — every ticket holding this experiment,
 *      from `GET /datasets/{id}/tickets`. This is the multiple-tickets
 *      answer, and it is one call rather than a scan. Click to go
 *      there; remove where the ticket allows it.
 *   2. **Recent** — the curator's MRU, minus anything already listed
 *      above. Click to ADD this experiment to that ticket. A scratchpad
 *      is by definition the ticket just used, so it sits at the top
 *      here and never needs a search box.
 *   3. **New ticket from this experiment…**
 *
 * 🛑 **Adding does not change the curator's ticket context.** Adding is
 * bookkeeping; entering a ticket is navigation. Conflating them means a
 * misclick silently moves the frame of reference the comparison chips
 * and the ‹ › walker are anchored to.
 *
 * Typing finds a ticket the curator has never opened — `GET
 * /tickets/search`, live since gemma2 `96605f3cee3f`. Recents stay
 * above it: "the one I was just in" should never require typing, and a
 * scratchpad is by definition the ticket just used. The menu
 * degrades honestly without it — recents plus current membership covers
 * the scratchpad workflow completely — and the search box will be an
 * addition rather than a rework, because "the one I was just in" should
 * never require typing.
 */
export function TicketMenu({
  experimentId,
  experimentLabel,
  /** The ticket the curator arrived from, when there is one. Rendered
   *  first and marked, so "take me back" is the top item. */
  currentTicketId,
  onClose,
}: {
  experimentId: number;
  experimentLabel: string;
  currentTicketId?: number | null;
  onClose: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read once per open. The MRU is not reactive state — it changes as a
  // side effect of navigation, and re-reading it mid-open would reorder
  // the menu under the curator's cursor.
  const recentIds = useMemo(() => getRecentTicketIds(), []);

  const membership = useQuery(experimentTicketsQueryOptions(experimentId));
  const memberTickets = membership.data ?? [];
  const memberIds = new Set(memberTickets.map((t) => t.id));

  // 🛑 Resolve every recent id against the server. A stored title goes
  // stale; a ticket that has been closed, deleted, or is no longer
  // visible to this curator must not be offered. Anything that fails to
  // resolve is dropped from storage so the menu self-heals.
  const recentQueries = useQueries({
    queries: recentIds.map((id) => ({
      ...ticketQueryOptions(id),
      retry: false,
    })),
  });
  const resolvedRecents = recentQueries
    .map((q) => q.data)
    .filter((t): t is Ticket => !!t);
  useEffect(() => {
    recentQueries.forEach((q, i) => {
      if (q.isError) forgetRecentTicketId(recentIds[i]);
    });
    // Only when an error appears; recentIds is stable for this open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentQueries.map((q) => q.isError).join(",")]);

  const recents = visibleRecentTickets(recentIds, resolvedRecents, memberIds);

  return (
    <div className="w-80 text-xs">
      {membership.isLoading ? (
        <p className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
          Loading tickets…
        </p>
      ) : memberTickets.length === 0 ? (
        <p className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
          This experiment is not on any ticket.
        </p>
      ) : (
        <>
          <SectionLabel>
            {memberTickets.length === 1
              ? "On this ticket"
              : `On ${memberTickets.length} tickets`}
          </SectionLabel>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {memberTickets.map((t) => (
              <MemberRow
                key={t.id}
                ticket={t}
                experimentId={experimentId}
                isCurrent={t.id === currentTicketId}
                busy={busyTicketId === t.id}
                onOpen={() => {
                  pushRecentTicketId(t.id);
                  window.location.hash = `#/tickets/${t.id}`;
                  onClose();
                }}
                onBusy={setBusyTicketId}
                onError={setError}
              />
            ))}
          </ul>
        </>
      )}

      <SectionLabel>Add to another ticket</SectionLabel>
      <div className="px-2 pb-1">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ticket number or title…"
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500"
        />
      </div>
      <SearchResults
        query={query}
        experimentId={experimentId}
        excludeIds={memberIds}
        busyTicketId={busyTicketId}
        onBusy={setBusyTicketId}
        onError={setError}
        onDone={() => membership.refetch()}
      />

      {query.trim().length < 2 && recents.length > 0 ? (
        <>
          <SectionLabel>Recent</SectionLabel>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {recents.map((t) => (
              <AddRow
                key={t.id}
                ticket={t}
                experimentId={experimentId}
                busy={busyTicketId === t.id}
                onBusy={setBusyTicketId}
                onError={setError}
                onDone={() => membership.refetch()}
              />
            ))}
          </ul>
        </>
      ) : null}

      {error ? (
        <p className="px-3 py-2 text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      <div className="border-t border-slate-100 dark:border-slate-800 p-1">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
        >
          + New ticket from this experiment…
        </button>
      </div>

      <CreateTicketForExperimentModal
        open={createOpen}
        experimentId={experimentId}
        experimentLabel={experimentLabel}
        onClose={() => setCreateOpen(false)}
        onCreated={(t) => {
          pushRecentTicketId(t.id);
          setCreateOpen(false);
          onClose();
          window.location.hash = `#/tickets/${t.id}`;
        }}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

/** A ticket this experiment is already on. */
function MemberRow({
  ticket,
  experimentId,
  isCurrent,
  busy,
  onOpen,
  onBusy,
  onError,
}: {
  ticket: Ticket;
  experimentId: number;
  isCurrent: boolean;
  busy: boolean;
  onOpen: () => void;
  onBusy: (id: number | null) => void;
  onError: (msg: string | null) => void;
}) {
  const remove = useRemoveTicketTarget(ticket.id);
  // 🛑 Undefined on any host that has not deployed `acceptsTargets`
  // yet, which reads as false — the safe way round. A remove offered
  // where the server will 409 is a dead end.
  const canRemove = ticket.accepts_targets === true;
  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex-1 min-w-0 text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800",
          isCurrent && "bg-violet-50 dark:bg-violet-900/30",
        )}
        title={`Open ticket ${ticket.id}: ${ticket.title}`}
      >
        <span className="block truncate text-slate-800 dark:text-slate-100">
          {isCurrent ? "← " : ""}
          {ticket.title}
        </span>
        <span className="block text-[10px] text-slate-500 dark:text-slate-400">
          #{ticket.id} · {ticket.state}
          {isCurrent ? " · you came from here" : ""}
        </span>
      </button>
      {canRemove ? (
        <button
          type="button"
          disabled={busy}
          title={`Remove this experiment from "${ticket.title}"`}
          aria-label="remove from this ticket"
          onClick={() => {
            onError(null);
            onBusy(ticket.id);
            remove.mutate(
              { target_id: experimentId },
              {
                // The removed row's status is what says whether
                // anything was lost. On a scratchpad every row is
                // NOT_DONE and the removal is the completion gesture,
                // so it passes without a word; discarding finished work
                // is worth saying out loud.
                onSuccess: (res) => {
                  onBusy(null);
                  if (res && res.status && res.status !== "NOT_DONE") {
                    onError(
                      `Removed — that row was marked ${res.status}, so a record of completed work went with it.`,
                    );
                  }
                },
                onError: (e) => {
                  onBusy(null);
                  onError(
                    e instanceof Error
                      ? `Could not remove: ${e.message}`
                      : "Could not remove it from this ticket.",
                  );
                },
              },
            );
          }}
          className="px-2 text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/** A recent ticket this experiment is NOT on — clicking adds it. */
function AddRow({
  ticket,
  experimentId,
  busy,
  onBusy,
  onError,
  onDone,
}: {
  ticket: Ticket;
  experimentId: number;
  busy: boolean;
  onBusy: (id: number | null) => void;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const add = useAddTicketTargets(ticket.id);
  const canAdd = ticket.accepts_targets === true;
  return (
    <li>
      <button
        type="button"
        disabled={!canAdd || busy}
        title={
          canAdd
            ? `Add this experiment to "${ticket.title}"`
            : `"${ticket.title}" does not accept additions — open it and turn that on to add to it`
        }
        onClick={() => {
          onError(null);
          onBusy(ticket.id);
          add.mutate(
            [{ target_id: experimentId }],
            {
              onSuccess: () => {
                onBusy(null);
                pushRecentTicketId(ticket.id);
                onDone();
              },
              onError: (e) => {
                onBusy(null);
                onError(
                  e instanceof Error
                    ? `Could not add: ${e.message}`
                    : "Could not add it to this ticket.",
                );
              },
            },
          );
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="block truncate text-slate-800 dark:text-slate-100">
          {busy ? "Adding…" : ticket.title}
        </span>
        <span className="block text-[10px] text-slate-500 dark:text-slate-400">
          #{ticket.id} · {ticket.state}
          {canAdd ? "" : " · fixed worklist"}
        </span>
      </button>
    </li>
  );
}

/** Hits for a typed query, offered as add targets.
 *
 *  🛑 Silent below two characters — one character matches most of the
 *  corpus and teaches nothing, and the recents list is what serves the
 *  no-typing case. Rendering nothing there is deliberate, not a
 *  loading state.
 *
 *  A hit already on the ticket is dropped: it is listed above under
 *  membership, where it carries a Remove rather than an Add. */
function SearchResults({
  query,
  experimentId,
  excludeIds,
  busyTicketId,
  onBusy,
  onError,
  onDone,
}: {
  query: string;
  experimentId: number;
  excludeIds: Set<number>;
  busyTicketId: number | null;
  onBusy: (id: number | null) => void;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const search = useTicketSearch(query);
  const q = query.trim();
  if (q.length < 2) return null;
  if (search.isLoading) {
    return (
      <p className="px-3 py-1.5 text-slate-500 dark:text-slate-400 italic">
        Searching…
      </p>
    );
  }
  const hits = (search.data ?? []).filter((h) => !excludeIds.has(h.id));
  if (hits.length === 0) {
    return (
      <p className="px-3 py-1.5 text-slate-500 dark:text-slate-400 italic">
        No open ticket matches "{q}".
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {hits.map((h) => (
        <SearchRow
          key={h.id}
          hit={h}
          experimentId={experimentId}
          busy={busyTicketId === h.id}
          onBusy={onBusy}
          onError={onError}
          onDone={onDone}
        />
      ))}
    </ul>
  );
}

/** One search hit. Mirrors `AddRow`, but a hit carries `target_count`
 *  rather than a full ticket — the search route deliberately never
 *  hydrates targets, so this cannot reuse `AddRow`'s `Ticket`. */
function SearchRow({
  hit,
  experimentId,
  busy,
  onBusy,
  onError,
  onDone,
}: {
  hit: TicketSearchHit;
  experimentId: number;
  busy: boolean;
  onBusy: (id: number | null) => void;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const add = useAddTicketTargets(hit.id);
  return (
    <li>
      <button
        type="button"
        disabled={busy}
        title={`Add this experiment to "${hit.title}"`}
        onClick={() => {
          onError(null);
          onBusy(hit.id);
          add.mutate([{ target_id: experimentId }], {
            onSuccess: () => {
              onBusy(null);
              pushRecentTicketId(hit.id);
              onDone();
            },
            onError: (e) => {
              onBusy(null);
              // 🛑 A 409 here is `acceptsTargets: false` or a closed
              // ticket, and the search does not carry that flag — so
              // the row cannot be greyed in advance and the message has
              // to carry the reason instead.
              onError(
                e instanceof Error
                  ? `Could not add: ${e.message}`
                  : "Could not add it to this ticket.",
              );
            },
          });
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        <span className="block truncate text-slate-800 dark:text-slate-100">
          {busy ? "Adding…" : hit.title}
        </span>
        <span className="block text-[10px] text-slate-500 dark:text-slate-400">
          #{hit.id} · {hit.state}
          {typeof hit.target_count === "number"
            ? ` · ${hit.target_count} target${hit.target_count === 1 ? "" : "s"}`
            : ""}
        </span>
      </button>
    </li>
  );
}
