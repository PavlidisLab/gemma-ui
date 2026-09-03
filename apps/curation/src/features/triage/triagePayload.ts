/**
 * A screening ticket's ``payload_json``, parsed once.
 *
 * Two surfaces read it — the triage table and the preboarding detail
 * page the table links into — and both need the same two things out of
 * it: the per-candidate metadata (keyed by ``target_id``) and the
 * ticket's decision verbs. A second parser would be a second place for
 * the verbs to fall back to "Include / Exclude" when a ticket actually
 * specced something else.
 */
import { snakeify } from "@/api/client";
import type { Ticket, TicketTarget } from "@/api/tickets";

/** A self-describing display field the producing agent attaches to a
 *  candidate. TriageView's generic renderer turns these into native
 *  chips / links / prose without knowing the domain, so one view serves
 *  any screen (pub-finder, TF-perturbation, cell-line, …). The producer
 *  supplies both the data and its presentation hint. */
export interface DisplayField {
  label: string;
  value: string | number | boolean | null;
  /** How to render. Defaults to plain text. */
  type?: "text" | "link" | "badge" | "tier" | "longtext";
  /** For ``link``: the href. */
  href?: string;
  /** Which panel the field belongs in (e.g. study / paper / decision).
   *  Fields with the same group render together. */
  group?: string;
  /** Terms to paint in a contrasting, theme-aware ``<mark>`` inside this
   *  field's value — the overlap the producer computed between two sides
   *  (shared surnames, institution tokens, summary↔abstract content words)
   *  so the match lights up on both without eye-diffing the blurbs. */
  highlight?: string[];
}

export interface CandidateMeta {
  accession: string;
  identifying_metadata?: Record<string, unknown> | null;
  matched_criteria?: string[];
  source?: string;
  /** Local_api preboarding row id minted at scrape time. When present,
   *  the triage row links to the read-only PreboardingDetailPage at
   *  ``#/experiments/preboarding:<id>``, and — reading the same field
   *  back the other way — that page finds which ticket target it is
   *  looking at. Null on tickets created before the preboard-at-scrape
   *  change landed. */
  preboarding_id?: number | null;
  /** Ad-hoc decision-support context the producing agent computed for
   *  this screen. When present the row renders as a generic card driven
   *  by these fields instead of the fixed GEO-scrape table. */
  display_fields?: DisplayField[];
}

export interface ParsedPayload {
  candidates: Record<string, CandidateMeta>;
  scrape_window?: {
    since?: string;
    until?: string;
    criteria?: string[];
  };
  /** Agent-authored account of what this screen did — the
   *  reproducible-explanation slot, rendered as a banner. */
  screen_summary?: string;
  /** Task-specific decision verbs. The disposition data stays
   *  include/exclude; only the labels change (e.g. Confirm / Reject for
   *  "is this the right paper?"). Falls back to Include / Exclude. */
  decision?: {
    confirm_label?: string;
    reject_label?: string;
    prompt?: string;
  };
}

/** The ticket's payload string, from whichever side served the ticket.
 *
 *  The store spells it `payload_json`; Gemma spells it `payload`
 *  (`TicketValueObject.payload`, live 2026-09-03). Same JSON, two field
 *  names, so every reader goes through here rather than picking one and
 *  going blank against the other host.
 *
 *  🛑 The store's field wins when both are present. A ticket carrying
 *  both is a ticket mid-migration, and the store's copy is the one its
 *  own targets were keyed against. */
export function ticketPayload(ticket: {
  payload_json?: string;
  payload?: string;
}): string | undefined {
  return ticket.payload_json ?? ticket.payload;
}

/**
 * Parse a payload string.
 *
 * 🛑 **The keys inside are NOT normalized by the client boundary.** The
 * payload is a JSON string, so `snakeify` renames the field HOLDING it
 * and stops; `JSON.parse` then returns whatever case the producer
 * wrote. Same trap as `identifyingMetadata` — see `TriageView`'s
 * fallback. Normalized here once, so every reader below takes one
 * spelling.
 *
 * `snakeify` is idempotent, so a payload already written in snake_case
 * (every ticket the scrape script has produced to date) is unchanged.
 * It also leaves `candidates`' keys alone — they are target ids, and
 * `snakeify` only rewrites field names, not the numeric-string keys of
 * a map.
 */
