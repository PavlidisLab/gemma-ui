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
  AuditFinding,
  AuditReport,
  ReviewVerdict,
  WhyBlock,
} from "@/api/auditTypes";
import { FindingEvidenceBlock } from "./agentDetailsPanel";
import { normalizeWikiUrl } from "@/lib/guidelines";

// ---------------------------------------------------------------------------
// Phase 3 of the rollout (Paul 2026-06-15): UI now reads the new wire
// blocks (`finding.why` / `finding.reviews` / `finding.comparison`)
// directly. Legacy field fallbacks dropped; vocabulary translation
// dropped (producer ships curator-friendly verdict strings via the
// agents-repo `curator_verdict_label()` map, and the eval-repo
// migration script `migrate_findings_to_three_phase.py` translated
// every stored review's wire labels). If a finding lacks a populated
// `why` block the section is omitted (gold_only_miss findings have
// no positive proposer rationale by design). If `reviews` is empty
// the section renders with the "no review was done" placeholder.
// ---------------------------------------------------------------------------

/** Curator-friendly label for a verdict string. The producer ships
 *  pre-translated strings on the wire (per Paul's vocab-at-producer
 *  rule), so this is now a thin pass-through. Kept as a single
 *  callable so callers don't depend on whether translation happens
 *  here or at the producer. */
export function verdictLabel(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/** Phase-1 Why block. Returns the wire block when populated; null
 *  otherwise (caller omits the section). */
export function deriveWhy(finding: AuditFinding): WhyBlock | null {
  const w = finding.why;
  if (!w) return null;
  const hasContent =
    (w.brief && w.brief.trim()) ||
    (w.rationale && w.rationale.trim()) ||
    (w.evidence && w.evidence.length > 0) ||
    (w.citation && w.citation.trim()) ||
    (w.citation_url && w.citation_url.trim());
  return hasContent ? w : null;
}

/** Phase-2 Reviews list. Returns the wire list directly. Empty list
 *  when no reviewer LLM ran — caller renders the "no review was done"
 *  placeholder. */
export function deriveReviews(
  finding: AuditFinding,
  _report: AuditReport | null,
): ReviewVerdict[] {
  return finding.reviews ?? [];
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
  const isBoss = (review.reviewer ?? "").trim().toLowerCase() === "boss";
  // Phase 5 (Paul 2026-06-15): boss-row copy is intentionally
  // minimized. We surface that the boss reviewed and made changes,
  // but don't expose the structured-action specifics
  // (`undo` / `rename` / `change_category` / `drop_fv`) as
  // per-card affordances. Keeps the card from becoming a
  // boss-action interface. The boss's rationale (when present)
  // appears as the italic continuation, same as other reviewers.
  if (isBoss) {
    return (
      <li className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          boss
        </span>
        <span className="text-slate-400 dark:text-slate-500">▪</span>
        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
          review resulted in changes based on feedback
        </span>
        {r ? (
          <>
            <span className="text-slate-400 dark:text-slate-500">▪</span>
            <span className="text-[11px] italic text-slate-600 dark:text-slate-300">
              {r}
            </span>
          </>
        ) : null}
      </li>
    );
  }
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
  const comparison = finding.comparison ?? null;
  return (
    <div className="space-y-2">
      <WhyPhase why={why} />
      <ReviewsPhase reviews={reviews} />
      <ComparisonJudgePhase comparison={comparison} />
    </div>
  );
}

/** Phase-3 TEXT only — the comparison-judge verdict + one-sentence
 *  rationale. The VISUAL chip strip / factor grid lives outside the
 *  reasoning collapsible (caller owns it) so toggling "reasoning"
 *  hides all the prose at once and leaves the visual + action
 *  buttons visible. */
function ComparisonJudgePhase({
  comparison,
}: {
  comparison: import("@/api/auditTypes").ComparisonVerdict | null;
}): JSX.Element | null {
  if (!comparison) return null;
  const v = verdictLabel(comparison.judge_verdict);
  const r = (comparison.judge_rationale ?? "").trim();
  const brief = (comparison.judge_brief ?? "").trim();
  if (!v && !r && !brief) return null;
  const label = (comparison.comparator_label ?? "").trim() || "comparator";
  return (
    <PhaseSection
      header={`Comparison vs ${label}`}
      brief={
        <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
          {v ? <span className="font-semibold mr-1">{v}.</span> : null}
          {brief ? (
            <span className="italic text-slate-600 dark:text-slate-300">
              {brief}
            </span>
          ) : null}
          {!brief && r ? (
            <span className="italic text-slate-600 dark:text-slate-300">
              {r}
            </span>
          ) : null}
        </div>
      }
      detail={
        brief && r && r !== brief ? (
          <div className="text-[11px] italic text-slate-600 dark:text-slate-300">
            {r}
          </div>
        ) : null
      }
      defaultOpen={false}
      alwaysShowHeader
    />
  );
}

// Re-export shared types for tests / callers.
export type { ReviewVerdict, WhyBlock } from "@/api/auditTypes";
