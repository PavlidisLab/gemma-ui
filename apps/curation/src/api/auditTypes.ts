/**
 * Wire types for the audit-existing-curation feature.
 *
 * Mirrors the Pydantic models in
 * `gemma-curation-agents/agents/audit/schemas.py`. When the agent
 * side renames a field, these shapes follow.
 *
 * Audits never rewrite curation. ``AuditFinding.suggested_fix`` is
 * free-text only; materialising a fix is always a curator click in
 * the UI.
 */
import type { OntologyTerm, Proposal, StatementProposal } from "./types";

/** What an `AuditFinding` is *about*. ``"statement"`` is reserved for
 *  Phase 2 (predicate/object on an FV) — no Phase 1 emitter should
 *  produce one, but the literal stays here so we don't break the wire
 *  when it lands. */
export type AuditTargetKind =
  | "experiment"
  | "factor"
  | "fv"
  | "tag"
  | "characteristic"
  | "assignment"
  | "statement";

/** ``ok`` is emitted for green checks so the report can show what was
 *  verified, not just what failed. The UI default-collapses ``ok``
 *  findings — see `AuditReportView`. */
export type Severity = "ok" | "minor" | "major" | "blocker";

/** Subset-selectable scope so a tags-only or design-only audit
 *  doesn't pay for the whole pipeline. Empty array is rejected by the
 *  server (400). */
export type AuditScopeItem = "factors" | "fvs" | "tags" | "assignments";

/** Roll-up for inbox sorting. Derived server-side from finding
 *  severity counts; treat as authoritative rather than recomputing
 *  client-side so the ``ok``-finding policy stays consistent. */
export type OverallVerdict =
  | "clean"
  | "minor_issues"
  | "major_issues"
  | "blockers";

/** A single quote / row that grounded the proposer's pick on a
 *  given finding. Rendered as a blockquote with a small source-label
 *  chip in the audit-finding card. Solves the per-finding
 *  evidence-anchor gap (the report-level ``evidence.paper_excerpt``
 *  is too coarse). */
export interface FindingEvidence {
  /** Full-sentence rendering. Whole sentences only — half-sentence
   *  fragments read as cherry-picked. */
  quote: string;
  source:
    | "paper"
    | "preboarding"
    | "sample_names"
    | "geo_metadata"
    | "characteristic";
  /** Optional pointer back to the source — paper section, sample
   *  short_name list, characteristic key, etc. Empty when the source
   *  label itself is sufficient. */
  location?: string;
  /** Wider surrounding text — paragraphs / neighbour rows / full
   *  characteristic block. UI shows ``quote`` as the preview and
   *  reveals ``context`` behind a "Show more" expander. Empty when
   *  no wider context applies (single-line characteristic, etc.);
   *  UI hides the expander. */
  context?: string;
  /** Deep-link to the canonical source so the curator can bounce
   *  out to the GEO record / PubMed / Gemma sample page when the
   *  inline context isn't enough. UI renders an "open ↗" next to
   *  the source-label chip; hidden when empty. */
  source_url?: string;
  /** Half-open ``(start, end)`` byte offsets into ``context`` to
   *  highlight (typically the anchor ``quote`` substring). UI wraps
   *  matching spans in a soft yellow highlight so the eye lands on
   *  the anchor inside the wider context. Multi-range supported.
   *  Empty when no highlight applies (one-line contexts, paraphrased
   *  quotes that aren't literal substrings). */
  highlights?: [number, number][];
  /** Paper-quote verification against the authoritative cached full text,
   *  stamped at build time so the curator never fetches the paper. Tri-state:
   *  `true` — quote located in the cached full text (repaired to the full
   *  sentence; `source_url` deep-links to it) → green ✓ badge; `false` — a
   *  paper quote NOT found in the cached text (credibility red flag) → amber
   *  ⚠ badge; `null`/absent — not verifiable (non-paper source, or no cached
   *  paper) → no badge. */
  verified?: boolean | null;
}

/** The six canonical actions a post-proposal-evaluation finding can
 *  recommend — the "what should I DO" the curator headline reads off.
 *  Mirrors agents-side ``RECOMMENDATION_ACTIONS`` (gemma-curation-agents
 *  ``a2a40f3``). */
export type RecommendationAction =
  | "keep_current" //     gold/current is right; no change
  | "adopt_proposal" //   agent is right; apply its proposal
  | "merge" //            keep current AND fold in ``adopt_value``
  | "drop" //             agent's extra is wrong / over-tagged
  | "add_missing" //      gold has something the agent missed
  | "flag_for_curator" // genuinely ambiguous; human call
  | (string & {});

/** Canonical, deterministically-derived "what to do" for a finding — the
 *  curator headline. Collapsed agent-side from the finding's single
 *  verdict (boss > arbiter > defender); no LLM. ``null`` / absent when no
 *  verdict is attached, in which case the UI falls back to legacy
 *  rendering. */
export interface Recommendation {
  action: RecommendationAction;
  /** The ONE concrete value / statement to fold onto gold — set for
   *  ``merge`` (and ``adopt_proposal``), null otherwise. Value-first,
   *  never a label rename. */
  adopt_value?: string | null;
  confidence: "high" | "medium" | "low" | (string & {});
  /** One-sentence "why" — renders as the headline subtitle. */
  one_line_reason: string;
}

