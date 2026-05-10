import { useEffect, useState } from "react";
import {
  useCurationDetails,
  useUpdateCurationDetails,
  type CurationDetails,
} from "@/api/curation";
import { cn } from "@/lib/cn";
import { useEscape } from "@/lib/useEscape";

/** localStorage key for an in-flight curation-note draft. Keyed by
 *  experiment id so a curator working two experiments in two tabs
 *  doesn't cross-pollute. Cleared after a successful save. Mirrors
 *  the design-draft cache pattern (see DesignDraftContext). */
const NOTE_DRAFT_KEY_PREFIX = "gca:note-draft:";

function readCachedNote(experimentId: number): string | null {
  try {
    return window.localStorage.getItem(NOTE_DRAFT_KEY_PREFIX + experimentId);
  } catch {
    return null;
  }
}

function writeCachedNote(experimentId: number, text: string): void {
  try {
    if (text) {
      window.localStorage.setItem(NOTE_DRAFT_KEY_PREFIX + experimentId, text);
    } else {
      window.localStorage.removeItem(NOTE_DRAFT_KEY_PREFIX + experimentId);
    }
  } catch {
    // Quota / privacy mode / SSR — survivable, in-memory state still
    // works while the drawer is open.
  }
}

function clearCachedNote(experimentId: number): void {
  try {
    window.localStorage.removeItem(NOTE_DRAFT_KEY_PREFIX + experimentId);
  } catch {
    // ignore
  }
}

interface ResolveCtx {
  field: "troubled" | "needs_attention";
  label: string;
}

/** Partial shape accepted by ``useUpdateCurationDetails``. Pulled
 *  out so the per-call mutation payloads keep their type instead
 *  of falling through ``{[field]: ...}`` inference into ``any``. */
type CurationDetailsPatch = Partial<
  Pick<CurationDetails, "curation_note" | "troubled" | "needs_attention">
>;

/**
 * Curation-status drawer — backed by Gemma's CurationDetails (the
 * canonical model on the experiment). One panel surfaces the three
 * pieces a curator owns outside the design itself:
 *
 *   - **note** (free-text scratchpad; admin-only in production)
 *   - **needs attention** flag
 *   - **troubled** flag
 *
 * Independent of the design draft — saves immediately and
 * appends matching audit events server-side
 * (`CurationNoteUpdateEvent`, `NeedsAttentionEvent` /
 * `DoesNotNeedAttentionEvent`, `TroubledStatusFlagEvent` /
 * `NotTroubledStatusFlagEvent`) so the Audit trail tab reflects
 * each change.
 */
