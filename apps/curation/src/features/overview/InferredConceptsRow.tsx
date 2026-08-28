import { useDatasetInferredConcepts } from "@/api/termRelations";
import { shortenUri } from "@/lib/curie";

/**
 * "Inferred" — concepts Gemma can derive from this experiment's own
 * annotations, rendered as one more category row in the tag block.
 *
 * 🛑 **These are NOT annotations, and nothing here is editable.** An
 * inferred fact is a consequence of an annotation, not somebody's claim
 * about this dataset. It gets its own row, its own colour, and a dashed
 * border — the dash carries the meaning without relying on hue, so the
 * distinction survives a colour-blind reader.
 *
 * ⚠️ **Not the same "inferred" as the slate chips inside the tag rows.**
 * Those are sample-characteristic projections — a characteristic present
 * on every sample, shown at the experiment level. These come from
 * Gemma's relation graph and are about what the annotations IMPLY.
 * Same word, different things; that is why this row is labelled and
 * coloured separately rather than folded in beside them.
 *
 * 🛑 **The list is APPROXIMATE and every tooltip says so.** The server
 * bars any subject relating to more than three objects under one
 * predicate — a heuristic aimed at ChEBI role closures, which drops 19
 * of 26 rows on GSE28044 and will drop true relations whose subject
 * happens to be broad.
 *
 * Empty is the common case. The row renders nothing at all then, rather
 * than an empty-state sentence: an experiment with nothing to infer is
 * not missing anything, and a row saying so on most experiments would be
 * noise in a block whose whole job is scannability.
 */
/** Inferred-concepts gate — 2026-08-28, following `SHOW_PARK_AFFORDANCE`
 *  in `features/audit/auditPresentation.ts`: the work stays wired and one
 *  const turns it back on.
 *
 *  ON as of 2026-08-28, and **curator UI only** — this row is not in
 *  the browser app, deliberately. The public surface is the one where a
 *  wrong inference reaches someone who cannot tell it is wrong.
 *
 *  🛑 **Known bad output is still outstanding.** On experiment 24976 all
 *  three rows were false — `astrocyte --derives from part of--> organoid`
 *  and `astrocyte --has role--> cell co-culturing` on a mouse EAE
 *  experiment with neither, plus an assay-aspect seed (`nuclear RNA
 *  extract`) that must not seed at all. None of those implied objects is
 *  an annotation of that experiment: they are claims attached to the TERM,
 *  arriving because the experiment uses it. Reported in
 *  `UIB_TO_GEMBRO_2026_08_28_THE_INFERRED_CONCEPTS_ON_24976_ARE_ALL_WRONG`.
 *  That is why the row label says "selected" and "approximate" — the
 *  caveat is load-carrying copy, not hedging, and must not be trimmed
 *  while this is true.
 *
 *  🛑 If it goes off again it HIDES, it does not grey — unlike the
 *  screening-ticket gate. That one greys because a curator needs to know
 *  the affordance is coming; this is a read-only data row, and a
 *  placeholder about facts being temporarily hidden would be noise in a
 *  block whose job is scannability. */
export const SHOW_INFERRED_CONCEPTS = true;

export function InferredConceptsRow({
  experimentId,
}: {
  experimentId: number | string;
}) {
  // Gated before the body, so a disabled row costs no request and no
  // render. Split rather than inlined so the body stays directly
  // testable while the gate is off — otherwise every render test would
  // pass vacuously against `null` and we would find out it had rotted
  // only when we turned it back on.
  if (!SHOW_INFERRED_CONCEPTS) return null;
  return <InferredConceptsRowBody experimentId={experimentId} />;
}

/** The row itself. Exported for test — see the gate above. */
export function InferredConceptsRowBody({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data, isLoading } = useDatasetInferredConcepts(experimentId);

  // Silent while loading and silent when empty — see the note above.
  if (isLoading || !data || data.length === 0) return null;

  // One chip per distinct implied concept. The same concept can be
  // implied by several annotations (four cell lines all implying one
  // organism part), and four identical chips would read as four facts.
  const byConcept = new Map<string, { row: (typeof data)[number]; from: string[] }>();
  for (const r of data) {
    const label = (r.implied_object ?? "").trim();
    if (!label) continue;
    const key = (r.implied_object_uri ?? label).toLowerCase();
    const existing = byConcept.get(key);
    const from = (r.implied_subject ?? "").trim();
    if (existing) {
      if (from && !existing.from.includes(from)) existing.from.push(from);
    } else {
      byConcept.set(key, { row: r, from: from ? [from] : [] });
    }
  }
  const concepts = [...byConcept.values()];
  if (concepts.length === 0) return null;

  return (
    <div className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5">
      <span
        className="text-[10px] uppercase tracking-wide text-indigo-500 dark:text-indigo-300 mr-1 min-w-[5.5rem]"
        title="Selected concepts inferred by ontology and curated relationships to annotated concepts. Not attached to this experiment and not editable. Approximate: broad terms are filtered out, so some true relations are dropped with them."
      >
        inferred
      </span>
      {concepts.map(({ row, from }) => {
        const label = row.implied_object ?? "";
        const uri = row.implied_object_uri ?? null;
        const curie = uri ? shortenUri(uri) : null;
        // 🛑 One fact, nothing else: *"it should just say 'Inferred
        // from: nuclear RNA extract'"*. The explanation and the
        // approximate caveat live on the row LABEL, said once, rather
        // than repeated on every chip.
        //
        // 🛑 Do NOT append `BASIS_COPY[row.basis].title`. Its CURATED
        // copy reads "A curator wrote this as a statement on an
        // experiment. Not inferred." — written for a term card, where it
        // separates an assertion from an inference. Inside a chip that
        // is by definition inferred it contradicts the row it sits in,
        // and it shipped that way until it was seen on screen.
        const sources =
          from.length > 0 ? from.join(", ") : "this experiment's annotations";
        const title = `Inferred from: ${sources}`;
        return (
          <span
            key={(uri ?? label) + label}
            title={title}
            className="inline-flex items-baseline gap-1 rounded border border-dashed border-indigo-400 px-1.5 py-0.5 text-xs text-indigo-800 dark:border-indigo-500 dark:text-indigo-200"
          >
            <span>{label}</span>
            {curie ? (
              <span className="font-mono text-[10px] text-indigo-500 dark:text-indigo-400">
                {curie}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
