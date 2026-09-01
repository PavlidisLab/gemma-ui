import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  useCreateTicket,
  type Ticket,
  type TicketType,
} from "@/api/tickets";

/**
 * "New ticket from this experiment" — the banner's ticket menu.
 *
 * 🛑 **Why this is a third create-ticket modal and not a prop on one of
 * the two that exist.** `CreateReviewTicketModal` creates from an
 * ACCESSION and goes through `/tickets/from-accession`, which imports
 * the dataset from GEO — wrong here, the experiment is already loaded
 * and in front of the curator. `CreateScreeningTicketModal` is fixed to
 * `type: "SCREENING"` with `targets: []` and an instruction box an agent
 * consumes; parameterising its type, targets, copy and framing would
 * leave neither entry point readable. Both were read before this was
 * written.
 *
 * 🛑 **A modal with choices, not a one-click default** (Paul,
 * 2026-08-31). Creating a ticket names work someone else will pick up,
 * so the type and the additions flag are the curator's call, not a
 * default they discover later on the ticket page.
 */

/** The types worth offering from an experiment.
 *
 *  Not the whole `TicketType` union: `SCREENING` tickets carry an
 *  agent instruction and no targets (they are made from
 *  `CreateScreeningTicketModal`), and `PRELOAD` describes a dataset
 *  that is not loaded yet, which this one demonstrably is. Offering a
 *  type whose shape this modal cannot fill would produce a ticket that
 *  reads as broken on the ticket page. */
const TYPE_CHOICES: Array<{ value: TicketType; label: string; hint: string }> = [
  {
    value: "CURATION",
    label: "Curation",
    hint: "annotate the design, factors and tags",
  },
  {
    value: "QUALITY_REVIEW",
    label: "Quality review",
    hint: "check diagnostics, outliers, batch structure",
  },
  {
    value: "BATCH_INFO_NEEDED",
    label: "Batch info needed",
    hint: "batch information is missing or unusable",
  },
  {
    value: "REALIGNMENT_NEEDED",
    label: "Realignment needed",
    hint: "the data needs reprocessing against another platform",
  },
  { value: "GENERIC", label: "Other", hint: "anything the list does not cover" },
];

export function CreateTicketForExperimentModal({
  open,
  experimentId,
  experimentLabel,
  onClose,
  onCreated,
}: {
  open: boolean;
  experimentId: number;
  /** Accession or short name — what the curator calls this experiment.
   *  Used in the seeded title so the created ticket is recognisable in
   *  a queue without opening it. */
  experimentLabel: string;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const [type, setType] = useState<TicketType>("CURATION");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [acceptsTargets, setAcceptsTargets] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const create = useCreateTicket();

  useEffect(() => {
    if (!open) return;
    setType("CURATION");
    // Seeded, not fixed — the accession alone is a poor ticket title
    // but it is a better starting point than an empty box, and the
    // curator is one keystroke from replacing it.
    setTitle(experimentLabel ? `${experimentLabel} — ` : "");
    setNote("");
    setAcceptsTargets(false);
    create.reset();
    const id = window.setTimeout(() => {
      titleRef.current?.focus();
      // Caret at the end of the seed rather than selecting it, so
      // typing continues the title instead of wiping it.
      const el = titleRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => window.clearTimeout(id);
    // `create` is stable from useMutation; excluded intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, experimentLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !create.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, create.isPending]);

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        type,
        title: title.trim(),
        body: note.trim() || undefined,
        targets: [
          { target_type: "EXPRESSION_EXPERIMENT", target_id: experimentId },
        ],
        // Omitted when unticked — the server default is false and a
        // boxed Boolean there distinguishes "not specified" from an
        // explicit false.
        ...(acceptsTargets ? { accepts_targets: true } : {}),
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
      aria-labelledby="create-ticket-for-experiment-title"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2
            id="create-ticket-for-experiment-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            New ticket from {experimentLabel || `experiment ${experimentId}`}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            This experiment is the ticket's first target. Add more from
            their own pages, or from the dashboard.
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TicketType)}
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {TYPE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} — {c.hint}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Title
            </span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="What needs doing"
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Note <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={3}
              placeholder="Anything the person picking this up needs to know. Markdown works; plain text is fine."
              className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptsTargets}
              onChange={(e) => setAcceptsTargets(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-medium">
                Allow experiments to be added later
              </span>
              <span className="block text-slate-500 dark:text-slate-400">
                Leave off for a fixed worklist — nothing can then grow it
                by accident. Turn it on for a running pile you add to as
                you go.
              </span>
            </span>
          </label>

          {create.isError ? (
            <p className="text-xs text-red-700 dark:text-red-300">
              {create.error instanceof Error
                ? create.error.message
                : "Could not create the ticket."}
            </p>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="px-3 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {create.isPending ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
