/**
 * Per-statement, per-slot diff between two FactorValue-shaped objects.
 *
 * Used by ``FactorComparisonGrid`` to highlight which specific S-P-O
 * chips actually differ across the LEFT (baseline / live) and RIGHT
 * (proposal / comparator) sides. Without this, the curator has to
 * mentally diff two parallel chip rows — Paul 2026-06-15:
 * "it is hard to see what is different - the diffs should be
 * highlighted."
 *
 * The diff is computed per-FV pair (NOT cross-FV). Statements within
 * each FV are paired subject-first: any pair of statements whose
 * subjects share the same URI (or, lacking URIs, the same case-
 * insensitive label) align together; everything left over is paired
 * positionally and finally tagged as added/removed if one side runs
 * out. This handles the common case where one side reorders or
 * enriches the statement list without flagging every chip.
 *
 * Chip keys are stable across sides (we pair the original statement
 * indices) so the caller can pass each side's key set into a single
 * ``FvDisplayRow`` and have the right chips ring.
 *
 * Key format: ``s{originalStatementIndex}:{subject|predicate|object}``.
 */

import { shortenUri } from "@/lib/curie";
import type { GridFv } from "./FactorComparisonGrid";

type Slot = "subject" | "predicate" | "object";

interface Term {
  label?: string | null;
  uri?: string | null;
}

interface Statement {
  subject?: Term | null;
  predicate?: Term | null;
  object?: Term | null;
}

/** Identity key for a subject — canonical CURIE wins, label fallback.
 *  Uses the same canonical form as ``sameTerm`` so subjects that
 *  ship as full-IRI on one side and bare-CURIE on the other still
 *  pair together. */
function subjectKey(s: Statement | null | undefined): string {
  if (!s) return "";
  const uri = canonUri(s.subject?.uri);
  if (uri) return `uri:${uri}`;
  const label = (s.subject?.label ?? "").trim().toLowerCase();
  return label ? `lbl:${label}` : "";
}

/** Canonical CURIE form for a URI — collapses
 *  ``http://purl.obolibrary.org/obo/TGEMO_00001`` and the bare CURIE
 *  ``TGEMO:00001`` to the same string so two sides that ship the
 *  same term in different representations don't read as different.
 *  Empty / falsy → empty string. */
function canonUri(uri: string | null | undefined): string {
  const raw = (uri ?? "").trim();
  if (!raw) return "";
  return shortenUri(raw).toLowerCase();
}

/** Same-term test:
 *   - Both URIs present and canonicalise to the same CURIE → same.
 *   - Both URIs absent: labels match (trim + lowercase) → same.
 *   - One URI present, the other absent: labels match → same (one
 *     side is just the unresolved version of the same term).
 *   - URIs canonicalise to different CURIEs → different (a real
 *     semantic difference, even if labels happen to coincide).
 *   - Both completely empty → same.
 *
 *  The canonicalisation guards against the most common false
 *  positive: bare-CURIE vs full-IRI representation drift across the
 *  two sides of a comparison. Paul 2026-06-15 caught
 *  ``Homozygous negative TGEMO:00001`` being marked diff on both
 *  sides when the displayed CURIE was identical. */
function sameTerm(a: Term | null | undefined, b: Term | null | undefined): boolean {
  const aUri = canonUri(a?.uri);
  const bUri = canonUri(b?.uri);
  const aLabel = (a?.label ?? "").trim().toLowerCase();
  const bLabel = (b?.label ?? "").trim().toLowerCase();
  // Both URIs present → URI is the ground truth.
  if (aUri && bUri) return aUri === bUri;
  // Both URIs absent → compare labels.
  if (!aUri && !bUri) return aLabel === bLabel;
  // Mixed (one URI, one not) → labels match treats as same.
  if (aLabel && bLabel) return aLabel === bLabel;
  // One side fully empty, the other not → different.
  return false;
}

/** Pair statement indices across two FVs. Subject-first matching,
 *  then positional, then leftover-as-added-or-removed. */
function pairStatementIndices(
  ls: ReadonlyArray<Statement>,
  rs: ReadonlyArray<Statement>,
): Array<{ li: number | null; ri: number | null }> {
  const pairs: Array<{ li: number | null; ri: number | null }> = [];
  const lUsed = new Set<number>();
  const rUsed = new Set<number>();
  // Subject-key match.
  for (let li = 0; li < ls.length; li++) {
    const k = subjectKey(ls[li]);
    if (!k) continue;
    for (let ri = 0; ri < rs.length; ri++) {
      if (rUsed.has(ri)) continue;
      if (subjectKey(rs[ri]) === k) {
        pairs.push({ li, ri });
        lUsed.add(li);
        rUsed.add(ri);
        break;
      }
    }
  }
  // Positional match for unmatched leftovers — pair the first
  // unmatched on each side until one runs out.
  let li = 0, ri = 0;
  while (li < ls.length && ri < rs.length) {
    while (li < ls.length && lUsed.has(li)) li++;
    while (ri < rs.length && rUsed.has(ri)) ri++;
    if (li >= ls.length || ri >= rs.length) break;
    pairs.push({ li, ri });
    lUsed.add(li);
    rUsed.add(ri);
    li++;
    ri++;
  }
  // Trailing left-only / right-only.
  for (let i = 0; i < ls.length; i++) {
    if (!lUsed.has(i)) pairs.push({ li: i, ri: null });
  }
  for (let i = 0; i < rs.length; i++) {
    if (!rUsed.has(i)) pairs.push({ li: null, ri: i });
  }
  return pairs;
}

export interface FvDiffKeys {
  leftKeys: ReadonlySet<string>;
  rightKeys: ReadonlySet<string>;
}

/** Compute the set of differing chip keys on each side. Returns
 *  empty sets when either FV is null (nothing to diff against — the
 *  caller renders the present side without rings). */
export function computeFvDiff(
  left: GridFv,
  right: GridFv,
): FvDiffKeys {
  const leftKeys = new Set<string>();
  const rightKeys = new Set<string>();
  if (!left || !right) return { leftKeys, rightKeys };
  const ls = (left.statements ?? []) as ReadonlyArray<Statement>;
  const rs = (right.statements ?? []) as ReadonlyArray<Statement>;
  const SLOTS: Slot[] = ["subject", "predicate", "object"];
  for (const { li, ri } of pairStatementIndices(ls, rs)) {
    if (li != null && ri == null) {
      for (const slot of SLOTS) leftKeys.add(`s${li}:${slot}`);
      continue;
    }
    if (ri != null && li == null) {
      for (const slot of SLOTS) rightKeys.add(`s${ri}:${slot}`);
      continue;
    }
    if (li != null && ri != null) {
      const a = ls[li];
      const b = rs[ri];
      for (const slot of SLOTS) {
        if (!sameTerm(a[slot], b[slot])) {
          leftKeys.add(`s${li}:${slot}`);
          rightKeys.add(`s${ri}:${slot}`);
        }
      }
    }
  }
  return { leftKeys, rightKeys };
}
