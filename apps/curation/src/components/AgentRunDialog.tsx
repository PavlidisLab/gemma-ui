/**
 * Unified confirmation + settings dialog for the two agent runs
 * curators can trigger: building a fresh proposal (``/propose``) and
 * running an audit (``/audit``). Same shell, different fields:
 *
 *   - **kind=proposal** — model tier + optional notes.
 *   - **kind=audit**    — model tier + scope checkboxes + comparison-
 *                         proposer toggle + optional notes.
 *
 *   - **mode=fresh** — no standing run; notes field is hidden.
 *   - **mode=redo**  — a standing proposal/audit exists; notes field
 *                      shows up front (this is where the curator
 *                      tells the agent what to fix). Submit button
 *                      reads "Re-run …" instead of "Run …".
 *
 * The dialog is the canonical entry point for both kinds — the
 * earlier inline "+ propose" sidebar button and the in-panel
 * "+ audit" button both route through here so the curator always
 * sees a confirmation + the agent health state before a run starts.
 *
 * Submit is disabled when the agent service is reachable=false; the
 * dialog explains why so the curator doesn't think the button is
 * broken.
 *
 * "use cache" and the standalone "refresh cache" toggle were dropped
 * 2026-05-23: redo mode always forces a fresh agent pass (so the
 * curator's notes / config tweaks actually shape the run), fresh
 * mode lets the agent decide cache strategy. Knob was load-bearing
 * during the early prototype + demo phase; not anymore.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { AuditScopeItem } from "@/api/auditTypes";
import type { ServiceStatus } from "@/api/health";
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  MODEL_TIER_ORDER,
  type ModelTier,
} from "@/lib/modelTiers";

export type AgentRunKind = "proposal" | "audit";
export type AgentRunMode = "fresh" | "redo";

export interface AgentRunRequest {
  kind: AgentRunKind;
  mode: AgentRunMode;
  tier: ModelTier;
  /** Trimmed; empty string when the curator left the notes field
   *  blank. The caller treats empty as "no override". */
  priorFeedback: string;
  /** Audit-only — undefined for proposal runs. Always non-empty
   *  when set (the dialog blocks submit on empty scope). */
  scope?: AuditScopeItem[];
  /** Audit-only — undefined for proposal runs. */
  withComparison?: boolean;
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
  /** Audit-only signal: the experiment has no curator-attached
   *  tags and no factors. Running an audit on this state produces
   *  noise — the auditor treats every agent proposal as
   *  `calibration_factor_extra` against an empty gold. The dialog
   *  surfaces an amber warning + an acknowledgement checkbox that
   *  must be ticked before submit enables. Ignored for proposal
   *  kind. */
  curationEmpty?: boolean;
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
  curationEmpty,
  onCancel,
  onSubmit,
}: Props) {
  const [tier, setTier] = useState<ModelTier>(DEFAULT_MODEL_TIER);
  const [notes, setNotes] = useState("");
  const [scope, setScope] = useState<Set<AuditScopeItem>>(
    () => new Set(["factors", "fvs", "tags", "assignments"]),
  );
  const [withComparison, setWithComparison] = useState(true);
  const [emptyAck, setEmptyAck] = useState(false);

  // Reset transient form state whenever the dialog opens — we don't
  // want yesterday's notes to silently re-fire on a new redo.
  useEffect(() => {
    if (!open) return;
    setTier(DEFAULT_MODEL_TIER);
    setNotes("");
    setScope(new Set(["factors", "fvs", "tags", "assignments"]));
    setWithComparison(true);
    setEmptyAck(false);
  }, [open]);

  // Esc closes when not busy. Don't yank the dialog out from under
  // the curator mid-submit — they'd lose their notes.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const scopeArray = Array.from(scope);
  const agentDown = agentStatus === "down";
  const isAudit = kind === "audit";
  const scopeValid = isAudit ? scopeArray.length > 0 : true;
  // Empty-curation guard fires only for audits. An audit on an
  // un-curated experiment treats every agent proposal as
  // `calibration_factor_extra`; the curator probably wants to
  // accept the proposals first.
  const showEmptyWarning = isAudit && !!curationEmpty;
  const emptyOk = !showEmptyWarning || emptyAck;
  const submittable = scopeValid && !busy && !agentDown && emptyOk;

  function toggleScope(item: AuditScopeItem) {
    setScope((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  const title =
    mode === "redo"
      ? isAudit
        ? "Re-run audit"
        : "Re-run proposal"
      : isAudit
        ? "Run audit"
        : "Request proposal";

  const submitLabel = busy
    ? "starting…"
    : mode === "redo"
      ? isAudit
        ? "Re-run audit"
        : "Re-run proposal"
      : isAudit
        ? "Run audit"
        : "Request proposal";

  const subtitle = isAudit
    ? mode === "redo"
      ? "Replaces the open audit on this experiment. Notes below thread into the next judge pass."
      : "Runs the audit judges against the current curation. Findings land in the sidebar; the report is also in the inbox."
    : mode === "redo"
      ? "Retires the standing proposal and starts a fresh proposer run. Notes below thread into the next prompt."
      : "Builds a fresh proposal for this experiment. Lands in the Proposals sidebar.";

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

        {showEmptyWarning ? (
          <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700 p-2 text-xs space-y-1.5">
            <p>
              <strong>Nothing curated yet.</strong> This experiment has
              no curator-attached tags and no factors. The auditor will
              treat every agent proposal as <code>_factor_extra</code>
              {" "}— you'll see noise rather than signal.
            </p>
            <p className="text-amber-800 dark:text-amber-200">
              Usually you want to accept the agent's proposals first,
              then audit the resulting curation.
            </p>
            <label className="flex items-center gap-2 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                className="rounded border-amber-300"
                checked={emptyAck}
                onChange={(e) => setEmptyAck(e.target.checked)}
              />
              <span>Run audit anyway.</span>
            </label>
          </div>
        ) : null}

        {mode === "redo" ? (
          <div>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              htmlFor="agent-run-notes"
            >
              Notes for the agent{" "}
              <span className="font-normal text-slate-400 dark:text-slate-500">
                (what should change?)
              </span>
            </label>
            <textarea
              id="agent-run-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={
                isAudit
                  ? "Notes thread into the next judge pass via prior_feedback. Optional."
                  : "Notes thread into the prompt as 'Curator feedback from previous attempt'. Optional."
              }
              className="w-full text-xs rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Model tier
          </label>
          <div className="flex gap-1">
            {MODEL_TIER_ORDER.map((t) => (
              <TierButton
                key={t}
                value={t}
                current={tier}
                onChange={setTier}
              />
            ))}
          </div>
        </div>

        {isAudit ? (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Scope
              </label>
              <div className="flex flex-wrap gap-2">
                <ScopeCheckbox
                  label="factors"
                  checked={scope.has("factors")}
                  onChange={() => toggleScope("factors")}
                />
                <ScopeCheckbox
                  label="FVs"
                  checked={scope.has("fvs")}
                  onChange={() => toggleScope("fvs")}
                />
                <ScopeCheckbox
                  label="tags"
                  checked={scope.has("tags")}
                  onChange={() => toggleScope("tags")}
                />
                <ScopeCheckbox
                  label="assignments"
                  checked={scope.has("assignments")}
                  onChange={() => toggleScope("assignments")}
                />
              </div>
              {scope.size === 0 ? (
                <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">
                  Pick at least one scope item — the server rejects an
                  empty scope (400).
                </p>
              ) : null}
            </div>
            <label
              className="flex items-center gap-2 text-xs cursor-pointer"
              title="Run the silent comparison proposer alongside the judges so `proposer_suggestion` populates on findings. Off = deterministic checks only (cheaper, less informative)."
            >
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={withComparison}
                onChange={(e) => setWithComparison(e.target.checked)}
              />
              <span>
                Run comparison proposer{" "}
                <span className="text-slate-400">(populates suggestions)</span>
              </span>
            </label>
          </>
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
            onClick={() => {
              const req: AgentRunRequest = {
                kind,
                mode,
                tier,
                priorFeedback: notes.trim(),
              };
              if (isAudit) {
                req.scope = scopeArray;
                req.withComparison = withComparison;
              }
              onSubmit(req);
            }}
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

function ScopeCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer",
        checked
          ? "bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900/40 dark:border-blue-600 dark:text-blue-100"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300",
      )}
    >
      <input
        type="checkbox"
        className="rounded border-slate-300"
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

function TierButton({
  value,
  current,
  onChange,
}: {
  value: ModelTier;
  current: ModelTier;
  onChange: (v: ModelTier) => void;
}) {
  const def = MODEL_TIERS[value];
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      title={`${def.label} — ${def.description}`}
      className={cn(
        "text-xs px-2 py-1 rounded border inline-flex items-baseline gap-1",
        active
          ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300",
      )}
    >
      <span>{def.label}</span>
      <span className="text-[9px] opacity-70">{def.costMarker}</span>
    </button>
  );
}
