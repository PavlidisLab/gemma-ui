/**
 * Agent-side detail panels rendered inside an expanded finding card —
 * the "what does the AI actually say" surface that sits below the
 * card header and above the disposition buttons. Components here:
 *
 *   - `AgentSuggestionPanel` — the boxed suggestion block (Judge row +
 *     supporting-evidence blockquotes + optional legacy proposer text
 *     + fix override copy). Strength-tinted (amber = weak / emerald =
 *     strong / slate = neutral) so the curator's eye picks the lean
 *     before reading.
 *   - `FindingEvidenceBlock` — one evidence quote, with collapsed-by-
 *     default expanded `context` view and yellow-highlighted anchor
 *     ranges. Used inside the panel above.
 *   - `InlineSubtaskReasoning` — under-header chip list of S2j /
 *     S7_coverage / S8 evidence rows scoped to this finding's factor.
 *   - `DispositionNoteRow` — italic quote-back of the curator's
 *     stored note with an `✎ edit` affordance.
 *
 * Helpers stay co-located with the components that use them
 * (`shortFixForVerdict`, `stripContextHeader`,
 * `renderHighlightedContext`, `findingFactorLabel`,
 * `subtaskDecisionsForFactor`). All four components are pure props +
 * the `useAudit` / draft state they read via downstream helpers, no
 * shared local state between them.
 *
 * Extracted from `AuditSidebarPanel.tsx` (Paul 2026-06-10 mega-file
 * sweep).
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
} from "@/api/auditTypes";
import type { SubtaskDecision } from "@/api/types";

import {
  AGENT_NO_DETAILS_SENTINEL,
  isActionPrefixRationale,
  isProposerSuggestionRedundant,
  isSuggestedFixRedundant,
  parseProposerSuggestion,
  pickJudgeRowText,
  s10MatchesHeaderUri,
} from "./auditorDetails";
import { evidenceSourceMeta } from "./evidenceSource";
import { parseEvidenceLocation } from "./evidenceLocation";
import { findingLean, leanSuggestionLabel } from "./defenderLean";
import { parsePrefixedNote } from "./dispositionEdit";
import { isNearMatchFinding } from "./factorMatch";
import { useAudit } from "./AuditContext";
import { SectionedJudgeChain } from "./JudgeChain";
import { ThreePhaseFindingBody } from "./findingThreePhase";
import { verdictStrength } from "./auditPresentation";
import { findingEvidenceRender } from "./paperExcerptsCaption";
import { trimRationaleBoilerplate } from "./rationaleText";
import { dedupeSubtaskDecisions } from "./subtaskDecisions";
import { SubtaskDecisionRow } from "./AuditReportView";

// ---------------------------------------------------------------------------
// DispositionNoteRow — italic quote-back + ✎ edit affordance
// ---------------------------------------------------------------------------

/** Inline display of a disposition's stored note, with an "edit"
 *  affordance that re-opens the matching dialog in edit mode. When
 *  the audit is finalized, the affordance turns into a "reopen to
 *  edit" hint — the server's PATCH gate rejects writes against a
 *  finalized audit (409), so we surface the path back. */
