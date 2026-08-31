/**
 * Fold a run of events that happened together into one line.
 *
 * Gemma's trail records each step of a pipeline as its own event, so a
 * single postprocessing run reads as six rows and a single curation
 * commit as three — *"like these steps are our standard
 * postprocessing … a single line would make it more immediately
 * useful"* (Paul, 2026-08-31).
 *
 * 🛑 **Lossless, unlike the server's `compact=true`.** That flag KEEPS
 * ONE MESSAGE AND DISCARDS THE REST (gembro measured 61 rows standing
 * for 84 distinct messages on 27103). This grouping throws nothing
 * away: every member is still there, under a row that expands. The two
 * are independent — this runs whether or not the flag is on.
 *
 * 🛑 **Failures never join a group.** *"obviously any failures are
 * worth surfacing"*. A `Failed…` event stays its own row, so a run
 * that went wrong cannot be folded behind a line that reads as
 * routine, and it also breaks the run in two — the steps before the
 * failure and the steps after are not one clean pass.
 */
import type { AuditEvent } from "@/api/history";

/** How far apart two events can be and still count as "together".
 *
 *  30 minutes, from the two real cases: a postprocessing run on 27103
 *  spans 12:05→12:10, and the curation commit that prompted this spans
 *  02:05→02:18. Measured gap-to-gap, not from the start of the run, so
 *  a long pipeline stays one group while a genuinely separate later
 *  edit starts a new one. */
export const GROUP_GAP_MS = 30 * 60 * 1000;

export type GroupKind = "postprocessing" | "curation";

/** Gemma's standard postprocessing steps — the ones that fire together
 *  after data lands. Sourced from the trail on 27103, not guessed. */
const POSTPROCESSING = new Set([
  "ProcessedVectorComputationEvent",
  "BatchProblemsUpdateEvent",
  "SampleCorrelationAnalysisEvent",
  "MeanVarianceUpdateEvent",
  "PCAAnalysisEvent",
  "GeeqEvent",
  "DifferentialExpressionAnalysisEvent",
  "SingleBatchDeterminationEvent",
  "BatchCorrectionEvent",
  "DataAddedEvent",
  "DataReplacedEvent",
]);

/** A curator's (or the agent's) own edits to the annotation. */
const CURATION = new Set([
  "TagAddedEvent",
  "TagRemovedEvent",
  "TagsUpdatedEvent",
  "DesignChangeEvent",
  "ExperimentalDesignUpdatedEvent",
]);

/** 🛑 A `Failed…` event is never grouped — see the header note. */
export function isFailureEvent(e: AuditEvent): boolean {
  return /^Failed/.test(e.event_type || "");
}

export function groupKindOf(e: AuditEvent): GroupKind | null {
  if (isFailureEvent(e)) return null;
  const t = e.event_type || "";
  if (POSTPROCESSING.has(t)) return "postprocessing";
  if (CURATION.has(t)) return "curation";
  return null;
}

export interface AuditGroup {
  kind: GroupKind;
  /** Newest first, matching the panel's order. */
  events: AuditEvent[];
  performer: string;
  /** Oldest and newest timestamps in the run. */
  from: string;
  to: string;
}

export type AuditRow =
  | { type: "event"; event: AuditEvent }
  | { type: "group"; group: AuditGroup };

const GROUP_LABEL: Record<GroupKind, string> = {
  postprocessing: "postprocessing run",
  curation: "curation edit",
};

export function groupLabel(kind: GroupKind): string {
  return GROUP_LABEL[kind];
}

/** Group runs in an already-sorted list.
 *
 *  `rows` must be newest-first, as the panel renders them; the gap is
 *  measured between neighbours either way, so the direction only
 *  decides which end `from` / `to` come from. */
export function groupAuditEvents(rows: AuditEvent[]): AuditRow[] {
  const out: AuditRow[] = [];
  let run: AuditEvent[] = [];
  let runKind: GroupKind | null = null;

  const flush = () => {
    if (run.length === 0) return;
    // A run of one is just an event — wrapping it would add a
    // disclosure triangle around a single line and say nothing.
    if (run.length === 1 || runKind === null) {
      for (const e of run) out.push({ type: "event", event: e });
    } else {
      const dates = run.map((e) => e.date).sort();
      out.push({
        type: "group",
        group: {
          kind: runKind,
          events: run,
          performer: run[0].performer,
          from: dates[0],
          to: dates[dates.length - 1],
        },
      });
    }
    run = [];
    runKind = null;
  };

  for (const e of rows) {
    const kind = groupKindOf(e);
    const prev = run[run.length - 1];
    const near =
      !!prev &&
      Math.abs(Date.parse(e.date || "") - Date.parse(prev.date || "")) <=
        GROUP_GAP_MS;
    // Same family AND same performer AND close in time. A different
    // performer means a different act, however close in time.
    if (
      kind !== null &&
      kind === runKind &&
      near &&
      prev.performer === e.performer
    ) {
      run.push(e);
      continue;
    }
    flush();
    if (kind !== null) {
      run = [e];
      runKind = kind;
    } else {
      out.push({ type: "event", event: e });
    }
  }
  flush();
  return out;
}
