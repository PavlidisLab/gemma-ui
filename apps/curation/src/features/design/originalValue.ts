/**
 * What the submitter actually wrote for the samples under a factor
 * value.
 *
 * A curated FV and the GEO characteristic it came from drift apart on
 * purpose — grounding `stroma` as `placental villous stroma`
 * (UBERON:8600023) is the job. But once they differ, the design tab
 * shows only the curated end and the sample table shows only the raw
 * end, and nothing on either surface says they are the same thing.
 * GSE49354 is the case: the FV reads `placental villous stroma`, the
 * `organism part` characteristic column reads `stroma`, and a curator
 * comparing the two has no way to tell whether that is a grounding or
 * a mistake.
 *
 * 🛑 The characteristics map is keyed by the NAMES the submitter
 * wrote (`BioSource`, `Genetic modification`), never a normalized
 * vocabulary — which is why the whole map is carved out of key
 * normalization. So the key is matched case-insensitively against the
 * factor's own category and nothing is invented when no key matches:
 * a factor a curator built by hand has no source characteristic, and
 * saying so is better than guessing which column it might have come
 * from.
 */

import type { Biomaterial, Factor, FactorValue } from "@/features/experiment/types";

/** The characteristic column a factor was grounded from, or null when
 *  no column answers to its name.
 *
 *  Category first, then the factor's own name — a promoted factor
 *  takes its name from the characteristic key, and a curator who
 *  later grounds the category shouldn't sever the link. */
export function sourceCharacteristicKey(
  factor: Factor,
  biomaterials: readonly Biomaterial[],
): string | null {
  const keys = new Set<string>();
  for (const bm of biomaterials) {
    for (const k of Object.keys(bm.characteristics ?? {})) keys.add(k);
  }
  const wanted = [factor.category?.label, factor.name]
    .map((s) => (s ?? "").trim().toLowerCase())
    .filter(Boolean);
  for (const want of wanted) {
    for (const k of keys) {
      if (k.trim().toLowerCase() === want) return k;
    }
  }
  return null;
}

/**
 * The distinct raw values behind one factor value, in the order the
 * samples carry them.
 *
 * More than one is normal and worth seeing: a curator who merged
 * `LV`, `left ventricle` and `heart, left` into one FV has done real
 * work, and this is the only place that shows it happened.
 */
export function originalValuesForFv(
  fv: FactorValue,
  key: string,
  bmByShortName: ReadonlyMap<string, Biomaterial>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const shortName of fv.biomaterial_short_names ?? []) {
    const raw = bmByShortName.get(shortName)?.characteristics?.[key];
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Every FV's original values for one factor, keyed by fv id. Empty
 *  when the factor has no source characteristic — the caller renders
 *  nothing rather than an empty row. */
export function originalValuesByFv(
  factor: Factor,
  biomaterials: readonly Biomaterial[],
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const key = sourceCharacteristicKey(factor, biomaterials);
  if (!key) return out;
  const byShortName = new Map<string, Biomaterial>();
  for (const bm of biomaterials) byShortName.set(bm.short_name, bm);
  for (const fv of factor.factor_values ?? []) {
    const values = originalValuesForFv(fv, key, byShortName);
    if (values.length > 0) out.set(fv.id, values);
  }
  return out;
}

/** Does the curated label already say what the submitter said?
 *
 *  Compared loosely — case and surrounding whitespace are not a
 *  curation decision, and flagging `Heart` against `heart` as a
 *  change would train curators to ignore the marker. */
export function matchesOriginal(
  fvLabel: string | null | undefined,
  originals: readonly string[],
): boolean {
  const label = (fvLabel ?? "").trim().toLowerCase();
  if (!label) return false;
  return originals.length === 1 && originals[0].trim().toLowerCase() === label;
}
