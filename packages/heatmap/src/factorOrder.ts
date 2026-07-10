/**
 * Canonical factor ordering for annotation strips + the grouping
 * picker. Single source of truth so every surface that renders the
 * same payload's strips (the Expression tab, the DE top-genes pop-out,
 * …) lays the factors out in the SAME order — regardless of the order
 * the wire / samples endpoint happened to emit them in.
 *
 * Pure. Never mutates the input array.
 */
import type { Factor } from './payload';

/** Factors whose category/name marks them technical / nuisance
 *  (batch, block, collection, scan date, sequencing library, …).
 *  These sort AFTER the biological factors and are skipped by the
 *  grouping auto-pick. This is the single definition — the widget's
 *  auto-pick and the strip ordering both read it so the two can't
 *  drift. (The narrower ``batch|block`` COMPACT_FACTOR_RE in
 *  ``strips/categorical.ts`` governs a different concern — half-height
 *  greyscale rendering — and is intentionally left separate.) */
const TECHNICAL_FACTOR_RE =
  /\b(batch|block|collection|scan|protocol|technical|library|lane|flow ?cell)\b/i;

export function isTechnicalFactor(factor: Factor): boolean {
  const cat = factor.category?.label ?? '';
  const name = factor.name ?? '';
  return TECHNICAL_FACTOR_RE.test(cat) || TECHNICAL_FACTOR_RE.test(name);
}

/** Canonical display order:
 *   1. biological factors before technical / nuisance ones (the
 *      latter render compact and read as secondary), then
 *   2. by factor id ascending (experimental-design creation order) so
 *      the sequence is stable and identical across surfaces, then
 *   3. original index as a final, deterministic tiebreak.
 */
export function orderFactorsForDisplay(factors: Factor[]): Factor[] {
  return factors
    .map((factor, index) => ({ factor, index }))
    .sort((a, b) => {
      const tech =
        Number(isTechnicalFactor(a.factor)) -
        Number(isTechnicalFactor(b.factor));
      if (tech !== 0) return tech;
      if (a.factor.id !== b.factor.id) return a.factor.id - b.factor.id;
      return a.index - b.index;
    })
    .map((x) => x.factor);
}
