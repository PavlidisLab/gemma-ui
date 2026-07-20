/**
 * Curator Ticket — work item representing a piece of curation work
 * (a set of experiments to curate / fix / process / debug / review).
 *
 * Wire-shape mirrors Gemma 2.0's ``TicketValueObject`` in
 * ``ubic.gemma.model.common.auditAndSecurity.curation.TicketValueObject``.
 * Enums (``type``, ``state``, ``priority``, ``targetType``) mirror the
 * Java side exactly so a future flip to the real REST surface only
 * needs to swap ``useMyTickets`` to a network fetch.
 *
 * ``useMyTickets`` hits the local-api ``/rest/v2/tickets`` endpoint
 * directly. No in-tree fixture; the dashboard renders whatever the
 * backend serves (empty list on a fresh DB).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";

import { api } from "@/api/client";

export type TicketType =
  | "BATCH_INFO_NEEDED"
  | "REALIGNMENT_NEEDED"
  | "QUALITY_REVIEW"
  | "PRELOAD"
  | "CURATION"
  | "SCREENING"
  | "REVIEW"
  | "GENERIC";

export type TicketState = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TicketTargetType =
  | "EXPRESSION_EXPERIMENT"
  | "ARRAY_DESIGN"
  | "FACTOR_VALUE"
  | "GEO_SCRAPE_WATERMARK"
  | "GEO_ACCESSION";

export type TicketTargetStatus = "NOT_DONE" | "UNDERWAY" | "DONE";

/** Per-target triage decision used by ``SCREENING`` tickets. ``null``
 *  / undefined = curator hasn't decided yet; ``include`` = ship to
 *  the follow-up curation ticket; ``exclude`` = drop. Independent of
 *  ``status`` (which tracks "processed" vs "not"). */
export type TicketTargetTriageDisposition = "include" | "exclude" | null;

export interface TicketTarget {
  /** Wire-shape ID of the targeted entity. For
   *  ``EXPRESSION_EXPERIMENT`` this is the numeric experiment_id the
   *  ``/experiments/{id}`` route accepts. For ``GEO_ACCESSION``
   *  triage targets it's a synthetic 1..N id minted by the scrape
   *  script; the real accession lives in the parent ticket's
   *  ``payload_json.candidates[<target_id>]``. */
  target_id: number;
  target_type: TicketTargetType;
  /** Optional display label the dashboard renders on the ticket
   *  card. Gemma 2.0's VO doesn't carry this directly; the UI may
   *  resolve it from a side fetch in production. The mock pre-
   *  populates it so the dashboard reads as it would post-resolve. */
  display_label?: string;
  /** Optional human-readable name (the experiment's ``name`` field
   *  on the design — what the EE shell renders as the page title).
   *  Populated server-side via a JOIN on ``designs.body_json.name``
   *  when the target is an EE; absent for non-experiment target
   *  types. */
  display_name?: string;
  /** Per-target progress through the ticket's work:
   *   - ``NOT_DONE``: curator hasn't touched this target
   *   - ``UNDERWAY``: curator started; not yet committed
   *   - ``DONE``: curator finished whatever the ticket required
   *
   *  Mirrors the proposed ``TicketTarget.status`` on Gemma's Java
   *  side. Tickets-with-many-targets render a summary roll-up over
   *  this field rather than per-target chips. */
  status?: TicketTargetStatus;
  /** ``SCREENING`` tickets only — include/exclude decision the
   *  curator sets during triage. ``null`` until the curator
   *  decides. Set via ``usePatchTicketTarget`` and consumed by
   *  ``useFinalizeTriage`` at the end of the worklist. */
  triage_disposition?: TicketTargetTriageDisposition;
}

export type TicketMode = "MANUAL" | "AUTO";

/** Edit vs review — drives the curation comparison view's read-only
 *  lock per ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``. ``edit``
 *  means the curator is actively working the ticket (design tab
 *  editable, accept/reject live, commit bar visible). ``review`` is
 *  show-and-tell — chip strip still drives diffs but all action
 *  affordances are suppressed. Default ``review`` on the server. */
export type TicketFlow = "edit" | "review";

