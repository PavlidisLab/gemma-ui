import { useMemo, useState } from "react";
import { ContinuousFactorView } from "./ContinuousFactorView";
import { FactorList } from "./FactorList";
import { FactorValueList } from "./FactorValueList";
import { SampleAssignmentPreview } from "./SampleAssignmentPreview";
import { ValidatorBanner } from "./ValidatorBanner";
import { useDesignDraft } from "./DesignDraftContext";
import { indexChanges } from "./diff";
import {
  addFactor,
  addFactorFromTemplate,
  addFactorValue,
  addSiblingStatement,
  addStatement,
  addStatementFromTemplate,
  assignRemainingBiomaterials,
  deleteFactor,
  deleteFactorValue,
  deleteStatement,
  reassignSamples,
  setFactorFields,
  setFvLabel,
  setStatement,
  toggleBaseline,
} from "./mutations";
import { validateDesign } from "@/features/experiment/types";
import type { Statement } from "@/features/experiment/types";

/**
 * Owner of the design-editing surface for the **design tab**.
 * Pure presentation — the draft buffer + commit plumbing live in
 * `DesignDraftContext` so tag edits and design edits coexist in
 * the same uncommitted draft, and the `<CommitBar/>` is rendered
 * once at App level.
 */
export function DesignEditor({ experimentId }: { experimentId: number }) {
  const { draft, diff, apply, isLoading, loadError } = useDesignDraft();

  const [selectedFactorId, setSelectedFactorId] = useState<number | null>(null);

  const changes = useMemo(() => indexChanges(diff), [diff]);

  const validation = useMemo(
    () => (draft ? validateDesign(draft) : null),
    [draft],
  );

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading design…</div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load design for experiment {experimentId}:{" "}
        {loadError ?? "unknown"}
        <p className="mt-1 text-slate-500 text-[11px]">
          Mock not seeded? Restart with{" "}
          <code>./run_mock.sh</code> — it auto-seeds GSE277245.1 on
          first start.
        </p>
      </div>
    );
  }

  const effectiveSelected =
    selectedFactorId ?? draft.factors[0]?.id ?? null;
  const selectedFactor =
    draft.factors.find((f) => f.id === effectiveSelected) ?? null;

  return (
    <div className="space-y-4">
      <FactorList
        factors={draft.factors}
        selectedId={effectiveSelected}
        modifiedFactorIds={
          new Set(
            diff.factorsChanged
              .filter((fc) => fc.factorFieldsChanged)
              .map((fc) => fc.factorId),
          )
        }
        addedFactorIds={new Set(diff.factorsAdded.map((f) => f.id))}
        onSelect={setSelectedFactorId}
        onFactorFieldsChange={(factorId, patch) =>
          apply(setFactorFields(draft, factorId, patch))
        }
        onAddFactor={() => {
          const result = addFactor(draft);
          apply(result.design);
          setSelectedFactorId(result.factorId);
        }}
        onAddFactorFromTemplate={(template) => {
          const result = addFactorFromTemplate(draft, template);
          apply(result.design);
          setSelectedFactorId(result.factorId);
        }}
        onDeleteFactor={(factorId) => {
          apply(deleteFactor(draft, factorId));
          if (selectedFactorId === factorId) {
            setSelectedFactorId(null);
          }
        }}
      />

      {selectedFactor ? (
        // Continuous factors carry per-sample measurements rather
        // than a discrete FV partition — show the distribution
        // (strip plot + summary) instead of the per-FV editor + the
        // sample-assignment cohort table. Editing of individual
        // measurements lives on the Sample tab via the per-BM
        // characteristic.
        selectedFactor.type === "continuous" ? (
          <ContinuousFactorView factor={selectedFactor} />
        ) : (
          <>
            <FactorValueList
              factor={selectedFactor}
              totalBiomaterials={draft.biomaterials.length}
              changesByFvId={changes.byFv.get(selectedFactor.id) ?? null}
              onFvLabelChange={(fvId, label) =>
                apply(setFvLabel(draft, selectedFactor.id, fvId, label))
              }
              onToggleBaseline={(fvId) =>
                apply(toggleBaseline(draft, selectedFactor.id, fvId))
              }
              onAddFv={() => apply(addFactorValue(draft, selectedFactor.id))}
              onDeleteFv={(fvId) =>
                apply(deleteFactorValue(draft, selectedFactor.id, fvId))
              }
              onAddStatement={(fvId) =>
                apply(addStatement(draft, selectedFactor.id, fvId))
              }
              onAddSiblingStatement={(fvId, seed) =>
                apply(addSiblingStatement(draft, selectedFactor.id, fvId, seed))
              }
              onAddStatementFromTemplate={(fvId, tpl) =>
                apply(
                  addStatementFromTemplate(
                    draft,
                    selectedFactor.id,
                    fvId,
                    tpl.build,
                  ),
                )
              }
              onAssignRemaining={(fvId) =>
                apply(
                  assignRemainingBiomaterials(draft, selectedFactor.id, fvId),
                )
              }
              onStatementChange={(fvId, index, next: Statement) =>
                apply(setStatement(draft, selectedFactor.id, fvId, index, next))
              }
              onStatementDelete={(fvId, index) =>
                apply(deleteStatement(draft, selectedFactor.id, fvId, index))
              }
            />
            <SampleAssignmentPreview
              factor={selectedFactor}
              biomaterials={draft.biomaterials}
              experimentId={experimentId}
              onReassignBulk={(shortNames, toFvId) =>
                apply((d) =>
                  reassignSamples(d, selectedFactor.id, shortNames, toFvId),
                )
              }
            />
          </>
        )
      ) : (
        <div className="card p-4 text-sm text-slate-500">
          Select a factor above to edit its values.
        </div>
      )}

      {validation ? (
        <ValidatorBanner
          design={draft}
          state={validation}
          onSelectFactor={(factorId) => setSelectedFactorId(factorId)}
        />
      ) : null}
    </div>
  );
}
