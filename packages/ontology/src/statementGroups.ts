/**
 * Which of a factor value's statements are about the same thing, so a
 * display can write the subject once.
 *
 * Gemma holds at most two (predicate, object) pairs per statement, so a
 * subject that needs three is stored as two statements repeating the
 * subject:
 *
 *     protein · derives from · Gzmb [mouse] granzyme B
 *     protein · delivered at dose · 500 ng/mL · delivered for duration · 20 h
 *
 * (GSE244113, FV 368965, statements 56988464 and 56988465). Shown to a
 * reader, that is one subject with three things said about it, and the
 * subject is written once. The stored data keeps both statements; this
 * is display grouping only.
 *
 * Two statements share a subject when their categories match and their
 * subjects match, each compared with {@link sameStatementTerm}. A
 * statement with no category at all matches any category. A statement
 * with no subject shares it with nothing.
 *
 * 🛑 Display only. The curation design editor groups with its own exact
 * `(category, subject)` key (`statementGroupKey`), because an edit to a
 * group's subject is applied to every row in the group; loosening that
 * key would change what an edit writes, not just what is shown.
 */

export interface StatementTermLike {
  label?: string | null;
  uri?: string | null;
}

export interface SubjectGroupable {
  category?: StatementTermLike | null;
  subject?: StatementTermLike | null;
}

export interface SubjectGroup<T> {
  /** The statements sharing one subject, in input order. Never empty. */
  statements: T[];
  /** Each statement's index in the input array. */
  indices: number[];
}

/** The URI when both terms carry one; otherwise the label, trimmed and
 *  case-folded. */
export function sameStatementTerm(
  a: StatementTermLike | null | undefined,
  b: StatementTermLike | null | undefined,
): boolean {
  const ua = (a?.uri ?? "").trim().toLowerCase();
  const ub = (b?.uri ?? "").trim().toLowerCase();
  if (ua && ub) return ua === ub;
  return (
    (a?.label ?? "").trim().toLowerCase() ===
    (b?.label ?? "").trim().toLowerCase()
  );
}

function isBlank(t: StatementTermLike | null | undefined): boolean {
  return !(t?.label ?? "").trim() && !(t?.uri ?? "").trim();
}

function sameSubject(a: SubjectGroupable, b: SubjectGroupable): boolean {
  if (isBlank(a.subject) || isBlank(b.subject)) return false;
  if (!isBlank(a.category) && !isBlank(b.category)) {
    if (!sameStatementTerm(a.category, b.category)) return false;
  }
  return sameStatementTerm(a.subject, b.subject);
}

/** Bucket statements by shared subject. Groups come back in the order
 *  of their first statement; each statement joins the first group whose
 *  first statement it shares a subject with. */
export function groupStatementsBySharedSubject<T extends SubjectGroupable>(
  statements: readonly T[] | null | undefined,
): SubjectGroup<T>[] {
  const groups: SubjectGroup<T>[] = [];
  (statements ?? []).forEach((s, i) => {
    if (!s) return;
    const g = groups.find((grp) => sameSubject(grp.statements[0], s));
    if (g) {
      g.statements.push(s);
      g.indices.push(i);
    } else {
      groups.push({ statements: [s], indices: [i] });
    }
  });
  return groups;
}
