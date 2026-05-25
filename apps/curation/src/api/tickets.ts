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
 * **Status (2026-05-25): MOCK.** Gemma 2.0's tickets REST API exists
 * (``/rest/v2/tickets``) but isn't wired into the local-mode flow
 * yet. ``useMyTickets`` returns an in-memory seed pointing at real
 * experiment_ids from ``local_curation.sqlite`` so the dashboard
 * surface has something to render. Drop the seed + flip to a
 * network call when the local-api side lands the endpoint.
 */
import { useQuery } from "@tanstack/react-query";

export type TicketType =
  | "BATCH_INFO_NEEDED"
  | "REALIGNMENT_NEEDED"
  | "QUALITY_REVIEW"
  | "GENERIC";

export type TicketState = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TicketTargetType =
  | "EXPRESSION_EXPERIMENT"
  | "ARRAY_DESIGN"
  | "FACTOR_VALUE"
  | "GEO_SCRAPE_WATERMARK";

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
}

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
  targets: TicketTarget[];
}

/** In-memory seed. Targets are real experiment_ids from
 *  ``local_curation.sqlite`` so the dashboard cards click through
 *  to populated experiment shells. */
const MOCK_TICKETS: Ticket[] = [
  {
    id: 1001,
    title: "Calibration batch Gen4 — proposer review",
    type: "QUALITY_REVIEW",
    state: "IN_PROGRESS",
    priority: "HIGH",
    due_date: "2026-05-29",
    reporter_id: 1,
    reporter_name: "calibration-pipeline",
    assignee_id: 2,
    assignee_name: "local-curator",
    created_at: "2026-05-24T04:23:10Z",
    updated_at: "2026-05-25T01:11:00Z",
    external_issue_url: null,
    targets: [
      { target_id: 91247, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE286287" },
      { target_id: 91672, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE269647" },
      { target_id: 91654, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE253365" },
      { target_id: 91277, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE267498" },
    ],
  },
  {
    id: 1002,
    title: "GEO scrape 2026-05-22 — preboarded candidates",
    type: "GENERIC",
    state: "OPEN",
    priority: "NORMAL",
    due_date: null,
    reporter_id: 1,
    reporter_name: "geo-scrape-pipeline",
    assignee_id: null,
    assignee_name: null,
    created_at: "2026-05-22T08:00:00Z",
    updated_at: "2026-05-22T08:00:00Z",
    external_issue_url: null,
    targets: [
      { target_id: 91651, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE277231" },
      { target_id: 91271, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE286384.1" },
      { target_id: 91270, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE286384.2" },
    ],
  },
  {
    id: 1003,
    title: "GSE271616 — batch info ambiguous, needs curator decision",
    type: "BATCH_INFO_NEEDED",
    state: "OPEN",
    priority: "URGENT",
    due_date: "2026-05-26",
    reporter_id: 3,
    reporter_name: "qc-pipeline",
    assignee_id: 2,
    assignee_name: "local-curator",
    created_at: "2026-05-23T14:30:00Z",
    updated_at: "2026-05-24T09:00:00Z",
    external_issue_url: null,
    targets: [
      { target_id: 91222, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE271616.1" },
      { target_id: 91224, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE271616.2" },
    ],
  },
  {
    id: 1004,
    title: "Realign GSE292869 against GRCm39",
    type: "REALIGNMENT_NEEDED",
    state: "OPEN",
    priority: "LOW",
    due_date: null,
    reporter_id: 1,
    reporter_name: "pipeline-admin",
    assignee_id: null,
    assignee_name: null,
    created_at: "2026-05-18T11:00:00Z",
    updated_at: "2026-05-18T11:00:00Z",
    external_issue_url: null,
    targets: [
      { target_id: 91648, target_type: "EXPRESSION_EXPERIMENT", display_label: "GSE292869" },
    ],
  },
];

/** Tickets the current curator should see as "work to do" — open
 *  or in-progress. The real REST surface will scope by assignee +
 *  permissions; the mock returns everything open/in-progress
 *  regardless of assignee since the UI has one local user. */
export function useMyTickets() {
  return useQuery<Ticket[]>({
    queryKey: ["tickets", "mine"],
    queryFn: async () => {
      // Simulate a tiny network delay so loading states are
      // visible during development.
      await new Promise((r) => setTimeout(r, 50));
      return MOCK_TICKETS.filter(
        (t) => t.state === "OPEN" || t.state === "IN_PROGRESS",
      );
    },
    staleTime: 1000 * 60,
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
