/**
 * Clause-label canonicalisation for the remote commit.
 *
 * 🛑 **Gemma refuses a faithful re-send of its own stored row.**
 * Measured on GSE44608 / 13506, statement 30165836, every field carried
 * unmodified from what `/design` served:
 *
 *     400  predicate URI CLO_0037209 resolves to "derives from cell",
 *          not the submitted label "derived from cell"
 *
 * The whole design goes in one document, so one stale label refuses a
 * commit touching a row the curator never opened. It is not a corner
 * case of an agent job — it is any edit to any affected experiment.
 *
 * `/validate-terms` names both offenders on that dataset and both carry
 * a canonical form, so the repair is well defined:
 *
 *     derived from cell   label_mismatch   -> derives from cell
 *     neuronal stem cell  non_canonical    -> neural stem cell
 *     R1 cell, cell line  ok               -> unchanged
 *
 * Paul, 2026-09-06: *"rewriting labels at commit seems the right thing
 * to do."*
 *
 * 🛑 **ONLY `non_canonical` is rewritten.** The first cut rewrote every
 * non-`ok` verdict carrying a canonical form, and cab's corpus sweep
 * (2026-09-06, 937 experiments) showed what that would have written
 * into labels a curator reads:
 *
 *     non_canonical   17 rows  neuronal stem cell -> neural stem cell        SAFE
 *     label_mismatch  31 rows  ventromedial hypothalamus ->
 *                                ventromedial nucleus of hypothalamus       NOT SAFE
 *     obsolete        29 rows  -> "obsolete Tumor-derived cell line"         NOT SAFE
 *
 * A `label_mismatch` names a DIFFERENT concept — `Hek293F` bound to
 * EFO_0022515, which is `HEK-293S` — so the mismatch may mean the URI
 * is wrong rather than the label, and choosing is a curation judgement.
 * An `obsolete` term needs re-terming, not relabelling, and its
 * "canonical" form is the deprecation notice.
 *
 * ⚠️ **So the motivating case is NOT fixed here.** `derived from cell`
 * (CLO_0037209) is classified `label_mismatch` — plainly a verb-form
 * variant, but the classifier cannot tell that from a real concept
 * swap, and 483 experiments carry it. Those still fail with Gemma's
 * own 400, which names the term and is the honest outcome until either
 * the stored labels are repaired or the check accepts the variant.
 * That is gembro's to rule on, not ours to paper over.
 *
 * `ok` is left alone: Gemma's own check is case- and whitespace-
 * tolerant — measured, `Derives From Cell` and `derives  from cell`
 * both preflight clean — so rewriting those would churn the payload
 * for nothing.
 */
import type {
  CurationDocument,
  OntologyTermRef,
} from "./curationCommit";
import type {
  TermValidationResult,
  ValidateTermsRequestItem,
} from "./validateTerms";

/** Key for one (label, uri) pair. Both halves matter: one URI arrives
 *  under several stored labels across a corpus, and only the pair says
 *  which of them needs repairing. */
function termKey(t: OntologyTermRef | undefined): string | null {
  const label = t?.label?.trim();
  const uri = t?.uri?.trim();
  return label && uri ? JSON.stringify([uri, label]) : null;
}

const clauses = (st: {
  category?: OntologyTermRef;
  subject?: OntologyTermRef;
  predicate?: OntologyTermRef;
  object?: OntologyTermRef;
}) => [st.category, st.subject, st.predicate, st.object];

/**
 * Every clause term in the document's statements, deduplicated.
 *
 * 🛑 **Statements only, and only the terms Gemma stored.** A factor's
 * name, a factor value's `freeTextLabel` and a tag's value are things a
 * curator authored or can type; rewriting one would be editing their
 * work, which is the line we do not cross. A statement's category,
 * subject, predicate and object are Gemma's own strings — displayed
 * here, never composed here — so repairing them is fixing our own
 * payload rather than someone's curation.
 */
export function collectStatementTerms(
  doc: CurationDocument,
): ValidateTermsRequestItem[] {
  const seen = new Map<string, ValidateTermsRequestItem>();
  for (const f of doc.design?.factors?.items ?? []) {
    for (const v of f.factorValues?.items ?? []) {
      for (const st of v.statements?.items ?? []) {
        for (const t of clauses(st)) {
          const id = termKey(t);
          if (id && !seen.has(id)) {
            seen.set(id, {
              id,
              label: (t?.label ?? "").trim(),
              uri: (t?.uri ?? "").trim(),
            });
          }
        }
      }
    }
  }
  return [...seen.values()];
}

/** Rewrite each clause label to its canonical form. Returns the
 *  document unchanged when nothing needs repairing, so the common case
 *  costs no allocation and no diff. */
export function applyCanonicalLabels(
  doc: CurationDocument,
  results: readonly TermValidationResult[],
): CurationDocument {
  const canonical = new Map<string, string>();
  for (const r of results) {
    const label = r.canonical_label?.trim();
    if (r.status === "non_canonical" && label) canonical.set(r.id, label);
  }
  if (canonical.size === 0) return doc;

  const fix = (t: OntologyTermRef | undefined): OntologyTermRef | undefined => {
    const id = termKey(t);
    const next = id ? canonical.get(id) : undefined;
    return next ? { ...t, label: next } : t;
  };

  return {
    ...doc,
    design: {
      ...doc.design,
      factors: {
        ...doc.design?.factors,
        items: (doc.design?.factors?.items ?? []).map((f) => ({
          ...f,
          factorValues: {
            ...f.factorValues,
            items: (f.factorValues?.items ?? []).map((v) => ({
              ...v,
              statements: {
                ...v.statements,
                items: (v.statements?.items ?? []).map((st) => ({
                  ...st,
                  ...(st.category ? { category: fix(st.category) } : {}),
                  ...(st.subject ? { subject: fix(st.subject) } : {}),
                  ...(st.predicate ? { predicate: fix(st.predicate) } : {}),
                  ...(st.object ? { object: fix(st.object) } : {}),
                })),
              },
            })),
          },
        })),
      },
    },
  };
}
