/**
 * The category a factor's VALUES are annotated under.
 *
 * `factor.category` when the factor carries one — that is the
 * authority and the common case. The fallback exists because a factor
 * can arrive with a blank category while its values are grounded:
 * promotion from a sample characteristic names the factor after the
 * characteristic key and leaves the category URI null, and an agent
 * proposal can land the category on the statements rather than the
 * factor. In that shape every grounded value says `strain` and the
 * factor says nothing, so a value rendered against the factor's own
 * field reads as uncategorised while its siblings read as strains.
 *
 * 🛑 Only when the grounded values AGREE. A factor whose statements
 * carry two different categories has no single answer, and picking
 * the first one seen would put a confident wrong chip on every
 * ungrounded value in it. Blank is the honest render there.
 *
 * Compared on URI where both sides have one — the label is a display
 * string and `Strain` / `strain` are the same category — and on the
 * normalised label otherwise, since a free-text category is all some
 * statements carry.
 */
import type { Factor, OntologyTerm } from "@/features/experiment/types";

export function resolveValueCategory(
  factor: Pick<Factor, "category" | "factor_values">,
): OntologyTerm | null {
  const own = factor.category;
  if ((own?.label ?? "").trim()) return own ?? null;

  let agreed: OntologyTerm | null = null;
  let agreedKey = "";
  for (const fv of factor.factor_values ?? []) {
    for (const st of fv.statements ?? []) {
      const cat = st.category;
      const label = (cat?.label ?? "").trim();
      if (!cat || !label) continue;
      const key = (cat.uri ?? "").trim() || label.toLowerCase();
      if (!agreed) {
        agreed = cat;
        agreedKey = key;
        continue;
      }
      if (key !== agreedKey) return null; // they disagree — say nothing
    }
  }
  return agreed;
}
