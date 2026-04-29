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

const DRAFT_KEY_PREFIX = "gca:draft:";

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

function readCachedDraft(experimentId: number): CachedDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + experimentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    if (!parsed.draft || !parsed.baselineHash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedDraft(
  experimentId: number,
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

function clearCachedDraft(experimentId: number): void {
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
  saving: boolean;
  saveError: string | null;
  isLoading: boolean;
  loadError: string | null;
  /** True when a localStorage-cached draft was discarded on mount
   *  because the server's saved Design moved on while the curator
   *  was away. UI surfaces this as a "we discarded a stale draft"
   *  notice so the curator knows. */
  staleCacheDiscarded: boolean;
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
  children,
}: {
  experimentId: number;
  reviewer?: string;
  children: ReactNode;
}) {
  const { data: saved, isLoading, error } = useDesign(experimentId);
  const updater = useUpdateDesign(experimentId, reviewer);

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
    [updater.isPending],
  );
  const commit = useCallback(() => {
    if (!draft) return;
    updater.mutate(normalizeForCommit(draft), {
      onSuccess: (server) => {
        setDraft(server);
        clearCachedDraft(experimentId);
      },
    });
  }, [draft, updater, experimentId]);
  const discard = useCallback(() => {
    setDraft(saved ?? null);
    clearCachedDraft(experimentId);
    setStaleCacheDiscarded(false);
    updater.reset();
  }, [saved, updater, experimentId]);

  const value: DesignDraftValue = {
    saved: saved ?? null,
    draft,
    diff,
    apply,
    commit,
    discard,
    saving: updater.isPending,
    saveError: updater.isError ? (updater.error as Error).message : null,
    isLoading,
    loadError: error ? (error as Error).message : null,
    staleCacheDiscarded,
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
