/**
 * Visual primitives for the audit-finding card chrome — badges,
 * pills, dots, and glyphs. Extracted from `AuditSidebarPanel.tsx`
 * (which was approaching 6700 lines and conflating one finding
 * card's worth of state with the entire bottom-of-page lookup
 * tables). Each component is self-contained: a pure function of
 * its props plus the `useAudit()` hook where cross-finding
 * navigation is needed.
 *
 * Owner of the issue-code mapping table (`ISSUE_CODE_RENDER`) too,
 * so when bro lands a new code the table edit + the fallback
 * rendering both live in one file.
 *
 * Helpers and constants (severity ranks, verdict strength,
 * displaySeverity, severityTextCls / severityBorderCls) live in
 * `auditPresentation.ts` — pure data, no JSX.
 */

import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
  CurationReviewKind,
  Severity,
} from "@/api/auditTypes";

import { useAudit, findingKey } from "./AuditContext";
import { firstBacktick } from "./rationaleText";
import {
  isCloseFactorMatch,
  isExactFactorMatch,
  isNearMatchFinding,
} from "./factorMatch";
import { TARGET_KIND_LABEL, verdictStrength } from "./auditPresentation";

// ---------------------------------------------------------------------------
// Issue-code badge — small typed chip showing what kind of finding
// ---------------------------------------------------------------------------

export function IssueCodeBadge({ issueCode }: { issueCode: string }) {
  const mapping = ISSUE_CODE_RENDER[issueCode];
  if (!mapping) {
    return (
      <span
        className="font-mono text-[10px] text-slate-500 dark:text-slate-400"
        title={issueCode}
      >
        {issueCode}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        mapping.cls,
      )}
      title={issueCode}
    >
      <span className="font-mono leading-none">{mapping.glyph}</span>
      <span>{mapping.label}</span>
    </span>
  );
}

/** Render mapping for known `issue_code` values. The glyph is the
 *  scannable cue; the label is a one-word shape hint. Tones: green
 *  for "extra" (positive — something to consider adding), slate for
 *  "missing"/"match" (neutral readout), amber for "needs change",
 *  emerald-faint for "ok". When my brother adds new codes, they
 *  render as raw `font-mono` text via the fallback above until this
 *  map gets entries. */
export const ISSUE_CODE_RENDER: Record<
  string,
  { glyph: string; label: string; cls: string }
