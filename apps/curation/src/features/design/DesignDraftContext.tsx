import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDesign, useUpdateDesign, useUpdatePolished } from "@/api/design";
import { diffDesign, type DesignDiff } from "./diff";
import type { Design } from "@/features/experiment/types";
import { useCurations } from "@/features/comparison/useSourceAvailability";
import type { Source } from "@/features/comparison/sources";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import {
  clearAllProposalStateForExperiment,
  notifyProposalStateReset,
} from "@/features/proposal/proposalDispositions";

/**
 * Make sure every Statement carries a category before round-tripping
 * to Gemma. Real Gemma's model requires `Statement.category`; ours
 * keeps it optional in the schema for editing convenience, but the
 * server-side write must not lose it. Fill in from the parent
 * factor's category when the statement's own is absent.
 */
function normalizeForCommit(design: Design): Design {
  return {
    ...design,
    factors: design.factors.map((f) => ({
      ...f,
      factor_values: f.factor_values.map((fv) => ({
        ...fv,
        statements: fv.statements.map((s) =>
          s.category ? s : { ...s, category: f.category ? { ...f.category } : null },
        ),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// localStorage persistence
//
// The cache primitives (read / write / clear / hash) live in
// ``./draftCache.ts`` so they sit in ONE place — list views (set
// navigator dots, workflow page) reuse them without mounting this
// provider, and the ticket export / close surfaces reconcile against
// them. This provider is the full write path (undo/redo/commit) built
// on top.
import {
  clearCachedDraft,
  hashDesign,
  readCachedDraft,
  writeCachedDraft,
} from "./draftCache";

/** Outcome of a {@link DesignDraftValue.commit} call, for callers
 *  that need to chain a follow-up action on success. */
export type CommitResult = { ok: true } | { ok: false; error: string };

/**
 * Shared draft buffer for the experiment's Design.
 *
 * Why this exists: every tab that edits the Design (DesignEditor,
 * TagsPanel — eventually Notes, etc.) needs to operate on the same
 * uncommitted draft so a curator can switch between tabs mid-edit
 * without losing work. Per-panel local state would re-init from the
 * server-saved copy each time a tab mounts.
 *
 * The provider also owns the commit/discard plumbing so the
 * `<CommitBar/>` can live at a fixed location (App-level footer)
 * rather than being duplicated per tab.
 */
export interface DesignDraftValue {
  saved: Design | null;
  draft: Design | null;
  diff: DesignDiff;
  /**
   * Commit a new draft. Either pass the full ``Design`` directly, or
   * a reducer ``(current) => next`` to compose against the *current*
   * draft inside React's setState batch — the form bulk callers
   * need so chained edits don't clobber each other (otherwise each
   * call would close over a stale ``draft``).
   */
  apply: (next: Design | ((current: Design) => Design)) => void;
  /**
   * Commit the draft. Pass ``onSettled`` when a caller needs to know
   * the outcome (e.g. "commit, then do X on success") — invoked once
   * both the /design PUT and the /polished mirror have landed (or
   * either has failed). Optional and fire-and-forget when omitted;
   * ``saving``/``saveError`` above remain the reactive source of
   * truth for CommitBar-style UI.
   */
  commit: (onSettled?: (result: CommitResult) => void) => void;
  discard: () => void;
  /** Pop the last ``apply()`` off the undo stack and restore the
   *  prior draft. Bound to Cmd+Z / Ctrl+Z by the App-level
   *  KeyboardShortcuts component. No-op when ``canUndo`` is false.
   *  Design review 2026-06-14: "how about binding undo key to last action". */
  undo: () => void;
  /** Re-apply the last undone state. Bound to Cmd+Shift+Z / Ctrl+Y.
   *  No-op when ``canRedo`` is false (the redo stack clears on every
   *  fresh ``apply()`` so the curator can't redo into a stale branch). */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Force-reload the draft from the next ``saved`` refetch.
   *  Clears the localStorage cache + nulls the in-memory draft so
   *  the loader effect re-seeds from server. Used by destructive
   *  flows (e.g. the "Reset experiment" affordance) where the
   *  background-refetch sync's clean-draft heuristic would
   *  otherwise leave stale state in place. */
  reload: () => void;
  saving: boolean;
  saveError: string | null;
  isLoading: boolean;
  loadError: string | null;
  /** True when a localStorage-cached draft was discarded on mount
   *  because the server's saved Design moved on while the curator
   *  was away. UI surfaces this as a "we discarded a stale draft"
   *  notice so the curator knows. */
  staleCacheDiscarded: boolean;
  /** True when ``saved`` was sourced from the chip-strip baseline
   *  curation (the unified /curations row) rather than the local
   *  /datasets/{id}/design endpoint. Drives edit-gating: edits
   *  always write back to /design, so showing the curator a
   *  non-local baseline + letting them edit would silently
   *  overwrite the local pack with the baseline's content + the
   *  edits. Per design review 2026-06-08 ("for comparing we can do what we
   *  want, but we have to be careful about what we are editing"). */
  usingBaseline: boolean;
  /** When ``usingBaseline`` is true: the source_kind of the
   *  curation row the page is rendered against ("live" /
   *  "preboard" / "consensus" / "curator_polish" / "agent_proposal").
   *  Null when ``usingBaseline`` is false. Used by ``useIsReadOnly``
   *  to decide whether the baseline is editable in the local
   *  /design model. */
  baselineSourceKind: string | null;
  /** When ``usingBaseline`` is true: the human-facing label of the
   *  curation row (e.g. "Live Gemma" / "consensus:strict_cy_am").
   *  Surfaced in the read-only banner so the curator knows why
   *  editing is locked. */
  baselineLabel: string | null;
}

// Exported so render-time tests can wrap with a stub draft value
// instead of booting the full ``DesignDraftProvider`` (which hits
// the live design API). Production path still goes through the
// provider; this is purely a test affordance.
export const DesignDraftContext = createContext<DesignDraftValue | null>(null);

const EMPTY_DIFF: DesignDiff = {
  isDirty: false,
  factorsAdded: [],
  factorsRemoved: [],
  factorsChanged: [],
  tags: { added: [], removed: [], modified: [] },
  metadata: {
    biomaterialsModified: 0,
    publicationsAdded: 0,
    publicationsRemoved: 0,
    shortNameChanged: false,
    titleChanged: false,
    descriptionChanged: false,
  },
  totals: {
    addedFvs: 0,
    removedFvs: 0,
    modifiedFvs: 0,
    addedFactors: 0,
    removedFactors: 0,
    factorFieldsChanged: 0,
    addedTags: 0,
    removedTags: 0,
    modifiedTags: 0,
  },
};

export function DesignDraftProvider({
  experimentId,
  reviewer = "",
  baselineSource,
  children,
}: {
  experimentId: number | string;
  reviewer?: string;
  /** Chip-strip baseline token. When set, the provider sources
   *  ``saved`` from the matching row in the unified /curations
   *  list — so the WHOLE PAGE reflects the chip selection, not
   *  just the audit-sidebar comparison cards. When unset (or no
   *  curation matches), falls back to ``useDesign(experimentId)``
   *  — the curator's editable local design (pre-step-3b behaviour).
   *
   *  Per design review 2026-06-08 ("yes everywhere"): the chip strip is the
   *  source of truth for what the page renders against. GSE93824
   *  showed the disconnect — live had 3 factors, the page showed
   *  2, because the main FactorList read from useDesign rather
   *  than from the unified /curations row the chip strip
   *  resolved to. */
  baselineSource?: Source;
  children: ReactNode;
}) {
  const localDesign = useDesign(experimentId);
  const curationsQuery = useCurations(experimentId);
  const curations = curationsQuery.data ?? [];
  const updater = useUpdateDesign(experimentId, reviewer);
  // Durable mirror: every commit also writes the curator's design to the
  // per-curator polished store, the one design store a calibration-batch
  // reload does not wipe (2026-07-18 reimport-persistence fix).
  const polisher = useUpdatePolished(experimentId, reviewer);

  // Resolve the chip baseline to a curation row (when one is set).
  // When the lookup hits, that row's design takes over from the
  // local /design endpoint — every consumer of useDesignDraft now
  // sees the chip-selected baseline.
  const baselineCuration = useMemo(
    () => (baselineSource ? resolveCuration(baselineSource, curations) : null),
    [baselineSource, curations],
  );

  // The routed experiment id, coerced to a number once. The route is
  // the single authority for which experiment we're editing.
  const routeEidNumeric = useMemo(
    () =>
      typeof experimentId === "number"
        ? experimentId
        : Number.parseInt(String(experimentId), 10),
    [experimentId],
  );

  const savedFromBaseline = useMemo<Design | null>(() => {
    if (!baselineCuration) return null;
    const d = baselineCuration.design as unknown as Design | undefined;
    if (!d || typeof d !== "object") return null;
    // The /curations response is auto-snakeified by the API client,
    // so the shape lines up with the Design type already.
    //
    // The ROUTE is authoritative for experiment_id. A baseline payload
    // that carries a *different* experiment_id is a cross-experiment
    // buffer leak (editing GSE253365/91654 saw GSE248901/38401 sticking
    // onto the buffer because the old `??` kept the foreign payload id
    // and only fell back to the route).
    // Stamp the routed id unconditionally; the only thing the payload's
    // own id is good for is detecting+logging the mismatch.
    const routeEid = Number.isFinite(routeEidNumeric) ? routeEidNumeric : null;
    if (
      routeEid != null &&
      d.experiment_id != null &&
      d.experiment_id !== routeEid
    ) {
      console.warn(
        `[DesignDraft] baseline payload experiment_id=${d.experiment_id} ` +
          `≠ route experiment_id=${routeEid}; stamping route id ` +
          `(baselineSource=${baselineSource ?? "?"}, ` +
          `source_kind=${baselineCuration.source_kind ?? "?"}).`,
      );
    }
    return {
      ...d,
      experiment_id: routeEid ?? (d as Design).experiment_id,
    };
  }, [baselineCuration, baselineSource, routeEidNumeric]);

  // Editable baseline kinds — the chip targets a curation row whose
  // payload is, by convention, a snapshot of the local /design at
  // pack-import time. PUT /design is the canonical write surface;
  // the curation row is a frozen view created by setup.py.
  const _EDITABLE_KINDS = new Set(["consensus", "curator_polish"]);
  const usingBaseline = savedFromBaseline !== null;
  const baselineIsEditable =
    usingBaseline &&
    !!(baselineCuration?.source_kind &&
       _EDITABLE_KINDS.has(baselineCuration.source_kind));

  // Effective saved design.
  //
  // - Non-editable chip baseline (live / preboard / agent_proposal /
  //   curator_polish for another curator): ``saved`` reads from the
  //   curation row payload. The page renders against a frozen
  //   snapshot — read-only by ``useIsReadOnly``.
  // - Editable chip baseline (consensus / curator_polish for *this*
  //   curator) OR no chip baseline at all: ``saved`` reads from
  //   ``/design``. The chip is a NAMED VIEW of /design content,
  //   initialized equal at pack-import time, and the curator's
  //   commits update /design — so the saved-state must track /design,
  //   not the frozen curation-row snapshot. Without this, after a
  //   successful commit the curation row stays stale, ``diff`` stays
  //   dirty against the snapshot, and the CommitBar never clears.
  const saved =
    usingBaseline && !baselineIsEditable
      ? savedFromBaseline
      : localDesign.data;
  const isLoading =
    usingBaseline && !baselineIsEditable
      ? curationsQuery.isLoading
      : localDesign.isLoading;
  const error =
    usingBaseline && !baselineIsEditable
      ? (curationsQuery.error as Error | null)
      : localDesign.error;

  // The provider-side write gate (``providerReadOnly``) was dropped
  // 2026-06-14 — the reviewer: "the baseline has to always be editable."
  // ``apply()`` already always-applies (the 2026-06-13 fix);
  // ``commit()`` no longer refuses on a frozen baseline either.
  // ``useIsReadOnly()`` remains as a UI-side hint surface but the
  // provider itself no longer enforces a write block.


  const [draft, setDraft] = useState<Design | null>(null);
  const [staleCacheDiscarded, setStaleCacheDiscarded] = useState(false);
  // Set when the server-saved Design we were about to seed the buffer
  // with belongs to a *different* experiment than the route. We refuse
  // to seed in that case rather than silently let the curator edit the
  // wrong dataset. Surfaced through
  // ``loadError`` so the page shows an error instead of an editable
  // foreign design.
  const [seedMismatchError, setSeedMismatchError] = useState<string | null>(
    null,
  );
  // Undo / redo stacks for the design draft. Snapshot-based:
  // every ``apply()`` pushes the *prior* draft onto undoStack and
  // clears redoStack (so a fresh edit invalidates any redo branch).
  // Undo pops undoStack onto redoStack and restores the popped
  // value as the live draft. Stack depth capped to MAX_UNDO so
  // long-running sessions don't grow without bound. ``commit()``
  // and ``discard()`` both clear both stacks — once the curator's
  // intent has been confirmed (or discarded outright), there's
  // nothing intermediate worth restoring.
  const MAX_UNDO = 50;
  const [undoStack, setUndoStack] = useState<Design[]>([]);
  const [redoStack, setRedoStack] = useState<Design[]>([]);
  // Remember the last `saved` value we observed so we can tell, when
  // it changes, whether the draft was clean against the previous
  // saved. The naive check (NEW saved vs current draft) wrongly
  // flags the draft as dirty whenever a re-import or background
  // refetch lands new server content — even if the user hasn't
  // touched anything.
  const prevSavedRef = useRef<Design | null>(null);

  // Initialize draft on first server load. On a fresh mount, prefer a
  // localStorage-cached draft IF its baseline hash matches the
  // current saved Design — meaning the curator left mid-edit and the
  // server hasn't moved on since. If the baseline drifted (someone
  // else committed, or the curator re-imported), we drop the cache
  // and reset draft = saved; surface `staleCacheDiscarded` so the UI
  // can tell the user.
  useEffect(() => {
    if (!saved) return;
    // Route-vs-buffer seed assertion. The route is authoritative; if
    // the server-saved Design resolves to a different experiment than
    // the one we're routed to, refuse to seed the editing buffer and
    // surface the mismatch. Without this the curator silently edits
    // (and tries to commit) the wrong dataset — the leak the backend
    // put_design guard caught at the very last moment. Only a concrete, differing id trips it;
    // a null/absent payload id is tolerated (older payloads omit it).
    if (
      Number.isFinite(routeEidNumeric) &&
      saved.experiment_id != null &&
      saved.experiment_id !== routeEidNumeric
    ) {
      setSeedMismatchError(
        `Refusing to edit: the loaded design is for experiment ` +
          `${saved.experiment_id} but this page is experiment ` +
          `${routeEidNumeric}. Reload the page to recover.`,
      );
      return;
    }
    if (seedMismatchError) setSeedMismatchError(null);
    if (draft === null) {
      const cached = readCachedDraft(experimentId);
      const currentHash = hashDesign(saved);
      if (cached && cached.baselineHash === currentHash) {
        setDraft(cached.draft);
      } else {
        if (cached) {
          // Baseline drift — drop the stale cache so we don't keep
          // restoring it on every reload.
          clearCachedDraft(experimentId);
          setStaleCacheDiscarded(true);
        }
        setDraft(saved);
      }
      prevSavedRef.current = saved;
      return;
    }
    // Background refetch: was the draft clean against the *previous*
    // saved? If yes, sync to the new saved. If the curator had real
    // pending edits, leave the draft alone — they'll see the diff
    // bar and choose whether to discard.
    const prevSaved = prevSavedRef.current;
    const wasClean = prevSaved
      ? !diffDesign(prevSaved, draft).isDirty
      : !diffDesign(saved, draft).isDirty;
    if (wasClean) {
      setDraft(saved);
    }
    prevSavedRef.current = saved;
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const diff = useMemo(
    () => (draft ? diffDesign(saved ?? null, draft) : EMPTY_DIFF),
    [saved, draft],
  );

  // Persist the draft on every change so a refresh doesn't lose
  // work. Skip when draft matches saved exactly (no point caching
  // a clean state) and when saved isn't loaded yet.
  useEffect(() => {
    if (!draft || !saved) return;
    if (!diffDesign(saved, draft).isDirty) {
      clearCachedDraft(experimentId);
      return;
    }
    writeCachedDraft(experimentId, hashDesign(saved), draft);
  }, [draft, saved, experimentId]);

  const apply = useCallback(
    (next: Design | ((current: Design) => Design)) => {
      // Block draft mutations while a commit is in-flight. Without
      // this, a keystroke landing between the curator's "commit"
      // click and the server response gets clobbered by
      // ``setDraft(server)`` in the commit's onSuccess. Consumers
      // can read ``saving`` from the context to disable inputs and
      // surface the saving state to the curator.
      if (updater.isPending) return;
      // Earlier (2026-06-08) this branch silently dropped apply() when
      // ``providerReadOnly`` fired. That created the bug the reviewer reported
      // 2026-06-13: deleting a factor while viewing a non-editable
      // baseline (Live Gemma / preboard / agent_proposal) did nothing,
      // the dirty flag never flipped, dependent surfaces (sample
      // table) kept showing the deleted factor. The silent drop was
      // out of sync with ``useIsReadOnly()`` (which returns ``false``
      // unconditionally since 2026-06-12), so consumers happily fired
      // the click and the mutation vanished.
      //
      // New posture: ALWAYS apply locally. Edits to the local draft
      // are in-memory; they can't hurt anything until commit. The
      // silent-overwrite concern from 2026-06-08 (committing a draft
      // built from a baseline snapshot would overwrite /design) is
      // handled at the commit() boundary, where we now toast instead
      // of dropping.
      if (typeof next === "function") {
        // Functional form: compose against the *current* draft inside
        // React's setState batch. This is what bulk callers use so
        // that a loop of `apply((d) => mutate(d, ...))` chains
        // correctly — the value form would close over a stale draft
        // and only the last write would survive.
        setDraft((current) => {
          if (!current) return null;
          // Push the PRIOR draft onto the undo stack so Cmd+Z can
          // restore it. Identity-equal shortcut so an apply() that
          // returns the same object reference (e.g. a no-op reducer)
          // doesn't pollute the stack with phantom snapshots.
          const computed = next(current);
          if (computed !== current) {
            setUndoStack((s) => [...s, current].slice(-MAX_UNDO));
            setRedoStack([]);
          }
          return computed;
        });
      } else {
        setDraft((current) => {
          if (current && current !== next) {
            setUndoStack((s) => [...s, current].slice(-MAX_UNDO));
            setRedoStack([]);
          }
          return next;
        });
      }
      // Any user action acknowledges the stale-draft notice.
      setStaleCacheDiscarded(false);
    },
    [updater.isPending],
  );

  const undo = useCallback(() => {
    if (updater.isPending) return;
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prior = s[s.length - 1];
      setDraft((current) => {
        if (current) setRedoStack((r) => [...r, current].slice(-MAX_UNDO));
        return prior;
      });
      return s.slice(0, -1);
    });
  }, [updater.isPending]);

  const redo = useCallback(() => {
    if (updater.isPending) return;
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setDraft((current) => {
        if (current) setUndoStack((s) => [...s, current].slice(-MAX_UNDO));
        return next;
      });
      return r.slice(0, -1);
    });
  }, [updater.isPending]);
  const commit = useCallback((onSettled?: (result: CommitResult) => void) => {
    if (!draft) {
      onSettled?.({ ok: false, error: "No draft to commit" });
      return;
    }
    // No baseline-view commit gate. Originally a hard refusal, then
    // a danger toast, then a confirm dialog — every iteration
    // interacted badly with the close-review's dirty-draft guard:
    // dirty + viewing-a-baseline ⇒ can't commit, can't close,
    // curator stuck. Design review 2026-06-14: "the baseline has to always
    // be editable." The earlier "silent overwrite" concern from
    // 2026-06-08 is moot when the curator's intent is to commit
    // their own edits — that's the whole point of clicking Commit.
    // Just let it through.
    // Clean-checkpoint bookkeeping, run only once BOTH the /design PUT
    // and the durable /polished mirror have landed. Every prior
    // intermediate state is uninteresting after a full commit.
    const finalizeCheckpoint = (server: Design) => {
      setDraft(server);
      clearCachedDraft(experimentId);
      setUndoStack([]);
      setRedoStack([]);
      onSettled?.({ ok: true });
    };
    updater.mutate(normalizeForCommit(draft), {
      onSuccess: (server) => {
        // Durability: mirror the committed design into the per-curator
        // polished store so it survives a calibration-batch reload. This
        // is NOT fire-and-forget — the ticket exporter reads /polished
        // and prefers it over /design (``polished ?? design``,
        // exportTicket.ts), so a silently-failed mirror leaves a STALE
        // polished snapshot shadowing the fresh design: the curator's
        // accepted tag/factor vanishes from the export while the
        // disposition still reads accepted. On the flaky local store the
        // fire-and-forget write failed intermittently and dropped
        // finalized work. So we treat the mirror as part of
        // commit success: only checkpoint once it lands, and on failure
        // leave the draft DIRTY so CommitBar stays up with the error and
        // the curator retries until the export store is consistent. No
        // curator key ⇒ nothing to mirror, /design is the only store.
        if (!reviewer) {
          finalizeCheckpoint(server);
          return;
        }
        polisher.mutate(server, {
          onSuccess: () => finalizeCheckpoint(server),
          // onError: intentionally no checkpoint — the draft stays dirty,
          // ``saveError`` surfaces ``polisher.error`` via CommitBar, and
          // the curator re-commits. The /design PUT already succeeded, so
          // the retry re-PUTs the same design (idempotent) then re-mirrors.
          onError: (err) => {
            onSettled?.({ ok: false, error: (err as Error).message });
          },
        });
      },
      onError: (err) => {
        onSettled?.({ ok: false, error: (err as Error).message });
      },
    });
  }, [draft, updater, polisher, reviewer, experimentId]);
  const discard = useCallback(() => {
    setDraft(saved ?? null);
    setUndoStack([]);
    setRedoStack([]);
    clearCachedDraft(experimentId);
    // Roll the proposal-review surface back in lockstep with the
    // design draft — without this the Accept-all / per-element
    // retain/reject state on the proposal cards stayed "retained" /
    // "rejected" after the curator hit undo, leaving the cards
    // visually out of sync with the freshly-reset draft (the reviewer
    // 2026-06-10).
    clearAllProposalStateForExperiment(experimentId);
    notifyProposalStateReset(experimentId);
    // Per-experiment localStorage hygiene: clear the orphan keys
    // the 2026-06-13 continuity sweep identified. Each is a
    // best-effort try/catch so a SecurityError on a private-mode
    // tab doesn't break the discard. Other surfaces register their
    // own clear logic via the proposal-state-reset notifier above
    // (in-memory state); these are the LS-only side-effects that
    // weren't wired anywhere.
    try {
      window.localStorage.removeItem(`samples.colOrder.${experimentId}`);
      window.localStorage.removeItem(`audit.panelExpansion.audit.${experimentId}`);
      window.localStorage.removeItem(`audit.panelExpansion.proposal.${experimentId}`);
      window.localStorage.removeItem(`audit.driftDismiss.${experimentId}`);
      window.localStorage.removeItem(`notes:${experimentId}`);
    } catch {
      // ignore — best-effort, never fail discard
    }
    setStaleCacheDiscarded(false);
    updater.reset();
  }, [saved, updater, experimentId]);

  // Force-reload the draft from the next ``saved`` refetch. Used by
  // the "Reset experiment" affordance: the import endpoint replaces
  // the design server-side, the design query refetches via
  // ``invalidateQueries``, but the existing background-refetch
  // sync only updates the draft when the diff against the previous
  // saved was clean — uncommitted edits or a mid-edit reset would
  // leave the stale draft in place. This nukes the localStorage
  // cache + null-resets the draft so the loader effect re-seeds
  // from the freshly-fetched ``saved``.
  const reload = useCallback(() => {
    clearCachedDraft(experimentId);
    setDraft(null);
    prevSavedRef.current = null;
    setStaleCacheDiscarded(false);
    updater.reset();
  }, [experimentId, updater]);

  const value: DesignDraftValue = {
    saved: saved ?? null,
    draft,
    diff,
    apply,
    commit,
    discard,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    reload,
    saving: updater.isPending || polisher.isPending,
    // A failed durable-mirror (/polished) write is surfaced through the
    // same channel as a /design save failure so CommitBar stays up and
    // the curator retries — a stale polished snapshot would otherwise
    // silently shadow the fresh design at ticket-export time.
    saveError: updater.isError
      ? (updater.error as Error).message
      : polisher.isError
        ? "durable save to the export store failed — retry commit so " +
          "your accepted changes reach the ticket export."
        : null,
    isLoading,
    loadError: seedMismatchError ?? (error ? (error as Error).message : null),
    staleCacheDiscarded,
    usingBaseline,
    baselineSourceKind: baselineCuration?.source_kind ?? null,
    baselineLabel: baselineCuration?.label ?? null,
  };

  return (
    <DesignDraftContext.Provider value={value}>
      {children}
    </DesignDraftContext.Provider>
  );
}

export function useDesignDraft(): DesignDraftValue {
  const v = useContext(DesignDraftContext);
  if (!v) {
    throw new Error(
      "useDesignDraft must be used inside <DesignDraftProvider>",
    );
  }
  return v;
}
