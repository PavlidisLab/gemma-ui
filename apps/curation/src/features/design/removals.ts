/**
 * Turn a `DesignDiff` into the tombstones a commit document needs.
 *
 * The design a curator has in hand cannot express a deletion — a row
 * they removed is simply absent, and absent means "unchanged" to Gemma.
 * The diff is the only thing that still knows the id was there, so it
 * is the only thing that can say "remove this".
 *
 * Lives here rather than in `api/curationCommit.ts` because the diff is
 * the editor's, and the commit contract deliberately declares its input
 * shapes structurally instead of importing the editor's types.
 */
import type { CommittableRemovals } from "@/api/curationCommit";
import type { Design, Factor, FactorValue } from "@/features/experiment/types";

import type { DesignDiff } from "./diff";

/** The id Gemma knows a factor by, matching what `buildCurationDocument`
 *  keys its sections on. */
function factorKey(f: Pick<Factor, "id"> & { gemma_factor_id?: number | null }): number {
  return f.gemma_factor_id ?? f.id;
}

/**
 * Statement ids that are gone from a value ENTIRELY.
 *
 * 🛑 Two rows carrying one `gemma_id` are the two pairs of a single
 * Gemma statement. Dropping one pair and keeping the other edits that
 * statement; it does not delete it, and sending the id as a deletion
 * would take the surviving pair with it. So an id counts as removed
 * only when no row in `after` still carries it.
 */
function statementsGone(before: FactorValue, after: FactorValue): number[] {
  const kept = new Set<number>();
  for (const st of after.statements ?? []) {
    if (typeof st.gemma_id === "number") kept.add(st.gemma_id);
  }
  const gone: number[] = [];
  for (const st of before.statements ?? []) {
    if (typeof st.gemma_id !== "number") continue;
    if (kept.has(st.gemma_id)) continue;
    if (gone.includes(st.gemma_id)) continue;
    gone.push(st.gemma_id);
  }
  return gone;
}

/**
 * Every deletion in `diff`, keyed the way the commit document expects.
 *
 * `saved` supplies the Gemma factor ids: `FactorDiff` carries the
 * design-side `factorId`, and the document keys its per-factor sections
 * on `gemma_factor_id ?? id`. Reading them from the SAVED design rather
 * than the draft is deliberate — a deleted row is not in the draft.
 *
 * Ids Gemma never issued are left in; `buildCurationDocument` drops
 * them, so the sign rule is applied in exactly one place.
 */
export function removalsFromDiff(diff: DesignDiff, saved: Design): CommittableRemovals {
  const gemmaFactorId = new Map<number, number>();
  for (const f of saved.factors ?? []) gemmaFactorId.set(f.id, factorKey(f));

  const factorIds = diff.factorsRemoved.map(factorKey);

  const factorValues: CommittableRemovals["factorValues"] = [];
  const statements: CommittableRemovals["statements"] = [];
  for (const fd of diff.factorsChanged) {
    const key = gemmaFactorId.get(fd.factorId) ?? fd.factorId;
    if (fd.removed.length) {
      factorValues.push({
        factorId: key,
        valueIds: fd.removed.map((c) => c.fvId),
      });
    }
    for (const c of fd.modified) {
      if (!c.before || !c.after) continue;
      const gone = statementsGone(c.before, c.after);
      if (gone.length) statements.push({ valueId: c.fvId, statementIds: gone });
    }
  }

  const tagIds = diff.tags.removed.map((t) => t.id);

  return {
    ...(factorIds.length ? { factorIds } : {}),
    ...(factorValues.length ? { factorValues } : {}),
    ...(statements.length ? { statements } : {}),
    ...(tagIds.length ? { tagIds } : {}),
  };
}
