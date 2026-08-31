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

/** The three predicates Gemma strips from `termName` entirely — clause
 *  and all — so a tag list reads as terms rather than protocol detail
 *  (`ExpressionExperimentReadServiceImpl`'s `ignoredPredicates`).
 *
 *  🛑 **The object is still on the wire.** `AnnotationValueObject`'s
 *  constructor populates `predicate` / `object` straight from the
 *  Statement, unconditionally; `ignoredPredicates` touches only the
 *  composed string. So `dexamethasone delivered at dose 10 µM` arrives
 *  as `termName: "dexamethasone"` with `object: "10 µM"` intact.
 *
 *  That makes these rows the EASY case, not the hard one: because the
 *  clause was removed rather than paraphrased, `termName` is already
 *  the bare subject label and needs no recovery. Measured across 15
 *  datasets, they are 8 of 23 statement rows — and they carry exactly
 *  the quantitative detail that distinguishes otherwise-identical
 *  experiments. Two rows both reading `prime adult stage` are 6-month
 *  mice and 20-31-year-old humans; without the object the page cannot
 *  tell them apart. */
const CLAUSE_STRIPPED_PREDICATES = new Set([
  "http://gemma.msl.ubc.ca/ont/TGEMO_00166", // delivered at dose
  "http://gemma.msl.ubc.ca/ont/TGEMO_00167", // delivered for duration
  "http://gemma.msl.ubc.ca/ont/TGEMO_00168", // has developmental stage
]);

const isStripped = (uri: string | null | undefined) =>
  CLAUSE_STRIPPED_PREDICATES.has((uri ?? "").trim());

export function parseAnnotationStatement(
  a: DatasetAnnotation,
): AnnotationStatement | null {
  const hasFirstPair = !!(a.predicate || a.predicateUri || a.object || a.objectUri);
  if (!hasFirstPair) return null;

  // Every clause on this row was stripped, so `termName` is the subject
  // verbatim. Requiring ALL of them — a row mixing a stripped clause
  // with a composed one still has the composed one inside `termName`,
  // and using it as the subject would print that clause twice.
  const hasSecond = !!(
    a.secondPredicate ||
    a.secondPredicateUri ||
    a.secondObject ||
    a.secondObjectUri
  );
  if (
    isStripped(a.predicateUri) &&
    (!hasSecond || isStripped(a.secondPredicateUri))
  ) {
    const subject = (a.termName ?? "").trim();
    if (subject) return { subject, subjectUri: a.termUri ?? null, pairs: pairsOf(a) };
  }

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

  const pairs = pairsOf(a);

  return { subject, subjectUri: a.termUri ?? null, pairs };
}

/** The one or two predicate/object pairs a row carries. */
function pairsOf(a: DatasetAnnotation): StatementPair[] {
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
  return pairs;
}
