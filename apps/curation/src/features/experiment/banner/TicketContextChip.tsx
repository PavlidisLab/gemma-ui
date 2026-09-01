import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useTicket } from "@/api/tickets";
import { useTicketMemberLabels } from "@/api/ticketMemberLabels";
import { cn } from "@/lib/cn";
import { StatusDisc } from "@/components/ui/StatusDisc";
import { navigate, siblingExperimentRoute } from "@/routes";
import { orderTicketTargetsAsListed } from "@/features/tickets/ticketMemberOrder";
import { TicketMenu } from "@/features/tickets/TicketMenu";

/**
 * The banner's ticket surface: the management dropdown, the walker
 * across a ticket's members, and the anchored member list.
 *
 * Split out of `ExperimentBanner.tsx` 2026-09-01. That file had grown
 * to ~2,450 lines holding the modality chip, the platform line, set
 * chips, group chips, status chips, the publish button, two name
 * editors, two navigator popovers and this — every session that
 * touched the banner had to find its way through the rest first.
 * Nothing here changed in the move.
 */

/** Banner chip surfacing the active Ticket context. Renders a
 *  back-link to the ticket detail page + the curator's position
 *  within the ticket's targets ("3/20"), with prev/next arrows
 *  walking the target list — same workflow as the group navigator
 *  for sets. */
