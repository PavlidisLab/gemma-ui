/**
 * ComparisonFactorCard — modular, compact, side-by-side factor display
 * for calibration findings. Replaces FindingDetailsEditor's per-element
 * editor for findings whose primary curator question is "what's the
 * difference between Polished Gemma's curation and the agent's proposal?".
 *
 * The goal is ONE factor display that works across (rename / extra / miss /
 * match) variants and across comparator sources (Polished Gemma / curator /
 * agent / preboard / none). v1 of this file handles rename specifically
 * with the structure generalized so extending to other codes is
 * config-only, no new components.
 *
 * Design constraints (the reviewer, 2026-06-08, "FLEXIBILITY and CLARITY and
 * CONSISTENCY ... modular ... reused everywhere we have this need ...
 * never touched again unless we want to adjust it"):
 *
 * - **No per-FV decision buttons.** ONE accept / dismiss / park per
 *   card. Per-row pick buttons were the noise the editor produced.
 * - **Side-by-side two-column layout.** LEFT = baseline (Polished Gemma current
 *   by default), RIGHT = comparator (agent proposal here). Curator's
 *   eye lands on what differs.
 * - **Full statements on each side.** Subject — predicate — object
 *   rendered with the shared FvDisplayRow renderer so the chip / URI
 *   treatment matches everywhere else in the app.
 * - **Judge content surfaces at the top.** When the finding has a
 *   defender_verdict (boss / arbiter / defender), the rationale +
 *   verdict pill render as a "Judge:" row above the category. NO
 *   "[agent emitted no details]" fallback — when there's no judge
 *   verdict, the whole row is suppressed.
 * - **Modular shoulders.** All side labels, factors, and actions come
 *   from props. The wrapper component for each issue_code wires the
 *   right source for each prop.
 */

import { useContext, useEffect, useMemo, useState } from "react";
import { PanelExpansionContext } from "./findingCard";
import { termRenderer } from "@/components/ui/Term";

import type {
  AuditFinding,
  DismissReason,
} from "@/api/auditTypes";
import { FindingRecommendation } from "./FindingRecommendation";
import { FindingReasoningPanel } from "./findingReasoningPanel";
import { BossReviewSection } from "./BossAnnotation";
import type { GroupedBossReview } from "./bossCriticGrouping";
import type { FactorProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
import { factorTarget, parseTargetId } from "./targetIds";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import { useStickyState } from "@/lib/useStickyState";
import { useDesign } from "@/api/design";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  adoptNearMatchAgentFactor,
  mergeNearMatchAgentFactor,
  resolveAdoptTargetFactor,
  type AdoptTargetHint,
} from "@/features/design/mutations";
import { addFactorFromProposal } from "./applyHandlers";
import { friendlyDispositionError } from "./dispositionSave";
import { useToast } from "@/components/ui/Toast";
import {
  useCurations,
  type CurationRow,
} from "@/features/comparison/useSourceAvailability";
import { sourceTooltip, type Source } from "@/features/comparison/sources";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import {
  FactorComparisonGrid,
  continuousValuesFrom,
  pairFvs as sharedPairFvs,
  type FactorComparisonPair,
} from "./factorComparison/FactorComparisonGrid";
import {
  factorPairForFinding,
  fvPairsViaMapping,
} from "./factorComparison/mappingPairing";
import {
  findingActionGlyph,
  findingActionLabel,
  findingDisplayedGoldEmpty,
} from "./findingHelpers";
import { DispositionDot, MatchBadge, SeverityBadge } from "./findingBadges";
import {
  isCloseFactorMatch,
  isExactFactorMatch,
  synthesizeGoldFactorFromRename,
} from "./factorMatch";
import { displaySeverity, SHOW_PARK_AFFORDANCE } from "./auditPresentation";

// Local ``Term`` renderer removed 2026-06-15. The comparison grid now
// uses the canonical ``termRenderer`` from
// ``@/components/ui/Term`` so every ontology chip across the app
// (audit cards, design editor, tag bar) renders with one visual
// contract. Diff highlighting + free-text vs resolved palette + the
// emerald bookmark cue all live in the canonical Term via its
// ``variant`` + ``diff`` props. Per design review 2026-06-15: "make ALL
// surfaces use a single Term component."

/** Build the multi-line ``title`` tooltip surfaced on a free-text
 *  chip from the statement-level provenance the row passed in.
// ``_buildProvenanceTooltip`` removed 2026-06-15 — the canonical
// ``Term`` component now owns the free-text-chip provenance tooltip
// rendering (see ``apps/curation/src/components/ui/Term.tsx``).

/** Pick the category used to look up the LEFT (baseline) factor
 *  in the user-selected baseline curation.
 *
 *  Default: the finding's nominal category (agent-first; reliable for
 *  every non-rename case).
 *
 *  Override: when the finding carries a ``rename`` payload the agent
 *  and gold sides have DIFFERENT category labels by definition --
 *  agent ``treatment`` ↔ gold ``timepoint``, agent
 *  ``developmental stage`` ↔ gold ``age``, etc. The baseline lookup
 *  must use the GOLD-side category from the rename payload; otherwise
 *  the curator gets "(not in <baseline>)" annotation on a finding
 *  whose audit-time gold IS in the baseline curation. Canonical case:
 *  GSE67136 2026-06-15 -- treatment / timepoint rename, live design
 *  contains timepoint, lookup-by-treatment misses → wrong annotation.
 *
 *  Exported for the regression test in ``findingCardLayout.test.ts``;
 *  inline use in ``ComparisonFactorCard``. */
export function deriveLeftFactorCategory(
  finding: AuditFinding,
  findingCategory: { label: string | null; uri: string | null } | null,
): { label: string | null; uri: string | null } | null {
  const renameGoldCat = finding.rename?.gold?.category;
  if (renameGoldCat && (renameGoldCat.label || renameGoldCat.uri)) {
    return {
      label: renameGoldCat.label ?? null,
      uri: renameGoldCat.uri ?? null,
    };
  }
  return findingCategory;
}


/** A factor side — what the column header reads + the factor it points
 *  at. Either side may be null (e.g. an extra finding has no baseline
 *  factor; a miss finding has no comparator). */
export interface FactorSide {
  /** Column header label — "Polished Gemma" / "Agent" / "Curator B" / "Preboard". */
  label: string;
  /** Provenance hint — rendered as a small subtitle under the label
   *  (e.g. "current curation" / "proposed" / "polished gold"). */
  source: string;
  /** The factor itself. Mixed type because Polished Gemma-side carries the
   *  full ``Factor`` shape (with category URIs and FV ids from the DB)
   *  whereas the agent comparison-proposal side carries
   *  ``FactorProposal`` (no DB ids; richer statement structure). */
  factor: Factor | FactorProposal | null;
}

// PairedFv / pairFvs / fvLabel / fvBms / statusGlyph / CategoryPair /
// FvPairRow extracted 2026-06-12 to
// ``./factorComparison/FactorComparisonGrid.tsx`` so the shared grid
// primitive is the canonical home for the side-by-side render. The
// same module re-exports ``pairFvs`` so callers don't have to keep a
// local duplicate.

// JudgeRow / JudgeChain / ArbiterTile / BossTile extracted 2026-06-13
// to ``./JudgeChain.tsx`` so tag-finding surfaces (CompactFindingCard)
// can also render the chain. The reviewer flagged a tag card that promised
// "Read both rationales below" but rendered nothing — the chain was
// trapped inside this file. Import + re-use; no behaviour change here.

// JudgeChain / ArbiterTile / BossTile moved to ``./JudgeChain.tsx``
// — see the import at the top of this file.

// resolveCuration moved to features/comparison/resolveCuration.ts so
// DesignDraftContext can import it without picking up this file's
// transitive deps. Re-exported from there.

/** Gather FV-subject URIs (lowercased) for similarity scoring.
 *  We look at the statement subject because that's where the real
 *  perturbation identity lives — "C5ar1 [mouse]" vs "APP [human]"
 *  is the discriminator between two genotype factors that share
 *  the same category URI (EFO_0000513) and a shared `wild type
 *  genotype` FV. Falls back to FV free-text labels when no URIs. */
