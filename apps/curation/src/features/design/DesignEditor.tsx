import { useEffect, useMemo, useState } from "react";
import { useSessionState } from "@/lib/useStickyState";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { ContinuousFactorView } from "./ContinuousFactorView";
import { FactorList } from "./FactorList";
import { FactorValueList } from "./FactorValueList";
import { SampleAssignmentPreview } from "./SampleAssignmentPreview";
import { ValidatorBanner } from "./ValidatorBanner";
import { useDesignDraft } from "./DesignDraftContext";
import { indexChanges } from "./diff";
import { parseTargetId, slug } from "@/features/audit/targetIds";
import {
  focusByAuditTarget,
  onAuditFocusTarget,
} from "@/lib/scrollToAuditTarget";
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
  revertFactor,
  revertFactorValue,
  setFactorFields,
  setFvLabel,
  setStatement,
  toggleBaseline,
} from "./mutations";
import { validateDesign } from "@/features/experiment/types";
import type { Design, Statement } from "@/features/experiment/types";

/**
 * Owner of the design-editing surface for the **design tab**.
 * Pure presentation — the draft buffer + commit plumbing live in
 * `DesignDraftContext` so tag edits and design edits coexist in
 * the same uncommitted draft, and the `<CommitBar/>` is rendered
 * once at App level.
 */
