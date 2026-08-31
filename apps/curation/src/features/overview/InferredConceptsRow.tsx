import {
  sourceDisplayName,
  useDatasetInferredConcepts,
} from "@/api/termRelations";
import { CurieLink } from "@/components/ui/CurieLink";

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
  //
  // 🛑 A seed is a LABEL PLUS THE SOURCE THAT USES IT. On GSE286105 all
  // four rows carry one subject URI (CLO_0003704) under two names —
  // `Hep G2 cell` is CLO's, `Hep-G2` is Cellosaurus' — and the
  // experiment is annotated with the first. Naming the seed alone sends
  // a reader looking for a `Hep-G2` annotation that is not there and
  // cannot be. The source is what makes the unfamiliar name explicable,
  // so the two travel together and dedupe together.
  type Seed = { label: string; predicate: string; source: string };
  const byConcept = new Map<
    string,
    { row: (typeof data)[number]; from: Seed[]; seen: Set<string> }
  >();
  for (const r of data) {
    const label = (r.implied_object ?? "").trim();
    if (!label) continue;
    const key = (r.implied_object_uri ?? label).toLowerCase();
    const entry = byConcept.get(key) ?? { row: r, from: [], seen: new Set() };
    if (!byConcept.has(key)) byConcept.set(key, entry);
    const seedLabel = (r.implied_subject ?? "").trim();
    if (!seedLabel) continue;
    // Deduped on the seed's URI where it has one, and on the PREDICATE
    // beside it: one URI under two source spellings is two things to a
    // reader, and so is one seed related two different ways.
    //
    // 🛑 The predicate used to be excluded here, on the reasoning that
    // "the same seed under two predicates is one implication". That was
    // true while the tooltip named only the seed; it stopped being true
    // when the tooltip started stating the RELATIONSHIP. Collapsing them
    // now would print one predicate and silently drop the other.
    const seedPredicate = (r.implied_predicate ?? r.predicate ?? "").trim();
    const seedKey = `${(r.implied_subject_uri ?? seedLabel).toLowerCase()}|${seedPredicate.toLowerCase()}|${(
      r.source ?? ""
    ).toUpperCase()}`;
    if (entry.seen.has(seedKey)) continue;
    entry.seen.add(seedKey);
    entry.from.push({
      label: seedLabel,
      predicate: seedPredicate,
      source: sourceDisplayName(r.source),
    });
  }
  const concepts = [...byConcept.values()];
  if (concepts.length === 0) return null;

  // Grouped by the object's CATEGORY, which the wire carries as
  // `object_category` (`disease` / `cell type` / `organism part`) and
  // this row used to drop on the floor.
  //
  // 🛑 A category is a GROUP HEADER, never an in-chip prefix — the
  // TagBar settled that on 2026-05-17 and the inferred chips have to
  // read the same way beside it. So the categories cluster the chips
  // and label the cluster; the chip face stays the value alone.
  //
  // 🛑 The category is NOT the predicate, and the two are easy to
  // conflate here: `APP/PS1 --has role in modeling--> Alzheimer
  // disease` puts `disease` in the category and "modeling" in the
  // predicate. Printing the predicate as the category would state that
  // Alzheimer disease is a kind of model, which is backwards.
  //
  // Rows with no category fall in a trailing unlabelled group rather
  // than borrowing a neighbour's — an uncategorised inference is a
  // real state of the data, not a formatting gap.
  const byCategory = new Map<string, typeof concepts>();
  for (const c of concepts) {
    const cat = (c.row.object_category ?? "").trim();
    const group = byCategory.get(cat);
    if (group) group.push(c);
    else byCategory.set(cat, [c]);
  }
  const groups = [...byCategory.entries()].sort(([a], [b]) =>
    // Uncategorised last; otherwise alphabetical, so the row does not
    // reshuffle as the relation set changes underneath it.
    a === b ? 0 : a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );

  return (
    <div className="flex items-baseline gap-2 flex-wrap pl-2 py-0.5">
      <span
        className="text-[10px] uppercase tracking-wide text-indigo-500 dark:text-indigo-300 mr-1 min-w-[5.5rem]"
        title="Selected concepts inferred by ontology and curated relationships to annotated concepts. Not attached to this experiment and not editable. Approximate: broad terms are filtered out, so some true relations are dropped with them."
      >
        inferred
      </span>
      {groups.map(([category, inCategory]) => (
        <span
          key={category || "(uncategorised)"}
          className="inline-flex items-baseline gap-1.5 flex-wrap"
        >
          <span
            className="text-[10px] uppercase tracking-wide text-indigo-400 dark:text-indigo-400/80"
            title={
              category
                ? `Category of the inferred concept, as the relation states it — not the relation itself.`
                : "The relation states no category for this concept."
            }
          >
            {category || "—"}
          </span>
          {inCategory.map(({ row, from }) => {
            const label = row.implied_object ?? "";
            const uri = row.implied_object_uri ?? null;
            // 🛑 One fact, nothing else: *"it should just say 'Inferred
            // from: nuclear RNA extract'"*. The explanation and the
            // approximate caveat live on the row LABEL, said once, rather
            // than repeated on every chip.
            //
            // That one fact is the RELATIONSHIP, not just the seed —
            // *"it should be in the tooltip then to describe the
            // relationship"* (2026-08-30), on seeing that the wire
            // carries the predicate. Stated subject → predicate →
            // object, the order the rest of the app states a statement
            // in, so it reads the same here as on a statement chip.
            //
            // 🛑 Do NOT append `BASIS_COPY[row.basis].title`. Its CURATED
            // copy reads "A curator wrote this as a statement on an
            // experiment. Not inferred." — written for a term card, where it
            // separates an assertion from an inference. Inside a chip that
            // is by definition inferred it contradicts the row it sits in,
            // and it shipped that way until it was seen on screen.
            //
            // 🛑 The seed is named WITH its source — *"just say 'Inferred
            // from Hep-G2 cell via Cellosaurus'"* (2026-08-28). A
            // seed label the curator cannot find in the annotation block is
            // not a defect to hide: it is a second resource's name for the
            // term the experiment IS annotated with, and saying which
            // resource is the whole explanation. Origin, never judgement.
            const sources =
              from.length > 0
                ? from
                    .map((s) => {
                      // The object is the chip being hovered, but the
                      // sentence is stated in full anyway: a tooltip has
                      // to say what the relation concluded rather than
                      // leave the reader to supply the missing half.
                      const triple = s.predicate
                        ? `${s.label} → ${s.predicate} → ${label}`
                        : s.label;
                      return s.source ? `${triple}, via ${s.source}` : triple;
                    })
                    .join("; ")
                : "this experiment's annotations";
            const title = `Inferred from: ${sources}`;
            return (
              <span
                key={(uri ?? label) + label}
                title={title}
                className="inline-flex items-baseline gap-1 rounded border border-dashed border-indigo-400 px-1.5 py-0.5 text-xs text-indigo-800 dark:border-indigo-500 dark:text-indigo-200"
              >
                <span>{label}</span>
                {/* Hot like every other CURIE in the app — `CurieLink` owns
                the popover wire. Opening a term card is a READ, so it
                does not contradict the "nothing here is editable" rule
                above: the chip still offers no way to change anything.
                Renders nothing when the row carries no object URI. */}
                <CurieLink
                  uri={uri}
                  className="font-mono text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-200 whitespace-nowrap no-underline hover:underline cursor-pointer bg-transparent border-0 p-0"
                />
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}