function _factorSubjectKey(f: Factor | FactorProposal | null): Set<string> {
  if (!f) return new Set();
  const out = new Set<string>();
  for (const fv of f.factor_values ?? []) {
    const stmts = (fv as { statements?: Array<{ subject?: { uri?: string | null; label?: string | null } }> })
      .statements ?? [];
    for (const s of stmts) {
      const u = (s.subject?.uri ?? "").trim().toLowerCase();
      if (u) out.add(`uri:${u}`);
      else {
        const l = (s.subject?.label ?? "").trim().toLowerCase();
        if (l) out.add(`lbl:${l}`);
      }
    }
    const free = ((fv as { free_text_label?: string }).free_text_label ?? "")
      .trim().toLowerCase();
    if (free) out.add(`fv:${free}`);
  }
  return out;
}

function _jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Resolve the matched gold factor for a factor finding, ID-FIRST.
 *
 *  A factor-match finding names the matched Gemma factor by its STABLE
 *  id in ``target_id`` ("factor:<id>"). Factors, FVs, and sample
 *  assignments are all keyed by id on the wire, so an id join is the
 *  reliable way to line the agent's factor up with the one in the
 *  current design: it survives factor reordering and doesn't depend on
 *  ``gold_target_index`` still matching the live design's order (that
 *  positional index is computed against the audit-time design and
 *  drifts — the cause of the "(no factor)" phantom-match render).
 *
 *  Resolve by id across the given factor pools (owning-curation design
 *  first, then the live design). Fall back to the positional
 *  ``gold_target_index`` only for label-based target_ids
 *  (``calibration_factor_extra`` → "factor:<slug>") or when the id
 *  isn't present in any pool. Pure — unit-tested in
 *  ``ComparisonFactorCard.goldById.test.ts``. */
export function resolveGoldFactorByIdOrIndex(
  finding: Pick<AuditFinding, "target_id" | "gold_target_index">,
  pools: Array<readonly Factor[] | null | undefined>,
  explicitGoldFactorId?: number | null,
): Factor | null {
  const parsed = parseTargetId(finding.target_id);
  // Bare numeric shape (``factor:<id>``, no category) — the whole slug
  // IS the id, pre-dating the ``#{id}`` discriminator.
  const fidFromTarget =
    parsed?.kind === "factor" && /^\d+$/.test(parsed.factorSlug)
      ? Number(parsed.factorSlug)
      : null;
  // Category+discriminator shape (``factor:treatment#101``) — the
  // 2026-07-30 collision fix. ``parsed.factorId`` is the id parsed off
  // the ``#{id}`` suffix; check it ahead of the bare-numeric shape
  // since it's the more specific / more recent addressing scheme (a
  // target_id can't match both patterns at once, so order between
  // these two doesn't matter in practice — kept explicit for clarity).
  const fidFromDiscriminator =
    parsed?.kind === "factor" ? (parsed.factorId ?? null) : null;
  // Prefer an id parsed out of ``target_id``; otherwise fall to the
  // explicit ``gemma_factor_id`` carried on the rename /
  // partition_mismatch payload. Either key is a STABLE id join that
  // survives factor reordering, so try it before any positional
  // fallback.
  const idKey =
    fidFromDiscriminator ??
    fidFromTarget ??
    (explicitGoldFactorId != null && Number.isInteger(explicitGoldFactorId)
      ? explicitGoldFactorId
      : null);
  if (idKey != null) {
    for (const pool of pools) {
      const hit = pool?.find((f) => f.id === idKey);
      if (hit) return hit;
    }
    // A numeric id was named but isn't in any pool (drifted / stripped
    // baseline). Do NOT fall back to the positional index — that's how a
    // match card ends up showing the WRONG factor. Return null so the
    // caller uses its self-carry (rename) fallback instead.
    return null;
  }
  // Label-based target_id (e.g. calibration_factor_extra): no id to join
  // on, so the positional gold_target_index is the best available key.
  const ix = finding.gold_target_index;
  if (ix == null) return null;
  for (const pool of pools) {
    const hit = pool?.[ix];
    if (hit) return hit;
  }
  return null;
}

/** Find the factor inside a curation's design that the finding is
 *  pointing at. Pairing is **identity-based**: category URI first,
 *  category label fallback, FV-subject Jaccard against the audit-
 *  time anchor for multi-factor-same-category disambiguation.
 *  Returns null when no factor in that curation lines up — the
 *  card renders the side as empty so the curator sees "(not in
 *  <source>)".
 *
 *  The ``preferIndex`` / ``indexIsAuthoritative`` parameters are
 *  retained as ARGUMENTS for source-compat but no longer trusted:
 *  the index was always a fragile pointer into one specific
 *  curation's factor list, and using it cross-curation produced
 *  off-by-rotation pairings whenever the baseline curation had a
 *  different factor count or ordering than the curation the audit
 *  ran against (GSE78929 2026-06-14: live had ``[disease, sex,
 *  age, individual]``, polished_strict_consensus had ``[sex, age,
 *  disease]`` — index 0 on the live-audited finding routed to
 *  polished's ``sex`` and so on). The reviewer: "it's just a comparison
 *  between annotation sets. doing it based on order is an obvious
 *  fail."
 *
 *  Multi-factor-same-category disambiguation: when more than one
 *  candidate factor in the curation matches by category, score each
 *  by FV-subject-URI Jaccard overlap with the anchor (the audit-time
 *  owning factor) and pick the highest scorer. GSE93824 has two
 *  ``genotype`` factors (C5aR1 KO + hAPP transgene); a naive
 *  first-match would render the wrong one. The BaselineDriftSection
 *  surfaces the runner-up factors separately. */
