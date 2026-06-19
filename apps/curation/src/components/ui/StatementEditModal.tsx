import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Term } from "./Term";
import { PREDICATES, type PredicateDef } from "@/generated/predicates";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * StatementEditModal — modal popup for editing one EE-tag statement.
 *
 * Layout mirrors ``StatementEditor`` in the FV editor: a single
 * flat-flowing row per S-P-O so the visual chrome stays minimal and
 * the curator's eye moves left to right. No grids, no labelled cells —
 * placeholders carry the slot identity.
 *
 *   [category-chip]  [subject]  [predicate ▼]  [object]  [×]
 *   [predicate ▼]  [object]  [×]                  ← second pair, optional
 *   + add qualifier
 *
 * Components reused from the design editor:
 *   - ``CategoryPicker``       — constrained to the canonical EFC list
 *                                (28 entries from EFO.factor.categories).
 *   - ``OntologyTermPicker``   — typeahead + agent-side ontology search
 *                                for subject + object.
 *   - predicate ``<select>``   — locked to ``PREDICATES`` (21 entries
 *                                from gemma-core ``Relation.terms.txt``).
 *
 * Wire shape (``AnnotationTagInput`` / ``AnnotationValueObject``, see
 * ``handoffs/UIB_HANDOFF_2026_06_17_TAG_AND_BM_STATEMENT_ENDPOINTS.md``)
 * — category + subject (== ``value``) + primary predicate/object pair
 * + optional secondary pair. Evidence code is upstream-inferred, not
 * editable here.
 */

export interface StatementDraft {
  category: OntologyTerm;
  subject: OntologyTerm;
  pairs: Array<{
    predicate: OntologyTerm | null;
    object: OntologyTerm | null;
  }>;
}

export interface StatementEditModalProps {
  open: boolean;
  initial: StatementDraft;
  title?: string;
  onCancel: () => void;
  onSave: (next: StatementDraft) => void | Promise<void>;
}

const MAX_PAIRS = 2;

