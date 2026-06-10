import {
  isPolishedSource,
  polishedCuratorOf,
  type Source,
} from "./sources";
import type { CurationRow } from "./useSourceAvailability";

/** Resolve a chip-strip Source token to the matching curation row
 *  from the unified /curations list. Handles direct curation_id
 *  matches plus the four legacy literal forms (preboard / live /
 *  agent_proposal / polished:<curator>). Returns null when no row
 *  matches (chip selected a source the experiment doesn't have, or
 *  the list is still loading).
 *
 *  Single source of truth for "given a chip token and the
 *  experiment's /curations response, which Curation row is this?".
 *  Consumed by ComparisonFactorCard, the baseline-drift section,
 *  and DesignDraftContext — they all need the same legacy-literal
 *  + consensus-slug unmapping rules. */
export function resolveCuration(
  source: Source | undefined,
  curations: readonly CurationRow[],
): CurationRow | null {
  if (!source || curations.length === 0) return null;
  const byId = curations.find((c) => c.curation_id === source);
  if (byId) return byId;
  if (
    source === "preboard" ||
    source === "live" ||
    source === "agent_proposal"
  ) {
    return curations.find((c) => c.source_kind === source) ?? null;
  }
  if (isPolishedSource(source)) {
    const slot = polishedCuratorOf(source);
    // Consensus producers are slug-routed through the polished
    // family (see useSourceAvailability.ts:_producerSlug). Unslug
    // "consensus_strict_cy_am" → producer "consensus:strict_cy_am".
    if (slot.startsWith("consensus_")) {
      const producer = slot.replace(/^consensus_/, "consensus:");
      return curations.find((c) => c.producer === producer) ?? null;
    }
    return (
      curations.find(
        (c) => c.source_kind === "curator_polish" && c.producer === slot,
      ) ?? null
    );
  }
  return null;
}
