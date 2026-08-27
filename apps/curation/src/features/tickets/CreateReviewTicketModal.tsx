import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { ApiError } from "@/api/client";
import { useCreateTicketFromAccession, type Ticket } from "@/api/tickets";

/**
 * "Import experiment" — pull one experiment out of Gemma and open a
 * review ticket over it.
 *
 * 🛑 LOCAL MODE ONLY. The import copies Gemma into the local store. In
 * remote mode the experiment IS the source, so there is nothing to
 * import and the whole affordance is hidden — the caller gates, the
 * same rule every other re-import affordance follows.
 *
 * Sibling to ``CreateScreeningTicketModal`` rather than a mode inside
 * it: the two share the portal shell and nothing else. A screening
 * ticket is a plain-language instruction an agent later turns into
 * candidates and carries no target; this one is one accession, hits a
 * different endpoint, and can fail in ways a screening ticket cannot
 * (the import runs before the ticket exists).
 *
 * The accession field takes what the importer takes — a GEO accession
 * or a numeric Gemma experiment id.
 */
export interface CreateReviewTicketModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired with the freshly created ticket so the caller can navigate
   *  to it (typically `#/tickets/{id}`). */
  onCreated: (ticket: Ticket) => void;
}

/**
 * Turn an import failure into something that tells the curator what to
 * do next.
 *
 * The two the server raises deliberately are worth naming: 404 is an
 * accession Gemma doesn't have (fix the text and retry), 502 is Gemma
 * itself failing (the accession may be fine; retry later). Anything
 * else falls through to the server's own detail rather than being
 * flattened into a generic apology.
 *
 * 🛑 **Two different auth failures, and they need different sentences
 * because different people can fix them.**
 *
 *  - A 401/403 from the STORE is the curator's own session. Signing in
 *    again fixes it, so say so.
 *  - A 502 whose detail carries an upstream 401/403 is the SERVER's
 *    Gemma credentials being rejected. The curator cannot fix that by
 *    signing in, and telling them to would send them somewhere useless.
 *
 * That second case is not hypothetical: `shared/gemma.py` records stale
 * credentials being rejected with 401 even on datasets that would
 * otherwise be readable (caught 2026-05-21). The store turns every
 * non-404 upstream error into a 502, so the original status survives
 * only in the detail string — hence the sniff rather than a status
 * check.
 *
 * Exported for test.
 */

/** Does a 502's detail carry an upstream authorization failure? The
 *  store flattens the upstream status into prose, so this reads the
 *  sentence it produced rather than a structured code. */
function upstreamAuthFailure(detail: string): boolean {
  return /\b(401|403)\b|unauthor|forbidden|invalid credential/i.test(detail);
}

export function importErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return "Your Gemma sign-in was rejected or has expired. Sign in again, then retry.";
    }
    if (err.status === 404) {
      return "Gemma has no experiment with that accession. Check the accession and try again.";
    }
    if (err.status === 502) {
      if (upstreamAuthFailure(err.detail ?? "")) {
        return `Gemma rejected this server's credentials, so nothing was imported${
          err.detail ? ` — ${err.detail}` : "."
        } Signing in again won't help; the server's Gemma credentials need attention.`;
      }
      return `Gemma couldn't be reached, so nothing was imported${
        err.detail ? ` — ${err.detail}` : "."
      }`;
    }
    return err.detail || err.message;
  }
  return err instanceof Error ? err.message : "Import failed.";
}

export function CreateReviewTicketModal({
  open,
  onClose,
  onCreated,
}: CreateReviewTicketModalProps) {
  const [accession, setAccession] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const accessionRef = useRef<HTMLInputElement>(null);
  const create = useCreateTicketFromAccession();

  // Reset fields + focus the accession each time the modal opens, so
  // reopening after a cancel starts clean.
  useEffect(() => {
    if (!open) return;
    setAccession("");
    setTitle("");
    setNote("");
    create.reset();
    const id = window.setTimeout(() => accessionRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
    // create is stable from useMutation; excluded intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes (unless an import is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !create.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, create.isPending]);

  if (!open) return null;

  const canSubmit = accession.trim().length > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    // Title and note go only when the curator wrote one — the server
    // derives "<short name> — ad-hoc review" from the imported design,
    // which it knows and we don't until the import returns.
    const trimmedTitle = title.trim();
    const trimmedNote = note.trim();
    create.mutate(
      {
        accession: accession.trim(),
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...(trimmedNote ? { body: trimmedNote } : {}),
      },
      { onSuccess: (ticket) => onCreated(ticket) },
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={() => {
        if (!create.isPending) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-review-title"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="create-review-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Import experiment for review
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pulls the experiment from Gemma into this local store and
            opens a review ticket on it. Its curation comes across as it
            stands in Gemma.
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Accession
            </span>
            <input
              ref={accessionRef}
              type="text"
              value={accession}
              onChange={(e) => setAccession(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="GSE12345 — or a Gemma experiment id"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Title <span className="text-slate-400">(optional)</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Named after the experiment if left blank"
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Note <span className="text-slate-400">(optional)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits — quick keyboard path.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={3}
              placeholder="Why this one is being reviewed"
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {create.isPending ? (
            // The import is a synchronous round trip to Gemma — design
            // plus audit pointers — so it can sit here for a few
            // seconds. Say what is happening rather than leaving a
            // disabled button to explain itself.
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Fetching {accession.trim()} from Gemma…
            </div>
          ) : create.isError ? (
            // Fields are left populated on purpose: the likeliest fix
            // is an edit to the accession, and no ticket was created,
            // so retrying is safe rather than duplicating one.
            <div className="text-xs text-rose-700 dark:text-rose-400">
              {importErrorMessage(create.error)}
            </div>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="text-xs px-2.5 py-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "text-xs px-3 py-1 rounded text-white",
              canSubmit
                ? "bg-blue-700 hover:bg-blue-800"
                : "bg-blue-700/50 cursor-not-allowed",
            )}
          >
            {create.isPending
              ? "Importing…"
              : create.isError
                ? "Try again"
                : "Import & open ticket"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