export interface AuditFinding {
  target_kind: AuditTargetKind;
  /** Stable id of the existing curation element this finding addresses
   *  (factor.id, fv.id, tag.id, biomaterial.short_name, …). Free-form
   *  string for forward-compat; the UI uses it as an opaque key to
   *  anchor the finding card to the rendered curation element. */
  target_id: string;
  severity: Severity;
  /** Programmatic short id — used in tests, eval aggregations, and as
   *  a stable handle the UI can switch on for custom rendering.
   *  Examples: ``forbidden_efc``, ``missing_baseline``,
   *  ``ungrounded_term``, ``low_confidence_assignment``,
   *  ``coverage_zero``, ``ok``. */
  issue_code: string;
  rationale: string;
  citation: string;
  citation_url: string;
  suggested_fix: string;
  /** THE curator headline — the canonical "what should I do" for this
   *  finding, derived deterministically agent-side from the collapsed
   *  verdict (boss > arbiter > defender). Render as the card headline:
   *  the action verb + (for merge/adopt) ``adopt_value``, with
   *  ``one_line_reason`` as subtitle and a ``confidence`` chip; the
   *  issue_code slug, the rationale stack, ``defender_verdict``, and the
   *  three-phase blocks demote to the expandable detail. ``null`` /
   *  absent when no verdict is attached — fall back to the legacy
   *  rendering there. Mirrors agents-side
   *  ``AuditFinding.recommendation``. */
  recommendation?: Recommendation | null;
  /** One-line rendering of what the silent comparison proposer
   *  produced for the same target, when comparable. Empty when there's
   *  no clean correspondence (experiment-wide findings, or a tag the
   *  proposer didn't suggest). Always empty when
   *  ``AuditEvidence.comparison_proposal`` is ``null``.
   *
   *  Kept as a fallback caption — the structured ``proposer_term``
   *  / ``proposer_defense`` below are the canonical render targets
   *  on newer reports. */
  proposer_suggestion: string;
  /** Structured ontology term the proposer would have used. Render
   *  as a green linkified Term chip when ``uri`` is set; italic grey
   *  when free-text. Null on older reports (predates the structured
   *  fields) or when the suggestion is structural rather than a term
   *  swap. */
  proposer_term?: OntologyTerm | null;
  /** One-sentence rationale from the proposer / silent defender for
   *  *why* this term was the right pick. Distinct from ``rationale``
   *  — that's the finding's rationale (why the gold curation is
   *  wrong); this is the proposer's positive case for its
   *  alternate. Empty on older reports. */
  proposer_defense?: string;
  /** Per-finding evidence anchors — full-sentence quotes from the
   *  paper / preboarding / sample names / GEO metadata /
   *  characteristics. Rendered as blockquotes. Empty on older
   *  reports or when no specific quote grounds the suggestion. */
  supporting_evidence?: FindingEvidence[];
  /** True when the judge ran but no paper excerpts could be
   *  anchored to this finding (legacy pack predating the
   *  ``paper_excerpts`` proposer schema, biolit miss, OA-PDF lookup
   *  failure, character-budget exhaustion, etc.). Distinct from
   *  "``supporting_evidence`` happened to be empty" — when this is
   *  ``true`` the UI renders a muted "no paper excerpt emitted —
   *  judge rationale above is un-grounded" caption so the curator
   *  can see WHY the evidence box is empty. When ``false`` (or
   *  absent) and ``supporting_evidence`` is also empty, the finding
   *  has no rationale to ground in the first place (structural-only
   *  findings like ``calibration_factor_gold_only_miss``) and the
   *  UI shows nothing.
   *
   *  Shipped 2026-06-12 by the agents side.
   *  Replaces the legacy synthetic ``supporting_evidence`` entry
   *  whose ``location`` was the literal "AGENT-PARAPHRASE FALLBACK
   *  (PAPER_EXCERPTS NOT EMITTED)"; the UI's old string-match
   *  suppression is retained as a fallback for transcripts archived
   *  pre-flag. */
  paper_excerpts_unavailable?: boolean;
  /** Structured statement(s) for the proposer's pick — populated
   *  on FV / factor-shape findings so the UI can render the same
   *  ``StatementGlyph`` (S-P-O three-disc visualisation) the
   *  proposal card uses. Also populated on ``calibration_tag_match_near``
   *  tag findings whose statements moved (2026-07-13): the finding
   *  card renders these as subject·predicate·object in place of the
   *  bare value chip. Empty on plain tag findings (the single
   *  ``proposer_term`` is enough) and on older reports that pre-date
   *  the field. */
  proposer_statements?: StatementProposal[];
  /** Defender-style "second opinion" attached to the finding when
   *  the audit ran a defender pass against this target. Populated on
   *  ``calibration_agent_extra`` and ``calibration_gold_only_miss``
   *  findings on calibration packages ≥ v9; ``null`` on
   *  ``calibration_match`` findings (defender doesn't run on
   *  matches), on older calibration packages, and on freshly-audited
   *  live experiments where the defender hasn't been invoked. UI
   *  hides the panel when null. */
  defender_verdict?: AttachedDefenderVerdict | null;
  /** Debate-loop badge for the tag this finding is about.
   *  ``"gold"`` = approved without objection,
   *  ``"silver"`` = one contested round,
   *  ``"bronze"`` = multiple contested rounds,
   *  ``"stuck"`` = no consensus.
   *  Empty string or absent = no debate was run (``--debate`` not
   *  used) or finding is a gold-only-miss. */
  debate_badge?: string;
  /** Structured side-by-side diff for a ``calibration_factor_rename``
   *  finding. Populated when the arbiter classifies a factor pair as
   *  same-factor-different-label (commit 767f7f6, 2026-05-17). Null
   *  on every other finding type and on older packages. The UI gates
   *  the FV-pair diff render on ``rename != null``. */
  rename?: FactorRenamePayload | null;
  /** 0-based index into
   *  ``audit.evidence.comparison_proposal.factors`` identifying which
   *  agent factor the builder committed to as this gold factor's
   *  match. Populated on ``calibration_factor_match_exact``,
   *  ``calibration_factor_match_close``, and
   *  ``calibration_factor_rename`` findings from calibration package
   *  v12+ (agents-repo commit ``f313770``, 2026-05-18). The builder
   *  guarantees a one-to-one agent → gold pairing so the same agent
   *  factor never appears on two match cards.
   *
   *  ``null`` / ``undefined`` on older audits that pre-date the
   *  field; the UI then falls back to its previous best-FV-overlap
   *  re-derivation (which can show the same agent factor on multiple
   *  cards in multi-factor-same-category designs — exactly the bug
   *  this field closes). */
  agent_target_index?: number | null;
  /** Gold-side analogue of ``agent_target_index`` — 0-based index of
   *  the gold ``Factor`` this finding refers to in the design's
   *  factor list. Disambiguates multi-factor-same-category cases
   *  (e.g. GSE93824's two ``genotype`` factors) where the
   *  slug-only ``target_id`` (``factor:genotype``) collides across
   *  finding cards. Set on ``calibration_factor_match_exact`` /
   *  ``_near`` / ``calibration_factor_rename`` /
   *  ``calibration_factor_gold_only_miss``. ``null`` on
   *  ``calibration_factor_extra`` (no gold counterpart by
   *  definition) and on older builders. Agents-repo commit
   *  ``3868a09``. */
  gold_target_index?: number | null;
  /** Opaque ``curation_id`` of the gold curation row the agent
   *  compared against — disambiguates ``gold_target_index`` when an
   *  experiment carries multiple consensus rows (strict_consensus /
   *  strict_cy_am / …). Stamped on every finding whose
   *  ``gold_target_index`` is non-null (added 2026-06-14, agents SHA
   *  ``9a0faec``). Null on old packages, on findings built from a
   *  live-Gemma fetch, and on ``calibration_factor_extra`` (no gold
   *  counterpart). Wire field: ``goldCurationId`` (camelCase). */
  gold_curation_id?: string | null;
  /** Cross-reference UUID stamped on both halves of a demoted
   *  same-category factor match. When the builder demotes a
   *  partition-mismatched same-label pair into
   *  ``calibration_factor_extra`` (agent side) +
   *  ``calibration_factor_gold_only_miss`` (gold side), both findings
   *  carry the same value here. The UI surfaces a "↔ paired with …"
   *  badge near the severity chip that jumps to the sibling so the
   *  curator can see the two halves as one event instead of two
   *  disconnected (and visually contradictory) cards. Null outside
   *  demotion pairs + on pre-2026-05-20 builders. */
  paired_finding_id?: string | null;
  /** Structured payload for a
   *  ``calibration_factor_partition_mismatch`` finding. Populated
   *  when the builder detects a same-label factor pair whose
   *  partitions disagree along a clean finer/coarser shape (every
   *  agent FV is a strict subset of some gold FV, or vice versa).
   *  Replaces the legacy ``_factor_extra`` + ``_factor_gold_only_miss``
   *  pair the demoter used to emit. Null otherwise.
   *
   *  Schema mirror of agents-side ``PartitionMismatchPayload``. */
  partition_mismatch?: PartitionMismatchPayload | null;
  /** Slugs naming proposer-side deterministic detectors that fired
   *  on the factor this finding references. Lets the UI render a
   *  "pipeline flagged this" chip without dredging through
   *  ``evidence.subtask_decisions``.
   *
   *  Vocabulary (mirror of agents-side commit ``e474351``):
   *
   *  - ``"multi_factor_collapse"`` — S2j flagged the agent's factor
   *    as encoding a cross-product as one FV (has-modifier predicate,
   *    "X and Y" coordinator).
   *  - ``"multi_factor_split"``    — S2m flagged the agent's factor
   *    as encoding a cross-product as N separate FVs sharing a stem
   *    with axis-shaped suffix variation (``rotenone 3h`` /
   *    ``rotenone 3d``).
   *
   *  Empty list when no detector fired and on builders predating
   *  the field. New slugs may appear without UI lockstep — keep the
   *  type as ``string[]`` so unknown values just don't render a
   *  chip. */
  proposer_flags?: string[];
  /** Target-id of an upstream finding whose existence implies this
   *  one — the absorbed-side half of a bidirectional finding link.
   *  Populated on `_factor_gold_only_miss` findings when a partition-
   *  mismatch finding (on a different gold factor) absorbs the same
   *  partition via its `consequents` list. Walking
   *  ``consequent_of → consequents`` is the canonical way to find
   *  the linked partition_mismatch from any absorbed miss.
   *
   *  Null on findings outside a partition-absorption pair and on
   *  pre-2026-05-20 builders. */
  consequent_of?: string | null;
  /** Target-ids of downstream findings absorbed by this one — the
   *  upstream-side half of the bidirectional link. Populated on
   *  `calibration_factor_partition_mismatch` findings when the
   *  builder detects that the agent's finer split also absorbs
   *  unmatched gold factors (e.g. agent's `treatment` split absorbs
   *  gold's separate `timepoint` factor → consequent listed here).
   *
   *  Empty list on findings outside an absorption pair. Today fires only on
   *  `direction='agent_finer'`; agent_coarser is symmetric
   *  follow-up agent-side. */
  consequents?: string[];
  /** Structured "what would Agree mutate" payload from the agent.
   *  Mirrors agents-side ``ApplyAction`` (see
   *  ``gemma_curation_agents/agents/audit/judges/*_judge.py``) so the
   *  UI can build a draft mutator without re-parsing rationale text.
   *
   *  Currently populated for ``missing_tag`` (kind=``add_tag``).
   *  Other proposer judges will follow. ``null`` / ``undefined`` on
   *  older audits and on calibration-only paths (which the legacy
   *  ``resolveCalibrationApply`` branch in ``applyHandlers.ts``
   *  already covers via target_id parsing). */
  apply_action?: ApplyActionPayload | null;
  /** Direct alignment classification from the graph-alignment
   *  Mapping (agents-side, shipped 2026-06-12). When present, the
   *  card renderer prefers this over walking the issue_code matcher
   *  — same verbs / glyphs / badges, more direct lookup. Paired with
   *  the legacy ``issue_code`` for back-compat on packages that
   *  pre-date the field. */
  alignment_kind?: AlignmentKind | null;
  /** Phase 1 of the three-phase finding-card render. The
   *  proposer's own reasoning for emitting this proposal — NEVER
   *  references gold or any other curation set; only the experiment's
   *  own data + curation rules. Additive on the wire while the
   *  agents-side migration completes; readers fall back to
   *  ``proposer_defense`` / ``supporting_evidence`` / ``citation``
   *  / ``citation_url`` when this block isn't populated. */
  why?: WhyBlock | null;
  /** Phase 2 of the three-phase finding-card render. Flat list of
   *  reviewer-LLM verdicts (defender, factor_defender, arbiter, boss)
   *  in pipeline order. Reviewers DO NOT compare to any external
   *  curation set — only guidelines + experiment data. Additive on
   *  the wire; readers fall back to ``defender_verdict`` +
   *  ``evidence.arbiter_verdicts`` + ``evidence.boss_verdicts``
   *  lookups when this list isn't populated. */
  reviews?: ReviewVerdict[];
  /** Phase 3 of the three-phase finding-card render. Optional —
   *  present only when an external curation set (polished gold, live
   *  Gemma, another ticket) was compared against. When absent, the
   *  card omits the Comparison section entirely (no "Auditor says
   *  (no entry)" placeholder). Carries the comparison-judge LLM's
   *  verdict + rationale and a label naming the comparator. */
  comparison?: ComparisonVerdict | null;
}

// ---------------------------------------------------------------------------
// Three-phase render blocks
//
// Additive on the wire while the agents-side migration completes; UI
// reads these blocks preferentially and falls back to the legacy
// ``proposer_defense`` / ``defender_verdict`` / ``arbiter_verdicts``
// fields when absent. Once UI consumes the new shape exclusively, the
// legacy fields get deprecated and dropped.
// ---------------------------------------------------------------------------

