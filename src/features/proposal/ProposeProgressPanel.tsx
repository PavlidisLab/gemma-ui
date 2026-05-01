import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import type { ProgressEvent } from "@/api/proposeStream";

/** Minimal shape this panel needs to render. Both
 *  `ProposeStreamState` (curation_proposer) and `AuditStreamState`
 *  (audit pipeline) satisfy this — same SSE envelope so a single
 *  panel renders both. */
export interface ProgressPanelState {
  events: ProgressEvent[];
  progress: number;
  status: "idle" | "running" | "done" | "error";
  error: string | null;
}

/**
 * Renders the live progress bar + log feed for a streaming agent
 * run. Drops into the proposals sidebar slot when used for
 * `+ propose`; reused by the audit trigger flow with the same
 * shape.
 *
 * Log feed is always visible; lines are colour-coded by ``level``
 * (warn → amber, error → rose, debug → slate-400). The latest line
 * auto-scrolls into view so the curator sees current state without
 * scrubbing.
 */
export function ProposeProgressPanel({
  state,
  onDismiss,
  idleLabel = "agent idle",
}: {
  state: ProgressPanelState;
  /** Surfaces a "dismiss" affordance once the run has reached a
   *  terminal state (done / error). Stays hidden while ``running``
   *  so a curator can't accidentally close mid-run. */
  onDismiss?: () => void;
  /** Override the idle-state copy ("agent idle" by default). The
   *  audit flow uses "no audit running" since "agent" is ambiguous
   *  in that context. */
  idleLabel?: string;
}) {
  const tailRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log feed when a new event lands. ``block: nearest``
  // keeps the panel container from scrolling the whole page.
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.events.length]);

  // Idle state — what shows when no run has started (or after
  // dismiss). Replaces the previous "No pending proposals for
  // experiment N." copy with the requested "agent idle" wording.
  if (state.status === "idle") {
    return (
      <div className="card p-3 text-xs text-slate-500 italic">{idleLabel}</div>
    );
  }

  const pct = Math.round(state.progress * 100);
  const isTerminal = state.status === "done" || state.status === "error";

  return (
    <div className="card p-3 space-y-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-700">
          {state.status === "running"
            ? "agent running"
            : state.status === "done"
              ? "agent done"
              : "agent failed"}
        </span>
        <span
          className={cn(
            "font-mono tabular-nums",
            state.status === "error" ? "text-rose-700" : "text-slate-500",
          )}
        >
          {pct}%
        </span>
      </div>
      {/* Progress bar. Width animates so the curator sees motion
          even when phases bunch up. ``transition-all`` on width is
          the cheap way; no Framer dependency. */}
      <div className="h-1.5 w-full bg-slate-100 rounded overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-300",
            state.status === "error" ? "bg-rose-500" : "bg-blue-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Log feed. Capped height so a long run can't push the
          sidebar off-screen; scrolls internally. */}
      <ol className="font-mono text-[11px] space-y-0.5 max-h-48 overflow-y-auto border border-slate-100 rounded p-2 bg-slate-50">
        {state.events.length === 0 ? (
          <li className="italic text-slate-400">opening stream…</li>
        ) : (
          state.events.map((ev, i) => (
            <li
              key={i}
              className={cn(
                ev.level === "warn" && "text-amber-700",
                ev.level === "error" && "text-rose-700",
                ev.level === "debug" && "text-slate-400",
                ev.level === "info" && "text-slate-700",
              )}
              title={`${ev.event} · ${ev.timestamp}`}
            >
              {ev.message}
            </li>
          ))
        )}
        <div ref={tailRef} />
      </ol>
      {state.error ? (
        <div className="text-rose-700 text-[11px]">
          <span className="font-semibold">error:</span> {state.error}
        </div>
      ) : null}
      {isTerminal && onDismiss ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
            onClick={onDismiss}
          >
            dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
