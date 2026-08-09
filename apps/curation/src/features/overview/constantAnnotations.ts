/**
 * Which inherited annotations are CONSTANT across the cohort.
 *
 * The Tags row answers one question for the curator: *what is already
 * annotated about this experiment as a whole?* An inherited chip that
 * only applies to some samples doesn't answer it — it's a variable,
 * and the Design tab is where variables belong. GSE41840 makes the
 * case: 132 samples, 32 distinct inherited values, and exactly two of
 * them (`labelling: biotin`, `molecular entity: total RNA`) are true of
 * the experiment. The other thirty — six radiation doses, six
 * timepoints, twelve individuals — are the design, re-rendered as tags
 * beside the factor chips that already carry them.
 *
 * A category is constant when the cohort carries exactly one value for
 * it AND every biomaterial carries that value. Both halves matter: a
 * characteristic present on 60 of 132 samples is a variable even
 * though it has one value.
 *
 * The rule is "hide only what we can PROVE varies". With no
 * biomaterials to count, or an inferred row whose source we don't
 * recognise, nothing is hidden — same instinct as the folded-GEO gate,
 * where an unknown label always keeps the block.
 */
import type { Biomaterial, Factor, Tag } from "@/features/experiment/types";

const lc = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/**
 * Category labels (lowercased) whose biomaterial characteristic is
 * carried, with one single value, by EVERY biomaterial.
 */
export function constantCharacteristicCategories(
  biomaterials: readonly Biomaterial[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const bms = biomaterials ?? [];
  if (bms.length === 0) return out;
  const values = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const bm of bms) {
    for (const [cat, val] of Object.entries(bm.characteristics ?? {})) {
      const c = lc(cat);
      const v = (val || "").trim();
      if (!c || !v) continue;
      const set = values.get(c) ?? new Set<string>();
      set.add(v);
      values.set(c, set);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  for (const [cat, set] of values) {
    if (set.size === 1 && counts.get(cat) === bms.length) out.add(cat);
  }
  return out;
}

/**
 * Factor category labels (lowercased) that don't actually vary — one
 * factor value, assigned to every biomaterial. Rare and slightly
 * degenerate (a one-level factor isn't much of a factor), but when it
 * happens the projection IS a constant property of the experiment and
 * belongs in the Tags row.
 */
export function constantFactorCategories(
  factors: readonly Factor[] | null | undefined,
  biomaterialCount: number,
): Set<string> {
  const out = new Set<string>();
  if (biomaterialCount <= 0) return out;
  for (const f of factors ?? []) {
    const cat = lc(f.category?.label || f.name);
    if (!cat) continue;
    const fvs = f.factor_values ?? [];
    if (fvs.length !== 1) continue;
    if ((fvs[0]?.biomaterial_short_names?.length ?? 0) === biomaterialCount) {
      out.add(cat);
    }
  }
  return out;
}

export interface ConstancyIndex {
  chars: Set<string>;
  factors: Set<string>;
  /** False when there's nothing to count against — every row then
   *  counts as "not provably variable" and stays visible. */
  known: boolean;
}

export function buildConstancyIndex(
  biomaterials: readonly Biomaterial[] | null | undefined,
  factors: readonly Factor[] | null | undefined,
): ConstancyIndex {
  const n = biomaterials?.length ?? 0;
  return {
    chars: constantCharacteristicCategories(biomaterials),
    factors: constantFactorCategories(factors, n),
    known: n > 0,
  };
}

/**
 * True when this row is an inherited annotation that applies to only
 * SOME samples.
 *
 * Direct tags are never variables — a curator attaching an EE-tag is
 * asserting something about the whole experiment by definition, and
 * hiding the curator's own work behind a noise filter is the mistake
 * the free-text filter already learned not to make.
 */
export function isVariableInferredTag(tag: Tag, index: ConstancyIndex): boolean {
  if (!tag.inferred) return false;
  if (!index.known) return false;
  const cat = lc(tag.category?.label);
  if (!cat) return false;
  const source = tag.inferred_source || "";
  if (source === "BioMaterial") return !index.chars.has(cat);
  if (source === "FactorValue") return !index.factors.has(cat);
  // Unrecognised source: we can't prove it varies, so it stays.
  return false;
}
