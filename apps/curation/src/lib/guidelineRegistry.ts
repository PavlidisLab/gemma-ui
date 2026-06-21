/**
 * Precise per-finding curation-rule registry.
 *
 * The agents repo
 * (`gemma_curation_agents/agents/curation_proposer/guideline_registry.py`)
 * is the single source of truth; `guidelineRegistry.json` is exported
 * from it (`scripts/export_guideline_registry.py`) and checked in here.
 * Re-run the export when the producer changes — don't hand-edit the
 * JSON.
 *
 * Where the broad `lib/guidelines.ts` snippets give a topic-level
 * refresher (ONTOLOGY / TAGS / BASELINE / …), this registry gives the
 * PRECISE rule that justifies a single finding — e.g. "this tag is
 * redundant because a biomaterial characteristic already covers it",
 * keyed off the finding's `issue_code` / `citation`. Surfaced by
 * `<RuleCite/>` as a `?` next to the finding's reasoning.
 */

import registry from "./guidelineRegistry.json";

/** One link-out for a precise rule (wiki page, checklist, etc.). */
export interface GuidelineRefLink {
  title: string;
  url: string;
}

/** A precise curation rule resolved from a finding. Mirrors the
 *  producer's `GuidelineRef` JSON shape. `links` is optional — most
 *  entries don't carry it yet, so every consumer must tolerate its
 *  absence. */
export interface GuidelineRef {
  /** Stable rule id, e.g. ``tags.redundant_bm_covered``. */
  rule_id: string;
  /** Broad topic the rule belongs to — maps 1:1 to a
   *  ``lib/guidelines.ts`` snippet ({ontologies, free_text,
   *  predicates, baselines, tags, checklist}). Drives the optional
   *  "more →" link to the topic refresher. */
  topic: string;
  /** Heading shown in the popover. */
  title: string;
  /** Body — the precise rule text. */
  snippet: string;
  /** Small provenance line (doc § section). */
  doc: string;
  /** Optional click-out anchors. Absent on most entries. */
  links?: GuidelineRefLink[];
}

// The JSON is keyed by D-code (e.g. ``D8``) or issue_code (e.g.
// ``calibration_gold_only_miss``). Cast through ``unknown`` because
// the imported JSON's inferred type varies per-entry (only ``D8`` has
// ``links`` today) — at runtime each value already has the
// ``GuidelineRef`` shape; the optional-key tolerance is real, not a
// lie about the data.
const REGISTRY = registry as unknown as Record<string, GuidelineRef>;

/** Narrow an arbitrary registry value to a usable ref. Tolerates
 *  missing / extra keys: requires only the fields we render
 *  (`title` + `snippet`); `links` may be absent. Returns null when
 *  the entry is malformed so a bad JSON row degrades to "no popup"
 *  rather than a crash. */
function asRef(raw: unknown): GuidelineRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GuidelineRef>;
  if (typeof r.title !== "string" || typeof r.snippet !== "string") {
    return null;
  }
  return {
    rule_id: typeof r.rule_id === "string" ? r.rule_id : "",
    topic: typeof r.topic === "string" ? r.topic : "",
    title: r.title,
    snippet: r.snippet,
    doc: typeof r.doc === "string" ? r.doc : "",
    links: Array.isArray(r.links)
      ? r.links.filter(
          (l): l is GuidelineRefLink =>
            !!l &&
            typeof (l as GuidelineRefLink).title === "string" &&
            typeof (l as GuidelineRefLink).url === "string",
        )
      : undefined,
  };
}

/** Look up a precise rule by registry key (D-code or issue_code). */
export function guidelineRefByKey(key: string | null | undefined): GuidelineRef | null {
  if (!key) return null;
  const k = key.trim();
  if (!k) return null;
  return Object.prototype.hasOwnProperty.call(REGISTRY, k)
    ? asRef(REGISTRY[k])
    : null;
}

/** Shape a finding needs for resolution — only the two fields the
 *  resolver reads. Kept loose so any finding-ish object works in
 *  tests without constructing a full ``AuditFinding``. */
export interface FindingLike {
  issue_code?: string | null;
  citation?: string | null;
}

/**
 * Resolve a finding to its precise curation rule, mirroring the
 * producer's `guideline_ref_for_finding`.
 *
 * Precedence:
 *   1. `finding.citation` — the most precise signal (chain / boss
 *      findings carry the D-code here).
 *   2. `finding.issue_code` — the coarser fallback.
 *   3. no match → null (the caller renders nothing).
 */
export function guidelineRefForFinding(
  finding: FindingLike | null | undefined,
): GuidelineRef | null {
  if (!finding) return null;
  return (
    guidelineRefByKey(finding.citation) ??
    guidelineRefByKey(finding.issue_code)
  );
}
