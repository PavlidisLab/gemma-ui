/**
 * Recover the (subject, predicate/object pairs) structure of a
 * statement-shaped dataset annotation from `GET
 * /rest/v2/datasets/{id}/annotations`.
 *
 * That endpoint doesn't expose a separate subject-LABEL field for a
 * statement row: `termUri` is the subject's own URI, but `termName`
 * is a server-composed natural-language string, and its composition
 * isn't one fixed format. Verified against gemma2.msl.ubc.ca
 * 2026-08-30 — three shapes seen on real rows:
 *
 *   - object(s) + subject, double-space joined, predicate dropped:
 *     `"Homozygous negative  Il10 [mouse] interleukin 10"`
 *     (subject "Il10 [mouse] interleukin 10", predicate
 *     "has_genotype", object "Homozygous negative")
 *   - subject + predicate + object, single-space, predicate spelled
 *     out: `"brain has role reference subject role"`
 *   - subject + paraphrased predicate + object:
 *     `"astrocytic tumor with grade II"` (predicate "has modifier"
 *     rendered as "with")
 *
 * Only the first shape is mechanically reversible: subtracting the
 * known object (and secondObject) text from the FRONT of `termName`
 * leaves exactly the subject behind. The other two aren't — there's
 * no reliable way to tell "has role" was dropped vs. paraphrased vs.
 * kept without matching against a vocabulary this module doesn't
 * have. So this only returns a structured statement when the
 * subtraction round-trips exactly; otherwise it returns `null` and
 * the caller keeps rendering `termName` verbatim (today's behaviour,
 * never worse — only better where it's provably right).
 */
import type { DatasetAnnotation } from "./types";
import type { StatementPair } from "@/components/OntologyTermChip";

export interface AnnotationStatement {
  subject: string;
  subjectUri: string | null;
  pairs: StatementPair[];
}

export function parseAnnotationStatement(
  a: DatasetAnnotation,
): AnnotationStatement | null {
  const hasFirstPair = !!(a.predicate || a.predicateUri || a.object || a.objectUri);
  if (!hasFirstPair) return null;

  const expectedPrefix = [a.object, a.secondObject]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  // Nothing concrete to anchor the split on (a predicate with no
  // object text at all) — can't tell subject apart from termName with
  // any confidence.
  if (expectedPrefix.length === 0) return null;

  const segments = (a.termName ?? "").trim().split(/ {2,}/).map((s) => s.trim());
  const prefixMatches =
    segments.length === expectedPrefix.length + 1 &&
    expectedPrefix.every((seg, i) => segments[i] === seg);
  if (!prefixMatches) return null;

  const subject = segments[segments.length - 1];
  if (!subject) return null;

  const pairs: StatementPair[] = [
    {
      predicate: a.predicate ?? null,
      predicateUri: a.predicateUri ?? null,
      object: a.object ?? null,
      objectUri: a.objectUri ?? null,
    },
  ];
  if (a.secondPredicate || a.secondPredicateUri || a.secondObject || a.secondObjectUri) {
    pairs.push({
      predicate: a.secondPredicate ?? null,
      predicateUri: a.secondPredicateUri ?? null,
      object: a.secondObject ?? null,
      objectUri: a.secondObjectUri ?? null,
    });
  }

  return { subject, subjectUri: a.termUri ?? null, pairs };
}