export interface Ticket {
  id: number;
  title: string;
  type: TicketType;
  state: TicketState;
  priority: TicketPriority;
  due_date: string | null;
  reporter_id: number | null;
  reporter_name: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  external_issue_url: string | null;
  /** Curator-facing instructions for the ticket — the "what does
   *  the curator need to do" text the reporter writes when filing.
   *  Plain text today; rendered as multi-line on the detail page
   *  and clamped to 2 lines on dashboard cards. Empty for tickets
   *  filed by scripts that didn't set body. */
  body: string;
  /** How the ticket advances between actions. ``MANUAL`` — the
   *  curator clicks the next-action button after each completed
   *  action (default). ``AUTO`` — server auto-schedules the next
   *  defined action when the current runner finishes with no
   *  failures. */
  mode: TicketMode;
  /** Edit / review flow control — see ``TicketFlow``. Optional on the
   *  read shape so a UI talking to a backend predating this field
   *  still functions (the chip strip falls back to its
   *  no-ticket default, ``review``). */
  flow?: TicketFlow;
  /** Server-side payload blob (JSON string). For ``SCREENING``
   *  triage tickets the scrape script stashes the candidate map
   *  here so the UI can read per-target accession + identifying
   *  metadata without an extra round-trip. Shape (when
   *  populated by the scrape):
   *  ``{candidates: {"<target_id>": {accession, identifying_metadata,
   *  matched_criteria, source}}, scrape_window: {since, until,
   *  criteria}}``. */
  payload_json?: string;
  targets: TicketTarget[];
  /** Rolled-up target status counts, always populated by the list +
   *  detail serializers. Lets the dashboard render progress without
   *  the (potentially thousands-strong) per-target array — the light
   *  list mode (``?include_targets=false``) omits ``targets`` and
   *  relies on this. Absent only when talking to a backend predating
   *  the rollup, in which case callers fall back to deriving from
   *  ``targets``. */
  target_summary?: {
    total: number;
    not_done: number;
    underway: number;
    done: number;
  };
  /** Rolled-up triage include/exclude/undecided counts — screening
   *  progress for a ``SCREENING`` ticket without walking targets. */
  disposition_summary?: {
    include: number;
    exclude: number;
    undecided: number;
  };
  /** Legacy single-investigation pointer the server backfills from the
   *  first EE target. Used to jump straight to the experiment for a
   *  single-target dataset ticket when the ``targets`` array isn't in
   *  hand (light list mode). */
  investigation_kind?: string;
  investigation_id?: number;
}

/** Fetch a single ticket by id.
 *
 *  ``options.refetchInterval`` lets the caller poll the ticket while
 *  an async action is in flight (e.g. the PRELOAD runner). The
 *  callback receives the Query (TanStack v5 shape) — pull
 *  ``query.state.data`` to inspect the current ticket. Return
 *  ``false`` from the function to stop polling. */
export function useTicket(
  id: number | null | undefined,
  options: {
    refetchInterval?:
      | number
      | ((
          query: Query<Ticket | null, Error, Ticket | null, readonly unknown[]>,
        ) => number | false | undefined);
  } = {},
) {
  // Default polling cadence — 15 s when nothing's UNDERWAY, 2 s
  // while an in-flight runner is flipping targets. Without this,
  // bro's behind-the-scenes target-status flips (PRELOAD runner,
  // agent passes, manual backend edits) don't reach the UI until
  // a manual refresh. Per Paul 2026-06-14: ticket #52 read
  // "0/200 done · 200 not started" while the row dots showed
  // several Started — the previous gate (poll ONLY while
  // UNDERWAY) never fired because at the time of the initial
  // fetch nothing was UNDERWAY, freezing the no-UNDERWAY snapshot
  // for the rest of the session. Callers can override by passing
  // their own ``refetchInterval``. */
  const defaultInterval = (
    query: Query<Ticket | null, Error, Ticket | null, readonly unknown[]>,
  ) => {
    const data = query.state.data;
    const anyUnderway =
      data?.targets?.some((t) => t.status === "UNDERWAY") ?? false;
    return anyUnderway ? 2000 : 15000;
  };
  return useQuery<Ticket | null>({
    queryKey: ["ticket", id],
    queryFn: async () => {
      if (id == null) return null;
      return await api.get<Ticket>(`/rest/v2/tickets/${id}`);
    },
    enabled: id != null,
    refetchInterval: options.refetchInterval ?? defaultInterval,
  });
}

/** PATCH a ticket. Partial body — only set fields actually change.
 *  Today the UI uses this for the mode toggle (MANUAL ↔ AUTO);
 *  future surfaces can flip state / assignee / title / etc through
 *  the same hook. */
