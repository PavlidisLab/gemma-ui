/**
 * Per-finding judge chain — defender → arbiter → boss.
 *
 * Up to three stacked coloured tiles, one per producer, each
 * carrying verdict label + rationale prose. Extracted from
 * ``ComparisonFactorCard`` 2026-06-13 so tag cards (and any other
 * finding-card surface) can render the same chain. Paul flagged
 * that ``calibration_agent_extra`` tag cards promised "Read both
 * rationales below" but had no tiles rendered — the chain only
 * existed inside ``ComparisonFactorCard``, which doesn't render
 * tag findings.
 *
 * Old packages (no ``arbiter_verdicts`` / ``boss_verdicts`` on the
 * wire) render identically to the prior single-defender ``JudgeRow``
 * — the whole component returns null when every tier is empty.
 *
 * Per ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``.
 */
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