/** Phase 1: the proposer's own rationale + evidence + citation. */
export interface WhyBlock {
  /** One-sentence summary — the always-visible brief line. Falls
   *  back to first sentence of ``rationale`` when the producer
   *  doesn't populate it explicitly. */
  brief?: string;
  /** Full proposer rationale paragraph — surfaced on expand. */
  rationale: string;
  /** Optional evidence quotes — reveal when the curator expands the
   *  section. Same shape as ``AuditFinding.supporting_evidence``. */
  evidence?: FindingEvidence[];
  /** Curation-rule pointer (section anchor) shown as a chip. */
  citation?: string;
  citation_url?: string;
}

/** Phase 2: one reviewer-LLM verdict. Order in the list = order in
 *  the pipeline (defender first, boss last when present). */
export interface ReviewVerdict {
  /** Curator-facing reviewer name — "defender" / "factor_defender" /
   *  "arbiter" / "boss" / etc. UI renders verbatim; producer is
   *  responsible for picking a readable string. */
  reviewer: string;
  /** Verdict tag — curator-friendly label (producer-renamed per the
   *  vocabulary cleanup in the spec). String for forward-compat; UI
   *  doesn't enum-narrow. */
  verdict: string;
  /** One-sentence summary — the always-visible brief line for this
   *  reviewer's row. Falls back to first sentence of ``rationale``
   *  when absent. */
  brief?: string;
  /** Full reviewer rationale — shown on per-row expand. */
  rationale: string;
  /** Optional structured action this reviewer suggested (today: boss
   *  ``undo`` / ``rename`` / ``change_category`` / ``drop_fv``).
   *  Surface as expanded detail. Shape is producer-defined. */
  structured_action?: Record<string, unknown> | null;
}

/** Phase 3: the comparison judgement against an external curation
 *  set. Optional — when no comparator is in scope, this block is
 *  absent and the card omits the Comparison section. */
export interface ComparisonVerdict {
  /** Human label for the comparator — "polished gold" / "live Gemma"
   *  / "Curator A's curation" / etc. Drives the section header text. */
  comparator_label: string;
  /** Structured comparator payload — gold-side tag / FV / factor
   *  shape. Producer-defined; UI walks it via the existing
   *  FactorComparisonGrid / chip-strip primitives. */
  comparator_payload?: Record<string, unknown>;
  /** Judge verdict — "agent-better" / "gold-better" / "tie" /
   *  curator-friendly producer string. */
  judge_verdict: string;
  /** One-sentence summary — the always-visible brief line beside the
   *  judge verdict. */
  judge_brief?: string;
  /** One-sentence rationale from the comparison judge. */
  judge_rationale: string;
}

/** Structured agent-side "Agree mutates X" descriptor. Discriminated
 *  by ``kind`` so the UI can grow new shapes without unsafely casting.
 *  Mirror of agents-side Pydantic ``ApplyAction``. */
export type ApplyActionPayload =
  | {
      kind: "add_tag";
      /** Category label, free-text — Tag's ``category.label``. */
      new_category: string;
      /** Optional URI for the category when the agent grounded it
       *  (e.g. ``cell type`` → EFO_0000324). Lets the card render the
       *  category as a grounded ontology term even for a first-of-its-
       *  category tag with no sibling in the draft to borrow from. */
      new_category_uri?: string | null;
      /** Value label, free-text — Tag's ``value.label``. */
      new_value: string;
      /** Optional URI for the value when the agent grounded it.
       *  Falls back to ``proposer_term.uri`` at apply time. */
      new_value_uri?: string | null;
      /** Structured statements for a genuinely NEW statement-bearing
       *  tag (e.g. adding ``genotype: Dmd`` with ``Dmd · has_genotype
       *  · mdx``). Same ``StatementProposal`` wire shape FVs use. On
       *  accept the UI attaches these to the created tag so the design
       *  editor can show + edit them. Distinct from the reverted
       *  attempt to route EXISTING-tag statement mods through
       *  ``add_tag`` (those stay on ``replace_tag``): this is add-of-new
       *  only. See TAG_STATEMENT_ADD_TAG_APPLY_BUG_2026_07_13.md. */
      statements?: StatementProposal[] | null;
    }
  | {
      /** General "modify the target tag" (2026-07-13, tag near-match).
       *  Started life as a same-concept URI swap; now also the apply
       *  for ``calibration_tag_match_near`` — a proposed tag that
       *  matches an existing one but differs on category / value
       *  concept OR on its structured statements. On accept the UI
       *  overwrites whichever of these fields are present onto the
       *  matched design tag (replace-with-proposed, spec §7). */
      kind: "replace_tag";
      /** New category label — omit / null to keep the target tag's
       *  existing category (statement-only near-match). */
      new_category?: string | null;
      new_category_uri?: string | null;
      /** New value label — omit / null to keep the existing value. */
      new_value?: string | null;
      new_value_uri?: string | null;
      /** Proposed statements to overwrite onto the target tag. Carries
       *  the same ``StatementProposal`` wire shape FVs already use
       *  ({category?, subject, predicate?, object?}, each term
       *  {label, uri}). Absent on a plain concept/category swap;
       *  present when the near-match's statements moved (e.g. a bare
       *  ``genotype: Utrn`` gains ``Utrn · has_genotype · Heterozygous``). */
      statements?: StatementProposal[] | null;
    }
  | {
      /** Rebind a single factor value to the correct entity — the apply
       *  for ``calibration_factor_misbinding`` (2026-07-18). The agent
       *  bound the wrong gene / strain / cell-line on an
       *  otherwise-MATCHED factor; on Agree the UI relabels the FV
       *  identified by the finding's ``proposer_term`` (the wrong bind)
       *  to ``new_value`` and rebinds that FV's statement subject URI to
       *  ``new_value_uri`` (the correct bind). Present ONLY on a clean
       *  1↔1 swap; multi-bind disagreements ship flag-only (no
       *  ``apply_action``) for the curator to reconcile by hand. */
      kind: "rename_fv";
      /** The correct entity label to bind (e.g. ``Gja1``). */
      new_value: string;
      /** URI for the correct bind — rebound onto the FV's statement
       *  subject. Null when the agent couldn't ground it. */
      new_value_uri?: string | null;
    }
  | {
      /** Forward-compat placeholder so shapes we don't model yet
       *  type-narrow cleanly when they ship. */
      kind: string;
      [key: string]: unknown;
    };

/** One statement decomposed into (subject, predicate, object). Each
 *  part is an ``OntologyTerm`` (label + uri) or ``null`` when that
 *  role isn't populated — wild-type FVs typically have only a
 *  subject, for instance.
 *
 *  Carried on ``FvPair`` to give the UI's three-comparator editor
 *  matching parsed shape on both Agent and Gemma sides (without
 *  this, Gemma's column conflates everything into the FV-level
 *  label). Schema mirror of agents-side ``StatementParts`` shipped
 *  in commit ``b157073``. */
export interface StatementParts {
  subject?: OntologyTerm | null;
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
}

/** One FV-pair across a renamed factor (agent FV ↔ gold FV).
 *
 *  ``agent_statement`` / ``gold_statement`` carry the parsed
 *  (subject, predicate, object) decomposition of the primary
 *  statement on each side, when available. Optional / nullable for
 *  back-compat with rename payloads from older builders. When
 *  present, the UI prefers these for its three-comparator display;
 *  when absent it falls back to ``agent.label`` / ``gold.label``. */
export interface FvPair {
  agent: OntologyTerm;
  gold: OntologyTerm;
  /** How strong the pair is:
   *  - ``"exact"``    — same URI or string-identical label
   *  - ``"synonym"``  — different label, arbiter judged equivalent
   *  - ``"judgment"`` — same partition position, arbiter only ranked
   *                     by index (no semantic match) */
  equivalence: "exact" | "synonym" | "judgment" | (string & {});
  agent_statement?: StatementParts | null;
  gold_statement?: StatementParts | null;
  /** Per-side biomaterial short names — surfaced so the partition-
   *  mismatch / rename UI can render the per-FV sample count
   *  ``(n)`` badge on each side. Optional for back-compat with
   *  pre-2026-06-15 payloads. */
  agent_biomaterial_short_names?: string[] | null;
  gold_biomaterial_short_names?: string[] | null;
  /** Stable Gemma id of the paired gold ``FactorValue``. Lets the UI
   *  resolve the current/gold FV by an id join
   *  (``factor_value.id === gold_id``) instead of re-deriving the
   *  pairing from biomaterial-set overlap — the biomaterial fallback
   *  can't disambiguate when two gold FVs share (or reorder) samples.
   *  ``null`` / undefined on packages predating the id-hardening ship;
   *  the UI then falls back to biomaterial overlap. Wire field:
   *  ``goldId`` (camelCase). */
  gold_id?: number | null;
  /** Stable Gemma id of the paired agent ``FactorValue``. Usually
   *  ``null`` — agent FVs are proposed and carry no Gemma id — but
   *  present for completeness / symmetry with ``gold_id``. */
  agent_id?: number | null;
}

/** Compact factor reference inside a rename payload. */
export interface FactorRef {
  category: OntologyTerm;
  factor_type?: string;
  /** Stable Gemma ``ExperimentalFactor`` id for this side. Lets the
   *  UI resolve the factor by an id join when the finding's
   *  ``target_id`` is label-based (``factor:<slug>``) rather than a
   *  numeric ``factor:<id>``. ``null`` / undefined on packages
   *  predating the id-hardening ship (agent-side proposed factors also
   *  carry no id). Wire field: ``gemmaFactorId`` (camelCase). */
  gemma_factor_id?: number | null;
}

/** Sub-flavor of a partition-equal factor pair whose labels disagree.
 *  Drives the UI's affordance choice between an inline relabel editor
 *  (``label_drift``, ``synonym``) and a subject-correction editor
 *  (``wrong_subject``). ``unknown`` is the back-compat default on
 *  rename payloads that pre-date the builder routing change. */
