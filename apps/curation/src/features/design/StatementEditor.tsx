import { useState } from "react";
import { CategoryPicker } from "./CategoryPicker";
import { OntologyTermPicker } from "./OntologyTermPicker";
import { FindTermButton } from "./FindTermButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { shortenUri } from "@/lib/curie";
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
        placeholder="subject"
        onCommit={(next) =>
          onChange({
            ...statement,
            subject: next ?? { label: "" },
          })
        }
      />
      {statement.subject.uri ? (
        <span className="text-slate-400 text-[10px]">
          {shortenUri(statement.subject.uri)}
        </span>
      ) : statement.subject.label?.trim() &&
        (cat?.label || factorCategory?.label) ? (
        // Free-text subject — surface the find-term agent next to it.
        // Hidden once the picker resolves to a URI; also hidden when
        // there's no category to scope the search against.
        <FindTermButton
          currentLabel={statement.subject.label}
          category={(cat?.label || factorCategory?.label) ?? ""}
          context="subject"
          onPick={(term) =>
            onChange({
              ...statement,
              subject: term,
            })
          }
        />
      ) : null}

      <span className="inline-flex items-center gap-1">
        {/*
          Predicate select recedes to near-text styling — bordered
          chrome only on hover/focus, slate-500 italic when empty so
          "(no predicate)" reads as a hint, not a control. Subject
          and object carry the visual weight of the statement.
          ``text-sm`` matches the surrounding statement text so the
          predicate doesn't visually shrink between the subject and
          object terms.
        */}
        <select
          className={
            "text-sm rounded px-1 py-0 bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 cursor-pointer max-w-[14rem] " +
            (statement.predicate
              ? "text-slate-700"
              : "text-slate-400 italic")
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
          <option value="">(no predicate)</option>
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
            placeholder="object"
            onCommit={(next) =>
              onChange({
                ...statement,
                object: next,
              })
            }
          />
          {statement.object?.uri ? (
            <span className="text-slate-400 text-[10px]">
              {shortenUri(statement.object.uri)}
            </span>
          ) : statement.object?.label?.trim() &&
            (cat?.label || factorCategory?.label) ? (
            <FindTermButton
              currentLabel={statement.object.label}
              category={(cat?.label || factorCategory?.label) ?? ""}
              context="object"
              onPick={(term) =>
                onChange({
                  ...statement,
                  object: term,
                })
              }
            />
          ) : null}
        </>
      ) : null}

      <button
        className="btn ghost text-xs text-rose-700 ml-auto"
        onClick={() => {
          if (hasContent) setConfirming(true);
          else onDelete();
        }}
      >
        remove
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
        confirmLabel="remove"
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
          placeholder="subject"
          onCommit={setSharedSubject}
        />
        {head.subject.uri ? (
          <span className="text-slate-400 text-[10px]">
            {shortenUri(head.subject.uri)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        {statements.map((s, i) => (
          <InlinePredicateObjectPair
            key={i}
            statement={s}
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
  onChange,
  onDelete,
}: {
  statement: Statement;
  onChange: (next: Statement) => void;
  onDelete: () => void;
}) {
  return (
    <span className="group inline-flex items-center gap-1">
      <select
        className={
          // Same near-text styling as the singleton StatementEditor —
          // recedes when empty so subject/object carry the eye.
          "text-[11px] rounded px-0.5 py-0 bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 cursor-pointer " +
          (statement.predicate
            ? "text-slate-700"
            : "text-slate-400 italic")
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
        <option value="">(no predicate)</option>
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
            placeholder="object"
            onCommit={(next) => onChange({ ...statement, object: next })}
          />
          {statement.object?.uri ? (
            <span className="text-slate-400 text-[10px]">
              {shortenUri(statement.object.uri)}
            </span>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="text-rose-700 text-xs opacity-0 group-hover:opacity-100 px-1"
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
