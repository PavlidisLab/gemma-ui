/**
 * Pair FVs across a baseline + comparator factor by biomaterial-set
 * overlap. Extracted from ``ComparisonFactorCard`` 2026-06-12 so the
 * shared ``FactorComparisonGrid`` primitive can call it directly
 * without circular imports.
 *
 * Strategy:
 *   1. Bijective greedy match by Jaccard overlap (≥ 0.5) over the
 *      biomaterial sets. Highest-overlap pair wins on each pass.
 *   2. Anything unmatched on either side renders as ``left_only`` /
 *      ``right_only``.
 *
 * Status semantics — drives the grid's column-glyph and is the same
 * vocabulary the legacy ``FvPairRow`` used:
 *   - ``"same"``       — labels match
 *   - ``"drift"``      — paired by partition; labels differ
 *   - ``"left_only"``  — present on baseline, no comparator match
 *   - ``"right_only"`` — present on comparator, no baseline match
 */
import type { Factor } from "@/features/experiment/types";
import type { FactorProposal, FactorValueProposal } from "@/api/types";
import type {
  FactorComparisonPair,
  GridFv,
} from "./FactorComparisonGrid";

type FactorLike = Factor | FactorProposal | null;

function fvLabel(fv: GridFv): string {
  if (!fv) return "";
  return (fv.free_text_label || "").trim().toLowerCase();
}

function fvBms(
  fv: Factor["factor_values"][number] | FactorValueProposal | null,
): Set<string> {
  if (!fv) return new Set();
  return new Set(fv.biomaterial_short_names ?? []);
}

export function pairFvs(
  leftFactor: FactorLike,
  rightFactor: FactorLike,
): FactorComparisonPair[] {
  const leftFvs = leftFactor?.factor_values ?? [];
  const rightFvs = rightFactor?.factor_values ?? [];
  const claimedRight = new Set<number>();
  const pairs: FactorComparisonPair[] = [];
  for (const l of leftFvs) {
    const lBms = fvBms(l);
    let bestIx = -1;
    let bestJ = 0;
    for (let ix = 0; ix < rightFvs.length; ix++) {
      if (claimedRight.has(ix)) continue;
      const rBms = fvBms(rightFvs[ix]);
      const inter = [...lBms].filter((b) => rBms.has(b)).length;
      const union = new Set([...lBms, ...rBms]).size;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJ) {
        bestJ = j;
        bestIx = ix;
      }
    }
    if (bestIx >= 0 && bestJ >= 0.5) {
      claimedRight.add(bestIx);
      const r = rightFvs[bestIx];
      const status: FactorComparisonPair["status"] =
        fvLabel(l) === fvLabel(r) && fvLabel(l) !== "" ? "same" : "drift";
      pairs.push({ left: l, right: r, status });
    } else {
      pairs.push({ left: l, right: null, status: "left_only" });
    }
  }
  for (let ix = 0; ix < rightFvs.length; ix++) {
    if (!claimedRight.has(ix)) {
      pairs.push({ left: null, right: rightFvs[ix], status: "right_only" });
    }
  }
  return pairs;
}
