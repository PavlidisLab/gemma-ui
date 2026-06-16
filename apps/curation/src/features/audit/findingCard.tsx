/**
 * One finding card — header + agent-details panel + action row.
 *
 * This file owns the "vertical" of a single finding card on the
 * audit sidebar:
 *   - `PanelExpansion` context (mirrors the top-of-panel expand-all
 *     baseline so per-card state can re-seed when the curator
 *     cycles).
 *   - `PanelExpansionCycleButton` — the 3-way toggle.
 *   - `CompactFindingCard` — the card shell (chevron + status badge
 *     + header line + agent-details + action row), with a clickable
 *     header that toggles the body.
 *   - `FindingActionRow` — the verdict surface: primary apply / Agree
 *     / Reject / Park / undo, with the three popover dialogs
 *     (Dismiss / Accept / Not-sure) and the structured per-element
 *     editor when the finding carries comparison content.
 *
 * Extracted from `AuditSidebarPanel.tsx` (Paul 2026-06-10 mega-file
 * sweep). Pure-presentation outside of `useAudit()` / `useDesignDraft()`
 * / `useToast()` / `useIsReadOnly()` hooks — disposition writes go
 * through the audit context's `setDisposition`; draft mutations go
 * through `applyDraft`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { Term } from "@/components/ui/Term";
import { useToast } from "@/components/ui/Toast";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { FindingReasoningPanel } from "./findingReasoningPanel";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import { normalizeWikiUrl } from "@/lib/guidelines";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import {
  clearAllProposalStateForExperiment,
  notifyProposalStateReset,
} from "@/features/proposal/proposalDispositions";

import type {
  AcceptReason,
  AuditFinding,
  DismissReason,
  DispositionStatus,
  NotSureReason,
} from "@/api/auditTypes";
import { isAgentExtraIssue } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { useAudit, findingKey } from "./AuditContext";
import {
  ConsequentsBadges,
  DebateBadgeChip,
  DispositionDot,
  IssueCodeBadge,
  JudgeStrengthGlyph,
  MatchBadge,
  PairedFindingBadge,
  ProposerFlagsChips,
  SeverityBadge,
} from "./findingBadges";
import {
  FactorDescriptionSubtitle,
  FactorReplacementHint,
  GoldFactorMissEmbed,
  RenameFactorEmbed,
} from "./findingEmbeds";
import {
  AgentSuggestionPanel,
  DispositionNoteRow,
  InlineSubtaskReasoning,
} from "./agentDetailsPanel";
import {
  findingActionGlyph,
  findingActionLabel,
  findingDispositionButtonLabels,
  findingDisplayedGoldEmpty,
  findingShortRationale,
  findingSubjectLabel,
  isMatchFinding,
  subsumedFvChildren,
} from "./findingHelpers";
import {
  displaySeverity,
  severityBorderCls,
  verdictStrength,
} from "./auditPresentation";
import { isNearMatchFinding } from "./factorMatch";
import {
  countFindingDisagreements,
  extractAuditIdentities,
  findingHasStructuredContent,
} from "./FindingDetailsEditor";
import {
  firstBacktick,
  splitRationaleTrail,
  trimRationaleBoilerplate,
} from "./rationaleText";
import { parseTargetId, slug } from "./targetIds";
import { markFirstSeen, consumeFirstSeen } from "./firstSeen";
import { resolveApplyAction } from "./applyHandlers";
import { undoBatched } from "./appliedBatches";
import { applyDetailsEditsToDesign } from "./applyDetailsEdits";
import { resolveEditInitial } from "./dispositionEdit";
import {
  deriveAcceptReason,
  deriveDismissReason,
  deriveStatus,
} from "./dispositionSave";
import { DismissDialog } from "./DismissDialog";
import {
  NOT_SURE_CHIPS,
  acceptChipsFor,
  dismissChipsFor,
} from "./dispositionChips";
import { FindingDetailsEditor } from "./FindingDetailsEditor";

// ---------------------------------------------------------------------------
// Panel-level expansion baseline — context + cycle button
// ---------------------------------------------------------------------------

/** Panel-level expansion baseline for the finding cards. One control
 *  at the top of the sidebar drives every card's body/judgements
 *  visibility at once — cleaner for proposal review (large list,
 *  curator triages by reading bodies linearly) than per-card chevrons
 *  that have to be clicked individually.
 *
 *  Cards still hold their own `cardOpen` / `open` state so the legacy
 *  per-card chevron + the dot-focus "expand THIS finding" behaviour
 *  still work; an effect re-seeds the card state whenever the
 *  panel-level baseline changes. */
export type PanelExpansion = "collapsed" | "expanded" | "fully";
export const PanelExpansionContext = createContext<PanelExpansion>("collapsed");

/** Big, obvious 3-way cycle. Glyph reflects the current state;
 *  tooltip names the next state so a click is predictable. Sized
 *  generously — Paul has called out tiny carets twice; the icons here
 *  are deliberately `text-2xl` so they stay readable in the sidebar's
 *  busy header strip. */
