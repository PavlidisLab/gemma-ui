import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useExperimentGroups, useGroup } from "@/api/workflow";
import type {
  ExperimentAuditStatus,
  ExperimentSummary,
  Group,
  GroupType,
} from "@/api/workflowTypes";
import { readDirtyExperimentIds } from "@/features/design/draftCache";
import { StatusDisc, type StatusDiscTone } from "@/components/ui/StatusDisc";
import { cn } from "@/lib/cn";
import { navigate, siblingExperimentRoute, workflowRoute } from "@/routes";

/**
 * Workflow GROUPS (sets) an experiment belongs to, and the navigator
 * that walks their members.
 *
 * 🛑 Not the same thing as `ExperimentSetChips`, which shows Gemma's
 * own `ExpressionExperimentSet`s. These are the curation side's
 * groups, read from the store. Both render; neither subsumes the other.
 *
 * Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged.
 */

/**
 * Chips listing the workflow Groups (sets) this experiment is a
 * member of. Renders inline in the banner action row, before the
 * Status button. Each chip toggles a popover that lets the curator
 * navigate within the set — prev/next, search, click to jump.
 *
 * Hidden when the experiment isn't in any group (most freshly-
 * loaded experiments). Pluralised label ("Set" vs "Sets") so a
 * single membership doesn't read as a count.
 *
 * Chip-render path uses the lightweight ``useExperimentGroups`` call
 * (no member summaries). The popover does its own ``useGroup`` call
 * with ``include_summaries=true`` so the per-member metadata only
 * gets fetched when the curator actually opens the navigator.
 */
