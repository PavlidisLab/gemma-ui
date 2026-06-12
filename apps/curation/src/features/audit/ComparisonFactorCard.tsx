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
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";

import type {
  AuditFinding,
  AttachedDefenderVerdict,
  DismissReason,
} from "@/api/auditTypes";
import type { FactorProposal, FactorValueProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
import { useDesign } from "@/api/design";
import {
  useCurations,
  type CurationRow,
} from "@/features/comparison/useSourceAvailability";
import type { Source } from "@/features/comparison/sources";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import { shortenUri } from "@/lib/curie";

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

/** Each FV pair: an LEFT FV (baseline side) optionally paired with a
 *  RIGHT FV (comparator side). Either may be null when the partition
 *  doesn't align. */
interface PairedFv {
  left: Factor["factor_values"][number] | FactorValueProposal | null;
  right: Factor["factor_values"][number] | FactorValueProposal | null;
  /** Quick visual indicator: "same" (labels match), "drift" (labels
   *  differ), "left_only", "right_only". */
  status: "same" | "drift" | "left_only" | "right_only";
}

function fvLabel(
  fv: Factor["factor_values"][number] | FactorValueProposal | null,
): string {
  if (!fv) return "";
  return (fv.free_text_label || "").trim().toLowerCase();
}

function fvBms(
  fv: Factor["factor_values"][number] | FactorValueProposal | null,
): Set<string> {
  if (!fv) return new Set();
  return new Set(fv.biomaterial_short_names ?? []);
}

/** Pair FVs across baseline + comparator factors. Strategy:
 *  1. Bijective match by biomaterial-set overlap (Jaccard ≥ 0.5).
 *  2. Any unmatched on either side render as left_only / right_only. */
function pairFvs(
  leftFactor: FactorSide["factor"],
  rightFactor: FactorSide["factor"],
): PairedFv[] {
  const leftFvs = leftFactor?.factor_values ?? [];
  const rightFvs = rightFactor?.factor_values ?? [];
  const claimedRight = new Set<number>();
  const pairs: PairedFv[] = [];
  for (const l of leftFvs) {
    const lBms = fvBms(l);
    let bestIx = -1;
    let bestJ = 0;
    for (let ix = 0; ix < rightFvs.length; ix++) {
      if (claimedRight.has(ix)) continue;
      const rBms = fvBms(rightFvs[ix]);
      const inter = [...lBms].filter((b) => rBms.has(b)).length;
      const union = new Set([...lBms, ...rBms]).size;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJ) {
        bestJ = j;
        bestIx = ix;
      }
    }
    if (bestIx >= 0 && bestJ >= 0.5) {
      claimedRight.add(bestIx);
      const r = rightFvs[bestIx];
      const status =
        fvLabel(l) === fvLabel(r) && fvLabel(l) !== "" ? "same" : "drift";
      pairs.push({ left: l, right: r, status });
    } else {
      pairs.push({ left: l, right: null, status: "left_only" });
    }
  }
  for (let ix = 0; ix < rightFvs.length; ix++) {
    if (!claimedRight.has(ix)) {
      pairs.push({ left: null, right: rightFvs[ix], status: "right_only" });
    }
  }
  return pairs;
}

function statusGlyph(status: PairedFv["status"]): {
  ch: string;
  cls: string;
  title: string;
} {
  switch (status) {
    case "same":
      return { ch: "=", cls: "text-emerald-600 dark:text-emerald-400", title: "labels match" };
    case "drift":
      return { ch: "≈", cls: "text-amber-600 dark:text-amber-400", title: "paired by sample partition; labels differ" };
    case "left_only":
      return { ch: "−", cls: "text-amber-600 dark:text-amber-400", title: "baseline-only (no comparator counterpart)" };
    case "right_only":
      return { ch: "+", cls: "text-amber-600 dark:text-amber-400", title: "comparator-only (no baseline counterpart)" };
  }
}

/** Category chip pair — baseline category vs comparator category, with
 *  URI tags. Free-text categories (no URI) render with a "free-text"
 *  visual cue so the curator sees the agent skipped ontology grounding. */
function CategoryPair({
  leftLabel,
  leftCategory,
  rightLabel,
  rightCategory,
}: {
  leftLabel: string;
  leftCategory: { label: string | null; uri: string | null } | null;
  rightLabel: string;
  rightCategory: { label: string | null; uri: string | null } | null;
}) {
  const showCategoryRow = !!(leftCategory?.label || rightCategory?.label);
  if (!showCategoryRow) return null;
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 items-baseline text-[11px] py-1 px-1.5 rounded bg-slate-50/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
      <span className="text-[9px] uppercase tracking-wide text-slate-400">
        {leftLabel}
      </span>
      <span>
        {leftCategory?.label ? (
          <Term
            label={leftCategory.label}
            uri={leftCategory.uri ?? null}
          />
        ) : (
          <em className="text-slate-400">(no factor)</em>
        )}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-slate-400 pl-2 border-l border-slate-200 dark:border-slate-700">
        {rightLabel}
      </span>
      <span>
        {rightCategory?.label ? (
          <Term
            label={rightCategory.label}
            uri={rightCategory.uri ?? null}
          />
        ) : (
          <em className="text-slate-400">(no factor)</em>
        )}
      </span>
    </div>
  );
}