export function PanelExpansionCycleButton({
  state,
  onCycle,
}: {
  state: PanelExpansion;
  onCycle: () => void;
}) {
  const next: PanelExpansion =
    state === "collapsed"
      ? "expanded"
      : state === "expanded"
        ? "fully"
        : "collapsed";
  const nextLabel =
    next === "collapsed"
      ? "collapse all"
      : next === "expanded"
        ? "expand all (bodies)"
        : "expand all + judgements";
  const glyph =
    state === "collapsed" ? "▸" : state === "expanded" ? "▾" : "▾▾";
  const label =
    state === "collapsed"
      ? "all cards collapsed"
      : state === "expanded"
        ? "all cards expanded (bodies)"
        : "all cards fully expanded (bodies + judgements)";
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={`${label} — click to ${nextLabel}`}
      title={`${label}\n→ click to ${nextLabel}`}
      className="inline-flex items-center justify-center min-w-[2.25rem] text-2xl leading-none font-bold tracking-tighter px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {glyph}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CompactFindingCard — the card shell + header + body + action row
// ---------------------------------------------------------------------------

export function CompactFindingCard({ finding }: { finding: AuditFinding }) {
  // Disposition state comes from context (server-authoritative for
  // live reports; in-memory for dev override). The card reads to
  // tint dismissed findings; the action row inside it does the writes.
  const {
    kind,
    activeFindingKey,
    setActiveFindingKey,
    dispositionByTarget,
    report,
  } = useAudit();
  const { draft } = useDesignDraft();
  const disposition = dispositionByTarget.get(finding.target_id);
  const currentDisposition = disposition?.status ?? "pending";
  // Baseline-aware title override: a stored ``*_match`` finding was
  // correct against the audit's original baseline; the curator may
  // now view it against a different baseline that lacks the value
  // (polished_gold for GSE110721 has no cell-type tag, etc.). When
  // the displayed gold side is empty, downgrade "Tag match" to "Add
  // tag" so the title agrees with the body. Paul 2026-06-16.
  const goldEmptyForTitle = useMemo(
    () => findingDisplayedGoldEmpty(finding, draft ?? null) === true,
    [finding, draft],
  );

  // Two boolean axes encode the 3-state card expansion:
  //   collapsed → cardOpen=false, open=false (title row only)
  //   expanded  → cardOpen=true,  open=false (body shown, judgements hidden)
  //   fully     → cardOpen=true,  open=true  (body + judgements)
  //
  // Seeded from the panel-level baseline (top-of-sidebar "expand all"
  // button) and re-seeded whenever the curator cycles that control.
  // Cards still hold their own state so the legacy fat chevron + the
  // dot-focus "expand THIS finding" pathway still work for
  // fine-grained overrides on top of the baseline.
  const panelExpansion = useContext(PanelExpansionContext);
  const [cardOpen, setCardOpen] = useState(panelExpansion !== "collapsed");
  const [open, setOpen] = useState(panelExpansion === "fully");
  useEffect(() => {
    setCardOpen(panelExpansion !== "collapsed");
    setOpen(panelExpansion === "fully");
  }, [panelExpansion]);

  // The auditor's identity ("Agent" / "Gemma" / "amanda" / "cyan") —
  // used to label the agent-details pill so it reads as "amanda
  // details" / "cyan details" / "Gemma details" instead of the generic
  // "agent details". Per Paul 2026-05-21: the word "agent" should be
  // the name of whoever played the auditor role; use "auditor" only
  // when fully generic.
  const auditorName = extractAuditIdentities(report?.model).proposer;

  // Toggle helper that scroll-into-views the card on expand. Without
  // this, expanding a collapsed card at the bottom of the viewport
  // leaves its body off-screen and the curator has to scroll manually.
  // raf defers the scroll one frame so the expanded action row + agent
  // details have reflowed and the card's final height is known.
  function toggleCardOpen(): void {
    const next = !cardOpen;
    setCardOpen(next);
    if (next) {
      requestAnimationFrame(() => {
        cardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }
  }
  // Retire the legacy RenameFactorEmbed when the per-element editor
  // renders below.
  const editorWillRender = findingHasStructuredContent(
    finding,
    report,
    draft ?? null,
  );

  // Stamp the first-seen timestamp once per finding. Sent on the
  // first PATCH for this target so my brother can compute triage
  // time. Side-effect-only (markFirstSeen is a no-op after the first
  // call), so safe to fire on every render.
  markFirstSeen(finding.target_id);

  const cardRef = useRef<HTMLDivElement>(null);
  const myKey = findingKey(finding);
  // Active-finding focus: when an inline dot click sets the matching
  // key in AuditContext, expand this card and scroll it into view.
  // setActiveFindingKey(null) after handling so a second click on the
  // same dot still re-fires (and to keep the context state idempotent).
  useEffect(() => {
    if (activeFindingKey !== myKey) return;
    setOpen(true);
    // Defer the scroll a frame so the expand has reflowed first,
    // otherwise scrollIntoView overshoots when the card grows.
    const raf = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      setActiveFindingKey(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeFindingKey, myKey, setActiveFindingKey]);

  // Is there anything meaningful to reveal when the curator expands
  // this card? Findings with no citation, no agent suggestion, no
  // reasoning trail, and a one-line rationale have an empty expanded
  // body — chevron + click would be a dead affordance. Compute up-
  // front and gate the toggle so the card visually signals "headline
  // only" rather than promising detail that isn't there.
  const trail = splitRationaleTrail(
    trimRationaleBoilerplate(finding.rationale),
  ).trail;
  // Be defensive: an OBJECT existing with empty string fields used to
  // trip `!!field` truthy. Tighten to "is there actually content the
  // expanded body would render?" — matches what the curator sees.
  const nonEmpty = (s: string | null | undefined): boolean =>
    !!(s && s.trim());
  const hasCitation =
    nonEmpty(finding.citation) || nonEmpty(finding.citation_url);
  // AgentSuggestionPanel now ALWAYS renders the Judge row (with the
  // `[agent emitted no details]` sentinel when defender +
  // proposer_defense are both empty). So even findings with no
  // structured content carry the sentinel — keep the chevron available
  // so the curator can see that signal explicitly. Per Paul: "we can't
  // tell from this view whether the agent emitted no details OR
  // whether the renderer dropped them."
  const hasAgentSuggestion = true;
  const hasExpandableContent =
    hasCitation || hasAgentSuggestion || nonEmpty(trail);

  // Once dispositioned, the finding fades — it's no longer load-bearing
  // for the curator's attention. No coloured "verdict" badge competes
  // for the eye; the whole card just recedes (kept legible enough to
  // re-read, but unmistakably "done"). A tiny ✓ / × / ⋯ glyph replaces
  // the severity badge as a quiet marker of what was decided.
  const hasDisposition = currentDisposition !== "pending";
  // Entity-identity tint — sky for factor findings, emerald for tag
  // findings. Matches the design editor's FV palette + Overview
  // FactorChip exactly so the same factor identity reads identically
  // across the audit sidebar, overview, and design editor. Tags mirror
  // in emerald.
  const kindTint =
    finding.target_kind === "factor"
      ? "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/40"
      : finding.target_kind === "tag"
        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30"
        : "";
  return (
    <div
      ref={cardRef}
      className={cn(
        // Inline rounded/border instead of using the `card` class —
        // `html.dark .card` in index.css overrides `dark:bg-*`
        // utilities and was clobbering the kind-tint in dark mode.
        "rounded-lg border p-2 text-xs space-y-1.5",
        kindTint,
        severityBorderCls(finding.severity),
        hasDisposition && "opacity-40 hover:opacity-90 transition-opacity",
        activeFindingKey === myKey && "ring-2 ring-blue-400",
      )}
    >
      {/* Use a div with role=button instead of a real <button>,
          because the card body contains the inline ReasoningTrailButton
          — a <button> nested inside another <button> is invalid HTML
          and browsers swallow the inner click. */}
      <div
        role="button"
        tabIndex={0}
        className="w-full text-left flex items-start gap-1.5 cursor-pointer"
        onClick={() => toggleCardOpen()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCardOpen();
          }
        }}
        title={cardOpen ? "collapse card" : "expand card"}
      >
        {/* Fat collapse chevron on the left, mirroring MatchFindingRow.
            Clicking it toggles the whole-card collapse without firing
            the outer header's expand-agent-details handler — the row's
            onClick uses the `open` axis; this one uses `cardOpen`. */}
        <button
          type="button"
          aria-label={cardOpen ? "collapse card" : "expand card"}
          onClick={(e) => {
            e.stopPropagation();
            toggleCardOpen();
          }}
          // Standard chevron convention: ">" right-pointing when
          // closed (click to expand), "v" down-pointing when open
          // (click to collapse).
          className="text-2xl leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 px-1 -mt-1 font-bold"
          title={cardOpen ? "collapse" : "expand"}
        >
          {cardOpen ? "⌄" : "›"}
        </button>
        {hasDisposition ? (
          <DispositionDot
            status={
              currentDisposition as
                | "accepted"
                | "dismissed"
                | "needs_more_info"
            }
            resolved={!!disposition?.resolved_at}
            severity={finding.severity}
          />
        ) : isMatchFinding(finding) ? (
          // Match-code findings get the ≈ / ✓ badge instead of the
          // severity-with-action-glyph one — the same left-edge status
          // slot, just with the match-status semantic.
          <MatchBadge finding={finding} />
        ) : (
          <SeverityBadge
            severity={displaySeverity(finding)}
            glyph={findingActionGlyph(finding)}
            kind={kind}
          />
        )}
        <span className="flex-1 min-w-0">
          {editorWillRender ? (
            // The editor's title row below carries the entity identity
            // ("FACTOR treatment · 3 disagreements"); the outer header
            // just needs an action flavor. Drop the issue_code chip
            // and the rationale text — they duplicated info the editor
            // surfaces with more precision.
            <>
              <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mr-1">
                {findingActionLabel(finding, { goldEmpty: goldEmptyForTitle })}
              </span>
              <JudgeStrengthGlyph finding={finding} />

              {(() => {
                // Disagreement count badge — yellow circle with the
                // number of row-level disagreements, promoted to the
                // outer header so it's visible when the card is
                // collapsed AND the inner editor's title duplication
                // can be dropped.
                const n = countFindingDisagreements(
                  finding,
                  report,
                  draft ?? null,
                );
                if (n == null || n <= 0) return null;
                // Tooltip reframes on near-match findings (GSE93824
                // redesign). For those the count is explicitly "judge
                // corrections at the FV / statement level — expand FV
                // details", since the factor-level proposal itself is
                // fine and the disagreement is finer-grained. Other
                // finding shapes keep the plain row-level wording.
                const nearMatchTip =
                  `Judge: ${n} correction${n === 1 ? "" : "s"} ` +
                  `suggested at the FV / statement level ` +
                  `— expand FV details`;
                const plainTip = `${n} row-level disagreement${
                  n === 1 ? "" : "s"
                }`;
                const title = isNearMatchFinding(finding)
                  ? nearMatchTip
                  : plainTip;
                return (
                  <span
                    className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 mr-1 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950 dark:bg-amber-500 dark:text-amber-950"
                    title={title}
                    aria-label={`${n} disagreements`}
                  >
                    {n}
                  </span>
                );
              })()}
              {(() => {
                // Descriptive subject. For tag findings, render
                // category + value as Term chips (consistent with
                // MatchFindingRow). For factor findings, the existing
                // text-based summary (with FV fingerprint + +/-
                // shorthand) still reads best.
                if (finding.target_kind === "tag") {
                  // Tag identity comes from the target_id
                  // (authoritative, always present) — we then look up
                  // the live tag in `draft.tags` by matching slugs to
                  // recover proper-case labels + URIs. Backticked
                  // rationale tokens were the old heuristic but ~half
                  // the audit-side rationales are prose ("Strain is
                  // correctly identified as …" with no backticks),
                  // which used to leave the card showing just "Tag"
                  // with no chips. The backtick path is a last-ditch
                  // fallback.
                  let catLabel: string | null = null;
                  let valLabel: string | null = null;
                  let catUri: string | null = null;
                  let valUri: string | null = null;
                  const parsed = parseTargetId(finding.target_id);
                  if (parsed?.kind === "tag") {
                    const matchedBySlug = draft?.tags?.find(
                      (t) =>
                        slug(t.category?.label) === parsed.categorySlug &&
                        slug(t.value?.label) === parsed.valueSlug,
                    );
                    if (matchedBySlug) {
                      catLabel = matchedBySlug.category?.label ?? null;
                      valLabel = matchedBySlug.value?.label ?? null;
                      catUri = matchedBySlug.category?.uri ?? null;
                      valUri = matchedBySlug.value?.uri ?? null;
                    } else {
                      // Slug-only fallback: cosmetic
                      // (dashes-for-spaces) but at least the curator
                      // sees what the finding is about.
                      catLabel = parsed.categorySlug.replace(/-/g, " ");
                      valLabel = parsed.valueSlug.replace(/-/g, " ");
                    }
                  }
                  if (!catLabel || !valLabel) {
                    // Last-resort: backticked rationale token.
                    const tok = firstBacktick(finding.rationale);
                    if (tok) {
                      const colon = tok.indexOf(":");
                      if (colon !== -1) {
                        catLabel = tok.slice(0, colon).trim();
                        valLabel = tok.slice(colon + 1).trim();
                      } else {
                        return (
                          <span className="text-[11px] text-slate-600 dark:text-slate-300 mr-1 truncate">
                            —{" "}
                            <span className="font-mono">{tok}</span>
                          </span>
                        );
                      }
                    } else {
                      return null;
                    }
                  }
                  // Last preference for valUri: proposer_term (when
                  // the tag isn't in the current draft, the agent's
                  // suggested term carries the ontology binding).
                  valUri = valUri ?? finding.proposer_term?.uri ?? null;
                  // Final fallback — label-based lookup against
                  // draft.tags. Fires when the target_id-slug path
                  // didn't parse (e.g. `calibration:miss:cat/val` for
                  // `calibration_gold_only_miss`).
                  if (!valUri || !catUri) {
                    const matchedByLabel = draft?.tags?.find(
                      (t) =>
                        (t.category?.label ?? "")
                          .trim()
                          .toLowerCase() ===
                          (catLabel ?? "").trim().toLowerCase() &&
                        (t.value?.label ?? "")
                          .trim()
                          .toLowerCase() ===
                          (valLabel ?? "").trim().toLowerCase(),
                    );
                    if (matchedByLabel) {
                      catUri =
                        catUri ??
                        matchedByLabel.category?.uri ??
                        null;
                      valUri =
                        valUri ??
                        matchedByLabel.value?.uri ??
                        null;
                    }
                  }
                  // Category-only fallback for ADD TAG: the
                  // apply_action wire shape carries ``new_category``
                  // as a bare string without a URI counterpart
                  // (``ApplyActionPayload.add_tag`` has
                  // ``new_value_uri`` but no ``new_category_uri`` —
                  // bro handoff filed). Recover the URI by matching
                  // any existing tag in the draft that already uses
                  // this category. Common since experiments often
                  // have multiple tags under the same category
                  // ("disease model", "treatment", etc.) — the
                  // category URI is the same across them. Paul
                  // 2026-06-14: "why isn't this shown as green
                  // ontology term?"
                  if (!catUri && catLabel) {
                    const lc = catLabel.trim().toLowerCase();
                    const sameCategoryTag = draft?.tags?.find(
                      (t) =>
                        (t.category?.label ?? "").trim().toLowerCase() ===
                          lc && !!t.category?.uri,
                    );
                    if (sameCategoryTag) {
                      catUri = sameCategoryTag.category?.uri ?? null;
                    }
                  }
                  // Render as ``<category> : <value>`` — matches the
                  // agent's emit format ("disease model: Alzheimer
                  // disease") and the proposer-review surface. The
                  // category is shown as a muted italic chip and the
                  // value as the main Term chip so the eye still lands
                  // on the resolved term, but the category isn't
                  // hidden behind a hover. Per Paul 2026-06-12: "the
                  // category should be shown here in the title —
                  // there is currently no way to see it." Earlier
                  // 2026-06-11 critique was specifically against the
                  // "<value> IN <category>" phrasing; ``cat : val`` is
                  // the established convention (TagReviewCard,
                  // ProposalSidebarPanel) and isn't subject to that
                  // critique.
                  return (
                    <span className="inline-flex items-baseline gap-x-1 mr-1 min-w-0">
                      <span className="text-slate-500 dark:text-slate-400">
                        —
                      </span>
                      {catLabel ? (
                        <>
                          <Term
                            uri={catUri}
                            asLink={false}
                            className="!whitespace-normal break-words italic opacity-80"
                          >
                            {catLabel}
                          </Term>
                          <span className="text-slate-400 dark:text-slate-500">
                            :
                          </span>
                        </>
                      ) : null}
                      <Term
                        uri={valUri}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {valLabel}
                      </Term>
                    </span>
                  );
                }
                const subj = findingSubjectLabel(
                  finding,
                  report,
                  draft ?? null,
                );
                if (!subj) return null;
                return (
                  <span className="text-sm text-slate-800 dark:text-slate-100 mr-1 truncate">
                    <span className="text-slate-400 dark:text-slate-500">
                      —{" "}
                    </span>
                    <span className="font-mono font-semibold">{subj}</span>
                  </span>
                );
              })()}
              {cardOpen ? null : (
                <FindingShortRationale finding={finding} />
              )}
              <PairedFindingBadge finding={finding} />
              <ConsequentsBadges finding={finding} />
              <ProposerFlagsChips flags={finding.proposer_flags} />
              <DebateBadgeChip
                badge={finding.debate_badge}
                defenderVerdict={finding.defender_verdict}
              />
              <FactorDescriptionSubtitle finding={finding} report={report} />
            </>
          ) : (
            <>
              {/* Title row — unified with the editor-branch shape
                  above: action label at text-sm semibold, em-dash,
                  proposer term as a chip, issue-code + debate badges
                  right-aligned. Rationale stays accessible via the
                  chevron / AgentSuggestionPanel below; not shown
                  inline so the collapsed card stays a single visual
                  line. */}
              <span className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mr-1">
                  {findingActionLabel(finding, { goldEmpty: goldEmptyForTitle })}
                </span>
                {finding.proposer_term?.label ? (
                  <>
                    <span className="text-slate-400 dark:text-slate-500">
                      —
                    </span>
                    <Term
                      uri={finding.proposer_term.uri ?? null}
                      asLink={false}
                      className="!whitespace-normal break-words"
                    >
                      {finding.proposer_term.label}
                    </Term>
                  </>
                ) : null}
                {cardOpen ? null : (
                  <FindingShortRationale finding={finding} />
                )}
                <span className="ml-auto inline-flex items-baseline gap-1">
                  <IssueCodeBadge issueCode={finding.issue_code} />
                  <DebateBadgeChip
                    badge={finding.debate_badge}
                    defenderVerdict={finding.defender_verdict}
                  />
                </span>
              </span>
              <FactorReplacementHint finding={finding} report={report} />
              <FactorDescriptionSubtitle finding={finding} report={report} />
            </>
          )}
        </span>
      </div>

      {/* Reasoning collapsible — shared FindingReasoningPanel so
          every finding card type (compact, factor-match, partition-
          mismatch, extra, miss) renders the SAME toggle affordance.
          Paul 2026-06-16: "IT SHOULD BE THE SAME COMPONENT WHETHER
          THE FACTOR IS A MATCH or a PARTIAL MATCH". */}
      {cardOpen ? (
        <FindingReasoningPanel
          finding={finding}
          report={report}
          defaultOpen={open}
          extraBody={
            <>
              {/* For factor-kind extra/miss findings without an inline
                  editor, fall back to the FV-correspondence embed so
                  the curator still has the side-by-side view. */}
              {finding.target_kind === "factor" &&
              finding.issue_code === "calibration_factor_extra" &&
              !editorWillRender ? (
                <RenameFactorEmbed finding={finding} />
              ) : null}
              {finding.target_kind === "factor" &&
              finding.issue_code === "calibration_factor_gold_only_miss" &&
              !editorWillRender ? (
                <GoldFactorMissEmbed finding={finding} />
              ) : null}
            </>
          }
        />
      ) : null}

      {/* Action row last — the editor + verdict buttons (the
          curator's act-on-it surface). Comes AFTER the auditor
          details so the curator reads the justification then drops
          straight onto the buttons. Collapses with the card. */}
      {cardOpen ? <FindingActionRow finding={finding} /> : null}
    </div>
  );
}

/** Inline one-line "why" caption that sits BESIDE the card title —
 *  pulls from `suggested_fix` / `rationale` / `proposer_defense` in
 *  that order via `findingShortRationale()`, trimmed at the first
 *  clause boundary and capped at ~50 chars so it doesn't push the
 *  right-aligned chips to a second line. Hover surfaces the full
 *  text. Renders nothing when no source is usable. Per Paul
 *  2026-06-11: "keep the text on the same line as the title and
 *  shorten it." */
function FindingShortRationale({ finding }: { finding: AuditFinding }) {
  const summary = findingShortRationale(finding);
  if (!summary) return null;
  return (
    <span
      className="text-[11px] italic text-slate-500 dark:text-slate-400 truncate min-w-0"
      title={
        finding.rationale ||
        finding.suggested_fix ||
        finding.proposer_defense ||
        undefined
      }
    >
      <span className="text-slate-400 dark:text-slate-500 mr-1">·</span>
      {summary}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FindingActionRow — verdict buttons + dialogs + structured editor
// ---------------------------------------------------------------------------

/** Translate a server / network error from the disposition PATCH path
 *  into a curator-readable toast string. Strips URL paths, JSON
 *  payloads, FastAPI validation noise, and behind-the-scenes
 *  issue-code identifiers — leaves a one-sentence "what went wrong +
 *  what to do" message. Keeps the raw text in the toast `title`
 *  attribute (via the toast hook) so support / debug paths can still
 *  recover the detail. */
function friendlyDispositionError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // FastAPI 422 with structured body — extract the `msg` field and
  // route on intent rather than echoing the raw JSON.
  if (/accept_reason is required/i.test(raw)) {
    return "Couldn't save Agree — this finding needs a reason. Try Park to record one.";
  }
  if (/dismiss_reason is required/i.test(raw)) {
    return "Couldn't save Reject — pick a reason and try again.";
  }
  if (/not_sure_reason is required/i.test(raw)) {
    return "Couldn't save Park — pick a reason and try again.";
  }
  if (/notes is required/i.test(raw)) {
    return "Couldn't save — add a short note explaining why and try again.";
  }
  if (/^.*\b500\b/i.test(raw)) {
    return "Server error while saving — try again in a moment.";
  }
  if (/^.*\b401|forbidden|unauthor/i.test(raw)) {
    return "Couldn't save — your session may have expired. Sign in again.";
  }
  // Generic fallback — keep the human-readable bit (the first sentence
  // after any URL / status header) without leaking behind-the-scenes
  // strings.
  const tail = raw
    .replace(/^.*?(\d{3}\s+[A-Za-z ]+\s*[—-]\s*)/u, "")
    .replace(/\bissue_code='[^']*'/gu, "")
    .replace(/\[\{.*?\}\]/gus, "")
    .trim();
  return tail
    ? `Disposition save failed — ${tail.slice(0, 160)}`
    : "Disposition save failed.";
}

/** Primary "Apply & focus" / "Focus" button + secondary disposition
 *  controls (dismiss-with-chip dialog, needs-more-info, undo).
 *
 *  Action lifecycle:
 *    1. Resolve an `ApplyAction` for the finding via
 *       `resolveApplyAction()`.
 *    2. Click → if mutating, run the draft mutation; either way,
 *       request the audit-focus event so the Shell switches tab and
 *       scrolls the relevant element into view.
 *    3. Stamp the disposition as `accepted` (with `applied_fix`
 *       populated when a real fix was applied + `first_seen_at` on
 *       the first PATCH for this target — see firstSeen.ts).
 *
 *  Dismiss flow opens `DismissDialog` (chip-picker for the
 *  dismiss_reason enum from AUDIT_DISPOSITIONS.md ask #2). */
export function FindingActionRow({ finding }: { finding: AuditFinding }) {
  const {
    experimentId,
    report,
    dispositionByTarget,
    setDisposition,
    dispositionSaving,
    isFinalized,
    reopen,
    reopenSaving,
  } = useAudit();
  const { apply: applyDraft, draft } = useDesignDraft();
  const toast = useToast();
  // Review-mode lock — same gate as `ActionRow` in
  // FindingDetailsEditor. Curator can read the finding cards but can't
  // act on them without a calibration / ticket context. The per-card
  // banner is bordered + amber so the lock state reads as a real
  // status, not a passing caption.
  const readOnly = useIsReadOnly();
  const { baselineLabel } = useDesignDraft();
  // Hoisted from below so the read-only path can pass it to the
  // editor without re-deriving — same value, same source.
  const readOnlyDisposition =
    dispositionByTarget.get(finding.target_id)?.status ?? "pending";
  if (readOnly) {
    // Read-only path: the curator can't ACT on the finding, but they
    // should still SEE the same factor / FV comparison the editable
    // path shows — otherwise the card collapses to a bare amber
    // banner with no content under the title (Paul 2026-06-12: "why
    // can't I see the factors as usual?"). Render the structured
    // editor below the banner; its internal ``ActionRow`` already
    // suppresses the verdict buttons via its own ``useIsReadOnly``
    // check, so the result is "comparison visible, buttons gone".
    // Handlers are no-ops because the editor won't call them while
    // its ActionRow is suppressed.
    const noop = () => {};
    const noopAsync = async () => {};
    const editorRenders = findingHasStructuredContent(finding, report, draft);
    return (
      <div className="pl-1.5 pt-2 space-y-1.5">
        <div
          className="rounded border border-amber-300 bg-amber-50/70 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200"
          role="status"
        >
          <span className="font-semibold uppercase tracking-wide text-[10px] mr-1.5">
            Read-only
          </span>
          viewing{" "}
          <span className="font-mono">{baselineLabel ?? "this baseline"}</span>
          {" "}— switch the chip-strip baseline to consensus or your polished
          row to act on findings.
        </div>
        {editorRenders ? (
          <FindingDetailsEditor
            finding={finding}
            report={report}
            design={draft}
            currentDisposition={readOnlyDisposition}
            onSave={noopAsync}
            onDismiss={noop}
            onPark={noop}
          />
        ) : null}
      </div>
    );
  }
  const [dismissOpen, setDismissOpen] = useState(false);
  // Two new dialogs for the unified reason flow (2026-05-10): accept
  // (curator agrees with an agent-extra suggestion) and not-sure
  // (curator parks the finding with a documented reason). Same
  // anchor-positioned popover as dismiss, different reason chips.
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [notSureOpen, setNotSureOpen] = useState(false);
  // Edit-mode flags pair with the *Open state above. Set together
  // when the curator clicks the "✎ edit" link on an already-
  // dispositioned finding; the dialog renders with prefilled
  // notes/tag and a "Save" confirm. Server-side this is the same PATCH
  // path — append-only log, latest-per-target_id wins.
  const [dismissEditing, setDismissEditing] = useState(false);
  const [acceptEditing, setAcceptEditing] = useState(false);
  const [notSureEditing, setNotSureEditing] = useState(false);
  // Draft snapshot taken just before a mutating apply action runs.
  // Restored by the undo button so "undo" reverts BOTH the server
  // disposition and the draft mutation together.
  const [preApplyDraftSnapshot, setPreApplyDraftSnapshot] =
    useState<Design | null>(null);
  // The DismissDialog portals out of the sidebar's overflow context
  // and positions itself relative to these refs' bounding rects — one
  // ref per dialog-trigger button.
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);
  const acceptBtnRef = useRef<HTMLButtonElement | null>(null);
  const notSureBtnRef = useRef<HTMLButtonElement | null>(null);
  // Pass the report + draft so factor-level calibration apply handlers
  // (extra → add factor, gold_only_miss → remove factor) can resolve
  // the agent factor and guard against double-applies.
  const action = resolveApplyAction(finding, { report, design: draft });
  const disposition = dispositionByTarget.get(finding.target_id);
  const current = disposition?.status ?? "pending";
  // Action-named button labels — replaces the legacy "Agree" / "Reject"
  // pair with verbs matched to the actual mutation (Add / Remove /
  // Confirm / …). Paul 2026-06-14: "green should ALWAYS mean 'accept
  // the agent'", and the secondary button names the opposite action
  // ("Don't remove") rather than the meta-stance ("Reject"). See
  // ``findingDispositionButtonLabels`` for the full per-code table.
  const dispoLabels = findingDispositionButtonLabels(finding);
  // Judge says weak → reframe the action row so Dismiss is the primary
  // blue button and the structural-apply demotes to a small "override"
  // link. Without this the curator gets mixed signals (Suggested Fix
  // says "keep" while the primary button still pushes the contradicting
  // structural action). See AUDIT_DEFENDER_VERDICT_HANDOFF.md.
  const dv = finding.defender_verdict ?? null;
  const judgeWeak =
    (dv?.strength ?? verdictStrength(dv?.verdict)) === "weak";
  // Subsumed FV children of this finding (only non-empty when this is
  // a factor finding; the helper short-circuits otherwise). Cached so
  // we can show "+ N FVs cascaded" in the action tooltip and toast
  // without re-deriving on every click.
  const subsumedChildren = report
    ? subsumedFvChildren(finding, report.findings)
    : [];
  // Two-step accept (Ask #6). When status=accepted:
  //   resolved_at == null  → "parked" (curator agrees, hasn't acted)
  //   resolved_at != null  → "resolved" (curator agreed and acted)
  // Other statuses ignore resolved_at; the server validator rejects
  // resolved_at on anything other than accepted.
  const isResolved = current === "accepted" && !!disposition?.resolved_at;
  const isParked = current === "accepted" && !disposition?.resolved_at;

  // Some agree-cases have no follow-up work in Gemma — e.g. a
  // calibration_match (both sides have the tag, agreeing means "yes
  // confirmed") or a calibration_gold_only_miss (the gold already has
  // X; agreeing means "yes the agent missed it; the existing curation
  // is right"). The two-step park → Mark resolved flow assumes there's
  // a structural fix the curator walks off to apply, so we collapse it
  // to a single Confirm step for these cases.
  const noFollowUp =
    finding.severity === "ok" ||
    finding.issue_code === "calibration_gold_only_miss" ||
    finding.issue_code === "calibration_match";

  async function patch(
    status: DispositionStatus,
    extras: {
      notes?: string;
      dismissReason?: DismissReason;
      acceptReason?: AcceptReason;
      notSureReason?: NotSureReason;
      appliedFix?: import("@/api/auditTypes").AppliedFix | string;
      resolvedAt?: string;
      structureOk?: boolean | null;
      detailsOk?: boolean | null;
    } = {},
  ) {
    const firstSeenAt = consumeFirstSeen(finding.target_id) ?? undefined;
    try {
      await setDisposition(finding.target_id, status, {
        ...extras,
        firstSeenAt,
      });
    } catch (err) {
      // 409 means the audit was finalized between the curator's click
      // and the PATCH landing. Surface a clear "reopen first"
      // affordance in the toast rather than the generic message; every
      // other failure (network, 500) keeps the generic path.
      const apiErr = err as { status?: number; message?: string };
      if (apiErr.status === 409) {
        toast.show(
          "Audit is closed — reopen it to keep editing dispositions.",
          "danger",
          6000,
        );
        return;
      }
      toast.show(friendlyDispositionError(err), "danger", 6000);
      return;
    }

    // Cascade: when the curator dispositions a factor finding, flow
    // the same disposition to the FV children the suppression rule
    // treats as subsumed. Skip on undo (status=pending) — a mis-click
    // on the parent shouldn't ripple through and undo explicit per-FV
    // calls. Skip any child whose disposition has already been touched
    // explicitly so a curator's manual call on an individual FV always
    // wins. `inherited_from` is set to the parent's target_id so the
    // dispositions report can weight cascaded vs direct curator calls
    // differently.
    if (
      status === "pending" ||
      finding.target_kind !== "factor" ||
      subsumedChildren.length === 0
    ) {
      return;
    }
    let cascaded = 0;
    let cascadeFailed = 0;
    for (const child of subsumedChildren) {
      const existing = dispositionByTarget.get(child.target_id);
      if (existing && existing.status !== "pending") continue;
      try {
        await setDisposition(child.target_id, status, {
          ...extras,
          inheritedFrom: finding.target_id,
        });
        cascaded++;
      } catch {
        cascadeFailed++;
      }
    }
    if (cascaded > 0) {
      toast.show(
        `Cascaded to ${cascaded} subsumed FV finding${
          cascaded === 1 ? "" : "s"
        }.${
          cascadeFailed > 0
            ? ` (${cascadeFailed} failed — review the suppressed list.)`
            : ""
        }`,
        cascadeFailed > 0 ? "danger" : "success",
        cascadeFailed > 0 ? 6000 : 3000,
      );
    } else if (cascadeFailed > 0) {
      toast.show(
        `Cascade failed for ${cascadeFailed} subsumed FV finding${
          cascadeFailed === 1 ? "" : "s"
        } — review the suppressed list.`,
        "danger",
        6000,
      );
    }
  }

  // Read-only when finalized. Surface a one-line "closed — reopen to
  // edit" with an inline reopen button so the curator can flip the
  // audit back open without leaving the finding card. Skip the action
  // / dismiss / ? buttons entirely; their disabled-state tooltips would
  // just hide the actual cause.
  if (isFinalized) {
    return (
      <div className="pl-1.5 flex items-center gap-2 text-[10px] text-slate-500">
        <span>audit closed — reopen to edit</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await reopen();
              toast.show("Audit reopened.", "success");
            } catch (err) {
              toast.show(
                `Couldn't reopen audit: ${(err as Error).message}`,
                "danger",
                6000,
              );
            }
          }}
          disabled={reopenSaving}
          className="text-slate-700 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
        >
          {reopenSaving ? "reopening…" : "reopen"}
        </button>
      </div>
    );
  }

  // Two flavours of "primary action":
  //  - **Mutating** ("Apply & focus →"): runs the draft mutation,
  //    fires the focus event, and stamps disposition=accepted.
  //    Acceptance is implicit because the curator just took the
  //    action the finding asked for.
  //  - **Focus-only** ("Focus →"): just navigates to the target.
  //    Does NOT change the disposition — looking at something isn't
  //    the same as accepting the finding. The separate "Accept" button
  //    below covers that explicitly.
  async function handleApply(extras?: {
    acceptReason?: AcceptReason;
    notes?: string;
  }) {
    if (!action) return;
    if (action.mutates && action.mutate) {
      if (!draft) {
        toast.show(
          "Can't apply — design draft not loaded yet.",
          "danger",
          4000,
        );
        return;
      }
      // Confirmation gate: when the apply action carries a
      // `confirmMessage` (today: factor-name-clash on
      // `calibration_factor_extra`), surface a confirm dialog before
      // mutating. Per Cy 2026-06-05 — silent second-factor add was
      // confusing; until we decide merge-vs-add semantics (Paul),
      // curator confirms each. Plain `window.confirm` is ugly but
      // unambiguous.
      if (action.confirmMessage) {
        const ok = window.confirm(action.confirmMessage);
        if (!ok) return;
      }
      setPreApplyDraftSnapshot(draft);
      applyDraft(action.mutate);
      requestAuditFocus(
        experimentId,
        action?.focusTargetId ?? finding.target_id,
      );
      if (action.successMessage) {
        toast.show(action.successMessage, "success");
      }
      // Most mutating applies imply accepted+resolved (Ask #6) — the
      // curator just took the structural action the finding asked for,
      // so there's nothing left to "park" until later. The
      // calibration_gold_only_miss apply is the exception: removing
      // the tag *disagrees* with the finding (the agent was right;
      // gold over-tagged), so the action carries
      // dispositionStatus="dismissed" + dismissReason="curator_wrong"
      // and we follow that. Default stays accepted+resolved.
      const status = action.dispositionStatus ?? "accepted";
      if (status === "dismissed") {
        await patch("dismissed", {
          appliedFix: action.appliedFix,
          dismissReason: action.dismissReason,
          notes: extras?.notes,
        });
      } else {
        await patch("accepted", {
          appliedFix: action.appliedFix,
          resolvedAt: new Date().toISOString(),
          acceptReason: extras?.acceptReason,
          notes: extras?.notes,
        });
      }
      return;
    }
    // Focus-only path — no PATCH.
    requestAuditFocus(experimentId, finding.target_id);
  }

  async function handleDismissConfirm(tag: string | null, notes: string) {
    await patch("dismissed", {
      dismissReason: (tag ?? undefined) as DismissReason | undefined,
      notes,
    });
    setDismissOpen(false);
  }

  async function handleAcceptConfirm(tag: string | null, notes: string) {
    setAcceptOpen(false);
    // Mutating findings (e.g. calibration_agent_extra → add tag) route
    // through handleApply so the draft mutation runs alongside the
    // disposition stamp. Non-mutating findings (calibration_factor_match,
    // calibration_match, etc.) just need the disposition + optional
    // note — patch directly so the curator's notes don't get dropped.
    if (action?.mutates) {
      await handleApply({
        acceptReason: (tag ?? undefined) as AcceptReason | undefined,
        notes,
      });
      return;
    }
    await patch("accepted", {
      acceptReason: (tag ?? undefined) as AcceptReason | undefined,
      notes,
      // No-follow-up findings (match / gold_only_miss) have nothing
      // left to do once the curator agrees — auto-stamp resolved_at so
      // they don't sit in the parked queue. Findings with follow-up
      // stay parked; curator marks resolved after doing the work.
      ...(noFollowUp ? { resolvedAt: new Date().toISOString() } : {}),
    });
  }

  async function handleNotSureConfirm(tag: string | null, notes: string) {
    await patch("needs_more_info", {
      notSureReason: (tag ?? undefined) as NotSureReason | undefined,
      notes,
    });
    setNotSureOpen(false);
  }

  // Per-element 2-axis editor — when the finding has resolvable
  // structured content (factor proposals with comparison_proposal
  // entries; tag proposals with proposer_term), the editor replaces
  // the legacy single-button action row. Dismiss + Park still route
  // through the existing dialogs (rendered below); only the primary
  // affordance changes.
  const useStructuredEditor =
    !isFinalized && findingHasStructuredContent(finding, report, draft);

  return (
    <div className="pl-1.5 pt-2 space-y-1.5 relative">
      {useStructuredEditor ? (
        <FindingDetailsEditor
          finding={finding}
          report={report}
          design={draft}
          currentDisposition={current}
          onSave={async (appliedFix, structureOk, detailsOk, notes) => {
            // Conventional mapping lives in `dispositionSave.ts` —
            // editor computes structure_ok / details_ok per
            // `verdictToStructureDetails(verdict, issue_code)`; here we
            // derive the headline status + a default dismiss_reason
            // for the "keep gold" one-click path.
            const status = deriveStatus(structureOk, detailsOk);
            // Structural-apply route: findings whose canonical fix is
            // adding or removing a factor (`calibration_factor_extra` =
            // add agent's factor; `calibration_factor_gold_only_miss` =
            // remove gold's factor) can't go through the editor's per-
            // row `applyDetailsEditsToDesign` path — that helper only
            // edits within an existing factor. When the curator accepts
            // one of those structural-only findings, route through the
            // `ApplyAction` mutator the legacy `handleApply` uses, with
            // the same snapshot + focus + toast + `action.appliedFix`
            // payload it would have produced.
            const isStructuralOnly =
              finding.issue_code === "calibration_factor_extra" ||
              finding.issue_code === "augmentation_factor_extra" ||
              finding.issue_code === "calibration_factor_gold_only_miss" ||
              finding.issue_code === "calibration_agent_extra" ||
              finding.issue_code === "calibration_gold_only_miss" ||
              // partition_mismatch's "adopt agent's finer/fewer levels"
              // is a structural replace — same routing as extra/miss.
              // Paul 2026-06-14: prior to this, the editor PATCHed the
              // disposition but never ran the mutator, leaving the
              // design at the gold partition while the card showed as
              // accepted.
              finding.issue_code === "calibration_factor_partition_mismatch";
            if (
              isStructuralOnly &&
              status === "accepted" &&
              action?.mutates &&
              action.mutate &&
              draft
            ) {
              // Same confirmation gate as the per-finding handleApply
              // path above — surface confirmMessage before any silent
              // mutate. Keeps the factor-name-clash guard consistent
              // across both apply entry points.
              if (action.confirmMessage) {
                const ok = window.confirm(action.confirmMessage);
                if (!ok) return;
              }
              setPreApplyDraftSnapshot(draft);
              applyDraft(action.mutate);
              requestAuditFocus(
        experimentId,
        action?.focusTargetId ?? finding.target_id,
      );
              if (action.successMessage) {
                toast.show(action.successMessage, "success");
              }
              const actionStatus = action.dispositionStatus ?? "accepted";
              if (actionStatus === "dismissed") {
                await patch("dismissed", {
                  appliedFix: action.appliedFix,
                  dismissReason: action.dismissReason,
                  notes,
                });
              } else {
                // Server gates accepts on agent-extra findings with
                // `accept_reason`. The structural-only branch fires
                // immediately on Agree — no chip dialog — so default to
                // `well_evidenced` ("agent's evidence holds up").
                // Curators who want a different reason can Park +
                // re-Agree through the chip dialog.
                const acceptReason = isAgentExtraIssue(finding.issue_code)
                  ? ("well_evidenced" as const)
                  : undefined;
                await patch("accepted", {
                  appliedFix: action.appliedFix,
                  resolvedAt: new Date().toISOString(),
                  acceptReason,
                  notes,
                });
              }
              return;
            }
            const resolvedAt =
              status === "accepted"
                ? new Date().toISOString()
                : undefined;
            const derivedDismissReason = deriveDismissReason(
              status,
              finding.issue_code,
            );
            const derivedAcceptReason = deriveAcceptReason(
              status,
              finding.issue_code,
            );
            // Dual-write: apply the curator's per-row edits to the
            // design draft BEFORE patching the disposition. The draft
            // mutation shows up immediately in the Design tab and rides
            // to commit via CommitBar; the disposition PATCH records
            // the same edits on the audit (for the scorer + audit
            // trail).
            if (
              typeof appliedFix !== "string" &&
              appliedFix.kind === "details_edit" &&
              appliedFix.edits &&
              appliedFix.edits.length > 0
            ) {
              // Pass a function rather than the computed Design so the
              // mutation runs against the latest draft state.
              applyDraft((current) =>
                applyDetailsEditsToDesign(
                  current,
                  finding,
                  report,
                  appliedFix,
                ),
              );
            }
            await patch(status, {
              appliedFix,
              structureOk,
              detailsOk,
              resolvedAt,
              dismissReason: derivedDismissReason,
              acceptReason: derivedAcceptReason,
              notes,
            });
          }}
          onAgree={() => {
            // Plain agree — no draft mutation. Opens the accept dialog
            // so the curator can attach a reason chip + note when the
            // finding has no per-row apply path (wrong_fv_partition
            // etc.). Mirrors the legacy action-row's standalone Agree
            // handler.
            setAcceptOpen(true);
          }}
          onDismiss={() => setDismissOpen(true)}
          onPark={() => setNotSureOpen(true)}
          onUndo={() => {
            // Two undo paths share this button:
            //   1. Per-finding apply: the local `preApplyDraftSnapshot`
            //      captures the pre-apply draft. Restore it.
            //   2. Apply-All batch: the snapshot lives in the shared
            //      `appliedBatches` tracker keyed by target_id.
            //      `undoBatched` returns a mutator that rebuilds the
            //      draft = snapshot + all OTHER batch mutations, so
            //      undoing this one finding leaves siblings'
            //      contributions intact.
            const batched = undoBatched(finding.target_id);
            if (batched) {
              applyDraft(batched);
            } else if (preApplyDraftSnapshot) {
              const snap = preApplyDraftSnapshot;
              setPreApplyDraftSnapshot(null);
              applyDraft(() => snap);
            }
            patch("pending");
            // Roll proposal-review state back in lockstep with the
            // draft + disposition (Paul 2026-06-10): a per-finding undo
            // had been leaving the proposal cards stuck on their
            // retained/rejected dispositions, which read as "this
            // proposal is still resolved" even though the matching
            // draft mutation + audit disposition were reverted.
            clearAllProposalStateForExperiment(experimentId);
            notifyProposalStateReset(experimentId);
          }}
        />
      ) : (
        <div className="flex items-center gap-1 flex-wrap">
          {action ? (
            (() => {
              // Mutating apply has already run when the disposition
              // moved off "pending" (current === "accepted" /
              // "dismissed" — the apply path stamps both, depending on
              // whether the action was an agree-and-fix or
              // disagree-and-fix). Re-clicking would re-run the draft
              // mutation; for the calibration paths the dedup guards
              // make it idempotent, but the curator's mental model is
              // "I've done this", so grey it out. Undo via the explicit
              // disposition buttons (Agree → undo, Disagree → undo)
              // re-enables the apply for re-runs.
              const applyAlreadyDone =
                action.mutates && current !== "pending";
              // Action-named labels override the legacy "Agree (add) →"
              // strings that applyHandlers still emits. The mutating
              // path reads "Add →" / "Remove →" / "Confirm →" etc.;
              // focus-only paths keep their navigation tone.
              const label = action.mutates
                ? `${dispoLabels.acceptLabel} →`
                : action.label || "Focus →";
              const labelDone = action.mutates
                ? dispoLabels.acceptDoneLabel
                : (action.label || "")
                    .replace(/^(Agree|Apply)\b/, "✓ Done")
                    .replace(/\s*→\s*$/, "");
              // Agent-extra accept now requires an explanation
              // (2026-05-10): adding new curation deserves a "why".
              // Click opens the accept-reason dialog instead of running
              // the mutation immediately. Other mutating applies (e.g.
              // calibration_gold_only_miss = remove tag) skip the
              // dialog — those are already a "no" and covered by the
              // dismiss-reason flow inside handleApply.
              const isAgentExtra =
                finding.issue_code === "calibration_agent_extra";
              const onPrimaryClick = () => {
                if (
                  isAgentExtra &&
                  action.mutates &&
                  !applyAlreadyDone
                ) {
                  setAcceptOpen(true);
                } else {
                  handleApply();
                }
              };
              // Judge-weak demotion: the structural apply contradicts
              // the judge, so demote to a small "override anyway"
              // link. Dismiss (rendered below) becomes the primary
              // affordance for these findings. Curator can still
              // override the judge by clicking through.
              if (judgeWeak && action.mutates && !applyAlreadyDone) {
                return (
                  <button
                    ref={acceptBtnRef}
                    type="button"
                    onClick={onPrimaryClick}
                    disabled={dispositionSaving}
                    title={`override the judge — ${
                      action.tooltip ?? label
                    }`}
                    className="text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline dark:text-slate-400 dark:hover:text-slate-100 disabled:opacity-50"
                  >
                    override · {label.replace(/\s*→\s*$/, "")}
                  </button>
                );
              }
              return (
                <button
                  ref={acceptBtnRef}
                  type="button"
                  onClick={onPrimaryClick}
                  disabled={dispositionSaving || applyAlreadyDone}
                  title={
                    applyAlreadyDone
                      ? "Already applied — undo below to re-run"
                      : action.tooltip
                  }
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded font-medium",
                    action.mutates
                      ? dispositionSaving
                        ? "bg-emerald-200 text-emerald-800 cursor-progress"
                        : applyAlreadyDone
                          ? // Greyed-out post-apply state. Indicates
                            // the structural change has landed; undo
                            // through the disposition buttons.
                            "bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700"
                          : current === "accepted"
                            ? "bg-emerald-700 text-white hover:bg-emerald-800"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                      : // Focus-only action is just navigation; tone
                        // it down so it doesn't compete with the
                        // explicit Agree verb next to it.
                        "bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  {applyAlreadyDone ? labelDone : label}
                </button>
              );
            })()
          ) : null}
          {/* Standalone Agree button — hidden when there's a mutating
              apply action, since the "Agree (add)/(remove) →" button
              above IS the agree affordance for those cases. */}
          {action?.mutates || judgeWeak ? null : (
            <button
              ref={acceptBtnRef}
              type="button"
              onClick={() => {
                // Undo path stays single-click — re-Agreeing on
                // something already accepted means "back to pending".
                if (current === "accepted") {
                  patch("pending");
                  return;
                }
                // Fresh agree → open the accept dialog so the curator
                // can pick a reason chip and add a note.
                setAcceptOpen(true);
              }}
              disabled={dispositionSaving}
              title={
                isResolved
                  ? "undo — back to pending (clears resolved_at)"
                  : isParked
                    ? "undo — back to pending"
                    : noFollowUp
                      ? `${dispoLabels.acceptLabel.toLowerCase()} (click again to undo)`
                      : `${dispoLabels.acceptLabel.toLowerCase()} (resolve once you've fixed the data)`
              }
              className={cn(
                "text-[11px] px-2 py-0.5 rounded font-medium disabled:opacity-50",
                // Always green for the accept-agent CTA. The post-
                // accept "✓ done" state stays solid emerald; the
                // pre-accept resting state is an outlined emerald
                // button so it visually pops without screaming.
                isResolved
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : isParked
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : "bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:bg-slate-900 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-slate-800",
              )}
            >
              {isResolved
                ? `✓✓ ${dispoLabels.acceptDoneLabel.replace(/^✓\s*/, "").toLowerCase()}`
                : isParked
                  ? noFollowUp
                    ? dispoLabels.acceptDoneLabel
                    : "✓ parked"
                  : dispoLabels.acceptLabel}
            </button>
          )}
          {isParked && !noFollowUp ? (
            <button
              type="button"
              onClick={() =>
                patch("accepted", {
                  resolvedAt: new Date().toISOString(),
                })
              }
              disabled={dispositionSaving}
              title="mark resolved — once you've fixed the data"
              className="text-[11px] px-2 py-0.5 rounded font-medium border border-emerald-700 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-slate-800"
            >
              Resolve →
            </button>
          ) : null}
          <button
            ref={dismissBtnRef}
            type="button"
            onClick={() => setDismissOpen(true)}
            disabled={dispositionSaving}
            title={
              judgeWeak
                ? `judge says ${dispoLabels.dismissLabel.toLowerCase()} (pick a reason)`
                : `${dispoLabels.dismissLabel.toLowerCase()} (pick a reason)`
            }
            className={cn(
              "rounded font-medium disabled:opacity-50",
              judgeWeak
                ? // Promoted to primary slate when the judge advises
                  // against the apply — disagree is the natural action,
                  // but it still shouldn't claim the accept-agent green
                  // slot. Solid slate beats green for "the judge says
                  // this isn't the move" without competing with the
                  // primary accept CTA elsewhere on the page.
                  "text-[11px] px-2 py-0.5 " +
                    (current === "dismissed"
                      ? "bg-slate-800 text-white hover:bg-slate-900"
                      : "bg-slate-700 text-white hover:bg-slate-800")
                : "text-[11px] px-2 py-0.5 border " +
                    (current === "dismissed"
                      ? "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
                      : "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"),
            )}
          >
            {current === "dismissed"
              ? `✓ ${dispoLabels.dismissLabel.toLowerCase()}`
              : `${dispoLabels.dismissLabel}…`}
          </button>
          {/* Park button — Paul 2026-06-14: "I'm not sure we have
              park functionality; let's hide that, but don't remove
              it." The handlers + chip set + server enum all stay
              wired up; just don't surface the affordance until the
              flow that needs it (mid-curation handoffs, partial
              review) actually lands. Restore by flipping the gate. */}
          {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
          {false ? (
            <button
              ref={notSureBtnRef}
              type="button"
              onClick={() => {
                if (current === "needs_more_info") {
                  patch("pending");
                } else {
                  setNotSureOpen(true);
                }
              }}
              disabled={dispositionSaving}
              title="park with an explanation — counts as decided"
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium disabled:opacity-50",
                current === "needs_more_info"
                  ? "bg-amber-600 text-white"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
              )}
            >
              {current === "needs_more_info" ? "✓ parked" : "Park…"}
            </button>
          ) : null}
          {current !== "pending" ? (
            <button
              type="button"
              onClick={() => {
                // See the editor-card onUndo above for the two-path
                // rationale (per-finding snapshot vs Apply-All batch).
                const batched = undoBatched(finding.target_id);
                if (batched) {
                  applyDraft(batched);
                } else if (preApplyDraftSnapshot) {
                  const snap = preApplyDraftSnapshot;
                  setPreApplyDraftSnapshot(null);
                  applyDraft(() => snap);
                }
                patch("pending");
                // Mirror the editor-card path: drop the per-experiment
                // proposal-review LS state and broadcast the in-memory
                // reset so the proposal cards roll back in lockstep.
                clearAllProposalStateForExperiment(experimentId);
                notifyProposalStateReset(experimentId);
              }}
              disabled={dispositionSaving}
              className="text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline ml-auto dark:text-slate-400 dark:hover:text-slate-100"
              title="undo — reverts disposition and any draft change"
            >
              undo
            </button>
          ) : null}
          {dispositionSaving ? (
            <span className="text-[10px] text-slate-400 italic ml-1 dark:text-slate-500">
              saving…
            </span>
          ) : null}
        </div>
      )}
      <DispositionNoteRow
        disposition={disposition}
        isFinalized={isFinalized}
        onEdit={() => {
          // Route edit to the right dialog based on current status.
          // The trigger button refs are reused — the popover anchors on
          // the same Disagree / Park / accept button it would for a
          // "new" disposition, so positioning stays consistent.
          if (current === "dismissed") {
            setDismissEditing(true);
            setDismissOpen(true);
          } else if (current === "needs_more_info") {
            setNotSureEditing(true);
            setNotSureOpen(true);
          } else if (current === "accepted") {
            setAcceptEditing(true);
            setAcceptOpen(true);
          }
        }}
      />
      {dismissOpen
        ? (() => {
            // Prefill order: structured field (post-2026-05-13 canonical
            // chip) → legacy `[tag]` prefix in notes (pre-2026-05-13
            // rows). Handled by resolveEditInitial.
            const prefill =
              dismissEditing && disposition
                ? resolveEditInitial(disposition, "dismiss")
                : { tag: null, plain: "" };
            return (
              <DismissDialog
                mode="dismiss"
                chips={dismissChipsFor(finding)}
                finding={finding}
                targetId={finding.target_id}
                anchor={dismissBtnRef.current}
                titleOverride={dispoLabels.dismissDialogTitle}
                confirmLabelOverride={dispoLabels.dismissDialogTitle}
                isEdit={dismissEditing}
                initialTag={prefill.tag}
                initialNotes={prefill.plain}
                onCancel={() => {
                  setDismissOpen(false);
                  setDismissEditing(false);
                }}
                onConfirm={async (tag, notes) => {
                  await handleDismissConfirm(tag, notes);
                  setDismissEditing(false);
                }}
              />
            );
          })()
        : null}
      {acceptOpen
        ? (() => {
            const prefill =
              acceptEditing && disposition
                ? resolveEditInitial(disposition, "accept")
                : { tag: null, plain: "" };
            return (
              <DismissDialog
                mode="accept"
                chips={acceptChipsFor(finding.issue_code)}
                finding={finding}
                targetId={finding.target_id}
                anchor={acceptBtnRef.current}
                isEdit={acceptEditing}
                initialTag={prefill.tag}
                initialNotes={prefill.plain}
                onCancel={() => {
                  setAcceptOpen(false);
                  setAcceptEditing(false);
                }}
                onConfirm={async (tag, notes) => {
                  await handleAcceptConfirm(tag, notes);
                  setAcceptEditing(false);
                }}
              />
            );
          })()
        : null}
      {notSureOpen
        ? (() => {
            const prefill =
              notSureEditing && disposition
                ? resolveEditInitial(disposition, "not_sure")
                : { tag: null, plain: "" };
            return (
              <DismissDialog
                mode="not_sure"
                chips={NOT_SURE_CHIPS}
                finding={finding}
                targetId={finding.target_id}
                anchor={notSureBtnRef.current}
                isEdit={notSureEditing}
                initialTag={prefill.tag}
                initialNotes={prefill.plain}
                onCancel={() => {
                  setNotSureOpen(false);
                  setNotSureEditing(false);
                }}
                onConfirm={async (tag, notes) => {
                  await handleNotSureConfirm(tag, notes);
                  setNotSureEditing(false);
                }}
              />
            );
          })()
        : null}
    </div>
  );
}
