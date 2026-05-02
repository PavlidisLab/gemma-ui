/**
 * One candidate row in the screening queue. Shows accession, source,
 * metadata, and inline decision controls (approve / exclude / defer).
 *
 * Excluded and deferred transitions require a reason; a small inline
 * form appears below the row on click.
 */
import { usePatchCandidate } from "@/api/workflow";
import type { Candidate, CandidateStatus } from "@/api/workflowTypes";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<CandidateStatus, string> = {
  pending:   "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  in_review: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  approved:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  excluded:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  deferred:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  loaded:    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};

const STATUS_LABEL: Record<CandidateStatus, string> = {
  pending:   "Pending",
  in_review: "In review",
  approved:  "Approved",
  excluded:  "Excluded",
  deferred:  "Deferred",
  loaded:    "Loaded",
};

const SOURCE_STYLE: Record<string, string> = {
  GEO:          "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  ArrayExpress: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  SRA:          "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  manual:       "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

// ---------------------------------------------------------------------------
// Reason form (shown inline for exclude / defer)
// ---------------------------------------------------------------------------

function ReasonForm({
  action,
  onConfirm,
  onCancel,
  saving,
}: {
  action: "excluded" | "deferred";
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex items-start gap-2 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={action === "excluded" ? "Why exclude?" : "Why defer?"}
        className="flex-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        disabled={!reason.trim() || saving}
        onClick={() => onConfirm(reason.trim())}
        className="text-xs px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white"
      >
        {saving ? "Saving…" : "Confirm"}
      </button>
      <button
        onClick={onCancel}
        className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-2 py-1"
      >
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CandidateRow({
  candidate,
  reviewer,
}: {
  candidate: Candidate;
  reviewer: string;
}) {
  const patch = usePatchCandidate();
  const [pendingAction, setPendingAction] = useState<"excluded" | "deferred" | null>(null);
  const isDecided = ["approved", "excluded", "deferred", "loaded"].includes(candidate.status);

  function transition(status: CandidateStatus, reason?: string) {
    patch.mutate({
      id: candidate.id,
      patch: {
        status,
        reviewer,
        ...(reason ? { decision_reason: reason } : {}),
      },
    });
  }

  function handleAction(action: "approved" | "excluded" | "deferred") {
    if (action === "excluded" || action === "deferred") {
      setPendingAction(action);
    } else {
      transition(action);
    }
  }

  function confirmReason(reason: string) {
    if (!pendingAction) return;
    transition(pendingAction, reason);
    setPendingAction(null);
  }

  return (
    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex items-start justify-between gap-3 min-w-0">
        {/* Left: accession + metadata */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
              {candidate.accession}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${SOURCE_STYLE[candidate.source] ?? SOURCE_STYLE.manual}`}
            >
              {candidate.source}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_STYLE[candidate.status]}`}
            >
              {STATUS_LABEL[candidate.status]}
            </span>
            {candidate.source_batch && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {candidate.source_batch}
              </span>
            )}
          </div>

          {candidate.title && (
            <p className="text-sm text-slate-700 dark:text-slate-200 truncate">
              {candidate.title}
            </p>
          )}

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {candidate.organism && <span>{candidate.organism}</span>}
            {candidate.platform && (
              <>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>{candidate.platform}</span>
              </>
            )}
            {candidate.sample_count != null && (
              <>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>{candidate.sample_count} samples</span>
              </>
            )}
            {candidate.reviewer && (
              <>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="italic">{candidate.reviewer}</span>
              </>
            )}
          </div>

          {candidate.decision_reason && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              {candidate.decision_reason}
            </p>
          )}

          {candidate.notes && !candidate.decision_reason && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic truncate">
              {candidate.notes}
            </p>
          )}
        </div>

        {/* Right: action buttons (hidden once decided) */}
        {!isDecided && !pendingAction && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => handleAction("approved")}
              disabled={patch.isPending}
              className="text-xs px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleAction("deferred")}
              disabled={patch.isPending}
              className="text-xs px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
            >
              Defer
            </button>
            <button
              onClick={() => handleAction("excluded")}
              disabled={patch.isPending}
              className="text-xs px-2.5 py-1 rounded bg-slate-200 hover:bg-red-100 hover:text-red-700 dark:bg-slate-700 dark:hover:bg-red-900/30 dark:hover:text-red-400 text-slate-600 dark:text-slate-400 transition-colors"
            >
              Exclude
            </button>
          </div>
        )}

        {/* Undo for decided candidates */}
        {isDecided && candidate.status !== "loaded" && !pendingAction && (
          <button
            onClick={() => transition("pending")}
            disabled={patch.isPending}
            className="text-[10px] text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 shrink-0 transition-colors"
          >
            undo
          </button>
        )}
      </div>

      {pendingAction && (
        <ReasonForm
          action={pendingAction}
          onConfirm={confirmReason}
          onCancel={() => setPendingAction(null)}
          saving={patch.isPending}
        />
      )}
    </div>
  );
}