export function parsePayload(payload_json: string | undefined): ParsedPayload {
  if (!payload_json) return { candidates: {} };
  try {
    const obj = snakeify(JSON.parse(payload_json)) as Record<string, unknown>;
    return {
      candidates: (obj?.candidates as ParsedPayload["candidates"]) ?? {},
      scrape_window: obj?.scrape_window as ParsedPayload["scrape_window"],
      screen_summary: obj?.screen_summary as string | undefined,
      decision: obj?.decision as ParsedPayload["decision"],
    };
  } catch {
    return { candidates: {} };
  }
}

/** The verbs this ticket asks its question in. Never invent a third
 *  option here: the stored disposition is binary, so a ticket needing
 *  three outcomes needs a wire change, not a relabelled button. */
export function decisionLabels(parsed: ParsedPayload): {
  confirmLabel: string;
  rejectLabel: string;
} {
  return {
    confirmLabel: parsed.decision?.confirm_label ?? "Include",
    rejectLabel: parsed.decision?.reject_label ?? "Exclude",
  };
}

/**
 * Find the ticket target that stands for a given preboarding row.
 *
 * The link runs through ``payload_json.candidates[<target_id>].preboarding_id``
 * — the same field the triage row builds its drill-in URL from. The
 * detail page only knows its own preboarding id and the ticket id from
 * the URL, so this walks the mapping back the other way.
 *
 * Returns null when the ticket has no such candidate: a preboarding row
 * can be opened from a set or the workflow page with no ticket at all,
 * and a ticket predating preboard-at-scrape carries no ids to match.
 */
export function findTargetForPreboarding(
  ticket: Ticket | null | undefined,
  preboardingId: number | null,
): TicketTarget | null {
  if (!ticket || preboardingId == null) return null;
  const parsed = parsePayload(ticket.payload_json);
  for (const t of ticket.targets ?? []) {
    const meta = parsed.candidates[String(t.target_id)];
    if (meta?.preboarding_id != null && meta.preboarding_id === preboardingId) {
      return t;
    }
  }
  return null;
}

/**
 * The candidates on a ticket that have a page to walk to, in ticket
 * order, with the current one located.
 *
 * Deciding a screen is one candidate after another, so the detail page
 * is a queue, not a leaf: read, decide, next. Only candidates carrying
 * a ``preboarding_id`` are included — the rest have no detail page to
 * land on, and stepping onto a dead route mid-queue is worse than
 * skipping it.
 *
 * Order is the ticket's own target order. The triage table's filter,
 * sort and paging are its own local state and don't reach this page, so
 * "next" here means next on the ticket, not next in whatever view the
 * curator left behind.
 */
export function preboardingSiblings(
  ticket: Ticket | null | undefined,
  currentId: number | null,
): { ids: number[]; index: number; prev: number | null; next: number | null } {
  const empty = { ids: [] as number[], index: -1, prev: null, next: null };
  if (!ticket) return empty;
  const parsed = parsePayload(ticket.payload_json);
  const ids: number[] = [];
  for (const t of ticket.targets ?? []) {
    const id = parsed.candidates[String(t.target_id)]?.preboarding_id;
    if (id != null) ids.push(id);
  }
  if (ids.length === 0) return empty;
  const index = currentId == null ? -1 : ids.indexOf(currentId);
  return {
    ids,
    index,
    prev: index > 0 ? ids[index - 1] : null,
    next: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
  };
}

/** Pull the numeric row id out of a ``preboarding:52`` experiment id.
 *  Returns null for a plain numeric EE id — those are imported
 *  experiments and have no triage row behind them. */
export function preboardingRowId(
  experimentId: string | number,
): number | null {
  const m = /^preboarding:(\d+)$/.exec(String(experimentId));
  return m ? Number(m[1]) : null;
}
