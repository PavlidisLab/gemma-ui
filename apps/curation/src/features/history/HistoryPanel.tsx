import { useState } from "react";
import {
  AUDIT_NOT_IN_GEMMA,
  useAuditEvents,
  type AuditEvent,
} from "@/api/history";
import { experimentAuditTrailUrl } from "@/lib/gemmaUrls";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";

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
export function HistoryPanel({ experimentId }: { experimentId: number | string }) {
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
  // Real Gemma's audit trail (full DWR-only view) lives at the
  // canonical web URL — link out for context the REST surface
  // can't provide. Documented in TODO-gemma-api §13.
  const fullHistoryUrl = experimentAuditTrailUrl(experimentId);

  // Soft-fail sentinel from the hook: this experiment id isn't in
  // gemma-rest. Show a distinct empty state rather than throwing
  // an error banner — the experiment may live in local_api but
  // not yet be loaded into Gemma.
  const notInGemma = events === AUDIT_NOT_IN_GEMMA;
  // Build a per-row delta against the next-older
  // ExperimentalDesignUpdatedEvent. Notes events ("CommentedEvent"
  // etc.) don't carry a body, so we just render their note line.
  const rows: AuditEvent[] = Array.isArray(events) ? events : [];
  const deltaByIndex: ({ label: string; delta: number }[] | null)[] = rows.map(
    (e, i) => {
      if (e.event_type !== "ExperimentalDesignUpdatedEvent" || !e.shape) {
        return null;
      }
      const prev = findPrevDesignEvent(rows, i);
      if (!prev || !prev.shape) return null;
      const out: { label: string; delta: number }[] = [];
      if (e.shape.n_factors !== prev.shape.n_factors)
        out.push({ label: "factors", delta: e.shape.n_factors - prev.shape.n_factors });
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
            title="Server-side dedup of consecutive same-event-type rows."
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
        <a
          href={fullHistoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-700 hover:underline"
          title="See the complete audit trail on Gemma — REST exposes only the most-recent events of each type"
        >
          full trail on Gemma ↗
        </a>
      </div>
      {error ? (
        <div className="px-3 py-4 text-sm text-rose-700">
          couldn't load audit trail: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="px-3 py-6 text-sm text-slate-500">loading audit trail…</div>
      ) : notInGemma ? (
        <div className="px-3 py-6 text-sm text-slate-500">
          This experiment isn't in Gemma's audit log.
          <p className="mt-1 text-[11px] text-slate-400">
            The id is in the curation database but hasn't been loaded
            into Gemma yet — once it lands, events will appear here.
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
          {rows.map((e, i) => (
            <AuditEventRow
              key={e.id}
              event={e}
              shapeDeltas={deltaByIndex[i]}
              forceExpanded={expandAll}
            />
          ))}
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
  return firstLine.length > 140
    ? firstLine.slice(0, 139) + "…"
    : firstLine;
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
  const summary = compactNote(event.note);
  // Does this row have anything worth expanding into? If both the
  // note + detail are missing/boilerplate AND there are no shape
  // deltas, the row is "fully shown" already and we hide the
  // chevron to avoid an empty-expand confusion.
  const hasMore =
    (!!event.note && (event.note !== summary || isBoilerplateNote(event.note))) ||
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
        {/* WHAT + WHY summary on one line */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <EventTypeBadge type={event.event_type} action={event.action} />
          {summary ? (
            <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
              {summary}
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

function EventTypeBadge({ type, action }: { type: string; action: string }) {
  // Subclass name → friendly label + colour. Maps the Gemma audit-
  // event subclasses we currently emit; falls back to the raw
  // prettified class name for any we haven't styled yet.
  //
  // Proposal-event triplet
  // (Proposal{Accepted,Rejected,NeedsChanges}Event) lands here when
  // the curator reviews an agent proposal. Mock-side ``apply_feedback``
  // emits one per terminal review; production Gemma's audit pipeline
  // will fold the same event types in once the agents-side ``write
  // back to Gemma`` path goes live (see PROPOSAL_AUDIT_EVENT_HANDOFF.md).
  const config: { label: string; cls: string } =
    type === "ExperimentalDesignUpdatedEvent"
      ? { label: action === "C" ? "design created" : "design updated", cls: "bg-blue-100 text-blue-800" }
      : type === "CurationNoteUpdateEvent"
        ? { label: "note", cls: "bg-amber-100 text-amber-800" }
        : type === "CommentedEvent"
          ? { label: "comment", cls: "bg-amber-100 text-amber-800" }
          : type === "NeedsAttentionEvent"
            ? { label: "needs attention", cls: "bg-amber-100 text-amber-900" }
            : type === "DoesNotNeedAttentionEvent"
              ? { label: "attention cleared", cls: "bg-slate-100 text-slate-700" }
              : type === "TroubledStatusFlagEvent"
                ? { label: "troubled", cls: "bg-rose-100 text-rose-900" }
                : type === "NotTroubledStatusFlagEvent"
                  ? { label: "trouble cleared", cls: "bg-slate-100 text-slate-700" }
                  : type === "TagsUpdatedEvent"
                    ? { label: "tags updated", cls: "bg-emerald-100 text-emerald-800" }
                    : type === "ProposalAcceptedEvent"
                      ? { label: "proposal accepted", cls: "bg-emerald-100 text-emerald-800" }
                      : type === "ProposalRejectedEvent"
                        ? { label: "proposal rejected", cls: "bg-slate-200 text-slate-800" }
                        : type === "ProposalNeedsChangesEvent"
                          ? { label: "proposal needs changes", cls: "bg-amber-100 text-amber-900" }
                          : { label: prettifyClassName(type), cls: "bg-slate-100 text-slate-700" };
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
const ACRONYM_OVERRIDES = new Map<string, string>([
  ["geeq", "GEEQ"],
]);

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
