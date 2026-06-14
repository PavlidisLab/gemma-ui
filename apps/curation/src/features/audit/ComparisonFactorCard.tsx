/**
 * ComparisonFactorCard — modular, compact, side-by-side factor display
 * for calibration findings. Replaces FindingDetailsEditor's per-element
 * editor for findings whose primary curator question is "what's the
 * difference between Polished Gemma's curation and the agent's proposal?".
 *
 * Per HANDOFF_2026-06-08_FACTOR_DISPLAY_BASELINE_COMPARATOR.md the goal
 * is ONE factor display that works across (rename / extra / miss /
 * match) variants and across comparator sources (Polished Gemma / curator /
 * agent / preboard / none). v1 of this file handles rename specifically
 * with the structure generalized so extending to other codes is
 * config-only, no new components.
 *
 * Design constraints (Paul, 2026-06-08, "FLEXIBILITY and CLARITY and
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
import { type FvTermRenderer } from "@gemma/ontology";

import type {
  AuditFinding,
  DismissReason,
} from "@/api/auditTypes";
import { JudgeChain } from "./JudgeChain";
import type { FactorProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
import { factorTarget } from "./targetIds";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import { useDesign } from "@/api/design";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  adoptNearMatchAgentFactor,
  mergeNearMatchAgentFactor,
} from "@/features/design/mutations";
import { useToast } from "@/components/ui/Toast";
import {
  useCurations,
  type CurationRow,
} from "@/features/comparison/useSourceAvailability";
import type { Source } from "@/features/comparison/sources";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import { CurieLink } from "@/components/ui/CurieLink";
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
} from "./findingHelpers";
import { MatchBadge, SeverityBadge } from "./findingBadges";
import { isCloseFactorMatch, isExactFactorMatch } from "./factorMatch";
import { displaySeverity } from "./auditPresentation";

const Term: FvTermRenderer = ({ label, uri, variant }) => {
  if (variant === "predicate") {
    return (
      <span
        className="text-[10px] text-slate-500 dark:text-slate-300 font-mono"
        title={uri || undefined}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      className={
        uri
          ? "inline-flex items-baseline gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
          : "inline-flex items-baseline rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] italic text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }
      title={uri || "free-text (no ontology URI)"}
    >
      <span>{label}</span>
      {uri ? (
        // CURIE rendered via the modular ``CurieLink`` so clicks open
        // the inline term-detail popover (Gemma / OLS). Per Paul
        // 2026-06-13. The popover stops click bubbling so the
        // surrounding card doesn't react.
        <CurieLink
          uri={uri}
          className="text-[9px] font-mono text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-900 dark:hover:text-emerald-100 bg-transparent border-0 p-0 cursor-pointer no-underline hover:underline"
        />
      ) : null}
    </span>
  );
};

/** A factor side — what the column header reads + the factor it points
 *  at. Either side may be null (e.g. an extra finding has no baseline
 *  factor; a miss finding has no comparator). */
