/**
 * Confirmation dialog for the two agent runs a curator can trigger:
 * building a proposal (``/propose``) and running an audit (``/audit``).
 *
 * The run is NOT parameterized from the UI — it uses whatever the
 * running agent is configured with by default. The dialog exists to
 * confirm the action (agent runs cost time + tokens) and to surface the
 * agent-health state before starting. Model tier / scope / comparison
 * toggles were removed 2026-08-03 — those knobs no longer matched how the
 * agent is configured; a later pass can reintroduce whichever ones stay
 * meaningful.
 *
 *   - **mode=fresh** — no standing run.
 *   - **mode=redo**  — a standing proposal/audit exists; the submit label
 *                      reads "Re-run …".
 *
 * Submit is disabled when the agent service is unreachable; the dialog
 * explains why so the curator doesn't think the button is broken.
 */

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import type { ServiceStatus } from "@/api/health";

export type AgentRunKind = "proposal" | "audit";
export type AgentRunMode = "fresh" | "redo";

export interface AgentRunRequest {
  kind: AgentRunKind;
  mode: AgentRunMode;
}

interface Props {
  open: boolean;
  kind: AgentRunKind;
  mode: AgentRunMode;
  experimentShortName: string;
  /** Liveness of the agent service. Submit disables when "down". */
  agentStatus: ServiceStatus;
  /** True while the request is in flight. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (req: AgentRunRequest) => void;
}

export function AgentRunDialog({
  open,
  kind,
  mode,
  experimentShortName,
  agentStatus,
  busy,
  onCancel,
  onSubmit,
}: Props) {
  // Esc closes when not busy. Don't yank the dialog out from under the
  // curator mid-submit.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const agentDown = agentStatus === "down";
  const isAudit = kind === "audit";
  const submittable = !busy && !agentDown;

  const title = isAudit
    ? mode === "redo"
      ? "Re-run audit"
      : "Run audit"
    : mode === "redo"
      ? "Re-run proposer"
      : "Propose annotations";

  const submitLabel = busy
    ? "starting…"
    : mode === "redo"
      ? isAudit
        ? "Re-run audit"
        : "Re-run proposer"
      : isAudit
        ? "Run audit"
        : "Propose";

  const subtitle = isAudit
    ? mode === "redo"
      ? "Replaces the open audit on this experiment. Runs with the agent's default configuration; progress appears in the sidebar."
      : "Runs the auditor against the current curation with the agent's default configuration. Findings land in the sidebar; the report is also in the inbox."
    : mode === "redo"
      ? "Retires the standing proposal and starts a fresh proposer run with the agent's default configuration."
      : "Runs the proposer to generate annotations for this experiment, with the agent's default configuration. The proposal lands in the Proposal-review sidebar.";

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-slate-300 dark:border-slate-600 w-full max-w-md p-4 space-y-3 dark:bg-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}{" "}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {experimentShortName}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {subtitle}
          </p>
        </div>

        {agentDown ? (
          <div className="rounded border border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-700 p-2 text-xs">
            <strong>Agent service unreachable.</strong>{" "}
            {isAudit
              ? "Audit runs need the proposer/auditor FastAPI to be up."
              : "Proposal runs need the proposer FastAPI to be up."}{" "}
            Bring it up, then re-open this dialog.
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 rounded text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!submittable}
            onClick={() => onSubmit({ kind, mode })}
            className={cn(
              "text-xs px-3 py-1 rounded font-medium",
              submittable
                ? "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500",
            )}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
