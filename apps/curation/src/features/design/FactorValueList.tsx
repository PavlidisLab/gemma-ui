import { FactorValueCard } from "./FactorValueCard";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { BASELINE_GUIDELINE } from "@/lib/guidelines";
import type { StatementTemplate } from "./statementTemplates";
import type {
  Factor,
  Statement,
  FactorValue,
} from "@/features/experiment/types";
import type { FvChange } from "./diff";

export function FactorValueList({
  factor,
  factorDescription,
  totalBiomaterials,
  changesByFvId,
  onFvLabelChange,
  onToggleBaseline,
  onAddFv,
  onDeleteFv,
  onAddStatement,
  onAddSiblingStatement,
  onAddStatementFromTemplate,
  onAssignRemaining,
  onStatementChange,
  onStatementDelete,
  onRevertFv,
  compact = false,
  onToggleCompact,
}: {
  factor: Factor;
  /** LLM-emitted ≤80-char summary surfaced as an italic subtitle
   *  under the panel header. Optional; the header row drops the
   *  subtitle when absent or empty. Per
   *  UIB_HANDOFF_2026_06_10_FACTOR_DESCRIPTION_SURFACE.md. */
  factorDescription?: string;
  totalBiomaterials: number;
  /** Compact view — hides per-FV editing chrome (delete buttons,
   *  statement-template menu, predicate selects, find-term, etc.)
   *  and renders the statements as read-only S - P - O rows. */
  compact?: boolean;
  /** Toggle handler for the compact view button rendered in the
   *  header. Hidden when ``onToggleCompact`` isn't supplied. */
  onToggleCompact?: () => void;
  /** Per-fvId change records for the *currently selected* factor. The
   * `removed` entries are tombstones (FVs the user deleted from the
   * draft); we render them struck through so the deletion is visible
   * pre-commit. */
  changesByFvId: Map<number, FvChange> | null;
  onFvLabelChange: (fvId: number, label: string) => void;
  onToggleBaseline: (fvId: number) => void;
  onAddFv: () => void;
  onDeleteFv: (fvId: number) => void;
  onAddStatement: (fvId: number) => void;
  /** "+ sibling" within a StatementGroupEditor — seed the new
   *  statement with the source's category + subject. */
  onAddSiblingStatement: (fvId: number, seed: Statement) => void;
  onAddStatementFromTemplate: (fvId: number, template: StatementTemplate) => void;
  onAssignRemaining: (fvId: number) => void;
  onStatementChange: (fvId: number, index: number, next: Statement) => void;
  onStatementDelete: (fvId: number, index: number) => void;
  /** Atomic per-FV revert. Restores label / baseline / statements /
   *  samples to the saved baseline (or drops an added FV / restores
   *  a removed one). The change descriptor carries the saved FV
   *  in `change.before` so the parent doesn't have to thread the
   *  saved design separately. */
  onRevertFv: (fvId: number, change: FvChange) => void;
}) {
  // Review-mode lock: wrap the mutation surface (FV cards + add
  // buttons + per-card statement edits) in ``<fieldset disabled>``.
  // ``GuidelinePopup`` / ``HelpPopup`` use span+role="button" so they
  // bypass disabled and continue to fire — the curator can still
  // read the baseline + predicate + per-category guidelines while
  // editing is locked.
  const readOnly = useIsReadOnly();
  const assigned = new Set<string>();
  factor.factor_values.forEach((fv) =>
    fv.biomaterial_short_names.forEach((sn) => assigned.add(sn)),
  );
  const unassignedCount = Math.max(0, totalBiomaterials - assigned.size);

  // Tombstone FVs to render below the live ones — these are FVs that
  // existed in the saved design but the user has removed from the draft.
  const tombstones: FactorValue[] = [];
  if (changesByFvId) {
    for (const c of changesByFvId.values()) {
      if (c.kind === "removed" && c.before) tombstones.push(c.before);
    }
  }

  return (
    // Factor-card palette: sky. Matches the overview's "fv" palette
    // (OverviewPanel.tsx) and distinguishes factor cards from tags
    // (which use a different colour family). One consistent
    // convention across the design + overview surfaces so the
    // curator's eye learns "blue = factor". `!` modifiers force
    // these over the `.card` class's default white background +
    // slate border in light mode.
    <div className="rounded-lg border bg-sky-50 border-sky-300 dark:bg-sky-900/40 dark:border-sky-700">
      <div className="px-3 py-2 border-b border-sky-300 dark:border-sky-800">
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="section-h">
            Factor values for:{" "}
            <span className="text-slate-900 normal-case font-semibold">
              {factor.name}
            </span>
          </span>
          <span className="text-xs text-slate-400">
            {factor.factor_values.length} values · {assigned.size} /{" "}
            {totalBiomaterials} samples assigned
          </span>
          {unassignedCount > 0 ? (
            <span
              className="inline-flex items-baseline text-[10px] tracking-wide font-semibold px-1 py-0 rounded border bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-200"
              title={`Only ${assigned.size} of ${totalBiomaterials} samples are assigned to a factor value — ${unassignedCount} unassigned. Add or rebalance FVs to cover all samples before committing.`}
            >
              ⚠ {unassignedCount} unassigned
            </span>
          ) : null}
          {onToggleCompact ? (
            // Double-chevron compact-mode toggle. ≪ when expanded
            // (click to collapse / hide editing chrome); ≫ when
            // compact (click to expand back to full editor). The
            // earlier "✓ COMPACT" text-label badge read as a
            // self-important status pill and the toggle action
            // wasn't obvious. Per Paul 2026-05-21.
            <button
              type="button"
              onClick={onToggleCompact}
              aria-label={
                compact
                  ? "switch back to the full editor"
                  : "compact view — hide editing chrome"
              }
              title={
                compact
                  ? "expand — show editing chrome"
                  : "compact — hide editing chrome, statements only"
              }
              className={
                "inline-flex items-center justify-center w-6 h-6 rounded border text-[14px] leading-none font-semibold transition-colors " +
                (compact
                  ? "border-sky-400 text-sky-700 bg-sky-50 hover:bg-sky-100 dark:border-sky-600 dark:text-sky-300 dark:bg-sky-900/30 dark:hover:bg-sky-900/50"
                  : "border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100")
              }
            >
              <span aria-hidden>{compact ? "≫" : "≪"}</span>
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            baseline
            <GuidelinePopup snippet={BASELINE_GUIDELINE} size="md" align="right" />
          </span>
          {compact ? null : (
            <button
              className="btn"
              onClick={onAddFv}
              disabled={readOnly}
            >
              + value
            </button>
          )}
        </div>
        </div>
        {factorDescription?.trim() ? (
          <div className="mt-1 text-[11px] italic leading-snug text-slate-500 dark:text-slate-400">
            {factorDescription.trim()}
          </div>
        ) : null}
      </div>
      {/* FV cards stacked inside a padded, spaced container. The
          parent factor uses the sky-50 / sky-900/40 tint to claim
          the visual region; each FV needs its own opaque card so
          the curator can tell where one stops and the next begins.
          ``space-y-2`` carries the gap; per-card border + opaque
          background live on the ``FactorValueCard`` ``<article>``.
          Baselines render first — when the factor declares a
          baseline ("reference substance role", "control", etc.) the
          curator's eye should land on it before the
          treatment / experimental levels. Stable secondary order
          (server-side declaration) within each group. */}
      <fieldset
        disabled={readOnly}
        className="p-2 space-y-2 m-0 border-0"
      >
      {[...factor.factor_values]
        .sort((a, b) =>
          a.is_baseline === b.is_baseline ? 0 : a.is_baseline ? -1 : 1,
        )
        .map((fv) => {
        const change = changesByFvId?.get(fv.id) ?? null;
        return (
          <FactorValueCard
            key={fv.id}
            fv={fv}
            factorCategory={factor.category}
            change={change}
            onLabelChange={(label) => onFvLabelChange(fv.id, label)}
            onToggleBaseline={() => onToggleBaseline(fv.id)}
            onDelete={() => onDeleteFv(fv.id)}
            onAddStatement={() => onAddStatement(fv.id)}
            onAddSiblingStatement={(seed) =>
              onAddSiblingStatement(fv.id, seed)
            }
            onAddStatementFromTemplate={(tpl) =>
              onAddStatementFromTemplate(fv.id, tpl)
            }
            onAssignRemaining={() => onAssignRemaining(fv.id)}
            remainingCount={unassignedCount}
            onStatementChange={(idx, next) => onStatementChange(fv.id, idx, next)}
            onStatementDelete={(idx) => onStatementDelete(fv.id, idx)}
            onRevert={change ? () => onRevertFv(fv.id, change) : undefined}
            compact={compact}
            onExpand={onToggleCompact}
          />
        );
      })}
      {tombstones.map((fv) => {
        const change: FvChange = {
          kind: "removed",
          factorId: factor.id,
          fvId: fv.id,
          before: fv,
        };
        return (
          <FactorValueCard
            key={`tomb-${fv.id}`}
            fv={fv}
            factorCategory={factor.category}
            change={change}
            onLabelChange={() => {}}
            onToggleBaseline={() => {}}
            onDelete={() => {}}
            onAddStatement={() => {}}
            onStatementChange={() => {}}
            onStatementDelete={() => {}}
            onRevert={() => onRevertFv(fv.id, change)}
            compact={compact}
          />
        );
      })}
      </fieldset>
    </div>
  );
}