export function StatementEditModal({
  open,
  initial,
  title = "Edit tag",
  onCancel,
  onSave,
}: StatementEditModalProps) {
  const [draft, setDraft] = useState<StatementDraft>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, saving]);

  if (!open) return null;

  const updateCategory = (next: OntologyTerm | null) => {
    setDraft((d) => ({ ...d, category: next ?? { label: "", uri: null } }));
  };
  const updateSubject = (next: OntologyTerm | null) => {
    setDraft((d) => ({ ...d, subject: next ?? { label: "", uri: null } }));
  };
  const updatePair = (
    idx: number,
    patch: Partial<StatementDraft["pairs"][number]>,
  ) => {
    setDraft((d) => {
      // Auto-grow pairs to index if needed (curator picks a predicate
      // before a pair exists).
      const next = [...d.pairs];
      while (next.length <= idx) {
        next.push({ predicate: null, object: null });
      }
      next[idx] = { ...next[idx], ...patch };
      return { ...d, pairs: next };
    });
  };
  const addPair = () => {
    setDraft((d) => ({
      ...d,
      pairs: [...d.pairs, { predicate: null, object: null }],
    }));
  };
  const removePair = (idx: number) => {
    setDraft((d) => ({
      ...d,
      pairs: d.pairs.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleaned: StatementDraft = {
        ...draft,
        pairs: draft.pairs.filter(
          (p) =>
            (p.predicate && p.predicate.label) ||
            (p.object && p.object.label),
        ),
      };
      await onSave(cleaned);
    } finally {
      setSaving(false);
    }
  };

  // Render one (predicate, object) row. The × removes that whole
  // pair from the draft — the subject stays put. When the secondary
  // pair is removed the curator returns to S-P-O; when the primary
  // pair is removed they return to subject-only.
  const renderPairRow = (idx: number) => {
    const pair = draft.pairs[idx];
    return (
      <div className="flex items-center gap-2 text-sm">
        <PredicateInline
          value={pair.predicate}
          onChange={(p) =>
            updatePair(idx, {
              predicate: p,
              object: p ? pair.object : null,
            })
          }
        />
        <OntologyTermPicker
          value={pair.object}
          category={null}
          searchCategory={draft.category.label || null}
          searchContext="object"
          placeholder="object"
          onCommit={(next) => updatePair(idx, { object: next })}
        />
        <button
          type="button"
          onClick={() => removePair(idx)}
          disabled={saving}
          title="remove this predicate + object"
          aria-label="remove predicate and object"
          className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-[12px] w-5 h-5 rounded inline-flex items-center justify-center disabled:opacity-30 ml-auto"
        >
          ×
        </button>
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-2xl w-[720px] max-w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
          <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
            {title}
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none"
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div className="p-3 space-y-2">
          {/* Subject row: category chip + subject */}
          <div className="flex items-center gap-2 text-sm">
            <span
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-300"
              title="tag category"
            >
              <CategoryPicker
                value={draft.category.label ? draft.category : null}
                placeholder="category"
                onCommit={updateCategory}
              />
            </span>
            <OntologyTermPicker
              value={draft.subject.label ? draft.subject : null}
              category={null}
              searchCategory={draft.category.label || null}
              searchContext="subject"
              placeholder="subject"
              onCommit={updateSubject}
            />
          </div>

          {/* Pair rows — only render rows that actually exist in the
              draft. Curator's "+ add" buttons grow the array; per-row
              × shrinks it. */}
          {draft.pairs.map((_, i) => (
            <div key={i}>{renderPairRow(i)}</div>
          ))}

          {/* Add affordance — single button, label adapts to position. */}
          {draft.pairs.length < MAX_PAIRS ? (
            <button
              type="button"
              onClick={addPair}
              disabled={saving}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline"
            >
              {draft.pairs.length === 0
                ? "+ add predicate"
                : "+ add qualifier"}
            </button>
          ) : null}

          {/* Live preview chip */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex items-baseline gap-2 text-xs">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              Preview
            </span>
            <StatementPreview draft={draft} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-sm px-3 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.subject.label.trim()}
            className="text-sm px-3 py-1 rounded font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Inline predicate select mirroring StatementEditor.tsx's pattern —
 * dashed placeholder when empty, near-text styling when filled, so it
 * sits in flow with the OntologyTermPicker chips. Predicate-allow-list
 * enforced by the option set; free-text not accepted.
 */
function PredicateInline({
  value,
  onChange,
}: {
  value: OntologyTerm | null;
  onChange: (next: OntologyTerm | null) => void;
}) {
  return (
    <select
      className={cn(
        "text-sm rounded px-1 py-0 cursor-pointer max-w-[14rem]",
        value
          ? "bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 text-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
          : "italic font-normal border border-dashed border-slate-400 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 focus:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
      )}
      value={value?.uri ?? ""}
      onChange={(e) => {
        if (e.target.value === "") {
          onChange(null);
          return;
        }
        const def = PREDICATES.find((p: PredicateDef) => p.uri === e.target.value);
        if (def) onChange({ label: def.label, uri: def.uri });
      }}
    >
      <option value="">predicate</option>
      {PREDICATES.map((p) => (
        <option key={p.uri} value={p.uri} title={p.description}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Live preview — mirrors the StatementChip rendering so the curator
 * sees what the chip will look like as they edit.
 */
function StatementPreview({ draft }: { draft: StatementDraft }) {
  const pairs = draft.pairs.filter(
    (p) => (p.predicate && p.predicate.label) || (p.object && p.object.label),
  );
  return (
    <span className="inline-flex items-baseline rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 gap-1.5 text-xs">
      <Term uri={draft.subject.uri ?? null} asLink={false}>
        {draft.subject.label || <span className="italic text-slate-400">subject</span>}
      </Term>
      {pairs.map((p, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          <span className="text-slate-400 dark:text-slate-600">·</span>
          {p.predicate?.label ? (
            <span className="italic text-slate-500 dark:text-slate-400">
              {p.predicate.label}
            </span>
          ) : null}
          {p.object?.label ? (
            <>
              <span className="text-slate-400 dark:text-slate-600">·</span>
              <Term uri={p.object.uri ?? null} asLink={false}>
                {p.object.label}
              </Term>
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
