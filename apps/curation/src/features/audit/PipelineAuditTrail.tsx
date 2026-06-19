/**
 * Pipeline audit-trail collapsible — surfaces the v5 supervisor's
 * narrative of what the orchestrator observed, intervened on, and
 * deferred during the run that produced this report.
 *
 * Reads through the dual-state adapter (Proposal-canonical,
 * AuditEvidence mirror). When ``experiment_notes`` is populated,
 * renders a 2-line preview with a "show more" / "show less" toggle.
 * Suppresses entirely when empty so old packages render identically.
 *
 * Sibling to ``CollapsibleSubtaskAnalysis`` at the bottom of the
 * findings list — different angle (one is the chain decisions, this is
 * the supervisor narrative) but same "long-form prose, lives at the
 * end of the panel" shape. Per
 * ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``.
 */
import { useState } from "react";

export interface PipelineAuditTrailProps {
  /** The supervisor's prose (already resolved via the dual-state
   *  adapter). Null / empty → component returns null. */
  text: string | null;
}

const PREVIEW_CHARS = 220;

function previewOf(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > budget * 0.6) return cut.slice(0, lastSpace);
  return cut;
}

export function PipelineAuditTrail({
  text,
}: PipelineAuditTrailProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isLong = trimmed.length > PREVIEW_CHARS;
  const shown = open || !isLong ? trimmed : previewOf(trimmed, PREVIEW_CHARS);

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/30 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-baseline gap-1.5 text-left text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        aria-expanded={open}
        title={open ? "Collapse audit trail" : "Expand audit trail"}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span>Pipeline audit trail</span>
      </button>
      <div className="mt-1 text-[12px] leading-snug text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
        {shown}
        {isLong && !open ? (
          <>
            <span className="text-slate-400 dark:text-slate-500">… </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[11px] text-blue-600 hover:underline underline-offset-2 dark:text-blue-300"
            >
              show more
            </button>
          </>
        ) : null}
        {isLong && open ? (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-blue-600 hover:underline underline-offset-2 dark:text-blue-300"
            >
              show less
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
