import { useAuditEvents, type AuditEvent } from "@/api/history";
import { experimentAuditTrailUrl } from "@/lib/gemmaUrls";

/**
 * Audit-trail timeline for the experiment. Renders Gemma's
 * `AuditEventValueObject` shape directly: performer, date, action,
 * event type, note, detail. Where the mock supplies a shape
 * summary, we additionally render shape deltas vs the previous
 * `ExperimentalDesignUpdatedEvent` to give "did factors / FVs /
 * tags change?" at a glance.
 */
export function HistoryPanel({ experimentId }: { experimentId: number }) {
  const { data: events, isLoading, error } = useAuditEvents(experimentId);
  // Real Gemma's audit trail (full DWR-only view) lives at the
  // canonical web URL — link out for context the REST surface
  // can't provide. Documented in TODO-gemma-api §13.
  const fullHistoryUrl = experimentAuditTrailUrl(experimentId);

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading audit trail…</div>
    );
  }
  if (error) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load audit trail: {(error as Error).message}
      </div>
    );
  }
  if (!events || events.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        No audit events recorded for this experiment yet.
        <p className="mt-1 text-[11px] text-slate-400">
          Design commits and curator notes append events here.
        </p>
        <p className="mt-2 text-[11px]">
          <a
            href={fullHistoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
          >
            Full audit trail on Gemma ↗
          </a>
        </p>
      </div>
    );
  }

  // Build a per-row delta against the next-older
  // ExperimentalDesignUpdatedEvent. Notes events ("CommentedEvent"
  // etc.) don't carry a body, so we just render their note line.
  const deltaByIndex: ({ label: string; delta: number }[] | null)[] = events.map(
    (e, i) => {
      if (e.event_type !== "ExperimentalDesignUpdatedEvent" || !e.shape) {
        return null;
      }
      const prev = findPrevDesignEvent(events, i);
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
          {events.length} event{events.length === 1 ? "" : "s"} · newest first
        </span>
        {/*
          We surface only the events Gemma's REST API exposes (the
          three "last X" pointers from CurationDetails plus what
          the curator does in this UI). The full per-experiment
          history lives behind DWR — link out so the curator can
          see the complete trail when they need to.
        */}
        <a
          href={fullHistoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-700 hover:underline ml-auto"
          title="See the complete audit trail on Gemma — REST exposes only the most-recent events of each type"
        >
          full trail on Gemma ↗
        </a>
      </div>
      <ol className="divide-y divide-slate-100">
        {events.map((e, i) => (
          <AuditEventRow
            key={e.id}
            event={e}
            shapeDeltas={deltaByIndex[i]}
          />
        ))}
      </ol>
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

function AuditEventRow({
  event,
  shapeDeltas,
}: {
  event: AuditEvent;
  shapeDeltas: { label: string; delta: number }[] | null;
}) {
  return (
    <li className="px-3 py-2 flex items-start gap-3">
      <div className="text-xs text-slate-500 tabular-nums w-44 shrink-0">
        {formatTimestamp(event.date)}
      </div>
      <div className="text-xs text-slate-700 w-32 shrink-0 truncate">
        {event.performer ? (
          <span className="font-medium">{event.performer}</span>
        ) : (
          <span className="italic text-slate-400">(anonymous)</span>
        )}
      </div>
      <div className="text-xs flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <EventTypeBadge type={event.event_type} action={event.action} />
          {event.note ? (
            <span className="text-slate-700">{event.note}</span>
          ) : (
            <span className="italic text-slate-400">(no note)</span>
          )}
        </div>
        {shapeDeltas && shapeDeltas.length > 0 ? (
          <div className="mt-0.5 text-[11px]">
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
          <div className="mt-0.5 text-[11px] text-slate-500 whitespace-pre-wrap">
            {event.detail}
          </div>
        ) : null}
      </div>
      <div className="text-[10px] text-slate-400 font-mono shrink-0">
        #{event.id}
      </div>
    </li>
  );
}

function EventTypeBadge({ type, action }: { type: string; action: string }) {
  // Subclass name → friendly label + colour. Maps the Gemma audit-
  // event subclasses we currently emit; falls back to the raw
  // prettified class name for any we haven't styled yet.
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

function prettifyClassName(s: string): string {
  // "BatchCorrectionEvent" → "batch correction"
  return s
    .replace(/Event$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
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