export type ConceptDiffKind =
  | "none"           // concepts match (label-string drift only)
  | "label_drift"    // same concept; agent's label generic where gold's is specific
  | "synonym"        // different label, semantically equivalent concept
  | "wrong_subject"  // partition matches but agent named the wrong gene/treatment/…
  | "unknown";

/** Side-by-side diff for a factor classified as same-factor-different-
 *  label by the calibration arbiter. ``direction`` is load-bearing
 *  for the UI: ``"gold_correct"`` → curator keeps Gemma's label
 *  (severity ok), ``"agent_correct"`` → adopt agent's label (severity
 *  minor), ``"equivalent"`` → arbiter declines to pick (severity ok).
 *
 *  ``concept_diff_kind`` (added 2026-05-19) routes the curator's
 *  affordance — inline
 *  relabel vs subject-correction. Defaults to ``"unknown"`` on
 *  payloads from agents pre-dating the field; check explicitly before
 *  switching on it. */
export interface FactorRenamePayload {
  agent: FactorRef;
  gold: FactorRef;
  fv_pairs: FvPair[];
  direction: "gold_correct" | "agent_correct" | "equivalent" | (string & {});
  concept_diff_kind?: ConceptDiffKind;
}

/** Which side has the finer partition in a
 *  ``calibration_factor_partition_mismatch`` finding.
 *
 *  - ``"agent_finer"``    — agent split one gold factor along a hidden
 *                          axis (GSE28300: ``rotenone 3h`` /
 *                          ``rotenone 3d`` under one ``treatment``
 *                          factor where gold has ``treatment`` +
 *                          ``timepoint`` separately).
 *  - ``"agent_coarser"``  — agent collapsed two gold factors into one
 *                          with cross-product FVs (multi-factor-same-
 *                          category pattern).
 *  - ``"cross_cutting"``  — agent's factor partitions samples along an
 *                          axis that cross-cuts two or more gold
 *                          factors of the same category. Neither
 *                          finer nor coarser overall, though
 *                          individual agent FVs may fully overlap
 *                          individual gold FVs. ``fv_pairs`` is
 *                          intentionally empty in this direction —
 *                          the cross-factor mapping lives in
 *                          ``cross_cutting_golds`` +
 *                          ``cross_cutting_overlaps`` instead. Added
 *                          2026-05-21 (agents-side); UI mirror
 *                          followed 2026-06-14 after the reviewer flagged
 *                          GSE79061 cross-cutting cards rendering as
 *                          0-level fallthroughs.
 *
 *  Drives the editor's card title and the "adopt agent's split" vs
 *  "restore gold's separate factors" affordance choice. Mirrors
 *  agents-side ``PartitionMismatchDirection``. */
export type PartitionMismatchDirection =
  | "agent_finer"
  | "agent_coarser"
  | "cross_cutting";

/** One FV-level overlap row for a ``direction="cross_cutting"``
 *  partition_mismatch finding. Says: "agent's ``agent_fv``
 *  (n=n_agent samples) overlaps with gold factor ``gold_factor``'s
 *  FV ``gold_fv`` (n=n_gold) at Jaccard=``jaccard`` (n_overlap
 *  shared samples)." Emitted when ``jaccard >= 0.8`` (agents-side
 *  threshold). Mirror of ``CrossCuttingOverlapRow`` in
 *  ``gemma_curation_agents.agents.audit.schemas``. */
export interface CrossCuttingOverlapRow {
  agent_fv: OntologyTerm;
  gold_factor: FactorRef;
  gold_fv: OntologyTerm;
  jaccard: number;
  n_overlap: number;
  n_agent: number;
  n_gold: number;
  /** Stable Gemma id of the overlapping gold ``FactorValue``
   *  (``gold_fv``). Lets the UI resolve the gold FV by an id join
   *  rather than by label / biomaterial overlap. ``null`` / undefined
   *  on packages predating the id-hardening ship. */
  gold_fv_id?: number | null;
}

/** Structured payload for a ``calibration_factor_partition_mismatch``
 *  finding — single-card replacement for the legacy
 *  ``_factor_extra`` + ``_factor_gold_only_miss`` pair the builder
 *  emitted when a same-label factor match got demoted because
 *  partitions disagreed.
 *
 *  ``direction`` tells the UI which side is finer; the FV-level
 *  mapping (``fv_pairs``) carries the nesting:
 *
 *  - ``"agent_finer"``   — one row per agent FV; each row's ``gold``
 *                          is the parent gold FV that subsumes the
 *                          agent FV's samples (multiple agent rows
 *                          can share a gold).
 *  - ``"agent_coarser"`` — one row per gold FV; each row's ``agent``
 *                          is the parent agent FV that subsumes the
 *                          gold FV's samples (multiple gold rows can
 *                          share an agent).
 *  - ``"cross_cutting"`` — ``gold`` is the first (canonical)
 *                          overlapping gold factor; the full list of
 *                          gold factors the agent's factor spans is
 *                          in ``cross_cutting_golds``, and per-FV
 *                          overlap evidence lives in
 *                          ``cross_cutting_overlaps``. ``fv_pairs``
 *                          is empty by design — the cross-factor
 *                          shape doesn't fit the single-gold pair
 *                          model.
 *
 *  ``FvPair`` stays 1:1; the cross-product mapping for the finer /
 *  coarser cases is captured by repeated entries with shared parents
 *  on one side. The ``direction`` flag encodes which side's
 *  repetition is the parent. */
export interface PartitionMismatchPayload {
  agent: FactorRef;
  gold: FactorRef;
  direction: PartitionMismatchDirection;
  fv_pairs: FvPair[];
  /** Populated only when ``direction === "cross_cutting"``. Empty
   *  list on finer / coarser payloads. */
  cross_cutting_golds?: FactorRef[];
  /** Populated only when ``direction === "cross_cutting"``. Empty
   *  list on finer / coarser payloads. */
  cross_cutting_overlaps?: CrossCuttingOverlapRow[];
}

/** Judge's verdict on a single audit finding. ``side`` constrains
 *  the ``verdict`` enum (gold-only-miss findings only ever carry
 *  ``agent_*`` values; agent-extra findings only ever carry
 *  ``extra_*`` values). Folded into the proposer-suggestion panel:
 *  ``strength`` drives the header label, ``rationale`` the Judge
 *  one-liner. */
export interface AttachedDefenderVerdict {
  /** Producer label: legacy calibration-defender uses
   *  ``agent_extra`` / ``agent_missed_gold``; the 2026-05-22 unified
   *  justification swap (shared/justification.py) adds
   *  ``defender`` / ``arbiter`` / ``boss``. Forward-compat string
   *  fallback covers any future producer. */
  side:
    | "agent_extra"
    | "agent_missed_gold"
    | "defender"
    | "arbiter"
    | "boss"
    | (string & {});
  verdict:
    // Tag side (original six).
    | "agent_miss_genuine"
    | "agent_correct_inherited"
    | "agent_correct_overzealous_gold"
    | "extra_genuine_new"
    | "extra_inherited_redundant"
    | "extra_unsupported"
    // Factor side (2026-05-14).
    // `extra_genuine_new` + `extra_unsupported` are shared with the
    // tag enum.
    | "extra_confounded"
    | "extra_borderline"
    | "miss_genuine"
    | "miss_inherited_from_design"
    | "miss_overzealous_gold"
    | "miss_borderline"
    // Value-fold verdict (PPE, 2026-07-11): the agent is close but
    // captured a real value gold lacks (a dose, a duration, a
    // ``derives from`` / ``located in`` qualifier) worth folding onto
    // gold. Severity ``minor``; carries ``adopt_from_agent``. Drives
    // ``recommendation.action = "merge"``.
    | "merge"
    // Forward-compat: future producers (curator-triggered
    // "investigate further" / extra-review pass) will emit the same
    // shape with new verdict labels we don't enumerate here. UI keys
    // off ``strength`` rather than the verdict literal.
    | (string & {});
  /** Producer-side strength signal, calibration package v10+ (commit
   *  5b1f811). Three levels so future investigator verdicts that
   *  aren't open-and-shut have a natural slot. ``undefined`` on v9-
   *  and-older packages — UI falls back to ``verdictStrength()`` for
   *  the known six verdicts. */
  strength?: "weak" | "moderate" | "strong";
  /** One-paragraph explanation. Renders as the Judge one-liner at
   *  the bottom of the proposer panel. */
  rationale: string;
  /** Rule-section reference (e.g. ``"09_experiment_tags.md § Sample
   *  applicability"``). Rendered as a tooltip on the Judge line. */
  citation: string;
  /** Arbiter judgement mode, calibration package v11+ (defender-as-
   *  arbiter swap, 2026-05-16). Tells the
   *  curator *how* the verdict was reached:
   *
   *  - ``"rule"`` — verdict cites a specific guideline section
   *    (``citation`` is populated and load-bearing).
   *  - ``"judgment"`` — TMTOWTDI / equivalence call where guidelines
   *    leave room for interpretation; ``citation`` may be empty.
   *  - ``"meta"`` — verdict about the guidelines themselves
   *    (``guideline_omission``: prose missing for an implicit rule).
   *  - ``"escape"`` — arbiter declined to rule (``cannot_judge``).
   *
   *  ``undefined`` on packages predating the arbiter prompt swap. */
  mode?: "rule" | "judgment" | "meta" | "escape";
  /** Producer confidence in the verdict — ``high`` / ``medium`` /
   *  ``low``. Added by the unified justification shared/justification.py
   *  schema (2026-05-22). Omitted on older producers. */
  confidence?: string;
  /** The ONE concrete value / statement to fold onto gold for a
   *  ``merge`` verdict (never a label rename). Flows into
   *  ``recommendation.adopt_value``. Null on non-merge verdicts and on
   *  producers predating PPE (2026-07-11). */
  adopt_from_agent?: string | null;
}

