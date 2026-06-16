/**
 * Three-phase finding card body.
 *
 * Per ``Gemma/handoffs/FINDING_CARD_THREE_PHASE_SPEC_2026_06_15.md``
 * (Paul 2026-06-15). Every finding card renders EXACTLY THREE flat
 * labelled sections, in order:
 *
 *   1. **Why proposed** — proposer rationale + evidence + citation.
 *      NEVER references gold or any other curation set.
 *   2. **Reviews** — flat list of reviewer-LLM verdicts (defender,
 *      factor_defender, arbiter, boss). Each row reads as
 *      ``<reviewer> ▪ <verdict tag> ▪ <one-sentence gist>``. Header
 *      ALWAYS shown (Paul 2026-06-15: helps the curator see what's
 *      expected to be there), even when no reviewers ran. Reviewers
 *      DO NOT compare to any external curation set.
 *   3. **Comparison vs <set>** — chip strip + comparison-judge
 *      verdict + accept/reject affordance. Comparator is supplied by
 *      the calling card (factor-card grid, tag-card chip strip).
 *      OMITTED ENTIRELY when no comparison ran — NO "Auditor says
 *      (no entry)" placeholder.
 *
 * Each phase shows a brief summary always; supporting detail collapses
 * behind a per-section show/hide chevron. Brief stays visible so the
 * curator can scan; expand to dig in.
 *
 * Anti-patterns this replaces:
 *   - "STRONG SUGGESTION" / "NOT SUGGESTED" header (confidence rides
 *     on each reviewer's verdict tag now).
 *   - "INTERNAL REVIEW — proposer-side defence (judge/boss)" subtitle.
 *   - "Auditor says ... no entry" placeholder line.
 *   - Nested-box decoration (the slate / blue / emerald per-section
 *     bordered envelopes that ``SectionedJudgeChain`` shipped).
 *
 * Wire shape (additive, transitional):
 *   - Reads ``finding.why`` / ``finding.reviews`` / ``finding.comparison``
 *     when present (Path B per the spec — wire-side rename landing in
 *     parallel).
 *   - Falls back to ``finding.proposer_defense`` /
 *     ``finding.supporting_evidence`` / ``finding.citation`` for Why,
 *     and to ``finding.defender_verdict`` + ``findArbiterForFinding`` +
 *     ``findBossForFinding`` for Reviews — same data, projected into
 *     the new shape at render time.
 *   - Vocabulary cleanup is producer-side per Paul (single source of
 *     truth on the wire). Until the producer-rename lands, ``verdictLabel``
 *     below ships a small TEMPORARY translation table marked with a
 *     TODO so the curator doesn't read raw debug strings. Drop the
 *     table once the wire ships curator-friendly labels.
 */

import { useState, type ReactNode } from "react";
import type {
  ArbiterVerdict,
  AttachedDefenderVerdict,
  AuditFinding,
  AuditReport,
  BossPassVerdict,
  ReviewVerdict,
  WhyBlock,
} from "@/api/auditTypes";
import {
  findArbiterForFinding,
  findBossForFinding,
} from "@/api/pipelineCommentary";
import { FindingEvidenceBlock } from "./agentDetailsPanel";
import { trimRationaleBoilerplate } from "./rationaleText";
import { normalizeWikiUrl } from "@/lib/guidelines";

