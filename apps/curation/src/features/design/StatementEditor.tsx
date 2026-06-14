import { useState } from "react";
import { CategoryPicker } from "./CategoryPicker";
import { OntologyTermPicker } from "./OntologyTermPicker";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { CurieLink } from "@/components/ui/CurieLink";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { PREDICATE_GUIDELINE } from "@/lib/guidelines";
import type { OntologyTerm, Statement } from "@/features/experiment/types";

/**
 * Allow-list of predicates that can link a Statement subject to its
 * object. Source of truth: Confluence
 * `Use-of-predicates-in-factor-values_140541986.html` (also distilled
 * in `gemma-curation-agents/.../prompts/ontology_rules.md`).
 *
 * Keep this list in sync with the prompt's predicate table — picker
 * lookup keys on label/URI together, so a drift here propagates a
 * wrong URI to Gemma.
 */
// Predicate allow-list — imported from the generated single source
// of truth. Edit ``gemma-curation-agents/data/predicates.json`` and
// re-run ``scripts/sync_predicates_to_ui.py`` to add/change entries.
import { PREDICATES } from "@/generated/predicates";

/**
 * One Statement row.
 *
 * Layout: `[category]  subject  predicate?  object?  remove`
 *
 * - The **category** chip uses CategoryPicker — a tight datalist
 *   over the canonical EFC enum.
 * - **Subject** and **object** use OntologyTermPicker — the
 *   typeahead with usage counts that mirrors the legacy ExtJS
 *   curation UI's bolding of previously-used terms.
 * - **Predicate** is a fixed `<select>` over the curator-allowed
 *   list (has role, has_genotype, adjacent to, delivered at dose,
 *   delivered for duration, has disease).
 *
 * No category filter on subject/object — Statement.category
 * doesn't always equal the picker's scope; e.g. a genotype EFC
 * with `Zbp1 has_genotype Homozygous_negative` has subject="Zbp1"
 * (gene) and object="Homozygous negative" (TGEMO term), neither of
 * which lives strictly under the genotype category. The typeahead
 * surfaces a category hint per row so the curator can disambiguate.
 */
