import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useCreateTicket, type Ticket } from "@/api/tickets";

/**
 * "New screening ticket" — a natural-language-first create form.
 *
 * A screening ticket asks the curator to decide yes/no on a set of
 * datasets rather than curate them. Per design review: the config IS the
 * plain-language instruction — no mode buttons, no criteria pickers.
 * The curator describes what to screen for ("find GEO datasets like
 * GSE… we might want", or "datasets already in Gemma that still need
 * cell-type curation") and the reviewing agent later interprets that into
 * a candidate list, populating the ticket's targets. This form's only
 * job is to mint the ticket with `type=SCREENING` + the instruction in
 * `body`; everything downstream (candidate population, the yes/no
 * screen, finalize) rides the existing triage substrate.
 *
 * Two fields only: an optional short title (auto-derived from the
 * instruction when blank) and the instruction itself. Centred modal via
 * createPortal (mirrors JsonViewer / ProposerDetailsDialog) so it
 * escapes any overflow context; Escape / click-outside cancels.
 */
export interface CreateScreeningTicketModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired with the freshly created ticket so the caller can navigate
   *  to it (typically `#/tickets/{id}`). */
  onCreated: (ticket: Ticket) => void;
}

/** Derive a compact title from the instruction when the curator leaves
 *  the title blank — first sentence / line, trimmed to a sane length so
 *  the ticket card + detail header stay readable. */
export function deriveTitle(instruction: string): string {
  const firstLine = instruction.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.?!])\s/)[0]?.trim() || firstLine;
  const base = firstSentence || "Screening";
  return base.length > 80 ? base.slice(0, 77).trimEnd() + "…" : base;
}

export function CreateScreeningTicketModal({
  open,
  onClose,
  onCreated,
}: CreateScreeningTicketModalProps) {
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const create = useCreateTicket();

  // Reset fields + focus the instruction each time the modal opens, so
  // reopening after a cancel starts clean.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setInstruction("");
    create.reset();
    const id = window.setTimeout(() => instructionRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
    // create is stable from useMutation; excluded intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes (unless a create is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !create.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, create.isPending]);

  if (!open) return null;

  const canSubmit = instruction.trim().length > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const body = instruction.trim();
    create.mutate(
      {
        type: "SCREENING",
        title: title.trim() || deriveTitle(body),
        body,
        targets: [],
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
      aria-labelledby="create-screening-title"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="create-screening-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            New screening ticket
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Describe in plain language what to screen for. An agent turns
            it into a list of datasets for you to review yes/no — you
            don't curate them here.
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Instruction
            </span>
            <textarea
              ref={instructionRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits — quick keyboard path.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={5}
              placeholder={
                "e.g. Find GEO datasets like GSE123456 — mouse brain single-cell perturbation studies — that we might want to curate.\n\nor: Datasets already in Gemma tagged single-cell that still need cell-type curation."
              }
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
              placeholder="Auto-generated from your instruction if left blank"
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {create.isError ? (
            <div className="text-xs text-rose-700 dark:text-rose-400">
              Couldn't create the ticket
              {create.error instanceof Error ? `: ${create.error.message}` : "."}
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
            {create.isPending ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
