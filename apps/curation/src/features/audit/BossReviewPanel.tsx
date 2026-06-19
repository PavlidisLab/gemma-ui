/**
 * Top-of-experiment boss-critic review panel.
 *
 * Renders ``AuditEvidence.boss_critic_reviews`` as a single
 * experiment-scoped surface adjacent to ``OrientationProse``. The
 * boss-critic is an LLM reviewer that runs against the agent's
 * whole emission — its commentary is experiment-level, not per
 * finding. Pre-v0.14.5 the same paragraph was fanned out across
 * every factor / tag card; per Paul (2026-06-16 ticket-60
 * walkthrough) that read as noise. Consolidating the surface here
 * matches the boss-critic's actual scope.
 *
 * Two signals the curator needs to see at a glance:
 *
 *   1. Severity counts — "1 blocker · 2 advisory · 5 ok" — so
 *      they triage whether anything's escalated before reading the
 *      prose.
 *   2. Did the proposer address the blockers? When only round 1
 *      exists for a blocker target, the proposer never got a
 *      chance to re-evaluate — the call is unresolved, and the
 *      curator should treat it as a debatable escalation. Surface
 *      the round count + a "round 1 only — no re-evaluation" note
 *      so they spot it.
 *
 * Suppresses entirely when the list is empty / undefined — old
 * packages + GSEs the boss-critic didn't run on read identically
 * to today.
 */
import { useState } from "react";
import type { BossCriticReview } from "@/api/auditTypes";

export interface BossReviewPanelProps {
  reviews: BossCriticReview[] | null | undefined;
  /** Optional extra className for spacing / max-width overrides. */
  className?: string;
}

type Severity = "blocker" | "advisory" | "ok" | "escalation" | "other";

const SEVERITY_ORDER: Severity[] = [
  "blocker",
  "escalation",
  "advisory",
  "ok",
  "other",
];

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "Blocker",
  escalation: "Escalation",
  advisory: "Advisory",
  ok: "OK",
  other: "Other",
};

