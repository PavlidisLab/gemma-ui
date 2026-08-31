import { useState } from "react";
import {
  AUDIT_NOT_IN_GEMMA,
  useAuditEvents,
  type AuditEvent,
} from "@/api/history";
import { useGemmaMode } from "@/lib/gemmaMode";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupAuditEvents, groupLabel, type AuditGroup } from "./auditGroups";

/**
 * Audit-trail timeline for the experiment. Reads the live
 * gemma-rest audit trail (proxied via the vite routing exception
 * for `/rest/v2/datasets/{id}/auditEvents`). Renders the
 * `AuditEventValueObject` shape directly: performer, date, action,
 * event type, note, detail. Where the source supplies a shape
 * summary, we additionally render shape deltas vs the previous
 * `ExperimentalDesignUpdatedEvent` to give "did factors / FVs /
 * tags change?" at a glance.
 *
 * Two toggles drive server-side filtering:
 *   - "compact" — dedup consecutive same-type rows
 *   - "exclude empty" — drop the boilerplate U events that have
 *     empty event_type + null detail
 */
export function HistoryPanel({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { mode } = useGemmaMode();
  const [compact, setCompact] = useState(false);
  const [excludeEmpty, setExcludeEmpty] = useState(true);
  // Panel-level "expand all" — when true, every row renders with
  // full note + detail. When false (default), rows are compact and
  // expand individually on click. Distinct from `compact` above
  // which is a server-side dedup filter.
  const [expandAll, setExpandAll] = useState(false);
  const {
    data: events,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useAuditEvents(experimentId, { compact, excludeEmpty });
  // Soft-fail sentinel from the hook: this experiment id isn't in
  // gemma-rest. Show a distinct empty state rather than throwing
  // an error banner — the experiment may live in local_api but
  // not yet be loaded into Gemma.
  const notInGemma = events === AUDIT_NOT_IN_GEMMA;
  // Build a per-row delta against the next-older
  // ExperimentalDesignUpdatedEvent. Notes events ("CommentedEvent"
  // etc.) don't carry a body, so we just render their note line.
  const raw: AuditEvent[] = Array.isArray(events) ? events : [];
  // 🛑 **Gemma returns the trail OLDEST first** — measured on 27103
  // 2026-08-31, first row 2023-01-31, last 2026-08-30 — while this
  // panel's header has always said "newest first". The header was
  // right about what a curator wants and wrong about what it was
  // showing, so the rows are sorted here rather than the label
  // softened. Copy first: the query cache's array is not ours to
  // reverse in place.
  const ordered = [...raw].sort(
    (a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""),
  );
  // "Hide plain updates" — the boilerplate `U event on entity ubic.…`
  // rows Gemma writes beside every real one. 49 of 84 rows on 27103.
  //
  // 🛑 The server flag does NOT do this. `excludeEmpty=true` is a real
  // parameter (it is in the OpenAPI spec) and it changed nothing:
  // 85 rows before, 85 after, measured on eid 861. These rows are not
  // empty — they carry a machine-generated note — so "empty" never
  // matched them. `isBoilerplateNote` is the test that does, and the
  // panel already used it for DISPLAY; this is the same rule applied
  // to the filter the checkbox promises.
  const rows: AuditEvent[] = excludeEmpty
    ? ordered.filter(
        (e) =>
          // 🛑 The CREATE event is always listed, boilerplate note or
          // not: it is when this experiment entered Gemma and who put
          // it there, and there is exactly one of it. "Hide plain
          // updates" says updates — dropping the origin of the record
          // along with them leaves a trail that starts in the middle.
          e.action === "C" ||
          !!e.event_type ||
          !isBoilerplateNote(e.note ?? ""),
      )
    : ordered;
  const deltaByIndex: ({ label: string; delta: number }[] | null)[] = rows.map(
    (e, i) => {
      if (e.event_type !== "ExperimentalDesignUpdatedEvent" || !e.shape) {
        return null;
      }
      const prev = findPrevDesignEvent(rows, i);
      if (!prev || !prev.shape) return null;
      const out: { label: string; delta: number }[] = [];
      if (e.shape.n_factors !== prev.shape.n_factors)
        out.push({
          label: "factors",
          delta: e.shape.n_factors - prev.shape.n_factors,
        });
      if (e.shape.n_fvs !== prev.shape.n_fvs)
        out.push({ label: "FVs", delta: e.shape.n_fvs - prev.shape.n_fvs });
      if (e.shape.n_tags !== prev.shape.n_tags)
        out.push({ label: "tags", delta: e.shape.n_tags - prev.shape.n_tags });
      return out;
    },
  );

  return (
    <div className="card">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <span className="section-h">Audit trail</span>
        <span className="text-xs text-slate-400">
          {isLoading
            ? "loading…"
            : `${rows.length} event${rows.length === 1 ? "" : "s"} · newest first`}
        </span>
        {mode === "local" ? (
          <span
            className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title="Local mode: only curation-side events (proposals, audit dispositions, design commits) are shown. The full Gemma audit history requires a real Gemma backend."
          >
            local · curation events only
          </span>
        ) : null}
        <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer select-none ml-2">
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => setCompact(e.target.checked)}
            className="cursor-pointer"
          />
          compact
          <span
            className="text-slate-400"
            // 🛑 It is NOT a dedup, and calling it one is what let it
            // ship as a harmless-sounding default. Measured on 27103:
            // the folded events carry DIFFERENT notes, and only the
            // run's first survives — 61 rows for 84 messages.
            title="Folds runs of same-type events into one row. ⚠ Lossy: only the FIRST message of each run is kept, so messages differing from it are not shown. Folded rows are marked."
          >
            ⓘ
          </span>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeEmpty}
            onChange={(e) => setExcludeEmpty(e.target.checked)}
            className="cursor-pointer"
          />
          hide plain updates
          <span
            className="text-slate-400"
            title="Drop boilerplate U events with no event_type or detail."
          >
            ⓘ
          </span>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={expandAll}
            onChange={(e) => setExpandAll(e.target.checked)}
            className="cursor-pointer"
          />
          expand all
          <span
            className="text-slate-400"
            title="Render every row with its full note and detail. Off = compact rows that expand individually on click."
          >
            ⓘ
          </span>
        </label>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Re-fetch the audit trail from the server"
          aria-label="refresh audit trail"
        >
          <RefreshCw
            size={12}
            className={cn(isFetching && "animate-spin")}
            strokeWidth={2.25}
          />
          refresh
        </button>
      </div>
      {error ? (
        <div className="px-3 py-4 text-sm text-rose-700">
          couldn't load audit trail: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="px-3 py-6 text-sm text-slate-500">
          loading audit trail…
        </div>
      ) : notInGemma ? (
        <div className="px-3 py-6 text-sm text-slate-500">
          This experiment isn't in Gemma's audit log.
          <p className="mt-1 text-[11px] text-slate-400">
            The id is in the curation database but hasn't been loaded into Gemma
            yet — once it lands, events will appear here.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-6 text-sm text-slate-500">
          {excludeEmpty || compact
            ? "No events match the active filters."
            : "No audit events recorded for this experiment yet."}
        </div>
      ) : (
        <ol className="divide-y divide-slate-100">
          {groupAuditEvents(rows).map((r) =>
            r.type === "group" ? (
              <AuditGroupRow
                key={`g-${r.group.events[0].id}`}
                group={r.group}
                deltaFor={(e) => deltaByIndex[rows.indexOf(e)] ?? null}
                forceExpanded={expandAll}
              />
            ) : (
              <AuditEventRow
                key={r.event.id}
                event={r.event}
                shapeDeltas={deltaByIndex[rows.indexOf(r.event)] ?? null}
                forceExpanded={expandAll}
              />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

function findPrevDesignEvent(
  events: AuditEvent[],
  fromIndex: number,
): AuditEvent | null {
  for (let i = fromIndex + 1; i < events.length; i++) {
    if (events[i].event_type === "ExperimentalDesignUpdatedEvent") {
      return events[i];
    }
  }
  return null;
}

/** Notes from gemma-rest that are pure Java-introspection boilerplate
 *  carrying no human-readable WHY ("C event on entity ubic.gemma…").
 *  Hide in compact mode; show dimmed in expanded. */
function isBoilerplateNote(note: string): boolean {
  return /^[UCD] event on entity ubic\./.test(note.trim());
}

/** Trim the note to a one-liner for compact mode. Boilerplate
 *  introspection notes return "" so the compact row shows just
 *  the event-type badge. */
function compactNote(note: string): string {
  if (!note) return "";
  if (isBoilerplateNote(note)) return "";
  // Take the first line + cap at ~140 chars so the row stays a
  // single line even on a 13" laptop.
  const firstLine = note.split(/\r?\n/)[0].trim();
  return firstLine.length > 140 ? firstLine.slice(0, 139) + "…" : firstLine;
}

/** One line for a run of events that happened together — a
 *  postprocessing pass, a curation commit. Collapsed it names the run
 *  and its steps; expanded it renders the real rows, unchanged.
 *
 *  🛑 Nothing is discarded, so this row must always be openable —
 *  unlike the server's `compact`, which is where the messages actually
 *  go missing. */
function AuditGroupRow({
  group,
  deltaFor,
  forceExpanded,
}: {
  group: AuditGroup;
  deltaFor: (e: AuditEvent) => { label: string; delta: number }[] | null;
  forceExpanded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = forceExpanded || open;
  // Name the steps in the order they ran (oldest first), which is how
  // a curator thinks about a pipeline, even though the rows are newest
  // first.
  const steps = [...group.events]
    .reverse()
    .map((e) => prettifyClassName(e.event_type).toLowerCase());
  const sameMinute = formatTimestamp(group.from) === formatTimestamp(group.to);
  return (
    <li className="bg-slate-50/60 dark:bg-slate-800/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center gap-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer"
        aria-expanded={expanded}
      >
        <span className="w-3 text-slate-400 shrink-0">
          {expanded ? (
            <ChevronDown size={12} strokeWidth={2.25} />
          ) : (
            <ChevronRight size={12} strokeWidth={2.25} />
          )}
        </span>
        <div
          className="text-xs text-slate-500 tabular-nums w-40 shrink-0"
          title={
            sameMinute
              ? undefined
              : `${formatTimestamp(group.from)} → ${formatTimestamp(group.to)}`
          }
        >
          {formatTimestamp(group.to)}
        </div>
        <div className="text-xs w-24 shrink-0 truncate">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {group.performer}
          </span>
        </div>
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <div className="w-56 shrink-0 leading-tight">
            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
              {groupLabel(group.kind)}
            </span>
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400 truncate flex-1 min-w-0">
            {group.events.length} steps · {steps.join(", ")}
          </span>
        </div>
      </button>
      {expanded ? (
        <ol className="divide-y divide-slate-100 dark:divide-slate-800 border-l-2 border-indigo-300 dark:border-indigo-700 ml-6">
          {group.events.map((e) => (
            <AuditEventRow
              key={e.id}
              event={e}
              shapeDeltas={deltaFor(e)}
              forceExpanded={forceExpanded}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function AuditEventRow({
  event,
  shapeDeltas,
  forceExpanded,
}: {
  event: AuditEvent;
  shapeDeltas: { label: string; delta: number }[] | null;
  /** When true, the row renders with full note + detail regardless
   *  of the per-row click state. Driven by the panel's "expand all"
   *  toggle. */
  forceExpanded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = forceExpanded || open;

  // Compact summary — what shows on the single-line row even when
  // collapsed. Empty for boilerplate U/C/D events (the badge alone
  // carries the meaning).
  const summary =
    compactNote(event.note) ||
    // A boilerplate row still gets a collapsed line — the badge alone
    // left a stripe of date and username with nothing said on it. Only
    // the create row earns a sentence: it is the one whose meaning is
    // not already in its badge.
    (event.action === "C" && !event.event_type
      ? "Experiment record created in Gemma"
      : "");
  // Does this row have anything worth expanding into? If both the
  // note + detail are missing/boilerplate AND there are no shape
  // deltas, the row is "fully shown" already and we hide the
  // chevron to avoid an empty-expand confusion.
  const hasMore =
    (!!event.note &&
      (event.note !== summary || isBoilerplateNote(event.note))) ||
    !!event.detail ||
    (shapeDeltas && shapeDeltas.length > 0);

  return (
    <li>
      <button
        type="button"
        onClick={() => (hasMore ? setOpen((v) => !v) : undefined)}
        className={cn(
          "w-full px-3 py-1.5 flex items-center gap-3 text-left",
          hasMore
            ? "hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
            : "cursor-default",
        )}
        aria-expanded={expanded}
      >
        {/* Chevron — placeholder span when nothing to expand so the
            grid stays aligned across rows. */}
        <span className="w-3 text-slate-400 shrink-0">
          {hasMore ? (
            expanded ? (
              <ChevronDown size={12} strokeWidth={2.25} />
            ) : (
              <ChevronRight size={12} strokeWidth={2.25} />
            )
          ) : null}
        </span>
        {/* WHEN */}
        <div className="text-xs text-slate-500 tabular-nums w-40 shrink-0">
          {formatTimestamp(event.date)}
        </div>
        {/* WHO */}
        <div className="text-xs w-24 shrink-0 truncate">
          {event.performer ? (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {event.performer}
            </span>
          ) : (
            <span className="italic text-slate-400">—</span>
          )}
        </div>
        {/* WHAT + WHY summary on one line.
            The badge sits in a FIXED-WIDTH column so every summary
            starts at the same x. Sized by content it made the notes
            jag across the panel — "GEEQ" and "FAILED PROCESSED VECTOR
            COMPUTATION" are both badges, and the text after them
            landed 300px apart. Long labels wrap inside the column
            rather than widening it. */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <div className="w-56 shrink-0 leading-tight">
            <EventTypeBadge
              type={event.event_type}
              action={event.action}
              note={event.note}
            />
          </div>
          {summary ? (
            <span className="text-xs text-slate-600 dark:text-slate-400 truncate flex-1 min-w-0">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {/* 🛑 `compact=true` DROPS CONTENT — it does not merge repeats.
              Corrected by gembro 2026-08-31 after measuring 27103: all
              14 multi-event runs fold events carrying DIFFERENT notes,
              the run's FIRST message is kept and the other 23 are
              discarded. So 61 rows stand for 84 distinct messages and
              a curator is not seeing 23 things that happened.

              Hence amber, not a neutral count chip, and wording that
              says messages are MISSING rather than repeated. A tally
              reading "×4" beside one line, with nothing saying the
              other three said something else, is the failure this
              badge exists to prevent. */}
          {event.collapsed_count && event.collapsed_count > 1 ? (
            <span
              className="text-[10px] tabular-nums px-1 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 shrink-0"
              title={`${event.collapsed_count} events folded into this row by "compact", and only this one's message is shown — the other ${event.collapsed_count - 1} said something different and are not displayed.${
                event.last_occurrence
                  ? ` Last of the run: ${formatTimestamp(event.last_occurrence)}.`
                  : ""
              } Uncheck "compact" to read them.`}
            >
              +{event.collapsed_count - 1} hidden
            </span>
          ) : null}
        </div>
      </button>
      {/* Expanded panel — full note, detail, shape deltas. */}
      {expanded ? (
        <div className="px-3 pb-2 pl-[5.25rem] text-[11px] space-y-1">
          {event.note ? (
            <div
              className={cn(
                "whitespace-pre-wrap",
                isBoilerplateNote(event.note)
                  ? "text-slate-400 dark:text-slate-500 font-mono"
                  : "text-slate-700 dark:text-slate-300",
              )}
            >
              {event.note}
            </div>
          ) : null}
          {shapeDeltas && shapeDeltas.length > 0 ? (
            <div>
              {shapeDeltas.map((d, i) => (
                <span
                  key={d.label}
                  className={
                    d.delta > 0
                      ? "text-emerald-700"
                      : d.delta < 0
                        ? "text-rose-700"
                        : "text-slate-500"
                  }
                >
                  {i > 0 ? " · " : ""}
                  {d.delta > 0 ? "+" : ""}
                  {d.delta} {d.label}
                </span>
              ))}
            </div>
          ) : null}
          {event.detail ? (
            <div className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap font-mono">
              {event.detail}
            </div>
          ) : null}
          <div className="text-[10px] text-slate-400 font-mono">
            #{event.id}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function EventTypeBadge({
  type,
  action,
  note,
}: {
  type: string;
  action: string;
  note: string;
}) {
  // Subclass name → friendly label + colour. Maps the Gemma audit-
  // event subclasses we currently emit; falls back to the raw
  // prettified class name for any we haven't styled yet.
  //
  // Proposal-event triplet
  // (Proposal{Accepted,Rejected,NeedsChanges}Event) lands here when
  // the curator reviews an agent proposal. Mock-side ``apply_feedback``
  // emits one per terminal review; production Gemma's audit pipeline
  // will fold the same event types in once the agents-side ``write
  // back to Gemma`` path goes live.
  const config: { label: string; cls: string } =
    type === "ExperimentalDesignUpdatedEvent"
      ? {
          label: action === "C" ? "design created" : "design updated",
          cls: "bg-blue-100 text-blue-800",
        }
      : type === "CurationNoteUpdateEvent"
        ? { label: "note", cls: "bg-amber-100 text-amber-800" }
        : type === "CommentedEvent"
          ? { label: "comment", cls: "bg-amber-100 text-amber-800" }
          : type === "NeedsAttentionEvent"
            ? { label: "needs attention", cls: "bg-amber-100 text-amber-900" }
            : type === "DoesNotNeedAttentionEvent"
              ? {
                  label: "attention cleared",
                  cls: "bg-slate-100 text-slate-700",
                }
              : type === "TroubledStatusFlagEvent"
                ? { label: "troubled", cls: "bg-rose-100 text-rose-900" }
                : type === "NotTroubledStatusFlagEvent"
                  ? {
                      label: "trouble cleared",
                      cls: "bg-slate-100 text-slate-700",
                    }
                  : type === "TagsUpdatedEvent"
                    ? {
                        label: "tags updated",
                        cls: "bg-emerald-100 text-emerald-800",
                      }
                    : type === "ProposalAcceptedEvent"
                      ? {
                          label: "proposal accepted",
                          cls: "bg-emerald-100 text-emerald-800",
                        }
                      : type === "ProposalRejectedEvent"
                        ? {
                            label: "proposal rejected",
                            cls: "bg-slate-200 text-slate-800",
                          }
                        : type === "ProposalNeedsChangesEvent"
                          ? {
                              label: "proposal needs changes",
                              cls: "bg-amber-100 text-amber-900",
                            }
                          : type
                            ? {
                                label: prettifyClassName(type),
                                cls: "bg-slate-100 text-slate-700",
                              }
                            : // Untyped — Gemma writes plain C/U/D rows
                              // with no event class. `prettifyClassName("")`
                              // is "", which rendered an EMPTY badge and a
                              // row showing only a date and a name. The
                              // action code is the one thing such a row
                              // does say, so it says it.
                              action === "C"
                              ? {
                                  label: "created",
                                  cls: "bg-emerald-100 text-emerald-800",
                                }
                              : action === "D"
                                ? // Named from the NOTE, never from the
                                  // action code — see `describeRemoval`.
                                  {
                                    label:
                                      describeRemoval(note) ?? "child removed",
                                    cls: "bg-slate-100 text-slate-600",
                                  }
                                : {
                                    label: "updated",
                                    cls: "bg-slate-100 text-slate-600",
                                  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${config.cls}`}
      title={type}
    >
      {config.label}
    </span>
  );
}

/** Words that should render uppercase in audit event labels even
 *  though the source class name has them in mixed case. Pascal-
 *  cased acronyms like `Geeq` aren't caught by the all-caps
 *  preservation rule below, so they're listed here explicitly. */
const ACRONYM_OVERRIDES = new Map<string, string>([["geeq", "GEEQ"]]);

/** Class-name → readable label. Handles ALLCAPS acronym runs
 *  (PCA, GEO, etc.) so they don't get smushed into the lowercase
 *  pass; lifts mixed-case acronyms (GEEQ) via ACRONYM_OVERRIDES;
 *  capitalizes the first character of the final label.
 *
 *  Examples (real names from gemma-rest):
 *    BatchCorrectionEvent                  → "Batch correction"
 *    DifferentialExpressionAnalysisEvent   → "Differential expression analysis"
 *    PCAAnalysisEvent                      → "PCA analysis"
 *    ExpressionExperimentUpdateFromGEOEvent → "Expression experiment update from GEO"
 *    GeeqEvent                             → "GEEQ"
 *    SingleBatchDeterminationEvent         → "Single batch determination"
 *    FailedDifferentialExpressionAnalysisEvent
 *                                          → "Failed differential expression analysis"
 */
function prettifyClassName(s: string): string {
  if (!s) return "";
  // Drop redundant subject prefixes — the curator is already
  // looking at an ExpressionExperiment, so a class name like
  // ``ExpressionExperimentUpdateFromGEOEvent`` should read as
  // just "Update from GEO." If new subject types ever enter the
  // trail (e.g. ArrayDesign-scoped events), add their prefixes
  // here too.
  const trimmed = s.replace(/^ExpressionExperiment/, "");
  // Step 1: insert a space BEFORE the start of a Pascal word that
  //         follows an ALLCAPS run — "PCAAnalysis" → "PCA Analysis".
  // Step 2: insert a space between a lowercase/digit and the next
  //         uppercase — "BatchCorrection" → "Batch Correction".
  const spaced = trimmed
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    // Drop the trailing " Event" — every audit class ends in it.
    .replace(/\s+Event$/, "");
  // Lowercase each token EXCEPT acronyms (all-caps runs of ≥2)
  // and overrides; then capitalize the first character of the
  // resulting label.
  const tokens = spaced.split(" ").map((w) => {
    if (/^[A-Z]{2,}$/.test(w)) return w; // ALLCAPS run (PCA, GEO)
    const override = ACRONYM_OVERRIDES.get(w.toLowerCase());
    if (override) return override;
    return w.toLowerCase();
  });
  if (tokens.length === 0) return "";
  // Capitalize the first letter of the first token UNLESS that
  // token is already all-uppercase (an acronym shouldn't be
  // re-cased).
  const first = tokens[0];
  if (first && !/^[A-Z]+$/.test(first)) {
    tokens[0] = first.charAt(0).toUpperCase() + first.slice(1);
  }
  return tokens.join(" ");
}

/** What a `D` row actually removed, read from the note.
 *
 *  🛑 **A visible `D` row is never a deleted experiment.** Measured by
 *  gembro across all 90,896 `ACTION='D'` rows on prod, 2026-08-31:
 *  90,894 record removal of a CHILD — a PCA, a set of vectors — and
 *  the 2 real entity removals have no visible trail, because a deleted
 *  experiment's events cascade away with it. So `DELETED` is wrong on
 *  every row a curator can see, and it reads as alarming: Paul, on two
 *  such rows, *"I think that event got added even though the delete
 *  failed"* — nothing failed, an old PCA was dropped so a fresh one
 *  could be computed.
 *
 *  The originating DAO method is in the note (`… via void
 *  ubic.gemma.persistence.service.analysis.expression.pca.
 *  PrincipalComponentAnalysisDao.removeForExperiment(…) on …`), so the
 *  row can say what happened. Counts below are gembro's, for weighting
 *  — `removeForExperiment` alone is 60,832 of them.
 *
 *  ⚠️ Do NOT key on the duplicate rows beside these. Every pair is one
 *  delete written twice by 1.x's `AuditAdvice`; a cleanup drops the
 *  copies, after which there is one row per removal. */
function describeRemoval(note: string): string | null {
  const m =
    /\bvia\s+\S+\s+[\w.]*?([A-Z][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)\s*\(/.exec(
      note,
    );
  if (!m) return null;
  const [, cls, method] = m;
  if (
    method === "removeForExperiment" &&
    /PrincipalComponentAnalysis/.test(cls)
  )
    return "PCA removed";
  if (method === "removeProcessedDataVectors")
    return "processed vectors removed";
  if (method === "removeAllRawDataVectors" || method === "removeRawDataVectors")
    return "raw vectors removed";
  if (method === "removeSingleCellDataVectors")
    return "single-cell vectors removed";
  if (method === "deleteSingleCellDimension")
    return "single-cell dimension removed";
  // A genuine entity removal. Kept for completeness; by construction
  // its trail is gone, so this branch should never render.
  if (cls === "BaseDao" && method === "remove") return "record removed";
  return null;
}

/** Pack fully-qualified Java package names down to their initials, the
 *  way a log viewer does: `ubic.gemma.model.expression.experiment.
 *  ExpressionExperiment` → `u.g.m.e.e.ExpressionExperiment`.
 *
 *  Gemma's boilerplate notes are mostly package path. The one line a
 *  curator might actually read out of
 *
 *    C event on entity ubic.gemma.model.expression.experiment.
 *    ExpressionExperiment:null [ExpressionExperiment Name=… ] by mrafi
 *    via Object ubic.gemma.persistence.service.BaseDao.create(Object)
 *
 *  is the experiment name and who did it, and both are buried behind
 *  60 characters of namespace.
 *
 *  🛑 The CLASS name is kept whole — it is the part that carries
 *  meaning, and `u.g.m.e.e.E` would be unreadable. Only the lowercase
 *  package segments before it are reduced to initials, so a
 *  method-bearing tail (`BaseDao.create(Object)`) survives intact.
 *
 *  A RENDER transform: the stored note is untouched, and the full text
 *  is one hover away. */
export function packPackageNames(text: string): string {
  if (!text) return "";
  // Two or more lowercase package segments followed by an
  // uppercase-initial class name. Requiring ≥2 keeps ordinary prose
  // with a dot in it (`e.g. something`) from being rewritten.
  return text.replace(
    // A segment may be camelCase — Gemma ships
    // `ubic.gemma.model.common.auditAndSecurity.AuditEvent`, and a
    // lowercase-only segment pattern silently skips the whole FQN.
    /\b((?:[a-z][A-Za-z0-9_]*\.){2,})([A-Z][A-Za-z0-9_]*)/g,
    (_m, pkg: string, cls: string) =>
      pkg
        .split(".")
        .filter(Boolean)
        .map((seg) => seg.charAt(0))
        .join(".") +
      "." +
      cls,
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