> = {
  // Calibration triplet — agent vs. gold.
  calibration_agent_extra: {
    glyph: "+",
    label: "extra",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-800 " +
      "dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200",
  },
  calibration_gold_only_miss: {
    glyph: "−",
    label: "missing",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  calibration_match: {
    glyph: "=",
    label: "match",
    cls:
      "bg-slate-50 border-slate-200 text-slate-600 " +
      "dark:bg-slate-800/40 dark:border-slate-700 dark:text-slate-300",
  },
  // Phase-1 audit judges — anything signalling "this needs fixing"
  // gets the delta glyph; coverage / baseline gaps share "−".
  forbidden_efc: {
    glyph: "Δ",
    label: "fix",
    cls:
      "bg-amber-50 border-amber-200 text-amber-800 " +
      "dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200",
  },
  ungrounded_term: {
    glyph: "Δ",
    label: "ground",
    cls:
      "bg-amber-50 border-amber-200 text-amber-800 " +
      "dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200",
  },
  low_confidence_assignment: {
    glyph: "Δ",
    label: "review",
    cls:
      "bg-amber-50 border-amber-200 text-amber-800 " +
      "dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200",
  },
  missing_baseline: {
    glyph: "−",
    label: "baseline",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  coverage_zero: {
    glyph: "−",
    label: "coverage",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  ok: {
    glyph: "✓",
    label: "ok",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-700 " +
      "dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300",
  },
  // Emitted by the consensus-build reconciliation pass: a finding's
  // apply_action is already reflected in the baseline design (e.g. the
  // agent re-proposed a tag the curators previously accepted, so it's
  // already there). Rendered as a compact green-check match so curators
  // don't waste time re-deciding settled questions.
  already_in_baseline: {
    glyph: "✓",
    label: "already current",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-700 " +
      "dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300",
  },
  // Chip-diff synthetic findings — curator's accept / dismiss /
  // add-solo / modify framing when one slot in the comparison view
  // holds a curator's polished Design. The label is the curator's
  // ACTION, not the raw issue_code; the underlying code stays in the
  // hover title for debugging.
  chipdiff_factor_accepted: {
    glyph: "✓",
    label: "accepted",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-700 " +
      "dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300",
  },
  chipdiff_factor_added_solo: {
    glyph: "+",
    label: "added",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-800 " +
      "dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200",
  },
  chipdiff_factor_dismissed: {
    glyph: "×",
    label: "dismissed",
    cls:
      "bg-rose-50 border-rose-200 text-rose-800 " +
      "dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-200",
  },
  chipdiff_factor_modified: {
    glyph: "~",
    label: "modified",
    cls:
      "bg-amber-50 border-amber-200 text-amber-800 " +
      "dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200",
  },
  chipdiff_factor_added: {
    glyph: "+",
    label: "added",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  chipdiff_factor_removed: {
    glyph: "−",
    label: "removed",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  chipdiff_tag_accepted: {
    glyph: "✓",
    label: "accepted",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-700 " +
      "dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300",
  },
  chipdiff_tag_added_solo: {
    glyph: "+",
    label: "added",
    cls:
      "bg-emerald-50 border-emerald-200 text-emerald-800 " +
      "dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200",
  },
  chipdiff_tag_dismissed: {
    glyph: "×",
    label: "dismissed",
    cls:
      "bg-rose-50 border-rose-200 text-rose-800 " +
      "dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-200",
  },
  chipdiff_tag_added: {
    glyph: "+",
    label: "added",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
  chipdiff_tag_removed: {
    glyph: "−",
    label: "removed",
    cls:
      "bg-slate-100 border-slate-300 text-slate-700 " +
      "dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200",
  },
};

// ---------------------------------------------------------------------------
// Cross-finding linkage chips — paired-finding + consequent-of jumps
// ---------------------------------------------------------------------------

/** Small "↔ paired" pill rendered on findings carrying a
 *  `paired_finding_id`. Both halves of a demoted same-category
 *  factor match (calibration_factor_extra + _factor_gold_only_miss
 *  emitted by the partition-mismatch demotion path) share the
 *  same UUID, so clicking the badge jumps to the sibling — same
 *  scroll-and-expand path the inline-dot resolver uses. Renders
 *  nothing when the finding isn't part of a demotion pair, or
 *  when the report has no sibling carrying the same UUID. */
export function PairedFindingBadge({ finding }: { finding: AuditFinding }) {
  const { report, setActiveFindingKey } = useAudit();
  const pairId = finding.paired_finding_id;
  if (!pairId) return null;
  const sibling = (report?.findings ?? []).find(
    (f) =>
      f.paired_finding_id === pairId && f.target_id !== finding.target_id,
  );
  if (!sibling) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setActiveFindingKey(findingKey(sibling));
      }}
      title={`Paired with ${TARGET_KIND_LABEL[sibling.target_kind]} ${sibling.target_id} — click to jump`}
      className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1 py-0 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/30"
    >
      ↔ paired
    </button>
  );
}

/** Cross-link chips for the bidirectional `consequent_of` /
 *  `consequents` linkage (HANDOFF_2026-05-20_CONSEQUENT_OF_BIDIRECTIONAL).
 *  Both halves are conceptually one curator decision — agent's
 *  finer partition on factor A absorbs the partition gold encoded
 *  in factor B, so removing B is a consequence of accepting A's
 *  split. The chips make the linkage visible from either card.
 *
 *  Silently skips entries whose target_id can't be resolved in the
 *  current report (defensive against partial round-trips). */
export function ConsequentsBadges({ finding }: { finding: AuditFinding }) {
  const { report, setActiveFindingKey } = useAudit();
  const findings = report?.findings ?? [];
  const chips: Array<{
    key: string;
    label: string;
    title: string;
    onClick: () => void;
  }> = [];

  if (finding.consequent_of) {
    const upstream = findings.find(
      (f) => f.target_id === finding.consequent_of,
    );
    if (upstream) {
      const label = firstBacktick(upstream.rationale) ?? upstream.target_id;
      chips.push({
        key: `up-${upstream.target_id}`,
        label: `← absorbed by \`${label}\` split`,
        title: `This finding is a consequence of the partition mismatch on ${upstream.target_id} — click to jump.`,
        onClick: () => setActiveFindingKey(findingKey(upstream)),
      });
    }
  }
  for (const childId of finding.consequents ?? []) {
    const downstream = findings.find((f) => f.target_id === childId);
    if (!downstream) continue;
    const label = firstBacktick(downstream.rationale) ?? downstream.target_id;
    chips.push({
      key: `down-${childId}`,
      label: `implies removal of \`${label}\``,
      title: `Accepting this partition mismatch implies removing ${childId} — click to jump.`,
      onClick: () => setActiveFindingKey(findingKey(downstream)),
    });
  }
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            c.onClick();
          }}
          title={c.title}
          // Action-style chip — solid violet fill + chevron icon so
          // the curator reads it as clickable navigation, not a
          // passive label. Distinct from the outlined-only
          // notification chips (ProposerFlagsChips,
          // PairedFindingBadge, severity badges) that don't dispatch
          // any action on click.
          className="ml-1 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600 shadow-sm"
        >
          {c.label}
          <span aria-hidden className="text-[10px] leading-none">
            ›
          </span>
        </button>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Proposer flags + debate badge — informational chips from the agent side
// ---------------------------------------------------------------------------

/** "Pipeline flagged" chip rendered when the proposer-side
 *  deterministic detectors (S2j / S2m) fired on this finding's
 *  factor. Lets the curator know upfront that a structural pattern
 *  was already detected without having to dig through the subtask
 *  trail. Renders nothing when `flags` is empty or absent. Unknown
 *  slugs are silently skipped so new agent-side detectors can ship
 *  without lockstep UI changes. */
export function ProposerFlagsChips({ flags }: { flags?: string[] }) {
  if (!flags || flags.length === 0) return null;
  const configs: Record<string, { label: string; title: string }> = {
    multi_factor_collapse: {
      label: "⚑ may be 2 factors",
      title:
        "Agent's pattern check noticed values that look like a cross-product of two variables (e.g. \"wild-type × Cre+\"). This may belong as two separate factors.",
    },
    multi_factor_split: {
      label: "⚑ may be 2 factors",
      title:
        "Agent's pattern check noticed values sharing a stem with varying suffix (e.g. \"rotenone 3h\" / \"rotenone 3d\"). This may belong as treatment + timepoint factors.",
    },
  };
  return (
    <>
      {flags.map((flag) => {
        const cfg = configs[flag];
        if (!cfg) return null;
        return (
          <span
            key={flag}
            // Notification-style — outlined only, no fill, no
            // hover. Reads as a passive "pipeline flagged this"
            // label, not a button. Distinct from ConsequentsBadges
            // which DO dispatch an action on click.
            className="ml-1 inline-flex items-center text-[10px] tracking-wide font-normal italic px-1 py-0 rounded border border-dashed border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400 cursor-default"
            title={cfg.title}
          >
            {cfg.label}
          </span>
        );
      })}
    </>
  );
}

/** Debate-pipeline badge — signals how the agent's internal
 *  propose/challenge/defend/arbitrate loop ended. Labels avoid the
 *  medal-quality metaphor that misled curators ("★ gold" reads as
 *  endorsement) and frame the badges as consensus signals.
 *
 *  Suppressed entirely when the defender verdict downgraded to
 *  "weak" — the defender is the rigorous second-opinion judge and
 *  showing both a "debate said it's fine" badge next to a "WEAK
 *  SUGGESTION" panel reads as the surface contradicting itself. */
export function DebateBadgeChip({
  badge,
  defenderVerdict,
}: {
  badge: string | undefined;
  defenderVerdict?: AttachedDefenderVerdict | null;
}) {
  if (!badge) return null;
  const strength =
    defenderVerdict?.strength ?? verdictStrength(defenderVerdict?.verdict);
  if (strength === "weak") return null;
  const configs: Record<
    string,
    { label: string; title: string; cls: string }
  > = {
    platinum: {
      label: "✓ verified",
      title: "debate: human-verified outcome",
      cls:
        "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    },
    gold: {
      label: "✓ unchallenged",
      title:
        "debate: no challenger raised an objection — not an evidence-quality signal",
      cls:
        "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    },
    silver: {
      label: "✓ settled",
      title: "debate: settled after one contested round",
      cls:
        "bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-600/50 dark:border-slate-500 dark:text-slate-200",
    },
    bronze: {
      label: "★ contested",
      title: "debate: settled after multiple contested rounds",
      cls:
        "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300",
    },
    stuck: {
      label: "!! needs call",
      title: "debate: no consensus — needs human call",
      cls:
        "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
    },
  };
  const cfg = configs[badge];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border ml-1",
        cfg.cls,
      )}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Left-edge status indicators — disposition dot, severity badge, match badge
// ---------------------------------------------------------------------------

/** Quiet status dot replacing the SeverityBadge once the curator has
 *  dispositioned a finding. Once acted on, the finding is no longer
 *  MAJOR / BLOCKER — it's just done. So the whole card fades and the
 *  big severity stamp drops out; a small ✓ / × keeps a visual marker
 *  of what verdict was given (full info in the tooltip). */
export function DispositionDot({
  status,
  resolved,
  severity,
}: {
  status: "accepted" | "dismissed" | "needs_more_info";
  resolved: boolean;
  severity: Severity;
}) {
  // Per Paul 2026-05-27: the original tiny grey-on-grey ✓/× was
  // unreadable next to the kind-tinted card chrome. Bump to a
  // padded square badge with explicit emerald (accepted) / rose
  // (dismissed) / slate (parked) so the curator can scan a card
  // grid and see verdicts at a glance. Same shape + sizing as
  // SeverityBadge so the left-edge slot reads as one design system.
  const cfg =
    status === "accepted"
      ? {
          glyph: "✓",
          cls:
            "bg-emerald-500 text-white border-emerald-600 " +
            "dark:bg-emerald-600 dark:border-emerald-700",
          title: `${resolved ? "resolved" : "agreed (follow-up owed)"} — was ${severity}`,
        }
      : status === "dismissed"
        ? {
            glyph: "✗",
            cls:
              "bg-rose-500 text-white border-rose-600 " +
              "dark:bg-rose-600 dark:border-rose-700",
            title: `dismissed — was ${severity}`,
          }
        : {
            glyph: "⋯",
            cls:
              "bg-slate-300 text-slate-800 border-slate-400 " +
              "dark:bg-slate-600 dark:text-slate-100 dark:border-slate-500",
            title: `parked — was ${severity}`,
          };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "rounded border font-bold leading-none",
        "h-6 w-6 text-[14px]",
        cfg.cls,
      )}
      title={cfg.title}
      aria-label={cfg.title}
    >
      {cfg.glyph}
    </span>
  );
}

