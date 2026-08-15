import { cn } from "@/lib/cn";
import { useGeneInfo } from "@/api/genes";
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
  uri,
  species,
  datasetTaxon,
  taxonId,
  className,
}: {
  /** The gene's term URI. Its NCBI id resolves the species through
   *  Gemma's gene catalogue — which is how a gene stored as a bare
   *  "ESR1" gets a species at all. Omit only where the caller already
   *  has an authoritative species and no URI to look up. */
  uri?: string | null;
  /** Species as stated by the label or the search hit. Used until the
   *  lookup answers, and as the fallback if it can't. */
  species: string | null | undefined;
  /** The dataset's species, or null off an experiment page. */
  datasetTaxon: string | null | undefined;
  /** NCBI taxon id, when the hit carried one — tooltip only. */
  taxonId?: number | null;
  className?: string;
}) {
  const gene = useGeneInfo(uri).data;
  // Gemma's catalogue wins over the label: the label is whatever the
  // producing tool wrote, the catalogue is what the id actually is.
  const resolved =
    gene?.taxonScientificName ?? gene?.taxonCommonName ?? species ?? null;
  const verdict = geneSpeciesVerdict(resolved, datasetTaxon);
  const needsCheck = geneSpeciesNeedsCheck(verdict);
  const text = taxonAbbreviation(resolved) || (needsCheck ? "sp?" : "");
  if (!text) return null;
  const identity =
    gene?.symbol && gene?.name
      ? `Gemma: ${gene.symbol} — ${gene.name}`
      : gene?.symbol
        ? `Gemma: ${gene.symbol}`
        : "";
  const title = [
    geneSpeciesNote(verdict, resolved, datasetTaxon),
    // The catalogue's own reading of this id. When the chip's label
    // disagrees with it, that disagreement is right here on hover
    // rather than hidden behind a substituted symbol.
    identity,
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
