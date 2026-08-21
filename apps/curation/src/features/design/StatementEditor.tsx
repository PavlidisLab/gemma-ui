import { useState } from "react";
import { CategoryPicker } from "./CategoryPicker";
import { OntologyTermPicker } from "./OntologyTermPicker";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { CurieLink } from "@/components/ui/CurieLink";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import {
  PREDICATE_GUIDELINE,
  STATEMENT_TEMPLATE_GUIDELINE,
} from "@/lib/guidelines";
import { shortenUri } from "@/lib/curie";
import {
  MAX_STATEMENT_PAIRS,
  statementGroupKey,
  statementHasPair,
  type OntologyTerm,
  type Statement,
} from "@/features/experiment/types";

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
/**
 * Resolve a statement's predicate URI to the matching `PREDICATES`
 * option URI, comparing by canonical CURIE rather than raw URI string.
 *
 * The `<select>` options carry `predicates.ts`'s canonical form
 * (`.../ont/TGEMO_00168`); a statement can arrive with the legacy
 * obo-purl form (`.../obo/TGEMO_00168`) — from a pre-namespace-migration
 * agent run or an older hand-authored template. `shortenUri` collapses
 * both to `TGEMO:00168`, so the dropdown selects the right option
 * instead of blanking to the placeholder.
 *
 * Returns the canonical option URI (the value the `<option>`s use), or
 * "" when the predicate is unknown / absent.
 */
export function canonicalPredicateUri(uri: string | null | undefined): string {
  if (!uri) return "";
  const exact = PREDICATES.find((p) => p.uri === uri);
  if (exact) return exact.uri;
  const curie = shortenUri(uri);
  const byCurie = PREDICATES.find((p) => shortenUri(p.uri) === curie);
  return byCurie ? byCurie.uri : "";
}

/**
 * The predicate ``<select>``, shared by the singleton
 * ``StatementEditor`` and the grouped ``InlinePredicateObjectPair``.
 *
 * Was copy-pasted between the two, with both copies carrying a
 * "same chrome as the other one" comment — and they had already
 * drifted once (the canonicalising ``value=`` landed on the singleton
 * first and had to be re-applied to the pair row months later, design
 * review 2026-07-20). One control now, two callers.
 *
 * The empty option does double duty: it is the placeholder while no
 * predicate is chosen, and it is the way to REMOVE one afterwards.
 * Leaving it labelled "predicate" in both states hid the removal path
 * entirely — a curator with a wrong predicate/object pair could see no
 * way out of it but the statement-level delete, which throws away the
 * subject too (2026-08-20). So when a predicate IS set the option names
 * what it does, including the object it takes with it: clearing the
 * predicate without clearing the object would leave a dangling object
 * with nothing to attach it to, which the wire has no shape for.
 */
