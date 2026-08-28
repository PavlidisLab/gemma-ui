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

/** Per-target triage decision used by ``SCREENING`` tickets.
 *
 *  - ``include`` — ship to the follow-up curation ticket
 *  - ``exclude`` — drop
 *  - ``unsure``  — REVIEWED and unresolved. Distinct from ``null``,
 *    which is nobody-has-looked-yet. Collapsing the two would make a
 *    curator's work product indistinguishable from an untouched row
 *    and leave no way to hand it on; the split is why this value
 *    exists. Implies ``status=DONE`` server-side (the coupling keys
 *    on the decision being non-null, not on which decision it is).
 *  - ``null`` / undefined — not yet reviewed.
 *
 *  Independent of ``status`` (which tracks "processed" vs "not").
 *
 *  🛑 Clearing back to undecided is spelled ``""`` on the wire, not
 *  ``null`` — see ``toWirePatch``. An explicit ``null`` is now a 400. */
export type TicketTargetTriageDisposition =
  | "include"
  | "exclude"
  | "unsure"
  | null;

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
  /** Free text explaining an ``unsure`` — cleared with the decision
   *  server-side, so a stale reason can't outlive the ``unsure`` it
   *  belonged to and reattach to a later ``include``. Comes back on
   *  the BULK read: a leftover pile is a class-level signal, and
   *  behind a per-target fetch nobody would wire it. */
  triage_disposition_reason?: string | null;
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
   *
   *  **Markdown is supported, never required.** The agents side writes
   *  these with bold, code spans and pipe tables; curators write the
   *  same field by hand in plain text. The detail page renders it via
   *  `MarkdownText`, which leaves unmarked text looking exactly as it
   *  did when this was rendered `whitespace-pre-line` — single newlines
   *  included. Dashboard cards strip the markers instead
   *  (`markdownToPlainText`), because a four-line clamp cannot hold a
   *  table. Empty for tickets filed by scripts that didn't set body. */
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
  /** The comparison baseline this ticket's findings were computed
   *  against — a chip-strip source token, spelled as the URL spells
   *  it (``polished:gold``, ``polished:consensus_strict_consensus``,
   *  ``live``, ``preboard``).
   *
   *  A ticket built against gold polished, reviewed with the selector
   *  sitting on the curator's own newer polished row, asks the curator
   *  to re-fix things they already fixed — both sides telling the
   *  truth about different baselines, with nothing on screen marking
   *  the difference (handoff
   *  ``AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE.md``).
   *  When set, the chip strip opens on this source and says so plainly
   *  if the reviewer moves off it.
   *
   *  Optional: absent on every ticket built before the field existed,
   *  in which case the chip strip keeps its own defaults. Read it via
   *  ``ticketBaselineSource`` — ``payload_json`` is the other place it
   *  can arrive. */
  baseline_source?: string | null;
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
    /** Reviewed and unresolved — NOT folded into ``undecided``. The
     *  natural way to write that rollup (``else: undecided += 1``)
     *  puts reviewed-and-unresolved back in the same bucket as
     *  nobody-has-looked, which would silently undo the feature. */
    unsure?: number;
    undecided: number;
  };
  /** Legacy single-investigation pointer the server backfills from the
   *  first EE target. Used to jump straight to the experiment for a
   *  single-target dataset ticket when the ``targets`` array isn't in
   *  hand (light list mode). */
  investigation_kind?: string;
  investigation_id?: number;
}

/** The chip-strip baseline a ticket pins, or ``null`` when it pins
 *  none (every ticket built before the field existed).
 *
 *  Two accepted homes, because the agents side can land the field in
 *  either without a schema migration: the top-level
 *  ``baseline_source`` column, or ``baseline_source`` inside the
 *  free-form ``payload_json`` blob. Top level wins when both are
 *  present. A malformed blob is not an error here — it just means no
 *  pin, and the chip strip keeps its own defaults. */
