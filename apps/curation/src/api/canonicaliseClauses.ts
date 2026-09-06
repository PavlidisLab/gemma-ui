/**
 * The commit path's one-call wrapper around clause canonicalisation.
 *
 * Kept apart from `canonicalLabels.ts` so the pure half — what to
 * collect, what to rewrite — stays testable without a network, and this
 * half owns the only decision that needs one: what to do when the
 * canonicaliser cannot answer.
 *
 * 🛑 **A failed validation must not block the commit.** The pre-existing
 * behaviour is that most documents commit fine; canonicalisation repairs
 * the minority that Gemma would refuse. If `/validate-terms` is down,
 * slow or 404s, sending the document unmodified restores exactly the
 * behaviour we had an hour ago — the affected datasets fail with Gemma's
 * own `LABEL_MISMATCH`, which is a clear message naming the term. Failing
 * the commit instead would turn a partial outage into a total one, and
 * take out the datasets that never needed the repair.
 */
import { collectStatementTerms, applyCanonicalLabels } from "./canonicalLabels";
import type { CurationDocument } from "./curationCommit";
import { validateTerms } from "./validateTerms";

export async function canonicaliseClauses(
  doc: CurationDocument,
): Promise<CurationDocument> {
  const items = collectStatementTerms(doc);
  if (items.length === 0) return doc;
  try {
    const { results } = await validateTerms(items);
    return applyCanonicalLabels(doc, results ?? []);
  } catch {
    // See the header: unmodified is the honest fallback, and Gemma's
    // own 400 is a better error than one we would invent here.
    return doc;
  }
}