/**
 * Graph-alignment Mapping + scoring shipped 2026-06-12 (agents side).
 *
 * The Mapping carries the structured alignment between two annotation
 * sets (today: agent proposal vs polished gold). Indices reference
 * the existing ``comparison_proposal.factors`` / ``.tags`` shapes —
 * no element-shape change, just a new way to index the pairing over
 * them. Findings continue to ship as before; ``alignment_kind`` on
 * the finding is the direct lookup the card renderer prefers over
 * walking the Mapping.
 *
 * UI posture is render-the-fields: when the wire carries
 * ``mapping`` / ``alignment_kind`` / ``scoring``, prefer them; when
 * absent (old packages), fall through to the existing chip-strip /
 * Jaccard / issue_code heuristics. Migration is additive.
 */
export type AlignmentKind =
  | "exact"
  | "near"
  | "partition_mismatch"
  | "extra"
  | "gold_only_miss";

export interface AlignmentFactorPairFeatures {
  score: number;
  category_label: number;
  fv_partition: number;
  uri_overlap: number;
  /** Present when the gray-band LLM judge fired. */
  llm_judge?: number;
}

/** One paired factor (a_idx into AnnotationSet A's ``factors[]``,
 *  b_idx into B's). ``kind`` constrains to the pair-shapes the
 *  alignment matcher emits — ``extra`` / ``gold_only_miss`` live on
 *  the unmatched lists below. */
export interface AlignmentFactorPair {
  a_idx: number;
  b_idx: number;
  /** Similarity score in [0, 1]. */
  score: number;
  kind: "exact" | "near" | "partition_mismatch";
  features: AlignmentFactorPairFeatures;
  /** Stable Gemma ``ExperimentalFactor`` id of the gold-side factor in
   *  this pair. Lets the UI resolve the gold factor by an id join
   *  rather than by the positional ``b_idx``. ``null`` / undefined on
   *  packages predating the id-hardening ship. */
  b_id?: number | null;
}

/** One paired FV inside a paired factor. ``factor_pair`` keys back to
 *  the owning ``AlignmentFactorPair`` (a_factor_idx, b_factor_idx).
 *  ``kind`` only ever ``"exact"`` / ``"near"`` — partition_mismatch
 *  lives at the factor level. */
export interface AlignmentFvPair {
  factor_pair: [number, number];
  a_fv_idx: number;
  b_fv_idx: number;
  score: number;
  kind: "exact" | "near";
  /** Stable Gemma id of the gold-side ``FactorValue`` in this pair.
   *  Lets the UI resolve the current/gold FV by an id join
   *  (``factor_value.id === b_fv_id``) rather than by the positional
   *  ``a_fv_idx`` / ``b_fv_idx`` into the factor's FV list — the id
   *  survives FV reordering. ``null`` / undefined on packages
   *  predating the id-hardening ship; the UI then falls back to the
   *  positional index. */
  b_fv_id?: number | null;
  /** Stable Gemma id of the agent-side ``FactorValue``. Usually
   *  ``null`` — agent FVs are proposed and carry no Gemma id. */
  a_fv_id?: number | null;
}

export interface AlignmentTagPairFeatures {
  category_match: number;
  value_match: number;
}

export interface AlignmentTagPair {
  a_idx: number;
  b_idx: number;
  score: number;
  kind: "exact" | "near";
  features: AlignmentTagPairFeatures;
}

/** Top-level alignment blob on ``AuditReport.evidence`` /
 *  ``audit_dict``. Indices reference the existing
 *  ``comparison_proposal.factors[i]`` / ``.tags[i]`` shapes. Self-
 *  describing thresholds let the UI render tooltip / disclosure copy
 *  without compiling them in. */
export interface AlignmentMapping {
  factor_pairs: AlignmentFactorPair[];
  fv_pairs: AlignmentFvPair[];
  tag_pairs: AlignmentTagPair[];
  unmatched_a_factors: number[];
  unmatched_b_factors: number[];
  unmatched_a_tags: number[];
  unmatched_b_tags: number[];
  factor_threshold: number;
  tag_threshold: number;
  exact_threshold: number;
  partition_match_threshold: number;
}

/** Per-GSE scoring rollup on ``AuditReport.evidence`` /
 *  ``audit_dict.scoring``. Batch-level rollup is sum(tp), sum(fp),
 *  sum(fn) across the GSEs in the package — one-liner consumer. */
export interface AlignmentScoring {
  factor_tp: number;
  factor_fp: number;
  factor_fn: number;
  tag_tp: number;
  tag_fp: number;
  tag_fn: number;
}

export interface AuditScope {
  include: AuditScopeItem[];
}

/** One row of the experiment-level boss-critic review feed. The
 *  boss-critic is a gold-blind LLM reviewer that runs against the
 *  agent's full emission — its commentary is experiment-scoped, not
 *  per-finding. v0.14.5 producer projects every boss-critic decision
 *  (every round, every target) into ``AuditEvidence.boss_critic_reviews``
 *  for the UI's top-of-panel render. */
export interface BossCriticReview {
  /** The entity the boss-critic commented on. ``"design"`` for
   *  whole-experiment calls; ``"factor:<cat>"`` for per-factor;
   *  ``"tag:<cat>|<val>"`` or numeric ``"tag:<id>"`` for tag;
   *  ``"fv:..."`` for FV-level. UI renders the target as a small
   *  scope chip next to each verdict. */
  target_id: string;
  /** Which boss-critic round emitted this call. 1 = initial review;
   *  ≥2 = re-evaluation after the proposer re-ran on feedback. When
   *  only round 1 exists for a blocker target, the proposer never
   *  got to address it — the UI flags the call as "unresolved" so
   *  the curator treats it as a debatable escalation. */
  round: number;
  /** ``ok`` / ``advisory`` / ``blocker`` / ``escalation``. */
  severity: string;
  /** Full prose verdict. */
  verdict: string;
  /** First sentence of the verdict, sentence-boundary truncated. */
  brief: string;
  /** Stable grouping key = ``(normalized target_id, issue_code)``.
   *  AGENT-PENDING (handoff BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03):
   *  when present, the UI groups the review feed on this key so the
   *  per-round collapse is a deterministic groupby instead of a
   *  target_id heuristic (a single target can legitimately carry two
   *  distinct issues). Absent on every package to date — the UI falls
   *  back to ``target_id`` as the group key. */
  finding_key?: string | null;
  /** AGENT-PENDING: the latest round's verdict for a ``finding_key`` is
   *  the OUTCOME the curator acts on; earlier rounds are the agent's
   *  reasoning. When present, the UI shows the ``is_final`` verdict and
   *  tucks the round history behind an expander. Absent → the UI treats
   *  the highest-``round`` review in the group as final. */
  is_final?: boolean | null;
  /** AGENT-PENDING: on a superseded (non-final) round, points at the
   *  ``finding_key`` of the verdict that replaced it. Informational —
   *  the UI already reconstructs the progression from the grouped
   *  ``round`` order. */
  superseded_by?: string | null;
}

