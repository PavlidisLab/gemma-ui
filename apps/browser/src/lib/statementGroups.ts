import type { FactorValueStatement } from "./types";

/**
 * Group a factor value's S-P-O statements by the thing they are about.
 *
 * Gemma stores statements FLAT — one row per (predicate, object) pair,
 * repeating the category and subject — so a value like
 *
 *     GSK2879552 delivered for duration 2 d and delivered at dose 1 µM
 *
 * arrives as TWO rows both naming GSK2879552. Rendered one row per
 * statement, the dataset page printed the subject chip and its CURIE
 * twice, once per pair, and a value with three pairs read as three
 * separate treatments.
 *
 * 🛑 The curation app has the same rule, spelled for its own types, in
 * `features/design/StatementEditor.tsx::groupStatementsBySubject`. That
 * one keys on `(category, subject)` over `OntologyTerm` objects; this
 * one keys the same way over the browser's flat string shape. They are
 * deliberately separate — the two apps do not share a statement type,
 * and reconciling that is a bigger change than a display fix — but if
 * the grouping RULE changes, both have to move.
 *
 * Order is preserved: groups come back in the order their first
 * statement appeared, and pairs within a group keep their wire order.
 */
export interface StatementGroup {
  /** The shared subject, taken from the first statement in the group. */
  subject: string | null;
  subjectUri: string | null;
  /** Every statement sharing that subject, in wire order. Always at
   *  least one. */
  statements: FactorValueStatement[];
}

/** `(category, subject)`, label + URI, case-folded.
 *
 *  Category is part of the key on purpose. A statement's category may
 *  legitimately differ from its factor's, so two rows naming the same
 *  subject under different categories are two different claims and must
 *  not be merged into one line. */
function groupKey(s: FactorValueStatement): string {
  return [
    s.category ?? "",
    s.categoryUri ?? "",
    s.subject ?? "",
    s.subjectUri ?? "",
  ]
    .join("|")
    .toLowerCase();
}

export function groupStatementsBySubject(
  statements: readonly FactorValueStatement[] | null | undefined,
): StatementGroup[] {
  const out: StatementGroup[] = [];
  const byKey = new Map<string, StatementGroup>();
  for (const s of statements ?? []) {
    if (!s) continue;
    const key = groupKey(s);
    let g = byKey.get(key);
    if (!g) {
      g = {
        subject: s.subject ?? null,
        subjectUri: s.subjectUri ?? null,
        statements: [],
      };
      byKey.set(key, g);
      out.push(g);
    }
    g.statements.push(s);
  }
  return out;
}

/** Does this statement carry anything to say ABOUT its subject? A row
 *  with neither predicate nor object names the subject and stops there,
 *  which is a complete statement on its own and renders as just the
 *  chip. */
export function statementHasPair(s: FactorValueStatement): boolean {
  return !!(s.predicate || s.predicateUri || s.object || s.objectUri);
}