function findFactorInCuration(
  curation: CurationRow | null,
  category: { uri: string | null; label: string | null } | null,
  _preferIndex: number | null,
  _indexIsAuthoritative: boolean,
  anchor: Factor | FactorProposal | null = null,
): Factor | null {
  if (!curation) return null;
  const design = curation.design as { factors?: Factor[] } | undefined;
  const factors = design?.factors;
  if (!Array.isArray(factors) || factors.length === 0) return null;
  if (!category) return null;

  // Collect category-matching candidates (URI preferred, label
  // fallback) — preserve original-index order so ties break by
  // first occurrence rather than at random.
  const candidates: Factor[] = [];
  if (category.uri) {
    for (const f of factors) {
      if (f.category?.uri === category.uri) candidates.push(f);
    }
  }
  if (candidates.length === 0 && category.label) {
    const lc = category.label.toLowerCase();
    for (const f of factors) {
      if ((f.category?.label ?? "").toLowerCase() === lc) candidates.push(f);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Score by FV-subject Jaccard against the anchor (the original
  // owning factor). Higher is better; ties keep first-seen order.
  const anchorKey = _factorSubjectKey(anchor);
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const score = _jaccard(anchorKey, _factorSubjectKey(c));
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export interface ComparisonFactorCardProps {
  finding: AuditFinding;
  /** Custom title — defaults to a rename-style framing built from
   *  the rename payload. Caller overrides for extra / miss / match
   *  variants. */
  title?: React.ReactNode;
  /** Column header label for the LEFT (baseline) side. When
   *  omitted, falls back to the chip strip's currently-selected
   *  baseline source label. When the chip strip has no opinion
   *  either, falls back to "Baseline".
   *
   *  Per memory project-curation-overlay-model (2026-06-08): the
   *  card doesn't know which curation is on which side; that's
   *  the chip strip's job. The card's role is to render
   *  "baseline vs comparator with delta on the right" given
   *  whatever the chip strip selected. */
  leftLabel?: string;
  /** Column header label for the RIGHT (comparator) side. Same
   *  semantics as `leftLabel`. */
  rightLabel?: string;
  /** Optional self-documenting tooltips for the column-header labels.
   *  For an agent-proposal comparator this carries the full run
   *  provenance (run id / sha / date / model / batch / git describe)
   *  so hovering the header reveals everything. Empty → no tooltip. */
  leftLabelTitle?: string;
  rightLabelTitle?: string;
  /** Chip-strip baseline source token. When provided, the LEFT
   *  factor is sourced from this curation (looked up in the unified
   *  /curations list). When absent, the card falls back to
   *  useDesign(experimentId).factors[gold_target_index] — preserves
   *  pre-step-3b behaviour for any caller that hasn't been wired
   *  through yet. */
  baselineSource?: Source;
  /** Chip-strip comparator source token. Same semantics as
   *  baselineSource: when provided, the RIGHT factor is sourced from
   *  this curation; when absent, falls back to
   *  report.evidence.comparison_proposal.factors[agent_target_index]. */
  comparatorSource?: Source;
  /** Force the LEFT factor to a specific value, bypassing
   *  baselineSource resolution. Used by the synthetic baseline-drift
   *  cards in AuditSidebarPanel that surface factors present in the
   *  chip baseline but absent from the audit-time consensus gold —
   *  the card has no AuditFinding to source from but should render
   *  with the same layout for visual consistency. */
  leftFactorOverride?: Factor | null;
  /** Same for the RIGHT factor. Synthetic drift cards pass null to
   *  produce "(no factor)" on the right. */
  rightFactorOverride?: Factor | FactorProposal | null;
  /** Suppress the Accept / Dismiss / Park button row. Used by the
   *  synthetic drift cards — there's no AuditFinding to dispatch a
   *  disposition against, so action buttons would be a dead end.
   *  When ``onRemoveFactor`` / ``onKeepFactor`` are also wired the
   *  card surfaces a simpler "Remove / Keep" pair instead — the reviewer
   *  2026-06-14: drift cards still need an action affordance ("the
   *  option to simply remove it should be there"). */
  readOnly?: boolean;
  /** Drift-card action: remove the displayed factor from the design
   *  draft. Renders a "Remove" button alongside Keep when set. */
  onRemoveFactor?: () => void;
  /** Drift-card action: keep the displayed factor as-is and hide
   *  this card. Renders a "Keep" button alongside Remove when set. */
  onKeepFactor?: () => void;
  /** Boss-critic verdicts anchored to this factor (and its FVs) —
   *  rendered as a collapsed-by-default section INSIDE the card so the
   *  boss commentary stays with the proposal. */
  bossReviews?: GroupedBossReview[];
}

/** The card itself. Pulls baseline (Polished Gemma) from the design and
 *  comparator (agent) from the comparison_proposal, then renders the
 *  side-by-side layout. */
export function ComparisonFactorCard({
  finding,
  title,
  leftLabel: leftLabelProp,
  rightLabel: rightLabelProp,
  leftLabelTitle: leftLabelTitleProp,
  rightLabelTitle: rightLabelTitleProp,
  baselineSource,
  comparatorSource,
  leftFactorOverride,
  rightFactorOverride,
  readOnly: readOnlyProp,
  onRemoveFactor,
  onKeepFactor,
  bossReviews,
}: ComparisonFactorCardProps) {
  const { report, experimentId, setDisposition, dispositionByTarget } =
    useAudit();
  // Read from the draft (curator's uncommitted edits) rather than
  // the saved server design — otherwise factor add / delete / rename
  // edits the curator just made don't reflect in the chain card's
  // own owning-factor lookups. Falls through to ``useDesign`` only
  // when no draft is mounted (the component is rendered outside the
  // experiment shell). Per the 2026-06-13 continuity sweep.
  const { draft: draftDesign } = useDesignDraft();
  const { data: serverDesign } = useDesign(experimentId);
  const design = draftDesign ?? serverDesign;
  const curationsQuery = useCurations(experimentId);
  const curations = curationsQuery.data ?? [];
  const [busy, setBusy] = useState(false);
  // Per design review 2026-06-16: on match-family cards "Keep" is too coarse.
  // The curator may have rejected the agent's alternative because (a)
  // it was equivalent and they're keeping the existing for style, (b)
  // close but specifically wrong about one thing, or (c) materially
  // off. The three Keep buttons capture those verdicts separately;
  // (b) opens an inline note so the curator can name the gap. The
  // sub-verdict rides on the disposition as ``dismissReason`` (open
  // string enum: ``keep_agent_equivalent`` / ``keep_agent_close`` /
  // existing ``wont_fix``); the ``keep_agent_close`` case also stamps
  // the note into the disposition's ``notes`` field.
  // Persist the "close but wrong" note across navigation + query
  // invalidation. Plain useState lost the curator's in-progress note
  // the moment anything remounted this card — most painfully after
  // the "commit your design edits first" guard fires, they commit,
  // and the resulting report refetch rebuilds the findings list. Key
  // per experiment+finding so two cards don't share a draft; cleared
  // on save / cancel. Mirrors CloseAuditConfirm's sticky close-note.
  // Design review 2026-07-21 ("we fixed this before" — same class of bug).
  const keepNoteKey = `keepCloseNote:${experimentId}:${finding.target_id}`;
  const [keepCloseNoteOpen, setKeepCloseNoteOpen] = useStickyState<boolean>(
    `${keepNoteKey}:open`,
    false,
  );
  const [keepCloseNote, setKeepCloseNote] = useStickyState<string>(
    keepNoteKey,
    "",
  );
  // Wipe the persisted draft note (both keys) once it's been
  // committed into the disposition or explicitly discarded, so the
  // next fresh review of this finding starts empty.
  function clearKeepCloseNote() {
    try {
      localStorage.removeItem(keepNoteKey);
      localStorage.removeItem(`${keepNoteKey}:open`);
    } catch {
      // localStorage unavailable — the setState calls below still
      // reset the in-memory value.
    }
    setKeepCloseNote("");
    setKeepCloseNoteOpen(false);
  }
  // Chip-strip read-only state — OR'd with the prop so callers can
  // still force read-only on synthetic baseline-drift cards via the
  // existing prop, but the card auto-detects when the chip strip is
  // viewing a non-editable baseline (Live Gemma / preboard / etc.)
  // and suppresses the action buttons without the caller having to
  // thread the flag through every render site.
  const chipReadOnly = useIsReadOnly();
  const readOnly = readOnlyProp || chipReadOnly;
  const { apply: applyDraft } = useDesignDraft();
  // ``serverDesign`` is unused below but kept in the destructure
  // above to clarify that we DELIBERATELY shadow the legacy
  // useDesign-based read.
  void serverDesign;
  const toast = useToast();
  // Card-level collapse — matches the chevron/collapse contract on
  // ``CompactFindingCard`` so a curator's "collapse all" button at
  // the top of the sidebar reaches these cards too. Per design review
  // 2026-06-12: the partition-mismatch / rename cards were rendering
  // with no chevron, so they couldn't be collapsed alongside the rest
  // of the factor cards.
  const panelExpansion = useContext(PanelExpansionContext);
  const [cardOpen, setCardOpen] = useState(panelExpansion !== "collapsed");
  useEffect(() => {
    setCardOpen(panelExpansion !== "collapsed");
  }, [panelExpansion]);

  // Labels: prop > generic fallback. The actual chip-strip-driven
  // labels resolve via the sourceLabel helper in the panel layer;
  // the card just renders whatever string the caller hands it.
  const leftLabel = leftLabelProp ?? "Baseline";
  const rightLabel = rightLabelProp ?? "Comparator";
  // Self-documenting column-header tooltips. Prefer an explicit prop
  // from the caller; otherwise derive from the chip-strip source token
  // + the /curations row's run_provenance block, so hovering the
  // comparator header reveals the full agent-run identity (sha / date /
  // model / batch / git describe) without hunting through sidecars.
  const leftLabelTitle =
    leftLabelTitleProp ??
    (baselineSource ? sourceTooltip(baselineSource, curations) : "");
  const rightLabelTitle =
    rightLabelTitleProp ??
    (comparatorSource ? sourceTooltip(comparatorSource, curations) : "");

  const dispo = dispositionByTarget.get(finding.target_id) ?? null;
  const status = dispo?.status ?? "pending";

  // Resolve the OWNING factors first — the consensus-polished factor
  // at gold_target_index and the agent_proposal factor at
  // agent_target_index. These are always reachable regardless of
  // chip-strip selection; their categories give us the URI/label
  // hint to find the same factor in any non-owning curation the
  // user picks.
  // Resolve the owning gold curation. Preference order:
  //   1. ``finding.gold_curation_id`` — the canonical handle the agents side
  //      ships post-2026-06-14. Routes through ``resolveCuration``'s
  //      direct curation_id lookup (same as a chip-strip selection).
  //   2. First-consensus fallback — the pre-2026-06-14 behaviour, kept
  //      so old calibration packages that don't carry the new field
  //      still render.
  const owningGoldCuration: CurationRow | null = useMemo(() => {
    if (finding.gold_curation_id) {
      const byId = resolveCuration(
        finding.gold_curation_id as Source,
        curations,
      );
      if (byId) return byId;
    }
    return curations.find((c) => c.source_kind === "consensus") ?? null;
  }, [curations, finding.gold_curation_id]);

  const owningGoldFactor: Factor | null = useMemo(() => {
    const fromCuration =
      (owningGoldCuration?.design as { factors?: Factor[] } | undefined)
        ?.factors ?? null;
    // Stable Gemma factor id off the rename / partition_mismatch
    // payload — the id key used when ``target_id`` is label-based
    // (``factor:<slug>``) rather than a numeric ``factor:<id>``.
    const explicitGoldFactorId =
      finding.rename?.gold?.gemma_factor_id ??
      finding.partition_mismatch?.gold?.gemma_factor_id ??
      null;
    return resolveGoldFactorByIdOrIndex(
      finding,
      [fromCuration, design?.factors],
      explicitGoldFactorId,
    );
  }, [owningGoldCuration, design, finding]);

  // The agents side 1's caveat: the agent stamps the consensus ROW it identified
  // as the gold, but the row's ``design_payload`` may be empty if the
  // live Gemma design was edited without re-saving to the consensus
  // curation. Detect that specific shape so the "(not in …)"
  // annotation can be more useful when it fires.
  const owningRowExistsButEmpty =
    !!finding.gold_curation_id &&
    !!owningGoldCuration &&
    finding.gold_target_index != null &&
    !owningGoldFactor;

  const owningAgentFactor: Factor | FactorProposal | null = useMemo(() => {
    const ix = finding.agent_target_index;
    if (ix == null) return null;
    return report?.evidence?.comparison_proposal?.factors?.[ix] ?? null;
  }, [finding.agent_target_index, report]);

  // Category hint for cross-curation factor lookup. Prefer the
  // AGENT side — its category is reliable because it's read off
  // ``report.evidence.comparison_proposal.factors[agent_target_index]``,
  // an index against the audit's own copy of the agent proposal.
  // The gold side's ``owningGoldFactor`` is also looked up by index
  // (against ``owningGoldCuration``), but if
  // ``finding.gold_curation_id`` resolves to a curation whose factor
  // order differs from the one the audit ran against — which can
  // happen when the gold_curation_id was stamped optimistically as
  // a consensus row id rather than the actual audit-time gold — that
  // index points at the wrong factor and contaminates downstream
  // category matching with a stale label/URI. Caught 2026-06-14 on
  // GSE78929 where pack curation order ``[bio sex, age, disease]``
  // didn't line up with the audit-time live order ``[disease, bio
  // sex, age, individual]`` and every factor_match card paired the
  // wrong pair. Agent-first prefers the path that doesn't depend on
  // cross-curation index alignment. Fallback to gold side preserves
  // the case where only the gold side has a factor (e.g.
  // calibration_factor_gold_only_miss findings — ``individual`` on
  // GSE78929 — where ``owningAgentFactor`` is null).
  const findingCategory = useMemo(() => {
    const ac = owningAgentFactor?.category;
    if (ac && (ac.label || ac.uri)) {
      return { label: ac.label ?? null, uri: ac.uri ?? null };
    }
    const gc = owningGoldFactor?.category;
    if (gc && (gc.label || gc.uri)) {
      return { label: gc.label ?? null, uri: gc.uri ?? null };
    }
    return null;
  }, [owningGoldFactor, owningAgentFactor]);

  // For ``calibration_factor_match_near`` findings that carry a
  // ``rename`` payload the agent + gold sides have DIFFERENT category
  // labels by definition (that's what "rename" means: agent says
  // ``treatment``, gold says ``timepoint``). Using ``findingCategory``
  // (agent-first) for the LEFT/baseline lookup then misses the gold-
  // side category and the curator gets "(not in Live Gemma)" rendered
  // on a finding whose audit-time gold IS in the baseline curation
  // (GSE67136 2026-06-15 -- canonical case: agent ``treatment`` ↔
  // gold ``timepoint``; live design HAS ``timepoint``; "(not in
  // Live Gemma)" annotation was wrong). See ``deriveLeftFactorCategory``
  // below for the pure rule + the regression test in
  // ``findingCardLayout.test.ts``.
  const leftFactorCategory = useMemo(
    () => deriveLeftFactorCategory(finding, findingCategory),
    [finding, findingCategory],
  );

  // LEFT = baseline. When baselineSource is set, route through the
  // unified /curations list — that's what the chip strip selected.
  // When absent (legacy callers), fall back to the live design at
  // the finding's gold_target_index (pre-step-3b behaviour).
  // Explicit override (synthetic drift cards) wins over both.
  const leftFactor: Factor | null = useMemo(() => {
    if (leftFactorOverride !== undefined) return leftFactorOverride;
    // "Current" is the matched factor, resolved by its stable id
    // (``owningGoldFactor`` is now id-first). We deliberately do NOT vary
    // Current by the base selector: pointing it at a different baseline is
    // effectively loading a different proposal — out of scope. Prefer the
    // id-resolved factor whenever it carries FVs; only when the id lookup
    // yields nothing usable do we fall through to the baseline-curation
    // lookup and finally the self-carried ``rename`` payload.
    if (owningGoldFactor && (owningGoldFactor.factor_values?.length ?? 0) > 0) {
      return owningGoldFactor;
    }
    const resolved: Factor | null = (() => {
      if (baselineSource !== undefined) {
        const curation = resolveCuration(baselineSource, curations);
        // gold_target_index was computed against the consensus polished
        // gold that owns the finding. Authoritative only when the
        // baseline curation is that same consensus row.
        const indexIsAuth = curation?.source_kind === "consensus";
        // anchor = the original gold-side factor (consensus row,
        // resolved via gold_target_index). When the baseline curation
        // has multiple factors with the same category URI
        // (GSE93824 live has 2 genotype factors), findFactorInCuration
        // scores candidates by FV-subject Jaccard against this anchor
        // and picks the closest — otherwise the function falls back to
        // first-match, which silently picks the wrong factor.
        return findFactorInCuration(
          curation,
          leftFactorCategory,
          finding.gold_target_index ?? null,
          indexIsAuth,
          owningGoldFactor,
        );
      }
      return owningGoldFactor;
    })();
    if (resolved && (resolved.factor_values?.length ?? 0) > 0) return resolved;
    // Self-carry fallback. A FACTOR MATCH / rename finding whose baseline
    // lookup missed — the selected baseline is a stripped ``preboard``
    // design, an empty consensus row, or the ``gold_target_index``
    // misaligns — still carries the matched gold factor in
    // ``finding.rename`` (gold FactorRef + fv_pairs, baked in by the
    // calibration builder). Render it so a real match never collapses to
    // "(no factor)" / "(no FV)" — the card must not badge "FACTOR MATCH"
    // against an existing factor it then fails to show. Prefer a live
    // baseline factor when it carries FVs (keeps "Current" reflecting the
    // curator's own baseline); only fall back when there is nothing live
    // to render. Mirrors ``resolveGoldFactor``'s factor-level fallback.
    const synth = synthesizeGoldFactorFromRename(finding.rename ?? null);
    if (synth && synth.factor_values.length > 0) return synth;
    return resolved ?? synth;
  }, [
    leftFactorOverride,
    baselineSource,
    curations,
    leftFactorCategory,
    finding.gold_target_index,
    finding.rename,
    owningGoldFactor,
  ]);

  // RIGHT = comparator. Same routing: when comparatorSource is set,
  // pull from the unified /curations row that matches. When absent,
  // fall back to the agent's comparison_proposal at agent_target_index.
  // Explicit override (synthetic drift cards) wins over both.
  const rightFactor: Factor | FactorProposal | null = useMemo(() => {
    if (rightFactorOverride !== undefined) return rightFactorOverride;
    if (comparatorSource !== undefined) {
      const curation = resolveCuration(comparatorSource, curations);
      // agent_target_index was computed against the agent_proposal
      // that owns the finding. Authoritative only when comparator
      // resolves to an agent_proposal row.
      const indexIsAuth = curation?.source_kind === "agent_proposal";
      // anchor = the agent's original factor for FV-Jaccard
      // disambiguation when the comparator curation has multiple
      // factors with the same category URI (see leftFactor's
      // comment for the GSE93824 motivating case).
      return findFactorInCuration(
        curation,
        findingCategory,
        finding.agent_target_index ?? null,
        indexIsAuth,
        owningAgentFactor,
      );
    }
    return owningAgentFactor;
  }, [
    rightFactorOverride,
    comparatorSource,
    curations,
    findingCategory,
    finding.agent_target_index,
    owningAgentFactor,
  ]);

  const rightCategory = rightFactor
    ? {
        label: rightFactor.category?.label ?? null,
        uri: rightFactor.category?.uri ?? null,
      }
    : null;
  const leftCategory = leftFactor
    ? {
        label: leftFactor.category?.label ?? null,
        // Self-carried gold from a rename payload can lack the category
        // URI (the builder doesn't always mirror ``rename.gold.category.uri``);
        // it then renders as italic free text instead of an ontology chip.
        // When the two sides share the SAME category label — i.e. an exact
        // category match, not a rename where the labels differ by design —
        // borrow the comparator's URI so the baseline chip resolves as a
        // term. Same pattern as buildFactorRows' reference-URI fallback.
        uri:
          leftFactor.category?.uri ??
          (rightCategory?.uri &&
          (leftFactor.category?.label ?? "").toLowerCase().trim() ===
            (rightCategory.label ?? "").toLowerCase().trim()
            ? rightCategory.uri
            : null),
      }
    : null;

  // Would clicking Merge actually change the gold factor? True iff at
  // least one agent FV (paired by biomaterial set) carries a statement
  // that's not already in its gold counterpart by S-P-O signature.
  // Drives the Merge button's visibility — Design review 2026-06-14: "if there
  // is no difference at all, then it's not going to say 'merge'."
  const mergeWouldAddSomething = useMemo<boolean>(() => {
    if (!leftFactor || !rightFactor) return false;
    const sig = (s: {
      subject?: { label?: string | null; uri?: string | null } | null;
      predicate?: { label?: string | null; uri?: string | null } | null;
      object?: { label?: string | null; uri?: string | null } | null;
    }): string => {
      const part = (
        t?: { label?: string | null; uri?: string | null } | null,
      ): string => ((t?.uri || t?.label) ?? "").trim().toLowerCase();
      return `${part(s.subject)}|${part(s.predicate)}|${part(s.object)}`;
    };
    const bmKey = (xs: readonly string[]) => [...xs].sort().join("|");
    const goldByBm = new Map<string, (typeof leftFactor.factor_values)[number]>();
    for (const gfv of leftFactor.factor_values) {
      goldByBm.set(bmKey(gfv.biomaterial_short_names), gfv);
    }
    for (const afv of rightFactor.factor_values ?? []) {
      const gfv = goldByBm.get(bmKey(afv.biomaterial_short_names));
      if (!gfv) return true; // agent FV doesn't pair → merge appends
      const goldSigs = new Set(gfv.statements.map(sig));
      for (const ast of afv.statements ?? []) {
        if (!goldSigs.has(sig(ast))) return true;
      }
    }
    return false;
  }, [leftFactor, rightFactor]);

  // Pair derivation — prefer the wire's authoritative ``mapping.fv_pairs``
  // when present (the agents-side 2026-06-12 alignment ship), fall through to the
  // legacy biomaterial-Jaccard ``pairFvs`` heuristic otherwise. The
  // mapping path uses the finding's ``gold_target_index`` /
  // ``agent_target_index`` to find the owning factor pair, then walks
  // its FV pairs. Old packages without ``mapping`` see no change.
  const pairs = useMemo<FactorComparisonPair[]>(() => {
    const factorPair = factorPairForFinding(report, finding);
    if (factorPair) {
      const mapped = fvPairsViaMapping(report, factorPair, leftFactor, rightFactor);
      if (mapped) return mapped;
    }
    return sharedPairFvs(leftFactor, rightFactor);
  }, [report, finding, leftFactor, rightFactor]);

  // /curations is slow (~10s in the design review's GSE93824 walkthrough — server-
  // side bottleneck, per UIB perf notes 2026-06-11). When it's still
  // in flight, the card resolves leftFactor/rightFactor to null and
  // the title falls through to "?" placeholders that read as "data
  // missing" rather than "data loading". Detect the actual loading
  // condition (curations still fetching AND no explicit factor
  // overrides driving the card) and swap the placeholders for a
  // skeleton + "loading…" caption so curators see progress.
  const factorsAreLoading =
    curationsQuery.isLoading &&
    leftFactorOverride === undefined &&
    rightFactorOverride === undefined &&
    !leftFactor &&
    !rightFactor;
  const skeleton = (
    <span
      className="inline-block align-middle h-3 w-24 rounded bg-slate-200/80 dark:bg-slate-700/70 animate-pulse"
      aria-label="loading"
    />
  );
  const ph = (
    label: string | null | undefined,
  ): React.ReactNode => {
    if (label) return label;
    return factorsAreLoading ? skeleton : "?";
  };

  // Per-issue subject (what the action acts on). The badge + uppercase
  // verb come from the shared helpers below so this surface reads with
  // the same pattern as CompactFindingCard.
  const subjectNode: React.ReactNode = (() => {
    const code = finding.issue_code;
    if (code === "calibration_factor_rename") {
      return (
        <>
          <span className="font-mono">{ph(leftCategory?.label)}</span>
          <span className="text-slate-400"> → </span>
          <span className="font-mono">{ph(rightCategory?.label)}</span>
        </>
      );
    }
    if (code === "calibration_factor_match_near") {
      return (
        <>
          <span className="font-mono">{ph(leftCategory?.label)}</span>
          <span className="text-slate-400 font-normal text-[11px] ml-1">
            (
            {rightFactor?.factor_values?.length ??
              (factorsAreLoading ? "…" : "?")}{" "}
            vs{" "}
            {leftFactor?.factor_values?.length ??
              (factorsAreLoading ? "…" : "?")}{" "}
            levels)
          </span>
        </>
      );
    }
    if (code === "calibration_factor_extra") {
      return <span className="font-mono">{ph(rightCategory?.label)}</span>;
    }
    if (code === "calibration_factor_gold_only_miss") {
      return <span className="font-mono">{ph(leftCategory?.label)}</span>;
    }
    return (
      <span className="font-mono">
        {leftCategory?.label ||
          rightCategory?.label ||
          (factorsAreLoading ? skeleton : "(factor)")}
      </span>
    );
  })();

  // Title now follows the CompactFindingCard pattern — left-edge badge
  // (Match ≈ / ✓ or Severity-with-action-glyph Δ), UPPERCASE action
  // label, em-dash, then the per-issue subject. Per design review 2026-06-12:
  // "the title of the card should follow the same pattern as the
  // other cards." Caller can still override via the ``title`` prop.
  //
  // Match-vs-displayed-baseline guard: a match finding's issue_code
  // is set against the gold the AGENT ran against, which may differ
  // from the chip-strip's currently-selected baseline. When the
  // displayed baseline doesn't carry the matched factor (leftFactor
  // is null), the green ✓ + "MATCH" label misleads — the curator sees
  // "match" but the LEFT column reads "(no factor)". Suppress the
  // match badge in that case and fall back to the severity glyph;
  // also annotate "(not in <baseline>)" after the action label so
  // the curator knows the match assertion is against the authoritative
  // gold, not the row they're viewing. Design review 2026-06-14.
  const isMatchFindingCode =
    isExactFactorMatch(finding) ||
    isCloseFactorMatch(finding) ||
    finding.issue_code === "calibration_match";
  const matchedButMissingFromBaseline =
    isMatchFindingCode && !leftFactor && !!rightFactor;
  const matchBadge = matchedButMissingFromBaseline ? null : (
    <MatchBadge finding={finding} />
  );
  // Once the curator has dispositioned a near-match factor, the left-edge
  // badge should read the VERDICT (✓ / ✗ / ⋯ + reviewer/reason/notes on
  // hover), not the ambiguous ≈ "near match" badge — otherwise a reviewer
  // (esp. on a swapped review) can't tell what was decided without
  // expanding. Mirrors CompactFindingCard's hasDisposition precedence.
  const dispositionBadge =
    status !== "pending" ? (
      <DispositionDot
        status={status as "accepted" | "dismissed" | "needs_more_info"}
        resolved={!!dispo?.resolved_at}
        severity={finding.severity}
        reason={
          dispo?.dismiss_reason ??
          dispo?.accept_reason ??
          dispo?.not_sure_reason ??
          null
        }
        notes={dispo?.notes ?? null}
        reviewer={dispo?.reviewer ?? null}
      />
    ) : null;
  const derivedTitle =
    title ?? (
      <span className="inline-flex items-baseline gap-1.5 min-w-0">
        {/* Dispositioned → show the verdict badge; else the match ≈ / ✓
            badge; else fall back to SeverityBadge with the action glyph
            (Δ / + / − / etc.) for partition_mismatch / extra / miss. */}
        {dispositionBadge ?? matchBadge ?? (
          <SeverityBadge
            severity={displaySeverity(finding)}
            glyph={findingActionGlyph(finding)}
          />
        )}
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {findingActionLabel(finding, {
            goldEmpty:
              findingDisplayedGoldEmpty(finding, draftDesign ?? null) === true,
          })}
        </span>
        {matchedButMissingFromBaseline ? (
          <span
            className="text-[10px] italic text-amber-700 dark:text-amber-300"
            title={
              owningRowExistsButEmpty
                ? `Agent compared against ${leftLabel}, but its saved design payload is empty — the agent likely read the live design state. Re-save to refresh.`
                : `The match was computed against the agent's authoritative gold; ${leftLabel} doesn't carry this factor.`
            }
          >
            {owningRowExistsButEmpty
              ? `(${leftLabel} design empty — re-save?)`
              : `(not in ${leftLabel})`}
          </span>
        ) : null}
        <span className="text-slate-400 dark:text-slate-500">—</span>
        <span className="text-[12px] font-semibold min-w-0 truncate">
          {subjectNode}
        </span>
        {(() => {
          // Inline short description after the subject — prefers the
          // curator/baseline factor's description, falls back to the
          // comparator's. Renders as " — <desc>" continuing the same
          // header row so the curator sees "FACTOR MATCH — genotype
          // — cpxm2 ko" at a glance. Truncates with the parent's
          // ``min-w-0`` flex so a long description doesn't push the
          // status pill off the right.
          const desc =
            (leftFactor?.description ?? "").trim() ||
            (rightFactor?.description ?? "").trim();
          if (!desc) return null;
          return (
            <>
              <span className="text-slate-400 dark:text-slate-500">—</span>
              <span
                className="text-[11px] italic text-slate-600 dark:text-slate-400 min-w-0 truncate"
                title={desc}
              >
                {desc}
              </span>
            </>
          );
        })()}
      </span>
    );

  async function dispatch(
    next: "accepted" | "dismissed" | "needs_more_info" | "pending",
    extras?: { dismissReason?: DismissReason; notes?: string },
  ) {
    setBusy(true);
    try {
      // Auto-resolve: any disposition the curator takes on a
      // ComparisonFactorCard is a terminal action (Accept = adopted /
      // Merge = applied / Keep = dismissed / Park = needs more info).
      // None expect follow-up work, so stamp ``resolvedAt`` for the
      // accepted path so the card lands in the resolved bucket rather
      // than the parked one. Design review 2026-06-12: "after merge the card
      // should be resolved (or any other disposition)".
      const resolvedExtras =
        next === "accepted"
          ? { ...extras, resolvedAt: new Date().toISOString() }
          : extras;
      await setDisposition(finding.target_id, next, resolvedExtras);
    } catch (err) {
      // Was a bare try/finally with no catch — a server-side drop (or
      // any other setDisposition failure) was a fully silent unhandled
      // rejection: the busy spinner reset and nothing told the curator
      // it didn't save (2026-07-30: "it didn't fully record some of my
      // dispositions again").
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        toast.show(
          "Audit is closed — reopen it to keep editing dispositions.",
          "danger",
          6000,
        );
      } else {
        toast.show(friendlyDispositionError(err), "danger", 6000);
      }
    } finally {
      setBusy(false);
    }
  }

  // Near-match accept actually mutates the draft — overwrite the
  // gold factor's category + per-FV labels / statements with the
  // agent's version while preserving the partition (biomaterial
  // assignments) and factor id. Design review 2026-06-12 ("as it stands,
  // accept doesn't do anything") — the disposition PATCH on its
  // own was a no-op for the curator's visible state. Other issue
  // codes (rename / extra / miss) keep the existing PATCH-only
  // path; their structural applies live elsewhere.
  const isNearMatch =
    finding.issue_code === "calibration_factor_match_near";
  // "Proposal is better" routes through the draft-mutating
  // ``dispatchNearMatchAccept`` for the WHOLE match family — exact,
  // close, near, and the legacy ``calibration_factor_match`` code —
  // not only ``_match_near``. Design review 2026-06-14: on a factor-MATCH card
  // where categories agree but the agent's FV is enriched with extra
  // statements (e.g. ``treatment`` matched but agent adds ``delivered
  // to mother`` / ``dose 10% v/v``), clicking "Proposal is better"
  // was a no-op — disposition PATCHed, draft unchanged, design tab
  // didn't focus. Treat any match-family finding with a resolvable
  // agent factor as "adopt + focus". Rename / extra / miss stay on
  // their existing dedicated handlers. */
  const isMatchFamilyAdopt =
    !!rightFactor && (
      isNearMatch ||
      isExactFactorMatch(finding) ||
      isCloseFactorMatch(finding)
    );

  // Which draft factor an adopt / merge lands on. The CURRENT side —
  // the finding's own gold factor id, and the category this card is
  // displaying on the left — not the agent's proposed category. On a
  // rename those differ by definition, and resolving by the agent's
  // side found nothing and silently changed nothing (GSE11630: agent
  // proposes `individual` for Gemma's `cell line`; reported
  // 2026-08-09).
  const adoptTarget: AdoptTargetHint = {
    factorId:
      finding.rename?.gold?.gemma_factor_id ??
      finding.partition_mismatch?.gold?.gemma_factor_id ??
      leftFactor?.id ??
      null,
    categoryLabel: leftFactorCategory?.label ?? null,
    categoryUri: leftFactorCategory?.uri ?? null,
  };

  /** Refuse to record an "accepted" the draft didn't actually take.
   *  Returns true when the adopt / merge has somewhere to land. */
  function adoptTargetMissing(): boolean {
    const agentFactor = rightFactor as FactorProposal | null;
    if (!agentFactor || !draftDesign) return false;
    if (matchedButMissingFromBaseline) return false; // routes to add-factor
    const hit = resolveAdoptTargetFactor(draftDesign, agentFactor, adoptTarget);
    if (hit) return false;
    toast.show(
      `Couldn't apply — no factor matching "${
        leftFactorCategory?.label || agentFactor.category?.label || "this card"
      }" in the current draft. The disposition was NOT recorded.`,
      "danger",
      6000,
    );
    return true;
  }

  async function dispatchNearMatchMerge(): Promise<void> {
    // Curator's "+ Merge" — take the union of both sides' per-FV
    // statements (dedupe by full S-P-O signature). Motivating case
    // (design review 2026-06-12): gold had per-drug doses, agent had per-
    // drug durations — both useful, neither replaceable. Merge
    // keeps both.
    const agentFactor = rightFactor as FactorProposal | null;
    if (!agentFactor) {
      toast.show(
        "Couldn't merge — agent factor unresolved.",
        "danger",
        4000,
      );
      return;
    }
    if (adoptTargetMissing()) return;
    setBusy(true);
    try {
      applyDraft((d) => mergeNearMatchAgentFactor(d, agentFactor, adoptTarget));
      // Focus the merged factor in the design tab so the curator
      // sees the new statements on the FVs without hunting. Same
      // intent as the Agree-add path on calibration_factor_extra.
      requestAuditFocus(
        experimentId,
        factorTarget(agentFactor.category.label, agentFactor.proposal_factor_id),
      );
      await setDisposition(finding.target_id, "accepted", {
        resolvedAt: new Date().toISOString(),
      });
      toast.show(
        "Merged the agent's statements into the existing factor.",
        "success",
        3000,
      );
    } catch (err) {
      // Was a bare try/finally with no catch — see dispatch()'s catch
      // above for why that made a disposition drop fully silent.
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        toast.show(
          "Audit is closed — reopen it to keep editing dispositions.",
          "danger",
          6000,
        );
      } else {
        toast.show(friendlyDispositionError(err), "danger", 6000);
      }
    } finally {
      setBusy(false);
    }
  }

  async function dispatchNearMatchAccept(): Promise<void> {
    // ``rightFactor`` is the agent's proposed alternative. The
    // mutator finds the matching factor inside the writable draft
    // by category URI / label — leftFactor's id can't be trusted
    // since it may come from a non-writable chip-strip baseline
    // (Gemma / preboard) whose ids don't line up with the local
    // /design store. Per design review 2026-06-12.
    const agentFactor = rightFactor as FactorProposal | null;
    if (!agentFactor) {
      toast.show(
        "Couldn't adopt the alternative — agent factor unresolved.",
        "danger",
        4000,
      );
      return;
    }
    if (adoptTargetMissing()) return;
    setBusy(true);
    try {
      // Match-downgrade: the displayed gold baseline doesn't carry
      // the factor (``matchedButMissingFromBaseline``); there's
      // nothing for ``adoptNearMatchAgentFactor`` to mutate in place.
      // Route through the add-factor mutator instead so Agree
      // actually adds the agent's factor to the draft.
      if (matchedButMissingFromBaseline) {
        applyDraft((d) => addFactorFromProposal(d, agentFactor));
      } else {
        applyDraft((d) => adoptNearMatchAgentFactor(d, agentFactor, adoptTarget));
      }
      requestAuditFocus(
        experimentId,
        factorTarget(agentFactor.category.label, agentFactor.proposal_factor_id),
      );
      await setDisposition(finding.target_id, "accepted", {
        resolvedAt: new Date().toISOString(),
      });
      toast.show(
        matchedButMissingFromBaseline
          ? "Added the agent's factor."
          : "Adopted the agent's alternative.",
        "success",
        3000,
      );
    } catch (err) {
      // Was a bare try/finally with no catch — see dispatch()'s catch
      // above for why that made a disposition drop fully silent.
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        toast.show(
          "Audit is closed — reopen it to keep editing dispositions.",
          "danger",
          6000,
        );
      } else {
        toast.show(friendlyDispositionError(err), "danger", 6000);
      }
    } finally {
      setBusy(false);
    }
  }

  // Action labels follow the action shape. Design review 2026-06-14:
  // "It would be 'Proposal is better' 'Keep'." Default match /
  // near-match cards read with that pair so the curator's choice
  // names the OUTCOME, not the meta-stance. Code-specific verbs
  // (Add factor / Remove factor / Adopt rename) stay for the
  // structural-action codes.
  //
  // Match-downgrade: a match finding viewed against a baseline that
  // doesn't carry the factor (``matchedButMissingFromBaseline``) reads
  // as an Add — the curator's action is to add the agent's factor to
  // the displayed baseline, not confirm a match against an empty
  // column.
  const acceptLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Adopt rename"
      : finding.issue_code === "calibration_factor_extra"
        ? "Add factor"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Remove factor"
          : matchedButMissingFromBaseline
            ? "Add factor"
            : "Proposal is better";
  const dismissLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Keep current"
      : finding.issue_code === "calibration_factor_extra"
        ? "Don't add"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Keep current"
          : matchedButMissingFromBaseline
            ? "Don't add"
            : "Keep";

  // Dispositioned cards (accepted / dismissed / parked) recede the
  // same way ``CompactFindingCard`` does — opacity-40 with a hover
  // restore — so they sit quietly in the list and the curator's eye
  // lands on the still-open ones. Design review 2026-06-12: "it says
  // 'accepted' but it's not greyed like others".
  const dispositioned = status !== "pending";
  const dispositionFade = dispositioned
    ? "opacity-40 hover:opacity-90 transition-opacity"
    : "";
  const sevPalette =
    status === "accepted"
      ? "border-emerald-400/70 bg-emerald-50/30 dark:bg-emerald-900/10"
      : status === "dismissed"
        ? "border-slate-400/70 bg-slate-50/30 dark:bg-slate-900/10"
        : finding.severity === "ok"
          ? "border-emerald-300/70 bg-white dark:border-emerald-700/40 dark:bg-slate-900/40"
          : finding.severity === "major" || finding.severity === "blocker"
            ? "border-amber-300/70 bg-amber-50/30 dark:border-amber-700/60 dark:bg-amber-900/10"
            : "border-slate-300/70 bg-white dark:border-slate-700 dark:bg-slate-900/40";

  return (
    <div className={`rounded border ${sevPalette} ${dispositionFade} px-2.5 py-2 space-y-2`}>
      <div
        role="button"
        tabIndex={0}
        className="flex items-baseline gap-1.5 cursor-pointer"
        onClick={() => setCardOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCardOpen((v) => !v);
          }
        }}
        title={cardOpen ? "collapse card" : "expand card"}
      >
        {/* Chevron mirrors CompactFindingCard ("⌄" open, "›" closed). */}
        <button
          type="button"
          aria-label={cardOpen ? "collapse card" : "expand card"}
          onClick={(e) => {
            e.stopPropagation();
            setCardOpen((v) => !v);
          }}
          className="text-2xl leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 px-1 -mt-1 font-bold"
        >
          {cardOpen ? "⌄" : "›"}
        </button>
        {derivedTitle}
        {status === "pending" ? (
          <span className="text-[9px] uppercase tracking-wide text-slate-400 ml-auto">
            open
          </span>
        ) : null}
      </div>
      {cardOpen ? (
        <>
          {/* Curator headline — the canonical "what to do" from the
              PPE ``recommendation``, ABOVE the reasoning toggle so it's
              the primary always-visible signal. Everything else (the
              rationale stack, three-phase reasoning) sits in the
              reasoning collapsible below. Null on older reports → the
              card's legacy title header carries the signal instead. */}
          {finding.recommendation ? (
            <FindingRecommendation recommendation={finding.recommendation} />
          ) : null}
          {/* Reasoning collapsible — SAME component, SAME affordance
              shape as every other finding card type (the one used by
              CompactFindingCard / FindingDetailsEditor). Renders
              ABOVE the visual grid so the curator reads
              [reasoning] → [visual] → [buttons] regardless of finding
              kind. Design review 2026-06-16: "IT SHOULD BE THE SAME COMPONENT
              WHETHER THE FACTOR IS A MATCH or a PARTIAL MATCH". */}
          <FindingReasoningPanel
            finding={finding}
            report={report}
            defaultOpen={panelExpansion === "fully"}
          />
          {/* Body — switched 2026-06-12 from the inline CategoryPair +
              FvPairRow loop to the shared FactorComparisonGrid so
              this surface and FindingDetailsEditor (next-up
              migration) render the comparison the same way. Adds
              "FV N" labels per row + per-row sample counts (free via
              FvDisplayRow's indexLabel) that the inline version
              didn't surface. ``loading`` flag carries the
              factorsAreLoading branch the inline version inlined as
              skeleton placeholders. */}
          <FactorComparisonGrid
            leftHeader={{
              label: leftLabel,
              title: leftLabelTitle,
              category: leftCategory,
            }}
            rightHeader={{
              label: rightLabel,
              title: rightLabelTitle,
              category: rightCategory,
            }}
            pairs={pairs}
            termRenderer={termRenderer}
            loading={factorsAreLoading}
            // Continuous-mode swap: when either side declares
            // factor_type=continuous, the index-by-index pair grid is
            // the wrong shape — Gemma's gold has one FV per
            // measurement (40 for GSE9904 age) while the agent
            // dedups to unique values (28), and the labelled rows
            // misalign. The ContinuousStrip puts both sides on a
            // shared numeric axis so agreement reads visually
            // (filled = live dot, ring = agent dot, emerald ring =
            // matched value).
            continuous={(() => {
              // Schema vocabulary clash: gold-side FactorD names the
              // field ``type`` (camelCase identity, stays ``type``
              // after client.ts snakeification); agent-side
              // FactorProposal names it ``factor_type`` (snakeified
              // from ``factorType``). Read both so a continuous
              // factor on either side flips the body to the strip.
              const lAny = leftFactor as {
                factor_type?: string;
                type?: string;
              } | null;
              const rAny = rightFactor as {
                factor_type?: string;
                type?: string;
              } | null;
              const lType = lAny?.factor_type ?? lAny?.type;
              const rType = rAny?.factor_type ?? rAny?.type;
              if (lType !== "continuous" && rType !== "continuous") {
                return undefined;
              }
              return {
                left: continuousValuesFrom(
                  (leftFactor as { factor_values?: unknown[] } | null)
                    ?.factor_values as Parameters<
                    typeof continuousValuesFrom
                  >[0],
                ),
                right: continuousValuesFrom(
                  (rightFactor as { factor_values?: unknown[] } | null)
                    ?.factor_values as Parameters<
                    typeof continuousValuesFrom
                  >[0],
                ),
              };
            })()}
            onLeftLocate={
              leftFactor && leftFactor.category?.label
                ? () =>
                    requestAuditFocus(
                      experimentId,
                      factorTarget(leftFactor.category!.label!),
                    )
                : undefined
            }
          />
          {/* (Reasoning rendered above the grid — see above.) */}
          {readOnly && (onRemoveFactor || onKeepFactor) ? (
            // Drift-card action bar — surfaces Remove / Keep so the
            // curator can act on factors the audit didn't see, instead
            // of getting a read-only "FACTORS THE AUDIT DIDN'T SEE"
            // panel that just stares back. Design review 2026-06-14.
            <div className="flex items-center gap-1.5">
              {onRemoveFactor ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onRemoveFactor}
                  title="Drop this factor from the design draft."
                  className="text-[11px] px-2 py-0.5 rounded font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
              {onKeepFactor ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onKeepFactor}
                  title="Keep the factor; hide this drift card."
                  className="text-[11px] px-2 py-0.5 rounded font-medium border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  Keep
                </button>
              ) : null}
            </div>
          ) : readOnly ? null : status !== "pending" ? (
            // Dispositioned — opacity-40 fade on the wrapper is the
            // visual cue (matches CompactFindingCard). No status pill
            // (design review 2026-06-12: "others don't say 'accepted' — I don't
            // think we need that") — just a tiny undo link so a
            // misclick is reversible. Dispatches ``pending`` so the
            // card returns to the action row; the earlier
            // ``needs_more_info`` dispatch 422'd because that status
            // requires a ``not_sure_reason`` (design review 2026-06-14).
            <button
              type="button"
              disabled={busy}
              onClick={() => dispatch("pending")}
              className="text-[10px] text-slate-500 hover:text-slate-800 underline underline-offset-2 dark:text-slate-400 dark:hover:text-slate-100 disabled:opacity-50"
              title="Revert this card to pending and edit the disposition"
            >
              undo
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  isMatchFamilyAdopt
                    ? dispatchNearMatchAccept()
                    : dispatch("accepted")
                }
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {acceptLabel}
              </button>
              {/* Merge button — only when near-match AND merging would
                  actually change the gold factor (i.e. the agent has
                  at least one statement that's not already in gold,
                  including the "agent enriches a stub" case). The reviewer
                  2026-06-14: "if there is no difference at all, then
                  it's not going to say 'merge'." */}
              {isNearMatch && mergeWouldAddSomething ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => dispatchNearMatchMerge()}
                  title="Keep both sides' statements — dedupes identical S-P-O; otherwise both survive."
                  className="text-[11px] px-2 py-0.5 rounded font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  + Merge
                </button>
              ) : null}
              {isMatchFamilyAdopt ? (
                // Match-family cards: split Keep into three sub-
                // verdicts the curator picks before dismiss resolves.
                // The "close" path opens an inline note so the
                // curator can specify what was wrong.
                <>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 self-center">
                    {dismissLabel}:
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      dispatch("dismissed", {
                        dismissReason: "keep_agent_equivalent",
                      })
                    }
                    title="Keep the existing factor; the agent's alternative was functionally equivalent (eval credits this as a match)."
                    className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    ≈ equivalent
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setKeepCloseNoteOpen((v) => !v)}
                    title="Keep the existing factor; the agent was close but specifically wrong about something — capture it."
                    className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    ~ close
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      dispatch("dismissed", { dismissReason: "wont_fix" })
                    }
                    title="Keep the existing factor; the agent's alternative was materially off."
                    className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    ✗ off
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => dispatch("dismissed", { dismissReason: "wont_fix" })}
                  className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
                >
                  {dismissLabel}
                </button>
              )}
              {/* Park button gated off via SHOW_PARK_AFFORDANCE
                  (auditPresentation.ts) — same gate as findingCard /
                  FindingDetailsEditor. Handler stays wired. */}
              {SHOW_PARK_AFFORDANCE ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => dispatch("needs_more_info")}
                  className="text-[11px] px-2 py-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  Park
                </button>
              ) : null}
            </div>
          )}
          {/* Keep-close note input — appears when the curator chose
              "~ close". Submits on Enter or button click; dispatches
              dismissed with the note as ``notes`` so the eval-side
              near-miss report can read what the curator pointed out.
              Empty submission falls back to the bare "close" verdict. */}
          {keepCloseNoteOpen && status === "pending" ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                disabled={busy}
                value={keepCloseNote}
                onChange={(e) => setKeepCloseNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const note = keepCloseNote.trim();
                    clearKeepCloseNote();
                    void dispatch("dismissed", {
                      dismissReason: "keep_agent_close",
                      notes: note || undefined,
                    });
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    clearKeepCloseNote();
                  }
                }}
                placeholder="What was the agent close-but-wrong about? (e.g. category URI off, missing statement)"
                className="text-[11px] px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 flex-1 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const note = keepCloseNote.trim();
                  clearKeepCloseNote();
                  void dispatch("dismissed", {
                    dismissReason: "keep_agent_close",
                    notes: note || undefined,
                  });
                }}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                save
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  clearKeepCloseNote();
                }}
                className="text-[10px] text-slate-500 hover:text-slate-800 underline underline-offset-2 dark:text-slate-400 dark:hover:text-slate-100 disabled:opacity-50"
              >
                cancel
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {/* Boss-critic verdicts for this factor (+ its FVs) — collapsed
          section INSIDE the card so the commentary stays with the
          proposal. Its own toggle; visible even when the card body is
          collapsed. */}
      {bossReviews && bossReviews.length > 0 ? (
        <BossReviewSection
          reviews={bossReviews}
          variant="nested"
          autoOpen={bossReviews.some((g) => g.severity === "blocker")}
        />
      ) : null}
    </div>
  );
}

// WhyBlock was retired 2026-06-16 — every card now routes through the
// shared ``FindingReasoningPanel`` (./findingReasoningPanel.tsx) so the
// proposer + reviewer + comparison-judge text renders identically across
// CompactFindingCard and ComparisonFactorCard. The "Proposer detail"
// per-FV rationale envelope this block used to attach is covered by
// the per-FV chips inside FactorComparisonGrid + the proposer rationale
// inside AgentSuggestionPanel — no separate envelope needed.
