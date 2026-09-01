/**
 * The (subject, predicate/object pairs) structure of a statement-shaped
 * dataset annotation from `GET /rest/v2/datasets/{id}/annotations`.
 *
 * 🛑 **`value` IS the subject.** Gemma's `731ecfa1d0` did not add a
 * field called `subject` — it gave `value` that meaning, with the
 * predicate and object staying in their own fields, and the VO's
 * javadoc pins it: *"On a Statement row this is the subject's label …
 * this field never carries a composed sentence."* Verified live on
 * gemma2 `e9dd6b7f7b`:
 *
 *     value "hypochlorous acid" · predicate "delivered at dose" · object "0.4 mM"
 *     value "Prkaa2 [mouse] …"  · predicate "has_genotype"      · object "Homozygous negative"
 *
 * So there is nothing to parse. This module reads three fields.
 *
 * 🛑 **Do not go looking for a field named `subject`** — that probe is
 * what cost a day here. A field list cannot show a change that put new
 * meaning into an existing field, and eid 38390, the obvious dataset to
 * sample, has sixteen annotations and ZERO statement rows.
 *
 * **What used to be here.** ~90 lines recovering the subject by
 * subtracting the object text out of `termName`, because the wire
 * carried no subject label. It handled two of the three ways Gemma
 * composed that string and refused the third — 13 of 23 statement rows
 * across a 15-dataset sample. Deleted 2026-09-01 now that `value`
 * carries the subject on every row measured (0 of 14 statement rows
 * across four datasets lacked it).
 *
 * A row from a server that never sends `value` returns null and the
 * caller renders `termName` verbatim — today's behaviour for anything
 * unparseable, so an older host degrades rather than breaks.
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
  // No pair means it is a plain characteristic, not a statement.
  const hasFirstPair = !!(a.predicate || a.predicateUri || a.object || a.objectUri);
  if (!hasFirstPair) return null;
  // Absent only on a server predating the rename; the caller falls
  // back to rendering `termName`.
  if (!a.value) return null;
  return {
    subject: a.value,
    subjectUri: a.valueUri ?? a.termUri ?? null,
    pairs: pairsOf(a),
  };
}

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