export function usePatchTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Ticket, "mode" | "state" | "title" | "flow">>) => {
      return await api.patch<Ticket>(`/rest/v2/tickets/${ticketId}`, patch);
    },
    onSuccess: (next) => {
      qc.setQueryData(["ticket", ticketId], next);
      qc.invalidateQueries({ queryKey: ["tickets", "mine"] });
    },
  });
}

/** Trigger an async action on a ticket. The local-api endpoint
 *  ``POST /rest/v2/tickets/{id}/actions`` dispatches on ``action``
 *  and schedules the work as a FastAPI ``BackgroundTask``; the
 *  request returns 202 immediately. Callers should follow up by
 *  polling the ticket (see ``useTicket``'s ``refetchInterval`` opt)
 *  to watch per-target status flip NOT_DONE → UNDERWAY → DONE.
 *
 *  On the long-term gemma-rest path this endpoint reroutes to the
 *  Java side; the UI contract doesn't change. See project memory
 *  ``project-mock-with-local-pattern``. */
export function useRunTicketAction(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: string) => {
      return await api.post<unknown>(
        `/rest/v2/tickets/${ticketId}/actions`,
        { action },
      );
    },
    onSuccess: () => {
      // Refetch the ticket so the polling layer picks up the first
      // status flip without waiting a full interval.
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    },
  });
}

/** Body for ``POST /rest/v2/tickets`` — modern shape with explicit
 *  targets. The server backfills the legacy ``investigation_kind`` /
 *  ``investigation_id`` columns from the first EE target when those
 *  aren't supplied. Java side will own this endpoint in production;
 *  the UI contract is what survives the swap. */
export interface TicketCreateBody {
  type: TicketType;
  title: string;
  priority?: TicketPriority;
  mode?: "MANUAL" | "AUTO";
  assignee?: string;
  body?: string;
  targets: Array<{
    target_type: TicketTargetType;
    target_id: number;
    status?: "NOT_DONE" | "UNDERWAY" | "DONE";
  }>;
}

/** Mutation hook for creating a ticket. Invalidates the curator's
 *  open-ticket list on success so the dashboard / leave-guard pick
 *  up the new ticket without a manual refetch. */
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TicketCreateBody) => {
      return await api.post<Ticket>("/rest/v2/tickets", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets", "mine"] });
    },
  });
}

/** Tickets the current curator should see as "work to do" — open
 *  or in-progress. The real REST surface will scope by assignee +
 *  permissions; the local-api currently returns every open/in-progress
 *  ticket since there's one local user.
 *
 *  ``options.refetchInterval`` lets the caller drive a live-refresh
 *  loop — same shape as ``useTicket``. Callers that watch a
 *  long-running ticket action (PRELOAD runner, future agent
 *  passes) poll this to pick up per-target status changes that bump
 *  the ``IN_PROGRESS`` filter. */
export function useMyTickets(
  options: {
    refetchInterval?: number | false;
    /** When ``true``, include RESOLVED and CANCELLED tickets in the
     *  returned list. Default ``false`` — the dashboard's default
     *  "work to do" view only wants open / in-progress. The ticket
     *  list filter chips flip this on so the curator can browse
     *  every state. Query cache key changes when this flips, so
     *  the two callers don't fight over a single bucket. */
    includeClosed?: boolean;
    /** When ``true``, request the light list mode
     *  (``?include_targets=false``): the server omits every ticket's
     *  per-target array (and the big ``payload_json`` candidate blob)
     *  and returns ``target_summary`` / ``disposition_summary`` rollups
     *  instead. Cuts the dashboard fetch from ~40 MB to ~19 KB. Only the
     *  dashboard opts in — callers that read ``ticket.targets`` from the
     *  list (nextTask, ExperimentQueue) leave this off. Distinct cache
     *  bucket so the two shapes don't overwrite each other. */
    light?: boolean;
  } = {},
) {
  const includeClosed = options.includeClosed ?? false;
  const light = options.light ?? false;
  return useQuery<Ticket[]>({
    queryKey: [
      "tickets",
      "mine",
      includeClosed ? "all" : "open",
      light ? "light" : "full",
    ],
    queryFn: async () => {
      const all = await api.get<Ticket[]>(
        light ? "/rest/v2/tickets?include_targets=false" : "/rest/v2/tickets",
      );
      if (includeClosed) return all ?? [];
      return (all ?? []).filter(
        (t) => t.state === "OPEN" || t.state === "IN_PROGRESS",
      );
    },
    staleTime: 1000 * 60,
    refetchInterval: options.refetchInterval,
  });
}