function PredicateSelect({
  statement,
  size,
  onChange,
}: {
  statement: Statement;
  /** ``md`` — the singleton row. ``sm`` — a stacked pair inside a
   *  ``StatementGroupEditor``, where the subject column already sets
   *  the row height. */
  size: "md" | "sm";
  onChange: (next: Statement) => void;
}) {
  return (
    <select
      className={
        // Populated: recedes to near-text so subject + object carry
        // the visual weight. Empty: dashed/italic chip matching the
        // object placeholder next to it, so an unfilled statement
        // reads as "fill in predicate, then object" rather than one
        // loud control beside a quiet placeholder.
        (size === "md"
          ? "text-sm rounded px-1 py-0 cursor-pointer max-w-[14rem] "
          : "text-[11px] rounded px-0.5 py-0 cursor-pointer ") +
        (statement.predicate
          ? "bg-transparent border border-transparent hover:border-slate-300 focus:border-slate-400 text-slate-700"
          : "italic font-normal border border-dashed border-slate-400 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 focus:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700")
      }
      // Canonicalise so a legacy obo-purl predicate URI
      // (``…/obo/TGEMO_00167``) still selects its ``…/ont/…`` option
      // instead of blanking to the placeholder.
      value={canonicalPredicateUri(statement.predicate?.uri)}
      title={
        statement.predicate
          ? `${statement.predicate.label} — pick “none” to remove this predicate and its object`
          : "Link this subject to an object. The subject on its own is a complete statement; a predicate is optional."
      }
      onChange={(e) => {
        if (e.target.value === "") {
          onChange({ ...statement, predicate: null, object: null });
        } else {
          const def = PREDICATES.find((p) => p.uri === e.target.value)!;
          // ``def`` carries a ``description`` for the picker tooltip;
          // the on-wire ``Statement.predicate`` is just ``{label, uri}``
          // so we project rather than spread.
          onChange({
            ...statement,
            predicate: { label: def.label, uri: def.uri },
            object: statement.object ?? { label: "" },
          });
        }
      }}
    >
      <option value="">
        {statement.predicate ? "— none (removes object) —" : "predicate"}
      </option>
      {PREDICATES.map((p) => (
        <option key={p.uri} value={p.uri}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

export function StatementEditor({
  statement,
  factorCategory,
  onChange,
  onDelete,
  onAddSibling,
}: {
  statement: Statement;
  /** The parent factor's category, used as the default for blank
   *  category chips and the comparison reference for the mismatch
   *  highlight. */
  factorCategory: OntologyTerm | null;
  onChange: (next: Statement) => void;
  onDelete: () => void;
  /** Add another predicate/object pair about THIS statement's subject.
   *  When provided (and the subject is named) a "+ pred/obj" link
   *  renders inline — the singleton-statement counterpart of the
   *  ``StatementGroupEditor`` button, so a subject that currently has
   *  one predicate isn't a dead-end for adding a second. Optional. */
  onAddSibling?: () => void;
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
        <PredicateSelect statement={statement} size="md" onChange={onChange} />
        <GuidelinePopup snippet={PREDICATE_GUIDELINE} size="sm" />
        {/* The predicate popup answers "is this predicate legal here";
            the templates popup answers "what is the whole composed
            shape". Both belong on the predicate row — that's where a
            curator is standing when either question comes up — but two
            bare `?` marks side by side say nothing about which is
            which, so the second one carries a word. */}
        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
          shapes
          <GuidelinePopup snippet={STATEMENT_TEMPLATE_GUIDELINE} size="sm" />
        </span>
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
          row, not right-edge-floated. Design review 2026-06-14: the
          ``ml-auto`` floated it to the same column as the FV-level
          Delete, so the two looked like duplicate buttons.

          It carries the word "statement" (2026-08-20). A bare "×"
          sitting between the predicate dropdown and "+ pred/obj" reads
          as "remove the predicate/object" — the thing immediately to
          its left — and it does something much bigger: it throws away
          the subject and the whole row. It stays a text link rather
          than a pill so it still doesn't compete with the FV-level
          Delete, and it now mirrors the "+ statement" affordance
          directly below the card. */}
      <button
        type="button"
        className="text-[11px] leading-none px-1 py-0.5 rounded text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-900/30 inline-flex items-center gap-0.5"
        onClick={() => {
          if (hasContent) setConfirming(true);
          else onDelete();
        }}
        title="Delete this whole statement — subject, predicate and object. To drop only the predicate and object, set the predicate to “none”."
        aria-label="delete statement"
      >
        <span aria-hidden>×</span>
        <span>statement</span>
      </button>

      {/* "+ pred/obj" — add a second predicate/object about the same
          subject. Only offered once the subject is named (adding a
          predicate to a blank subject is meaningless). Adding one
          promotes this singleton into a StatementGroupEditor, which
          then carries its own "+ pred/obj" for any further pairs. */}
      {onAddSibling && statement.subject?.label?.trim() ? (
        <button
          type="button"
          className="text-[11px] text-slate-500 hover:text-slate-800 px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={onAddSibling}
          title="Add another predicate/object pair about this subject"
        >
          + pred/obj
        </button>
      ) : null}

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
  // Full once the group holds the wire's two rows. Counted on ROWS,
  // not on rows-with-a-pair: each row is a slot, and a freshly-added
  // blank one is a slot already claimed. Counting only filled rows
  // let a curator stack blanks past the ceiling and fill them in
  // afterwards, which is the same third pair by a slower route.
  const atPairLimit = statements.length >= MAX_STATEMENT_PAIRS;
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
            // 🛑 Past the ceiling. The editor's "+ pred/obj" cannot
            // build a third pair, so any group that HAS one arrived
            // from an agent proposal or an older snapshot — and until
            // now it rendered identically to the two legal rows, so the
            // curator being asked to "split the extras" could not see
            // which row was the extra. Paul, 2026-08-20: *"if that
            // happens, the ui has to warn. Gemma only supports 2."*
            overLimit={i >= MAX_STATEMENT_PAIRS}
            onChange={(next) => onChange(i, next)}
            onDelete={() => onDelete(i)}
          />
        ))}
        {statements.length > MAX_STATEMENT_PAIRS ? (
          <div className="text-[10px] text-amber-800 dark:text-amber-200">
            Gemma stores {MAX_STATEMENT_PAIRS} pairs per subject — the{" "}
            {statements.length - MAX_STATEMENT_PAIRS === 1
              ? "marked one has"
              : `${statements.length - MAX_STATEMENT_PAIRS} marked ones have`}{" "}
            nowhere to land and would be dropped on write. Move{" "}
            {statements.length - MAX_STATEMENT_PAIRS === 1 ? "it" : "them"} to a
            separate statement with “+ statement”.
          </div>
        ) : null}
        {/* Capped at ``MAX_STATEMENT_PAIRS``. Gemma holds two
            predicate/object slots per subject and no third, so a
            stacked pair beyond that has nowhere to land. Disabled
            rather than hidden: a curator hunting for the affordance
            should be told the ceiling exists, not left wondering
            where the button went. */}
        <button
          className={
            "self-start text-[11px] px-1 py-0.5 rounded " +
            (atPairLimit
              ? "text-slate-300 cursor-not-allowed dark:text-slate-600"
              : "text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800")
          }
          disabled={atPairLimit}
          aria-disabled={atPairLimit}
          onClick={atPairLimit ? undefined : onAddSibling}
          title={
            atPairLimit
              ? `A subject carries at most ${MAX_STATEMENT_PAIRS} predicate/object pairs — Gemma has no third slot. Use a separate statement for a further claim.`
              : "Add another predicate/object pair under this subject"
          }
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
  overLimit = false,
  onChange,
  onDelete,
}: {
  statement: Statement;
  /** Category shared at the group level — threaded so the object
   *  picker's "Search ontologies" affordance has a scope. */
  sharedCategory: string | null;
  /** This pair sits past Gemma's two-slot ceiling and has nowhere to
   *  land on write. Marked rather than hidden — it is real curation
   *  that someone entered, and hiding it would lose it silently, which
   *  is the failure this marker exists to make visible. */
  overLimit?: boolean;
  onChange: (next: Statement) => void;
  onDelete: () => void;
}) {
  return (
    <span
      className={
        "group inline-flex items-center gap-1" +
        (overLimit
          ? " rounded border border-dashed border-amber-500 bg-amber-50 px-1 dark:border-amber-500/70 dark:bg-amber-900/20"
          : "")
      }
      title={
        overLimit
          ? "No slot for this in Gemma — it holds two predicate/object pairs per subject. Move it to its own statement or it is dropped on write."
          : undefined
      }
    >
      <PredicateSelect statement={statement} size="sm" onChange={onChange} />

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
  opts?: { dropBareWithReal?: boolean },
): { statements: Statement[]; indices: number[] }[] {
  // Whether to drop "bare" (subject-only, no predicate/object)
  // siblings from a group that also carries a real statement.
  //
  // In the **read-only / compact** view this is right — a bare row
  // there is pure noise (a dangling empty predicate) and often a data
  // artifact (see below). But in the **editable** view an empty
  // predicate/object row is a legitimate, intentional thing: it's
  // exactly what the "+ pred/obj" affordance adds so the curator can
  // fill in a second predicate. Dropping it there made "+ pred/obj"
  // silently no-op on any subject that already had a predicate (the
  // freshly-added row was hidden before the curator could touch it).
  // So the editable caller passes ``false``. Design review 2026-07-21.
  const dropBareWithReal = opts?.dropBareWithReal ?? true;
  const buckets = new Map<
    string,
    { statements: Statement[]; indices: number[] }
  >();
  statements.forEach((s, i) => {
    const key = statementGroupKey(s);
    if (!buckets.has(key)) buckets.set(key, { statements: [], indices: [] });
    const b = buckets.get(key)!;
    b.statements.push(s);
    b.indices.push(i);
  });
  // Drop redundant "bare" statements — a subject with NO predicate and
  // NO object — from any group that also carries a real (predicate/object)
  // statement. These are spurious subject-only rows (a data artifact:
  // e.g. GSE36409's metformin FV ships both ``metformin —delivered for
  // duration→ 30 d`` and a second ``metformin`` with null predicate +
  // object) that otherwise render as a dangling empty predicate editor.
  // A group that is ENTIRELY bare keeps one row — that's the normal
  // "subject with no predicate yet" add-a-predicate affordance. Indices
  // stay aligned to the surviving statements so mutations map correctly.
  // Design review 2026-07-20. Gated on ``dropBareWithReal`` (2026-07-21) so the
  // editable view can keep its in-progress "+ pred/obj" rows.
  const isBare = (s: Statement) => !statementHasPair(s);
  return [...buckets.values()].map((g) => {
    if (!dropBareWithReal) return g;
    if (!g.statements.some((s) => !isBare(s))) return g;
    const statements: Statement[] = [];
    const indices: number[] = [];
    g.statements.forEach((s, k) => {
      if (isBare(s)) return;
      statements.push(s);
      indices.push(g.indices[k]);
    });
    return { statements, indices };
  });
}
