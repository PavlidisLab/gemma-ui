/**
 * Target-id formatters and parser for `AuditFinding.target_id`.
 *
 * Mirrors the canonical formatters in
 * `gemma-curation-agents/agents/audit/target_ids.py`. Used by the
 * inline severity dots (surface A) to look findings up against the
 * UI elements they anchor to.
 *
 * **Slug rule must match the agent side exactly** — divergence breaks
 * dot lookups silently. The Python helper does:
 *
 *     "-".join((s or "").lower().split())
 *
 * which is "lowercase, collapse all runs of whitespace into a single
 * dash". `slug()` below replicates that.
 *
 * Empty / falsy inputs are slugged to `"?"` (matching the Python
 * formatters' fallback). `parseTargetId()` treats anything it
 * doesn't recognise as `null` so callers can safely fall through to
 * "no anchor".
 */
import type { AuditTargetKind } from "@/api/auditTypes";

/** Matches `_slug()` in target_ids.py — lowercase, collapse all
 *  runs of whitespace into a single dash. NOT URL-safe; these are
 *  DOM keys, not routes. */
export function slug(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().split(/\s+/).filter(Boolean).join("-");
}

/** Empty-input fallback — mirrors `_slug(...) or '?'` in the
 *  Python formatters. Keeps slugs non-empty so a target_id is always
 *  parseable. */
function slugOr(s: string | null | undefined): string {
  return slug(s) || "?";
}

export function experimentTarget(experimentId: number | string): string {
  return `experiment:${experimentId}`;
}

export function factorTarget(factorCategory: string): string {
  return `factor:${slugOr(factorCategory)}`;
}

export function fvTarget(factorCategory: string, fvLabel: string): string {
  return `fv:${slugOr(factorCategory)}/${slugOr(fvLabel)}`;
}

export function tagTarget(category: string, value: string): string {
  return `tag:${slugOr(category)}/${slugOr(value)}`;
}

export function assignmentTarget(biomaterialShortName: string): string {
  return `assignment:${biomaterialShortName || "?"}`;
}

/** Parse a `target_id` back into its parts, or `null` if the shape
 *  doesn't match a known kind. Lets the dot resolver short-circuit
 *  without throwing on unknown / future kinds. */
export type ParsedTargetId =
  | { kind: "experiment"; experimentId: string }
  | { kind: "factor"; factorSlug: string }
  | { kind: "fv"; factorSlug: string; fvSlug: string }
  | { kind: "tag"; categorySlug: string; valueSlug: string }
  /** Entity-frame proposer characteristic finding. ``axes`` is the
   *  list of raw BM column slugs the agent's proposal targets — one
   *  element for ``characteristic_proposed_replacement`` (single-
   *  column supersession), two-or-more for
   *  ``characteristic_proposed_merge`` (multi-column merge). Canonical
   *  formatter mirror of agents-side
   *  ``agents/audit/target_ids.py::characteristic_target``: axes are
   *  sorted + ``+``-joined in the wire id. */
  | { kind: "characteristic"; axes: string[] }
  | { kind: "assignment"; biomaterialShortName: string }
  | { kind: "statement"; raw: string }; // Phase 2 — opaque for now

export function parseTargetId(targetId: string): ParsedTargetId | null {
  const colon = targetId.indexOf(":");
  if (colon === -1) return null;
  const kind = targetId.slice(0, colon) as AuditTargetKind;
  const rest = targetId.slice(colon + 1);
  switch (kind) {
    case "experiment":
      return { kind: "experiment", experimentId: rest };
    case "factor":
      return { kind: "factor", factorSlug: rest };
    case "fv": {
      const slash = rest.indexOf("/");
      if (slash === -1) return null;
      return {
        kind: "fv",
        factorSlug: rest.slice(0, slash),
        fvSlug: rest.slice(slash + 1),
      };
    }
    case "tag": {
      const slash = rest.indexOf("/");
      if (slash === -1) {
        // ``tag:<id>`` — numeric existing-id shape used by
        // ``calibration_gold_only_miss`` when the gold tag is
        // already in the design (see ``applyHandlers.ts``: "two
        // shapes: ``tag:<existing_id>`` when the gold tag is
        // already in the design (numeric id from storage), or
        // ``calibration:miss:<cat>/<val>`` when no existing-id
        // match was found"). The slug pieces aren't recoverable
        // from the id alone, so callers that need the (category,
        // value) slugs MUST fall through to the rationale text
        // backticks or the design's tag list. Return an empty
        // categorySlug / valueSlug pair so the kind is still
        // recognized as "tag" — that lets tab-routing
        // (``tabForTargetId``) succeed even when the slug shape is
        // missing. Design review 2026-06-14: tag-side magnifier "doesn't
        // even navigate to the overview tab"; this was the silent
        // bail.
        return {
          kind: "tag",
          categorySlug: rest,
          valueSlug: "",
        };
      }
      return {
        kind: "tag",
        categorySlug: rest.slice(0, slash),
        valueSlug: rest.slice(slash + 1),
      };
    }
    case "characteristic": {
      // Single slug → 1-element axes list (replacement).
      // `+`-joined slugs → multi-axis merge. Empty rest is rejected so
      // a malformed `characteristic:` id falls through to null instead
      // of producing a `{ axes: [""] }` that anchors to nothing.
      if (!rest) return null;
      return { kind: "characteristic", axes: rest.split("+") };
    }
    case "assignment":
      return { kind: "assignment", biomaterialShortName: rest };
    case "statement":
      return { kind: "statement", raw: rest };
    default:
      return null;
  }
}