/**
 * Query options for the light ticket rows that have a given experiment
 * as a target. Powers the dashboard quick-search ticket gateway: when a
 * search resolves to a single experiment, we resolve its tickets to
 * decide the open path (0 → plain / 1 → live / >1 → picker).
 *
 * Backed by ``GET /rest/v2/tickets?target_id=<id>
 * &target_type=EXPRESSION_EXPERIMENT&include_targets=false`` (Cab
 * 2026-07-09). Membership is via the ``ticket_targets`` table, so it
 * catches an experiment buried inside a 200-target batch ticket — which
 * the light list's ``investigation_id`` backfill (first target only)
 * can't. Returns ``[]`` (not 404) when nothing targets the experiment.
 *
 * Exposed as options (not a hook) so callers can drive it imperatively
 * from a submit handler via ``queryClient.fetchQuery`` — we only want to
 * hit the endpoint when the curator actually searches, not per keystroke.
 */
export function experimentTicketsQueryOptions(experimentId: number | string) {
  return {
    queryKey: ["tickets", "by-experiment", experimentId] as const,
    queryFn: async () => {
      const all = await api.get<Ticket[]>(
        `/rest/v2/tickets?target_id=${encodeURIComponent(String(experimentId))}` +
          `&target_type=EXPRESSION_EXPERIMENT&include_targets=false`,
      );
      return all ?? [];
    },
    staleTime: 1000 * 30,
  };
}

/** Cosmetic label for a ticket type — what the dashboard chip
 *  reads. Mirrors the Java enum's javadoc in plain English. */
export function ticketTypeLabel(t: TicketType): string {
  switch (t) {
    case "BATCH_INFO_NEEDED":
      return "Batch info";
    case "REALIGNMENT_NEEDED":
      return "Realignment";
    case "QUALITY_REVIEW":
      return "Quality review";
    case "PRELOAD":
      return "Preload";
    case "CURATION":
      return "Curation";
    case "SCREENING":
      return "Screening";
    case "REVIEW":
      return "Review";
    case "GENERIC":
      return "General";
  }
}

export function ticketPriorityRank(p: TicketPriority): number {
  switch (p) {
    case "URGENT":
      return 0;
    case "HIGH":
      return 1;
    case "NORMAL":
      return 2;
    case "LOW":
      return 3;
  }
}

/** Body for ``PATCH /rest/v2/tickets/{id}/targets/{type}/{tid}`` —
 *  flip one ticket-target's status and/or triage_disposition. Both
 *  fields optional. Used by the triage view to record include /
 *  exclude per row. */
export interface TicketTargetPatchBody {
  status?: TicketTargetStatus;
  triage_disposition?: TicketTargetTriageDisposition;
}

/** Mutation hook for per-target patches on a ticket. Optimistically
 *  updates the cached ticket so the row flips immediately; server
 *  response replaces the cache on success. */
export function usePatchTicketTarget(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      target_type: TicketTargetType;
      target_id: number;
      patch: TicketTargetPatchBody;
    }) => {
      const path =
        `/rest/v2/tickets/${ticketId}/targets/` +
        `${encodeURIComponent(args.target_type)}/${args.target_id}`;
      return await api.patch<Ticket>(path, args.patch);
    },
    onSuccess: (next) => {
      qc.setQueryData(["ticket", ticketId], next);
    },
  });
}

/** One bucketed candidate returned by ``finalize-triage`` — mirrors
 *  ``TriageFinalizeCandidate`` on the Python side. */
export interface TriageFinalizeCandidate {
  target_id: number;
  target_type: TicketTargetType;
  accession: string;
  identifying_metadata?: Record<string, unknown> | null;
  matched_criteria: string[];
  source: string;
}

export interface TriageFinalizeResponse {
  ticket_id: number;
  included: TriageFinalizeCandidate[];
  excluded: TriageFinalizeCandidate[];
  undecided: TriageFinalizeCandidate[];
  undecided_count: number;
}

/** Mutation hook for ``POST /rest/v2/tickets/{id}/finalize-triage``.
 *  Buckets the ticket's targets by ``triage_disposition`` and
 *  returns the lists the follow-up runner needs. Does not mutate
 *  the ticket — the runner closes it after the follow-on is
 *  created. */
export function useFinalizeTriage(ticketId: number) {
  return useMutation({
    mutationFn: async () => {
      return await api.post<TriageFinalizeResponse>(
        `/rest/v2/tickets/${ticketId}/finalize-triage`,
        {},
      );
    },
  });
}