export interface FactorSide {
  /** Column header label — "Polished Gemma" / "Agent" / "Cyan" / "Preboard". */
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
// can also render the chain. Paul flagged a tag card that promised
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

/** Find the factor inside a curation's design that the finding is
 *  pointing at. When the curation is the one whose factors the
 *  finding's index was originally computed against (consensus
 *  polished for the gold side; agent_proposal for the agent side),
 *  the index is authoritative. Otherwise we match by category URI
 *  first, then by case-insensitive label, returning null when no
 *  factor in that curation lines up — the card renders the side as
 *  empty so the curator sees "(not in <source>)".
 *
 *  Multi-factor-same-category disambiguation: when more than one
 *  candidate factor in the curation matches by category, we score
 *  each candidate by FV-subject-URI Jaccard overlap with the
 *  owning factor (the finding's anchor) and pick the highest
 *  scorer. GSE93824 has two `genotype` factors in live (C5aR1 KO
 *  + hAPP transgene); a naive first-match would render the wrong
 *  one. The BaselineDriftSection surfaces the runner-up factors
 *  separately so neither gets silently dropped. */
function findFactorInCuration(
  curation: CurationRow | null,
  category: { uri: string | null; label: string | null } | null,
  preferIndex: number | null,
  indexIsAuthoritative: boolean,
  anchor: Factor | FactorProposal | null = null,
): Factor | null {
  if (!curation) return null;
  const design = curation.design as { factors?: Factor[] } | undefined;
  const factors = design?.factors;
  if (!Array.isArray(factors) || factors.length === 0) return null;
  if (
    indexIsAuthoritative &&
    preferIndex != null &&
    preferIndex >= 0 &&
    factors[preferIndex]
  ) {
    return factors[preferIndex];
  }
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
   *  card surfaces a simpler "Remove / Keep" pair instead — Paul
   *  2026-06-14: drift cards still need an action affordance ("the
   *  option to simply remove it should be there"). */
  readOnly?: boolean;
  /** Drift-card action: remove the displayed factor from the design
   *  draft. Renders a "Remove" button alongside Keep when set. */
  onRemoveFactor?: () => void;
  /** Drift-card action: keep the displayed factor as-is and hide
   *  this card. Renders a "Keep" button alongside Remove when set. */
  onKeepFactor?: () => void;
}

/** The card itself. Pulls baseline (Polished Gemma) from the design and
 *  comparator (agent) from the comparison_proposal, then renders the
 *  side-by-side layout. */
export function ComparisonFactorCard({
  finding,
  title,
  leftLabel: leftLabelProp,
  rightLabel: rightLabelProp,
  baselineSource,
  comparatorSource,
  leftFactorOverride,
  rightFactorOverride,
  readOnly: readOnlyProp,
  onRemoveFactor,
  onKeepFactor,
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
  // the top of the sidebar reaches these cards too. Per Paul
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

  const dispo = dispositionByTarget.get(finding.target_id) ?? null;
  const status = dispo?.status ?? "pending";

  // Resolve the OWNING factors first — the consensus-polished factor
  // at gold_target_index and the agent_proposal factor at
  // agent_target_index. These are always reachable regardless of
  // chip-strip selection; their categories give us the URI/label
  // hint to find the same factor in any non-owning curation the
  // user picks.
  // Resolve the owning gold curation. Preference order:
  //   1. ``finding.gold_curation_id`` — the canonical handle bro 1
  //      ships post-2026-06-14. Routes through ``resolveCuration``'s
  //      direct curation_id lookup (same as a chip-strip selection).
  //   2. First-consensus fallback — the pre-2026-06-14 behaviour, kept
  //      so old calibration packages that don't carry the new field
  //      still render. Per
  //      ``handoffs/GOLD_CURATION_ID_LANDED_2026_06_14.md``.
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
    const ix = finding.gold_target_index;
    if (ix == null) return null;
    const fromCuration =
      (owningGoldCuration?.design as { factors?: Factor[] } | undefined)
        ?.factors ?? null;
    return fromCuration?.[ix] ?? design?.factors?.[ix] ?? null;
  }, [owningGoldCuration, design, finding.gold_target_index]);

  // Bro 1's caveat: the agent stamps the consensus ROW it identified
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

  // Category hint for non-owning curations. Prefer the gold side
  // (URI-grounded against the polished consensus), fall back to the
  // agent side. Both sides may be null on findings that don't carry
  // a paired factor.
  const findingCategory = useMemo(() => {
    const gc = owningGoldFactor?.category;
    if (gc && (gc.label || gc.uri)) {
      return { label: gc.label ?? null, uri: gc.uri ?? null };
    }
    const ac = owningAgentFactor?.category;
    if (ac && (ac.label || ac.uri)) {
      return { label: ac.label ?? null, uri: ac.uri ?? null };
    }
    return null;
  }, [owningGoldFactor, owningAgentFactor]);

  // LEFT = baseline. When baselineSource is set, route through the
  // unified /curations list — that's what the chip strip selected.
  // When absent (legacy callers), fall back to the live design at
  // the finding's gold_target_index (pre-step-3b behaviour).
  // Explicit override (synthetic drift cards) wins over both.
  const leftFactor: Factor | null = useMemo(() => {
    if (leftFactorOverride !== undefined) return leftFactorOverride;
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
        findingCategory,
        finding.gold_target_index ?? null,
        indexIsAuth,
        owningGoldFactor,
      );
    }
    return owningGoldFactor;
  }, [
    leftFactorOverride,
    baselineSource,
    curations,
    findingCategory,
    finding.gold_target_index,
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

  const leftCategory = leftFactor
    ? {
        label: leftFactor.category?.label ?? null,
        uri: leftFactor.category?.uri ?? null,
      }
    : null;
  const rightCategory = rightFactor
    ? {
        label: rightFactor.category?.label ?? null,
        uri: rightFactor.category?.uri ?? null,
      }
    : null;

  // Would clicking Merge actually change the gold factor? True iff at
  // least one agent FV (paired by biomaterial set) carries a statement
  // that's not already in its gold counterpart by S-P-O signature.
  // Drives the Merge button's visibility — Paul 2026-06-14: "if there
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
  // when present (bro's 2026-06-12 alignment ship), fall through to the
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

  // /curations is slow (~10s in Paul's GSE93824 walkthrough — server-
  // side bottleneck, see UIB perf handoff 2026-06-11). When it's still
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
  // label, em-dash, then the per-issue subject. Per Paul 2026-06-12:
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
  // gold, not the row they're viewing. Paul 2026-06-14.
  const isMatchFindingCode =
    isExactFactorMatch(finding) ||
    isCloseFactorMatch(finding) ||
    finding.issue_code === "calibration_match";
  const matchedButMissingFromBaseline =
    isMatchFindingCode && !leftFactor && !!rightFactor;
  const matchBadge = matchedButMissingFromBaseline ? null : (
    <MatchBadge finding={finding} />
  );
  const derivedTitle =
    title ?? (
      <span className="inline-flex items-baseline gap-1.5 min-w-0">
        {/* MatchBadge returns null for non-match codes; fall back to
            SeverityBadge with the action glyph (Δ / + / − / etc.) so
            partition_mismatch and extra / gold_only_miss cards still
            get a left-edge glyph. */}
        {matchBadge ?? (
          <SeverityBadge
            severity={displaySeverity(finding)}
            glyph={findingActionGlyph(finding)}
          />
        )}
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {findingActionLabel(finding)}
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
      // than the parked one. Paul 2026-06-12: "after merge the card
      // should be resolved (or any other disposition)".
      const resolvedExtras =
        next === "accepted"
          ? { ...extras, resolvedAt: new Date().toISOString() }
          : extras;
      await setDisposition(finding.target_id, next, resolvedExtras);
    } finally {
      setBusy(false);
    }
  }