export function ExperimentGroupChips({
  experimentId,
  groupContext,
}: {
  experimentId: number | string;
  groupContext?: string;
}) {
  const { data: groups } = useExperimentGroups(experimentId);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!switcherOpen) return;
    function onPointer(e: MouseEvent) {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setSwitcherOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  if (!groups || groups.length === 0) return null;

  // Show ONE chip prominently — the active set context if the URL
  // has one, otherwise the first set. When the experiment belongs
  // to more than one set, a small "+ N other" pill next to the
  // primary chip opens a switch dropdown listing the others.
  // Earlier shape was a flex-wrap row of all chips which didn't
  // scale past 3 sets and made the active one hard to find.
  const activeGroup = groupContext
    ? groups.find((g) => g.id === groupContext)
    : null;
  const primary = activeGroup ?? groups[0];
  const others = groups.filter((g) => g.id !== primary.id);

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
        {activeGroup ? "In set" : "Set"}
      </span>
      <SetChip
        key={primary.id}
        group={primary}
        currentExperimentId={experimentId}
        isActiveContext={!!activeGroup}
        open={openGroupId === primary.id}
        onToggle={() =>
          setOpenGroupId((prev) => (prev === primary.id ? null : primary.id))
        }
        onClose={() => setOpenGroupId(null)}
      />
      {others.length > 0 ? (
        <span ref={switcherRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="inline-flex items-baseline gap-0.5 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            title={`Switch to one of ${others.length} other set${others.length === 1 ? "" : "s"} this experiment belongs to`}
          >
            + {others.length} other
            <span className="text-slate-400 dark:text-slate-500 ml-0.5">
              ▾
            </span>
          </button>
          {switcherOpen ? (
            <SetSwitchDropdown
              experimentId={experimentId}
              activeGroupId={primary.id}
              groups={groups}
              onClose={() => setSwitcherOpen(false)}
            />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Dropdown listing every group the experiment belongs to, with the
 *  active one marked. Click a non-active row to navigate to that
 *  set's context, keeping the tab the curator is on.
 *
 *  🛑 It did not, despite this comment saying so since it was written:
 *  ``experimentRoute(id, undefined, g.id)`` OMITS the tab param rather
 *  than preserving it, so every switch bounced back to the default tab.
 *  ``siblingExperimentRoute`` reads the live route and is the only
 *  thing that actually keeps it. */
function SetSwitchDropdown({
  experimentId,
  activeGroupId,
  groups,
  onClose,
}: {
  experimentId: number | string;
  activeGroupId: string;
  groups: Group[];
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Switch set context"
      className="absolute right-0 top-full mt-1 z-30 min-w-[20rem] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg py-1 text-xs"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
        This experiment belongs to {groups.length} set
        {groups.length === 1 ? "" : "s"}
      </div>
      {groups.map((g) => {
        const isActive = g.id === activeGroupId;
        return (
          <button
            key={g.id}
            type="button"
            disabled={isActive}
            onClick={() => {
              onClose();
              navigate(
                siblingExperimentRoute(experimentId, { groupContext: g.id }),
              );
            }}
            className={cn(
              "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
              isActive
                ? "bg-slate-100 dark:bg-slate-700 cursor-default"
                : "hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer",
            )}
          >
            <span
              className={cn(
                "w-3 text-emerald-600 dark:text-emerald-400 font-bold",
                !isActive && "opacity-0",
              )}
              aria-hidden
            >
              ✓
            </span>
            <span className="flex-1 min-w-0">
              <span
                className={cn(
                  "block",
                  isActive
                    ? "text-slate-900 dark:text-slate-100 font-medium"
                    : "text-slate-700 dark:text-slate-200",
                )}
              >
                {g.name}
              </span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                {g.type} · {g.member_count} member
                {g.member_count === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A single Set chip + its anchored navigator popover. The chip is
 *  a button (not a link) so click toggles the popover; the popover's
 *  header carries an explicit "Open in Workflow" link for the case
 *  where the curator wants the full tab view. */
function SetChip({
  group,
  currentExperimentId,
  isActiveContext = false,
  open,
  onToggle,
  onClose,
}: {
  group: Group;
  currentExperimentId: number | string;
  /** True when this group matches the URL's ``?group=<id>`` context.
   *  Surfaces as a small active-context indicator on the chip so the
   *  curator can tell which set the inline prev/next is anchored to. */
  isActiveContext?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  // Dismiss on outside-click + Escape; same pattern as the Why
  // popover in ProposalCardV2.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer",
          groupTypeChipCls(group.type),
          open && "ring-2 ring-offset-1 ring-slate-400/40",
          isActiveContext && !open && "ring-1 ring-slate-400/60",
        )}
        title={
          isActiveContext
            ? `${group.name} · ${group.type} · ${group.member_count} member${
                group.member_count === 1 ? "" : "s"
              } — active set context (prev/next anchored here)`
            : `${group.name} · ${group.type} · ${group.member_count} member${
                group.member_count === 1 ? "" : "s"
              } — click to navigate`
        }
      >
        {isActiveContext ? (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-300"
            aria-label="active set context"
          />
        ) : null}
        <span className="font-medium truncate max-w-[28ch]">{group.name}</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
          {group.member_count}
        </span>
      </button>
      {open ? (
        <SetNavigatorPopover
          groupId={group.id}
          currentExperimentId={currentExperimentId}
          anchorRef={wrapRef}
          onClose={onClose}
        />
      ) : null}
    </span>
  );
}

/** Anchored popover: header + position indicator + prev/next +
 *  search + scrollable member list. Opens when a Set chip is
 *  clicked; closes on outside-click / Escape (handled by parent).
 *
 *  Lifts ``include_summaries=true`` on its own ``useGroup`` call
 *  rather than depending on the chip-render path's lightweight data,
 *  so per-member metadata only loads when the curator opens the
 *  navigator. */
function SetNavigatorPopover({
  groupId,
  currentExperimentId,
  anchorRef,
  onClose,
}: {
  groupId: string;
  currentExperimentId: number | string;
  /** Ref to the chip's outer wrapper. Used to measure the trigger
   *  position so the popover can flip above when below would
   *  overflow the viewport bottom. (The popover itself is
   *  ``absolute`` from this wrapper, so we don't move; we toggle
   *  ``top-full mt-1`` ↔ ``bottom-full mb-1``.) */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { data: group, isLoading } = useGroup(groupId, {
    includeSummaries: true,
  });
  const [query, setQuery] = useState("");
  const summaries = group?.member_summaries ?? null;
  // Local-draft signal for the per-row "uncommitted" disc. Read on
  // every render — cheap (one localStorage scan, no JSON parse) and
  // the popover only mounts when the curator opens it, so the cost
  // is bounded. Recomputes on each open so a draft committed in
  // another tab between opens reflects accurately.
  const dirtyDraftIds = useMemo(() => readDirtyExperimentIds(), [group]);
  // Vertical-flip decision. Measured against an estimate (the popover
  // is ~360-400px tall depending on member count + search hits);
  // close enough for the keep-on-screen heuristic, and the popover's
  // ``max-h-72`` on its body keeps the absolute height bounded.
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

  // Index of the curator's current experiment within the set's
  // ordered member list. ``-1`` when this experiment isn't a member
  // (shouldn't happen — the chip wouldn't render — but defensive).
  const currentIdx =
    summaries?.findIndex((s) => s.experiment_id === currentExperimentId) ?? -1;

  // Open onto the current experiment — centre its row in the list
  // viewport once it first renders (members load async, so this can't
  // be a mount-only effect). The one-shot guard keeps later filter
  // typing from yanking the scroll back. Scroll is contained to the
  // <ul> so it never nudges the page or the popover.
  const listRef = useRef<HTMLUListElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current) return;
    const list = listRef.current;
    const row = currentRowRef.current;
    if (!list || !row) return;
    const offset =
      row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
    didScrollRef.current = true;
  }, [summaries]);

  const goToIndex = useCallback(
    (idx: number) => {
      if (!summaries || summaries.length === 0) return;
      // Wrap at ends so [/] never dead-ends the curator.
      const wrapped =
        ((idx % summaries.length) + summaries.length) % summaries.length;
      const target = summaries[wrapped];
      if (!target || target.experiment_id <= 0) return;
      // Anchor the URL's group context to this group so subsequent
      // tab switches / inline prev-next stay in-set without the
      // curator having to re-pick the group.
      navigate(
        siblingExperimentRoute(target.experiment_id, { groupContext: groupId }),
      );
      onClose();
    },
    [summaries, onClose, groupId],
  );

  // Keyboard prev/next: ``[`` and ``]`` while the popover is open.
  // Active only when the popover is open (parent gates render); we
  // bind on document so the shortcut works regardless of focus —
  // including while the (autoFocus'd) search input has focus, since
  // a curator filtering on accession/title never types literal
  // brackets and the popover hint promises ``[``/``]`` will work.
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

  // Filter the member list by free-text query against short_name +
  // title. Required given "sets could be large." Case-insensitive
  // substring match — light enough that we don't need a debounce.
  const filtered = useMemo(() => {
    if (!summaries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.short_name.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q),
    );
  }, [summaries, query]);

  return (
    <div
      role="dialog"
      aria-label={`${group?.name ?? "Set"} navigator`}
      className={cn(
        "absolute z-30 right-0 w-96 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg text-xs dark:bg-slate-900 dark:border-slate-700",
        flipUp ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {group?.name ?? "Loading…"}
          </span>
          {group ? (
            <span
              className={cn(
                "inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-semibold border",
                groupTypeChipCls(group.type),
              )}
            >
              {group.type}
            </span>
          ) : null}
          <span className="ml-auto">
            <a
              href={workflowRoute(groupId)}
              className="text-blue-700 hover:underline text-[11px] dark:text-blue-300"
              onClick={onClose}
            >
              Open in Workflow ↗
            </a>
          </span>
        </div>
        {summaries && summaries.length > 0 ? (
          // Retired 2026-05-17: dropped the ← / → buttons. The member
          // list below is the primary navigator (click to jump); [ / ]
          // keyboard shortcuts still work for power users. Just the
          // bare position readout remains so the curator knows where
          // they are in the set without a chrome-heavy paginator.
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {currentIdx >= 0
              ? `${currentIdx + 1} of ${summaries.length}  ·  [ and ] keys to navigate`
              : `not in set · ${summaries.length} member${
                  summaries.length === 1 ? "" : "s"
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
          // Don't grab keyboard prev/next while typing.
          autoFocus
        />
      </div>
      <ul
        ref={listRef}
        className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
      >
        {isLoading || !group ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            loading members…
          </li>
        ) : !summaries ? (
          // member_summaries should always come back when we asked for
          // them; this branch is for older agents that don't honour the
          // flag. Render the chip-only fallback so the popover doesn't
          // stay empty.
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            Member metadata unavailable. Open in Workflow for the full
            list.
          </li>
        ) : filtered.length === 0 ? (
          <li className="px-3 py-2 text-slate-500 dark:text-slate-400 italic">
            No members match "{query}".
          </li>
        ) : (
          filtered.map((m) => (
            <SetMemberRow
              key={`${m.experiment_id}-${m.short_name}`}
              summary={m}
              isCurrent={m.experiment_id === currentExperimentId}
              rowRef={
                m.experiment_id === currentExperimentId
                  ? currentRowRef
                  : undefined
              }
              hasLocalDraft={dirtyDraftIds.has(String(m.experiment_id))}
              onClick={() => {
                if (m.experiment_id <= 0) return;
                navigate(
                  siblingExperimentRoute(m.experiment_id, {
                    groupContext: groupId,
                  }),
                );
                onClose();
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

/** One member-list row: short_name + title + status pills.
 *  Highlighted when the row is the curator's current experiment.
 *  Disabled (no click) for placeholder / non-numeric members
 *  (screening-group candidate UUIDs). */
function SetMemberRow({
  summary,
  isCurrent,
  hasLocalDraft,
  rowRef,
  onClick,
}: {
  summary: ExperimentSummary;
  isCurrent: boolean;
  rowRef?: RefObject<HTMLLIElement>;
  /** This curator has an uncommitted local draft for this
   *  experiment (presence of a ``gca:draft:<id>`` key in
   *  localStorage). Takes precedence over the server-side
   *  in_progress audit signal when present — uncommitted local
   *  work is the more urgent state. */
  hasLocalDraft: boolean;
  onClick: () => void;
}) {
  const isPlaceholder = summary.experiment_id <= 0;
  const Component = isPlaceholder ? "div" : "button";
  return (
    <li ref={rowRef}>
      <Component
        type={isPlaceholder ? undefined : "button"}
        onClick={isPlaceholder ? undefined : onClick}
        className={cn(
          "w-full text-left px-3 py-1.5 flex items-baseline gap-2",
          !isPlaceholder && "hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800",
          isCurrent &&
            "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50",
          isPlaceholder && "opacity-60 cursor-default",
        )}
        title={isPlaceholder ? "non-numeric member id" : `Open ${summary.short_name}`}
      >
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums shrink-0",
            isCurrent
              ? "font-semibold text-blue-900 dark:text-blue-200"
              : "text-slate-700 dark:text-slate-200",
          )}
        >
          {summary.short_name}
        </span>
        <span className="flex-1 truncate text-slate-600 dark:text-slate-400 text-[11px]">
          {summary.title || (isPlaceholder ? "" : "(no title)")}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          {summary.audit_status || hasLocalDraft ? (
            <StatusDisc
              tone={memberRowDiscTone(summary.audit_status, hasLocalDraft)}
              title={memberRowDiscTitle(summary.audit_status, hasLocalDraft)}
            />
          ) : null}
          {summary.troubled ? (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"
              title="troubled"
            />
          ) : null}
          {summary.needs_attention ? (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
              title="needs attention"
            />
          ) : null}
          {summary.is_public ? (
            <span
              className="text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
              title="public"
            >
              pub
            </span>
          ) : null}
        </span>
      </Component>
    </li>
  );
}

/** Compose the per-member StatusDisc tone.
 *
 *  Semantics aligned with the progress bar + workflow row disc
 *  (design review 2026-05-25 refinement):
 *    done        = review closed AND no uncommitted local draft
 *    uncommitted = local draft present (curator has touched but
 *                  not finished)
 *    untouched   = no curator activity — INCLUDES the server's
 *                  ``audit_status="in_progress"`` rows that exist
 *                  from calibration import but haven't seen any
 *                  curator action. Until the agents side lands
 *                  ``has_curator_activity``, the local-draft
 *                  cache is the only signal we trust for
 *                  "curator started." */
function memberRowDiscTone(
  auditStatus: ExperimentAuditStatus | undefined,
  hasLocalDraft: boolean,
): StatusDiscTone {
  if (auditStatus === "closed" && !hasLocalDraft) return "done";
  if (hasLocalDraft) return "uncommitted";
  return "untouched";
}

/** Tooltip copy that pairs with ``memberRowDiscTone``. */
function memberRowDiscTitle(
  auditStatus: ExperimentAuditStatus | undefined,
  hasLocalDraft: boolean,
): string {
  if (auditStatus === "closed" && hasLocalDraft) {
    return "review closed but uncommitted local changes remain";
  }
  if (auditStatus === "closed") return "review closed";
  if (hasLocalDraft) return "uncommitted local changes";
  if (auditStatus === "in_progress") {
    return "proposal exists but not yet touched";
  }
  return "untouched — no review yet";
}

/** Tone the group chip by its workflow type. Mirrors the funnel
 *  intent — screening = neutral early-stage, pipeline = active
 *  processing, review = closing out. Dark-mode variants are
 *  required since the banner surfaces sit directly on the dark
 *  background; light-mode-only fills wash out / lose contrast. */
function groupTypeChipCls(type: GroupType): string {
  switch (type) {
    case "screening":
      return (
        "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100 " +
        "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/70"
      );
    case "pipeline":
      return (
        "bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100 " +
        "dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900/50"
      );
    case "review":
      return (
        "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 " +
        "dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      );
    default:
      return (
        "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100 " +
        "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/70"
      );
  }
}
