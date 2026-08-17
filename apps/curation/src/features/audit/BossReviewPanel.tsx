/**
 * Top-of-experiment boss-critic review panel — the ``design``-scoped slice.
 *
 * The boss-critic is a gold-blind LLM reviewer that runs against the
 * agent's whole emission. Its feed
 * (``AuditEvidence.boss_critic_reviews``) is the agent's multi-round
 * REASONING; the curator needs the OUTCOME. Per handoff
 * ``BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03`` the feed is now:
 *
 *   1. Grouped + round-collapsed to ONE verdict per ``(target, issue)``
 *      — see ``bossCriticGrouping.groupBossReviews``. Round history tucks
 *      behind a "how the agent got here" expander, not sibling cards.
 *   2. Routed by scope — ``factor`` / ``fv`` / ``tag`` verdicts render
 *      inline on their finding section (``BossReviewSection``); only the
 *      ``design`` (whole-experiment) verdicts stay in THIS panel.
 *
 * The panel takes the pre-grouped ``design`` slice plus the count of
 * routed groups, so the top-of-experiment glance still shows the full
 * severity tally and a pointer to where the rest went. ``findingList``
 * owns the grouping + partition (one ``groupBossReviews`` call feeds both
 * this panel and the inline annotations).
 *
 * Suppresses entirely when there's no design-scoped verdict AND nothing
 * routed — old packages + GSEs the boss-critic didn't run on read
 * identically to today.
 *
 * The panel is collapsible (collapsed by default; auto-expands on a
 * blocker / escalation) — Design review 2026-06-19: "takes up too much space".
 */
import { useState } from "react";
import { HelpPopup } from "@/components/ui/HelpPopup";
import {
  BOSS_SEVERITY_CHIP_CLS,
  BOSS_SEVERITY_LABEL,
  BOSS_SEVERITY_ORDER,
  bossScopeLabel,
  bossSeverityCounts,
  type BossSeverity,
  type GroupedBossReview,
} from "./bossCriticGrouping";
import { BossSeverityChip, BossVerdictBody } from "./BossAnnotation";

export interface BossReviewPanelProps {
  /** The ``design``-scoped grouped verdicts (already round-collapsed +
   *  ordered by ``groupBossReviews``). */
  designGroups: GroupedBossReview[];
  /** The ``factor`` / ``fv`` / ``tag``-scoped groups routed inline below.
   *  Used only for the header count + "routed below" hint — the panel
   *  doesn't render their bodies. */
  routedGroups?: GroupedBossReview[];
  /** Optional extra className for spacing / max-width overrides. */
  className?: string;
}

/** How many routed groups fall under each scope, for the "N on factors …"
 *  hint. */
function routedScopeCounts(
  routed: GroupedBossReview[],
): { label: string; n: number }[] {
  const factor = routed.filter(
    (g) => g.scopeKind === "factor" || g.scopeKind === "fv",
  ).length;
  const tag = routed.filter((g) => g.scopeKind === "tag").length;
  const other = routed.filter((g) => g.scopeKind === "other").length;
  const out: { label: string; n: number }[] = [];
  if (factor) out.push({ label: factor === 1 ? "factor" : "factors", n: factor });
  if (tag) out.push({ label: tag === 1 ? "tag" : "tags", n: tag });
  if (other) out.push({ label: "other", n: other });
  return out;
}

export function BossReviewPanel({
  designGroups,
  routedGroups,
  className,
}: BossReviewPanelProps): JSX.Element | null {
  const routed = routedGroups ?? [];
  if (designGroups.length === 0 && routed.length === 0) return null;
  return (
    <BossReviewPanelBody
      designGroups={designGroups}
      routedGroups={routed}
      className={className}
    />
  );
}

