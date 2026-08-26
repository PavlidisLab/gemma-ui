/**
 * Autosave for the design draft.
 *
 * Until now the editor PUT nothing until Commit and the only copy of a
 * curator's work was `localStorage` — which a concurrent commit could
 * silently discard (`DesignDraftContext` dropped the cache on baseline
 * drift behind an amber banner, and never told the person who caused
 * it). This sends the draft to the agent, which writes its own crash
 * backup, forwards to Gemma, and returns only after Gemma's 200.
 *
 * **60 seconds** — Paul's number, 2026-08-25. The spec had said 2 s
 * with nothing behind it (gembro withdrew it when asked).
 *
 * Forced saves on blur and page-hide are what make a 60-second interval
 * safe to walk away from: the gap only matters if the tab is still
 * there to close it.
 *
 * 🛑 **The lease rides on the save.** Gemma refreshes
 * `CURATION_LOCK.EXPIRES_AT` server-side on every draft PUT
 * (`eb83d06202`) — so there is no refresh call to make here, and none
 * should be added. `refresh()` returns empty rather than acquiring when
 * the caller holds no lock, so a save can never take a lock nobody
 * asked for.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/api/session";
import {
  putCurationDraft,
  saveStateForError,
  type SaveState,
} from "@/api/curationDraft";
import type { Design } from "@/features/experiment/types";

/** Paul's number. Not a debounce on keystrokes — a ceiling on how long
 *  an edit can sit unsent while the curator keeps working. */
export const AUTOSAVE_INTERVAL_MS = 60_000;

export interface AutosaveOptions {
  experimentId: number | string;
  /** The current draft. `null` before it loads. */
  draft: Design | null;
  /** Whether the draft differs from the saved design. */
  isDirty: boolean;
  /** Off for read-only baselines, finalized audits, and anywhere the
   *  curator cannot edit — a save from those would write a draft the
   *  curator did not author. */
  enabled?: boolean;
}

export interface AutosaveHandle {
  state: SaveState;
  /** Save now if there is anything to save. Used by blur / navigation,
   *  and available to callers that know they are about to leave. */
  flush: () => void;
}

export function useDraftAutosave({
  experimentId,
  draft,
  isDirty,
  enabled = true,
}: AutosaveOptions): AutosaveHandle {
  const me = useMe();
  const curator = me.data?.username ?? null;
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  // Refs, not state: the timer callback and the event listeners must
  // see the CURRENT draft without being torn down and rebuilt on every
  // keystroke — a listener rebuilt mid-edit is how a pending save gets
  // dropped.
  const draftRef = useRef(draft);
  const dirtyRef = useRef(isDirty);
  const inFlight = useRef(false);
  /** Set when an edit lands while a save is in flight. The save that
   *  is running was built from an older draft, so finishing it does NOT
   *  make us clean. */
  const dirtyAgain = useRef(false);
  const timer = useRef<number | null>(null);

  draftRef.current = draft;
  dirtyRef.current = isDirty;

  const save = useCallback(async () => {
    if (!enabled || !curator) return;
    const d = draftRef.current;
    if (!d || !dirtyRef.current) return;
    if (inFlight.current) {
      // Never two saves at once: the later one could land first and
      // the server would keep the older draft.
      dirtyAgain.current = true;
      return;
    }
    inFlight.current = true;
    dirtyAgain.current = false;
    setState({ kind: "saving" });
    try {
      const res = await putCurationDraft(experimentId, curator, { design: d });
      // `saved_at` is when the AGENT SAW GEMMA'S 200 — the agent does
      // not return until Gemma has committed. That is what makes this
      // "Saved", not "sent".
      setState({ kind: "saved", at: res.saved_at });
    } catch (e) {
      setState(saveStateForError(e));
    } finally {
      inFlight.current = false;
      // An edit arrived mid-save: the draft on the server is already
      // stale, so go again rather than waiting out another interval.
      if (dirtyAgain.current && dirtyRef.current) void save();
    }
  }, [enabled, curator, experimentId]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    void save();
  }, [save]);

  // The interval. Restarted on each change, so a curator typing
  // steadily saves every 60 s from their last edit rather than every
  // 60 s regardless.
  useEffect(() => {
    if (!enabled || !isDirty) return;
    setState((s) => (s.kind === "saving" ? s : { kind: "dirty" }));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void save();
    }, AUTOSAVE_INTERVAL_MS);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, isDirty, draft, save]);

  // Leaving the tab. `visibilitychange` fires on tab switch and on
  // most closes; `pagehide` covers the rest. Deliberately NOT
  // `beforeunload`: it cannot await, so a save started there is a
  // race, and it triggers the browser's "leave site?" prompt on some
  // paths — an interruption the curator did not ask for.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onPageHide = () => flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled, flush]);

  // Walking to another experiment. The draft belongs to the id it was
  // edited under, so this must fire BEFORE the id changes — hence the
  // cleanup rather than an effect body.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void save();
    };
    // Intentionally keyed on the experiment only: re-running this on
    // every `save` identity change would fire a save per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId]);

  return { state, flush };
}
