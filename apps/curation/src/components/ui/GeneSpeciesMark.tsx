import { cn } from "@/lib/cn";
import {
  geneSpeciesNeedsCheck,
  geneSpeciesNote,
  geneSpeciesVerdict,
} from "@/lib/gene";
import { taxonAbbreviation } from "@/lib/taxon";

/**
 * The species marker that rides beside a gene symbol — ``H.s.`` when
 * the species is known, ``sp?`` when it isn't.
 *
 * Amber on BOTH mismatch and unknown. A gene bound to the wrong
 * species is a Tier-1 error (see ``lib/taxon.ts``), and a gene whose
 * species nobody can determine is not in better shape — it is the same
 * error, unexamined. Amber here means "check me", not "this is wrong":
 * cross-species bindings are sometimes exactly right (a human transgene
 * in a mouse, a xenograft), so the marker flags and never blocks.
 *
 * Quiet grey is reserved for the one case that has actually been
 * checked and agrees.
 *
 * One component, three surfaces: the read-only term chip, the term
 * picker's search rows, and the picker's collapsed value in the design
 * editor. A gene must not look like three different things depending on
 * which surface a curator meets it on.
 */
export function GeneSpeciesMark({
  species,
  datasetTaxon,
  taxonId,
  className,
}: {
  /** Species as stated by the label or the search hit; null when
   *  neither says. */
  species: string | null | undefined;
  /** The dataset's species, or null off an experiment page. */
  datasetTaxon: string | null | undefined;
  /** NCBI taxon id, when the hit carried one — tooltip only. */
  taxonId?: number | null;
  className?: string;
}) {
  const verdict = geneSpeciesVerdict(species, datasetTaxon);
  const needsCheck = geneSpeciesNeedsCheck(verdict);
  const text = taxonAbbreviation(species) || (needsCheck ? "sp?" : "");
  if (!text) return null;
  const title = [
    geneSpeciesNote(verdict, species, datasetTaxon),
    taxonId ? `NCBI Taxon ${taxonId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={cn(
        "ml-1 shrink-0 text-[10px] leading-none align-baseline",
        needsCheck
          ? "px-1 py-0.5 rounded font-semibold border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
          : "font-normal text-slate-500 dark:text-slate-400",
        className,
      )}
      title={title}
    >
      {text}
    </span>
  );
}
