/**
 * Per-finding judge chain — defender → arbiter → boss.
 *
 * Two render shapes live here:
 *
 *   - ``JudgeChain`` — the legacy flat stack of three tiles
 *     (defender, arbiter, boss). Returns null when every tier is
 *     empty. Used by the few legacy call sites that haven't moved
 *     to the sectioned shape yet.
 *
 *   - ``SectionedJudgeChain`` — same tiles, but grouped into two
 *     labelled subsections: ``Internal review`` (defender) and
 *     ``Auditor`` (arbiter + boss). Per design review 2026-06-15: the
 *     proposer-side defence and the audit's comparison verdict
 *     must read as distinct things — the audit section only
 *     appears when there's a baseline being compared
 *     (``isComparison``). Used inside the WHY block on every
 *     finding-card surface (factor / tag / characteristic).
 *
 * The shared ``WhySection`` helper carries the per-section palette
 * (slate / blue / emerald) so any other section the WHY block grows
 * can hang off the same primitive.
 *
 * Old packages (no ``arbiter_verdicts`` / ``boss_verdicts`` on the
 * wire) render identically to the prior single-defender ``JudgeRow``
 * — every shape suppresses tiers with empty rationale.
 *
 * Per ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``.
 */
import type { ReactNode } from "react";
import type {
  ArbiterVerdict,
  AttachedDefenderVerdict,
  AuditFinding,
  AuditReport,
  BossPassVerdict,
} from "@/api/auditTypes";
import {
  findArbiterForFinding,
  findBossForFinding,
} from "@/api/pipelineCommentary";

export function JudgeChain({
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
      <DefenderTile verdict={defender} />
      <ArbiterTile arbiter={arbiter} />
      <BossTile boss={boss} />
    </div>
  );
}

/** Defender tile — blue (default) or purple (legacy "boss"-tagged
 *  defender from older packages). Same shape as the prior ``JudgeRow``
 *  in ``ComparisonFactorCard``; kept here as the chain's first tier. */
export function DefenderTile({
  verdict,
}: {
  verdict: AttachedDefenderVerdict | null;
}): JSX.Element | null {
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

/** Arbiter tile — emerald palette to distinguish from defender's
 *  blue and boss's purple. */
export function ArbiterTile({
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

/** Boss tile — purple palette. Carries ``arbiter_rationale`` as a
 *  "Prior arbiter" subline above the boss's own rationale so the
 *  curator can read the chain without cross-indexing. */
export function BossTile({
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

// ---------------------------------------------------------------------------
// Sectioned chain — Internal review vs Auditor, with the shared
// WhySection wrapper. Used by every WHY block surface so the
// proposer-side defence and the audit's verdict are visually
// distinct and the audit section only appears when there's
// actually a comparison happening.
// ---------------------------------------------------------------------------

/** One labelled subsection inside a WHY block. Three tones distinguish
 *  the PROPOSAL / INTERNAL REVIEW / AUDITOR roles at a glance — slate
 *  (neutral proposer prose), blue (proposer-side internal review),
 *  emerald (audit's comparison verdict). Same primitive ships
 *  whatever the section is named so future sections (e.g. CURATOR
 *  NOTES) hang off the same shape. */
export function WhySection({
  label,
  sublabel,
  tone,
  children,
}: {
  label: string;
  sublabel?: string;
  tone: "slate" | "blue" | "emerald";
  children: ReactNode;
}): JSX.Element {
  const palette =
    tone === "blue"
      ? "border-blue-300/70 dark:border-blue-700/60 bg-blue-50/30 dark:bg-blue-900/10"
      : tone === "emerald"
        ? "border-emerald-300/70 dark:border-emerald-700/60 bg-emerald-50/30 dark:bg-emerald-900/10"
        : "border-slate-300/60 dark:border-slate-700/60 bg-white/40 dark:bg-slate-900/20";
  const headerTone =
    tone === "blue"
      ? "text-blue-700 dark:text-blue-300"
      : tone === "emerald"
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-slate-600 dark:text-slate-300";
  return (
    <section className={`border-l-2 rounded-sm pl-2 py-1 ${palette}`}>
      <header className="inline-flex items-baseline gap-1.5 mb-1">
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${headerTone}`}>
          {label}
        </span>
        {sublabel ? (
          <span className="text-[9px] text-slate-500 dark:text-slate-400">
            — {sublabel}
          </span>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

/** SectionedJudgeChain — the same defender + arbiter + boss content
 *  as ``JudgeChain``, but grouped into two labelled subsections so
 *  the proposer-side defence reads as distinct from the audit's
 *  verdict.
 *
 *  ``isComparison`` gates the AUDITOR subsection — when there's no
 *  baseline being compared against, the arbiter/boss verdict has no
 *  meaningful "which side is better" reading, so the section is
 *  hidden entirely. Defaults to ``true`` because the audit sidebar
 *  is the dominant caller and every finding there IS part of a
 *  gold-vs-agent comparison. Read-only drift cards
 *  (``ComparisonFactorCard`` with ``baselineSource`` unset) flip
 *  it to ``false``.
 *
 *  Returns null when BOTH sections would be empty so legacy
 *  packages (no arbiter/boss + no defender_verdict) render
 *  nothing. */
export function SectionedJudgeChain({
  finding,
  report,
  isComparison = true,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
  isComparison?: boolean;
}): JSX.Element | null {
  const defender = finding.defender_verdict ?? null;
  const hasInternal = !!(defender && defender.rationale?.trim());
  const arbiter = isComparison ? findArbiterForFinding(report, finding) : null;
  const boss = isComparison ? findBossForFinding(report, finding) : null;
  const hasAuditor =
    isComparison &&
    !!(
      (arbiter && arbiter.rationale?.trim()) ||
      (boss && (boss.rationale?.trim() || boss.arbiter_rationale?.trim()))
    );
  if (!hasInternal && !hasAuditor) return null;
  return (
    <div className="space-y-2">
      {hasInternal ? (
        <WhySection
          label="Internal review"
          sublabel="proposer's reasoning (judge / boss)"
          tone="blue"
        >
          <DefenderTile verdict={defender} />
        </WhySection>
      ) : null}
      {hasAuditor ? (
        <WhySection
          label="Auditor"
          sublabel="comparison vs current annotations"
          tone="emerald"
        >
          <div className="space-y-1">
            <ArbiterTile arbiter={arbiter} />
            <BossTile boss={boss} />
          </div>
        </WhySection>
      ) : null}
    </div>
  );
}
