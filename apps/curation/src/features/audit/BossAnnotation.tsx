/**
 * Boss-critic presentational parts + the inline, collapsible review
 * section.
 *
 * The boss-critic surface used to be a flat experiment-wide dump at the
 * top of the panel (``BossReviewPanel``). Per handoff
 * ``BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03`` the OUTCOME now renders
 * in context: ``design``-scoped verdicts stay in the top panel;
 * ``factor`` / ``fv`` / ``tag``-scoped verdicts route into their finding
 * section as a ``BossReviewSection`` — collapsed by default and rendered
 * INSIDE the relevant proposal card, styled clearly boss-critic (a violet
 * left-rail + "Boss-critic" label) so it never reads as another proposer
 * / judge row.
 *
 * The panel and the inline section share ``BossSeverityChip`` and
 * ``BossVerdictBody`` so the final verdict + round-history expander
 * render identically wherever a grouped review lands.
 */
import { useState } from "react";
import {
  BOSS_SEVERITY_CHIP_CLS,
  BOSS_SEVERITY_LABEL,
  BOSS_SEVERITY_ORDER,
  bossScopeLabel,
  bossSeverityCounts,
  type BossSeverity,
  type GroupedBossReview,
} from "./bossCriticGrouping";

export function BossSeverityChip({
  severity,
}: {
  severity: BossSeverity;
}): JSX.Element {
  return (
    <span
      className={
        "text-[10px] px-1.5 py-0.5 rounded font-medium " +
        BOSS_SEVERITY_CHIP_CLS[severity]
      }
    >
      {BOSS_SEVERITY_LABEL[severity]}
    </span>
  );
}

/** Final verdict prose + a "how the agent got here" expander holding the
 *  earlier (superseded) rounds. The boss-critic is the agent's
 *  reasoning; the curator acts on the OUTCOME — so the final verdict is
 *  always visible and the round progression tucks away. */
export function BossVerdictBody({
  group,
}: {
  group: GroupedBossReview;
}): JSX.Element {
  const [showHistory, setShowHistory] = useState(false);
  // Earlier rounds = every history row that isn't the final one. Kept in
  // ascending round order by ``groupBossReviews``.
  const earlier = group.history.filter((r) => r !== group.final);
  return (
    <div className="space-y-1">
      <div className="text-[12px] leading-snug text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
        {group.final.verdict}
      </div>
      {earlier.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {showHistory ? "▾" : "▸"} how the agent got here (
            {earlier.length + 1} round{earlier.length + 1 === 1 ? "" : "s"})
          </button>
          {showHistory ? (
            <ol className="mt-1 space-y-1 border-l border-slate-200 dark:border-slate-700 pl-2">
              {group.history.map((r, i) => {
                const isFinalRow = r === group.final;
                return (
                  <li
                    key={i}
                    className="text-[11px] leading-snug text-slate-600 dark:text-slate-300"
                  >
                    <span className="text-slate-400 dark:text-slate-500">
                      round {r.round}
                      {isFinalRow ? " · final" : ""} —{" "}
                    </span>
                    <span className="uppercase tracking-wide text-[10px] text-slate-500 dark:text-slate-400">
                      {r.severity || "—"}
                    </span>
                    <div className="whitespace-pre-wrap">{r.verdict}</div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A collapsible group of boss-critic verdicts, COLLAPSED by default so
 * the boss commentary never dominates the read. The header stays compact
 * — a "Boss-critic (N)" toggle with the severity tally — so the curator
 * sees there's commentary and its severity at a glance without expanding.
 *
 * Two placements:
 *   - ``nested`` (default): rendered INSIDE a finding/proposal card, as a
 *     top-divider section — the verdict lives WITH the proposal it's
 *     about.
 *   - ``standalone``: a self-contained violet box for verdicts whose
 *     target has no finding card, so they still land in the right section.
 */
export function BossReviewSection({
  reviews,
  variant = "nested",
  autoOpen = false,
}: {
  reviews: GroupedBossReview[];
  variant?: "nested" | "standalone";
  /** Start expanded — used when a blocker is present so it isn't hidden. */
  autoOpen?: boolean;
}): JSX.Element | null {
  const [open, setOpen] = useState(autoOpen);
  if (reviews.length === 0) return null;
  const counts = bossSeverityCounts(reviews);
  const outerCls =
    variant === "standalone"
      ? "rounded border border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/30 border-l-2 border-l-violet-400 dark:border-l-violet-500 px-2 py-1.5"
      : "mt-1.5 pt-1.5 border-t border-violet-200/70 dark:border-violet-800/50";
  return (
    <div className={outerCls}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-baseline gap-2 flex-wrap text-left w-full"
      >
        <span
          className="text-[10px] leading-none text-violet-400 dark:text-violet-500 shrink-0"
          aria-hidden
        >
          {open ? "▾" : "▸"}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-violet-700 dark:text-violet-300">
          Boss-critic{reviews.length > 1 ? ` (${reviews.length})` : ""}
        </span>
        {/* A standalone box sits BETWEEN cards, so without this it
            reads as commentary that landed in the wrong place. Say
            plainly that these name a design element the agent didn't
            raise a finding for, so there's no card to nest them in. */}
        {variant === "standalone" ? (
          <span className="text-[10px] italic text-violet-600/80 dark:text-violet-400/80">
            no matching card — the boss named an element no finding targets
          </span>
        ) : null}
        <span className="ml-auto flex items-baseline gap-1">
          {BOSS_SEVERITY_ORDER.map((s) =>
            counts[s] ? (
              <span
                key={s}
                className={
                  "text-[10px] px-1.5 py-0.5 rounded font-medium " +
                  BOSS_SEVERITY_CHIP_CLS[s]
                }
              >
                {counts[s]} {BOSS_SEVERITY_LABEL[s].toLowerCase()}
              </span>
            ) : null,
          )}
        </span>
      </button>
      {open ? (
        <div className="mt-1.5 space-y-1.5">
          {reviews.map((g) => (
            <BossReviewInline key={g.key} group={g} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One verdict rendered inside a ``BossReviewSection`` — no outer violet
 *  frame (the section already frames the group); just the scope line +
 *  verdict body so nested verdicts don't double up borders. */
function BossReviewInline({ group }: { group: GroupedBossReview }): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <BossSeverityChip severity={group.severity} />
        <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
          {bossScopeLabel(group.targetId)}
        </span>
        {group.unresolvedBlocker ? (
          <span className="text-[10px] italic text-amber-700 dark:text-amber-300">
            proposer didn't address
          </span>
        ) : null}
      </div>
      <BossVerdictBody group={group} />
    </div>
  );
}