export interface AuditEvidence {
  preboarding_excerpt: string;
  paper_source: string | null;
  paper_excerpt: string;
  /** Silent comparison proposer run that anchors judge findings.
   *  Nullable: future scope choices (e.g. tags-only audits) may skip
   *  the proposer entirely. When ``null``, every finding's
   *  ``proposer_suggestion`` will also be empty. */
  comparison_proposal: Proposal | null;
  /** Per-factor design debate transcripts loaded from
   *  ``data/<gse>/design_debate_transcripts.json``. Absent when the
   *  run didn't use ``--debate-design`` or the sidecar file is missing.
   *  Factors not in this list were silently approved. */
  design_debate_transcripts?: DesignDebateEntry[];
  /** Structured graph-alignment Mapping between the two annotation
   *  sets compared in this audit (today: agent proposal vs polished
   *  gold). When present, the UI prefers ``mapping.factor_pairs[i]``
   *  / ``mapping.fv_pairs[i]`` for pair derivation over the legacy
   *  chip-strip Jaccard heuristics. Indices reference the existing
   *  ``comparison_proposal.factors[i]`` / ``.tags[i]`` shapes —
   *  the wire ships the alignment over them, not new element shapes.
   *  ``null`` / ``undefined`` on packages predating the 2026-06-12
   *  ship; UI falls through to the legacy fallback. */
  mapping?: AlignmentMapping | null;
  /** Per-GSE scoring rollup — factor + tag tp / fp / fn. Rendered as
   *  a small summary pill in the audit-sidebar header next to the
   *  verdict. Batch-level rollup across multiple GSEs is sum(tp) /
   *  sum(fp) / sum(fn). ``null`` / ``undefined`` on older packages. */
  scoring?: AlignmentScoring | null;
  /** Curator-facing prose paragraph from the orchestrator — what
   *  the agent observed, any intervention it ran, what the final
   *  design + tags look like. Renders as orientation prose at the
   *  top of the audit / proposal panel via ``OrientationProse``
   *  (``components/ui/OrientationProse.tsx``). Slot is render-the-
   *  string; no domain coupling. Empty / null / undefined on
   *  packages predating the orchestrator v5 wire and on
   *  tags-only audits — the renderer suppresses entirely in that
   *  case. */
  experiment_summary?: string | null;
  /** Inline boss-critic reviews — gold-blind LLM commentary scoped
   *  to the EXPERIMENT (the boss-critic operates on the agent's
   *  whole emission, not on any single finding). Rendered as a top-
   *  of-panel ``BossReviewPanel`` adjacent to ``OrientationProse``.
   *  Replaces the v0.14.2–.4 per-finding fan-out: duplicating the
   *  same paragraph across N cards read as noise. Per design review
   *  2026-06-16 (ticket-60 walkthrough). Empty / null / undefined
   *  on packages predating v0.14.5; renderer suppresses. */
  boss_critic_reviews?: BossCriticReview[] | null;
  /** v5 supervisor's audit-trail prose — narrative of what the
   *  orchestrator observed, intervened on, deferred. ≥150 chars
   *  when populated. Empty / null on legacy packages. Rendered as
   *  a collapsible "Pipeline audit trail" section at the bottom
   *  of the findings list.
   *
   *  Dual-state: canonical source is
   *  ``comparison_proposal.experiment_notes`` (see ``Proposal``
   *  in ``api/types.ts``); this field is the back-compat mirror
   *  per agents-side commit ``5d6e069``. UIB readers should
   *  prefer the proposal-side field and fall through to this one
   *  via the recommended adapter. */
  experiment_notes?: string | null;
  /** v5 curator-follow-up requests — the agent flagging things
   *  it couldn't proceed without (paper fetch, ontology fix,
   *  strain resolver gap, …). Each ``EscalationRequest`` carries
   *  a ``blocks_correction`` flag; ``true`` entries render as
   *  loud red chips in the top-of-panel banner because they're
   *  hard blockers, ``false`` entries render amber. Suppressed
   *  entirely when empty. Same dual-state rule as
   *  ``experiment_notes`` — canonical on Proposal. */
  escalation_requests?: EscalationRequest[];
  /** v5 supervisor's headline assessment (1-2 line summary of the
   *  whole run). Optional dual-state mirror; canonical on
   *  Proposal. Today's render targets are not yet defined — the
   *  field rides for forward-compat. */
  overall_assessment?: string | null;
  /** Schema-discriminator stamped by the agent build process,
   *  format ``agents@<short-sha>/<schema-tag>``. Lets the UI
   *  skip / quarantine payloads whose shape it doesn't
   *  understand. Mirrored on ``comparison_proposal.agent_version``
   *  (canonical) and ``AuditReport.agent_version`` (top-level). */
  agent_version?: string | null;
  /** Every arbiter row that ran on this audit, full rationale.
   *  Targeting key is ``(target_kind, side, target_category,
   *  target_value)``; ``target_value`` is empty for factor-level
   *  rows. UIB looks up the matching arbiter row per finding to
   *  render the per-finding judge-chain (defender → arbiter →
   *  boss). Empty on packages predating commit ``c784824`` and
   *  on legacy runs that didn't ship an arbiter pass. */
  arbiter_verdicts?: ArbiterVerdict[];
  /** Every boss row that re-adjudicated an arbiter call. Same
   *  targeting-key shape as ``arbiter_verdicts``. Each row carries
   *  ``arbiter_rationale`` as a pass-through so the curator can
   *  read the boss's view of the prior call without cross-
   *  indexing. Empty on packages that didn't run a boss pass.
   *
   *  Named ``BossPassVerdict`` (not ``BossVerdict``) to
   *  disambiguate from the existing proposal-wide
   *  ``BossVerdict`` in ``./justification.ts``, which is a
   *  different concept (overall conclusion on a proposal vs.
   *  per-row arbitration here). */
  boss_verdicts?: BossPassVerdict[];
}

/** One arbiter row from the calibration-batch judge pass.
 *  Targeting key matches the per-finding lookup used by
 *  ``ComparisonFactorCard``'s judge-chain renderer. Field names
 *  mirror agents-side ``ArbiterVerdict`` (snake_case after the
 *  wire-boundary transform). */
export interface ArbiterVerdict {
  gse: string;
  target_kind: string;
  side: string;
  target_category: string;
  /** Empty for factor-level rows (factor-level verdicts target
   *  the factor category, not a specific FV). */
  target_value: string;
  target_uri: string;
  verdict: string;
  mode: string;
  citation: string;
  /** Curator-visible explanation; 215-300 chars typical. */
  rationale: string;
  confidence: string;
}

/** One boss row that re-adjudicated an arbiter call. ``rationale``
 *  carries the boss's own ruling; ``arbiter_rationale`` carries
 *  the prior arbiter call so the curator can read the chain
 *  without cross-indexing.
 *
 *  Named ``BossPassVerdict`` (not ``BossVerdict``) to avoid
 *  colliding with the existing ``BossVerdict`` in
 *  ``./justification.ts`` which describes a proposal-wide
 *  conclusion (split / collapse / rebalance recommendations) —
 *  different scope, different fields. */
export interface BossPassVerdict {
  gse: string;
  target_kind: string;
  side: string;
  target_category: string;
  target_value: string;
  target_uri: string;
  verdict: string;
  mode: string;
  citation: string;
  arbiter_rationale: string;
  rationale: string;
  confidence: string;
}

/** v5 curator-follow-up request. ``kind`` discriminates the
 *  category of follow-up; ``blocks_correction: true`` signals
 *  the agent can't proceed without this input (render in red).
 *  ``aggregation_key`` lets the UI bucket similar escalations
 *  across runs. */
export interface EscalationRequest {
  kind: string;
  rationale: string;
  suggested_action: string;
  blocks_correction: boolean;
  aggregation_key: string;
}

export interface AuditSummary {
  n_blocker: number;
  n_major: number;
  n_minor: number;
  n_ok: number;
  overall_verdict: OverallVerdict;
}

/** Structured `applied_fix` payload — per-element curator verdicts +
 *  edits, replacing the legacy free-text string form. Schema mirrors
 *  the agents-side Pydantic ``AppliedFix`` (agents repo
 *  ``feature/audit-schema-extensions`` commit ``e9e52ea``).
 *
 *  The wire field ``applied_fix`` on both ``AuditFindingDisposition``
 *  and ``AuditFindingDispositionPatch`` is a union: ``AppliedFix |
 *  string``. Legacy unstructured notes still round-trip as plain
 *  strings; new dispositions emit the structured form. */
export type AppliedFixKind = "details_edit" | "structural" | "free_text";

/** Path-keyed convention for the ``path`` field on an ``AppliedEdit``:
 *
 *  - ``"factor.category"``                       (label + uri)
 *  - ``"fv[<i>].statements[<j>].subject"``       (label + uri)
 *  - ``"fv[<i>].statements[<j>].predicate"``
 *  - ``"fv[<i>].statements[<j>].object"``
 *  - ``"tag.category"`` / ``"tag.value"``        (label + uri)
 *
 *  No strict path-grammar validator server-side — apply-handler and
 *  scorer navigate at use time. New path kinds can be added without
 *  bumping the schema. */
export interface AppliedEdit {
  path: string;
  /** Curator's verdict on this specific row. ``null`` when untouched. */
  ok?: boolean | null;
  /** Curator's corrected value, when typed. ``null`` when the row was
   *  flagged ✗ without a fix in mind. */
  to_label?: string | null;
  to_uri?: string | null;
  /** Audit trail: what the agent originally proposed for this row.
   *  Optional — the server can backfill from the finding. */
  from_label?: string;
  from_uri?: string | null;
  /** Optional free-text per-row note. */
  note?: string | null;
}

export interface AppliedFix {
  kind: AppliedFixKind;
  /** Free-text fallback for ``"structural"`` kind (rationale for the
   *  dismiss) and curator-typed notes that don't fit the structured
   *  shape (``"free_text"``). */
  note?: string | null;
  /** Per-row verdicts + edits. Non-empty only for
   *  ``kind === "details_edit"``. */
  edits?: AppliedEdit[];
}

/** Where a finding sits in the curator's triage. The audit pipeline
 *  always emits findings as ``pending``; the disposition table tracks
 *  the curator's verdicts. The UI sources from `AuditFinding`s on
 *  the report PLUS the parallel `dispositions` list. */
export type DispositionStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "needs_more_info";

/** One curator verdict on one finding, identified by `target_id`.
 *  The mock API stores an append-only log of these and serves the
 *  latest row per `target_id` on the read path — so any
 *  `AuditReport.dispositions` entry is the curator's most recent
 *  call on that finding. */
export interface AuditFindingDisposition {
  target_id: string;
  status: DispositionStatus;
  reviewer: string;
  /** ISO 8601 UTC; null on the initial pending state. */
  reviewed_at: string | null;
  notes: string;
  /** When this disposition was cascaded from a parent factor finding,
   *  carries the parent's `target_id`. Null/absent for direct
   *  dispositions. Used by the dispositions report to weight cascaded
   *  vs direct curator calls differently. */
  inherited_from?: string | null;
  /** ISO 8601 UTC of "I actually addressed this in the data" — see
   *  `AUDIT_DISPOSITIONS.md` Ask #6. Only valid alongside
   *  status=accepted. Two states under accepted:
   *    - parked  → status=accepted AND resolved_at == null
   *    - resolved → status=accepted AND resolved_at != null
   *  The UI distinguishes them so a high parked-rate on a given
   *  issue_code reads as "curators agree but didn't act" (weaker
   *  validation signal) vs "clean win". Optional / nullable for
   *  backwards compat with older mocks. */
  resolved_at?: string | null;
  /** Structured-reason fields echoed back on read so the edit
   *  dialog can prefill the curator's chip selection. Set only when
   *  the disposition's status matches (dismiss → dismissed, etc.);
   *  null/absent on older agent services that pre-date the round-
   *  trip ask (2026-05-14). */
  dismiss_reason?: DismissReason | null;
  accept_reason?: AcceptReason | null;
  not_sure_reason?: NotSureReason | null;
  /** Curator's "what got applied" record. Union of structured
   *  ``AppliedFix`` (per-row verdicts + edits) and legacy free-text
   *  string. Server stores both forms; reads disambiguate by
   *  JSON-parseability. */
  applied_fix?: AppliedFix | string | null;
  /** Two orthogonal verdict axes added 2026-05-19. ``status``
   *  stays the curator's headline verdict; these booleans carry the
   *  structural-vs-detail refinement the scorer needs to split
   *  structural F1 from detail F1.
   *
   *  Conventional mappings (wire allows any combination):
   *    - structure_ok=true,  details_ok=true   → status=accepted
   *    - structure_ok=true,  details_ok=false  → status=accepted
   *        (proposal applies; ``applied_fix`` carries the curator's
   *        inline label edits — kind=details_edit)
   *    - structure_ok=false                    → status=dismissed
   *
   *  On a fresh disposition the UI infers defaults from
   *  ``issue_code`` rather than sending a pre-populated PATCH:
   *    - ``*_match_exact`` / ``*_match_near`` /
   *      ``calibration_factor_rename`` → ``structure_ok=true``
   *      (matcher already pre-confirmed partition equality);
   *      ``details_ok`` null until acted on
   *    - ``*_extra`` / ``*_gold_only_miss`` → both null
   *  First curator action sends both explicitly.
   *
   *  Legacy reviews (pre-2026-05-19) carry null on both. The scorer
   *  falls back to ``status`` when both are null:
   *    - status=accepted   → infer ✅ structure, null details
   *    - status=dismissed  → infer ✗ structure, null details */
  structure_ok?: boolean | null;
  details_ok?: boolean | null;
}

