/**
 * Findings-list orchestration — the body of the audit sidebar that
 * sits below the SidebarHeader. Owns the sort + suppression + grouping
 * logic, the summary header that frames the list, the synthetic
 * baseline-drift cards (for factors the chip-strip baseline carries
 * that the audit didn't score against), and the per-section render.
 *
 * Extracted from `AuditSidebarPanel.tsx` (design review 2026-06-10 mega-file
 * sweep). The card render itself lives in `./findingCard.tsx`; the
 * per-finding embed views in `./findingEmbeds.tsx`; this file is just
 * "given a list of findings, organise + render".
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HelpPopup } from "@/components/ui/HelpPopup";
import { deleteFactor } from "@/features/design/mutations";
import type {
  AuditFinding,
  AuditReport,
  AuditScope,
  AuditTargetKind,
  CurationReviewKind,
} from "@/api/auditTypes";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
import { useFlow } from "@/features/comparison/FlowContext";
import { useChipState } from "@/features/comparison/useChipState";
import {
  useCurations,
  type CurationRow,
} from "@/features/comparison/useSourceAvailability";
import { sourceLabel, type Source } from "@/features/comparison/sources";
import { resolveCuration } from "@/features/comparison/resolveCuration";
import { SEVERITY_RANK, TARGET_KIND_ORDER } from "./auditPresentation";
import { parseTargetId, slug } from "./targetIds";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { isMatchFinding, isRenameMatch } from "./findingHelpers";
import { resolveApplyAction } from "./applyHandlers";
import { CompactFindingCard } from "./findingCard";
import { ComparisonFactorCard } from "./ComparisonFactorCard";
import { OrientationProse } from "@/components/ui/OrientationProse";
import {
  readCommentaryString,
  readEscalationRequests,
} from "@/api/pipelineCommentary";
import { EscalationBanner } from "./EscalationBanner";
import { BossReviewPanel } from "./BossReviewPanel";
import { BossReviewSection } from "./BossAnnotation";
import {
  bossMatchesFinding,
  bossSectionKind,
  groupBossReviews,
  type GroupedBossReview,
} from "./bossCriticGrouping";
import { PipelineAuditTrail } from "./PipelineAuditTrail";

// ---------------------------------------------------------------------------
// Audit-panel baseline framing — exported so the regression test in
// ``findingListBaselineLabel.test.ts`` can lock the contract.
// ---------------------------------------------------------------------------

/** Header label rendered next to the LEFT (baseline) factor chip on
 *  every comparison card inside the audit/findings panel. Hardcoded
 *  to ``"Current"`` regardless of what the chip strip's baseline
 *  source happens to be (live / polished:curator-b / preboard / opaque
 *  curation_id). Per design review 2026-06-15: "should be just 'current'
 *  EVERYWHERE in the panel." Do NOT replace with a dynamic source
 *  label — the chip strip itself surfaces the real source. */
export const AUDIT_PANEL_BASELINE_LABEL = "Current";

/**
 * Should the "Factors the audit didn't see" (BaselineDriftSection) render?
 *
 * Only when the audit's scope actually covered factors. A tags-only audit
 * (scope.include = ["tags"]) deliberately never looked at factors, so every
 * current factor would otherwise surface as phantom "drift" (ticket 152: a
 * lone `cell type` factor shown alongside the single dev-stage tag under
 * review). An absent or empty scope means "all" → keep the section.
 */
export function auditCoversFactors(scope?: AuditScope | null): boolean {
  const inc = scope?.include;
  return !inc || inc.length === 0 || inc.includes("factors");
}

/**
 * Symmetric mirror of {@link auditCoversFactors} for tags.
 *
 * NOT EXERCISED AS OF NOW: there is currently no "Tags the audit didn't see"
 * drift section — the drift concept (surfacing current-design items the audit
 * produced no finding for) exists only for factors (BaselineDriftSection).
 * Tags otherwise render purely from findings, and empty finding-groups already
 * auto-hide, so a factor-scoped audit surfaces no phantom tags today.
 *
 * This exists so that IF a tag-drift section is ever added, it gates on scope
 * from day one (a factor-only audit, scope.include = ["factors"], must not
 * surface every current tag as phantom drift — the mirror of the ticket-152
 * bug). Wire it into that section's render condition when it lands.
 */
export function auditCoversTags(scope?: AuditScope | null): boolean {
  const inc = scope?.include;
  return !inc || inc.length === 0 || inc.includes("tags");
}

// ---------------------------------------------------------------------------
// Section header — shared className for the per-kind dividers
// ---------------------------------------------------------------------------

/** Section-header className shared by every "Tags / Characteristics /
 *  Design — factors / Alternate factor / Confirmed matches / Factors
 *  the audit didn't see" header inside FindingList. Reads as an
 *  actual heading (12px, slate-700 bold, bottom border) rather than
 *  the earlier 10px low-contrast caption that was smaller than the
 *  card bodies it labelled. */
const SECTION_HEADER_CLS =
  "text-xs uppercase tracking-wider font-bold text-slate-700 dark:text-slate-200 px-1 pt-2 pb-1 border-b border-slate-200 dark:border-slate-700 mb-1";

/** Per-section `?` help — what the section is, in plain terms. Only the
 *  two sections curators asked about (design review 2026-06-21); the rest read
 *  fine from their (renamed) titles. */
const SECTION_HELP: Partial<Record<AuditTargetKind, { title: string; body: ReactNode }>> = {
  factor: {
    title: "Experimental factors",
    body: (
      <div className="space-y-1.5 leading-snug">
        <p>
          The variables the study deliberately varies across samples —
          genotype, treatment, time point, dose, sex, and so on. Each
          factor has <em>factor values</em> (its levels); every profiled
          sample is assigned one, and differential expression contrasts
          the levels against a baseline.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          This section compares the proposed factors against the current
          curation.
        </p>
      </div>
    ),
  },
  tag: {
    title: "Experiment tags",
    body: (
      <div className="space-y-1.5 leading-snug">
        <p>
          Experiment-level properties that hold for EVERY profiled sample
          (e.g. a disease model, or an organism part when it's constant
          across the study) — not what the study is "about". Tags fill
          gaps the factor values and biomaterial characteristics don't
          already cover; a tag that just restates a constant
          characteristic the loader already ingests is redundant.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          This section compares the proposed tags against the current
          curation.
        </p>
      </div>
    ),
  },
};

// ---------------------------------------------------------------------------
// Consequent-pair reordering — keep `consequent_of` siblings adjacent
// ---------------------------------------------------------------------------