/** Severity badge — colored square in the card-header status slot
 *  showing how serious the finding is. Optional `glyph` overrides
 *  the default severity icon (used for +/−/Δ action glyphs in the
 *  same slot); colour stays severity-driven. */
export function SeverityBadge({
  severity,
  glyph,
  kind,
}: {
  severity: Severity;
  /** When supplied, the badge renders THIS glyph (e.g. +/−/Δ for
   *  add / remove / modify actions) instead of the default
   *  severity icon. The color still encodes severity; the glyph
   *  encodes the action. */
  glyph?: string | null;
  /** Review kind drives the badge's verbal axis. For `audit` the
   *  finding signals "how broken is this" (severity: blocker /
   *  major / minor / ok). For `proposal` the same axis reads as
   *  "how confident is the agent in this suggestion" — the data
   *  doesn't change but the framing does, since a proposal isn't
   *  flagging an existing problem. */
  kind?: CurationReviewKind;
}) {
  const config = {
    blocker: {
      icon: "⛔",
      cls: "bg-rose-600 text-white border border-rose-700",
      severityLabel: "blocker",
      confidenceLabel: "high confidence",
    },
    major: {
      icon: "⚠",
      cls: "bg-amber-500 text-amber-950 border border-amber-600",
      severityLabel: "major",
      confidenceLabel: "confident",
    },
    minor: {
      // The thin "·" (U+00B7) was illegible even at 14px (Paul
      // 2026-05-25 round 2). U+2022 "•" (bullet) is a fatter glyph
      // that reads at the badge's size; paired with a filled slate
      // background it signals "low-severity flag" clearly without
      // mimicking blocker/major chrome.
      icon: "•",
      cls:
        "bg-slate-200 text-slate-700 border border-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-500",
      severityLabel: "minor",
      confidenceLabel: "medium confidence",
    },
    ok: {
      icon: "✓",
      cls: "bg-emerald-600 text-white border border-emerald-700",
      severityLabel: "ok",
      confidenceLabel: "noted",
    },
  }[severity];
  const label =
    kind === "proposal" ? config.confidenceLabel : config.severityLabel;
  return (
    <StatusBadge
      glyph={glyph || config.icon}
      cls={config.cls}
      label={label}
    />
  );
}

