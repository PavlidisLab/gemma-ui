import { useState } from "react";
import type { IssueTag } from "@/api/types";

/**
 * Per-row "+ flag" affordance. Click → reveals an inline panel with
 * categorical chips (toggle to add/remove) + an optional one-line
 * note + save / cancel.
 *
 * The categorical vocabulary is fixed per surface type (factor / FV
 * / tag) and chosen for the most common failure modes we've observed
 * in smoke runs and FOLLOWUPS.md. Categories are stable identifiers;
 * labels are presentation-only.
 *
 * State:
 *
 *   - The component is uncontrolled at the chip level (selections
 *     are local to the inline panel).
 *   - Existing tags for this row are passed in via ``tags``; on save,
 *     the parent gets a fresh list and replaces the existing one.
 *
 * Persistence: ``IssueTag[]`` rides on ``CuratorFeedback.issue_tags``
 * when the curator submits. The mock API silently drops the field
 * today (extra="ignore"); a follow-up adds it to the pydantic schema.
 */

export type IssueSurface = "factor" | "fv" | "tag";

const ISSUE_CATEGORIES: Record<
  IssueSurface,
  Array<{ key: string; label: string }>
> = {
  factor: [
    { key: "wrong_factor_type", label: "wrong factor type" },
    { key: "missing_fvs", label: "missing FVs" },
    { key: "should_be_tag", label: "should be a tag" },
    { key: "should_be_subset", label: "should be subset axis" },
    { key: "inducer_misclassified", label: "inducer misclassified" },
  ],
  fv: [
    { key: "wrong_term", label: "wrong term" },
    { key: "wrong_predicate", label: "wrong predicate / object" },
    { key: "wrong_baseline", label: "wrong baseline status" },
    { key: "duplicate_fv", label: "duplicate / overlap" },
    { key: "author_shorthand", label: "author shorthand label" },
  ],
  tag: [
    { key: "wrong_category", label: "wrong category" },
    { key: "wrong_term", label: "wrong term" },
    { key: "redundant_with_fv", label: "redundant with FV" },
  ],
};

export function IssueTagInline({
  surface,
  targetId,
  tags,
  onChange,
}: {
  surface: IssueSurface;
  targetId: string;
  tags: IssueTag[];
  /** Replace the entire tag list for this ``targetId``. The parent's
   *  state stays a flat ``IssueTag[]``; this component just feeds it
   *  the new slice for one row. */
  onChange: (next: IssueTag[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Local edit buffer — copies the existing tags on open so cancelling
  // discards. Only flushes to the parent on Save.
  const [draftCategories, setDraftCategories] = useState<Set<string>>(
    () => new Set(tags.map((t) => t.category)),
  );
  const [draftNote, setDraftNote] = useState<string>(
    () => tags.find((t) => t.note)?.note ?? "",
  );

  const cats = ISSUE_CATEGORIES[surface];
  const flagCount = tags.length;

  function openPanel() {
    setDraftCategories(new Set(tags.map((t) => t.category)));
    setDraftNote(tags.find((t) => t.note)?.note ?? "");
    setOpen(true);
  }
  function cancel() {
    setOpen(false);
  }
  function toggleCategory(key: string) {
    setDraftCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function save() {
    // Materialise the draft selections into IssueTag rows. Stable
    // ordering (by category in the master list) so re-saves don't
    // churn the array order. Note rides on the first tag; if the
    // curator selected zero categories but typed a note, we still
    // emit one tag with category="other" so the note isn't lost.
    const next: IssueTag[] = [];
    let noteAttached = false;
    for (const c of cats) {
      if (draftCategories.has(c.key)) {
        next.push({
          target_id: targetId,
          category: c.key,
          ...(noteAttached ? {} : draftNote ? { note: draftNote } : {}),
        });
        if (draftNote) noteAttached = true;
      }
    }
    if (next.length === 0 && draftNote) {
      next.push({ target_id: targetId, category: "other", note: draftNote });
    }
    onChange(next);
    setOpen(false);
  }

  return (
    <span className="inline-flex items-baseline">
      {!open ? (
        <button
          type="button"
          onClick={openPanel}
          className={
            "ml-1 text-[10px] underline-offset-2 " +
            (flagCount > 0
              ? "text-amber-700 hover:text-amber-900 underline"
              : "text-slate-400 hover:text-slate-700 hover:underline")
          }
          title={
            flagCount > 0
              ? `${flagCount} issue${flagCount === 1 ? "" : "s"} flagged — click to edit`
              : "flag a problem with this row"
          }
        >
          {flagCount > 0 ? `⚠ ${flagCount}` : "+ flag"}
        </button>
      ) : (
        <div
          // Inline panel renders below the row visually because the
          // wrapping span breaks at sibling boundaries; the parent
          // controls layout via flex. To get a real "below the row"
          // panel, wrap this whole block in a block-level div in the
          // call site if needed. For now the popover-ish appearance
          // is good enough and zero-position-math.
          className="ml-2 mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] space-y-1.5 inline-block align-top"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => {
              const selected = draftCategories.has(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleCategory(c.key)}
                  className={
                    "px-1.5 py-0.5 rounded border text-[10px] " +
                    (selected
                      ? "bg-amber-200 text-amber-900 border-amber-400"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
                  }
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="optional note"
            className="w-full text-[11px] border border-amber-200 bg-white rounded px-1.5 py-0.5"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            autoFocus
          />
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={cancel}
              className="text-[10px] text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="text-[10px] text-amber-900 font-semibold hover:underline"
            >
              save
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
