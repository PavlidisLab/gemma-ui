import { useEffect, useMemo, useState } from "react";
import { useSessionState } from "@/lib/useStickyState";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { ContinuousFactorView } from "./ContinuousFactorView";
import { FactorList } from "./FactorList";
import { FactorValueList } from "./FactorValueList";
import { SampleAssignmentPreview } from "./SampleAssignmentPreview";
import { ValidatorBanner } from "./ValidatorBanner";
import { useDesignDraft } from "./DesignDraftContext";
import { useAudit } from "@/features/audit/AuditContext";
import { indexChanges } from "./diff";
import { parseTargetId, slug } from "@/features/audit/targetIds";
import {
  focusByAuditTarget,
  onAuditFocusTarget,
} from "@/lib/scrollToAuditTarget";
import {
  addCollectionOfMaterialFactor,
  addFactor,
  addFactorFromTemplate,
  addFactorValue,
  addSiblingStatement,
  addStatement,
  addStatementFromTemplate,
  assignRemainingBiomaterials,
  deleteFactor,
  deleteFactorValue,
  duplicateFactorValue,
  findDuplicateFactorPairs,
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
import { capitalizeCategory } from "@/lib/ontologyTerm";
import type {
  Design, Statement, SubsetRecommendation,
} from "@/features/experiment/types";

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

  // Perfect-duplicate factor detection (Paul 2026-06-14): equality
  // keys on the statement-set, NOT FV labels. Surface as a soft
  // warning above the FactorList so the curator notices before they
  // commit a redundant pair.
  const duplicatePairs = useMemo(
    () => (draft ? findDuplicateFactorPairs(draft) : []),
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

  // ---- Hooks must come BEFORE any early return (Rules of Hooks).
  // The loading / loadError guards below conditionally render but
  // never short-circuit hook calls — see 2026-06-11 crash where the
  // ``useIsReadOnly`` / ``useDesignDraft`` / ``useAudit`` / ``useMemo``
  // calls sat below the ``if (isLoading || !draft) return …`` guard
  // and broke React's hook-order check the moment ``draft`` flipped
  // from null to loaded.
  const effectiveSelected =
    selectedFactorId ?? draft?.factors[0]?.id ?? null;
  const selectedFactor =
    draft?.factors.find((f) => f.id === effectiveSelected) ?? null;

  // Review-mode banner — surfaces *why* the tab is locked. The
  // App-level ``<fieldset disabled>`` wrapper handles interaction
  // blocking for real form controls; span+role="button" widgets
  // (CategoryPicker, OntologyTermPicker, EditableDescription) read
  // ``useIsReadOnly()`` and self-gate. This banner is just the
  // visible status line.
  const readOnly = useIsReadOnly();
  const { usingBaseline, baselineLabel, baselineSourceKind } = useDesignDraft();

  // Pull the LLM-emitted ≤80-char `description` for the selected
  // factor out of the audit report's comparison_proposal — matched
  // by `name_in_design` against the draft factor's name. Empty when
  // there's no matching proposal (no audit running, fresh factor
  // added in the draft, name drift since proposal time, etc.) and
  // FactorValueList suppresses the subtitle row in that case. Per
  // UIB_HANDOFF_2026_06_10_FACTOR_DESCRIPTION_SURFACE.md.
  const { report } = useAudit();
  const factorDescription = useMemo<string | undefined>(() => {
    if (!selectedFactor?.name) return undefined;
    const target = selectedFactor.name.trim().toLowerCase();
    const proposals = report?.evidence?.comparison_proposal?.factors ?? [];
    const match = proposals.find(
      (f) => (f.name_in_design ?? "").trim().toLowerCase() === target,
    );
    const desc = match?.description?.trim();
    return desc ? desc : undefined;
  }, [report, selectedFactor?.name]);

  // ---- Render-time early returns. Hook order is fixed above so
  // these guards are safe.
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

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div
          className="rounded border border-amber-300 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200"
          role="status"
        >
          <span className="font-semibold uppercase tracking-wide text-[10px] mr-2">
            Read-only
          </span>
          {usingBaseline ? (
            <>
              you're viewing{" "}
              <span className="font-mono">{baselineLabel ?? baselineSourceKind ?? "this curation"}</span>
              {" "}— edits write to the local pack, so editing while
              viewing this baseline is locked. Switch the baseline
              chip to the editable target (consensus / your polished
              row) to edit.
            </>
          ) : (
            <>
              no calibration / ticket context — open this experiment
              via a package to take action on the design
            </>
          )}
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
      {duplicatePairs.length > 0 ? (
        <div className="text-[11px] rounded border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1.5 mb-2 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          <span className="font-semibold">
            {duplicatePairs.length === 1
              ? "Duplicate factor"
              : `${duplicatePairs.length} duplicate factor pairs`}
            :{" "}
          </span>
          {duplicatePairs.slice(0, 3).map((p, i) => (
            <span key={`${p.a.id}-${p.b.id}`}>
              {i > 0 ? "; " : ""}
              <button
                type="button"
                onClick={() => setSelectedFactorId(p.a.id)}
                className="underline underline-offset-2 hover:text-amber-700"
              >
                {capitalizeCategory(p.a.category.label) || `factor ${p.a.id}`}
              </button>
              {" ≡ "}
              <button
                type="button"
                onClick={() => setSelectedFactorId(p.b.id)}
                className="underline underline-offset-2 hover:text-amber-700"
              >
                {capitalizeCategory(p.b.category.label) || `factor ${p.b.id}`}
              </button>
            </span>
          ))}
          {duplicatePairs.length > 3 ? (
            <span className="italic"> · and more</span>
          ) : null}
          <div className="text-[10px] italic mt-0.5 text-amber-800 dark:text-amber-200">
            Equality is by statement-set (FV labels can differ). Delete
            or edit one of each pair before committing.
          </div>
        </div>
      ) : null}
      <ExperimentDecisionsSection
        draft={draft}
        readOnly={readOnly}
        onApply={apply}
      />
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
              factorDescription={factorDescription}
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
              onDuplicateFv={(fvId) => {
                const result = duplicateFactorValue(
                  draft,
                  selectedFactor.id,
                  fvId,
                );
                if (result) apply(result.design);
              }}
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


/** Experiment-wide curator decisions section. Sits below the
 *  audit/proposal controls (in the sidebar) and above the per-factor
 *  list. Today it carries the split-recommendation toggle; future
 *  experiment-wide decisions (subset / merge-with / shipping
 *  verdict) go here too.
 *
 *  ``should_split_on_factor_id`` semantics:
 *  - ``null`` / undefined: no decision recorded
 *  - ``-1``: curator explicitly asserted "do NOT split"
 *  - positive int: split on the factor with this id
 *
 *  Captures the 2026-06-06 cy gap: GSE319237 had multiple
 *  experimental arms loaded as a single preboarding; the curator
 *  needed a way to record "this should be split along factor X" but
 *  there was no UI surface.
 */
function ExperimentDecisionsSection({
  draft,
  readOnly,
  onApply,
}: {
  draft: Design;
  readOnly: boolean;
  onApply: (next: Design | ((d: Design) => Design)) => void;
}) {
  const factorId = draft.should_split_on_factor_id ?? null;
  const rationale = draft.should_split_rationale ?? "";
  const decisionMade = factorId !== null;
  const splitOn = factorId !== null && factorId > 0 ? factorId : null;
  const explicitlyDoNotSplit = factorId === -1;

  const setFields = (
    nextFactorId: number | null,
    nextRationale: string,
  ) => {
    onApply({
      ...draft,
      should_split_on_factor_id: nextFactorId,
      should_split_rationale: nextRationale,
    });
  };

  return (
    <details
      className="rounded border border-slate-300 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-700 open:shadow-sm"
      open={decisionMade}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2">
        <span>Experiment-wide decisions</span>
        {decisionMade ? (
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 px-2 py-0.5">
            {explicitlyDoNotSplit
              ? "no-split asserted"
              : "split recommended"}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">
            none recorded
          </span>
        )}
      </summary>
      <fieldset disabled={readOnly} className="px-3 pb-3 pt-1 space-y-2">
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          Recommend a split when this preboarding bundles multiple
          distinct experiments that should ship as separate Gemma
          subseries. The chosen factor's FV partition becomes the
          split axis. Use <strong>do not split</strong> to override an
          upstream agent recommendation.
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="split-decision"
              checked={!decisionMade}
              onChange={() => setFields(null, "")}
            />
            <span>No decision</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="split-decision"
              checked={explicitlyDoNotSplit}
              onChange={() => setFields(-1, rationale)}
            />
            <span>Do not split</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="split-decision"
              checked={splitOn !== null}
              onChange={() => {
                // When toggling on, default to the first existing
                // factor. When no factors exist yet, mark the
                // decision with a placeholder ID of 0 so the
                // dropdown / create-button block renders; the
                // curator picks an actual factor (or hits the
                // create button) before save.
                const firstId = draft.factors[0]?.id ?? 0;
                setFields(firstId, rationale);
              }}
            />
            <span>Split on factor</span>
          </label>
          {splitOn !== null ? (
            <>
              {draft.factors.length > 0 ? (
                <select
                  className="text-[12px] border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 bg-white dark:bg-slate-900"
                  value={splitOn}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setFields(Number.isFinite(v) ? v : null, rationale);
                  }}
                >
                  {draft.factors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name || f.category.label || `factor ${f.id}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] italic text-slate-500">
                  no factors yet — create one below
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  const { design: dWithFactor, factorId } =
                    addCollectionOfMaterialFactor(draft);
                  onApply({
                    ...dWithFactor,
                    should_split_on_factor_id: factorId,
                    should_split_rationale: rationale,
                  });
                }}
                className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
                title="Create a new collection of material factor, append it to the design, and select it as the split axis. Populate the factor values from the factor card below."
              >
                + create &quot;collection of material&quot; factor
              </button>
            </>
          ) : null}
        </div>
        <textarea
          className="w-full text-[12px] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 min-h-[3.5rem]"
          placeholder={
            decisionMade
              ? "Rationale (optional): why this split / no-split?"
              : "Select a decision above to record rationale."
          }
          value={rationale}
          disabled={!decisionMade}
          onChange={(e) =>
            setFields(factorId, e.target.value)
          }
        />

        <SubsetRecommendationsBlock
          draft={draft}
          onApply={onApply}
        />
      </fieldset>
    </details>
  );
}

/** Subset recommendations block — orthogonal to the split decision
 *  above. Splitting is specialized; subsetting is routine. Each
 *  card carries one analysis-subset suggestion (seeded by the agent
 *  or added by the curator); the curator dispositions accept /
 *  reject. Accepted entries propagate downstream as advisory facts
 *  about analysis scope.
 *
 *  Today this is read/write through ``Design.subset_recommendations``
 *  (a list of ``SubsetRecommendation`` objects); the agent-side
 *  importer seeds the list from gestalt ``split_recommendations`` of
 *  kind ``dea_subset`` / ``factor_partial_coverage``.
 */
function SubsetRecommendationsBlock({
  draft,
  onApply,
}: {
  draft: Design;
  onApply: (next: Design | ((d: Design) => Design)) => void;
}) {
  const recs = draft.subset_recommendations ?? [];
  const pending = recs.filter((r) => r.status === "agent_recommended");
  const accepted = recs.filter((r) => r.status === "accepted");
  const rejected = recs.filter((r) => r.status === "rejected");

  const setStatus = (
    id: string,
    status: "accepted" | "rejected" | "agent_recommended",
  ) => {
    onApply((d) => ({
      ...d,
      subset_recommendations: (d.subset_recommendations ?? []).map((r) =>
        r.id === id ? { ...r, status } : r,
      ),
    }));
  };

  const setRationale = (id: string, rationale: string) => {
    onApply((d) => ({
      ...d,
      subset_recommendations: (d.subset_recommendations ?? []).map((r) =>
        r.id === id ? { ...r, rationale } : r,
      ),
    }));
  };

  const factorName = (id: number | null | undefined): string => {
    if (id == null) return "(no factor)";
    const f = draft.factors.find((f) => f.id === id);
    return f?.name || f?.category?.label || `factor ${id}`;
  };

  if (recs.length === 0) {
    return (
      <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          Subset recommendations
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-1">
          None recorded. The agent will seed any DEA-subset or
          partial-coverage recommendations here on next import.
        </div>
      </div>
    );
  }

  const renderCard = (r: SubsetRecommendation) => {
    const factorLabel = factorName(r.by_factor_id);
    const levelLabels = r.level_labels.join(", ");
    const isAccepted = r.status === "accepted";
    const isRejected = r.status === "rejected";
    const isPending = r.status === "agent_recommended";
    const accent = isAccepted
      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
      : isRejected
        ? "border-slate-400 bg-slate-100 dark:bg-slate-900/40 opacity-70"
        : "border-amber-400 bg-amber-50 dark:bg-amber-900/20";
    return (
      <div
        key={r.id}
        className={`rounded border ${accent} px-2 py-1.5 text-[11px] space-y-1`}
      >
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Subset by <em>{factorLabel}</em>
          </span>
          {levelLabels ? (
            <span className="text-slate-600 dark:text-slate-300">
              → {levelLabels}
            </span>
          ) : null}
          <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
            {r.source} · {r.status}
          </span>
        </div>
        <textarea
          className="w-full text-[11px] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 min-h-[2.5rem]"
          placeholder="Rationale"
          value={r.rationale}
          onChange={(e) => setRationale(r.id, e.target.value)}
        />
        <div className="flex items-center gap-2">
          {isPending ? (
            <>
              <button
                type="button"
                onClick={() => setStatus(r.id, "accepted")}
                className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setStatus(r.id, "rejected")}
                className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Reject
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setStatus(r.id, "agent_recommended")}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Revert to pending."
            >
              Undo ({r.status})
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 space-y-2">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        Subset recommendations
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        Subsetting is routine — accepted subsets propagate downstream
        (DEA, future agent runs). Factors whose coverage aligns with
        an accepted subset are NOT split flags.
      </div>
      {pending.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            Pending ({pending.length})
          </div>
          {pending.map(renderCard)}
        </div>
      ) : null}
      {accepted.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            Accepted ({accepted.length})
          </div>
          {accepted.map(renderCard)}
        </div>
      ) : null}
      {rejected.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-500">
            Rejected ({rejected.length})
          </div>
          {rejected.map(renderCard)}
        </div>
      ) : null}
    </div>
  );
}
