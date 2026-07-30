/**
 * FindingReasoningPanel — the shared "Reasoning" collapsible.
 *
 * One component renders the reasoning toggle + the panel body across
 * every finding card type so the curator learns ONE affordance shape
 * regardless of whether the finding is a factor-match, a partition
 * mismatch, an add-tag, or a remove-tag.
 *
 * Body content follows the three-phase layout:
 *   1. Why proposed   (via ThreePhaseFindingBody)
 *   2. Reviews        (via ThreePhaseFindingBody)
 *   3. Comparison vs <set> — judge text (via ThreePhaseFindingBody)
 *   + optional citation chip + per-finding subtask analysis trail
 *
 * Caller owns: the visual comparator (chip strip / FV grid) and the
 * action row — both render OUTSIDE this panel so they stay visible
 * when the curator hides the reasoning text.
 *
 * Design review 2026-06-16: "IT SHOULD BE THE SAME COMPONENT WHETHER THE
 * FACTOR IS A MATCH or a PARTIAL MATCH".
 */

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { normalizeWikiUrl } from "@/lib/guidelines";
import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import { AgentSuggestionPanel, InlineSubtaskReasoning } from "./agentDetailsPanel";

export interface FindingReasoningPanelProps {
  finding: AuditFinding;
  report: AuditReport | null;
  /** Default-open state. CompactFindingCard wires this to a higher
   *  "expand all" baseline; standalone callers can leave it false. */
  defaultOpen?: boolean;
  /** Optional extra body content rendered BEFORE the
   *  AgentSuggestionPanel — used by CompactFindingCard to slot in
   *  the per-issue-code RenameFactorEmbed / GoldFactorMissEmbed
   *  fallbacks. Skipped by ComparisonFactorCard which has no
   *  per-issue-code embed needs. */
  extraBody?: ReactNode;
}

/** Returns true when the finding has any content the panel can show.
 *  When false the toggle renders disabled ("no reasoning"). */
export function findingHasReasoningContent(finding: AuditFinding): boolean {
  const hasCitation = !!(finding.citation?.trim() || finding.citation_url?.trim());
  const hasWhy =
    !!(finding.why?.rationale?.trim() ||
       finding.why?.brief?.trim() ||
       (finding.why?.evidence?.length ?? 0) > 0);
  const hasReviews = (finding.reviews?.length ?? 0) > 0;
  const hasComparison =
    !!(finding.comparison?.judge_rationale?.trim() ||
       finding.comparison?.judge_verdict?.trim() ||
       finding.comparison?.judge_brief?.trim());
  // Legacy back-compat — proposer_defense / defender_verdict still
  // surface a "show reasoning" affordance for findings projected
  // pre-three-phase migration.
  const hasLegacy =
    !!(finding.proposer_defense?.trim() ||
       finding.rationale?.trim() ||
       finding.defender_verdict);
  return hasCitation || hasWhy || hasReviews || hasComparison || hasLegacy;
}

export function FindingReasoningPanel({
  finding,
  report,
  defaultOpen = false,
  extraBody = null,
}: FindingReasoningPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  // Re-sync to defaultOpen when the parent's panel-expansion baseline
  // changes — CompactFindingCard drives this via the
  // PanelExpansionContext. Without this, cycling collapsed → expanded
  // → fully mounts the panel at defaultOpen=false (the "expanded"
  // step) and the subsequent defaultOpen=true ("fully" step) never
  // reaches the internal state.
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  const hasContent = findingHasReasoningContent(finding);
  const citationVisible = !!(finding.citation || finding.citation_url);
  return (
    <div className="space-y-1">
      {/* Reasoning toggle — same affordance on every card type. */}
      <div className="pl-1">
        <button
          type="button"
          data-testid="finding-reasoning-toggle"
          onClick={() => {
            if (!hasContent) return;
            setOpen((v) => !v);
          }}
          disabled={!hasContent}
          aria-label={
            !hasContent
              ? "no reasoning available"
              : open
                ? "hide reasoning"
                : "show reasoning"
          }
          aria-expanded={hasContent ? open : undefined}
          title={
            !hasContent
              ? "no reasoning was recorded for this finding"
              : open
                ? "collapse the proposer + reviewer text"
                : "show the proposer + reviewer text"
          }
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide font-semibold whitespace-nowrap",
            hasContent
              ? "text-sky-700 hover:underline dark:text-sky-300"
              : "text-slate-400 cursor-not-allowed dark:text-slate-500",
          )}
        >
          {!hasContent
            ? "no reasoning"
            : open
              ? "hide reasoning"
              : "reasoning"}
          {hasContent ? (
            <span className="text-xs leading-none">{open ? "▾" : "▸"}</span>
          ) : null}
        </button>
      </div>

      {/* Collapsible body — citation + three-phase render + subtask
          analysis. Indented + bordered so it reads as one unit. */}
      {open && hasContent ? (
        <div
          data-testid="finding-reasoning-body"
          className="space-y-1.5 pl-1 border-l-2 border-slate-200 dark:border-slate-700"
        >
          {citationVisible ? (
            <div className="text-[10px] text-slate-500 pl-1.5">
              §{" "}
              {finding.citation_url ? (
                <a
                  href={normalizeWikiUrl(finding.citation_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline"
                  title={finding.citation || finding.citation_url}
                >
                  {finding.citation || finding.citation_url}
                </a>
              ) : (
                <span>{finding.citation}</span>
              )}
            </div>
          ) : null}
          {extraBody}
          <AgentSuggestionPanel finding={finding} />
          <InlineSubtaskReasoning finding={finding} report={report} />
        </div>
      ) : null}
    </div>
  );
}