export function TicketContextChip({
  experimentId,
  ticketContext,
}: {
  experimentId: number | string;
  /** The ticket the curator arrived from, or null when they did not
   *  arrive from one. Null is the common case and still renders the
   *  management menu — see `TicketMenu`. */
  ticketContext?: string | null;
}) {
  const ticketId = ticketContext == null ? NaN : parseInt(ticketContext, 10);
  const { data: ticket } = useTicket(Number.isFinite(ticketId) ? ticketId : null);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  // Same dismissal contract as the member popover, kept separate so
  // closing one does not close the other.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const numericExperimentId =
    typeof experimentId === "number"
      ? experimentId
      : parseInt(String(experimentId), 10);

  /** The management dropdown. Rendered in BOTH states — with a ticket
   *  context it sits after the walker, without one it is the whole
   *  chip. */
  const managementMenu = (
    <span ref={menuRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        title={
          Number.isFinite(ticketId)
            ? "Back to the ticket, and ticket management for this experiment"
            : "Ticket management for this experiment"
        }
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer",
          "border-violet-300 bg-violet-100 text-violet-800",
          "hover:bg-violet-200",
          "dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
          menuOpen && "ring-2 ring-offset-1 ring-violet-400/50",
        )}
      >
        {/* The ← is kept when there is somewhere to go back TO. Going
            back is now the first row of the menu rather than a second
            button, so the arrow is a hint about what is inside, not a
            second affordance. */}
        {Number.isFinite(ticketId) ? <span aria-hidden>←</span> : null}
        <span>{Number.isFinite(ticketId) ? "Ticket" : "Tickets"}</span>
        <span aria-hidden className="text-violet-700/70 dark:text-violet-300/70">
          ▾
        </span>
      </button>
      {menuOpen ? (
        <span className="absolute left-0 top-full mt-1 z-50 rounded border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <TicketMenu
            experimentId={numericExperimentId}
            experimentLabel={String(experimentId)}
            currentTicketId={Number.isFinite(ticketId) ? ticketId : null}
            onClose={() => setMenuOpen(false)}
          />
        </span>
      ) : null}
    </span>
  );
  // Outside-click + Escape dismissal — same pattern as SetChip.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ticket) {
    return (
      <span className="relative inline-flex items-center gap-2 text-[11px]">
        {managementMenu}
      </span>
    );
  }
  // Walk the members in the order the curator saw them listed, not the
  // order the store happens to return targets in. The ticket page lists
  // them through ``ExperimentQueue`` under a server sort
  // (``-lastUpdated`` by default), which on a real ticket runs close to
  // the reverse of ``ticket.targets`` — so clicking the second row of
  // an 18-member ticket landed here reading "18/18" and ‹ walked away
  // from the rest of the list. ``orderTicketTargetsAsListed`` is a
  // no-op when the curator arrived from a bookmark rather than the
  // queue, which is the old behaviour.
  //
  // One ordering serves the counter, the ‹ › buttons, the popover's
  // member list AND its [ / ] keys — they all read ``expTargets``.
  const expTargets = orderTicketTargetsAsListed(
    ticketId,
    ticket.targets.filter((t) => t.target_type === "EXPRESSION_EXPERIMENT"),
  );
  const currentNumericId =
    typeof experimentId === "number"
      ? experimentId
      : parseInt(String(experimentId), 10);
  const idx = expTargets.findIndex((t) => t.target_id === currentNumericId);
  const total = expTargets.length;
  const chipLabel =
    ticket.title.length > 32 ? `${ticket.title.slice(0, 32)}…` : ticket.title;

  // Prev / next navigation around the position counter — replaces
  // the popover-only "[ and ] keys to navigate" hint, which the reviewer
  // 2026-06-14 called "not that useful." The chip itself is now a
  // direct back-link to the ticket detail page (no popover trigger);
  // the popover hangs off the counter / ▾ glyph instead.
  const currentTarget = idx >= 0 ? expTargets[idx] : null;
  const prevTarget = idx > 0 ? expTargets[idx - 1] : null;
  const nextTarget = idx >= 0 && idx < total - 1 ? expTargets[idx + 1] : null;
  // 🛑 Keeps the curator's tab (and comparison chips) — Paul,
  // 2026-08-20: walking a ticket "should keep the tab that was
  // selected, so nav stays on design details or whatever". This used
  // to build the URL by hand and dropped everything but the ticket.
  function navigateTo(targetId: number): void {
    navigate(siblingExperimentRoute(targetId, { ticketContext: String(ticketId) }));
  }
  // Layout per design review 2026-06-14:
  //   [← Ticket]   [Boss-critic 200 …]   ‹ 12/200 ›
  //   ───────────  ───────────────────  ───────────
  //   plain        dropdown trigger     counter + prev/next
  //   back-link    (opens popover)      (free-floating)
  //
  // The back-link is a bare "← Ticket" — no title baked in. The
  // title lives on the dropdown trigger box next to it. Three
  // separate concerns, three visually distinct affordances.
  // Status pill drops out of this row — surface lives in the
  // popover member list per-row.
  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-2 text-[11px]">
      {/* 🛑 One ticket button, not two (Paul, 2026-09-01: "having two
          buttons for tickets is awkward"). The standalone `← Ticket`
          back-link is gone; the management dropdown below carries the
          arrow and lists the current ticket first, marked "you came
          from here", so going back is one click either way. */}
      {managementMenu}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer",
          "border-violet-300 bg-violet-100 text-violet-800",
          "hover:bg-violet-200",
          "dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
          "max-w-[20rem]",
          open && "ring-2 ring-offset-1 ring-violet-400/50",
        )}
        title={`${ticket.title} — click for ticket members`}
      >
        <span className="truncate">{chipLabel}</span>
        <span aria-hidden className="text-violet-700/70 dark:text-violet-300/70">
          ▾
        </span>
      </button>
      <button
        type="button"
        onClick={() => prevTarget && navigateTo(prevTarget.target_id)}
        disabled={!prevTarget}
        // 🛑 No key hint here. `[` / `]` are bound inside
        // SetNavigatorPopover and TicketNavigatorPopover ONLY, and only
        // while a popover is open — these buttons sit in the banner with
        // no popover, so the hint promised a shortcut that does nothing
        // where it was read. It is stale copy: these buttons were added
        // to REPLACE the popover-only hint (see the note above), and the
        // promise was carried onto them by mistake.
        title="Previous member"
        aria-label="previous member"
        className="text-[14px] font-bold leading-none text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-slate-100 dark:disabled:text-slate-600 px-0.5"
      >
        ‹
      </button>
      <span
        className="font-mono tabular-nums text-slate-700 dark:text-slate-200 select-none"
        title={`Member ${idx >= 0 ? idx + 1 : "?"} of ${total}`}
      >
        {idx >= 0 ? idx + 1 : "?"}/{total}
      </span>
      <button
        type="button"
        onClick={() => nextTarget && navigateTo(nextTarget.target_id)}
        disabled={!nextTarget}
        title="Next member"
        aria-label="next member"
        className="text-[14px] font-bold leading-none text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-slate-100 dark:disabled:text-slate-600 px-0.5"
      >
        ›
      </button>
      <TicketTargetStatusDot status={currentTarget?.status ?? null} />
      {open ? (
        <TicketNavigatorPopover
          ticketId={ticketId}
          ticketTitle={ticket.title}
          targets={expTargets}
          currentExperimentId={currentNumericId}
          anchorRef={wrapRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

/** Tiny coloured circle conveying the current experiment's status on
 *  the ticket. Compact form-factor — fits in the header nav cluster
 *  next to ‹ N/M ›. Tooltip carries the human-readable label. */
function TicketTargetStatusDot({
  status,
}: {
  status: "NOT_DONE" | "UNDERWAY" | "DONE" | null | undefined;
}) {
  if (!status) return null;
  const map = {
    NOT_DONE: { cls: "bg-slate-400 dark:bg-slate-500", label: "Not started" },
    UNDERWAY: { cls: "bg-amber-500", label: "Started" },
    DONE: { cls: "bg-emerald-500", label: "Done" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${m.cls}`}
      title={`This experiment's status on the ticket: ${m.label}`}
      aria-label={m.label}
    />
  );
}

/** Anchored dropdown listing every EE target on the ticket, with the
 *  current one highlighted. Mirrors ``SetNavigatorPopover``'s shape
 *  (header / position readout / search filter / scrollable list) so
 *  the navigator feels the same whether the curator is set-walking
 *  or ticket-walking. The set version handles screening-group
 *  placeholders + uncommitted-draft hints that don't apply to
 *  tickets, so we keep this as a sibling rather than refactoring
 *  ``SetMemberRow`` into a single generic. */
function TicketNavigatorPopover({
  ticketId,
  ticketTitle,
  targets,
  currentExperimentId,
  anchorRef,
  onClose,
}: {
  ticketId: number;
  ticketTitle: string;
  targets: Array<{
    target_id: number;
    display_label?: string;
    display_name?: string;
    status?: "NOT_DONE" | "UNDERWAY" | "DONE";
  }>;
  currentExperimentId: number;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Vertical-flip if too close to bottom of viewport (same heuristic
  // as SetNavigatorPopover; popover is similar height).
  const [flipUp, setFlipUp] = useState(false);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const POPOVER_H_ESTIMATE = 380;
    const margin = 8;
    setFlipUp(
      rect.bottom + POPOVER_H_ESTIMATE + margin > window.innerHeight &&
        rect.top > POPOVER_H_ESTIMATE,
    );
  }, [anchorRef]);

  // 🛑 Gemma sends `displayLabel`/`displayName` null on every target, so
  // the rows read "31491 (no title)" and the filter box had nothing to
  // filter on. Resolved here rather than papered over: a populated
  // label from the server still wins, and this fills in only where it
  // is absent. See `api/ticketMemberLabels.ts`.
  const { data: labels } = useTicketMemberLabels(
    targets.map((t) => t.target_id),
  );
  const labelled = useMemo(
    () =>
      targets.map((t) => ({
        ...t,
        display_label:
          t.display_label ?? labels?.[t.target_id]?.short_name ?? undefined,
        display_name:
          t.display_name ?? labels?.[t.target_id]?.name ?? undefined,
      })),
    [targets, labels],
  );

  const currentIdx = targets.findIndex(
    (t) => t.target_id === currentExperimentId,
  );

  // Open onto the current experiment — centre its row in the list
  // viewport on mount instead of always starting at the top, so the
  // popover reflects the "30/200" position the curator is sitting on.
  // Scroll is contained to the <ul> (set scrollTop directly) so it
  // never nudges the page or the absolutely-positioned popover.
  const listRef = useRef<HTMLUListElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = currentRowRef.current;
    if (!list || !row) return;
    const offset =
      row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
  }, []);

  const goToIndex = useCallback(
    (idx: number) => {
      if (targets.length === 0) return;
      const wrapped = ((idx % targets.length) + targets.length) % targets.length;
      const target = targets[wrapped];
      if (!target) return;
      window.location.hash = siblingExperimentRoute(target.target_id, {
        ticketContext: String(ticketId),
      });
      onClose();
    },
    [targets, ticketId, onClose],
  );

  // [ / ] keyboard prev-next while the popover is open. Same UX
  // as SetNavigatorPopover; curator never types literal brackets
  // when filtering by accession.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "[") {
        e.preventDefault();
        goToIndex(currentIdx - 1);
      } else if (e.key === "]") {
        e.preventDefault();
        goToIndex(currentIdx + 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goToIndex, currentIdx]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labelled;
    return labelled.filter(
      (t) =>
        (t.display_label ?? "").toLowerCase().includes(q) ||
        (t.display_name ?? "").toLowerCase().includes(q) ||
        // The id is what the row shows until a label resolves, so it
        // has to be searchable too — otherwise a filter typed before
        // the labels land matches nothing.
        String(t.target_id).includes(q),
    );
  }, [labelled, query]);

  return (
    <div
      role="dialog"
      aria-label={`Ticket ${ticketId} navigator`}
      className={cn(
        "absolute z-30 left-0 w-96 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg text-xs dark:bg-slate-900 dark:border-slate-700",
        flipUp ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {ticketTitle}
          </span>
          <span className="ml-auto">
            <a
              href={`#/tickets/${ticketId}`}
              className="text-blue-700 hover:underline text-[11px] dark:text-blue-300"
              onClick={onClose}
            >
              Open ticket ↗
            </a>
          </span>
        </div>
        {/* Progress indication — Design review 2026-06-14: the popover should
            still surface the curator's position in the ticket.
            Dropped the "[ and ] keys to navigate" tail since those
            are now click affordances next to the chip. */}
        {targets.length > 0 ? (
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {currentIdx >= 0
              ? `${currentIdx + 1} of ${targets.length}`
              : `not on ticket · ${targets.length} member${
                  targets.length === 1 ? "" : "s"
                }`}
          </div>
        ) : null}
      </div>
      <div className="p-2 border-b border-slate-100 dark:border-slate-700">
        <input
          type="search"
          placeholder="Filter by accession or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-400"
          autoFocus
        />
      </div>
      <ul
        ref={listRef}
        className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            No members match "{query}".
          </li>
        ) : (
          filtered.map((t) => (
            <TicketMemberRow
              key={t.target_id}
              target={t}
              isCurrent={t.target_id === currentExperimentId}
              rowRef={
                t.target_id === currentExperimentId ? currentRowRef : undefined
              }
              onClick={() => {
                window.location.hash = siblingExperimentRoute(t.target_id, {
                  ticketContext: String(ticketId),
                });
                onClose();
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function TicketMemberRow({
  target,
  isCurrent,
  rowRef,
  onClick,
}: {
  target: {
    target_id: number;
    display_label?: string;
    display_name?: string;
    status?: "NOT_DONE" | "UNDERWAY" | "DONE";
  };
  isCurrent: boolean;
  rowRef?: RefObject<HTMLLIElement>;
  onClick: () => void;
}) {
  return (
    <li ref={rowRef}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
          "hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800",
          isCurrent &&
            "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50",
        )}
        title={`Open ${target.display_label ?? target.target_id}`}
      >
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums shrink-0",
            isCurrent
              ? "font-semibold text-blue-900 dark:text-blue-200"
              : "text-slate-700 dark:text-slate-200",
          )}
        >
          {target.display_label ?? String(target.target_id)}
        </span>
        <span className="flex-1 truncate text-slate-600 dark:text-slate-400 text-[11px]">
          {target.display_name || "(no title)"}
        </span>
        {target.status ? (
          // Status disc — same visual language as the set-navigator
          // popover. Per design review 2026-06-11: "we used to have little
          // circles." The earlier uppercase text label drifted from
          // the set-navigator's disc convention.
          <StatusDisc
            tone={
              target.status === "DONE"
                ? "done"
                : target.status === "UNDERWAY"
                  ? "draft"
                  : "untouched"
            }
            title={
              target.status === "DONE"
                ? "done"
                : target.status === "UNDERWAY"
                  ? "in progress"
                  : "todo"
            }
          />
        ) : null}
      </button>
    </li>
  );
}