/** Per-FV side-by-side row. One row per paired (left, right) FV. */
function FvPairRow({ pair }: { pair: PairedFv }) {
  const g = statusGlyph(pair.status);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-baseline text-[11px] px-1.5 py-1 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
      <div className="min-w-0">
        {pair.left ? (
          <FvDisplayRow fv={pair.left} termRenderer={Term} />
        ) : (
          <em className="text-slate-400">(no FV)</em>
        )}
      </div>
      <span
        className={`${g.cls} text-center select-none`}
        title={g.title}
        aria-label={pair.status}
      >
        {g.ch}
      </span>
      <div className="min-w-0">
        {pair.right ? (
          <FvDisplayRow fv={pair.right} termRenderer={Term} />
        ) : (
          <em className="text-slate-400">(no FV)</em>
        )}
      </div>
    </div>
  );
}

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
  readOnly,
}: ComparisonFactorCardProps) {
  const { report, experimentId, setDisposition, dispositionByTarget } =
    useAudit();
  const { data: design } = useDesign(experimentId);
  const curationsQuery = useCurations(experimentId);
  const curations = curationsQuery.data ?? [];
  const [busy, setBusy] = useState(false);
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

  const pairs = useMemo(
    () => pairFvs(leftFactor, rightFactor),
    [leftFactor, rightFactor],
  );

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

  // Default title: "Rename `left.category` → `right.category`" for
  // rename, generic verb-tagged for other codes (callers can override).
  const derivedTitle =
    title ??
    (finding.issue_code === "calibration_factor_rename"
      ? (
          <span className="text-[12px] font-semibold">
            Rename factor: <span className="font-mono">{ph(leftCategory?.label)}</span>
            <span className="text-slate-400"> → </span>
            <span className="font-mono">{ph(rightCategory?.label)}</span>
          </span>
        )
      : finding.issue_code === "calibration_factor_match_near"
        ? (
            <span className="text-[12px] font-semibold">
              Partition mismatch: <span className="font-mono">{ph(leftCategory?.label)}</span>
              <span className="text-slate-400 font-normal text-[11px] ml-1">
                ({rightFactor?.factor_values?.length ?? (factorsAreLoading ? "…" : "?")} vs {leftFactor?.factor_values?.length ?? (factorsAreLoading ? "…" : "?")} levels)
              </span>
            </span>
          )
      : finding.issue_code === "calibration_factor_extra"
        ? (
            <span className="text-[12px] font-semibold">
              Add factor: <span className="font-mono">{ph(rightCategory?.label)}</span>
            </span>
          )
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? (
              <span className="text-[12px] font-semibold">
                Remove factor: <span className="font-mono">{ph(leftCategory?.label)}</span>
              </span>
            )
          : (
              <span className="text-[12px] font-semibold">
                {(leftCategory?.label || rightCategory?.label) ?? (factorsAreLoading ? skeleton : "(factor)")}
              </span>
            ));

  async function dispatch(
    next: "accepted" | "dismissed" | "needs_more_info",
    extras?: { dismissReason?: DismissReason; notes?: string },
  ) {
    setBusy(true);
    try {
      await setDisposition(finding.target_id, next, extras);
    } finally {
      setBusy(false);
    }
  }

  // Action labels follow the action shape — for renames, accept =
  // "adopt rename" (curator takes the agent's category), dismiss =
  // "keep current". Modularizable per issue_code.
  const acceptLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Adopt rename"
      : finding.issue_code === "calibration_factor_extra"
        ? "Add factor"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Remove factor"
          : "Accept";
  const dismissLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Keep current"
      : finding.issue_code === "calibration_factor_extra"
        ? "Don't add"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Keep current"
          : "Dismiss";

  const sevPalette =
    status === "accepted"
      ? "border-emerald-400/70 bg-emerald-50/30 dark:bg-emerald-900/10"
      : status === "dismissed"
        ? "border-slate-400/70 bg-slate-50/30 dark:bg-slate-900/10 opacity-70"
        : finding.severity === "ok"
          ? "border-emerald-300/70 bg-white dark:border-emerald-700/40 dark:bg-slate-900/40"
          : finding.severity === "major" || finding.severity === "blocker"
            ? "border-amber-300/70 bg-amber-50/30 dark:border-amber-700/60 dark:bg-amber-900/10"
            : "border-slate-300/70 bg-white dark:border-slate-700 dark:bg-slate-900/40";

  return (
    <div className={`rounded border ${sevPalette} px-2.5 py-2 space-y-2`}>
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
        <span className="text-[9px] uppercase tracking-wide text-slate-400 ml-auto">
          {status === "pending" ? "open" : status}
        </span>
      </div>
      {cardOpen ? (
        <>
          <JudgeRow verdict={finding.defender_verdict ?? null} />
          <CategoryPair
            leftLabel={leftLabel}
            leftCategory={leftCategory}
            rightLabel={rightLabel}
            rightCategory={rightCategory}
          />
          {pairs.length > 0 ? (
            <div className="rounded border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 px-1.5 py-1 border-b border-slate-200 dark:border-slate-700 text-[9px] uppercase tracking-wide text-slate-400">
                <span>{leftLabel}</span>
                <span>&nbsp;</span>
                <span>{rightLabel}</span>
              </div>
              {pairs.map((p, i) => (
                <FvPairRow key={i} pair={p} />
              ))}
            </div>
          ) : null}
          {finding.proposer_defense ? (
            <div className="text-[11px] text-slate-600 dark:text-slate-300 italic">
              <span className="font-semibold not-italic text-slate-700 dark:text-slate-200">
                Agent says:{" "}
              </span>
              {finding.proposer_defense}
            </div>
          ) : null}
          {readOnly ? null : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => dispatch("accepted")}
                className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {acceptLabel}
              </button>
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
