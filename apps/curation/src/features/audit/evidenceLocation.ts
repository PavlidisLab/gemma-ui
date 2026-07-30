/**
 * Parse the semantic structure the agents-repo bakes into a tag
 * evidence ``location`` string into a small discriminated union the UI
 * can render deliberately (count badge, coverage ratio, alias spans,
 * catalog badge) instead of dumping the raw string. Regex-light — no
 * backend change needed to feed structured fields.
 *
 * Shapes:
 *   "strain (all 24 samples)"
 *   "strain in GSM0, GSM1, GSM2, +1 more (4/6 samples)"
 *   "strain (claimed by caller but matched 0/N samples — investigate)"
 *   "matched alias 'C57BL/6J' → 'C57BL/6J'"
 *   "cellosaurus_catalog"
 *   <anything else> → plain passthrough
 */
export type EvidenceLocation =
  | { kind: "constant"; scope: string; count: number | null }
  | {
      kind: "partial";
      scope: string;
      samples: string[];
      moreCount: number;
      matched: number | null;
      total: number | null;
    }
  | { kind: "bug"; scope: string; total: number | null }
  | { kind: "alias"; from: string; to: string }
  | { kind: "catalog" }
  | { kind: "plain"; text: string };

const CONSTANT_RE = /^(.*?)\s*\(all\s+(\d+)\s+samples?\)\s*$/i;
const BUG_RE =
  /^(.*?)\s*\(claimed by caller but matched\s+0\/(\d+)\s+samples?\s*[—-].*\)\s*$/i;
const PARTIAL_RE = /^(.*?)\s+in\s+(.*?)\s*\((\d+)\s*\/\s*(\d+)\s+samples?\)\s*$/i;
// Accept the unicode arrow (→) or an ASCII "->" fallback.
const ALIAS_RE = /^matched alias\s+'(.*?)'\s*(?:→|->)\s*'(.*?)'\s*$/i;
const MORE_RE = /^\+(\d+)\s+more$/i;

export function parseEvidenceLocation(raw: string | null | undefined): EvidenceLocation {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "plain", text: "" };

  if (text.toLowerCase() === "cellosaurus_catalog") return { kind: "catalog" };

  const bug = BUG_RE.exec(text);
  if (bug) {
    return { kind: "bug", scope: bug[1].trim(), total: toIntOrNull(bug[2]) };
  }

  const constant = CONSTANT_RE.exec(text);
  if (constant) {
    return {
      kind: "constant",
      scope: constant[1].trim(),
      count: toIntOrNull(constant[2]),
    };
  }

  const partial = PARTIAL_RE.exec(text);
  if (partial) {
    const { samples, moreCount } = splitSampleList(partial[2]);
    return {
      kind: "partial",
      scope: partial[1].trim(),
      samples,
      moreCount,
      matched: toIntOrNull(partial[3]),
      total: toIntOrNull(partial[4]),
    };
  }

  const alias = ALIAS_RE.exec(text);
  if (alias) {
    return { kind: "alias", from: alias[1], to: alias[2] };
  }

  return { kind: "plain", text };
}

/** Split "GSM0, GSM1, GSM2, +1 more" → names + the trailing "+N more"
 *  count (0 when absent). */
function splitSampleList(s: string): { samples: string[]; moreCount: number } {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let moreCount = 0;
  const samples: string[] = [];
  for (const p of parts) {
    const m = MORE_RE.exec(p);
    if (m) moreCount += toIntOrNull(m[1]) ?? 0;
    else samples.push(p);
  }
  return { samples, moreCount };
}

function toIntOrNull(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
