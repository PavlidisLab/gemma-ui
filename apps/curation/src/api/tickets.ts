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
  | "GENERIC";

export type TicketState = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TicketTargetType =
  | "EXPRESSION_EXPERIMENT"
  | "ARRAY_DESIGN"
  | "FACTOR_VALUE"
  | "GEO_SCRAPE_WATERMARK";

export type TicketTargetStatus = "NOT_DONE" | "UNDERWAY" | "DONE";

export interface TicketTarget {
  /** Wire-shape ID of the targeted entity. For
   *  ``EXPRESSION_EXPERIMENT`` this is the numeric experiment_id the
   *  ``/experiments/{id}`` route accepts. */
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
}

export type TicketMode = "MANUAL" | "AUTO";

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
  targets: TicketTarget[];
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
  return useQuery<Ticket | null>({
    queryKey: ["ticket", id],
    queryFn: async () => {
      if (id == null) return null;
      return await api.get<Ticket>(`/rest/v2/tickets/${id}`);
    },
    enabled: id != null,
    refetchInterval: options.refetchInterval,
  });
}

/** PATCH a ticket. Partial body — only set fields actually change.
 *  Today the UI uses this for the mode toggle (MANUAL ↔ AUTO);
 *  future surfaces can flip state / assignee / title / etc through
 *  the same hook. */
export function usePatchTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Ticket, "mode" | "state" | "title">>) => {
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
  options: { refetchInterval?: number | false } = {},
) {
  return useQuery<Ticket[]>({
    queryKey: ["tickets", "mine"],
    queryFn: async () => {
      const all = await api.get<Ticket[]>("/rest/v2/tickets");
      return (all ?? []).filter(
        (t) => t.state === "OPEN" || t.state === "IN_PROGRESS",
      );
    },
    staleTime: 1000 * 60,
    refetchInterval: options.refetchInterval,
  });
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