export function StatementEditor({
  statement,
  factorCategory,
  onChange,
  onDelete,
}: {
  statement: Statement;
  /** The parent factor's category, used as the default for blank
   *  category chips and the comparison reference for the mismatch
   *  highlight. */
  factorCategory: OntologyTerm | null;
  onChange: (next: Statement) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const hasContent =
    !!statement.subject?.label?.trim() ||
    !!statement.predicate?.label?.trim() ||
    !!statement.object?.label?.trim();
  // Note: removed the baseline-subject green tinting that used to
  // highlight "wild type genotype" / "reference subject role" /
  // "control" / "initial time point". The FV-level baseline badge
  // already conveys that information; tinting the subject text was
  // redundant and inconsistent with how non-baseline subjects render
  // (no special colour).

  const cat = statement.category ?? null;
  const catMismatch =
    cat != null &&
    factorCategory != null &&
    (cat.label.trim().toLowerCase() !== factorCategory.label.trim().toLowerCase() ||
      (cat.uri ?? null) !== (factorCategory.uri ?? null));

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        className={
          "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border " +
          (catMismatch
            ? "bg-amber-50 border-amber-300 text-amber-900"
            : cat
              ? "bg-slate-50 border-slate-200 text-slate-600"
              : "bg-white border-dashed border-slate-300 text-slate-400")
        }
        title={
          catMismatch
            ? `Category differs from factor (${factorCategory?.label ?? "?"})`
            : "statement category"
        }
      >
        <CategoryPicker
          value={cat}
          placeholder={factorCategory?.label ?? "category"}
          onCommit={(next) => onChange({ ...statement, category: next })}
        />
      </span>

      <OntologyTermPicker
        value={statement.subject}
        category={null}
        searchCategory={cat?.label || factorCategory?.label || null}
        searchContext="subject"
        placeholder="subject"
        onCommit={(next) =>
          onChange({
            ...statement,
            subject: next ?? { label: "" },
          })
        }
      />
      {statement.subject.uri ? (
        <span className="text-[10px]">
          <CurieLink uri={statement.subject.uri} />
        </span>
      ) : null}

      <span className="inline-flex items-center gap-1">
        {/*
          Predicate select. When a predicate is picked it recedes to
          near-text styling so subject + object carry the visual
          weight. When empty it matches the object placeholder's
          dashed/italic chip — same affordance language as the
          neighbouring object slot so an unfilled statement reads as
          "fill in predicate, then object" rather than one loud
          control next to a quiet placeholder.
        */}
        <select
          className={
            "text-sm rounded px-1 py-0 cursor-pointer max-w-[14rem] " +
            (statement.predicate
              ? "bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 text-slate-700"
              : "italic font-normal border border-dashed border-slate-400 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 focus:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700")
          }
          value={statement.predicate?.uri ?? ""}
          onChange={(e) => {
            if (e.target.value === "") {
              onChange({ ...statement, predicate: null, object: null });
            } else {
              const def = PREDICATES.find((p) => p.uri === e.target.value)!;
              // ``def`` carries a ``description`` for the picker
              // tooltip; the on-wire ``Statement.predicate`` is just
              // ``{label, uri}`` so we project rather than spread.
              onChange({
                ...statement,
                predicate: { label: def.label, uri: def.uri },
                object: statement.object ?? { label: "" },
              });
            }
          }}
        >
          <option value="">predicate</option>
          {PREDICATES.map((p) => (
            <option key={p.uri} value={p.uri}>
              {p.label}
            </option>
          ))}
        </select>
        <GuidelinePopup snippet={PREDICATE_GUIDELINE} size="sm" />
      </span>

      {statement.predicate ? (
        <>
          <OntologyTermPicker
            value={statement.object ?? null}
            category={null}
            searchCategory={cat?.label || factorCategory?.label || null}
            searchContext="object"
            placeholder="object"
            onCommit={(next) =>
              onChange({
                ...statement,
                object: next,
              })
            }
          />
          {statement.object?.uri ? (
            <span className="text-[10px]">
              <CurieLink uri={statement.object.uri} />
            </span>
          ) : null}
        </>
      ) : null}

      {/* Statement delete — sits inline with the statement's S-P-O
          row, not right-edge-floated. Paul 2026-06-14: the
          ``ml-auto`` floated it to the same column as the FV-level
          Delete, so the two looked like duplicate buttons. Icon
          shape ("×") instead of a "Delete" pill so it doesn't
          compete with the larger FV-level Delete either. */}
      <button
        type="button"
        className="text-[12px] leading-none w-5 h-5 rounded text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-900/30 inline-flex items-center justify-center"
        onClick={() => {
          if (hasContent) setConfirming(true);
          else onDelete();
        }}
        title="Delete this statement"
        aria-label="delete statement"
      >
        ×
      </button>

      <ConfirmModal
        open={confirming}
        title="Remove statement"
        body={
          [
            statement.subject?.label,
            statement.predicate?.label,
            statement.object?.label,
          ]
            .filter(Boolean)
            .join(" · ")
        }
        confirmLabel="Delete"
        onConfirm={() => {
          onDelete();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Same-subject grouping.
//
// Gemma's Statement model is one (category, subject, predicate,
// object) triple per row. Multi-fact FactorValues — e.g. "Hazara
// virus infection delivered at dose 0.1 MOI and delivered for
// duration 48 h" — store this as N rows that share category + subject
// and differ only in predicate/object. Rendering each row with its
// own subject picker bloats the editor and visually splits one logical
// statement.
//
// `StatementGroupEditor` wraps a list of statements that already share
// (category, subject) and renders one shared header + N predicate/
// object rows. Editing the shared subject or category fans out to all
// statements in the group via per-row callbacks the parent threads
// back to the design.

export function StatementGroupEditor({
  statements,
  factorCategory,
  onChange,
  onDelete,
  onAddSibling,
}: {
  /** All statements sharing a (category, subject) within one FV.
   *  Length ≥ 2 — singleton groups go through ``StatementEditor``
   *  directly so we don't pay the wrapping-row layout cost for the
   *  common case. */
  statements: Statement[];
  factorCategory: OntologyTerm | null;
  /** Update statement at local index ``i`` (within this group). */
  onChange: (localIndex: number, next: Statement) => void;
  /** Delete statement at local index ``i``. */
  onDelete: (localIndex: number) => void;
  /** Add a new statement that shares this group's category + subject
   *  but starts with no predicate/object. */
  onAddSibling: () => void;
}) {
  const head = statements[0];
  const cat = head.category ?? null;
  const catMismatch =
    cat != null &&
    factorCategory != null &&
    (cat.label.trim().toLowerCase() !== factorCategory.label.trim().toLowerCase() ||
      (cat.uri ?? null) !== (factorCategory.uri ?? null));

  // Edits to category / subject fan out to every statement in the
  // group. The design draft's `apply` reducer is functional (#151)
  // so chained writes compose correctly.
  function setSharedCategory(next: OntologyTerm | null) {
    statements.forEach((s, i) => onChange(i, { ...s, category: next }));
  }
  function setSharedSubject(next: OntologyTerm | null) {
    const subject = next ?? { label: "" };
    statements.forEach((s, i) => onChange(i, { ...s, subject }));
  }

  /*
    Layout: [category] [subject] sit on a single row; the pred/obj
    pairs stack vertically in a column anchored to the right of the
    subject so the second predicate aligns under the first instead
    of wrap-positioning unpredictably (the previous flex-wrap
    layout could land pred2 underneath the *category* badge depending
    on subject + pred1+obj1 widths). Mirrors Gemma's table view
    semantics (one row per pred/obj pair under one subject) but
    keeps the curator's eye on the predicate column.

    Per-pair × delete is hover-revealed to keep each pair row
    scannable when the curator isn't actively editing.

    items-start (not items-center) on the outer flex so the category
    badge + subject picker pin to the top of the column when the
    pred/obj stack grows tall.
  */
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
      <span
        className={
          "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border " +
          (catMismatch
            ? "bg-amber-50 border-amber-300 text-amber-900"
            : cat
              ? "bg-slate-50 border-slate-200 text-slate-600"
              : "bg-white border-dashed border-slate-300 text-slate-400")
        }
        title={
          catMismatch
            ? `Category differs from factor (${factorCategory?.label ?? "?"})`
            : "statement category — applies to every predicate/object pair under this subject"
        }
      >
        <CategoryPicker
          value={cat}
          placeholder={factorCategory?.label ?? "category"}
          onCommit={setSharedCategory}
        />
      </span>

      <div className="inline-flex items-baseline gap-1 flex-wrap">
        <OntologyTermPicker
          value={head.subject}
          category={null}
          searchCategory={cat?.label || factorCategory?.label || null}
          searchContext="subject"
          placeholder="subject"
          onCommit={setSharedSubject}
        />
        {head.subject.uri ? (
          <span className="text-[10px]">
            <CurieLink uri={head.subject.uri} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        {statements.map((s, i) => (
          <InlinePredicateObjectPair
            key={i}
            statement={s}
            sharedCategory={cat?.label || factorCategory?.label || null}
            onChange={(next) => onChange(i, next)}
            onDelete={() => onDelete(i)}
          />
        ))}
        <button
          className="self-start text-[11px] text-slate-500 hover:text-slate-800 px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={onAddSibling}
          title="Add another predicate/object pair under this subject"
        >
          + pred/obj
        </button>
      </div>
    </div>
  );
}

/**
 * One (predicate, object) pair rendered inline as part of a
 * StatementGroupEditor. No subject; that's at the group level.
 * Delete affordance is hover-revealed to keep the wrapping row
 * uncluttered when the curator is just reading.
 */
function InlinePredicateObjectPair({
  statement,
  sharedCategory,
  onChange,
  onDelete,
}: {
  statement: Statement;
  /** Category shared at the group level — threaded so the object
   *  picker's "Search ontologies" affordance has a scope. */
  sharedCategory: string | null;
  onChange: (next: Statement) => void;
  onDelete: () => void;
}) {
  return (
    <span className="group inline-flex items-center gap-1">
      <select
        className={
          // Same chrome as the singleton StatementEditor — recedes
          // when populated, dashed/italic placeholder chip matching
          // the object slot when empty.
          "text-[11px] rounded px-0.5 py-0 cursor-pointer " +
          (statement.predicate
            ? "bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 text-slate-700"
            : "italic font-normal border border-dashed border-slate-400 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 focus:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700")
        }
        value={statement.predicate?.uri ?? ""}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange({ ...statement, predicate: null, object: null });
          } else {
            const def = PREDICATES.find((p) => p.uri === e.target.value)!;
            onChange({
              ...statement,
              predicate: { ...def },
              object: statement.object ?? { label: "" },
            });
          }
        }}
      >
        <option value="">predicate</option>
        {PREDICATES.map((p) => (
          <option key={p.uri} value={p.uri}>
            {p.label}
          </option>
        ))}
      </select>

      {statement.predicate ? (
        <>
          <OntologyTermPicker
            value={statement.object ?? null}
            category={null}
            searchCategory={sharedCategory}
            searchContext="object"
            placeholder="object"
            onCommit={(next) => onChange({ ...statement, object: next })}
          />
          {statement.object?.uri ? (
            <span className="text-[10px]">
              <CurieLink uri={statement.object.uri} />
            </span>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        // Always visible (was hover-hidden). Per-pair × is the
        // most-local "undo" for a curator who added an extra
        // predicate/object row they didn't mean to keep; hiding
        // it on hover meant the curator couldn't see how to back
        // out of a misclick.
        className="text-slate-400 hover:text-rose-700 text-xs px-1"
        onClick={onDelete}
        title="remove this predicate/object pair"
        aria-label="remove pair"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Walk a Factor Value's statements and bucket them by
 * ``(category.label + category.uri, subject.label + subject.uri)``.
 * Returns each bucket plus the original indices into the
 * statements array — the parent uses those to thread per-statement
 * mutations back through the design.
 */
export function groupStatementsBySubject(
  statements: Statement[],
): { statements: Statement[]; indices: number[] }[] {
  const buckets = new Map<
    string,
    { statements: Statement[]; indices: number[] }
  >();
  statements.forEach((s, i) => {
    const cat = s.category ?? null;
    const key =
      `${cat?.label ?? ""}|${cat?.uri ?? ""}|${s.subject.label}|${s.subject.uri ?? ""}`.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, { statements: [], indices: [] });
    const b = buckets.get(key)!;
    b.statements.push(s);
    b.indices.push(i);
  });
  return [...buckets.values()];
}
