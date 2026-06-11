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
import { useDesign, useUpdateDesign } from "@/api/design";
import { ApiError } from "@/api/client";
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
// Drafts survive a browser refresh. We key by experiment id and store the
// draft alongside a hash of the saved baseline at cache time — on restore,
// if the server's saved Design has moved on (someone else committed, or
// the curator re-imported), we treat the cache as stale and ignore it
// rather than diff against a baseline that no longer matches.
//
// ``DRAFT_KEY_PREFIX`` lives in ``./draftCache.ts`` so list-view
// components (set navigator dots, etc.) can scan dirty drafts
// without mounting the full provider.
import { DRAFT_KEY_PREFIX } from "./draftCache";

interface CachedDraft {
  baselineHash: string;
  cachedAt: string;
  draft: Design;
}

/** FNV-1a, 32-bit. Cheap and dependency-free; collisions don't matter
 *  here — we only use this to detect baseline changes, not for security. */
function hashDesign(d: Design | null | undefined): string {
  if (!d) return "";
  const s = JSON.stringify(d);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

function readCachedDraft(experimentId: number | string): CachedDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + experimentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    if (!parsed.draft || !parsed.baselineHash) return null;
    // Reject entries where the cached draft is for a different
    // experiment than the key. Pre-2c14caf, the provider could swap
    // experimentId without unmounting, and the persist effect would
    // write the previous experiment's draft under the new key. The
    // baselineHash check on rehydrate doesn't catch it (the hash is
    // of the *new* saved at write-time, not of the draft).
    if (
      parsed.draft.experiment_id != null &&
      parsed.draft.experiment_id !== experimentId
    ) {
      window.localStorage.removeItem(DRAFT_KEY_PREFIX + experimentId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedDraft(
  experimentId: number | string,
  baselineHash: string,
  draft: Design,
): void {
  try {
    const payload: CachedDraft = {
      baselineHash,
      cachedAt: new Date().toISOString(),
      draft,
    };
    window.localStorage.setItem(
      DRAFT_KEY_PREFIX + experimentId,
      JSON.stringify(payload),
    );
  } catch {
    // Quota / privacy mode / SSR — survivable, the in-memory draft
    // still works as before.
  }
}

function clearCachedDraft(experimentId: number | string): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + experimentId);
  } catch {
    // ignore
  }
}

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
  commit: () => void;
  discard: () => void;
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
   *  edits. Per Paul 2026-06-08 ("for comparing we can do what we
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

const DesignDraftContext = createContext<DesignDraftValue | null>(null);

const EMPTY_DIFF: DesignDiff = {
  isDirty: false,
  factorsAdded: [],
  factorsRemoved: [],
  factorsChanged: [],
  tags: { added: [], removed: [], modified: [] },
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
   *  Per Paul 2026-06-08 ("yes everywhere"): the chip strip is the
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

  // Resolve the chip baseline to a curation row (when one is set).
  // When the lookup hits, that row's design takes over from the
  // local /design endpoint — every consumer of useDesignDraft now
  // sees the chip-selected baseline.
  const baselineCuration = useMemo(
    () => (baselineSource ? resolveCuration(baselineSource, curations) : null),
    [baselineSource, curations],
  );

  const savedFromBaseline = useMemo<Design | null>(() => {
    if (!baselineCuration) return null;
    const d = baselineCuration.design as unknown as Design | undefined;
    if (!d || typeof d !== "object") return null;
    // The /curations response is auto-snakeified by the API
    // client, so the shape lines up with the Design type already.
    // Inject experiment_id when the row's design payload omits
    // it (older agent-proposal payloads sometimes do).
    const eidNumeric = typeof experimentId === "number"
      ? experimentId
      : Number.parseInt(String(experimentId), 10);
    return {
      ...d,
      experiment_id: d.experiment_id ?? (Number.isFinite(eidNumeric) ? eidNumeric : (d as Design).experiment_id),
    };
  }, [baselineCuration, experimentId]);

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

  // Defensive write gate. Mirrors useIsReadOnly's rule (edits are
  // only safe when the page's saved-state is rooted in the local
  // /design target). Duplicated here so the provider's own commit/
  // apply paths refuse writes regardless of whether the UI
  // components honor useIsReadOnly. Cheaper than auditing every
  // input for a disabled prop.
  const providerReadOnly = usingBaseline && !baselineIsEditable;

  const [draft, setDraft] = useState<Design | null>(null);
  const [staleCacheDiscarded, setStaleCacheDiscarded] = useState(false);
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
      // Defensive read-only gate (see providerReadOnly above): when
      // the page is rendering against a non-local baseline (Live
      // Gemma / preboard / agent proposal), apply is a no-op so
      // stray edits from non-honoring consumers can't accumulate.
      if (providerReadOnly) return;
      if (typeof next === "function") {
        // Functional form: compose against the *current* draft inside
        // React's setState batch. This is what bulk callers use so
        // that a loop of `apply((d) => mutate(d, ...))` chains
        // correctly — the value form would close over a stale draft
        // and only the last write would survive.
        setDraft((current) => (current ? next(current) : null));
      } else {
        setDraft(next);
      }
      // Any user action acknowledges the stale-draft notice.
      setStaleCacheDiscarded(false);
    },
    [updater.isPending, providerReadOnly],
  );
  const commit = useCallback(() => {
    if (!draft) return;
    // Defensive: never POST writes against /design when the page is
    // viewing a non-local baseline. A commit here would overwrite
    // the local pack's design with the baseline content + any stray
    // edits — exactly the silent-clobber scenario Paul flagged
    // 2026-06-08 ("we have to be careful about what we are editing").
    if (providerReadOnly) return;
    updater.mutate(normalizeForCommit(draft), {
      onSuccess: (server) => {
        setDraft(server);
        clearCachedDraft(experimentId);
      },
    });
  }, [draft, updater, experimentId, providerReadOnly]);
  const discard = useCallback(() => {
    setDraft(saved ?? null);
    clearCachedDraft(experimentId);
    // Roll the proposal-review surface back in lockstep with the
    // design draft — without this the Accept-all / per-element
    // retain/reject state on the proposal cards stayed "retained" /
    // "rejected" after the curator hit undo, leaving the cards
    // visually out of sync with the freshly-reset draft (Paul
    // 2026-06-10).
    clearAllProposalStateForExperiment(experimentId);
    notifyProposalStateReset(experimentId);
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
    reload,
    saving: updater.isPending,
    saveError: updater.isError ? (updater.error as Error).message : null,
    isLoading,
    loadError: error ? (error as Error).message : null,
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

/** True when the load error indicates the experiment isn't in
 *  storage (404). Lets the UI show a "import this" prompt instead
 *  of a generic error.
 *
 *  Accepts either the raw error (preferred — uses ``ApiError.status``
 *  cleanly) or the legacy string message form (regex on
 *  ``"failed: 404 ..."`` for backwards compatibility with callers
 *  that already destructure ``loadError`` as a string). */
export function isNotImportedError(
  err: unknown | string | null,
): boolean {
  if (!err) return false;
  if (err instanceof ApiError) return err.status === 404;
  if (typeof err === "string") return /\b404\b/.test(err);
  return false;
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
