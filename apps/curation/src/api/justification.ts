/**
 * Unified justification types — shared between proposal review and
 * audit findings. Mirrors the agents-side
 * `agents/shared/justification.py`.
 *
 * Wire-format note: most fields use snake_case (matches the
 * payload_json verbatim). `AttachedDefenderVerdict` is the exception
 * — its compound-name fields land as camelCase (`citationUrl`)
 * because the agents-side Pydantic model has `alias_generator=to_camel`
 * while sibling models don't. Both serializations need to be
 * tolerated.
 *
 * These types layer ONTO the existing legacy `auditTypes.ts`
 * `FindingEvidence` / `AttachedDefenderVerdict` shapes — when the
 * audit-side schema PR lands, we relocate from `auditTypes.ts` to
 * here and re-export. Today this file holds the proposal-side
 * mirror; audit-side keeps its own definitions until extraction.
 */

/** The evidence sources the UI has its own label and colour for — see
 *  `features/audit/evidenceSource.ts`. */
export type KnownEvidenceSource =
  | "paper"
  | "preboarding"
  | "sample_names"
  | "geo_metadata"
  | "characteristic";

/** 🛑 **Open, not an enum.** What Gemma stores in `supportingEvidence`
 *  carries sources outside the five above — `inferred`,
 *  `curator_ruling`, `audit`, `legacy_note` — and the agents'
 *  `justification.py` opened its own `Literal` to `str` on 2026-09-11
 *  for that reason. `evidenceSourceMeta` names an unknown source by
 *  what was recorded. */
export type EvidenceSource = KnownEvidenceSource | (string & {});

/** One quote / row that grounded a producer's pick. */
export interface FindingEvidence {
  quote: string;
  source: EvidenceSource;
  location?: string;
  context?: string;
  source_url?: string;
  highlights?: [number, number][];
  /** Tri-state paper-quote verification against the cached full text:
   *  `true` → verified (green ✓), `false` → not found in cache (amber ⚠),
   *  `null`/absent → not verifiable (no badge). See auditTypes.FindingEvidence. */
  verified?: boolean | null;
}

/** Keep what an evidence chip can render: an array of objects carrying
 *  a string `quote`. Undefined for null, a bare string, or an array of
 *  anything else, so a shape change upstream shows as a missing chip
 *  rather than a broken one. */
export function asFindingEvidence(v: unknown): FindingEvidence[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (e): e is FindingEvidence =>
      !!e &&
      typeof e === "object" &&
      typeof (e as { quote?: unknown }).quote === "string",
  );
  return out.length > 0 ? out : undefined;
}

/** Several evidence lists as one, each item once. The samples folded
 *  into one table row, or the two pairs of one statement, carry copies
 *  of the same item; same source, quote and location is the same item.
 *  Anything `asFindingEvidence` would drop is dropped. */
export function mergeEvidence(
  lists: ReadonlyArray<unknown>,
): FindingEvidence[] | undefined {
  const out: FindingEvidence[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const e of asFindingEvidence(list) ?? []) {
      const key = [e.source ?? "", e.quote, e.location ?? ""].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * One judgment from defender / arbiter / boss on a specific element.
 * Wire shape uses camelCase for the compound `citation_url`
 * (`citationUrl`) — see file header. Extra fields (`mode`,
 * `confidence`, `corrections`, `calibration_side`) populated by the
 * calibration pipeline; safe to ignore when absent.
 */
export interface AttachedDefenderVerdict {
  side: "defender" | "arbiter" | "boss";
  verdict: string;
  strength?: "weak" | "moderate" | "strong";
  rationale?: string;
  citation?: string;
  /** camelCase on the wire, per Pydantic alias_generator. */
  citationUrl?: string;
  /** Calibration-only extension fields — populated by the audit /
   *  calibration pass. Empty on producer-side verdicts. */
  mode?: string;
  confidence?: string;
  corrections?: unknown[];
  calibration_side?: string;
}

/**
 * One decision from a specialist subtask (S2j, S2m, S2r, S6, etc).
 *
 * String fields are always emitted on the wire (Pydantic defaults to
 * "" rather than absent), so they're typed as required strings.
 * `confidence` is genuinely optional — older subtasks leave it
 * unset.
 */
export interface SubtaskDecision {
  subtask: string;
  label: string;
  verdict: string;
  citation: string;
  citation_url: string;
  /** Pointer back to the element this decision is about. Format
   *  examples: `""` (proposal-wide), `"factor:genotype"`,
   *  `"factor:0/category"`, `"factor:0/fv:1"`, `"tag:0"`. */
  target_id: string;
  confidence?: "zero" | "low" | "medium" | "high";
  /** Optional severity added by the boss-critic loop (agents-side
   *  commit ``5d6e069``). Boss-critic decisions ride in this same
   *  ``SubtaskDecision`` list (subtask=``"boss_critic_round_<N>"``)
   *  and surface their severity through this field so UIB can
   *  distinguish blockers from advisories without a new type. ``ok``
   *  / undefined behave identically. */
  severity?: "blocker" | "advisory" | "ok" | "escalation";
}

/** One ontology-search hit. Used for `ResolverDecision.alternatives[]`. */
export interface Candidate {
  label: string;
  uri: string;
  score?: number | null;
  usage_count?: number | null;
  category?: string | null;
}

/** Captured at resolver pick time on every `OntologyTerm`. Not yet
 *  populated by today's payloads — producer migration pending. */
export interface ResolverDecision {
  resolver: string;
  score?: number | null;
  canonical_label?: string;
  usage_count?: number | null;
  parent_distance?: number;
  alternatives?: Candidate[];
  rationale?: string;
  citation?: string;
  citation_url?: string;
}

/** Proposal-wide ruling from the boss pass. Top-level on the
 *  payload; per-element boss verdicts ride in `defender_verdicts[side="boss"]`.
 *  Not yet populated by today's payloads — stubbed agent-side. */
export interface BossVerdict {
  status: "ok" | "split_recommended" | "collapse_recommended" | "rebalance_recommended" | "no_design";
  rationale?: string;
  citation?: string;
  citation_url?: string;
  targets?: string[];
}
