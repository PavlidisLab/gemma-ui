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
 *
 * ## Discriminator suffix (`#{id}`) — 2026-07-30
 *
 * `target_id` used to be pure content-addressing (category/label
 * only), which silently collides whenever two distinct factors or
 * FVs share a category — a real, common design shape (two
 * `treatment` factors), not an edge case. Confirmed cross-repo
 * (`~/Dev/eclipseworkspace/Gemma/handoffs/
 * STORE_REPLY_2026_07_30_DISPOSITION_DROPS_TARGET_ID_COLLISION.md`):
 * the store's `MAX(id) GROUP BY target_id` read silently masks the
 * older of two colliding dispositions. Fix: `factorTarget`/`fvTarget`
 * now accept the entity's real Gemma id and append it as `#{id}` —
 * `factor:treatment#101`, `fv:treatment/vehicle#205`. Tags stay bare
 * for now (`Tag.id` isn't a Gemma id — see the same handoff thread,
 * `UIB_REPLY_2026_07_30_TARGET_ID_ID_PROVENANCE_ANSWERS.md`).
 *
 * Backward-compatible by construction: the id is OPTIONAL on every
 * formatter (omit it and you get the old bare form), and
 * `parseTargetId` strips the suffix into a separate `factorId`/`fvId`
 * field rather than folding it into `factorSlug`/`fvSlug` — so every
 * existing slug-equality comparison in the codebase keeps working
 * unchanged for the common (non-colliding) case. Callers that need to
 * disambiguate a real collision (multiple factors sharing a category)
 * should filter by slug first, then break ties with the id field when
 * more than one candidate matches — see `resolveFactor` in
 * `features/design/DesignEditor.tsx` for the reference pattern.
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

/** Strip a trailing ``#{id}`` discriminator off a target_id segment.
 *  `slug()` never produces a `#` itself, so the first one found is
 *  always the discriminator boundary. Returns the id as `undefined`
 *  (not `null`) when absent or non-numeric, so callers can use it
 *  directly in an optional object field. */
function splitDiscriminator(segment: string): {
  base: string;
  id?: number;
} {
  const hash = segment.indexOf("#");
  if (hash === -1) return { base: segment };
  const idStr = segment.slice(hash + 1);
  const id = Number(idStr);
  return {
    base: segment.slice(0, hash),
    id: idStr !== "" && Number.isFinite(id) ? id : undefined,
  };
}

export function experimentTarget(experimentId: number | string): string {
  return `experiment:${experimentId}`;
}

/** `factorId` is the factor's real Gemma `ExperimentalFactor` id
 *  (`Factor.id` for a freshly-imported design — see the discriminator
 *  doc comment above for the proposal-accept caveat). Omit for the
 *  legacy bare form (still correct for the common non-colliding case,
 *  and the only option for agent-proposed factors, which have no id
 *  yet — see the handoff thread). */
export function factorTarget(
  factorCategory: string,
  factorId?: number | null,
): string {
  const disc = factorId != null ? `#${factorId}` : "";
  return `factor:${slugOr(factorCategory)}${disc}`;
}

/** `fvId` is the FactorValue's real Gemma id (`FactorValue.id`). */
export function fvTarget(
  factorCategory: string,
  fvLabel: string,
  fvId?: number | null,
): string {
  const disc = fvId != null ? `#${fvId}` : "";
  return `fv:${slugOr(factorCategory)}/${slugOr(fvLabel)}${disc}`;
}

export function tagTarget(category: string, value: string): string {
  return `tag:${slugOr(category)}/${slugOr(value)}`;
}

export function assignmentTarget(biomaterialShortName: string): string {
  return `assignment:${biomaterialShortName || "?"}`;
}

/** Mirrors `publication_target` in target_ids.py. PMID is the natural
 *  key — matches `Publication.pubmed_id` on the wire. NOT the same
 *  namespace as `publicationRefId` in `features/provenance/refs.ts`
 *  (`publication:pmid:{pmid}`) — that one keys the link's own
 *  provenance dot (who asserted this paper belongs here); this one
 *  keys an audit finding (is it actually the right paper). */
export function publicationTarget(pmid: string): string {
  return `publication:${pmid || "?"}`;
}

/** Parse a `target_id` back into its parts, or `null` if the shape
 *  doesn't match a known kind. Lets the dot resolver short-circuit
 *  without throwing on unknown / future kinds. */
export type ParsedTargetId =
  | { kind: "experiment"; experimentId: string }
  /** ``factorId`` is the discriminator parsed off a ``#{id}`` suffix,
   *  or ``undefined`` for the legacy bare form. ``factorSlug`` is
   *  ALWAYS the pure category slug (discriminator already stripped)
   *  so existing slug-equality comparisons keep working unchanged —
   *  only disambiguate with ``factorId`` when more than one candidate
   *  matches the slug. */
  | { kind: "factor"; factorSlug: string; factorId?: number }
  | {
      kind: "fv";
      factorSlug: string;
      fvSlug: string;
      /** Discriminator off the FV's own ``#{id}`` suffix — see
       *  ``factorId`` above for the same stripped-slug contract. */
      fvId?: number;
    }
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
  | { kind: "publication"; pmid: string }
  | { kind: "statement"; raw: string }; // Phase 2 — opaque for now

export function parseTargetId(targetId: string): ParsedTargetId | null {
  const colon = targetId.indexOf(":");
  if (colon === -1) return null;
  const kind = targetId.slice(0, colon) as AuditTargetKind;
  const rest = targetId.slice(colon + 1);
  switch (kind) {
    case "experiment":
      return { kind: "experiment", experimentId: rest };
    case "factor": {
      const { base, id } = splitDiscriminator(rest);
      return { kind: "factor", factorSlug: base, factorId: id };
    }
    case "fv": {
      const slash = rest.indexOf("/");
      if (slash === -1) return null;
      const { base, id } = splitDiscriminator(rest.slice(slash + 1));
      return {
        kind: "fv",
        factorSlug: rest.slice(0, slash),
        fvSlug: base,
        fvId: id,
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
    case "publication":
      return { kind: "publication", pmid: rest };
    case "statement":
      return { kind: "statement", raw: rest };
    default:
      return null;
  }
}