export function NotesDrawer({
  experimentId,
  reviewer,
  onClose,
}: {
  experimentId: number;
  reviewer: string;
  onClose: () => void;
}) {
  const { data: saved, isLoading, error } = useCurationDetails(experimentId);
  const updater = useUpdateCurationDetails(experimentId, reviewer);

  const [noteDraft, setNoteDraft] = useState("");
  // When the curator clears `needs_attention` or `troubled`, the
  // Confluence "Resolving Curator Attention Status" guide says the
  // resolution should be captured on the way out. Open a modal that
  // collects a one-liner and appends it to the curation_note as a
  // dated entry. Setting the flag (off → on) doesn't go through the
  // modal — only the off transition does.
  const [resolving, setResolving] = useState<ResolveCtx | null>(null);
  useEscape(resolving !== null, () => setResolving(null));
  const [resolveText, setResolveText] = useState("");

  // Initialise the textarea — prefer a cached uncommitted draft over
  // the server's saved value when one exists. The cache survives
  // drawer close + experiment switch + page refresh, so a curator
  // can navigate around mid-note without losing work.
  useEffect(() => {
    if (!saved) return;
    const cached = readCachedNote(experimentId);
    if (cached !== null && cached !== saved.curation_note) {
      setNoteDraft(cached);
    } else {
      setNoteDraft(saved.curation_note);
    }
  }, [saved?.curation_note, experimentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const noteDirty = saved !== undefined && noteDraft !== (saved?.curation_note ?? "");

  // Persist on every change so the draft survives an unmount. Skip
  // when the draft equals the saved value (no point caching a clean
  // state) and when saved isn't loaded yet.
  useEffect(() => {
    if (!saved) return;
    if (noteDraft === saved.curation_note) {
      clearCachedNote(experimentId);
    } else {
      writeCachedNote(experimentId, noteDraft);
    }
  }, [noteDraft, saved?.curation_note, experimentId]);

  function toggleFlag(field: "troubled" | "needs_attention") {
    if (!saved) return;
    if (saved[field]) {
      // Clearing — open the resolution modal.
      setResolveText("");
      setResolving({
        field,
        label: field === "needs_attention" ? "needs attention" : "troubled",
      });
      return;
    }
    const patch: CurationDetailsPatch = { [field]: true };
    updater.mutate(patch);
  }

  function appendResolution(text: string): string {
    const stamp = new Date().toISOString().slice(0, 10);
    const tag =
      resolving?.field === "needs_attention" ? "needs-attention cleared" : "troubled cleared";
    const entry = `[${stamp}] ${tag}${reviewer ? ` by ${reviewer}` : ""}: ${text}`;
    const existing = (noteDraft || "").trimEnd();
    return existing ? `${existing}\n${entry}` : entry;
  }

  function confirmResolve() {
    if (!resolving || !saved) return;
    const text = resolveText.trim();
    // Treat empty text as a soft block — Confluence's
    // "Resolving Curator Attention Status" guide expects a
    // resolution note when something actually got addressed.
    if (!text) return;
    const next = appendResolution(text);
    setNoteDraft(next);
    const patch: CurationDetailsPatch = {
      [resolving.field]: false,
      curation_note: next,
    };
    updater.mutate(patch);
    setResolving(null);
  }

  /**
   * Clear the flag without appending a resolution note. For when
   * the curator set the flag by mistake or there's nothing
   * substantive to resolve (e.g. flipped on, immediately reverted).
   * The mock API still emits the matching audit event (trail tells
   * the story even without a note), so this isn't silent.
   */
  function revertFlag() {
    if (!resolving || !saved) return;
    const patch: CurationDetailsPatch = { [resolving.field]: false };
    updater.mutate(patch);
    setResolving(null);
  }

  function saveNote() {
    if (!noteDirty) return;
    updater.mutate(
      { curation_note: noteDraft },
      // Server is now authoritative; drop the cached draft so a
      // later session doesn't restore stale text on top of it.
      { onSuccess: () => clearCachedNote(experimentId) },
    );
  }

  return (
    <section className="bg-amber-50/50 border-b border-amber-200">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-3">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Curation status
            </h2>
            {saved && saved.last_updated ? (
              <span className="text-[11px] text-slate-500">
                last updated{" "}
                <time dateTime={saved.last_updated}>
                  {formatTimestamp(saved.last_updated)}
                </time>
              </span>
            ) : null}
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            close
          </button>
        </div>

        {isLoading ? (
          <div className="text-xs text-slate-500">loading…</div>
        ) : error ? (
          <div className="text-xs text-rose-700">
            couldn't load curation details: {(error as Error).message}
          </div>
        ) : saved ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <FlagToggle
                label="needs attention"
                description="A curator needs to look at this"
                set={saved.needs_attention}
                meta={lastEventMeta(
                  saved.last_needs_attention_event_at,
                  saved.last_needs_attention_event_by,
                )}
                onClick={() => toggleFlag("needs_attention")}
                tone="amber"
                disabled={updater.isPending}
              />
              <FlagToggle
                label="troubled"
                description="Known data issue with this experiment"
                set={saved.troubled}
                meta={lastEventMeta(
                  saved.last_troubled_event_at,
                  saved.last_troubled_event_by,
                )}
                onClick={() => toggleFlag("troubled")}
                tone="rose"
                disabled={updater.isPending}
              />
              {updater.isError ? (
                <span
                  className="text-xs text-rose-700"
                  title={(updater.error as Error).message}
                >
                  save failed
                </span>
              ) : null}
            </div>

            <div>
              <label
                className="block text-[11px] uppercase tracking-wide font-semibold text-slate-700 mb-1"
                htmlFor="curation-note-textarea"
              >
                Curation note
                {saved.last_note_update_at ? (
                  <span className="ml-2 font-normal text-slate-500 normal-case">
                    last edited {formatTimestamp(saved.last_note_update_at)}
                    {saved.last_note_update_by ? ` by ${saved.last_note_update_by}` : ""}
                  </span>
                ) : null}
              </label>
              <textarea
                id="curation-note-textarea"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="curator scratchpad — paper status, edge cases, reminders…"
                spellCheck
                rows={6}
                className="w-full text-sm font-mono border border-amber-300 rounded px-2 py-1.5 bg-white"
              />
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn ghost text-xs"
                  onClick={() => setNoteDraft(saved.curation_note)}
                  disabled={!noteDirty || updater.isPending}
                >
                  revert
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={saveNote}
                  disabled={!noteDirty || updater.isPending}
                >
                  {updater.isPending ? "saving…" : "save note"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {resolving ? (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center px-4"
          onClick={() => setResolving(null)}
        >
          <div
            className="bg-white rounded shadow-lg max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-800">
                Clear "{resolving.label}"
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700"
                onClick={() => setResolving(null)}
              >
                ×
              </button>
            </div>
            <div className="px-3 py-3 space-y-2 text-sm">
              <p className="text-slate-700">
                How was this {resolving.label === "needs attention" ? "addressed" : "resolved"}?
                The note will be appended to the curation note and recorded
                in the audit trail.
              </p>
              <textarea
                value={resolveText}
                onChange={(e) => setResolveText(e.target.value)}
                rows={3}
                placeholder="e.g. updated baseline FV after re-reading paper"
                className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                autoFocus
              />
            </div>
            <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              {/*
                "Revert" sits on the left as the secondary path: the
                curator set the flag by mistake or there's nothing
                substantive to resolve. The audit trail still records
                the toggle, so this isn't a stealth change. Resolution-
                with-note remains the primary action on the right.
              */}
              <button
                type="button"
                className="btn ghost text-xs text-slate-500"
                onClick={revertFlag}
                disabled={updater.isPending}
                title={`Clear "${resolving.label}" without appending a resolution note — for when nothing substantive changed`}
              >
                revert (no note)
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn ghost text-xs"
                  onClick={() => setResolving(null)}
                >
                  cancel
                </button>
                <button
                  type="button"
                  className="btn primary text-xs"
                  onClick={confirmResolve}
                  disabled={!resolveText.trim() || updater.isPending}
                >
                  {updater.isPending ? "saving…" : "clear & save note"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FlagToggle({
  label,
  description,
  set,
  meta,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  description: string;
  set: boolean;
  meta: string | null;
  onClick: () => void;
  tone: "amber" | "rose";
  disabled?: boolean;
}) {
  const onCls =
    tone === "rose"
      ? "bg-rose-100 text-rose-900 border-rose-300"
      : "bg-amber-100 text-amber-900 border-amber-300";
  const offCls = "bg-white text-slate-700 border-slate-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "border rounded px-2 py-1 text-xs flex items-center gap-2",
        set ? onCls : offCls,
      )}
      title={description + (meta ? ` (${meta})` : "")}
    >
      <span
        className={cn(
          "inline-block w-2.5 h-2.5 rounded-full",
          set
            ? tone === "rose"
              ? "bg-rose-500"
              : "bg-amber-500"
            : "bg-slate-300",
        )}
      />
      <span className="font-semibold">{label}</span>
      <span className="text-[10px] uppercase tracking-wide">
        {set ? "on" : "off"}
      </span>
      {meta ? (
        <span className="text-[10px] text-slate-500 ml-1">{meta}</span>
      ) : null}
    </button>
  );
}

function lastEventMeta(at: string, by: string): string | null {
  if (!at) return null;
  const when = formatTimestamp(at);
  return by ? `${when} · ${by}` : when;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