/** Closed enum of structured "why this is a dismiss" reasons.
 *  Mirrors the agent-side ``DismissReason`` enum (revised
 *  2026-05-10). Required
 *  by the server when ``status === "dismissed"``; null/absent
 *  otherwise. Free-text ``notes`` stays alongside (mandatory when
 *  reason is "other"). The closed enum lets the agents side cluster
 *  dismissals for prompt-quality analysis without parsing arbitrary
 *  curator prose.
 *
 *  Old values ``auditor_wrong`` / ``curator_wrong`` were dropped —
 *  they described *whose fault* rather than *what was wrong*. The
 *  ``string`` opening keeps legacy dispositions that still carry
 *  those values render-clean. */
export type DismissReason =
  | "redundant"
  | "out_of_scope"
  | "weak_evidence"
  | "accepted_elsewhere"
  | "wont_fix"
  | "other"
  // Calibration-specific reasons promoted to canonical 2026-05-13
  // (agents-side enum extension; see schemas.py:444-448). Chip keys
  // map straight through to the structured field — no client-side
  // squash anymore.
  | "missed_evidence"
  | "no_evidence"
  | "borderline"
  // Cross-curator chip-gap closures landed 2026-05-14 (agents side).
  // Per-issue-code gating on the server side:
  //   agent_real_miss          → calibration_{gold_only_miss,
  //                              factor_gold_only_miss}
  //   redundant_with_bm_source → calibration_agent_extra (tag-side)
  //   not_sample_applicable    → calibration_agent_extra (tag-side)
  | "agent_real_miss"
  | "redundant_with_bm_source"
  | "not_sample_applicable"
  // Match-family Keep sub-verdicts — Design review 2026-06-16. On a near-/
  // match-family card the curator's "Keep" decision is too coarse;
  // we split it into three so the eval scorer can credit
  // ``keep_agent_equivalent`` as a TP and so ``keep_agent_close``
  // (paired with a ``notes`` payload) becomes a training signal for
  // the proposer / chain refinement loop. The legacy ``wont_fix``
  // value covers the "agent was materially off" case.
  | "keep_agent_equivalent"
  | "keep_agent_close"
  | (string & {});

/** Issue-code shapes that gate the server's ``accept_reason``
 *  requirement. Mirror of agents-side
 *  ``_AGENT_EXTRA_ISSUE_CODE_PREFIXES`` in
 *  ``gemma_curation_agents/agents/audit/schemas.py`` — both
 *  families count as "agent emitted something gold doesn't have"
 *  so accepts must record a why. */
const AGENT_EXTRA_ISSUE_PREFIXES = [
  "calibration_agent_extra",
  "agent_extra_",
] as const;

/** ``true`` iff accepting this issue_code requires an
 *  ``accept_reason`` on the PATCH body. UI callers default to a
 *  sensible chip key (typically ``well_evidenced``) when running
 *  bulk paths that don't go through the per-card chip dialog. */
export function isAgentExtraIssue(issueCode: string | null | undefined): boolean {
  if (!issueCode) return false;
  return AGENT_EXTRA_ISSUE_PREFIXES.some((p) => issueCode.startsWith(p));
}

/** Closed enum of structured "why I accepted this" reasons. Required
 *  by the server when ``status === "accepted"`` AND the finding is
 *  in the agent-extra family (``calibration_agent_extra``, future
 *  ``agent_extra_*`` codes); other accept paths skip the field. */
export type AcceptReason =
  | "well_evidenced"
  | "fills_gap"
  | "more_specific"
  | "other"
  // Calibration-specific reasons promoted to canonical 2026-05-13
  // (agents-side enum extension). Chip keys map straight through
  // to the structured field — no client-side squash anymore.
  | "gold_was_wrong"
  | "borderline"
  | (string & {});

/** Closed enum of structured "why I'm parking this" reasons.
 *  Required by the server when ``status === "needs_more_info"``.
 *  The "Park" button on the audit sidebar gates on the dialog so
 *  the UI never sends the status without a reason. */
export type NotSureReason =
  | "need_more_data"
  | "need_expert"
  | "pending_update"
  | "other"
  | (string & {});

/** PATCH body for `PATCH /rest/v2/audits/{audit_id}`. One disposition
 *  update per request — bulk dispositioning isn't supported on this
 *  endpoint by design.
 *
 *  Optional fields per `AUDIT_DISPOSITIONS.md`:
 *   - `dismiss_reason`: required when status=dismissed (server side
 *     will validate; safe to send always when set).
 *   - `applied_fix`: when the curator accepted **and** edited the
 *     suggested_fix text before applying, the final text.
 *   - `first_seen_at`: client-side timestamp of the first time this
 *     finding rendered to the curator. Sent only on the first PATCH
 *     for the finding so triage time analytics can subtract from
 *     `reviewed_at`. */
export interface AuditFindingDispositionPatch {
  target_id: string;
  status: DispositionStatus;
  reviewer: string;
  notes?: string;
  /** The finding's ``issue_code``, looked up from the report by
   *  ``target_id`` and echoed in the patch body so the server-side
   *  validator can gate reason chips by code (e.g. ``agent_real_miss``
   *  only valid on ``calibration_{gold_only_miss,
   *  factor_gold_only_miss}``). Required by the agent-side validator
   *  as of the 2026-05-16 chip-gap closure pass. Always populated by
   *  ``setDisposition`` from the live report. */
  issue_code?: string;
  dismiss_reason?: DismissReason;
  /** Required when ``status === "accepted"`` and the finding's
   *  ``issue_code`` is in the agent-extra family — captures the
   *  curator's "why I'm adding this" so the agents side can cluster
   *  accept signal symmetrically with dismiss signal. */
  accept_reason?: AcceptReason | null;
  /** Required when ``status === "needs_more_info"``. Parking is now
   *  a decided disposition (counts as closed in the UI), so the
   *  agents side needs to know what kind of follow-up is missing. */
  not_sure_reason?: NotSureReason | null;
  /** Curator's "what got applied" record. Union: structured
   *  ``AppliedFix`` (per-row verdicts + edits, shipped 2026-05-19
   *  per ``e9e52ea``) or legacy free-text string (pre-2026-05-19
   *  dispositions). Server accepts both forms; reads
   *  disambiguate by JSON-parseability. */
  applied_fix?: AppliedFix | string;
  first_seen_at?: string;
  /** Two-step accept marker — see `AUDIT_DISPOSITIONS.md` Ask #6.
   *  Server validator: `resolved_at` is only valid alongside
   *  status=accepted; any other status returns 422. Send when:
   *    - the curator clicks "Mark resolved" on an accepted finding
   *    - an Apply&Focus action with a real mutation runs (the
   *      curator just took the structural action, so accept is
   *      implicitly resolved)
   *  Omit on the bare "Accept" click — that's the parked state. */
  resolved_at?: string;
  /** When cascading a factor disposition to its subsumed FV children,
   *  set to the parent finding's `target_id`. Omit for direct curator
   *  dispositions. Lets the dispositions report weight cascaded
   *  dispositions differently from direct ones. */
  inherited_from?: string;
  /** Structural-vs-detail axes (2026-05-19).
   *  Independent of ``status``. A PATCH can set one and leave the
   *  other null; a follow-up PATCH fills the other. See
   *  ``AuditFindingDisposition`` for the full semantics + convention. */
  structure_ok?: boolean | null;
  details_ok?: boolean | null;
}

/** Discriminator for the shared CurationReview record. ``audit`` =
 *  agent reviewed existing curation (finding shape: "agent says X,
 *  curator has Y"). ``proposal`` = agent proposed curation from
 *  scratch on a preboarded / uncurated GSE (finding shape: "agent
 *  proposes X"; no curator side to compare against). The two kinds
 *  share the wire schema and the per-finding disposition machinery;
 *  only the framing differs. */
export type CurationReviewKind = "audit" | "proposal";

/** Self-documenting record of the pipeline run that produced a
 *  proposal-kind ``AuditReport``. Baked into the proposal payload at
 *  build time (agents-side ``build_calibration_batch._load_run_provenance``
 *  → ``RunProvenance`` schema) so a curator can see exactly what
 *  produced a proposal — models, switches, git, the full invocation —
 *  without hunting through sidecar files.
 *
 *  Every field optional: proposals predating the feature carry no
 *  ``run_provenance`` at all, and the "Proposer details" popup degrades
 *  gracefully to nothing when it's absent. The flat fields power the
 *  short comparison-chip label; ``run_meta`` is the full pass-through of
 *  the run's ``run_meta.json`` (proposer/design/arbiter models, every
 *  switch, the ``ablations`` dict, the ``git_provenance`` block, the CLI
 *  ``invocation``) that the popup renders. */