/** Re-arrange findings so each absorbed `_gold_only_miss` (carrying
 *  `consequent_of` pointing at an upstream `_partition_mismatch`) is
 *  slotted immediately after its upstream parent in the list.
 *  Preserves the input order for every other finding. Findings whose
 *  linked half isn't in the passed list stay where the input put them
 *  — the cross-link badges still surface the relationship, just
 *  without spatial pairing.
 *
 *  Per design review 2026-05-20: cards that read as one curator decision
 *  ("agent's split absorbs gold's timepoint factor") should sit next
 *  to each other, not separated by unrelated findings. */
function reorderConsequentPairs(items: AuditFinding[]): AuditFinding[] {
  if (items.length < 2) return items;
  // Map each upstream finding's target_id → list of absorbed children
  // present in this group. One upstream can absorb multiple downstreams
  // (rare today, but the schema allows it).
  const childrenByUpstream = new Map<string, AuditFinding[]>();
  const absorbedIds = new Set<string>();
  for (const f of items) {
    if (!f.consequent_of) continue;
    if (!items.some((p) => p.target_id === f.consequent_of)) continue;
    const list = childrenByUpstream.get(f.consequent_of) ?? [];
    list.push(f);
    childrenByUpstream.set(f.consequent_of, list);
    absorbedIds.add(f.target_id);
  }
  if (absorbedIds.size === 0) return items;
  const out: AuditFinding[] = [];
  for (const f of items) {
    if (absorbedIds.has(f.target_id)) continue;
    out.push(f);
    const children = childrenByUpstream.get(f.target_id);
    if (children) out.push(...children);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ReviewSummaryHeader — top-of-list framing + empty-state evidence crumb
// ---------------------------------------------------------------------------

/** Top-of-list summary the FindingList always renders, even when no
 *  finding cards would otherwise surface (everything triaged, only
 *  ok-severity notes, or nothing actionable to propose). Two framings:
 *
 *    • `kind="audit"` keeps the severity vocabulary the curator
 *      already triages against: `N findings — X applied, Y open, Z
 *      noted`. Severity counts continue to show on individual cards.
 *    • `kind="proposal"` collapses to disposition framing only.
 *      Severity isn't a proposal axis ("there is no major in
 *      proposals"); the curator's mental model here is "did the
 *      curator action this proposal yet" not "how broken is this
 *      gold".
 *
 *  When `nothingBelow` is true (every section would have rendered
 *  empty), the summary expands into a short empty-state block so the
 *  panel never feels blank. Design review 2026-05-25: "start with a summary
 *  and go from there." */
export function ReviewSummaryHeader({
  kind,
  totalFindings,
  nApplied,
  nOpenActionable,
  nNoted,
  modelName,
  evidence,
  nothingBelow,
}: {
  kind: CurationReviewKind;
  totalFindings: number;
  nApplied: number;
  nOpenActionable: number;
  nNoted: number;
  modelName: string | null;
  evidence: AuditReport["evidence"] | null;
  nothingBelow: boolean;
}) {
  const noun = kind === "proposal" ? "proposal" : "finding";
  const nounPlural = kind === "proposal" ? "proposals" : "findings";
  const parts: { count: number; label: string; tone: string }[] = [];
  if (nOpenActionable > 0) {
    parts.push({
      count: nOpenActionable,
      label: "open",
      tone: "text-amber-700 dark:text-amber-300",
    });
  }
  if (nApplied > 0) {
    parts.push({
      count: nApplied,
      label: kind === "proposal" ? "actioned" : "triaged",
      tone: "text-emerald-700 dark:text-emerald-300",
    });
  }
  if (nNoted > 0) {
    parts.push({
      count: nNoted,
      label: "noted",
      tone: "text-slate-500 dark:text-slate-400",
    });
  }
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5 text-[11px]">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-slate-700 dark:text-slate-200">
          <span className="font-semibold">{totalFindings}</span>{" "}
          {totalFindings === 1 ? noun : nounPlural}
        </span>
        {parts.length > 0 ? (
          <span className="text-slate-400 dark:text-slate-500">·</span>
        ) : null}
        {parts.map((p, i) => (
          <span key={p.label} className={p.tone}>
            {p.count} {p.label}
            {i < parts.length - 1 ? "," : ""}
          </span>
        ))}
      </div>
      {nothingBelow ? (
        <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          {nOpenActionable === 0 && nApplied > 0 ? (
            <span>
              Every actionable {noun} has been triaged. Submit the
              review when you're ready, or expand triaged cards above
              to revisit them.
            </span>
          ) : nOpenActionable === 0 && nApplied === 0 && nNoted > 0 ? (
            <span>
              {modelName ? (
                <code className="font-mono">{modelName}</code>
              ) : (
                "The agent"
              )}{" "}
              ran but had nothing actionable to{" "}
              {kind === "proposal" ? "propose" : "flag"} — every check
              passed. Expand below to see the agent's notes.
            </span>
          ) : (
            <span>
              {modelName ? (
                <code className="font-mono">{modelName}</code>
              ) : (
                "The agent"
              )}{" "}
              ran but didn't return anything to review.
            </span>
          )}
          {/* Light evidence breadcrumb so the curator can see WHAT
              the agent considered, even when there are no cards to
              act on. The reviewer: judgements/justifications should still
              show up in the empty state. */}
          {evidence ? <EmptyStateEvidenceCrumb evidence={evidence} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Short breadcrumb chip-list of what the agent looked at when the
 *  finding body is otherwise empty. Surfaces whether the agent had
 *  preboarding text, paper text, and / or a comparison_proposal —
 *  enough for the curator to gauge "did the agent actually look at
 *  the right material?" without us inlining the full text. Each chip
 *  carries the excerpt as a hover title for spot-checks. */
function EmptyStateEvidenceCrumb({
  evidence,
}: {
  evidence: AuditReport["evidence"];
}) {
  const chips: { label: string; title: string }[] = [];
  if (evidence.preboarding_excerpt) {
    chips.push({
      label: "preboarding",
      title: evidence.preboarding_excerpt.slice(0, 800),
    });
  }
  if (evidence.paper_excerpt) {
    const src = evidence.paper_source ? ` (${evidence.paper_source})` : "";
    chips.push({
      label: `paper${src}`,
      title: evidence.paper_excerpt.slice(0, 800),
    });
  }
  if (evidence.comparison_proposal) {
    const cp = evidence.comparison_proposal;
    const nFactors = cp.factors?.length ?? 0;
    const nTags = cp.tags?.length ?? 0;
    chips.push({
      label: `comparison: ${nFactors} factor${
        nFactors === 1 ? "" : "s"
      }, ${nTags} tag${nTags === 1 ? "" : "s"}`,
      title:
        "Silent comparison the agent ran against the current curation. " +
        "When the proposer + current curation already agree, no findings get emitted.",
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        agent considered
      </span>
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.title}
          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FindingList — the main body render
// ---------------------------------------------------------------------------

export function FindingList({ findings }: { findings: AuditFinding[] }) {
  const { kind, dispositionByTarget, report, experimentId } = useAudit();
  const { draft, saved } = useDesignDraft();

  // FV-shaped tag-finding suppression. Tags and factor values are
  // separate entity types in the schema — see
  // ``feedback_tags_vs_factors_distinct_entities`` in memory. The reviewer
  // 2026-06-14: the proposal-review sidebar was surfacing REMOVE TAG
  // cards for things like ``treatment: sorafenib`` / ``cell line:
  // MOLM-13`` — those are factor values, not tags. The agent /
  // upstream is sending tag-target findings whose (category, value)
  // slug pair matches a real FV in the design; hide those cards
  // since their underlying entity isn't a tag at all.
  //
  // Detection: for each tag-target finding, parse the target_id
  // (``tag:<cat-slug>/<val-slug>``) and look for a factor in the
  // design whose category slug matches AND has an FV whose label
  // slug matches the value slug. Read from the draft when available
  // (the curator's edits are the authoritative current state); fall
  // back to ``saved`` when the draft hasn't loaded yet.
  const fvShapedTagTargets = useMemo(() => {
    const design = draft ?? saved;
    if (!design) return new Set<string>();
    const out = new Set<string>();
    for (const factor of design.factors ?? []) {
      const factorCatSlug = slug(factor.category?.label || "");
      if (!factorCatSlug) continue;
      for (const fv of factor.factor_values ?? []) {
        const fvLabelSlug = slug(fv.free_text_label || "");
        if (!fvLabelSlug) continue;
        out.add(`tag:${factorCatSlug}/${fvLabelSlug}`);
        // Also fold each statement subject in — sometimes the
        // upstream "tag" is the FV's subject term (e.g. the gene /
        // drug behind the FV) rather than the FV's free-text label.
        for (const st of fv.statements ?? []) {
          const subjSlug = slug(st.subject?.label || "");
          if (subjSlug) out.add(`tag:${factorCatSlug}/${subjSlug}`);
          const objSlug = slug(st.object?.label || "");
          if (objSlug) out.add(`tag:${factorCatSlug}/${objSlug}`);
        }
      }
    }
    return out;
  }, [draft, saved]);

  const fvShapedTagFindings = useMemo(
    () =>
      findings.filter(
        (f) =>
          f.target_kind === "tag" && fvShapedTagTargets.has(f.target_id),
      ),
    [findings, fvShapedTagTargets],
  );
  // Chip-strip selection drives the ComparisonFactorCard's column
  // labels (LEFT = baseline source, RIGHT = comparator source). The
  // card doesn't know which curation lives on which side — the chip
  // strip does. Step 3b: labels resolve against the unified /curations
  // list when the source is an opaque curation_id; legacy literal IDs
  // (preboard / live / agent_proposal / polished:*) still resolve via
  // the enum-based fallback inside sourceLabel.
  const flow = useFlow();
  const chip = useChipState({ experimentId, flow });
  const curationsQuery = useCurations(experimentId);
  const curations = curationsQuery.data ?? [];
  // Audit/findings panel always frames the baseline as "Current" — the
  // curator's working state, regardless of which source the chip strip
  // resolved to (live / polished:curator-b / etc.). Per design review 2026-06-15:
  // "should be just 'current' EVERYWHERE in the panel." The chip strip
  // itself still surfaces the real source label.
  const baselineLabel = AUDIT_PANEL_BASELINE_LABEL;
  const comparatorLabel = sourceLabel(chip.comparator, curations);
  // Single flat list, sorted by severity then target_kind. The full
  // report view groups by target_kind (it has the room); in the narrow
  // sidebar a single severity-sorted list scans faster — most urgent
  // first, regardless of what they're about. Curator's attention should
  // land on blockers immediately.
  const sorted = useMemo(() => {
    const arr = findings.filter(
      (f) => !(f.target_kind === "tag" && fvShapedTagTargets.has(f.target_id)),
    );
    arr.sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return (
        TARGET_KIND_ORDER.indexOf(a.target_kind) -
        TARGET_KIND_ORDER.indexOf(b.target_kind)
      );
    });
    return arr;
  }, [findings, fvShapedTagTargets]);

  // FV-finding suppression. When the audit reports a non-ok finding at
  // the parent factor (forbidden_efc, vague_fv_labels, conflated,
  // wrong_fv_partition, etc.) the per-FV findings under that factor
  // typically just elaborate the same problem and clutter the sidebar.
  // Hide them by default and surface a single "show N FV-level
  // findings under flagged factors" toggle so a curator who wants the
  // per-FV detail can opt in.
  //
  // **Severity-aware:** an FV finding more severe than its parent
  // factor's worst finding still surfaces — a blocker on an FV
  // shouldn't disappear because the factor only has a minor flag.
  //
  // We key on the factor slug — both factor and fv target_ids carry
  // it (factor:<slug>, fv:<slug>/<fv-slug>) and the slug rule mirrors
  // the agent side exactly via parseTargetId.
  const suppression = useMemo(() => {
    // factorSlug → minRank (lower number = more severe; from
    // SEVERITY_RANK). Tracks the WORST severity among non-ok findings
    // on each factor.
    const factorWorstRank = new Map<string, number>();
    for (const f of sorted) {
      if (f.target_kind !== "factor" || f.severity === "ok") continue;
      const p = parseTargetId(f.target_id);
      if (p?.kind !== "factor") continue;
      const cur = factorWorstRank.get(p.factorSlug);
      const r = SEVERITY_RANK[f.severity];
      if (cur === undefined || r < cur) factorWorstRank.set(p.factorSlug, r);
    }
    return {
      factorWorstRank,
      /** True iff `f` is an FV finding under a flagged factor AND no
       *  more severe than that factor's worst finding (so the parent
       *  legitimately subsumes it). */
      isSubsumedByParentFactor(f: AuditFinding): boolean {
        if (f.target_kind !== "fv") return false;
        const p = parseTargetId(f.target_id);
        if (p?.kind !== "fv") return false;
        const parentRank = factorWorstRank.get(p.factorSlug);
        if (parentRank === undefined) return false;
        return SEVERITY_RANK[f.severity] >= parentRank;
      },
    };
  }, [sorted]);

  // Boss-critic routing index. Findings about an element already in the
  // design carry only its storage id (``factor:2``, ``tag:1``); the boss
  // feed always names the element (``fv:timepoint/2 h``). Index the
  // design so the router can bridge the two — without it every such
  // verdict misses its card and piles up in the unmatched block at the
  // section tail. Declared with the other hooks, above the
  // empty-findings early return.
  const bossRouteIndex = useMemo(() => {
    const design = draft ?? saved;
    const factorSlugById = new Map<number, string>();
    const tagSlugById = new Map<number, { cat: string; val: string }>();
    for (const f of design?.factors ?? []) {
      const label = f.category?.label || f.name || "";
      if (f.id != null && label) factorSlugById.set(f.id, slug(label));
    }
    for (const t of design?.tags ?? []) {
      const cat = t.category?.label || "";
      const val = t.value?.label || "";
      if (t.id != null && cat && val) {
        tagSlugById.set(t.id, { cat: slug(cat), val: slug(val) });
      }
    }
    return { factorSlugById, tagSlugById };
  }, [draft, saved]);

  // `severity=ok` doesn't always mean "no curator action" — a
  // calibration_gold_only_miss whose value is BM-covered (already
  // ontologized in a constant BM column) ships as `ok` but is still a
  // real "is this redundant tag still needed?" question. Anything with
  // a mutating apply_action gets promoted to the actionable bucket
  // regardless of severity.
  const isActionable = (f: AuditFinding): boolean => {
    if (isMatchFinding(f)) return false;
    // Rename / partition-mismatch findings ARE factor decisions — keep
    // them in the actionable bucket so they group under the
    // "Design — factors" section alongside other factor findings.
    // The renderer in the factor block below routes them through
    // ``ComparisonFactorCard`` instead of ``CompactFindingCard``. Per
    // Design review 2026-06-12: the old dedicated "Alternate factor" section
    // was visually orphaned from the regular factor decisions.
    if (isRenameMatch(f)) return true;
    if (f.severity !== "ok") return true;
    const a = resolveApplyAction(f);
    return !!a && a.mutates;
  };
  const actionable = sorted.filter(isActionable);
  // Match findings render as compact green-check rows, visible by
  // default — same affordance as exact-match factors in the
  // DesignComparisonPanel. Curator can still expand to disagree.
  const matches = sorted.filter(isMatchFinding);
  const okOnes = sorted.filter(
    (f) => f.severity === "ok" && !isMatchFinding(f) && !isActionable(f),
  );
  const visibleActionable = actionable.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const visibleOk = okOnes.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const visibleMatches = matches.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const [showOk, setShowOk] = useState(false);

  if (findings.length === 0) {
    return null;
  }

  // Group actionable findings by target_kind for visual clustering —
  // factor decisions read as one beat, tag decisions as another. The
  // groups preserve the severity sort within them. Empty groups don't
  // render their header.
  const groupedActionable = new Map<AuditTargetKind, AuditFinding[]>();
  for (const f of visibleActionable) {
    const arr = groupedActionable.get(f.target_kind) ?? [];
    arr.push(f);
    groupedActionable.set(f.target_kind, arr);
  }
  // Within each group, slot each absorbed `_gold_only_miss` immediately
  // after its upstream `_partition_mismatch` so the "implies removal of
  // X" link and the "← absorbed by Y split" link read as one beat
  // instead of two scattered cards.
  for (const [k, items] of groupedActionable) {
    groupedActionable.set(k, reorderConsequentPairs(items));
  }
  // One source of truth for both render order and section headers —
  // adding a new AuditTargetKind only touches this list.
  const GROUPS: { kind: AuditTargetKind; header: string }[] = [
    { kind: "factor",         header: "Experimental factors" },
    { kind: "fv",             header: "Design — factor values" },
    { kind: "tag",            header: "Experiment tags" },
    { kind: "characteristic", header: "Characteristics" },
    { kind: "assignment",     header: "Sample assignments" },
    { kind: "statement",      header: "Statements" },
    { kind: "experiment",     header: "Experiment" },
  ];

  // Boss-critic review feed → grouped verdicts (round-collapsed +
  // deduped), then partitioned by scope: ``design`` verdicts stay in the
  // top BossReviewPanel; ``factor`` / ``fv`` / ``tag`` verdicts route
  // inline into their finding section as a BossReviewSection. One
  // ``groupBossReviews`` call feeds both surfaces so the collapse is
  // computed once. Handoff BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03.
  const bossGroups = groupBossReviews(report?.evidence?.boss_critic_reviews);
  const bossDesignGroups = bossGroups.filter(
    (g) => g.scopeKind === "design" || g.scopeKind === "other",
  );
  const bossRoutedGroups = bossGroups.filter(
    (g) => bossSectionKind(g.scopeKind) !== null,
  );
  const bossRoutedForKind = (kind: AuditTargetKind): GroupedBossReview[] =>
    bossRoutedGroups.filter((g) => bossSectionKind(g.scopeKind) === kind);

  // Section-visibility precompute — used both by the renderers below
  // and by the empty-state detector at the foot of this view.
  // `hasAnyVisible` covers every section that would normally surface a
  // finding card (per-kind actionable + matches, orphan matches,
  // routed boss annotations, ok-toggle), so when it's false the body
  // would otherwise be silent.
  const hasGroupContent = GROUPS.some(({ kind: k }) => {
    const items = groupedActionable.get(k) ?? [];
    const matchesForKind = visibleMatches.filter((m) => m.target_kind === k);
    return items.length + matchesForKind.length + bossRoutedForKind(k).length > 0;
  });
  const knownKindsForOrphan = new Set(GROUPS.map((g) => g.kind));
  const orphanMatches = visibleMatches.filter(
    (m) => !knownKindsForOrphan.has(m.target_kind),
  );
  const hasAnyVisible =
    hasGroupContent ||
    orphanMatches.length > 0 ||
    bossDesignGroups.length > 0 ||
    visibleOk.length > 0;

  // Per-disposition rollup for the summary line — proposal kind frames
  // the counts as "applied / open / noted" instead of severity (which
  // isn't a proposal axis). The audit summary line remains the
  // severity tally rendered inline below.
  let nApplied = 0;
  let nOpenActionable = 0;
  let nNoted = 0;
  for (const f of sorted) {
    const d = dispositionByTarget.get(f.target_id);
    // A finding is actionable when it isn't a match AND either its
    // severity is non-ok or its apply_action mutates. The match guard
    // matters because match findings carry an apply_action that
    // represents the *dismissal* path (e.g. `remove_tag` when the
    // curator disagrees with the match) — not the primary action.
    // Without the guard, every confirmed match was counted as a pending
    // decision, inflating the "open" count and making the summary look
    // like there's still work to do on a fully-confirmed panel.
    const isActionableFinding =
      !isMatchFinding(f) &&
      (f.severity !== "ok" ||
        (!!resolveApplyAction(f) && resolveApplyAction(f)!.mutates));
    if (d && (d.status === "accepted" || d.status === "dismissed")) {
      nApplied++;
    } else if (isActionableFinding) {
      nOpenActionable++;
    } else {
      nNoted++;
    }
  }

  return (
    <div className="space-y-3">
      {/* FV-shaped tag finding suppression caption. Hidden by default
          when zero; surfaces a hint when the agent / upstream emitted
          tag-target findings for items that are actually factor
          values in the design. Design review 2026-06-14: tags and factor
          values are different entity types — don't show FVs as tag
          findings. The suppression itself happens up at ``sorted``;
          this caption tells the curator we're filtering, not silently
          dropping. */}
      {fvShapedTagFindings.length > 0 ? (
        <div className="text-[10px] italic text-slate-500 dark:text-slate-400 px-2">
          {fvShapedTagFindings.length} tag-shaped finding
          {fvShapedTagFindings.length === 1 ? "" : "s"} hidden —{" "}
          {fvShapedTagFindings
            .slice(0, 3)
            .map((f) => f.target_id.replace(/^tag:/, ""))
            .join(", ")}
          {fvShapedTagFindings.length > 3 ? " · …" : ""} — these
          (category, value) pairs are factor values in the design, not
          tags.
        </div>
      ) : null}
      {/* Escalation banner — agent's curator-follow-up requests.
          Renders above the orientation prose because escalations are
          blockers; summary is orientation. Suppresses
          when neither side carries entries. */}
      <EscalationBanner
        escalations={readEscalationRequests(report?.evidence)}
      />
      {/* Orchestrator orientation prose — generic top-of-panel slot.
          Reads through the dual-state adapter: prefers the canonical
          Proposal-side field, falls back to the AuditEvidence mirror.
          Suppresses itself when both sides are empty. */}
      <OrientationProse
        text={readCommentaryString(report?.evidence, "experiment_summary")}
      />
      {/* Experiment-level boss-critic review — gold-blind LLM
          commentary. Only the WHOLE-DESIGN verdicts render here now;
          factor / FV / tag verdicts route inline onto their finding
          section (handoff BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03).
          The header still shows the experiment-wide severity tally + a
          pointer to the routed count. Suppresses entirely when there's
          no design verdict AND nothing routed. */}
      <BossReviewPanel
        designGroups={bossDesignGroups}
        routedGroups={bossRoutedGroups}
      />
      {/* Summary header — always visible. Frames the body content
          ("N findings — X open, Y already triaged, Z noted") so a
          fully-triaged or judge-only-noted review reads as
          "everything's accounted for" rather than a blank panel. */}
      <ReviewSummaryHeader
        kind={kind}
        totalFindings={findings.length}
        nApplied={nApplied}
        nOpenActionable={nOpenActionable}
        nNoted={nNoted}
        modelName={report?.model ?? null}
        evidence={report?.evidence ?? null}
        nothingBelow={!hasAnyVisible}
      />
      {/* Rename / partition-mismatch findings used to render in a
          dedicated "Alternate factor" section above the regular factor
          group. Per design review 2026-06-12: those are factor findings too —
          surface them in the same "Design — factors" block as
          everything else. The factor-group renderer below picks them
          out via ``isRenameMatch`` and routes them through
          ``ComparisonFactorCard`` rather than ``CompactFindingCard``. */}
      {/* "Factors the audit didn't see" is meaningless for a scoped audit
          that deliberately never looked at factors — a tags-only ticket
          (scope.include = ["tags"]) would otherwise surface EVERY current
          factor as phantom drift (ticket 152: a lone `cell type` factor
          shown next to the one dev-stage tag under review). Only compute
          factor drift when the audit's scope actually includes factors. */}
      {auditCoversFactors(report?.scope) ? (
        <BaselineDriftSection
          curations={curations}
          baselineSource={chip.baseline}
          comparatorSource={chip.comparator}
          baselineLabel={baselineLabel}
          comparatorLabel={comparatorLabel}
          experimentId={experimentId}
          findings={findings}
        />
      ) : null}

      {GROUPS.map(({ kind: groupKind, header }) => {
        const items = groupedActionable.get(groupKind) ?? [];
        const matchesForKind = visibleMatches.filter(
          (m) => m.target_kind === groupKind,
        );
        // Boss-critic verdicts routed to this section. Each attaches
        // under the finding card it's about (first slug match wins);
        // any without a matching card render standalone at the section
        // tail so a boss verdict about a factor with no finding still
        // lands WITH that factor, not back in the top panel.
        const bossForKind = bossRoutedForKind(groupKind);
        if (
          items.length === 0 &&
          matchesForKind.length === 0 &&
          bossForKind.length === 0
        )
          return null;
        const cardFindings = [...items, ...matchesForKind];
        const bossByFindingKey = new Map<string, GroupedBossReview[]>();
        const matchedBossKeys = new Set<string>();
        for (const g of bossForKind) {
          const hit = cardFindings.find((f) =>
            bossMatchesFinding(g, f, bossRouteIndex),
          );
          if (!hit) continue;
          const fk = `${hit.target_kind}:${hit.target_id}:${hit.issue_code}`;
          const arr = bossByFindingKey.get(fk) ?? [];
          arr.push(g);
          bossByFindingKey.set(fk, arr);
          matchedBossKeys.add(g.key);
        }
        const bossUnmatched = bossForKind.filter(
          (g) => !matchedBossKeys.has(g.key),
        );
        // The matched boss verdicts for a given finding card — passed into
        // the card so they render as a collapsible section INSIDE it.
        const bossFor = (f: AuditFinding): GroupedBossReview[] | undefined =>
          bossByFindingKey.get(
            `${f.target_kind}:${f.target_id}:${f.issue_code}`,
          );
        // Loading caption — only worth surfacing on the factor group
        // because that's where the rename / partition-mismatch cards
        // live (they're the cards that depend on the slow /curations
        // payload). Stays out of every other section header.
        const showLoadingCaption =
          groupKind === "factor" &&
          curationsQuery.isLoading &&
          items.some((f) => isRenameMatch(f));
        return (
          <div key={groupKind} className="space-y-1.5">
            <div className={SECTION_HEADER_CLS}>
              {header}
              {SECTION_HELP[groupKind] ? (
                <span className="ml-1.5 normal-case tracking-normal font-normal">
                  <HelpPopup
                    title={SECTION_HELP[groupKind]!.title}
                    size="md"
                  >
                    {SECTION_HELP[groupKind]!.body}
                  </HelpPopup>
                </span>
              ) : null}
              {showLoadingCaption ? (
                <span className="ml-2 text-[10px] normal-case tracking-normal font-normal italic text-slate-500 dark:text-slate-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 mr-1 animate-pulse align-middle" />
                  loading comparison data…
                </span>
              ) : null}
            </div>
            {items.map((f) =>
              isRenameMatch(f) ? (
                <ComparisonFactorCard
                  key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                  finding={f}
                  leftLabel={baselineLabel}
                  rightLabel={comparatorLabel}
                  baselineSource={chip.baseline}
                  comparatorSource={chip.comparator}
                  bossReviews={bossFor(f)}
                />
              ) : (
                <CompactFindingCard
                  key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                  finding={f}
                  bossReviews={bossFor(f)}
                />
              ),
            )}
            {/* Match findings for this target_kind render INSIDE the
                kind's group (tail position), so tag matches live under
                TAGS, factor matches under DESIGN — FACTORS, etc.
                Factor matches route through ``ComparisonFactorCard``
                so the side-by-side body lands here too (the reviewer
                2026-06-12: "I thought we were moving to a side-by-
                side comparison"); tag matches keep the compact
                green-check row since there's no two-column shape
                worth rendering for a single category:value pair. */}
            {matchesForKind.map((f) =>
              f.target_kind === "factor" ? (
                <ComparisonFactorCard
                  key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                  finding={f}
                  leftLabel={baselineLabel}
                  rightLabel={comparatorLabel}
                  baselineSource={chip.baseline}
                  comparatorSource={chip.comparator}
                  bossReviews={bossFor(f)}
                />
              ) : (
                <CompactFindingCard
                  key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                  finding={f}
                  bossReviews={bossFor(f)}
                />
              ),
            )}
            {/* Boss-critic verdicts for this section with no matching
                finding card — one collapsible standalone block so they
                still land in the right section. */}
            {bossUnmatched.length > 0 ? (
              <BossReviewSection
                reviews={bossUnmatched}
                variant="standalone"
                autoOpen={bossUnmatched.some((g) => g.severity === "blocker")}
              />
            ) : null}
          </div>
        );
      })}
      {/* Any match findings whose target_kind isn't in GROUPS fall
          through to a residual list — defensive guard for future
          kinds we don't have a section for yet. */}
      {(() => {
        const knownKinds = new Set(GROUPS.map((g) => g.kind));
        const orphan = visibleMatches.filter(
          (m) => !knownKinds.has(m.target_kind),
        );
        if (orphan.length === 0) return null;
        return (
          <div className="space-y-1.5">
            <div className={SECTION_HEADER_CLS}>Confirmed matches</div>
            {orphan.map((f) => (
              <CompactFindingCard
                key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                finding={f}
              />
            ))}
          </div>
        );
      })()}
      {/* The "show N FV-level findings under flagged factors" toggle
          retired 2026-05-25 — OK FV confirmations are now nested
          inside their parent factor card (NestedOkFvConfirmations) and
          any actionable FV finding rides up to the parent's severity. */}
      {visibleOk.length > 0 ? (
        <button
          type="button"
          className="w-full text-left text-[11px] px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded"
          onClick={() => setShowOk((v) => !v)}
        >
          {showOk
            ? `▾ hide ${visibleOk.length} ok check${
                visibleOk.length === 1 ? "" : "s"
              }`
            : `▸ show ${visibleOk.length} ok check${
                visibleOk.length === 1 ? "" : "s"
              }`}
        </button>
      ) : null}
      {showOk
        ? visibleOk.map((f) => (
            <CompactFindingCard
              key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
              finding={f}
            />
          ))
        : null}
      {/* Pipeline audit trail — v5 supervisor's narrative of what the
          orchestrator did. Renders at the bottom of the panel (sibling
          to CollapsibleSubtaskAnalysis on AuditReportView). Reads via
          the dual-state adapter; suppresses when both sides are empty. */}
      <PipelineAuditTrail
        text={readCommentaryString(report?.evidence, "experiment_notes")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BaselineDriftSection — synthetic read-only cards for chip-baseline
// factors the audit didn't score against
// ---------------------------------------------------------------------------

/** Canonical factor signature for "same factor across curations".
 *
 *  Multi-factor-same-category designs (GSE93824 has TWO genotype
 *  factors — one for the AD transgene, one for the C5aR1 knockout)
 *  defeat a category-URI-only signature: both live factors and the
 *  single consensus factor all carry EFO_0000513, so a URI compare
 *  silently collapses the hAPP genotype into the C5aR1 one. We also
 *  key on the lowercased sorted FV free-text label set, which IS
 *  distinct across the two genotypes (wild-type FV is shared but the
 *  perturbation FVs differ).
 *
 *  Returns the empty string when both URI/label and FV labels are
 *  missing; such factors are filtered out rather than treated as
 *  "extra" — we'd just generate noise. */
function _factorSignature(f: Factor): string {
  const cat =
    (f.category?.uri ?? "").trim() ||
    (f.category?.label ?? "").trim().toLowerCase();
  const fvLabels = (f.factor_values ?? [])
    .map((fv) => (fv.free_text_label ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (!cat && fvLabels.length === 0) return "";
  return `${cat}|${fvLabels.join("␟")}`;
}

/** Extract the factor array from a CurationRow's design payload. The
 *  unified /curations response is post-snakeify so factors live under
 *  `.factors` (composeDesign isn't applied — these are the raw
 *  producer designs). */
function _factorsOf(curation: CurationRow | null): Factor[] {
  if (!curation) return [];
  const factors = (curation.design as { factors?: Factor[] } | undefined)
    ?.factors;
  return Array.isArray(factors) ? factors : [];
}

/** Nuisance factors Gemma's loader populates from data files (block /
 *  batch / sequencing batch / lane / library prep) are expected to
 *  differ between the polished gold (which strips them) and the live
 *  curation (which carries them). They are NOT a curator-actionable
 *  gap — filter from the drift section so the cards stay focused on
 *  factors the curator actually decides.
 *
 *  Mirrors the canonical out-of-scope list in
 *  `build_curation_pack._AGENT_OUT_OF_SCOPE_FACTOR_NAMES` and the
 *  existing block/batch filters in FactorList / SampleDetailsPanel /
 *  PrePublishChecklist. */
function _isNuisanceFactor(f: Factor): boolean {
  const cat = (f.category?.label ?? "").trim().toLowerCase();
  const name = (f.name ?? "").trim().toLowerCase();
  const NUISANCE = new Set([
    "block",
    "batch",
    "sequencing batch",
    "sequencing run",
    "lane",
    "library prep",
  ]);
  return NUISANCE.has(cat) || NUISANCE.has(name);
}

/** Synthesize a placeholder AuditFinding the read-only card can
 *  consume. Only the fields ComparisonFactorCard reads when
 *  readOnly + leftFactorOverride are set need realistic values;
 *  everything else is filled with neutral defaults so the runtime
 *  doesn't trip on optional accessors. */
function _driftFinding(factor: Factor, index: number): AuditFinding {
  const sl = `baseline_drift:${index}:${factor.id ?? "noid"}`;
  return {
    target_kind: "factor",
    target_id: sl,
    severity: "minor",
    issue_code: "baseline_drift",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
  } as unknown as AuditFinding;
}

/** localStorage key for per-experiment-per-factor drift dismissals.
 *  "Keep" on a drift card persists here so the dismissal survives a
 *  reload. Cleared by the design draft's ``discard()`` plumbing per
 *  the existing per-experiment LS hygiene contract. */
function driftDismissKey(experimentId: number | string): string {
  return `audit.driftDismiss.${experimentId}`;
}
function loadDriftDismissals(experimentId: number | string): Set<string> {
  try {
    const raw = window.localStorage.getItem(driftDismissKey(experimentId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveDriftDismissals(
  experimentId: number | string,
  ids: Set<string>,
): void {
  try {
    window.localStorage.setItem(
      driftDismissKey(experimentId),
      JSON.stringify([...ids]),
    );
  } catch {
    // best-effort
  }
}

function BaselineDriftSection({
  curations,
  baselineSource,
  comparatorSource,
  baselineLabel,
  comparatorLabel,
  experimentId,
  findings,
}: {
  curations: readonly CurationRow[];
  baselineSource: Source;
  comparatorSource: Source;
  baselineLabel: string;
  comparatorLabel: string;
  experimentId: number | string;
  /** The full findings list for this report. Used to suppress drift
   *  cards for factors the audit already has a finding for —
   *  signature-equality on consensus/agent factors misses cases
   *  where the live FVs and consensus FVs share a category but
   *  drift on FV labels (e.g. ``organism part: cerebral cortex /
   *  cerebellum / …`` getting a REMOVE FACTOR finding from the
   *  consensus side AND a drift card from the live side, for the
   *  SAME factor). Design review 2026-06-14: "the same factor is mentioned
   *  twice." */
  findings: AuditFinding[];
}) {
  const { apply: applyDraft, draft } = useDesignDraft();
  // Persisted per-(experiment, factor) dismissals so a "Keep" click
  // survives reload. Keyed by factor signature (URI/label + FV
  // labels) so a re-derived factor with the same shape stays
  // dismissed even after a draft refresh.
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    loadDriftDismissals(experimentId),
  );
  useEffect(() => {
    setDismissed(loadDriftDismissals(experimentId));
  }, [experimentId]);
  // Surface factors visible in EITHER chip slot that the audit never
  // knew about. The audit's findings list is closed under (consensus
  // polished ∪ agent_proposal) — those are the two designs the audit
  // ran over. Any factor in the chip baseline or comparator that
  // isn't in either of those is silently dropped from the comparison
  // cards. Render one read-only card per such factor so the curator
  // sees the gap.
  //
  // GSE93824 (2026-06-08): the live curation has TWO genotype factors
  // (C5aR1 KO + hAPP transgene). The audit-time consensus had only
  // the C5aR1 one; the audit-time agent proposal collapsed both into
  // a single 4-level genotype. The hAPP factor is therefore visible
  // only when the chip points at "live", on either slot.
  const drifts = useMemo(() => {
    if (curations.length === 0) {
      return [] as Array<{ factor: Factor; side: "baseline" | "comparator" }>;
    }
    const consensus =
      curations.find((c) => c.source_kind === "consensus") ?? null;
    const agentProposal =
      curations.find((c) => c.source_kind === "agent_proposal") ?? null;
    const consensusFactors = _factorsOf(consensus);
    const agentFactors = _factorsOf(agentProposal);
    const auditedSigs = new Set<string>([
      ...consensusFactors.map(_factorSignature),
      ...agentFactors.map(_factorSignature),
    ]);
    // Category-slug set sourced from every factor-target finding —
    // if the audit reports a finding about a factor's category, the
    // audit "saw" that factor regardless of whether its consensus/
    // agent_proposal signature matches the live one. Drift fired for
    // GSE9904 ``organism part`` because consensus + live disagreed on
    // FV labels (signature mismatch), but the audit DID have a
    // REMOVE FACTOR finding for it — duplicate card. Design review 2026-06-14.
    const auditedCategoryKeys = new Set<string>();
    for (const f of findings) {
      if (f.target_kind !== "factor") continue;
      // Path 1 — standard ``factor:<slug>`` target_id (proposer-side
      // findings). ``parseTargetId`` knows this shape.
      const parsed = parseTargetId(f.target_id);
      if (parsed?.kind === "factor" && parsed.factorSlug) {
        auditedCategoryKeys.add(parsed.factorSlug.toLowerCase());
        continue;
      }
      // Path 2 — calibration-pipeline factor findings ship a
      // longer target_id: ``calibration:<kind>:<a-cat>/<a-id>`` for
      // extra / gold_only_miss, or
      // ``calibration:<kind>:<a-cat>/<a-id><-><b-cat>/<b-id>`` for
      // match-family findings (agents-side
      // ``graph_alignment.py``). ``parseTargetId`` doesn't know this
      // shape (kind isn't in AuditTargetKind), so the standard path
      // misses it and the drift dedup leaks. Design review 2026-06-15 on
      // GSE33191 ``treatment`` rendering as both ``Extra factor in
      // Live Gemma`` and ``REMOVE FACTOR``. Extract every category
      // string after the kind prefix and add it to the key set.
      if (f.target_id.startsWith("calibration:")) {
        const rest = f.target_id.slice("calibration:".length);
        const colon = rest.indexOf(":");
        if (colon !== -1) {
          const payload = rest.slice(colon + 1);
          // ``<->`` joins two sides on match-family ids; each side's
          // segment is ``<cat>/<id>``. Extract the cat portion from
          // every segment.
          for (const seg of payload.split("<->")) {
            const slash = seg.indexOf("/");
            const cat = (slash === -1 ? seg : seg.slice(0, slash)).trim();
            if (!cat) continue;
            // Add both the raw lower-cased category AND its slug
            // form so the lookup site's slugified comparison matches
            // either way (calibration ids ship raw labels; the lookup
            // slugifies live labels).
            auditedCategoryKeys.add(cat.toLowerCase());
            auditedCategoryKeys.add(
              cat.toLowerCase().split(/\s+/).filter(Boolean).join("-"),
            );
          }
        }
      }
    }

    // Per-category budget: how many factors of a given category URI
    // does the audit already cover? The strict signature
    // (cat + FV-label-set) misses when the live curator and the agent
    // describe the same FV with different free-text labels — e.g.
    // GSE37811 treatment factor where live's FVs read
    // "BRM014 - delivered for duration - 3 d" while the agent emits
    // "brm014 - delivered at dose - 100 nM - delivered for duration -
    // 72 h". Same factor, same EFO:0000727 category, near-match card
    // already paired them — but signature mismatch leaks them into
    // "Factors the audit didn't see" as a phantom extra. Count
    // budget per category preserves the GSE93824 multi-of-same-
    // category drift (2 live genotype factors vs 1 in consensus →
    // budget=1 covers the C5aR1, second consumes nothing and
    // surfaces as drift).
    // Category keys for budget purposes: BOTH URI (when present) and
     // lower-cased label (when present). A factor contributes one
     // budget ticket under each of its keys; consuming a factor only
     // needs to find ONE matching key. This handles the asymmetric-URI
     // case where one side has a URI and the other doesn't —
     // GSE9904 2026-06-14: live's `biological sex` (no URI) vs agent's
     // `biological sex PATO:0000047` would otherwise live in two
     // disjoint buckets and never reconcile. Match-on-either-key keeps
     // the multi-of-same-category invariant (GSE93824's two genotype
     // factors) because we count by factor, not by key — a second
     // same-category factor finds depleted budget under either key.
    const catKeys = (f: Factor): string[] => {
      const u = (f.category?.uri ?? "").trim();
      const l = (f.category?.label ?? "").trim().toLowerCase();
      const out: string[] = [];
      if (u) out.push(u);
      if (l) out.push(l);
      return out;
    };
    const catCount = (factors: Factor[]) => {
      const m = new Map<string, number>();
      for (const f of factors) {
        for (const k of catKeys(f)) {
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      return m;
    };
    const consensusCatCount = catCount(consensusFactors);
    const agentCatCount = catCount(agentFactors);
    const auditedCatCap = new Map<string, number>();
    const cats = new Set<string>([
      ...consensusCatCount.keys(),
      ...agentCatCount.keys(),
    ]);
    for (const c of cats) {
      auditedCatCap.set(
        c,
        Math.max(consensusCatCount.get(c) ?? 0, agentCatCount.get(c) ?? 0),
      );
    }

    const out: Array<{ factor: Factor; side: "baseline" | "comparator" }> = [];
    const seen = new Set<string>(); // dedup when both chips point at the same source

    function collect(source: Source, side: "baseline" | "comparator") {
      const cur = resolveCuration(source, curations);
      if (!cur) return;
      // Skip when this chip slot IS one of the audit-time sources — by
      // construction every factor is already in auditedSigs.
      if (
        cur.source_kind === "consensus" ||
        cur.source_kind === "agent_proposal"
      ) {
        return;
      }
      // Per-side budget so baseline and comparator each get the full
      // audit-covered allowance — chip baseline=live and comparator=live
      // shouldn't double-charge.
      const catBudget = new Map(auditedCatCap);
      // Helper — does this factor's category match any audit
      // finding's factor target? Compare against the slug rule
      // (lowercased + whitespace-collapsed-to-dash) since that's
      // what ``parseTargetId`` emits and what the agent stamps.
      const categoryCoveredByFinding = (f: Factor): boolean => {
        const label = (f.category?.label ?? "").trim().toLowerCase();
        if (!label) return false;
        const slugified = label.split(/\s+/).filter(Boolean).join("-");
        return (
          auditedCategoryKeys.has(slugified) ||
          auditedCategoryKeys.has(label.replace(/\s+/g, "-")) ||
          auditedCategoryKeys.has(label)
        );
      };
      for (const f of _factorsOf(cur)) {
        if (_isNuisanceFactor(f)) continue;
        const sig = _factorSignature(f);
        if (sig === "" || seen.has(sig)) continue;
        if (auditedSigs.has(sig)) continue;
        // Audit-finding-coverage check: if there's already a
        // factor-target finding for this category, the audit
        // surfaced it — skip the drift card. Stops the duplicate
        // "Extra factor in Live Gemma" + "REMOVE FACTOR" pair the reviewer
        // 2026-06-14 caught.
        if (categoryCoveredByFinding(f)) continue;
        const keys = catKeys(f);
        const anyHit = keys.some((k) => (catBudget.get(k) ?? 0) > 0);
        if (anyHit) {
          // Decrement under every key this factor exposes so a second
          // same-category factor sees the depleted budget regardless of
          // which key it indexes by.
          for (const k of keys) {
            const n = catBudget.get(k) ?? 0;
            if (n > 0) catBudget.set(k, n - 1);
          }
          continue;
        }
        seen.add(sig);
        out.push({ factor: f, side });
      }
    }
    collect(baselineSource, "baseline");
    collect(comparatorSource, "comparator");
    return out;
  }, [curations, baselineSource, comparatorSource, findings]);

  // Apply per-(experiment, factor) dismissals — "Keep" clicks land
  // here, persisted in localStorage.
  const visibleDrifts = drifts.filter(
    (d) => !dismissed.has(_factorSignature(d.factor)),
  );
  if (visibleDrifts.length === 0) return null;

  function handleRemove(factor: Factor): void {
    if (!draft) return;
    // The drift card's factor is from a non-draft curation (live
    // Gemma, etc.). Try to find the matching factor in the draft by
    // category URI + label; remove it if present. Otherwise no-op
    // with a soft dismiss so the curator's intent is recorded.
    const cat = (factor.category?.uri ?? "").trim();
    const label = (factor.category?.label ?? "").trim().toLowerCase();
    const match =
      draft.factors.find(
        (df) => cat && df.category?.uri === cat,
      ) ??
      draft.factors.find(
        (df) => label && (df.category?.label ?? "").toLowerCase() === label,
      );
    if (match) {
      applyDraft(deleteFactor(draft, match.id));
    }
    handleKeep(factor); // also dismiss the card so it doesn't linger
  }
  function handleKeep(factor: Factor): void {
    const sig = _factorSignature(factor);
    if (!sig) return;
    const next = new Set(dismissed);
    next.add(sig);
    setDismissed(next);
    saveDriftDismissals(experimentId, next);
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wider font-bold text-amber-700 dark:text-amber-300 px-1 pt-2 pb-1 border-b border-amber-200 dark:border-amber-700 mb-1">
        Factors the audit didn't see ({visibleDrifts.length})
      </div>
      {visibleDrifts.map(({ factor: f, side }, i) => {
        const label = side === "baseline" ? baselineLabel : comparatorLabel;
        return (
          <ComparisonFactorCard
            key={`baseline-drift:${side}:${f.id ?? i}`}
            finding={_driftFinding(f, i)}
            leftLabel={side === "baseline" ? label : ""}
            rightLabel={side === "comparator" ? label : ""}
            leftFactorOverride={side === "baseline" ? f : null}
            rightFactorOverride={side === "comparator" ? f : null}
            readOnly
            onRemoveFactor={() => handleRemove(f)}
            onKeepFactor={() => handleKeep(f)}
            title={
              <span className="text-[12px] font-semibold">
                Extra factor in {label}:{" "}
                <span className="font-mono">
                  {f.category?.label ?? f.name ?? "(uncategorised)"}
                </span>
              </span>
            }
          />
        );
      })}
    </div>
  );
}