function BossReviewPanelBody({
  designGroups,
  routedGroups,
  className,
}: {
  designGroups: GroupedBossReview[];
  routedGroups: GroupedBossReview[];
  className?: string;
}): JSX.Element {
  // Experiment-wide severity tally spans BOTH the design verdicts shown
  // here and the routed ones rendered inline below — the header is the
  // triage-at-a-glance signal, so it counts every boss-critic outcome.
  const counts = bossSeverityCounts([...designGroups, ...routedGroups]);
  const hasUrgent = !!(counts.blocker || counts.escalation);
  const anyUnresolvedDesign = designGroups.some((g) => g.unresolvedBlocker);
  // Collapsed by default to reclaim space (design review 2026-06-19: "takes up
  // too much space") — the header + severity counts stay visible so the
  // curator still sees there's commentary. Auto-expand when a blocker /
  // escalation is present so urgent items aren't hidden behind a click.
  const [panelOpen, setPanelOpen] = useState(hasUrgent);

  const routedCounts = routedScopeCounts(routedGroups);

  return (
    <section
      className={
        "rounded border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40 px-3 py-2 space-y-1.5" +
        (className ? ` ${className}` : "")
      }
    >
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-label={
            panelOpen ? "Collapse boss-critic review" : "Expand boss-critic review"
          }
          className="flex items-baseline gap-2 text-left"
        >
          <span
            className="text-[10px] leading-none text-slate-400 dark:text-slate-500 shrink-0"
            aria-hidden
          >
            {panelOpen ? "▾" : "▸"}
          </span>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-700 dark:text-slate-200">
            Boss-critic review
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            experiment-wide
          </span>
        </button>
        <HelpPopup title="Boss-critic review" size="md">
          <div className="space-y-1.5 leading-snug">
            <p>
              An experiment-wide critic pass: the boss reviews the whole
              proposed curation (design, factors, tags) plus the
              proposer's reasoning, and flags issues by severity. It sees
              the full proposed curation for this experiment — not a
              single finding.
            </p>
            <p>
              Whole-design verdicts stay here; a verdict about a specific
              factor, factor value, or tag is shown{" "}
              <em>with that element</em>, in its section below.
            </p>
            <ul className="space-y-1">
              <li>
                <span className="font-semibold text-red-700 dark:text-red-300">
                  Blocker
                </span>{" "}
                — serious enough to block acceptance; resolve it before
                you accept the curation.
              </li>
              <li>
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  Advisory
                </span>{" "}
                — a non-blocking note; worth considering, but it doesn't
                gate acceptance.
              </li>
              <li>
                <span className="font-semibold">Escalation</span> — a
                round-1 blocker the proposer never re-evaluated (no
                resolution signal). Treat it as an unresolved escalation
                — your call.
              </li>
            </ul>
            <p className="text-slate-500 dark:text-slate-400">
              Each verdict is the boss's FINAL call. "How the agent got
              here" reveals the earlier rounds behind it.
            </p>
          </div>
        </HelpPopup>
        <div className="ml-auto flex items-baseline gap-1">
          {BOSS_SEVERITY_ORDER.map((s: BossSeverity) =>
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
        </div>
      </div>
      {panelOpen ? (
        <>
          {anyUnresolvedDesign ? (
            <div className="text-[10px] italic text-amber-700 dark:text-amber-300">
              Round 1 only — the proposer didn't re-evaluate after the
              boss flagged. Treat blockers / escalations as unresolved
              escalations until you confirm.
            </div>
          ) : null}
          {designGroups.length > 0 ? (
            <ul className="space-y-1.5">
              {designGroups.map((g) => (
                <li
                  key={g.key}
                  className="rounded border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 px-2 py-1.5 space-y-1"
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <BossSeverityChip severity={g.severity} />
                    <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
                      {bossScopeLabel(g.targetId)}
                    </span>
                    {g.unresolvedBlocker ? (
                      <span className="text-[10px] italic text-amber-700 dark:text-amber-300">
                        raised once, not revisited
                      </span>
                    ) : null}
                  </div>
                  <BossVerdictBody group={g} />
                </li>
              ))}
            </ul>
          ) : null}
          {routedCounts.length > 0 ? (
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {routedCounts.map((rc, i) => (
                <span key={rc.label}>
                  {i > 0 ? " · " : ""}
                  {rc.n} on {rc.label}
                </span>
              ))}{" "}
              — shown inline with the element below.
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
