/**
 * UI-side tier abstraction for the proposer service's ``model``
 * parameter. The curator picks a generic tier; the mapping to a
 * provider-specific model id lives here so swapping providers is
 * a one-file change. The proposer service today expects Anthropic
 * model strings, but nothing in the UI references that fact.
 *
 * Three tiers represented today by Claude haiku / sonnet / opus —
 * fast / standard / strong respectively. ``standard`` matches the
 * design-proposer's hard-coded default in
 * ``gemma-curation-agents/.../design_proposer.py``; passing it
 * explicitly is harmless and keeps the wire protocol uniform.
 */
export type ModelTier = "fast" | "standard" | "strong";

export interface ModelTierDef {
  id: ModelTier;
  label: string;
  description: string;
  /** Provider-specific model id sent in the
   *  ``ProposeRequest.model`` field. Anthropic ids today; rename
   *  here if we ever route through a different provider. */
  providerModelId: string;
  /** Visual cost cue shown next to the tier label in the picker
   *  ($, $$, $$$). Three steps so the curator can compare across
   *  tiers without us hard-coding actual prices (which drift with
   *  provider pricing changes). */
  costMarker: "$" | "$$" | "$$$";
}

export const MODEL_TIERS: Record<ModelTier, ModelTierDef> = {
  fast: {
    id: "fast",
    label: "fast",
    description: "quickest, cheapest. Routine designs.",
    providerModelId: "claude-haiku-4-5-20251001",
    costMarker: "$",
  },
  standard: {
    id: "standard",
    label: "standard",
    description: "balanced. Matches the proposer service default.",
    providerModelId: "claude-sonnet-4-6",
    costMarker: "$$",
  },
  strong: {
    id: "strong",
    label: "strong",
    description: "highest capability. Use when standard misses things.",
    providerModelId: "claude-opus-4-7",
    costMarker: "$$$",
  },
};

export const DEFAULT_MODEL_TIER: ModelTier = "standard";

export const MODEL_TIER_ORDER: ModelTier[] = ["fast", "standard", "strong"];

/**
 * Reverse-lookup a provider model id to its tier label. Useful for
 * surfacing the tier alongside a raw model id on a proposal card —
 * the curator scans "fast" / "standard" / "strong" faster than
 * `claude-haiku-4-5-20251001`.
 *
 * Today this only matches the canonical tier ids; an ad-hoc model
 * override (e.g. an experimental id passed via the ``model`` escape
 * hatch) returns ``null``. Caller renders the raw id without a tier
 * chip in that case.
 */
export function tierForProviderModel(
  modelId: string | null | undefined,
): ModelTier | null {
  if (!modelId) return null;
  for (const tier of MODEL_TIER_ORDER) {
    if (MODEL_TIERS[tier].providerModelId === modelId) return tier;
  }
  return null;
}
