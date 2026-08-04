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
import { useAgentConfig, type AgentConfig } from "@/api/agentConfig";

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

  // The run isn't parameterized from the UI — instead the dialog
  // ANNOUNCES the agent's resolved config (models + options) so the
  // curator confirms the right setup before firing. Null until the
  // agent exposes GET /config; the block just omits itself.
  const { data: agentConfig } = useAgentConfig();

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

        <AgentSettingsBlock config={agentConfig ?? null} />

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

/** Format an option value for display: booleans as on/off, arrays as a
 *  comma list, everything else stringified. */
function formatConfigValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v == null) return "—";
  return String(v);
}

/** Read-only "what the agent will run with" block: per-stage models +
 *  default options. Renders whatever the agent's ``GET /config`` reports
 *  (keys become labels), so a new model stage or switch surfaces without
 *  a UI change. Omits itself entirely when no config is available. */
function AgentSettingsBlock({
  config,
}: {
  config: AgentConfig | null;
}): JSX.Element | null {
  if (!config) return null;
  const models = config.models
    ? Object.entries(config.models).filter(([, v]) => !!v)
    : [];
  const options = config.options
    ? Object.entries(config.options).filter(([, v]) => v != null)
    : [];
  if (models.length === 0 && options.length === 0 && !config.agent_version) {
    return null;
  }
  return (
    <div className="rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 p-2 text-xs space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
          Agent settings
        </span>
        {config.agent_version ? (
          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">
            {config.agent_version}
          </span>
        ) : null}
      </div>
      {models.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
            Models
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            {models.map(([stage, model]) => (
              <div key={stage} className="contents">
                <dt className="text-slate-500 dark:text-slate-400">{stage}</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-200 truncate">
                  {model}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {options.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
            Options
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            {options.map(([key, val]) => (
              <div key={key} className="contents">
                <dt className="text-slate-500 dark:text-slate-400">{key}</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {formatConfigValue(val)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
