import { useGeneInfo } from "@/api/genes";
import { geneSpeciesNote, geneSpeciesVerdict } from "@/lib/gene";

/**
 * The symbol a gene chip shows, carrying the gene's full identity in
 * its hover.
 *
 * The chip is deliberately short — a symbol and a species mark — so the
 * name has to be recoverable, and for most stored bindings the label
 * never had one to recover ("ESR1"). The catalogue does: it is the same
 * lookup the species mark makes, by the NCBI id in the URI, so the name
 * costs nothing extra.
 *
 * Falls back to whatever the label carried while the lookup is in
 * flight or if it misses, so the tooltip is never emptier than it was
 * before.
 */
export function GeneLabel({
  uri,
  symbol,
  labelName,
  labelSpecies,
  datasetTaxon,
}: {
  uri?: string | null;
  /** Symbol as parsed from the stored label — what the chip shows. */
  symbol: string;
  /** Full name as parsed from the stored label, when it had one. */
  labelName?: string | null;
  /** Species as stated by the stored label, when it said. */
  labelSpecies?: string | null;
  datasetTaxon?: string | null;
}) {
  const gene = useGeneInfo(uri).data;
  const name = gene?.name ?? labelName ?? null;
  const species =
    gene?.taxonScientificName ?? gene?.taxonCommonName ?? labelSpecies ?? null;
  const lines = [
    name ? `${symbol} — ${name}` : symbol,
    geneSpeciesNote(geneSpeciesVerdict(species, datasetTaxon), species, datasetTaxon),
  ];
  // The symbol the catalogue has for this id, when it isn't the one on
  // the chip. Not a substitution — a label that disagrees with its own
  // id is something the curator should see, not something the display
  // should quietly correct.
  if (gene?.symbol && gene.symbol.toLowerCase() !== symbol.toLowerCase()) {
    const alias = gene.aliases.some(
      (a) => a.toLowerCase() === symbol.toLowerCase(),
    );
    lines.push(
      alias
        ? `"${symbol}" is an alias; Gemma's symbol for this id is ${gene.symbol}.`
        : `This id is ${gene.symbol} in Gemma — the label on the chip says ${symbol}.`,
    );
  }
  return <span title={lines.join("\n\n")}>{symbol}</span>;
}