const SEVERITY_CHIP_CLS: Record<Severity, string> = {
  blocker: "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  escalation:
    "bg-orange-50 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  advisory:
    "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  ok: "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  other:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

function classifySeverity(raw: string): Severity {
  const s = (raw || "").trim().toLowerCase();
  if (s === "blocker") return "blocker";
  if (s === "escalation") return "escalation";
  if (s === "advisory") return "advisory";
  if (s === "ok") return "ok";
  return "other";
}

/** Curator-readable scope for a boss-critic decision. The wire
 *  carries ``target_id`` shapes like ``design`` / ``factor:age``
 *  / ``tag:cell-type|astrocyte`` / ``tag:14`` / ``fv:age/young``;
 *  the panel renders a friendlier label per row. */
function scopeLabel(targetId: string): string {
  if (!targetId || targetId === "design") return "Whole design";
  if (targetId.startsWith("factor:")) {
    return `Factor: ${targetId.slice("factor:".length)}`;
  }
  if (targetId.startsWith("tag:")) {
    const tail = targetId.slice("tag:".length);
    if (/^\d+$/.test(tail)) return `Tag #${tail}`;
    return `Tag: ${tail.replace("|", " : ")}`;
  }
  if (targetId.startsWith("fv:")) {
    return `FV: ${targetId.slice("fv:".length)}`;
  }
  return targetId;
}

/** True when this row is a "Blocker" whose proposer never got a
 *  chance to re-evaluate on a follow-up round. The producer can
 *  re-run the proposer + boss-critic in a multi-round loop; when
 *  the loop is disabled (or the boss-critic only fires once), a
 *  round-1 blocker carries through with no resolution signal —
 *  curator should see it as a debatable escalation. */
function isUnresolvedBlocker(
  row: BossCriticReview,
  maxRoundForTarget: number,
): boolean {
  if (classifySeverity(row.severity) !== "blocker") return false;
  return row.round >= maxRoundForTarget;
}

function countSeverities(
  reviews: BossCriticReview[],
): Partial<Record<Severity, number>> {
  const out: Partial<Record<Severity, number>> = {};
  for (const r of reviews) {
    const s = classifySeverity(r.severity);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/** Max round number per target_id — used to detect "this blocker
 *  was emitted in round N and nothing higher ever ran". */
function maxRoundByTarget(
  reviews: BossCriticReview[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reviews) {
    const cur = out[r.target_id] ?? 0;
    if (r.round > cur) out[r.target_id] = r.round;
  }
  return out;
}

export function BossReviewPanel({
  reviews,
  className,
}: BossReviewPanelProps): JSX.Element | null {
  const list = Array.isArray(reviews) ? reviews : [];
  if (list.length === 0) return null;
  return <BossReviewPanelBody reviews={list} className={className} />;
}

function BossReviewPanelBody({
  reviews,
  className,
}: {
  reviews: BossCriticReview[];
  className?: string;
}): JSX.Element {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const counts = countSeverities(reviews);
  const maxRoundByT = maxRoundByTarget(reviews);
  const onlyOneRound = reviews.every((r) => maxRoundByT[r.target_id] === 1);

  // Sort: blockers first, then escalations, advisories, ok, other.
  // Within a severity bucket, "design" target comes first because
  // it scopes the whole experiment.
  const ordered = [...reviews].sort((a, b) => {
    const av = SEVERITY_ORDER.indexOf(classifySeverity(a.severity));
    const bv = SEVERITY_ORDER.indexOf(classifySeverity(b.severity));
    if (av !== bv) return av - bv;
    if (a.target_id === "design" && b.target_id !== "design") return -1;
    if (b.target_id === "design" && a.target_id !== "design") return 1;
    return a.target_id.localeCompare(b.target_id);
  });

  return (
    <section
      className={
        "rounded border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40 px-3 py-2 space-y-1.5" +
        (className ? ` ${className}` : "")
      }
    >
      <header className="flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-700 dark:text-slate-200">
          Boss-critic review
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          experiment-wide
        </span>
        <div className="ml-auto flex items-baseline gap-1">
          {SEVERITY_ORDER.map((s) =>
            counts[s] ? (
              <span
                key={s}
                className={
                  "text-[10px] px-1.5 py-0.5 rounded font-medium " +
                  SEVERITY_CHIP_CLS[s]
                }
              >
                {counts[s]} {SEVERITY_LABEL[s].toLowerCase()}
              </span>
            ) : null,
          )}
        </div>
      </header>
      {onlyOneRound && (counts.blocker || counts.escalation) ? (
        <div className="text-[10px] italic text-amber-700 dark:text-amber-300">
          Round 1 only — the proposer didn't re-evaluate after the
          boss flagged. Treat blockers / escalations as unresolved
          escalations until you confirm.
        </div>
      ) : null}
      <ul className="space-y-1.5">
        {ordered.map((row, i) => {
          const sev = classifySeverity(row.severity);
          const unresolved = isUnresolvedBlocker(row, maxRoundByT[row.target_id] ?? 1);
          const open = expandedRow === i;
          return (
            <li
              key={i}
              className="rounded border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 px-2 py-1.5 space-y-1"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={
                    "text-[10px] px-1.5 py-0.5 rounded font-medium " +
                    SEVERITY_CHIP_CLS[sev]
                  }
                >
                  {SEVERITY_LABEL[sev]}
                </span>
                <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
                  {scopeLabel(row.target_id)}
                </span>
                {row.round > 1 ? (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    round {row.round}
                  </span>
                ) : null}
                {unresolved ? (
                  <span className="text-[10px] italic text-amber-700 dark:text-amber-300">
                    proposer didn't address
                  </span>
                ) : null}
                {row.verdict.length > row.brief.length ? (
                  <button
                    type="button"
                    onClick={() => setExpandedRow(open ? null : i)}
                    className="text-[10px] ml-auto text-blue-600 hover:underline underline-offset-2 dark:text-blue-300"
                    aria-label={open ? "Collapse verdict" : "Show full verdict"}
                  >
                    {open ? "show less" : "show more"}
                  </button>
                ) : null}
              </div>
              <div className="text-[12px] leading-snug text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {open ? row.verdict : row.brief}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