  // Near-match accept actually mutates the draft — overwrite the
  // gold factor's category + per-FV labels / statements with the
  // agent's version while preserving the partition (biomaterial
  // assignments) and factor id. Paul 2026-06-12 ("as it stands,
  // accept doesn't do anything") — the disposition PATCH on its
  // own was a no-op for the curator's visible state. Other issue
  // codes (rename / extra / miss) keep the existing PATCH-only
  // path; their structural applies live elsewhere.
  const isNearMatch =
    finding.issue_code === "calibration_factor_match_near";

  async function dispatchNearMatchMerge(): Promise<void> {
    // Curator's "+ Merge" — take the union of both sides' per-FV
    // statements (dedupe by full S-P-O signature). Motivating case
    // (Paul 2026-06-12): gold had per-drug doses, agent had per-
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
    setBusy(true);
    try {
      applyDraft((d) => mergeNearMatchAgentFactor(d, agentFactor));
      // Focus the merged factor in the design tab so the curator
      // sees the new statements on the FVs without hunting. Same
      // intent as the Agree-add path on calibration_factor_extra.
      requestAuditFocus(
        experimentId,
        factorTarget(agentFactor.category.label),
      );
      await setDisposition(finding.target_id, "accepted", {
        resolvedAt: new Date().toISOString(),
      });
      toast.show(
        "Merged the agent's statements into the existing factor.",
        "success",
        3000,
      );
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
    // /design store. Per Paul 2026-06-12.
    const agentFactor = rightFactor as FactorProposal | null;
    if (!agentFactor) {
      toast.show(
        "Couldn't adopt the alternative — agent factor unresolved.",
        "danger",
        4000,
      );
      return;
    }
    setBusy(true);
    try {
      applyDraft((d) => adoptNearMatchAgentFactor(d, agentFactor));
      requestAuditFocus(
        experimentId,
        factorTarget(agentFactor.category.label),
      );
      await setDisposition(finding.target_id, "accepted", {
        resolvedAt: new Date().toISOString(),
      });
      toast.show("Adopted the agent's alternative.", "success", 3000);
    } finally {
      setBusy(false);
    }
  }

  // Action labels follow the action shape. Paul 2026-06-14:
  // "It would be 'Proposal is better' 'Keep'." Default match /
  // near-match cards read with that pair so the curator's choice
  // names the OUTCOME, not the meta-stance. Code-specific verbs
  // (Add factor / Remove factor / Adopt rename) stay for the
  // structural-action codes.
  const acceptLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Adopt rename"
      : finding.issue_code === "calibration_factor_extra"
        ? "Add factor"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Remove factor"
          : "Proposal is better";
  const dismissLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Keep current"
      : finding.issue_code === "calibration_factor_extra"
        ? "Don't add"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Keep current"
          : "Keep";

  // Dispositioned cards (accepted / dismissed / parked) recede the
  // same way ``CompactFindingCard`` does — opacity-40 with a hover
  // restore — so they sit quietly in the list and the curator's eye
  // lands on the still-open ones. Paul 2026-06-12: "it says
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
          {/* Per-finding judge chain — defender + arbiter + boss
              when each tier has rationale to show. JudgeChain itself
              suppresses when ALL three tiers are empty so old packages
              render identically. Per
              ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``. */}
          <JudgeChain finding={finding} report={report} />
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
            leftHeader={{ label: leftLabel, category: leftCategory }}
            rightHeader={{ label: rightLabel, category: rightCategory }}
            pairs={pairs}
            termRenderer={Term}
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
          {finding.proposer_defense ? (
            <div className="text-[11px] text-slate-600 dark:text-slate-300 italic">
              <span className="font-semibold not-italic text-slate-700 dark:text-slate-200">
                Agent says:{" "}
              </span>
              {finding.proposer_defense}
            </div>
          ) : null}
          {readOnly && (onRemoveFactor || onKeepFactor) ? (
            // Drift-card action bar — surfaces Remove / Keep so the
            // curator can act on factors the audit didn't see, instead
            // of getting a read-only "FACTORS THE AUDIT DIDN'T SEE"
            // panel that just stares back. Paul 2026-06-14.
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
            // (Paul 2026-06-12: "others don't say 'accepted' — I don't
            // think we need that") — just a tiny undo link so a
            // misclick is reversible. Dispatches ``pending`` so the
            // card returns to the action row; the earlier
            // ``needs_more_info`` dispatch 422'd because that status
            // requires a ``not_sure_reason`` (Paul 2026-06-14).
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
                  isNearMatch
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
                  including the "agent enriches a stub" case). Paul
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
              <button
                type="button"
                disabled={busy}
                onClick={() => dispatch("dismissed", { dismissReason: "wont_fix" })}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
              >
                {dismissLabel}
              </button>
              {/* Park button hidden 2026-06-14 (Paul: "hide the park
                  button — everywhere"). Handler stays wired; flip the
                  ``false`` gate to restore. Same pattern used in
                  findingCard / FindingDetailsEditor. */}
              {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
              {false ? (
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
        </>
      ) : null}
    </div>
  );
}