// ---------------------------------------------------------------------------
// Vocabulary translation — TEMPORARY, drop once wire ships labels.
// ---------------------------------------------------------------------------
//
// TODO(2026-06-15, three-phase-spec): the producer-side rename per
// Paul's "vocabulary cleanup at producer; UI doesn't translate" rule
// is landing in parallel. Until the wire ships curator-friendly
// verdict strings, this UI-side table catches the worst debug
// strings so curators don't read ``AGENT_MISSED_GOLD`` /
// ``agent_correct_inherited`` raw on a card. Once the wire ships
// labels (agents-side wire-block commit), delete this table and
// just render ``verdict`` verbatim.
const VERDICT_LABELS: Record<string, string> = {
  agent_correct_inherited: "already captured by Gemma",
  agent_missed_gold: "gold has, agent missed",
  AGENT_MISSED_GOLD: "gold has, agent missed",
  extra_genuine_new: "real new factor / tag",
  extra_confounded: "confounded with another",
  extra_unsupported: "weak evidence",
  extra_inherited_redundant: "inherited from biomaterial",
  extra_borderline: "borderline",
  agent_miss_genuine: "agent missed a real one",
  agent_correct_overzealous_gold: "agent right, gold over-tagged",
  miss_genuine: "agent missed it",
  miss_inherited_from_design: "covered elsewhere in design",
  miss_overzealous_gold: "gold over-included",
  miss_borderline: "borderline",
  concept_mismatch: "different concept",
  synonym: "same concept, different wording",
  partition_mismatch: "same factor, samples differ",
  judgment_unclear: "couldn't decide",
  gold_correct_per_rule: "gold is right",
  agent_correct_per_rule: "agent is right",
  equivalent_by_judgment: "both defensible",
};

/** Curator-friendly label for a raw wire-side verdict tag. Returns
 *  the input string unchanged when no translation is registered —
 *  forward-compat with new verdicts the producer ships. */
export function verdictLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return VERDICT_LABELS[s] ?? s;
}

// ---------------------------------------------------------------------------
// Adapters — read three-phase blocks if present, else project from legacy
// fields. Pure functions; safe to call on every render.
// ---------------------------------------------------------------------------

/** Pull the Phase-1 Why block. Prefers ``finding.why`` when set;
 *  otherwise projects from the legacy proposer fields. Returns null
 *  when no rationale / evidence / citation is available — caller
 *  suppresses the section. */
export function deriveWhy(finding: AuditFinding): WhyBlock | null {
  if (finding.why) {
    const w = finding.why;
    const hasContent =
      (w.rationale && w.rationale.trim()) ||
      (w.evidence && w.evidence.length > 0) ||
      (w.citation && w.citation.trim()) ||
      (w.citation_url && w.citation_url.trim());
    if (!hasContent) return null;
    return w;
  }
  const rationale = trimRationaleBoilerplate(
    (finding.proposer_defense ?? "").trim(),
  );
  const evidence = finding.supporting_evidence ?? [];
  const citation = (finding.citation ?? "").trim();
  const citation_url = (finding.citation_url ?? "").trim();
  if (
    !rationale &&
    evidence.length === 0 &&
    !citation &&
    !citation_url
  ) {
    return null;
  }
  return { rationale, evidence, citation, citation_url };
}

/** Pull the Phase-2 Reviews list. Prefers ``finding.reviews`` when
 *  set; otherwise projects from ``defender_verdict`` +
 *  ``evidence.arbiter_verdicts`` + ``evidence.boss_verdicts``. Order:
 *  defender → arbiter → boss (pipeline order). */
export function deriveReviews(
  finding: AuditFinding,
  report: AuditReport | null,
): ReviewVerdict[] {
  if (finding.reviews && finding.reviews.length > 0) {
    return finding.reviews;
  }
  const out: ReviewVerdict[] = [];
  const defender = finding.defender_verdict ?? null;
  if (defender && defender.rationale?.trim()) {
    out.push({
      reviewer: reviewerLabelFromDefender(defender),
      verdict: defender.verdict ?? "",
      rationale: defender.rationale,
    });
  }
  const arbiter = findArbiterForFinding(report, finding);
  if (arbiter && arbiter.rationale?.trim()) {
    out.push({
      reviewer: "arbiter",
      verdict: arbiter.verdict ?? "",
      rationale: arbiter.rationale,
    });
  }
  const boss = findBossForFinding(report, finding);
  if (boss && boss.rationale?.trim()) {
    out.push({
      reviewer: "boss",
      verdict: boss.verdict ?? "",
      rationale: boss.rationale,
    });
  }
  return out;
}

