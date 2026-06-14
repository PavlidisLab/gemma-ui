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
  ArbiterVerdict,
  AuditFinding,
  AuditReport,
  AttachedDefenderVerdict,
  BossPassVerdict,
  DismissReason,
} from "@/api/auditTypes";
import {
  findArbiterForFinding,
  findBossForFinding,
} from "@/api/pipelineCommentary";
import type { FactorProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
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
import { shortenUri } from "@/lib/curie";
import {
  FactorComparisonGrid,
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
        // Render the URI as a proper CURIE ("EFO:0000513") via the
        // shared ``shortenUri`` helper, mirroring the convention used
        // everywhere else in the audit + design surfaces. The previous
        // bare last-segment split produced the underscore form
        // ("EFO_0000513") which read as a malformed ID. Per Paul
        // 2026-06-12.
        <span className="text-[9px] font-mono text-emerald-700/70 dark:text-emerald-300/70">
          {shortenUri(uri)}
        </span>
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

function JudgeRow({
  verdict,
}: {
  verdict: AttachedDefenderVerdict | null;
}) {
  if (!verdict || !verdict.rationale?.trim()) return null;
  const sidePalette =
    verdict.side === "boss"
      ? "border-purple-300/70 bg-purple-50/60 text-purple-900 dark:border-purple-700/60 dark:bg-purple-900/15 dark:text-purple-100"
      : "border-blue-300/70 bg-blue-50/60 text-blue-900 dark:border-blue-700/60 dark:bg-blue-900/15 dark:text-blue-100";
  return (
    <div className={`rounded border px-2 py-1 text-[11px] leading-snug ${sidePalette}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold uppercase tracking-wide text-[9px]">
          {verdict.side}
        </span>
        <span className="font-mono text-[10px]">{verdict.verdict}</span>
        {verdict.confidence ? (
          <span className="text-[9px] opacity-70">
            · {verdict.confidence}
          </span>
        ) : null}
      </div>
      <div className="italic opacity-90 mt-0.5">{verdict.rationale}</div>
    </div>
  );
}

/** Per-finding judge chain: defender → arbiter → boss. Renders up to
 *  three stacked tiers, one per producer, each as a coloured tile
 *  with its verdict label + rationale prose.
 *
 *  Lookup: ``defender_verdict`` rides on the finding directly
 *  (existing wire field). ``arbiter`` / ``boss`` rows are looked up
 *  in ``report.evidence.arbiter_verdicts`` /
 *  ``report.evidence.boss_verdicts`` by the targeting tuple
 *  ``(target_kind, side, target_category, target_value)`` — see
 *  ``findArbiterForFinding`` / ``findBossForFinding``.
 *
 *  Old packages (no arbiter / boss rows) render identically to the
 *  pre-2026-06-13 single-defender ``JudgeRow``. Per
 *  ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``. */
function JudgeChain({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}): JSX.Element | null {
  const defender = finding.defender_verdict ?? null;
  const arbiter = findArbiterForFinding(report, finding);
  const boss = findBossForFinding(report, finding);
  const anyContent =
    (defender && defender.rationale?.trim()) ||
    (arbiter && arbiter.rationale?.trim()) ||
    (boss && (boss.rationale?.trim() || boss.arbiter_rationale?.trim()));
  if (!anyContent) return null;
  return (
    <div className="space-y-1">
      <JudgeRow verdict={defender} />
      <ArbiterTile arbiter={arbiter} />
      <BossTile boss={boss} />
    </div>
  );
}

/** Arbiter tier — emerald palette to visually distinguish from the
 *  defender's blue and the boss's purple. Same layout shape as
 *  ``JudgeRow`` so the chain reads as one coherent stack. */
function ArbiterTile({
  arbiter,
}: {
  arbiter: ArbiterVerdict | null;
}): JSX.Element | null {
  if (!arbiter || !arbiter.rationale?.trim()) return null;
  return (
    <div className="rounded border px-2 py-1 text-[11px] leading-snug border-emerald-300/70 bg-emerald-50/60 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-900/15 dark:text-emerald-100">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-semibold uppercase tracking-wide text-[9px]">
          arbiter
        </span>
        <span className="font-mono text-[10px]">{arbiter.verdict}</span>
        {arbiter.mode ? (
          <span className="text-[9px] opacity-70">· {arbiter.mode}</span>
        ) : null}
        {arbiter.confidence ? (
          <span className="text-[9px] opacity-70">
            · {arbiter.confidence}
          </span>
        ) : null}
      </div>
      <div className="italic opacity-90 mt-0.5">{arbiter.rationale}</div>
    </div>
  );
}

/** Boss tier — purple palette (matches the existing boss-side
 *  treatment in ``JudgeRow``). Carries ``arbiter_rationale`` as a
 *  quoted "prior call" subline so the curator can see the boss's
 *  view of the arbiter's call without cross-indexing the arbiter
 *  tile above. */
function BossTile({
  boss,
}: {
  boss: BossPassVerdict | null;
}): JSX.Element | null {
  if (!boss || (!boss.rationale?.trim() && !boss.arbiter_rationale?.trim())) {
    return null;
  }
  return (
    <div className="rounded border px-2 py-1 text-[11px] leading-snug border-purple-300/70 bg-purple-50/60 text-purple-900 dark:border-purple-700/60 dark:bg-purple-900/15 dark:text-purple-100">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-semibold uppercase tracking-wide text-[9px]">
          boss
        </span>
        <span className="font-mono text-[10px]">{boss.verdict}</span>
        {boss.mode ? (
          <span className="text-[9px] opacity-70">· {boss.mode}</span>
        ) : null}
        {boss.confidence ? (
          <span className="text-[9px] opacity-70">· {boss.confidence}</span>
        ) : null}
      </div>
      {boss.arbiter_rationale?.trim() ? (
        <div className="text-[10px] opacity-75 mt-0.5">
          <span className="font-semibold">Prior arbiter: </span>
          <span className="italic">{boss.arbiter_rationale}</span>
        </div>
      ) : null}
      {boss.rationale?.trim() ? (
        <div className="italic opacity-90 mt-0.5">{boss.rationale}</div>
      ) : null}
    </div>
  );
}

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
   *  disposition against, so action buttons would be a dead end. */
  readOnly?: boolean;
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
  const owningGoldFactor: Factor | null = useMemo(() => {
    const ix = finding.gold_target_index;
    if (ix == null) return null;
    const consensus = curations.find((c) => c.source_kind === "consensus");
    const fromCuration = consensus
      ? ((consensus.design as { factors?: Factor[] } | undefined)?.factors ?? null)
      : null;
    return fromCuration?.[ix] ?? design?.factors?.[ix] ?? null;
  }, [curations, design, finding.gold_target_index]);

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
  const matchBadge = <MatchBadge finding={finding} />;
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
        <span className="text-slate-400 dark:text-slate-500">—</span>
        <span className="text-[12px] font-semibold min-w-0 truncate">
          {subjectNode}
        </span>
      </span>
    );

  async function dispatch(
    next: "accepted" | "dismissed" | "needs_more_info",
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
      await setDisposition(finding.target_id, "accepted", {
        resolvedAt: new Date().toISOString(),
      });
      toast.show("Adopted the agent's alternative.", "success", 3000);
    } finally {
      setBusy(false);
    }
  }

  // Action labels follow the action shape — for renames, accept =
  // "adopt rename" (curator takes the agent's category), dismiss =
  // "keep current". Modularizable per issue_code. Near-match reads
  // "Alt is better" / "Keep" per Paul 2026-06-12 — the agent's
  // alt isn't a category swap (rename) or a structural add/remove,
  // it's "the agent's variant of the same factor is better than
  // gold's", which the labels make explicit.
  const acceptLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Adopt rename"
      : finding.issue_code === "calibration_factor_extra"
        ? "Add factor"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Remove factor"
          : isNearMatch
            ? "Alt is better"
            : "Accept";
  const dismissLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Keep current"
      : finding.issue_code === "calibration_factor_extra"
        ? "Don't add"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Keep current"
          : isNearMatch
            ? "Keep"
            : "Dismiss";

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
          />
          {finding.proposer_defense ? (
            <div className="text-[11px] text-slate-600 dark:text-slate-300 italic">
              <span className="font-semibold not-italic text-slate-700 dark:text-slate-200">
                Agent says:{" "}
              </span>
              {finding.proposer_defense}
            </div>
          ) : null}
          {readOnly ? null : status !== "pending" ? (
            // Dispositioned — opacity-40 fade on the wrapper is the
            // visual cue (matches CompactFindingCard). No status pill
            // (Paul 2026-06-12: "others don't say 'accepted' — I don't
            // think we need that") — just a tiny undo link so a
            // misclick is reversible.
            <button
              type="button"
              disabled={busy}
              onClick={() => dispatch("needs_more_info")}
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
              {isNearMatch ? (
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
              <button
                type="button"
                disabled={busy}
                onClick={() => dispatch("needs_more_info")}
                className="text-[11px] px-2 py-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Park
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
