/**
 * Pure helpers for the finding-card surface — short-action labels,
 * glyphs, subject lines, match-finding classification, and child-FV
 * subsumption.
 *
 * Extracted from `AuditSidebarPanel.tsx` so the card components in
 * `./findingCard.tsx` and the list / summary code in the main file
 * can share one source of truth without a circular import. Pure
 * functions — no React, no hooks.
 */

import type {
  AuditFinding,
  AuditReport,
  Severity,
} from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { firstBacktick } from "./rationaleText";
import {
  factorMatchVariant,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";
import { isActionPrefixRationale } from "./auditorDetails";
import { SEVERITY_RANK, TARGET_KIND_LABEL } from "./auditPresentation";
import { parseTargetId } from "./targetIds";

// ---------------------------------------------------------------------------
// Action label + glyph — what verb does the card header announce
// ---------------------------------------------------------------------------

/** Short action-flavored label for a finding's outer header, used
 *  when the new per-element editor renders below (the editor's title
 *  row already carries the entity identity, so the outer header just
 *  needs to say what kind of action is being proposed).
 *  Examples:
 *    - calibration_factor_extra            → "Add factor"
 *    - calibration_factor_gold_only_miss   → "Remove factor"
 *    - calibration_factor_match_near       → "Factor near-match"
 *    - calibration_agent_extra             → "Add tag"
 *    - calibration_gold_only_miss          → "Remove tag"
 *    - generic factor / tag findings       → "Factor" / "Tag" */
export function findingActionLabel(finding: AuditFinding): string {
  // Declarative verbs ("Add tag" / "Remove factor" / etc.) instead of
  // the older "Proposed ..." nouns. Per Paul 2026-05-21: the agent's
  // recommendation reads more cleanly when the action is stated
  // directly. The leading glyph (rendered by the caller) carries the
  // +/− / Δ semantics.
  const code = finding.issue_code;
  if (code === "calibration_factor_extra") return "Add factor";
  if (code === "calibration_agent_extra") return "Add tag";
  if (code === "calibration_factor_gold_only_miss") return "Remove factor";
  if (code === "calibration_gold_only_miss") return "Remove tag";
  if (code === "calibration_factor_match_exact") return "Factor match";
  if (code === "calibration_factor_match_near") return "Factor near-match";
  if (code === "calibration_factor_rename") return "Rename factor";
  if (code === "calibration_factor_partition_mismatch") {
    // Always "Modify factor values". The finer/coarser axis is a
    // within-factor FV reorganization, not a split/merge of two
    // distinct factors — the older verbs ("Split factor into two" /
    // "Combine two factors") implied the latter and were misleading.
    // The mapping table below the header carries the direction signal.
    return "Modify factor values";
  }
  if (code === "calibration_match") return "Tag match";
  return TARGET_KIND_LABEL[finding.target_kind] || finding.target_kind;
}

/** Leading glyph for the finding's action label. Visually keys the
 *  row to the kind of change being proposed without needing to read
 *  the verb:
 *    + add (factor / tag)
 *    − remove (factor / tag)
 *    Δ modify partition (split / combine)
 *    no glyph for matches (the OK / NEAR badge carries status). */
export function findingActionGlyph(finding: AuditFinding): string | null {
  const code = finding.issue_code;
  if (code === "calibration_factor_extra") return "+";
  if (code === "calibration_agent_extra") return "+";
  if (code === "calibration_factor_gold_only_miss") return "−";
  if (code === "calibration_gold_only_miss") return "−";
  if (code === "calibration_factor_partition_mismatch") return "Δ";
  return null;
}

// ---------------------------------------------------------------------------
// Subject label — descriptive identifier after the em-dash on the header
// ---------------------------------------------------------------------------

/** Descriptive subject for a finding — appended after the action
 *  label so collapsed cards read like "Proposed factor —
 *  `treatment` (rotenone / reference)" instead of just "Proposed
 *  factor". The subject is built from the most specific source
 *  available:
 *
 *  - `partition_mismatch` payload: the shared category label on
 *    either side of the link.
 *  - `proposer_term` (tag findings with a structured proposer
 *    suggestion): the category:value pair.
 *  - First backticked token in the rationale: the agent's convention
 *    for naming the load-bearing factor / tag.
 *
 *  For factor-extras the agent's proposed FVs are appended as a
 *  short fingerprint so multi-factor-same-category designs (e.g. two
 *  `genotype` factors) read as visually distinct even when collapsed. */
export function findingSubjectLabel(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): string | null {
  if (finding.partition_mismatch) {
    // Header subject is just the category label — no FV umbrella
    // suffix. For partition_mismatch the curator's question is
    // "which factor", not "which level". The mapping table below
    // carries the per-level detail.
    const pm = finding.partition_mismatch;
    const category = pm.gold.category.label || pm.agent.category.label || "";
    return category || null;
  }
  const code = finding.issue_code;
  const backtick = firstBacktick(finding.rationale);

  // Build the non-baseline label list from any factor's FVs.
  // Baselines (FactorValue.is_baseline) are excluded: "reference
  // substance role" and its peers don't describe the factor, they
  // describe the baseline of the factor. The formatLevels caller
  // decides how to render the +/- shorthand.
  const nonBaselineLabels = (
    factor: {
      factor_values?: Array<{
        free_text_label?: string;
        is_baseline?: boolean;
      }>;
    } | null | undefined,
  ): { labels: string[]; hadBaseline: boolean } => {
    const fvs = factor?.factor_values ?? [];
    const labels = fvs
      .filter((fv) => !fv.is_baseline)
      .map((fv) => fv.free_text_label?.trim())
      .filter((s): s is string => !!s);
    const hadBaseline = fvs.some((fv) => fv.is_baseline);
    return { labels, hadBaseline };
  };

  if (code === "calibration_factor_extra") {
    const cp = report?.evidence?.comparison_proposal ?? null;
    const agent = resolveAgentFactor(finding, cp, backtick);
    const name = agent?.category.label || backtick;
    if (!name) return null;
    const { labels, hadBaseline } = nonBaselineLabels(agent);
    return formatLevels(name, labels, hadBaseline);
  }
  if (code === "calibration_factor_gold_only_miss") {
    // Gold has the factor; agent wants it removed. The category
    // alone ("cell line") doesn't tell the curator WHICH cell-line
    // factor — pull the gold factor's non-baseline FVs from the
    // live design so the header reads as "cell line: HeLa +/-".
    const gold = resolveGoldFactor(
      finding,
      design?.factors ?? [],
      backtick,
    );
    const name = gold?.category.label || backtick;
    if (!name) return null;
    const { labels, hadBaseline } = nonBaselineLabels(gold);
    return formatLevels(name, labels, hadBaseline);
  }
  if (
    code === "calibration_factor_match_exact" ||
    code === "calibration_factor_match_near" ||
    code === "calibration_factor_rename"
  ) {
    // Match-side findings already pair an agent factor; same shape so
    // multi-factor-same-category designs read as distinct without
    // bouncing tabs.
    const cp = report?.evidence?.comparison_proposal ?? null;
    const agent = resolveAgentFactor(finding, cp, backtick);
    const name = agent?.category.label || backtick;
    if (!name) return null;
    const { labels, hadBaseline } = nonBaselineLabels(agent);
    return formatLevels(name, labels, hadBaseline);
  }
  if (code === "calibration_agent_extra" && finding.proposer_term?.label) {
    return finding.proposer_term.label;
  }
  return backtick;
}

/** Format a factor's category + non-baseline level labels for the
 *  collapsed-card subject. Three shapes:
 *
 *  - 1 non-baseline + a baseline → `<category>: <level> +/-` (the
 *    canonical binary "treatment vs control" shape).
 *  - 2+ non-baseline → `<category>: <a> / <b>[ / …]` with an optional
 *    `+/-` suffix when there's also a baseline.
 *  - 0 non-baseline → bare `<category>`. */
function formatLevels(
  category: string,
  nonBaselineLabels: string[],
  hadBaseline: boolean,
): string {
  if (nonBaselineLabels.length === 0) return category;
  if (nonBaselineLabels.length === 1) {
    return hadBaseline
      ? `${category}: ${nonBaselineLabels[0]} +/-`
      : `${category}: ${nonBaselineLabels[0]}`;
  }
  const head = nonBaselineLabels.slice(0, 2).join(" / ");
  const tail = nonBaselineLabels.length > 2 ? " / …" : "";
  const baselineNote = hadBaseline ? " +/-" : "";
  return `${category}: ${head}${tail}${baselineNote}`;
}

// ---------------------------------------------------------------------------
// Match-finding classification — which findings collapse to a green-check row
// ---------------------------------------------------------------------------

/** A finding the curator should default-skip — agent and gold agree.
 *  Renders as a compact ✓ / ≈ row instead of a full action card.
 *
 *  Subtle: there's an `apply_action.kind === "match"` axis too (set
 *  by the agent-side calibration finding builder, covers all
 *  calibration target_id shapes); this one keys on the `issue_code`
 *  suffix. Both are downstream of "is this a curator-agrees-with-agent
 *  match" but evaluate against different signals — if my brother ever
 *  emits a match-shaped finding without the canonical issue_code
 *  suffix, the two will disagree. Extract a shared
 *  `isMatchFinding` + `findingTagKey` pair if that becomes real. */
export function isMatchFinding(f: AuditFinding): boolean {
  // Tag-side: `calibration_match` (severity ok). Factor-side: the
  // 2026-05-18 split (agents-repo `f313770`) emits
  // `calibration_factor_match_exact` (ok) and
  // `calibration_factor_match_close` (minor). Older builds emit a
  // single `calibration_factor_match` at severity ok for both cases.
  // We treat ALL of these as match findings — the green-check row
  // renders the curator-skippable cases (exact / ok legacy) and
  // surfaces close matches with a minor-severity chip so the curator
  // gets the "peek to confirm" cue without losing the compact
  // match-row affordance.
  if (f.issue_code === "calibration_match") return f.severity === "ok";
  // Reconciled-at-build findings — the consensus design already
  // reflects the agent's proposed change. Render as a compact match
  // row so the curator skips them by default.
  if (f.issue_code === "already_in_baseline") return f.severity === "ok";
  // calibration_factor_match_near goes through ComparisonFactorCard
  // (the dedicated side-by-side render), NOT the generic
  // CompactFindingCard match-row. Per Paul 2026-06-08: the editor's
  // "Everyone agrees" computation is structurally wrong when the
  // agent's factor has more FVs than gold's (4 vs 2 in GSE93824);
  // the side-by-side card shows the divergence honestly. Routed via
  // isRenameMatch below.
  if (f.issue_code === "calibration_factor_match_near") return false;
  const v = factorMatchVariant(f.issue_code);
  if (v === "exact") return true;
  if (v === "near") return true;
  if (v === "legacy") {
    // Legacy `calibration_factor_match`: severity=ok is a match;
    // severity!=ok is a category rename and goes through
    // `RenameFindingCard` instead — see `isRenameMatch`.
    return f.severity === "ok";
  }
  // Forward-compat: any other severity=ok issue whose code ends in
  // `_match` is a match too.
  if (f.severity !== "ok") return false;
  return /(^|_)match$/.test(f.issue_code);
}

/** A factor-match finding with non-ok severity is the arbiter's way
 *  of flagging a **category rename** — same factor, different label
 *  (the only path to a non-ok `calibration_factor_match` per the v4
 *  arbiter wire, HANDOFF_2026-05-16_DEFENDER_ARBITER.md). Pulled out
 *  of the actionable bucket and rendered as a diff card instead of a
 *  generic finding card so the curator sees agent ≈ Gemma at a glance
 *  rather than having to read the rationale prose.
 *
 *  Only matches the legacy `calibration_factor_match` code: the
 *  post-2026-05-18 split moved close matches to their own `_close`
 *  code (which goes through the match-row path with a minor chip)
 *  and gave renames their own dedicated `calibration_factor_rename`
 *  code — that one isn't classified here because it doesn't share
 *  the `factor_match` family. */
export function isRenameMatch(f: AuditFinding): boolean {
  // Dedicated rename code (calibration package v11+, agents-repo
  // 2026-06-08 entity-frame finding_generator). Same-factor-different-
  // category, always routes through the dedicated rename card.
  if (f.issue_code === "calibration_factor_rename") return true;
  // Partition-mismatch flavor (agent split / collapsed gold's FVs)
  // also routes through the dedicated side-by-side card. Same data
  // shape (rename payload + agent/gold target indexes), different
  // title and rationale framing handled inside ComparisonFactorCard.
  if (f.issue_code === "calibration_factor_match_near") return true;
  // Legacy: severity-driven on the generic match code.
  return (
    f.issue_code === "calibration_factor_match" && f.severity !== "ok"
  );
}

// ---------------------------------------------------------------------------
// FV subsumption — when a parent factor finding swallows its FV children
// ---------------------------------------------------------------------------

/** Children FV findings whose parent factor finding subsumes them —
 *  used by the cascade-disposition path so a parent's accept / dismiss
 *  reaches every FV the audit also flagged on the same factor, and
 *  used by the card's "+ N FVs cascaded" hint so the curator sees
 *  what's about to ride along.
 *
 *  Subsumption rule: child must share the parent's `factorSlug` AND
 *  carry severity ≥ parent (lower-or-equal severity rank, since the
 *  rank is "lower number = more severe"). The severity gate keeps the
 *  disposition cascade in lockstep — a blocker child under a minor
 *  parent shouldn't auto-dismiss when the parent does. Returns [] for
 *  non-factor parents and for findings whose target_id doesn't parse. */
export function subsumedFvChildren(
  parentFinding: AuditFinding,
  allFindings: AuditFinding[],
): AuditFinding[] {
  if (parentFinding.target_kind !== "factor") return [];
  const p = parseTargetId(parentFinding.target_id);
  if (p?.kind !== "factor") return [];
  const parentRank: number = SEVERITY_RANK[parentFinding.severity as Severity];
  const out: AuditFinding[] = [];
  for (const f of allFindings) {
    if (f.target_kind !== "fv") continue;
    const c = parseTargetId(f.target_id);
    if (c?.kind !== "fv") continue;
    if (c.factorSlug !== p.factorSlug) continue;
    if (SEVERITY_RANK[f.severity as Severity] < parentRank) continue;
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Short "why" caption for the collapsed card header
// ---------------------------------------------------------------------------

/** Short inline "why was this proposed?" caption — sits next to the
 *  finding title on the SAME line. Picks the most curator-readable
 *  source available:
 *
 *    1. `finding.suggested_fix` — already a short action verb in
 *       most cases ("Add the agent's tag"); the agent emits this
 *       deliberately as a one-liner.
 *    2. First clause / phrase of `finding.rationale` (cut at the
 *       first comma, semicolon, period, or newline) capped at ~50
 *       chars — the audit judge's reasoning, trimmed hard so it
 *       fits beside the title without wrapping.
 *    3. Same trim on `finding.proposer_defense`.
 *    4. `null` when nothing usable is available — caller skips the
 *       inline span.
 *
 *  Per Paul 2026-06-11: "it would be EXTREMELY helpful to have a
 *  one-line summary of WHY the proposal is made; 'Agent didn't
 *  propose', 'Redundant', …" and (follow-up): "keep the text on the
 *  same line as the title and shorten it." Agent-side `suggested_fix`
 *  quality varies; the bro-side handoff to write more curator-readable
 *  one-liners is open. */
export function findingShortRationale(finding: AuditFinding): string | null {
  const max = 50;
  const trim = (s: string | null | undefined): string => {
    if (!s) return "";
    const trimmed = s.trim();
    if (!trimmed) return "";
    // Skip strings that just restate the action verb from the title
    // ("Add tag ...", "Remove factor ...", etc.) — those are pure
    // redundancy next to the `findingActionLabel`. Paul 2026-06-11:
    // "now it says 'add tag' etc. twice!"
    if (isActionPrefixRationale(trimmed)) return "";
    // Cut at the first clause boundary — comma / semicolon / period /
    // newline. Yields the leading noun-phrase / verb-phrase rather
    // than a full sentence.
    const clauseEnd = trimmed.search(/[,;.\r\n]/);
    const head = clauseEnd > 0 ? trimmed.slice(0, clauseEnd) : trimmed;
    if (head.length <= max) return head;
    // Hard cap with word-boundary backoff when the clause is still
    // longer than the inline budget.
    const cut = head.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
  };
  const fix = trim(finding.suggested_fix);
  if (fix) return fix;
  const rationale = trim(finding.rationale);
  if (rationale) return rationale;
  const defense = trim(finding.proposer_defense);
  if (defense) return defense;
  return null;
}
