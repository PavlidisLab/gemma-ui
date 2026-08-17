/**
 * The annotation identity a disposition PATCH carries with it.
 *
 * Everything else in provenance RECONSTRUCTS which annotation a
 * finding was about — after the fact, from category, label and URI.
 * This is the one place that doesn't have to: at the moment a curator
 * clicks, the UI is holding both the finding and the annotation it
 * touched, and no later process can recover that pairing. So the
 * click records it and the server's matcher is spared the guess.
 *
 * Concretely it buys back the ambiguous siblings. Two `treatment`
 * factors produce one slug, so a reconstructed key identifies two and
 * therefore neither — the matcher correctly refuses (15 findings
 * store-wide). A stamp resolves it to the one the curator was actually
 * looking at. Shape agreed in
 * `CAB_TO_UIB_2026_08_16_BUCKET_LANDED_AND_THE_STAMP_IS_WAITING_FOR_YOU.md`;
 * the store persists the four fields as nullable columns and lets the
 * stamp override the derived key on the same tier.
 *
 * 🛑 **Fails closed, and that is the whole contract.** A stamp
 * OVERRIDES the matcher, so a wrong one is worse than none: it
 * silently attaches an annotation's history to its sibling and nothing
 * downstream can tell. Where the design can't say which annotation is
 * meant, this returns null and the reconstruction takes over, which is
 * exactly what it's good at. That is why this doesn't reuse the
 * focus-jump resolver in `DesignEditor` — that one ends
 * `?? candidates[0]`, because scrolling to the first of two matching
 * factors is a harmless guess and stamping the first of two is not.
 */

import type { AuditFinding } from "@/api/auditTypes";
import type { Design, Factor, Tag } from "@/features/experiment/types";
import { parseTargetId, slug } from "@/features/audit/targetIds";

/** Snake_case to match the rest of the patch body; the store's models
 *  accept either casing. Every field optional — send what's known,
 *  omit the rest, and an unstamped row stays distinguishable from one
 *  stamped blank. */
export interface ProvenanceStamp {
  gemma_factor_id?: number;
  local_factor_id?: string;
  category_uri?: string;
  value_uri?: string;
}

/** The factor a finding points at, or null when the design can't say
 *  which one. */
function resolveFactor(
  design: Design,
  parsed: { factorSlug: string; factorId?: number },
): Factor | null {
  const factors = design.factors ?? [];
  // Findings about an element already in the design commonly carry its
  // storage id rather than a category slug (`factor:9325`).
  const asInt = Number.parseInt(parsed.factorSlug, 10);
  if (Number.isFinite(asInt)) {
    const byId = factors.find((f) => f.id === asInt);
    if (byId) return byId;
  }
  // The `#{id}` discriminator exists precisely to break the
  // same-category tie, so it outranks the slug.
  if (parsed.factorId != null) {
    const byDiscriminator = factors.find((f) => f.id === parsed.factorId);
    if (byDiscriminator) return byDiscriminator;
  }
  const candidates = factors.filter(
    (f) => slug(f.category?.label || "") === parsed.factorSlug,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveTag(
  design: Design,
  parsed: { categorySlug: string; valueSlug: string },
): Tag | null {
  const candidates = (design.tags ?? []).filter(
    (t) =>
      slug(t.category?.label ?? "") === parsed.categorySlug &&
      slug(t.value?.label ?? "") === parsed.valueSlug,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function nonEmpty(stamp: ProvenanceStamp): ProvenanceStamp | null {
  return Object.keys(stamp).length > 0 ? stamp : null;
}

/**
 * What to stamp on the disposition for this finding, or null when we
 * don't know enough to say anything true.
 *
 * A factor with neither a Gemma id nor a local id yields null even
 * when it resolves — there is no durable identity to record, and the
 * slug the matcher would derive is already as good as anything we
 * could send.
 */
export function stampForFinding(
  finding: AuditFinding | null | undefined,
  design: Design | null | undefined,
): ProvenanceStamp | null {
  if (!finding || !design) return null;
  const parsed = parseTargetId(finding.target_id ?? "");

  if (parsed?.kind === "factor") {
    const factor = resolveFactor(design, parsed);
    if (!factor) return null;
    const stamp: ProvenanceStamp = {};
    if (factor.gemma_factor_id != null) {
      stamp.gemma_factor_id = factor.gemma_factor_id;
    }
    if (factor.local_factor_id) stamp.local_factor_id = factor.local_factor_id;
    return nonEmpty(stamp);
  }

  if (parsed?.kind === "tag") {
    const tag = resolveTag(design, parsed);
    if (tag) {
      const stamp: ProvenanceStamp = {};
      if (tag.category?.uri) stamp.category_uri = tag.category.uri;
      if (tag.value?.uri) stamp.value_uri = tag.value.uri;
      return nonEmpty(stamp);
    }
  }

  // Nothing in the design matched — but an `add_tag` finding names the
  // term itself, and on an accept that term IS what the curator just
  // put there. On a dismissal it records which term was declined,
  // which is equally worth keeping. `replace_tag` is deliberately not
  // here: its URIs describe the proposed replacement, so they'd be
  // right after an accept and wrong after a dismissal, and the stamp
  // must not depend on reading the outcome.
  const apply = finding.apply_action;
  if (apply?.kind === "add_tag") {
    const stamp: ProvenanceStamp = {};
    // The payload union carries a forward-compat catch-all member, so
    // `kind === "add_tag"` narrows to two shapes and these read as
    // `unknown`. Check the type rather than cast — a URI field that
    // arrives as something other than a string is exactly the kind of
    // thing that should be dropped, not stamped.
    const categoryUri = apply.new_category_uri;
    const valueUri = apply.new_value_uri;
    if (typeof categoryUri === "string" && categoryUri) {
      stamp.category_uri = categoryUri;
    }
    if (typeof valueUri === "string" && valueUri) stamp.value_uri = valueUri;
    return nonEmpty(stamp);
  }
  return null;
}
