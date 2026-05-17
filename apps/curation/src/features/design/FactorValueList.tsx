import { FactorValueCard } from "./FactorValueCard";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
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
}: {
  factor: Factor;
  totalBiomaterials: number;
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
    <div className="card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
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
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            baseline
            <GuidelinePopup snippet={BASELINE_GUIDELINE} size="md" align="right" />
          </span>
          <button className="btn" onClick={onAddFv}>+ value</button>
        </div>
      </div>
      {factor.factor_values.map((fv) => {
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
          />
        );
      })}
    </div>
  );
}
