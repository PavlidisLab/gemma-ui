/**
 * What the curator is told about their draft, once autosave exists.
 *
 * Paul: *"the UI should show something when it autosaves."* The states
 * are gembro's §5 table; the wording is the part that has to be exactly
 * true, because this is the only place the app makes a promise about
 * whether work is safe.
 *
 * 🛑 **"Saved" means Gemma has it.** The agent writes its crash backup
 * to disk, PUTs to Gemma, and returns only after Gemma's 200 — so the
 * word is honest as written. If the agent ever acknowledges early, this
 * copy has to weaken with it, because the failure it would hide is an
 * agent dying between ack and forward, losing work the curator was told
 * was saved.
 *
 * The failure states all say where the work IS, not just that something
 * went wrong. A curator who reads "Save failed" and does not know
 * whether their afternoon survived will either redo it or lose it.
 */

import type { SaveState } from "@/api/curationDraft";

/** Wall-clock for the "Saved 12:04" stamp. Minutes, because the
 *  precision that matters is "recently" — and because `savedAt` is the
 *  agent's clock at Gemma's 200, which is one round trip off Gemma's
 *  own and well inside a minute. */
export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry?: () => void;
}) {
  // Nothing to say before the curator has touched anything. An
  // indicator that reads "Saved" on arrival would be claiming a write
  // that never happened.
  if (state.kind === "idle") return null;

  const base = "text-[11px] leading-snug inline-flex items-center gap-1.5";

  if (state.kind === "dirty") {
    // 🛑 This said "Unsaved changes" and sits beside the Commit button,
    // so it read as "your commit did not take" — which is how Paul read
    // it, after two commits that had both landed. This indicator is
    // about the DRAFT BACKUP, a different write entirely: committing
    // never clears it and was never meant to.
    return (
      <span
        className={`${base} text-slate-500 dark:text-slate-400`}
        title="Your edits are still only in this browser. The draft backs itself up to the server about every minute; this is separate from committing."
      >
        Draft not backed up yet
      </span>
    );
  }

  if (state.kind === "saving") {
    return (
      <span className={`${base} text-slate-500 dark:text-slate-400`}>
        Saving…
      </span>
    );
  }

  if (state.kind === "saved") {
    const at = formatSavedAt(state.at);
    return (
      <span
        className={`${base} text-slate-500 dark:text-slate-400`}
        title="Saved to Gemma — the agent waits for Gemma to confirm before reporting this"
      >
        {at ? `Saved ${at}` : "Saved"}
      </span>
    );
  }

  if (state.kind === "offline") {
    return (
      <span
        className={`${base} text-amber-800 dark:text-amber-300`}
        title={state.detail}
      >
        Offline — changes kept locally
      </span>
    );
  }

  if (state.kind === "conflict") {
    // The baseline moved under the curator. Today's UI discards the
    // draft on this and says nothing; the whole point of surfacing it
    // is that the work is still here.
    return (
      <span
        className={`${base} text-amber-800 dark:text-amber-300`}
        title={state.detail}
      >
        {state.draftRetained
          ? "The saved design changed — your draft is safe, review before committing"
          : "The saved design changed"}
      </span>
    );
  }

  return (
    <span className={`${base} text-rose-700 dark:text-rose-400`} title={state.detail}>
      Save failed — changes kept locally
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="underline hover:no-underline"
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