export function ticketBaselineSource(
  ticket: Ticket | null | undefined,
): string | null {
  if (!ticket) return null;
  const top = (ticket.baseline_source || "").trim();
  if (top) return top;
  if (!ticket.payload_json) return null;
  try {
    const obj: unknown = JSON.parse(ticket.payload_json);
    if (!obj || typeof obj !== "object") return null;
    const raw = (obj as Record<string, unknown>).baseline_source;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
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
  // the agents-side behind-the-scenes target-status flips (PRELOAD runner,
  // agent passes, manual backend edits) don't reach the UI until
  // a manual refresh. Per design review 2026-06-14: ticket #52 read
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

/** Body for ``POST /rest/v2/tickets/from-accession`` — pull an
 *  experiment out of Gemma and open a ticket over it in one call.
 *
 *  ``type`` / ``flow`` / ``strip_curation`` are deliberately NOT sent.
 *  The route already defaults them to ``REVIEW`` / ``review`` /
 *  ``false``, which is exactly what this surface wants, and the Python
 *  side owns the wire (see the repo CLAUDE.md cross-repo note). Sending
 *  our own copy would be a second definition of the same default, free
 *  to drift.
 *
 *  ``accession`` takes what ``import_into_mock`` takes — a GEO
 *  accession (``GSE12345``) or a numeric Gemma experiment id. */
export interface TicketFromAccessionBody {
  accession: string;
  title?: string;
  body?: string;
}

/** Mutation hook for importing an experiment and opening a review
 *  ticket on it.
 *
 *  🛑 LOCAL MODE ONLY. The import half copies Gemma into the local
 *  store; against the real Gemma you curate the database directly and
 *  there is nothing to import. The route doesn't guard this itself —
 *  callers gate on ``useGemmaMode().mode === "local"``, the same rule
 *  every other re-import affordance follows.
 *
 *  Failures are the import's, and no ticket is opened when one fires:
 *  404 for an accession Gemma doesn't have, 502 for an upstream Gemma
 *  error. Both reach the caller as ``ApiError`` — a ticket pointing at
 *  an experiment that failed to import looks like work waiting rather
 *  than an error, which is why the server declines to make one. */
export function useCreateTicketFromAccession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TicketFromAccessionBody) => {
      return await api.post<Ticket>("/rest/v2/tickets/from-accession", body);
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
      const raw = await api.get<Ticket[]>(
        light ? "/rest/v2/tickets?include_targets=false" : "/rest/v2/tickets",
      );
      // 🛑 Coerce at the source, not at each caller. Tickets live in the
      // curation store; in remote mode `/rest/v2/tickets` reaches Gemma,
      // which has no such collection and answers with something that is
      // not a list. `all ?? []` passes an OBJECT straight through, and
      // the dashboard's `(tickets ?? []).filter(...)` then threw and
      // took the whole page down with it. An empty list is also the
      // truthful answer there: Gemma has no tickets.
      const all: Ticket[] = Array.isArray(raw) ? raw : [];
      if (includeClosed) return all;
      return all.filter(
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
 * &target_type=EXPRESSION_EXPERIMENT&include_targets=false``.
 * Membership is via the ``ticket_targets`` table, so it
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

/** Total target count for a ticket, preferring the server's rollup
 *  (present in both light + full list modes) and falling back to the
 *  in-hand ``targets`` array. Zero when neither is populated. */
export function ticketTargetTotal(ticket: Ticket): number {
  return ticket.target_summary?.total ?? ticket.targets?.length ?? 0;
}

/** True when the ticket has exactly one target — the "single-experiment
 *  ticket" case where finishing that one experiment is the whole job.
 *  Used to offer resolving the ticket the moment its lone review is
 *  finalized. */
export function isSingleTargetTicket(ticket: Ticket): boolean {
  return ticketTargetTotal(ticket) === 1;
}

/** A ticket is closed once resolved or cancelled — the dashboard hides
 *  these from the default open view, and the close/reopen control flips
 *  on this. */
export function ticketIsClosed(ticket: Ticket): boolean {
  return ticket.state === "RESOLVED" || ticket.state === "CANCELLED";
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
  /** Why the curator couldn't resolve it. Only meaningful alongside
   *  ``unsure``; the store clears it whenever the decision changes,
   *  so there is no need to send an explicit clear. */
  triage_disposition_reason?: string | null;
}

/**
 * Translate a UI-land patch into the wire's sentinels.
 *
 * 🛑 **Clearing a triage decision is ``""`` on the wire, never ``null``.**
 * The store reads a patch field-by-field and skips anything that arrives
 * as ``None`` — that is how "field not provided" is expressed — so a
 * JSON ``null`` returns 200, applies the rest of the patch, and leaves
 * the disposition exactly as it was. The UI sent ``null`` for months
 * and the "click again to undecide" path silently did nothing against a
 * live store; unit tests didn't catch it because they assert the mutate
 * call, not the server's reply.
 *
 * UI code keeps using ``null`` — it is the honest in-memory value for
 * "no decision". The translation happens here, once, at the boundary.
 *
 * Store contract: ``local_api/curation_workflow.py`` —
 * ``if patch.triage_disposition is not None: new_val = patch.triage_disposition or None``.
 */
export function toWirePatch(
  patch: TicketTargetPatchBody,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  if ("triage_disposition" in patch && patch.triage_disposition === null) {
    out.triage_disposition = "";
  }
  return out;
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
      return await api.patch<Ticket>(path, toWirePatch(args.patch));
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
