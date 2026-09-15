import { groupStatementsBySharedSubject } from "@gemma/ontology";
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
 * separate treatments. A subject needing more than two pairs is also
 * stored as two separate statements (GSE244113 FV 368965: `protein ·
 * derives from · Gzmb` and `protein · delivered at dose · … · delivered
 * for duration · …`); those share a line the same way.
 *
 * The matching rule — category, then subject, each by URI when both
 * carry one and by label otherwise — lives in `@gemma/ontology`
 * (`groupStatementsBySharedSubject`), shared with the curation app's
 * display surfaces. This adapts the browser's flat string shape to it.
 *
 * Order is preserved: groups come back in the order their first
 * statement appeared, and pairs within a group keep their wire order.
 */
export interface StatementGroup {
  /** The shared subject: from the first statement in the group that
   *  carries a subject URI, else from the first statement. */
  subject: string | null;
  subjectUri: string | null;
  /** Every statement sharing that subject, in wire order. Always at
   *  least one. */
  statements: FactorValueStatement[];
}

export function groupStatementsBySubject(
  statements: readonly FactorValueStatement[] | null | undefined,
): StatementGroup[] {
  const list = (statements ?? []).filter(Boolean);
  const shaped = list.map((s) => ({
    category: { label: s.category, uri: s.categoryUri },
    subject: { label: s.subject, uri: s.subjectUri },
  }));
  return groupStatementsBySharedSubject(shaped).map((g) => {
    const members = g.indices.map((i) => list[i]);
    const shown =
      members.find((s) => (s.subjectUri ?? "").trim()) ?? members[0];
    return {
      subject: shown.subject ?? null,
      subjectUri: shown.subjectUri ?? null,
      statements: members,
    };
  });
}

/** Does this statement carry anything to say ABOUT its subject? A row
 *  with neither predicate nor object names the subject and stops there,
 *  which is a complete statement on its own and renders as just the
 *  chip. */
export function statementHasPair(s: FactorValueStatement): boolean {
  return !!(s.predicate || s.predicateUri || s.object || s.objectUri);
}
