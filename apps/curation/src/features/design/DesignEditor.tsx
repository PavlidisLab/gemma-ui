import { useEffect, useMemo, useState } from "react";
import { useSessionState } from "@/lib/useStickyState";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { ContinuousFactorView } from "./ContinuousFactorView";
import { FactorList } from "./FactorList";
import { FactorValueList } from "./FactorValueList";
import { originalValuesByFv } from "./originalValue";
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
import {
  countRejectedSubsets,
  isInEffect,
  isRejected,
  proposedSubsets,
  recordedSubsets,
  resolveSubset,
  sourceChip,
  subsetFactorLabel,
  subsetsWantAttention,
  summariseSplit,
  summariseSubsets,
  tierMetaOf,
  tierTitle,
} from "./subsetRecommendations";
import { capitalizeCategory } from "@/lib/ontologyTerm";
import type {
  Design, Factor, Statement, SubsetRecommendation,
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
}: {
  experimentId: number | string;
}) {
  const live = useDesignDraft();
  const saved = live.saved;
  const diff = live.diff;
  const apply = live.apply;
  const isLoading = live.isLoading;
  const loadError = live.loadError;
  // The tab always renders the live editable draft so accepted edits
  // are visible. A chip baseline is carried as the draft's seed in
  // ``DesignDraftContext`` (and surfaces as amber diffs) — there's no
  // separate frozen-snapshot view to swap in.
  const draft = live.draft;

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

  // Perfect-duplicate factor detection (design review 2026-06-14): equality
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
      const resolveFactor = (sl: string, discriminatorId?: number) => {
        if (!draft) return undefined;
        const asInt = Number.parseInt(sl, 10);
        if (Number.isFinite(asInt)) {
          const byId = draft.factors.find((f) => f.id === asInt);
          if (byId) return byId;
        }
        const candidates = draft.factors.filter(
          (f) => slug(f.category?.label || "") === sl,
        );
        if (candidates.length <= 1) return candidates[0];
        // Same-category collision (e.g. two `treatment` factors) — the
        // `#{id}` discriminator (real Factor.id) breaks the tie. Falls
        // back to the first match for legacy bare target_ids, matching
        // pre-discriminator behaviour.
        return (
          candidates.find((f) => f.id === discriminatorId) ?? candidates[0]
        );
      };
      if (parsed.kind === "factor") {
        const target = resolveFactor(parsed.factorSlug, parsed.factorId);
        if (target) setSelectedFactorId(target.id);
        requestAnimationFrame(() => {
          focusByAuditTarget(targetId);
        });
        return;
      }
      if (parsed.kind === "fv") {
        const target = resolveFactor(parsed.factorSlug, parsed.fvId);
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
  // FactorValueList suppresses the subtitle row in that case.
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

  // What the submitter wrote for each value, from the characteristic
  // column this factor answers to. Computed here rather than in the
  // list or the card so both stay renderable without a draft — and
  // memoised on the factor, because it walks every biomaterial.
  const originalValues = useMemo(() => {
    if (!selectedFactor || !draft) return undefined;
    return originalValuesByFv(selectedFactor, draft.biomaterials);
  }, [selectedFactor, draft]);

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
              viewing this baseline is locked. Only the current
              curation is editable.
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
          <ContinuousFactorView
            factor={selectedFactor}
            onNameChange={(name) =>
              apply(setFactorFields(draft, selectedFactor.id, { name }))
            }
          />
        ) : (
          <>
            <FactorValueList
              factor={selectedFactor}
              factorDescription={factorDescription}
              totalBiomaterials={draft.biomaterials.length}
              originalValues={originalValues}
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

  // What the collapsed header says. The pane used to read only the
  // split field, so it said "none recorded" over a live Gemma subset
  // recommendation — which is the state 69 of 500 experiments are in,
  // and the reviewer had to open the pane to find out. Paul,
  // 2026-08-20: if a recommendation is active it belongs in the
  // unexpanded area.
  const splitSummary = summariseSplit(draft);
  const subsetSummary = summariseSubsets(draft);
  // A rejection counts as recorded even though it is not in effect —
  // otherwise the header says "none recorded" over the curator's own
  // no-vote and the pane collapses on the one state where the only
  // control that undoes it is inside.
  const rejectedCount = countRejectedSubsets(draft);
  const anythingRecorded =
    !!splitSummary || !!subsetSummary || rejectedCount > 0;
  // 🛑 Recorded is not the same as needs-you. 63 of the 69 seeded
  // recommendations are tier-2 `convention` — routine policy Paul has
  // said should be "a NOTICE at most" — so auto-opening a tall pane for
  // one is the panel shouting a fact nobody asked for. That is what
  // made this "very large and confusing". Open for a split decision or
  // a `qa` / `two_in_one` tier; otherwise the summary chip carries it,
  // which is what Paul asked for in the first place: if a
  // recommendation is active, show it in the UNEXPANDED area.
  const openOnArrival = !!splitSummary || subsetsWantAttention(draft);

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
      open={openOnArrival}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2 flex-wrap">
        <span>Experiment-wide decisions</span>
        {splitSummary ? (
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 px-2 py-0.5">
            {splitSummary}
          </span>
        ) : null}
        {/* Slate, not amber: a subset in effect is the normal state of
            an experiment, not an alarm. 64 of the 69 seeded ones are
            tier-2 convention. */}
        {subsetSummary ? (
          <span className="text-[10px] uppercase tracking-wide rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200 px-2 py-0.5">
            {subsetSummary}
          </span>
        ) : null}
        {rejectedCount > 0 ? (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {rejectedCount} subset{rejectedCount === 1 ? "" : "s"} rejected
          </span>
        ) : null}
        {anythingRecorded ? null : (
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
        {/* Only once there is a decision to explain. A disabled box
            whose placeholder says "select a decision above" is ~90px of
            control the curator cannot use, and it was the tallest thing
            left in the pane. */}
        {decisionMade ? (
          <textarea
            className="w-full text-[12px] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 min-h-[3.5rem]"
            placeholder="Rationale (optional): why this split / no-split?"
            value={rationale}
            onChange={(e) => setFields(factorId, e.target.value)}
          />
        ) : null}

        <SubsetRecommendationsBlock
          draft={draft}
          readOnly={readOnly}
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
 *  kind ``dea_subset`` / ``factor_partial_coverage``. It rides the
 *  design PUT and lands in the store's design row (server model
 *  ``local_api/design_schemas.py``), so a decision recorded here
 *  survives the commit.
 *
 *  🛑 The curator can ORIGINATE one, not just disposition the agent's.
 *  The type carried ``source: "curator"`` from the start and nothing
 *  could produce it: with an empty list this block said "the agent
 *  will seed any recommendations here on next import", which tells a
 *  curator who has already decided to subset by a factor to go wait
 *  for a machine. Subset-DEA is a curation decision; the agent's
 *  version of it is a suggestion.
 */
function SubsetRecommendationsBlock({
  draft,
  readOnly,
  onApply,
}: {
  draft: Design;
  readOnly: boolean;
  onApply: (next: Design | ((d: Design) => Design)) => void;
}) {
  // 🛑 The RECORD, not everything on the design. Agent rows are being
  // reviewed on the proposal panel (Paul, 2026-08-20: "these should be
  // in the proposal panel on the right, if they are coming from a
  // proposal") — they come back here only once rejected, because a
  // rejection is a decision and decisions belong in the decisions pane.
  const recs = recordedSubsets(draft);
  const proposedElsewhere = proposedSubsets(draft).length;
  // Two buckets, not three. There was a "Pending" bucket sitting above
  // an "Accepted" one, which is the shape of a queue the curator has to
  // work through — and this is not one. Paul, 2026-08-20: "the default
  // is to accept it unless you disagree". A recommendation is in effect
  // from the moment it arrives; the only thing that moves it out of
  // this list is the curator rejecting it.
  const inEffect = recs.filter(isInEffect);
  const rejected = recs.filter(isRejected);

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

  /** Record "subset the DEA by this factor" as the curator's own
   *  decision. Accepted on arrival — the curator asserting it IS the
   *  disposition, and a pending entry would be the panel asking them
   *  to agree with themselves.
   *
   *  ``level_labels`` stays empty, which the cards read as every level
   *  of the factor: that IS subset-DEA (one analysis per level), and
   *  it's the same shape the agent seeds. Narrowing to specific levels
   *  is the restriction case and has no editor yet. */
  const addCuratorSubset = (factorId: number) => {
    onApply((d) => {
      const existing = d.subset_recommendations ?? [];
      // ``id`` is the identity everything else keys on — status
      // changes, the diff, the agent's own entries. Derive it from
      // the factor plus a counter so re-adding after a delete can't
      // collide with a row already in the list.
      let n = 1;
      const idFor = () => `curator:subset:${factorId}:${n}`;
      while (existing.some((r) => r.id === idFor())) n++;
      return {
        ...d,
        subset_recommendations: [
          ...existing,
          {
            id: idFor(),
            by_factor_id: factorId,
            level_labels: [],
            rationale: "",
            status: "accepted" as const,
            source: "curator" as const,
          },
        ],
      };
    });
  };

  /** Drop a curator-authored entry outright. An agent's entry gets
   *  rejected instead — the no-vote is the record that the suggestion
   *  was seen and declined. There is nothing to record about a
   *  decision the curator made and then unmade. */
  const removeRec = (id: string) => {
    onApply((d) => ({
      ...d,
      subset_recommendations: (d.subset_recommendations ?? []).filter(
        (r) => r.id !== id,
      ),
    }));
  };

  /** One line, not a second copy of the cards. The agent's rows are
   *  reviewed on the proposal panel; hiding them here without saying so
   *  would be a curator wondering where a recommendation went. */
  const proposedHint =
    proposedElsewhere > 0 ? (
      <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
        {proposedElsewhere} more proposed by the agent — review{" "}
        {proposedElsewhere === 1 ? "it" : "them"} in the proposal panel.
      </div>
    ) : null;

  const addControl = (
    <AddSubsetControl
      factors={draft.factors ?? []}
      taken={
        new Set(
          recs
            .filter((r) => r.status !== "rejected" && r.by_factor_id != null)
            .map((r) => r.by_factor_id as number),
        )
      }
      readOnly={readOnly}
      onAdd={addCuratorSubset}
    />
  );

  if (recs.length === 0) {
    return (
      <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 space-y-2">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          Subset recommendations
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          None recorded. Gemma's own analysis structure seeds DEA-subset
          recommendations here on import — or record your own.
        </div>
        {proposedHint}
        {addControl}
      </div>
    );
  }

  const renderCard = (r: SubsetRecommendation) => {
    const { factor, stale, matchedLevels, driftedLevels } = resolveSubset(
      r,
      draft,
    );
    const axis = subsetFactorLabel(r, draft);
    const tier = tierMetaOf(r);
    const rejected = isRejected(r);
    // Three states, three tints, and none of them is an alarm. A subset
    // in effect is the ordinary condition of an experiment.
    const accent = stale
      ? "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 opacity-60"
      : rejected
        ? "border-slate-400 bg-slate-100 dark:bg-slate-900/40 opacity-70"
        : "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20";

    // ONE prose line, not two. A convention-tier Gemma row said "cell
    // type, 2 levels" three times over — in the header, in
    // `tier_evidence`, and again in `rationale` — which is most of what
    // made the pane unreadable. The tier's own sentence leads because
    // it explains the judgement; the other stays reachable on hover
    // rather than being dropped, because neither is ours to discard.
    const evidence = (r.tier_evidence ?? "").trim();
    const rationale = (r.rationale ?? "").trim();
    const lead = evidence || rationale;
    const alsoSaid = evidence && rationale ? rationale : undefined;

    return (
      <div
        key={r.id}
        className={`rounded border ${accent} px-2 py-1.5 text-[11px] space-y-1`}
      >
        <div className="flex items-center gap-1 flex-wrap">
          {/* A row that names no axis is a NOTE, not a subset. Saying
              "Subset by (no factor) → every level (DEA per level)"
              claimed a DEA per level of nothing. */}
          {axis ? (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Subset by <em>{axis}</em>
            </span>
          ) : (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Analysis note
            </span>
          )}
          {axis && matchedLevels.length > 0 ? (
            <span className="text-slate-600 dark:text-slate-300">
              → {matchedLevels.map((fv) => fv.free_text_label).join(", ")}
            </span>
          ) : axis && (r.level_labels ?? []).length === 0 ? (
            // Empty level_labels means the whole factor is the axis —
            // DEA runs once per level. Only true of a row that HAS an
            // axis.
            <span className="text-slate-500 dark:text-slate-400">
              → every level
            </span>
          ) : null}
          {tier ? (
            <span
              className="text-[10px] uppercase tracking-wide rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200 px-1.5 py-0.5"
              title={tierTitle(r)}
            >
              {tier.label}
            </span>
          ) : null}
          <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
            {sourceChip(r)}
          </span>
        </div>
        {/* 🛑 Stale is EXPECTED. Paul, 2026-08-20: "our polishing will
            cause this. it's okay." So it says the recommendation no
            longer applies and stops offering it — no warning colour,
            nothing to resolve, no ask. */}
        {stale ? (
          <div className="text-[10px] italic text-slate-500 dark:text-slate-400">
            No longer applies — the factor this described has been
            changed or removed since it was recorded.
          </div>
        ) : null}
        {!stale && factor === null && axis ? (
          <div className="text-[10px] italic text-slate-500 dark:text-slate-400">
            Not yet a factor in this design — the rationale is the only
            anchor.
          </div>
        ) : null}
        {/* Levels corroborate, they never condemn (cab, 2026-08-20):
            factor identity decides whether this still applies, and a
            URI-grounded level the factor no longer carries is worth
            saying and nothing more. */}
        {driftedLevels.length > 0 ? (
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Levels this factor no longer carries:{" "}
            {driftedLevels.join(", ")}
          </div>
        ) : null}
        {/* 🛑 The agent's and Gemma's words are THEIRS. Read-only —
            an editable box over them invites the curator to overwrite
            the record of what was actually said, and it was the single
            biggest thing on the card. The curator's own row keeps its
            editor. */}
        {r.source === "curator" ? (
          <textarea
            className="w-full text-[11px] border border-slate-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 min-h-[2.5rem] disabled:opacity-60"
            placeholder={readOnly ? "" : "Rationale"}
            value={r.rationale}
            disabled={readOnly}
            onChange={(e) => setRationale(r.id, e.target.value)}
          />
        ) : lead ? (
          <div
            className="text-[10px] text-slate-600 dark:text-slate-300"
            title={alsoSaid}
          >
            {lead}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {r.source === "curator" ? (
            // The curator's own entry has no suggestion behind it to
            // revert TO — a "reject" would mean declining a proposal
            // that never happened. Removing it is the undo.
            <button
              type="button"
              disabled={readOnly}
              onClick={() => removeRec(r.id)}
              className="text-[11px] px-2 py-0.5 rounded border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-900/30"
              title="Remove this subset decision — it was yours, not a suggestion to decline."
            >
              Remove
            </button>
          ) : rejected ? (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setStatus(r.id, "agent_recommended")}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Put this recommendation back in effect."
            >
              Undo reject
            </button>
          ) : (
            // 🛑 Reject is the ONLY affordance. Accepting is what
            // happens by default, so an Accept here would ask the
            // curator to agree with a decision already in force.
            <button
              type="button"
              disabled={readOnly || stale}
              onClick={() => setStatus(r.id, "rejected")}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title={
                stale
                  ? "Already out of effect — the factor it described is gone."
                  : "In effect by default. Reject if you disagree."
              }
            >
              Reject
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
        Subsetting is routine, and these are in effect unless you
        reject them. They propagate downstream (DEA, future agent
        runs); factors whose coverage aligns with one are NOT split
        flags.
      </div>
      {inEffect.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            In effect ({inEffect.length})
          </div>
          {inEffect.map(renderCard)}
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
      {proposedHint}
      {addControl}
    </div>
  );
}

/** "Subset DEA by …" — pick a factor, record the decision.
 *
 *  A ``<select>`` over the design's own factors rather than free
 *  text: the entry is keyed by ``by_factor_id``, so a name typed by
 *  hand would produce a decision that points at nothing downstream.
 *  Factors already carrying a non-rejected entry drop out of the
 *  list — a second identical decision says nothing the first didn't,
 *  and two cards for one factor is how a disposition surface starts
 *  disagreeing with itself.
 */
function AddSubsetControl({
  factors,
  taken,
  readOnly,
  onAdd,
}: {
  factors: Factor[];
  /** Factor ids already carrying a live (non-rejected) entry. */
  taken: Set<number>;
  readOnly: boolean;
  onAdd: (factorId: number) => void;
}) {
  const [choice, setChoice] = useState<string>("");
  if (readOnly) return null;
  const available = factors.filter((f) => !taken.has(f.id));
  if (factors.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
        No factors yet — a subset decision names the factor it subsets
        by.
      </div>
    );
  }
  if (available.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[11px] text-slate-600 dark:text-slate-300">
        Subset DEA by
      </label>
      <select
        className="text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="">select a factor…</option>
        {available.map((f) => (
          <option key={f.id} value={String(f.id)}>
            {f.name || f.category?.label || `factor ${f.id}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!choice}
        className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title="Record that the DEA should be run subset by this factor. Saves with the design."
        onClick={() => {
          const id = Number(choice);
          if (!Number.isFinite(id)) return;
          onAdd(id);
          setChoice("");
        }}
      >
        + Record
      </button>
    </div>
  );
}