export function DispositionNoteRow({
  disposition,
  isFinalized,
  onEdit,
}: {
  disposition: AuditFindingDisposition | undefined;
  isFinalized: boolean;
  onEdit: () => void;
}) {
  if (!disposition || disposition.status === "pending") return null;
  const { plain } = parsePrefixedNote(disposition.notes);
  // Cascaded dispositions (inherited from a parent factor finding)
  // are read-only — the parent's disposition is the editable source
  // of truth. Hide the inline note row entirely on the empty-note
  // case so we don't paint a "no note / edit" affordance the curator
  // can't actually use.
  const isCascaded = !!disposition.inherited_from;
  if (isCascaded && !plain) return null;
  // Show the row whenever a disposition is set — even when there's
  // no note yet — so the curator can retro-add one. Empty-note case
  // renders just the "✎ edit" link with no quote text.
  return (
    <div className="pl-1.5 mt-1 flex items-start gap-1.5 text-[10px]">
      {plain ? (
        <span
          className="flex-1 italic text-slate-600 dark:text-slate-300 whitespace-pre-wrap"
          title={plain}
        >
          <span className="not-italic text-slate-400 mr-1">📝</span>
          {plain}
        </span>
      ) : (
        <span className="flex-1 text-slate-400 dark:text-slate-500 italic">
          no note
        </span>
      )}
      {isCascaded ? (
        <span
          className="text-slate-400 dark:text-slate-500 italic"
          title={`cascaded from ${disposition.inherited_from} — edit the parent finding`}
        >
          cascaded
        </span>
      ) : isFinalized ? (
        <span
          className="text-slate-400 dark:text-slate-500 italic"
          title="audit is closed — Reopen above to edit"
        >
          reopen to edit
        </span>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
          title="edit reason / note"
        >
          ✎ edit
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineSubtaskReasoning — under-header chip list scoped to one factor
// ---------------------------------------------------------------------------

/** Pull the factor label out of a `calibration_factor_*` finding's
 *  rationale. The agent emits the label as the first backticked token
 *  in the question form (e.g. "Remove factor `treatment`?", "Is
 *  factor `genotype` correctly captured?"). Returns the label in
 *  lowercase (matching the subtask_decision target_id casing) or
 *  null when the pattern doesn't match. */
function findingFactorLabel(finding: AuditFinding): string | null {
  if (!finding.issue_code.startsWith("calibration_factor_")) return null;
  if (finding.target_kind !== "factor") return null;
  const m = (finding.rationale || "").match(/`([^`:]+?)`/);
  if (!m) return null;
  return m[1].trim().toLowerCase();
}

/** Subtask decisions targeting a given factor label. Matches both
 *  `factor:<label>` (factor-level) and `factor:<label>:fv:<fv>` /
 *  `factor:<label>/...` (FV / slot-level under the factor). */
function subtaskDecisionsForFactor(
  report: AuditReport | null,
  label: string,
): SubtaskDecision[] {
  if (!report || !label) return [];
  const all =
    report.evidence?.comparison_proposal?.evidence?.subtask_decisions ?? [];
  const prefix = `factor:${label}`;
  return all.filter((d) => {
    if (d.confidence === "high") return false;
    const t = (d.target_id || "").toLowerCase();
    if (t === prefix) return true;
    if (t.startsWith(`${prefix}:`)) return true;
    if (t.startsWith(`${prefix}/`)) return true;
    return false;
  });
}

/** Renders matching subtask decisions inline in a finding's expanded
 *  body. Renders nothing if there are no matches — keeps the body
 *  tight for findings without reasoning.
 *
 *  Drops S10_term_validator rows whose verdict only echoes the URI
 *  already shown on the header term chip — that's pure restatement.
 *  Other subtask types (S2j, S7_coverage, S2i, …) are kept as-is. */
export function InlineSubtaskReasoning({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}) {
  const label = findingFactorLabel(finding);
  if (!label) return null;
  const decisions = subtaskDecisionsForFactor(report, label);
  if (decisions.length === 0) return null;
  const headerUri = finding.proposer_term?.uri ?? null;
  const filtered = decisions.filter(
    (d) => !s10MatchesHeaderUri(d, headerUri),
  );
  if (filtered.length === 0) return null;
  const deduped = dedupeSubtaskDecisions(filtered);
  return (
    <div className="space-y-1 pl-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
        Subtask analysis · factor `{label}`
      </div>
      {deduped.map((d, i) => (
        <SubtaskDecisionRow key={i} decision={d} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentSuggestionPanel — boxed Judge / evidence / fix surface
// ---------------------------------------------------------------------------

/** Combined "suggested fix + proposer suggestion" panel. Shows both
 *  in a single box so the curator sees one coherent "what the agent
 *  thinks you should do" block instead of two differently-coloured
 *  nested boxes.
 *
 *  Render contract:
 *   - Hide `suggested_fix` when it's just an action one-liner ("Add
 *     factor X.", "Remove factor X.", "Swap …", "Rename …", "Keep …")
 *     — the header chip already shows the action. Same when it
 *     duplicates `rationale` verbatim modulo punctuation.
 *   - Hide the legacy `proposer_suggestion` text when its parsed
 *     category + values are already rendered by the FV chips above
 *     (RenameFactorEmbed / GoldFactorMissEmbed / comparator chips).
 *     When at least one suggestion value is novel, render it — the
 *     curator shouldn't lose that signal.
 *   - ALWAYS render the "Judge:" row: prefer
 *     `defender_verdict.rationale`, fall back to `proposer_defense`,
 *     and when both are empty render the `"[agent emitted no
 *     details]"` sentinel in muted slate italic. The sentinel
 *     distinguishes "agent ran but had nothing to add" from
 *     "renderer dropped the field". */
export function AgentSuggestionPanel({ finding }: { finding: AuditFinding }) {
  const { report } = useAudit();
  // Three-phase render per Paul 2026-06-15
  // (FINDING_CARD_THREE_PHASE_SPEC_2026_06_15.md). Replaces the
  // legacy nested-box "STRONG SUGGESTION → INTERNAL REVIEW
  // (judge/boss) → AUDITOR" stack. Phase 3 (Comparison) is rendered
  // by the calling card — tag findings render their chip-strip
  // comparator inside CompactFindingCard's editor; factor findings
  // use FactorComparisonGrid via ComparisonFactorCard. This panel
  // covers Phase 1 (Why proposed) and Phase 2 (Reviews); a small
  // fix-override caption survives below for legacy weak-verdict
  // copy.
  const verdictFix = shortFixForVerdict(finding.defender_verdict);
  return (
    <div className="px-1.5 py-1 space-y-2">
      <ThreePhaseFindingBody finding={finding} report={report} />
      {verdictFix ? (
        <div className="text-[11px] text-slate-800 dark:text-slate-200 leading-snug italic">
          {verdictFix}
        </div>
      ) : null}
    </div>
  );
}

// Legacy nested-box render was deleted with the three-phase rewrite
// (Paul 2026-06-15, FINDING_CARD_THREE_PHASE_SPEC_2026_06_15.md).
// Recover from git history if a diff comparison is needed; the new
// ``AgentSuggestionPanel`` above is the canonical render. The
// function below is preserved verbatim as ``_LegacyAgentSuggestionPanel``
// and re-exported so its imports stay live during the migration
// window — once the producer-side ``why`` / ``reviews`` / ``comparison``
// blocks land on the wire and the three-phase render has settled,
// delete this function plus the unused imports.
//
// Export-only to satisfy ``noUnusedLocals`` without ESLint suppressions.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function _LegacyAgentSuggestionPanel({ finding }: { finding: AuditFinding }) {
  const { report } = useAudit();
  const verdictFix = shortFixForVerdict(finding.defender_verdict);
  // For calibration triplet codes the collapsed header already states
  // the action ("does not propose X", "proposes adding X", "both have
  // X"). Showing suggested_fix in the expanded body just repeats it
  // verbatim. Keep it only when a defender verdict override changed
  // the recommended action — that's genuinely new information.
  const isCalibrationCode =
    finding.issue_code === "calibration_gold_only_miss" ||
    finding.issue_code === "calibration_match" ||
    finding.issue_code === "calibration_agent_extra";
  const rawFixText =
    verdictFix ?? (isCalibrationCode ? null : finding.suggested_fix);

  // Suppress fixText when it just restates the header action or the
  // rationale. `verdictFix` (curator-facing override copy for weak
  // verdicts) is exempted because that prose is genuinely new.
  const rationale = trimRationaleBoilerplate(finding.rationale ?? "");
  const fixIsRedundant =
    !verdictFix &&
    !!rawFixText &&
    (isActionPrefixRationale(rawFixText) ||
      isSuggestedFixRedundant(rawFixText, rationale, finding.rationale));
  const fixText = fixIsRedundant ? null : rawFixText;

  const term = finding.proposer_term;
  const statements = finding.proposer_statements ?? [];
  const trimmedDefense = trimRationaleBoilerplate(
    finding.proposer_defense ?? "",
  );
  const evidence = finding.supporting_evidence ?? [];

  // Legacy one-line `proposer_suggestion` — keep only when it adds
  // info beyond the FV chips already on screen. The visible FV labels
  // come from proposer_statements (subject slot); for older audits
  // without structured statements the comparison falls through to "no
  // visible FVs → render as fallback".
  const legacyTextRaw = finding.proposer_suggestion ?? "";
  const isLegacySentinel =
    legacyTextRaw.trim() === AGENT_NO_DETAILS_SENTINEL;
  const visibleFvLabels = statements
    .map((s) => s.subject?.label ?? "")
    .filter((s) => s.trim().length > 0);
  const parsedLegacy = parseProposerSuggestion(legacyTextRaw);
  const legacyText =
    !legacyTextRaw ||
    isLegacySentinel ||
    isProposerSuggestionRedundant(parsedLegacy, visibleFvLabels)
      ? null
      : legacyTextRaw;

  const dv = finding.defender_verdict ?? null;
  const strength = dv?.strength ?? verdictStrength(dv?.verdict);
  // Lean direction (pro_agent / pro_gold / neutral) drives the header
  // label TEXT — the SUGGESTION header used to say "STRONG SUGGESTION"
  // even when the judge had concluded the agent was wrong (e.g.
  // GSE93824 Arctic-APP concept_gold_right case, Paul 2026-05-21).
  // The lean-aware label flips to "NOT SUGGESTED" in that case so the
  // curator isn't nudged toward the wrong answer. Single-axis framing
  // (Paul 2026-05-21): the label always describes the *strength of the
  // suggestion to change* — see ./defenderLean.ts for the full mapping.
  const lean = findingLean(finding);
  const headerLabel = leanSuggestionLabel(lean, strength);

  // Near-match findings (calibration_factor_match_near OR any rename
  // payload — the GSE93824 genotype gene-URI case) get a different
  // treatment than whole-factor extra / gold-only-miss findings.
  // Their factor-level proposal is a good call (the green disc header
  // chip carries that signal); the disagreement is at the FV /
  // statement level (the yellow N badge counts it). On these findings:
  //   - drop the single-axis strength label here — it collapses
  //     factor-level OK + lower-level concept-diff into one
  //     "STRONG / WEAK / NOT SUGGESTED" axis and reads as
  //     "the whole factor proposal is bad" even when it's mostly
  //     right (per Paul 2026-05-21).
  //   - move the Judge rationale into the FV expansion block in
  //     `FindingDetailsEditor` so the WHY binds to the exact FV
  //     being corrected, not the whole factor card.
  // Extra / gold-only-miss findings keep both — those are full-factor
  // decisions where the strength label is the right framing.
  const isNearMatch = isNearMatchFinding(finding);

  // Judge row — always rendered for non-near-match findings (Paul
  // 2026-05-21: the curator needs the WHY even when the agent emitted
  // nothing). Sentinel branch renders muted italic so the absence
  // reads as "no details" not "missing UI". For near-match findings
  // the row moves to the FV-level DisagreementBlock — see
  // FindingDetailsEditor.tsx; we still compute it here so the
  // sentinel-vs-real distinction stays consistent if the suppression
  // is later reverted.
  const judge = pickJudgeRowText(dv?.rationale, trimmedDefense);

  // Strength-based visual differentiation. Weak = amber (caution —
  // judge says don't act); strong = emerald (judge backs the
  // suggestion); default = slate (no graded verdict, treat as plain).
  // Same border + tint convention as the rest of the audit surface.
  const strengthBox =
    strength === "weak"
      ? "border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-900/15"
      : strength === "strong"
        ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-700/60 dark:bg-emerald-900/15"
        : "border-slate-200 bg-slate-50/60 dark:border-slate-600 dark:bg-slate-800/30";
  const strengthLabel =
    strength === "weak"
      ? "text-amber-700 dark:text-amber-400"
      : strength === "strong"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-slate-500 dark:text-slate-400";

  return (
    <div
      className={cn(
        "rounded border px-1.5 py-1.5 text-[11px] mx-1.5 space-y-1.5",
        strengthBox,
      )}
    >
      {!isNearMatch ? (
        <div
          className={cn(
            "text-[9px] uppercase tracking-wide font-semibold",
            strengthLabel,
          )}
          title={
            strength
              ? `judge graded this (${dv!.verdict}; lean=${lean})`
              : "what was proposed"
          }
        >
          {headerLabel}
        </div>
      ) : null}
      {/* Row order is fixed: Judge → Supporting Evidence → (legacy
          one-line proposal as last-resort) → fixText. Putting Judge
          first answers Paul's "I need the WHY" complaint: even when
          the agent emitted nothing, the sentinel row stands in.

          Near-match findings (rename / calibration_factor_match_near)
          omit the Judge row here — it renders inside the FV-level
          DisagreementBlock instead, bound to the exact FV being
          corrected.

          Defender-tile duplication guard: when ``dv.rationale`` is
          real, the JudgeChain DefenderTile below renders the same
          text — showing the "Judge:" line here too duplicates the
          rationale on the card. Paul 2026-06-14: "the text is just
          repeated anyway in the judge part." Suppress the Judge:
          line in that case; keep it for the proposer-defense
          fallback and the sentinel (agent-emitted-nothing) cases
          where the chain has nothing to render. */}
      {!isNearMatch && !dv?.rationale?.trim() ? (
        <div
          className={cn(
            judge.isSentinel
              ? "text-slate-400 dark:text-slate-500 italic text-[10px] leading-snug"
              : "text-slate-500 dark:text-slate-400 italic text-[10px] leading-snug",
          )}
          title={dv?.citation || undefined}
        >
          <span className="not-italic font-semibold text-slate-600 dark:text-slate-300">
            Judge:
          </span>{" "}
          {judge.text}
        </div>
      ) : null}
      {/* Sectioned judge chain — Internal review (defender_verdict)
          and Auditor (arbiter + boss) as visually distinct labelled
          subsections. Replaces the flat ``JudgeChain`` strip per
          Paul 2026-06-15 so the proposer-side defence and the
          audit's comparison verdict read as separate things — same
          shape as the WHY block on ``ComparisonFactorCard``. The
          Auditor subsection auto-suppresses when the report has no
          arbiter/boss content, so older packages render only the
          Internal review tile (or nothing) — equivalent to the
          legacy flat strip's behaviour. */}
      <SectionedJudgeChain finding={finding} report={report} />
      {(() => {
        // Render decision routed through the pure helper so the
        // three-state contract (blockquotes / muted_caption / nothing)
        // stays unit-testable. See ./paperExcerptsCaption.ts +
        // bro's HANDOFF_2026-06-12_AGENT_PARAPHRASE_FALLBACK_AND_ATTRIBUTION_INVARIANT.md
        // for the table.
        const render = findingEvidenceRender(finding);
        if (render === "blockquotes") {
          return (
            <div className="space-y-1">
              {evidence.map((ev, i) => (
                <FindingEvidenceBlock key={i} evidence={ev} />
              ))}
            </div>
          );
        }
        if (render === "muted_caption") {
          return (
            <div
              className="text-[10px] italic text-slate-500 dark:text-slate-400 leading-snug pl-2 border-l-2 border-slate-300 dark:border-slate-600"
              title={
                "The judge ran but no paper excerpts could be anchored to " +
                "this finding. The Judge rationale above is the only source. " +
                "Treat as un-grounded — verify against the paper before acting."
              }
            >
              no paper excerpt emitted — judge rationale above is un-grounded
            </div>
          );
        }
        return null;
      })()}
      {/* Legacy text-only proposals (older audits with no structured
          term / statements / defense / evidence) still surface as a
          last-resort signal so the curator doesn't lose that data.
          Suppressed when the FV chips above already render it (see
          `isProposerSuggestionRedundant`) and when no other slot
          would carry the info. */}
      {legacyText &&
      !term &&
      statements.length === 0 &&
      !trimmedDefense &&
      evidence.length === 0 ? (
        <div className="text-slate-700 dark:text-slate-300">{legacyText}</div>
      ) : null}
      {fixText ? (
        <div className="text-slate-800 dark:text-slate-200 leading-snug">
          {fixText}
        </div>
      ) : null}
    </div>
  );
}

/** Short human-readable replacement for `finding.suggested_fix` when
 *  the judge says the curator should *not* take the proposed action.
 *  Only fires when `strength` resolves to `"weak"` (producer-side
 *  from v10+ packages, or via `verdictStrength()` fallback for v9
 *  and older); `moderate` and `strong` keep the agent's verbose
 *  `suggested_fix` because the curator still needs the structured
 *  detail. Returns `null` when no override applies. */
function shortFixForVerdict(
  dv: AttachedDefenderVerdict | null | undefined,
): string | null {
  if (!dv) return null;
  const strength = dv.strength ?? verdictStrength(dv.verdict);
  if (strength !== "weak") return null;
  switch (dv.verdict) {
    // Tag side. `extra_unsupported` copy is shared with the factor
    // side (same human reading either way).
    case "extra_unsupported":
      return "Dismiss — judge: the agent's pick isn't well-evidenced.";
    case "extra_inherited_redundant":
      return "Dismiss — judge: already inherited from biomaterials.";
    case "agent_miss_genuine":
      return "Keep the existing tag — judge: it's well-supported.";
    // Factor side (FACTOR_DEFENDER_VERDICT_HANDOFF.md).
    case "extra_confounded":
      return "Dismiss — judge: factor is confounded with another in the design.";
    case "miss_genuine":
      return "Keep the existing factor — judge: it's well-supported.";
    default:
      // Weak strength on a verdict label we don't have specific copy
      // for (forward-compat: future investigator verdicts). Generic
      // fall-through reads better than the agent's verbose fix.
      return "Override the suggestion — judge: low confidence.";
  }
}

// ---------------------------------------------------------------------------
// FindingEvidenceBlock — one evidence blockquote with expandable context
// ---------------------------------------------------------------------------

/** One evidence quote — blockquote rendering with a small source chip
 *  on the right. Source vocab matches the agent-side
 *  `FindingEvidence.source` literal: paper / preboarding /
 *  sample_names / geo_metadata / characteristic.
 *
 *  Three layers per AUDIT_EVIDENCE_CONTEXT_HANDOFF.md:
 *    1. `quote` — the anchor sentence (always rendered as the
 *       collapsed-state blockquote).
 *    2. `context` — paragraphs / sample-names neighbourhood / full
 *       characteristic block. Hidden behind a "Show more" expander
 *       when set + non-empty + different from `quote`. Rendered in
 *       a sibling pre-formatted block with `highlights` ranges
 *       wrapped in a soft yellow span so the eye lands on the anchor
 *       inside the wider text.
 *    3. `source_url` — optional deep-link to the GEO record /
 *       PubMed / Gemma sample page; rendered as a small "open ↗" in
 *       the source-label header strip. */
export function FindingEvidenceBlock({
  evidence,
}: {
  evidence: NonNullable<AuditFinding["supporting_evidence"]>[number];
}) {
  const [expanded, setExpanded] = useState(false);
  // Source label + per-type accent colour live in evidenceSource so the
  // tag-chip popover and these audit blocks read identically. Colour is
  // the "what kind of provenance is this" cue (characteristic / paper /
  // GEO / …); see evidenceSource.ts.
  const meta = evidenceSourceMeta(evidence.source, evidence.location);
  const { context, highlights } = stripContextHeader(
    (evidence.context || "").trim(),
    evidence.highlights ?? [],
  );
  const quote = (evidence.quote || "").trim();
  // Agent-paraphrase fallback — the agent had no real paper excerpts
  // and emitted a paraphrase of its own judge text as evidence. That
  // duplicates the Judge row verbatim and adds zero curator signal.
  // Collapse to a one-line muted note so the absence is honest
  // without the redundant block. Per Paul 2026-06-11.
  const location = (evidence.location || "").trim();
  const isParaphraseFallback =
    location.toUpperCase().includes("AGENT-PARAPHRASE FALLBACK") ||
    location.toUpperCase().includes("PAPER_EXCERPTS NOT EMITTED") ||
    /^\(agent paraphrase\)/i.test(quote);
  if (isParaphraseFallback) {
    return (
      <div
        className="text-[10px] italic text-slate-500 dark:text-slate-400 leading-snug pl-2 border-l-2 border-slate-300 dark:border-slate-600"
        title={
          "Agent did not emit a paper excerpt for this finding. The judge's " +
          "rationale above is the only source. Treat as un-grounded — verify " +
          "against the paper before acting."
        }
      >
        no paper excerpt emitted — judge rationale above is un-grounded
      </div>
    );
  }
  // Only show the expander when context adds value beyond the anchor
  // sentence — empty contexts and contexts that just are the quote
  // don't warrant the affordance.
  const hasMore = !!context && context !== quote;
  return (
    <blockquote
      className={cn(
        "border-l-2 bg-white/60 pl-2 pr-1 py-1 text-slate-700 italic relative dark:bg-slate-800/40 dark:text-slate-200",
        meta.borderCls,
      )}
      title={evidence.location || meta.label}
    >
      <div
        className={cn(
          "not-italic text-[9px] uppercase tracking-wide mb-0.5 flex items-center justify-between gap-2",
          meta.headerCls,
        )}
      >
        <span className="inline-flex items-baseline gap-1.5">
          <span title={meta.description}>{meta.label}</span>
          {meta.badge ? (
            <span className="not-italic normal-case text-[8px] px-1 rounded bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {meta.badge}
            </span>
          ) : null}
          {evidence.source_url ? (
            <a
              href={evidence.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn("hover:underline", meta.linkCls)}
              title={`open source: ${evidence.source_url}`}
            >
              open ↗
            </a>
          ) : null}
        </span>
        <EvidenceLocationLabel location={location} />
      </div>
      <span className="leading-snug">"{quote}"</span>
      {hasMore ? (
        <>
          {expanded ? (
            <pre
              className={cn(
                "not-italic mt-1.5 px-1.5 py-1 rounded text-[11px] leading-snug whitespace-pre-wrap break-words font-sans text-slate-800 dark:text-slate-200 max-h-72 overflow-y-auto",
                meta.contextBgCls,
              )}
            >
              {renderHighlightedContext(context, highlights)}
            </pre>
          ) : null}
          {expanded ? null : " "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className={cn("not-italic mt-1 ml-1 text-[10px] hover:underline", meta.headerCls)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      ) : null}
    </blockquote>
  );
}

/**
 * Render an evidence ``location`` string structurally — coverage badge
 * for "all N samples", a ratio + sample list for partial coverage, an
 * alias mapping, or a loud "investigate" flag for the producer-bug
 * case. Falls back to the raw string for anything unrecognised.
 */
function EvidenceLocationLabel({ location }: { location: string }) {
  const parsed = parseEvidenceLocation(location);
  switch (parsed.kind) {
    case "constant":
      return (
        <span className="not-italic text-[9px] text-slate-500 dark:text-slate-400 truncate">
          {parsed.scope ? `${parsed.scope} · ` : ""}
          <span className="text-emerald-700/80 dark:text-emerald-400/80 font-medium">
            all{parsed.count != null ? ` ${parsed.count}` : ""}
          </span>
        </span>
      );
    case "partial":
      return (
        <span
          className="not-italic text-[9px] text-slate-500 dark:text-slate-400 truncate"
          title={
            parsed.samples.length
              ? `${parsed.samples.join(", ")}${parsed.moreCount ? `, +${parsed.moreCount} more` : ""}`
              : undefined
          }
        >
          {parsed.scope ? `${parsed.scope} · ` : ""}
          {parsed.matched != null && parsed.total != null ? (
            <span className="tabular-nums font-medium">
              {parsed.matched}/{parsed.total}
            </span>
          ) : null}
        </span>
      );
    case "bug":
      return (
        <span className="not-italic text-[9px] font-semibold text-rose-700 dark:text-rose-300">
          ⚠ investigate{parsed.total != null ? ` (0/${parsed.total})` : ""}
        </span>
      );
    case "alias":
      return (
        <span className="not-italic text-[9px] text-slate-500 dark:text-slate-400 truncate">
          <mark className="bg-yellow-200/70 dark:bg-yellow-700/40 rounded px-0.5">
            {parsed.from}
          </mark>{" "}
          →{" "}
          <mark className="bg-yellow-200/70 dark:bg-yellow-700/40 rounded px-0.5">
            {parsed.to}
          </mark>
        </span>
      );
    case "catalog":
      return null; // the "Cellosaurus" source label + badge says it
    case "plain":
      return parsed.text ? (
        <span className="text-slate-500 not-italic font-mono text-[9px] truncate dark:text-slate-400">
          {parsed.text}
        </span>
      ) : null;
  }
}

/** Strip the leading `=== ... ===` separator line GEO-metadata
 *  excerpts ship with — the source-label chip already says "GEO",
 *  so the duplicate header is just noise. Shifts `highlights` offsets
 *  to match the trimmed string. */
function stripContextHeader(
  context: string,
  highlights: [number, number][],
): { context: string; highlights: [number, number][] } {
  const m = /^===[^\n]*===\n+/.exec(context);
  if (!m) return { context, highlights };
  const drop = m[0].length;
  return {
    context: context.slice(drop),
    highlights: highlights.map(([s, e]) => [
      Math.max(0, s - drop),
      Math.max(0, e - drop),
    ]),
  };
}

/** Render `context` with `highlights` ranges wrapped in a soft yellow
 *  span. Half-open `[start, end)` byte offsets per agent-side
 *  contract. Out-of-range / overlapping / unsorted ranges all clamp
 *  + sort + merge defensively so a malformed highlight set never
 *  breaks the render. */
function renderHighlightedContext(
  context: string,
  highlights: [number, number][],
): ReactNode {
  if (!highlights || highlights.length === 0) return context;
  // Clamp into [0, len], drop empties, sort by start, merge overlaps.
  // Done once per render — the lists are small.
  const len = context.length;
  const clamped = highlights
    .map(([s, e]): [number, number] => [
      Math.max(0, Math.min(len, s | 0)),
      Math.max(0, Math.min(len, e | 0)),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of clamped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (s > cursor) parts.push(context.slice(cursor, s));
    parts.push(
      <mark
        key={`h${i}`}
        className="bg-yellow-200/70 dark:bg-yellow-700/40 text-slate-900 dark:text-slate-100 rounded-sm px-0.5"
      >
        {context.slice(s, e)}
      </mark>,
    );
    cursor = e;
  });
  if (cursor < len) parts.push(context.slice(cursor));
  return parts;
}
