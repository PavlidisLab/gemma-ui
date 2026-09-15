import { statementsShareSubject } from "@gemma/ontology";
import type {
  DatasetAnnotation,
  DatasetAnnotationPair,
  ExperimentalDesign,
} from "./types";

/**
 * The dataset Overview's annotation chips, trimmed for an overview.
 *
 * Three changes from the flat annotation list:
 *
 * 1. Quantity pairs are left out: dose, duration and time to sampling
 *    (`delivered at dose`, `delivered for duration`, `sampled after`).
 *    The Design tab still shows them.
 * 2. Rows on ONE factor value that share a subject become one chip with
 *    the subject once. Gemma holds two pairs per statement, so a subject
 *    with more is stored as two statements, and this route serves each
 *    as its own row: GSE244113 FV 368965 arrives as
 *    `protein · derives from · Gzmb` and
 *    `protein · delivered at dose · 500 ng/mL · delivered for duration · 20 h`.
 * 3. Chips left identical once quantities are gone are shown once —
 *    `amniotic fluid` at two doses is one chip here.
 *
 * Joining is per factor value on purpose. The same subject on two
 * different values is two levels of the design, and when what remains
 * differs they stay two chips: dataset 27773's two `Tardbp` treatments
 * differ only by `has modifier → peptide 15` vs `peptides 10 and 12`.
 *
 * Rows are traced to their factor value through the design endpoint,
 * whose statements carry the same ids. A row that can't be traced (an
 * experiment tag, or the design not loaded) is never joined, only
 * de-duplicated.
 */

/** Local ids of the quantity predicates, matched on the URI's local
 *  name so both TGEMO namespaces count. */
const QUANTITY_PREDICATE_IDS = new Set([
  "TGEMO_00166", // delivered at dose
  "TGEMO_00167", // delivered for duration
  "TGEMO_00202", // sampled after
]);
const QUANTITY_PREDICATE_LABELS = new Set([
  "delivered at dose",
  "delivered for duration",
  "sampled after",
]);

export function isQuantityPair(p: DatasetAnnotationPair): boolean {
  const uri = (p.predicateUri ?? "").trim();
  if (uri) {
    const local = uri.match(/(TGEMO_\d+)$/)?.[1];
    return !!local && QUANTITY_PREDICATE_IDS.has(local);
  }
  return QUANTITY_PREDICATE_LABELS.has((p.predicate ?? "").trim().toLowerCase());
}

/** Statement / characteristic id → factor value id, from the design. */
export function factorValueIdByStatementId(
  design: ExperimentalDesign | null | undefined,
): Map<number, number> {
  const m = new Map<number, number>();
  for (const f of design?.experimentalFactors ?? []) {
    for (const v of f.values ?? []) {
      if (v.id == null) continue;
      for (const s of v.statements ?? []) {
        if (typeof s.id === "number") m.set(s.id, v.id);
      }
      for (const c of v.characteristics ?? []) {
        if (typeof c.id === "number") m.set(c.id, v.id);
      }
    }
  }
  return m;
}

function asSubject(a: DatasetAnnotation) {
  return {
    category: { label: a.className, uri: a.classUri },
    subject: { label: a.termName, uri: a.termUri },
  };
}

function pairKey(p: DatasetAnnotationPair): string {
  return [p.predicateUri || p.predicate || "", p.objectUri || p.object || ""]
    .join("|")
    .toLowerCase();
}

function samePairs(a: DatasetAnnotationPair[], b: DatasetAnnotationPair[]): boolean {
  const ka = new Set(a.map(pairKey));
  const kb = new Set(b.map(pairKey));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

export function overviewAnnotations(
  annotations: readonly DatasetAnnotation[],
  fvIdByStatementId: ReadonlyMap<number, number>,
): DatasetAnnotation[] {
  const out: { a: DatasetAnnotation; fvId: number | null }[] = [];
  for (const raw of annotations) {
    const a: DatasetAnnotation = {
      ...raw,
      statements: raw.statements.filter((p) => !isQuantityPair(p)),
    };
    const fvId = raw.id != null ? (fvIdByStatementId.get(raw.id) ?? null) : null;
    const host =
      fvId != null
        ? out.find(
            (o) => o.fvId === fvId && statementsShareSubject(asSubject(o.a), asSubject(a)),
          )
        : undefined;
    if (host) {
      const seen = new Set(host.a.statements.map(pairKey));
      host.a = {
        ...host.a,
        // Show the grounded subject when only one of the rows has it.
        ...(host.a.termUri || !a.termUri
          ? {}
          : { termName: a.termName, termUri: a.termUri }),
        statements: [
          ...host.a.statements,
          ...a.statements.filter((p) => !seen.has(pairKey(p))),
        ],
      };
      continue;
    }
    const duplicate = out.some(
      (o) =>
        statementsShareSubject(asSubject(o.a), asSubject(a)) &&
        samePairs(o.a.statements, a.statements),
    );
    if (duplicate) continue;
    out.push({ a, fvId });
  }
  return out.map((o) => o.a);
}