/** Per-GSE paper-fetch status for one proposal. Lets a curator tell a
 *  genuine "this dataset has no findable publication" apart from a fetch
 *  that FAILED (rate limit / server error) — the 2026-06-30 batch shipped
 *  0/29 papers because a keyless-NCBI 429 was swallowed as "no paper".
 *  Snake_case after the client's ``snakeify`` (agents-side Pydantic uses
 *  ``alias_generator=to_camel``). Every field optional: absent on
 *  proposals predating the feature. */
export interface PaperAvailability {
  /** Did we resolve a publication at all (Gemma-linked or pub_finder)? */
  paper_available?: boolean;
  /** How it was found: "gemma_linked" | a pub_finder strategy
   *  (geo_linked / accession_search / author_title_search /
   *  organism_keyword_search / europepmc_preprint_search / lab_browse) |
   *  "none" | "". */
  source?: string;
  strategy?: string;
  pmid?: string;
  /** Did the proposer get PMC FULL TEXT (vs abstract-only / nothing)? */
  full_text_available?: boolean;
  supplements_available?: boolean;
  supplements_status?: string;
  /** found | no_paper | rate_limited | error:<reason>. */
  fetch_status?: string;
}

export interface RunProvenance {
  run_id?: string;
  run_sha?: string;
  ran_at?: string;
  model?: string;
  /** Agent BUILD identity (``v1.1-87-g5344f2e`` = tag + commits + sha,
   *  from ``git describe``) — distinct from ``model`` (the LLM a stage
   *  called). The provenance badge names the agent by this; ``model``
   *  demotes to the tooltip. Blank on rows built before the agent
   *  stamped it. Source: agents ``shared/agent_identity.py``. */
  agent_identity?: string | null;
  batch_id?: string;
  git_describe?: string;
  git_dirty?: boolean;
  /** Whole ``run_meta.json`` — opaque pass-through so a new run field
   *  surfaces automatically instead of being dropped. Snake_case keys
   *  regardless of the envelope's casing. */
  run_meta?: Record<string, unknown> | null;
  /** Per-GSE paper-fetch status (added 2026-06-30). Unlike the flat
   *  fields + ``run_meta`` (batch-level, identical across a run) this is
   *  proposal-specific. Absent on older proposals; the "Proposer details"
   *  popup renders a "Paper" section only when present. */
  paper_availability?: PaperAvailability | null;
}

export interface AuditReport {
  /** Server-assigned. Null on a freshly-built report that hasn't been
   *  persisted yet (e.g. mid-stream). */
  audit_id: string | null;
  experiment_id: number | string;
  experiment_short_name: string;
  /** Discriminator. Optional/back-compat: payloads from agents
   *  predating the split don't carry it — treat absent as ``"audit"``.
   *  Backend defaults to ``"audit"`` on insert when unset. */
  kind?: CurationReviewKind;
  /** ISO 8601 UTC. */
  audited_at: string;
  model: string | null;
  scope: AuditScope;
  findings: AuditFinding[];
  evidence: AuditEvidence;
  summary: AuditSummary;
  /** Schema-discriminator stamped by the agent build process,
   *  format ``agents@<short-sha>/<schema-tag>``. Lets the UI
   *  skip / quarantine payloads whose shape it doesn't
   *  understand. Mirrored on
   *  ``evidence.comparison_proposal.agent_version`` and
   *  ``evidence.agent_version``; this top-level slot is the
   *  primary reading point for the discriminator. */
  agent_version?: string | null;
  /** Full run provenance for proposal-kind reports — models, switches,
   *  git sha/branch, ablations, and the CLI invocation that produced
   *  this proposal. Baked into the proposal JSON at build time.
   *  Optional/nullable: absent on older rows + on audit-kind reports;
   *  the "Proposer details" popup renders nothing when it's missing. */
  run_provenance?: RunProvenance | null;
  /** Latest curator disposition per finding (keyed by `target_id`).
   *  Empty on a freshly-produced report; populated by the read
   *  endpoints after PATCH calls. */
  dispositions: AuditFindingDisposition[];
  /** ISO 8601 UTC of the curator's "I'm done triaging this" press —
   *  see `AUDIT_DISPOSITIONS.md` Ask #1. Null on still-open audits;
   *  optional/undefined when an older mock that pre-dates the
   *  finalize endpoint is in front of the UI. PATCH against an
   *  audit with `finalized_at != null` returns 409 — the UI
   *  disables disposition controls when this is set. */
  finalized_at?: string | null;
  /** Reviewer username who finalized. Pairs with `finalized_at`;
   *  same nullable / optional rules. */
  finalized_by?: string | null;
  /** Curator's optional free-text note attached to the finalize
   *  click — "I'm closing this because X". Surfaced post-close in
   *  the audit header strip and pre-filled into the close textarea
   *  when the curator reopens to re-close with edits.
   *
   *  Optional/nullable on the read shape: old agent services
   *  routed the note into the audit_events row without echoing it
   *  back on `AuditReport`. The agents side adds the echo in a
   *  follow-up. UI degrades to "(no note recorded)" when undefined. */
  finalized_notes?: string | null;
  /** Mutations the finalize-time backend safety net
   *  (``local_api.finalize_materialize``) applied to the curator's
   *  polished design because the UI dropped the accepted finding's
   *  ``apply_action`` (ordering / reload race). Present on the finalize
   *  RESPONSE only — transient, never persisted on the stored body, so
   *  every read outside the finalize round-trip sees it empty. Only
   *  genuinely-caught drops (``applied`` net actions) are surfaced; the
   *  idempotent / skipped log stays server-side. The UI toasts "backend
   *  recovered N dropped accept(s)" from it so the catch is
   *  curator-visible, not just a server log. Mirrors the agent-side
   *  ``MaterializedActionVO``. */
  materialized?: MaterializedAction[];
}

/** One mutation the finalize-time backend safety net re-materialized
 *  onto the curator's polished design (see ``AuditReport.materialized``).
 *  Mirrors the agent-side ``MaterializedActionVO``. */
export interface MaterializedAction {
  /** ``apply_action`` kind: ``add_tag`` / ``remove_tag`` /
   *  ``replace_tag`` / ``rename_fv`` / ``add_factor`` /
   *  ``remove_factor``. */
  kind: string;
  /** The finding's ``target_id`` the mutation landed against. */
  target_id: string;
  /** Human-readable summary of what landed (e.g. "disease: HAND"). */
  detail?: string;
  /** Which finalize-time fold caught this action:
   *  ``"reviewer"`` = a genuine UI persistence DROP recovered onto the
   *  reviewer's polished design (the rare canary — the UI failed to
   *  save an accepted change; worth a warn).
   *  ``"gold"`` = routine accepted→gold propagation (the UI never writes
   *  ``/polished/gold``, so on every reconcile finalize the fold records
   *  every accepted decision to gold — expected, not a bug).
   *
   *  Optional: the store stamps it once the gold fold ships with the
   *  tag. Absent ⇒ the legacy reviewer-only shape (a genuine drop), so
   *  the UI treats untagged actions as ``"reviewer"``. See
   *  ``UIB_REPLY_2026_07_21_MATERIALIZE_TO_GOLD_TOAST_SOURCE.md``. */
  source?: "reviewer" | "gold";
}

/** One round in a challenger/defender/arbiter debate loop. Shared
 *  by both EE-tag debates (``debate_transcripts.jsonl``) and design
 *  debates (``design_debate_transcripts.json``). */
export interface DebateRound {
  challenge_citation: string;
  challenge_reason: string;
  defense_concedes: boolean;
  defense_response: string;
  /** ``"defense"`` | ``"challenge"`` | ``"uncertain"`` */
  verdict_side: string;
  verdict_reason: string;
}

/** One factor entry in ``design_debate_transcripts.json``. Factors
 *  that were silently approved (no challenge) are omitted from the
 *  file — absent entry means the factor passed without objection. */
export interface DesignDebateEntry {
  gse: string;
  factor_category: string;
  factor_category_uri: string;
  /** Same badge vocabulary as EE-tag debates: ``"gold"`` / ``"silver"``
   *  / ``"bronze"`` / ``"dropped"`` / ``"stuck"``. */
  badge: string;
  rounds: DebateRound[];
}

/** Body of POST /audit/{accession} and its /stream variant. All
 *  fields optional; the agent service applies defaults. Note:
 *  `scope` here is a flat array — the *report's* `AuditScope`
 *  wraps it as `{ include: [...] }`, but the request shape doesn't. */
export interface AuditRequest {
  tier?: "fast" | "standard" | "strong";
  /** Wins over `tier` when present. */
  model?: string;
  /** Subset to audit. Omit to audit everything; pass `[]` and the
   *  server returns 400 (likely a UI bug — checkboxes all off). */
  scope?: AuditScopeItem[];
  /** Run the silent comparison proposer alongside the judges so
   *  `proposer_suggestion` populates on findings. Default true.
   *  Set false for a cheap-pass audit (deterministic checks only). */
  with_comparison?: boolean;
  /** Default true. Mirrors the proposer's cache flag. */
  use_cache?: boolean;
  /** Default false. When true, ignores any cached proposer output
   *  and forces a fresh judge pass. */
  refresh_cache?: boolean;
  /** Curator's free-text override from the redo-with-notes flow.
   *  Threaded into the audit judges' prompt as a feedback block.
   *  Mirrors `TriggerProposalBody.prior_feedback`. Landed
   *  agents-side 2026-05-23 (gemma-curation-agents `b3392d2` /
   *  `bd6112e`). */
  prior_feedback?: string | null;
}