/** Status badge for a factor / tag MATCH finding — the colored
 *  square in the card-header's status slot. Mirrors SeverityBadge
 *  visually so match cards align with actionable cards along the
 *  same left edge.
 *
 *    ✓ emerald — exact match (calibration_factor_match_exact)
 *    ≈ amber   — near / close match (any other match code, incl.
 *                 legacy `calibration_factor_match` at ok severity
 *                 and the tag-side `calibration_match`)
 *
 *  Returns null when the finding isn't a match code — the caller
 *  falls back to `SeverityBadge` for non-match findings. */
export function MatchBadge({ finding }: { finding: AuditFinding }) {
  if (isExactFactorMatch(finding)) {
    return (
      <StatusBadge
        glyph="✓"
        cls="bg-emerald-600 text-white border border-emerald-700"
        label="exact match — labels + URIs line up"
      />
    );
  }
  if (
    isCloseFactorMatch(finding) ||
    finding.issue_code === "calibration_match"
  ) {
    return (
      <StatusBadge
        glyph="≈"
        cls="bg-amber-500 text-amber-950 border border-amber-600"
        label="near match — peek to confirm; small differences may exist"
      />
    );
  }
  return null;
}

/** Inline pie-slice glyph encoding the judge's strength verdict on
 *  a finding — shown in the collapsed card header next to the
 *  action label so the curator can scan judge confidence without
 *  expanding each card.
 *
 *    ◔ weak     (amber)
 *    ◑ moderate (slate)
 *    ● strong   (emerald)
 *    (nothing rendered when no judge has weighed in)
 *
 *  Reads like a completeness gradient — empty → filled — which the
 *  curator can intuit without a legend. Hover title spells it out
 *  for screen-readers and accessibility.
 *
 *  Strength source mirrors AgentSuggestionPanel: prefer the
 *  explicit `defender_verdict.strength` when present (newer
 *  payloads); fall back to deriving from `verdict` via
 *  `verdictStrength()` for backward compat. */