export function DesignEditor({
  experimentId,
  displayOverride,
}: {
  experimentId: number | string;
  /** When provided AND non-null, the tab renders against this Design
   *  instead of the live editable draft. Used by the curation
   *  comparison view's chip strip: in review mode with a baseline
   *  chip set, the curator wants to LOOK at that source's state,
   *  not the locked draft. ``readOnly`` should always be true when
   *  this is non-null (caller's responsibility). */
  displayOverride?: Design | null;
}) {
  const live = useDesignDraft();
  const liveDraft = live.draft;
  const saved = live.saved;
  const diff = live.diff;
  const apply = live.apply;
  const isLoading = live.isLoading;
  const loadError = live.loadError;
  // ``draft`` below is what the tab RENDERS against. Mutations
  // continue to target the live draft via ``apply`` (gated by the
  // fieldset disabled in review mode).
  const draft = displayOverride ?? liveDraft;

  // Persist the selected factor per-experiment-per-tab-session so
  // switching to another tab and back doesn't reset the selection to
  // the default first factor. sessionStorage is per-tab so a fresh
  // tab gets the default cleanly; a "stuck on the wrong factor across
  // sessions" worst-case is bounded to the current tab's lifetime.
  const [selectedFactorId, setSelectedFactorId] = useSessionState<
    number | null
  >(`design.selectedFactor.${experimentId}`, null);

  // Compact view — global toggle that hides editing chrome on each
  // FV card (delete / revert buttons, statement-template menu,
  // predicate selects, etc.) and renders the statements as
  // read-only S - P - O rows. Persists in localStorage so the
  // curator's preference sticks across reloads.
  const [compact, setCompact] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("gemma-design-compact") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "gemma-design-compact",
        compact ? "1" : "0",
      );
    } catch {
      // localStorage unavailable — toggle still works in-memory.
    }
  }, [compact]);

  const changes = useMemo(() => indexChanges(diff), [diff]);

  const validation = useMemo(
    () => (draft ? validateDesign(draft) : null),
    [draft],
  );

  // Audit "Apply & focus" handler. For factor-kind targets the factor
  // row is always in the DOM; for fv-kind the FV card lives inside
  // the FactorValueList that only renders when its factor is
  // selected. Resolve the parent factor by category-slug, select it,
  // wait two frames for FactorValueList to mount + paint, then run
  // focusByAuditTarget against the FV card. The whole thing is a
  // no-op if nothing in the draft matches the target's slug — which
  // is the right behaviour after a curator-driven category rename.
  useEffect(() => {
    return onAuditFocusTarget(({ targetId }) => {
      const parsed = parseTargetId(targetId);
      if (!parsed) return;
      // The factorSlug field of parseTargetId is the chunk after
      // ``factor:`` — for finding target_ids it's commonly a
      // NUMERIC id (e.g. ``factor:9325`` = gold factor's DB id),
      // not the curator-readable category-label slug. Try numeric
      // id first, then fall back to label-slug for legacy /
      // calibration target_ids that use the label form.
      const resolveFactor = (sl: string) => {
        if (!draft) return undefined;
        const asInt = Number.parseInt(sl, 10);
        if (Number.isFinite(asInt)) {
          const byId = draft.factors.find((f) => f.id === asInt);
          if (byId) return byId;
        }
        return draft.factors.find(
          (f) => slug(f.category?.label || "") === sl,
        );
      };
      if (parsed.kind === "factor") {
        const target = resolveFactor(parsed.factorSlug);
        if (target) setSelectedFactorId(target.id);
        requestAnimationFrame(() => {
          focusByAuditTarget(targetId);
        });
        return;
      }
      if (parsed.kind === "fv") {
        const target = resolveFactor(parsed.factorSlug);
        if (target) setSelectedFactorId(target.id);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            focusByAuditTarget(targetId);
          });
        });
      }
    });
  }, [draft]);

  // Order matters: ``draft === null`` is a transient state during
  // a "Reset experiment" refetch (react-query flips ``isFetching``,
  // not ``isLoading``, on a refetch). Show "loading" rather than
  // a confusing "unknown" error in that window.
  if (loadError) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load design for experiment {experimentId}: {loadError}
        <p className="mt-1 text-slate-500 text-[11px]">
          Local server not seeded? Restart with{" "}
          <code>./run_mock.sh</code> — it auto-seeds GSE277245.1 on
          first start.
        </p>
      </div>
    );
  }
  if (isLoading || !draft) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading design…</div>
    );
  }

  const effectiveSelected =
    selectedFactorId ?? draft.factors[0]?.id ?? null;
  const selectedFactor =
    draft.factors.find((f) => f.id === effectiveSelected) ?? null;

  // Review-mode banner — surfaces *why* the tab is locked. The
  // App-level ``<fieldset disabled>`` wrapper handles interaction
  // blocking for real form controls; span+role="button" widgets
  // (CategoryPicker, OntologyTermPicker, EditableDescription) read
  // ``useIsReadOnly()`` and self-gate. This banner is just the
  // visible status line.
  const readOnly = useIsReadOnly();

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div
          className="rounded border border-slate-300 bg-slate-100/60 px-3 py-2 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-300"
          role="status"
        >
          <span className="font-semibold uppercase tracking-wide text-[10px] mr-2">
            Read-only
          </span>
          no calibration / ticket context — open this experiment via a
          package to take action on the design
        </div>
      ) : null}
      <div className="space-y-4">
      {/* Validator banner sits above FactorList so the
          "design valid / has warnings" summary is visible the
          moment the curator lands on the tab. Earlier placement at
          the bottom (under FactorValueList + SampleAssignmentPreview)
          fell off-screen on long factors. */}
      {validation ? (
        <ValidatorBanner
          design={draft}
          state={validation}
          onSelectFactor={(factorId) => setSelectedFactorId(factorId)}
        />
      ) : null}
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
        // Any uncommitted change on this factor — factor-fields,
        // added-in-draft, OR any FV under it added/modified/removed.
        // Drives whether the per-row "revert" link surfaces.
        dirtyFactorIds={(() => {
          const s = new Set<number>();
          for (const f of diff.factorsAdded) s.add(f.id);
          for (const fc of diff.factorsChanged) {
            if (
              fc.factorFieldsChanged ||
              fc.added.length > 0 ||
              fc.removed.length > 0 ||
              fc.modified.length > 0
            ) {
              s.add(fc.factorId);
            }
          }
          return s;
        })()}
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
        onRevertFactor={(factorId) => {
          // saved may be null on a not-yet-loaded design; the
          // factor row only renders if draft is set, but saved can
          // still be null in the fresh-import window. Treat that
          // as "no baseline to restore from" → drops added factors,
          // no-ops modified ones (curator can re-fire after the
          // baseline lands).
          const savedFactor =
            saved?.factors.find((f) => f.id === factorId) ?? null;
          apply(revertFactor(draft, factorId, savedFactor));
          // If the curator just dropped the factor they had selected
          // (added-in-draft, savedFactor=null path), clear selection
          // so FactorValueList doesn't render against a stale id.
          if (
            !savedFactor &&
            (selectedFactorId === factorId ||
              effectiveSelected === factorId)
          ) {
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
              onRevertFv={(fvId, change) =>
                // change.before is null for "added" (FV didn't exist
                // on saved); revertFactorValue treats that as "drop
                // from draft". Modified + removed both have a saved
                // shape to restore.
                apply(
                  revertFactorValue(
                    draft,
                    selectedFactor.id,
                    fvId,
                    change.before ?? null,
                  ),
                )
              }
              compact={compact}
              onToggleCompact={() => setCompact((v) => !v)}
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
      </div>
    </div>
  );
}