/** Pick a reviewer name from a legacy ``AttachedDefenderVerdict``.
 *  The ``side`` field carries the producer label ("defender" /
 *  "arbiter" / "boss" / "agent_extra" / "agent_missed_gold"). The
 *  first two map to the role; the calibration ``agent_*`` sides are
 *  pre-defender-rename legacy and just read "defender" on the card. */
function reviewerLabelFromDefender(v: AttachedDefenderVerdict): string {
  if (v.side === "arbiter") return "arbiter";
  if (v.side === "boss") return "boss";
  return "defender";
}

// ---------------------------------------------------------------------------
// Phase-level section primitive — flat, no nested boxes.
// ---------------------------------------------------------------------------

/** One flat section in the three-phase render. Header always
 *  visible, body collapses behind a per-section chevron. ``brief``
 *  shows even when the section is collapsed (so the curator can
 *  scan); ``detail`` reveals on expand. */
function PhaseSection({
  header,
  brief,
  detail,
  defaultOpen = false,
  alwaysShowHeader = true,
}: {
  header: string;
  brief: ReactNode | null;
  detail: ReactNode | null;
  defaultOpen?: boolean;
  alwaysShowHeader?: boolean;
}): JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen);
  const hasBrief = brief != null && brief !== false && brief !== "";
  const hasDetail = detail != null && detail !== false && detail !== "";
  if (!hasBrief && !hasDetail && !alwaysShowHeader) return null;
  return (
    <section className="space-y-1">
      <header className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
          {header}
        </span>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
            aria-label={open ? `hide ${header} details` : `show ${header} details`}
            title={open ? "hide details" : "show details"}
          >
            {open ? "hide" : "show"}
          </button>
        ) : null}
      </header>
      {hasBrief ? (
        <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
          {brief}
        </div>
      ) : null}
      {open && hasDetail ? (
        <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug space-y-1">
          {detail}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — Why proposed
// ---------------------------------------------------------------------------

function WhyPhase({ why }: { why: WhyBlock | null }): JSX.Element | null {
  if (!why) return null;
  const rationale = (why.rationale ?? "").trim();
  const evidence = why.evidence ?? [];
  const citation = (why.citation ?? "").trim();
  const citationUrl = (why.citation_url ?? "").trim();
  const brief = rationale ? <span>{rationale}</span> : null;
  const hasDetail =
    evidence.length > 0 || !!citation || !!citationUrl;
  const detail = hasDetail ? (
    <>
      {evidence.length > 0 ? (
        <div className="space-y-1">
          {evidence.map((ev, i) => (
            <FindingEvidenceBlock key={i} evidence={ev} />
          ))}
        </div>
      ) : null}
      {citation || citationUrl ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          §{" "}
          {citationUrl ? (
            <a
              href={normalizeWikiUrl(citationUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline dark:text-blue-300"
              title={citation || citationUrl}
            >
              {citation || citationUrl}
            </a>
          ) : (
            <span>{citation}</span>
          )}
        </div>
      ) : null}
    </>
  ) : null;
  return (
    <PhaseSection
      header="Why proposed"
      brief={brief}
      detail={detail}
      defaultOpen={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — Reviews
// ---------------------------------------------------------------------------

function ReviewsPhase({
  reviews,
}: {
  reviews: ReviewVerdict[];
}): JSX.Element {
  const brief =
    reviews.length === 0 ? (
      <span className="italic text-slate-400 dark:text-slate-500">
        no review was done
      </span>
    ) : (
      <ul className="space-y-0.5">
        {reviews.map((r, i) => (
          <ReviewRow key={i} review={r} />
        ))}
      </ul>
    );
  // Reviews has no per-row detail in this revision — the one-sentence
  // rationale IS the brief AND the detail (per the spec's
  // brief-summary-always pattern). When ``structured_action`` lands
  // on the wire (boss-actions channel surface), we'll grow per-row
  // expanders.
  return (
    <PhaseSection
      header="Reviews"
      brief={brief}
      detail={null}
      defaultOpen={false}
      alwaysShowHeader
    />
  );
}

function ReviewRow({ review }: { review: ReviewVerdict }): JSX.Element {
  const v = verdictLabel(review.verdict);
  const r = (review.rationale ?? "").trim();
  return (
    <li className="flex items-baseline gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        {review.reviewer}
      </span>
      <span className="text-slate-400 dark:text-slate-500">▪</span>
      {v ? (
        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
          {v}
        </span>
      ) : null}
      {v && r ? (
        <span className="text-slate-400 dark:text-slate-500">▪</span>
      ) : null}
      {r ? (
        <span className="text-[11px] italic text-slate-600 dark:text-slate-300">
          {r}
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — Comparison vs <comparator>
// ---------------------------------------------------------------------------

/** Phase 3 render. Caller owns the comparator chip strip / grid (the
 *  shape varies by finding-kind: tag = chip strip; factor =
 *  FactorComparisonGrid). This component just labels the section,
 *  renders the supplied chip strip / grid, surfaces the judge's
 *  verdict line, and exposes the optional accept/reject buttons.
 *
 *  When ``comparator`` is null/undefined AND no chip-strip /
 *  comparison node is passed, the section is OMITTED ENTIRELY — no
 *  placeholder. */
export function ComparisonPhase({
  comparatorLabel,
  chipStrip,
  judgeVerdict,
  judgeRationale,
  actions,
}: {
  comparatorLabel?: string | null;
  chipStrip?: ReactNode;
  judgeVerdict?: string | null;
  judgeRationale?: string | null;
  actions?: ReactNode;
}): JSX.Element | null {
  const hasChip = !!chipStrip;
  const hasJudge = !!(judgeVerdict?.trim() || judgeRationale?.trim());
  const hasActions = !!actions;
  if (!hasChip && !hasJudge && !hasActions) return null;
  const label = comparatorLabel?.trim() || "comparison";
  const header = `Comparison vs ${label}`;
  const brief = (
    <div className="space-y-1.5">
      {chipStrip}
      {hasJudge ? (
        <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
          {judgeVerdict ? (
            <span className="font-semibold mr-1">
              {verdictLabel(judgeVerdict)}.
            </span>
          ) : null}
          {judgeRationale ? (
            <span className="italic text-slate-600 dark:text-slate-300">
              {judgeRationale}
            </span>
          ) : null}
        </div>
      ) : null}
      {hasActions ? <div className="pt-1">{actions}</div> : null}
    </div>
  );
  return (
    <PhaseSection
      header={header}
      brief={brief}
      detail={null}
      defaultOpen
      alwaysShowHeader
    />
  );
}

// ---------------------------------------------------------------------------
// Three-phase body — composes Phase 1 + Phase 2; Phase 3 is rendered
// by the caller (it owns the comparator shape).
// ---------------------------------------------------------------------------

/** Phase 1 + Phase 2 of the three-phase render. Pass-through for
 *  ``FindingEvidence`` rendering (uses the existing
 *  ``FindingEvidenceBlock`` so quote / context / highlight behaviour
 *  stays consistent with the legacy panel). Phase 3 is rendered by
 *  the caller because the chip-strip shape varies per finding kind
 *  (tag = chip strip; factor = FactorComparisonGrid). */
export function ThreePhaseFindingBody({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}): JSX.Element {
  const why = deriveWhy(finding);
  const reviews = deriveReviews(finding, report);
  return (
    <div className="space-y-2">
      <WhyPhase why={why} />
      <ReviewsPhase reviews={reviews} />
    </div>
  );
}

// Re-export shared types for tests / callers.
export type { ArbiterVerdict, BossPassVerdict, ReviewVerdict, WhyBlock };