export function JudgeStrengthGlyph({ finding }: { finding: AuditFinding }) {
  const dv = finding.defender_verdict ?? null;
  if (!dv) return null;
  const strength = dv.strength ?? verdictStrength(dv.verdict);
  if (!strength) return null;
  // Tooltip reframes the strength glyph on near-match findings
  // (Paul 2026-05-21 redesign — GSE93824 case). For those the
  // factor-level proposal is the right call and the disagreement
  // is at the FV level; the green disc reads as "factor-level
  // match", not "the whole proposal is strong". Extra / gold-only-
  // miss / partition-mismatch findings keep the original framing —
  // there the strength refers to the whole-factor decision.
  const isNearMatch = isNearMatchFinding(finding);
  const config = {
    weak: {
      glyph: "◔",
      cls: "text-amber-600 dark:text-amber-400",
      label: isNearMatch
        ? "Judge: factor-level proposal looks weak"
        : "AI judge says this proposal is weak",
    },
    moderate: {
      glyph: "◑",
      cls: "text-slate-500 dark:text-slate-400",
      label: isNearMatch
        ? "Judge: factor-level proposal is moderate"
        : "AI judge says this proposal is moderate",
    },
    strong: {
      glyph: "●",
      cls: "text-emerald-600 dark:text-emerald-400",
      label: isNearMatch
        ? "Judge: factor-level proposal is a good call"
        : "AI judge says this proposal is strong",
    },
  }[strength];
  return (
    <Tooltip label={config.label}>
      <span
        className={cn(
          "inline-block mr-1 text-[12px] leading-none",
          config.cls,
        )}
        aria-label={config.label}
      >
        {config.glyph}
      </span>
    </Tooltip>
  );
}
