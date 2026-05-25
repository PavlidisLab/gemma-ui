import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { agentPalette, isProseModel } from "@/lib/agentPalette";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";

/** Curation-side FvDisplayRow term renderer — same one the proposal-
 *  review surface uses. Pulling it into a local const keeps the
 *  audit + proposal-review surfaces visually identical when they
 *  consume the shared row. */
const curationTermRenderer: FvTermRenderer = ({ label, uri, variant }) => (
  <Term
    uri={uri}
    asLink={false}
    variant={variant === "predicate" ? "predicate" : "default"}
    className="!whitespace-normal break-words"
  >
    {label}
  </Term>
);
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useDesign } from "@/api/design";
import type { useAuditStream } from "@/api/auditStream";
import { ProposeProgressPanel } from "@/features/proposal/ProposeProgressPanel";
import sampleReport from "./fixtures/sample_audit_report.json";
import { useAudit, findingKey } from "./AuditContext";
import {
  experimentTarget,
  factorTarget,
  fvTarget,
  tagTarget,
  assignmentTarget,
  parseTargetId,
} from "./targetIds";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import { resolveApplyAction } from "./applyHandlers";
import {
  FindingDetailsEditor,
  countFindingDisagreements,
  extractAuditIdentities,
  findingHasStructuredContent,
} from "./FindingDetailsEditor";
import { applyDetailsEditsToDesign } from "./applyDetailsEdits";
import { deriveStatus, deriveDismissReason, deriveAcceptReason } from "./dispositionSave";
import {
  firstBacktick,
  splitRationaleTrail,
  trimRationaleBoilerplate,
} from "./rationaleText";
import {
  AGENT_NO_DETAILS_SENTINEL,
  isActionPrefixRationale,
  isProposerSuggestionRedundant,
  isSuggestedFixRedundant,
  parseProposerSuggestion,
  pickJudgeRowText,
  s10MatchesHeaderUri,
} from "./auditorDetails";
import { DismissDialog, type DialogChip } from "./DismissDialog";
import {
  findingLean,
  leanSuggestionLabel,
} from "./defenderLean";
import { markFirstSeen, consumeFirstSeen } from "./firstSeen";
import type { AcceptReason, DismissReason, NotSureReason } from "@/api/auditTypes";
import { parsePrefixedNote, resolveEditInitial } from "./dispositionEdit";
import type {
  AttachedDefenderVerdict,
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  AuditTargetKind,
  CurationReviewKind,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";

/** Per-kind framing copy. Centralised here so every user-facing
 *  string the sidebar emits flows through one switch — adding a
 *  third kind (e.g. ``"evaluation"``) is one entry, not a
 *  panel-wide grep. ``noun`` is the bare singular ("audit"),
 *  ``Noun`` the capitalised form for sentence starts, ``verbed``
 *  the past-tense verb the close-toast uses. */
const KIND_COPY: Record<
  CurationReviewKind,
  {
    noun: string;
    Noun: string;
    nounPlural: string;
    /** Sidebar header label — "Audit" / "Proposal". */
    headerLabel: string;
    /** Empty-state body line. */
    emptyBody: string;
    /** Close-button label when pending findings exist. */
    closeButtonLabel: string;
    /** Dialog header on the close-confirm popover. */
    closeConfirmHeader: string;
    /** Toast on successful close. */
    closedToast: string;
    /** Toast on successful reopen. */
    reopenedToast: string;
    /** Idle label on the progress panel while no stream is running. */
    idleStreamLabel: string;
  }
> = {
  audit: {
    noun: "audit",
    Noun: "Audit",
    nounPlural: "audits",
    headerLabel: "Audit",
    emptyBody: "No audits on this experiment yet.",
    closeButtonLabel: "Close audit",
    closeConfirmHeader: "Close this audit?",
    closedToast: "Audit closed.",
    reopenedToast: "Audit reopened — dispositions editable again.",
    idleStreamLabel: "no audit running",
  },
  proposal: {
    noun: "proposal",
    Noun: "Proposal",
    nounPlural: "proposals",
    headerLabel: "Proposal",
    emptyBody: "No proposals on this experiment yet.",
    closeButtonLabel: "Close review",
    closeConfirmHeader: "Close this proposal review?",
    closedToast: "Proposal review closed.",
    reopenedToast:
      "Proposal review reopened — dispositions editable again.",
    idleStreamLabel: "no proposal review running",
  },
};
import type { Design } from "@/features/experiment/types";
import type { FactorProposal, FactorValueProposal, SubtaskDecision } from "@/api/types";
import {
  DesignComparisonPanel,
  SubtaskDecisionRow,
  dedupeSubtaskDecisions,
} from "./AuditReportView";
import { normalizeWikiUrl } from "@/lib/guidelines";
import { HelpPopup } from "@/components/ui/HelpPopup";
import {
  factorMatchVariant,
  isCloseFactorMatch,
  isExactFactorMatch,
  isNearMatchFinding,
  pickGoldFactor,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";

/**
 * Per-experiment audit findings, rendered into the proposals sidebar
 * slot (see `AUDIT_FEATURE.md` §UI integration shape — surface B).
 *
 * For now this is the **single source of truth for disposition
 * state**: the inline severity dots planned in surface A will read
 * from the same store once they land. Until the PATCH endpoint
 * ships, dispositions live in local component state and are dropped
 * when the audit report is replaced.
 *
 * The sidebar slot is narrow (~320px default), so this view favours
 * a one-line summary per finding with a click-to-expand body. The
 * full per-finding card is `AuditReportView`'s concern, not this
 * component's.
 */
export function AuditSidebarPanel({
  experimentId,
  stream,
}: {
  experimentId: number | string;
  /** Audit SSE stream lifted to the App shell so the unified
   *  AgentRunDialog can fire it from the sidebar header strip.
   *  This panel just renders the progress / state. */
  stream: ReturnType<typeof useAuditStream>;
}) {
  const { kind, report, setOverrideReport, hasOverride, loading, error } =
    useAudit();
  const copy = KIND_COPY[kind];
  const { draft } = useDesignDraft();
  // Panel-level card-expansion baseline. Proposals default to
  // ``"expanded"`` (curator reads agent's proposal as primary
  // content); audits default to ``"collapsed"`` (1-line headers, opt
  // into bodies). Curator can cycle through three states from the
  // header button below.
  const [panelExpansion, setPanelExpansion] = useState<PanelExpansion>(
    kind === "proposal" ? "expanded" : "collapsed",
  );
  function cyclePanelExpansion(): void {
    setPanelExpansion((prev) =>
      prev === "collapsed"
        ? "expanded"
        : prev === "expanded"
          ? "fully"
          : "collapsed",
    );
  }

  // Pick the accession the agent service expects. Numeric experiment_id
  // works (the resolver accepts numeric id, GSE accession, or shortName
  // interchangeably — same as /propose).
  const accession = draft?.experiment_short_name || String(experimentId);

  // Render order:
  //   1. Trigger dialog (if open) — modal, sits on top of everything
  //   2. Progress panel (if stream running / done / errored) — takes
  //      over the body so the curator focuses on the run
  //   3. Loading / error / empty / report (the existing states)
  //
  // The Run-audit button lives in the header card so it's reachable
  // from any sub-state below.
  // UI states for the body region:
  //   - running → progress panel only (blocks the body so the curator
  //               focuses on the live run)
  //   - done / error → progress panel above + the report below, so
  //               the curator sees both the run summary and the
  //               freshly-loaded findings without an extra click
  //   - idle → body shows loading / error / empty / report normally
  const showProgress = stream.status !== "idle";
  const blockBodyForProgress = stream.status === "running";

  return (
    <PanelExpansionContext.Provider value={panelExpansion}>
    <div className="space-y-1.5">
      {/* Single unified control card — trigger button + audit run info
          in one unit. Sky chrome matches the FactorChip + the audit
          findings' factor-card tint so the whole audit surface reads
          as one entity-identity color (blue = factor/audit). Per Paul
          2026-05-21. */}
      {/* Avoid the ``card`` class here — the global
          ``html.dark .card`` rule in index.css has higher CSS
          specificity than Tailwind's ``dark:bg-…`` utility and
          was forcing slate-800 over the sky tint in dark mode.
          Inline the rounded/border equivalents so the dark
          override doesn't hit. Per Paul 2026-05-21. */}
      <div className={cn(
        "px-2 py-1.5 space-y-1.5 rounded-lg border",
        "border-sky-300 bg-sky-50",
        "dark:border-sky-700 dark:bg-sky-900/40",
      )}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <SidebarTopBar
              accession={accession}
              hasOpenAudit={!!(report && !report.finalized_at)}
              kind={kind}
            />
          </div>
          {/* Panel-level "expand all" 3-way cycle. Lives in the
              top strip so the curator can flip the whole list
              from one place instead of opening each card
              individually. Only meaningful when there's a report
              with findings to expand. */}
          {report && report.findings.length > 0 ? (
            <PanelExpansionCycleButton
              state={panelExpansion}
              onCycle={cyclePanelExpansion}
            />
          ) : null}
        </div>
        {report ? (
          <div className="border-t border-sky-200 dark:border-sky-700/60 pt-1">
            <SidebarHeader
              report={report}
              hasOverride={hasOverride}
              onClearOverride={
                hasOverride ? () => setOverrideReport(null) : undefined
              }
            />
          </div>
        ) : null}
      </div>
      {showProgress ? (
        <ProposeProgressPanel
          state={stream}
          idleLabel={copy.idleStreamLabel}
          onDismiss={stream.reset}
        />
      ) : null}
      {!blockBodyForProgress ? (
        loading && !report ? (
          <div className="card p-3 text-xs text-slate-500 italic">
            loading {copy.nounPlural}…
          </div>
        ) : error && !report ? (
          <div className="card p-3 text-xs text-rose-700">
            couldn't load {copy.nounPlural}: {error}
          </div>
        ) : !report ? (
          <EmptyState
            kind={kind}
            onLoadFixture={() => setOverrideReport(adaptFixture(experimentId))}
            onSynthesize={
              draft
                ? () => setOverrideReport(synthesizeFromDraft(draft))
                : undefined
            }
          />
        ) : (
          <>
            {/* Findings collapse to a one-line summary once the
                audit is closed. The active triage list stops being
                actionable, and curators have explicitly said the
                cards then read as clutter. The summary line keeps
                the audit greppable + click-to-expand for review. */}
            {report.finalized_at ? (
              <ClosedFindingsSummary findings={report.findings} />
            ) : (
              <FindingList findings={report.findings} />
            )}
            {/* Side-by-side "agent proposal vs current design" panel
                only makes sense when there's existing curation to
                compare against. For ``kind="proposal"`` (uncurated /
                preboarded GSE), the agent's proposal IS the content
                — there's no curator side, so the panel is omitted.
                See AUDIT_TO_REVIEW_RENAME_UI_HANDOFF.md §2. */}
            {kind === "audit" ? (
              <DesignComparisonPanel report={report} />
            ) : null}
          </>
        )
      ) : null}
    </div>
    </PanelExpansionContext.Provider>
  );
}

/** Tiny header card that sits above the audit content. Shows the
 *  experiment accession and a small "open audit exists" indicator
 *  when applicable. The Run-audit trigger lives in the unified
 *  sidebar header strip (Request/Re-run button) which opens
 *  AgentRunDialog at the App level, not here. */
function SidebarTopBar({
  accession,
  hasOpenAudit,
  kind,
}: {
  accession: string;
  /** True when a non-finalized audit already exists for this experiment. */
  hasOpenAudit: boolean;
  kind: CurationReviewKind;
}) {
  const copy = KIND_COPY[kind];
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 truncate">
        {copy.headerLabel}{" "}
        <span className="font-mono text-slate-700">{accession}</span>
      </span>
      {hasOpenAudit ? (
        <span
          className="text-[10px] text-amber-600 dark:text-amber-400"
          title={`this experiment already has an open (unfinished) ${copy.noun}`}
        >
          open {copy.noun} exists
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  kind,
  onLoadFixture,
  onSynthesize,
}: {
  kind: CurationReviewKind;
  onLoadFixture: () => void;
  /** Optional — only available when a design draft is loaded.
   *  Builds a synthetic report whose target_ids slug-match real
   *  factors / FVs / tags / biomaterials in the current design,
   *  so the inline severity dots actually appear. The static
   *  fixture's hardcoded numeric ids don't resolve. */
  onSynthesize?: () => void;
}) {
  const copy = KIND_COPY[kind];
  return (
    <div className="card p-3 text-xs text-slate-500 space-y-2">
      <p className="italic">
        {copy.emptyBody} The local server's GET / PATCH
        endpoints are live; the in-UI trigger button (which would
        POST to the agent's <code>/{copy.noun}/{"{accession}"}</code>)
        lands once that service ships.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLoadFixture}
          className="px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] font-medium"
          title={`Load the bundled sample ${copy.noun} so the sidebar layout is testable in-context. Inline dots won't appear — the fixture's target_ids don't match this experiment.`}
        >
          Load fixture {copy.noun} (dev)
        </button>
        {onSynthesize ? (
          <button
            type="button"
            onClick={onSynthesize}
            className="px-2 py-1 rounded bg-violet-100 text-violet-800 hover:bg-violet-200 text-[11px] font-medium"
            title={`Build a synthetic ${copy.noun} whose target_ids match this experiment's actual factors / FVs / tags / first sample, so inline severity dots appear in the design + samples views.`}
          >
            Synthesize from draft (dev)
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — verdict pill + counts + scope + clear
// ---------------------------------------------------------------------------

function SidebarHeader({
  report,
  hasOverride,
  onClearOverride,
}: {
  report: AuditReport;
  /** True when the report being shown is a dev override (synth /
   *  fixture). Surfaces a small "DEV" pill and a "drop override"
   *  affordance so the curator can fall back to live data. */
  hasOverride: boolean;
  /** Provided only when an override is active. */
  onClearOverride?: () => void;
}) {
  const { summary, scope } = report;
  const {
    kind,
    isFinalized,
    finalizedAt,
    finalizedBy,
    finalize,
    reopen,
    finalizeSaving,
    reopenSaving,
    setDisposition,
    dispositionByTarget,
    auditList,
    activeAuditIndex,
    setActiveAuditIndex,
  } = useAudit();
  const copy = KIND_COPY[kind];
  const toast = useToast();
  const [confirmClose, setConfirmClose] = useState(false);

  // Pending findings warning gating: not a hard gate. Curators may
  // close even with pending non-ok findings, but we surface the
  // count so they can pause if the close was accidental. Server
  // accepts either way.
  const pendingActionable = report.findings.filter((f) => {
    if (f.severity === "ok") return false;
    const d = report.dispositions.find((x) => x.target_id === f.target_id);
    return !d || d.status === "pending";
  }).length;

  // Override (synth / fixture) reports have no audit_id on the
  // server, so the close button is a no-op there. Hide it instead
  // of rendering a button that does nothing.
  const lifecycleAvailable = !hasOverride && !!report.audit_id;

  async function handleClose(notes: string) {
    try {
      // Sweep pending severity=ok findings to "accepted" before
      // finalize.
      //
      // The agent's storage layer dropped the `all_dispositioned`
      // clause from the `audit_status` rule on 2026-05-13 (see
      // AUDIT_STATUS_CLOSED_RULE_HANDOFF.md), so on a current agent
      // service this sweep is unnecessary — finalize alone flips the
      // member-list glyph to "closed". Older agent services (pre-
      // 2026-05-13) still require every finding dispositioned for
      // the glyph to read closed, and curators reviewing archived
      // calibration packages may be talking to one. The sweep is
      // harmless on the new agent (a few accepted rows on match
      // findings, which IS the right disposition — curator silence
      // on a "no action needed" row is implicit agreement) and
      // load-bearing on the old one. Drop once the v0.6.0-era agent
      // service is no longer in any deployed corner.
      const pendingOk = report.findings.filter((f) => {
        if (f.severity !== "ok") return false;
        const d = dispositionByTarget.get(f.target_id);
        return (d?.status ?? "pending") === "pending";
      });
      for (const f of pendingOk) {
        try {
          await setDisposition(f.target_id, "accepted");
        } catch {
          // Best-effort — don't block the close on a single sweep
          // failure. The audit still closes; one glyph might miss.
        }
      }
      await finalize(notes || undefined);
      toast.show(copy.closedToast, "success");
      setConfirmClose(false);
    } catch (err) {
      toast.show(
        `Couldn't close ${copy.noun}: ${(err as Error).message}`,
        "danger",
        6000,
      );
    }
  }

  async function handleReopen() {
    try {
      await reopen();
      toast.show(copy.reopenedToast, "success");
    } catch (err) {
      toast.show(
        `Couldn't reopen ${copy.noun}: ${(err as Error).message}`,
        "danger",
        6000,
      );
    }
  }

  // Only show non-zero severity counts — all-zero rows add no signal.
  const nonZeroCounts: { label: string; count: number; severity: Severity }[] = [
    { label: "blocker", count: summary.n_blocker, severity: "blocker" as Severity },
    { label: "major",   count: summary.n_major,   severity: "major"   as Severity },
    { label: "minor",   count: summary.n_minor,   severity: "minor"   as Severity },
    { label: "ok",      count: summary.n_ok,       severity: "ok"      as Severity },
  ].filter((x) => x.count > 0);

  const scopeText = scope.include.join(" / ") || "all";

  return (
    <div className="text-[11px]">
      {/* Single compact row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Dev / closed badges */}
        {hasOverride ? (
          <span
            className="text-[9px] uppercase font-bold px-1 py-0 rounded bg-violet-200 text-violet-900"
            title="dev override — not the live audit"
          >dev</span>
        ) : null}
        {isFinalized ? (
          <span
            className="text-[9px] uppercase font-bold px-1 py-0 rounded bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
            title={`closed${finalizedBy ? ` by ${finalizedBy}` : ""}${finalizedAt ? ` · ${formatShort(finalizedAt)}` : ""}`}
          >closed</span>
        ) : null}
        {/* Auditor identity — prominent enough that a curator
         *  switching between two audits (e.g. dual-agent
         *  hybrid-vs-oneshot review, HANDOFF_2026-05-17_DUAL_AGENT_REVIEW;
         *  or inter-curator-audit packages where the same experiment
         *  appears in both ``X-gold`` and ``Y-gold`` sets) can tell at
         *  a glance which one they're looking at. The palette is
         *  hashed off the auditor's BASE name (version suffixes like
         *  ``-v5b`` / ``-2026-05-17`` stripped) so ``hybrid-v5b`` and
         *  ``hybrid-v6`` get the same pill colour but ``hybrid`` and
         *  ``oneshot`` get distinct ones. For inter-curator packages,
         *  the gold/reviewer pair gives the two siblings distinct
         *  hashes too.
         *
         *  Two render variants on the same field:
         *  - agent identifier (``hybrid-v6``, ``s2j-opus-pipeline``) —
         *    mono, narrow, tag-label "agent".
         *  - prose context (``"inter-curator audit · cyan's curation
         *    applied · amanda reviews"``) — sans, full-width,
         *    tag-label "review". The agents-side builder writes prose
         *    here for inter-curator audits since "model" stops being
         *    the load-bearing identity for that surface. */}
        {report.model ? (() => {
          const palette = agentPalette(report.model);
          const isProse = isProseModel(report.model);
          return (
            <span
              className={cn(
                "inline-flex items-baseline gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border",
                isProse ? null : "font-mono",
                palette,
              )}
              title={`${isProse ? "audit context" : "AI agent that produced this audit"}: ${report.model}${report.audited_at ? ` · ${formatShort(report.audited_at)}` : ""}`}
            >
              <span className="text-[9px] uppercase tracking-wide opacity-70">
                {isProse ? "review" : "agent"}
              </span>
              <span className={isProse ? "" : "truncate max-w-[14rem]"}>
                {report.model}
              </span>
            </span>
          );
        })() : null}
        {/* Audit switcher — appears only when the experiment has more
         *  than one audit (dual-agent review path). Lets the curator
         *  flip between e.g. hybrid and oneshot calibration packages
         *  without leaving the experiment view. */}
        {auditList.length > 1 ? (
          <span
            className="inline-flex items-baseline gap-0.5 text-[10px]"
            title={`audit ${activeAuditIndex + 1} of ${auditList.length} — ◂ / ▸ to switch`}
          >
            <button
              type="button"
              onClick={() =>
                setActiveAuditIndex(
                  (activeAuditIndex - 1 + auditList.length) % auditList.length,
                )
              }
              className="px-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
              aria-label="previous audit"
            >
              ◂
            </button>
            <span className="tabular-nums text-slate-500 dark:text-slate-400 px-0.5">
              {activeAuditIndex + 1}/{auditList.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveAuditIndex((activeAuditIndex + 1) % auditList.length)
              }
              className="px-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
              aria-label="next audit"
            >
              ▸
            </button>
          </span>
        ) : null}
        {/* Date — sits adjacent so the (auditor, date) pair reads as
         *  one identity stamp. */}
        <span
          className="text-[11px] text-slate-500 dark:text-slate-400"
          title={report.audited_at ?? ""}
        >
          {report.audited_at ? formatShort(report.audited_at) : "—"}
        </span>
        {/* Scope */}
        <span className="text-slate-400 dark:text-slate-500">
          · scope: <span className="font-mono text-slate-500 dark:text-slate-400">{scopeText}</span>
        </span>
        {/* Non-zero severity counts inline */}
        {nonZeroCounts.length > 0 ? (
          <span className="text-slate-400">·</span>
        ) : null}
        {nonZeroCounts.map(({ label, count, severity }) => (
          <SeverityCount key={label} label={label} count={count} severity={severity} />
        ))}
        {/* Verdict pill — calibration uses accuracy scoring, not urgency.
            Greys out once the curator has triaged every actionable
            finding (pendingActionable === 0) or the audit is closed.
            The original verdict stays legible in the tooltip + label
            but loses the loud amber / rose tint, since the verdict is
            no longer the load-bearing signal. */}
        {!report.model?.startsWith("calibration") && nonZeroCounts.length > 0 ? (
          <VerdictPill
            verdict={summary.overall_verdict}
            muted={isFinalized || pendingActionable === 0}
          />
        ) : null}
        {/* Drop-override link */}
        {onClearOverride ? (
          <button
            type="button"
            onClick={onClearOverride}
            className="text-[10px] text-slate-400 hover:text-rose-700 hover:underline underline-offset-2 ml-1"
            title="drop dev override, fall back to live audit"
          >drop</button>
        ) : null}
        {/* Triage status + lifecycle button — right-aligned. The
            ready-state is now expressed by the button itself (green
            "Clear" when every actionable finding has a disposition,
            blue "Close audit" otherwise). The separate "✓ ready to
            close" text indicator was redundant once the button changes
            colour, so it's gone. */}
        <span className="ml-auto flex items-center gap-1.5">
          {!isFinalized && lifecycleAvailable && pendingActionable > 0 ? (
            <span
              className="text-[10px] text-amber-600 dark:text-amber-400"
              title="some actionable findings have no disposition yet"
            >
              {pendingActionable} pending
            </span>
          ) : null}
          {isFinalized && finalizedBy ? (
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              by <span className="font-mono">{finalizedBy}</span>
            </span>
          ) : null}
          {lifecycleAvailable ? (
            isFinalized ? (
              <button
                type="button"
                onClick={handleReopen}
                disabled={reopenSaving}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  reopenSaving
                    ? "bg-slate-200 text-slate-500 cursor-progress"
                    : "bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
                )}
              >
                {reopenSaving ? "reopening…" : "Reopen"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClose(true)}
                disabled={finalizeSaving}
                title={
                  pendingActionable > 0
                    ? `close ${copy.noun} (pending findings recorded as undecided)`
                    : `every actionable finding has a disposition — clear this ${copy.noun}`
                }
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded font-medium",
                  finalizeSaving
                    ? pendingActionable === 0
                      ? "bg-emerald-200 text-emerald-800 cursor-progress"
                      : "bg-blue-200 text-blue-700 cursor-progress"
                    : pendingActionable === 0
                      ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                      : "bg-blue-700 text-white hover:bg-blue-800",
                )}
              >
                {finalizeSaving
                  ? pendingActionable === 0
                    ? "clearing…"
                    : "closing…"
                  : pendingActionable === 0
                    ? "✓ Clear"
                    : copy.closeButtonLabel}
              </button>
            )
          ) : null}
        </span>
      </div>
      {/* Closed-audit note strip: surface the curator's finalize
          note + the path to edit it. The actual edit flow is
          Reopen (button above) → Close-audit (with the textarea
          pre-filled). `finalized_notes` is optional on the report;
          degrades gracefully when an older agent service hasn't
          echoed it back on the read shape. */}
      {isFinalized && report.finalized_notes ? (
        <div className="mt-1 pl-1.5 flex items-start gap-1.5 text-[10px]">
          <span
            className="flex-1 italic text-slate-600 dark:text-slate-300 whitespace-pre-wrap"
            title={report.finalized_notes}
          >
            <span className="not-italic text-slate-400 mr-1">📝</span>
            {report.finalized_notes}
          </span>
          {lifecycleAvailable ? (
            <span
              className="text-slate-400 dark:text-slate-500 italic"
              title="Reopen above to edit this note"
            >
              reopen to edit
            </span>
          ) : null}
        </div>
      ) : null}
      {confirmClose ? (
        <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700">
          <CloseAuditConfirm
            kind={kind}
            pendingActionable={pendingActionable}
            saving={finalizeSaving}
            initialNotes={report.finalized_notes ?? ""}
            onCancel={() => setConfirmClose(false)}
            onConfirm={handleClose}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Inline confirm popover for "Close audit". Optional notes go to
 *  the audit_events row server-side. Keeps the affordance compact —
 *  the audit lifecycle isn't destructive (Reopen restores it), so a
 *  full ConfirmModal would over-weight the action. */
function CloseAuditConfirm({
  kind,
  pendingActionable,
  saving,
  initialNotes = "",
  onCancel,
  onConfirm,
}: {
  kind: CurationReviewKind;
  pendingActionable: number;
  saving: boolean;
  /** Pre-fill the textarea with the prior close note when the
   *  curator reopens an already-closed audit to re-close it.
   *  Empty for a brand-new close. */
  initialNotes?: string;
  onCancel: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
}) {
  const copy = KIND_COPY[kind];
  const [notes, setNotes] = useState(initialNotes);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (saving) return;
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onCancel();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel, saving]);
  return (
    <div
      ref={ref}
      className="border border-slate-300 rounded bg-white p-2 space-y-2 mt-1"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] text-slate-700">
        {copy.closeConfirmHeader}{" "}
        {pendingActionable > 0 ? (
          <span className="text-amber-800">
            {pendingActionable} actionable finding
            {pendingActionable === 1 ? "" : "s"} still pending — they'll
            be recorded as undecided in the disposition log.
          </span>
        ) : (
          <span className="text-slate-500">
            All actionable findings have a disposition.
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="optional close note"
        className="w-full text-[11px] border border-slate-300 rounded px-1.5 py-1 resize-y"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[11px] px-2 py-0.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(notes.trim())}
          disabled={saving}
          className={cn(
            "text-[11px] px-2 py-0.5 rounded font-medium",
            saving
              ? "bg-blue-200 text-blue-700 cursor-progress"
              : "bg-blue-700 text-white hover:bg-blue-800",
          )}
        >
          {saving ? "closing…" : copy.closeButtonLabel}
        </button>
      </div>
    </div>
  );
}

function VerdictPill({
  verdict,
  muted = false,
}: {
  verdict: AuditReport["summary"]["overall_verdict"];
  /** Grey out the pill (slate) — used once the curator has triaged
   *  every actionable finding or the audit is closed, so the loud
   *  MAJOR / BLOCKERS tint stops competing for the eye. */
  muted?: boolean;
}) {
  // Live tints, dialled down one notch from the previous shouty
  // amber-900/rose-900 set. The verdict is a first-impression heuristic
  // (and major/blockers labels are sometimes over-stated by the
  // agent), so the pill shouldn't read as a load-bearing alarm —
  // findings below are the load-bearing surface.
  const liveCls = {
    clean: "bg-emerald-50 text-emerald-700 border-emerald-200",
    minor_issues: "bg-slate-50 text-slate-600 border-slate-200",
    major_issues: "bg-amber-50 text-amber-700 border-amber-200",
    blockers: "bg-rose-50 text-rose-700 border-rose-200",
  }[verdict];
  const cls = muted
    ? "bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600"
    : liveCls;
  const label = {
    clean: "clean",
    minor_issues: "minor",
    major_issues: "major",
    blockers: "blockers",
  }[verdict];
  return (
    <span
      className={cn(
        "inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border",
        cls,
      )}
      title={
        muted
          ? `overall verdict: ${verdict} — triaged, no longer load-bearing`
          : `overall verdict: ${verdict}`
      }
    >
      {label}
    </span>
  );
}

function SeverityCount({
  label,
  count,
  severity,
}: {
  label: string;
  count: number;
  severity: Severity;
}) {
  if (count === 0) {
    return <span className="text-[10px] text-slate-400">0 {label}</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 text-[10px]",
        severityTextCls(severity),
      )}
    >
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Findings list
// ---------------------------------------------------------------------------

const TARGET_KIND_ORDER: AuditTargetKind[] = [
  "experiment",
  "factor",
  "fv",
  "tag",
  "assignment",
  "statement",
];

const TARGET_KIND_LABEL: Record<AuditTargetKind, string> = {
  experiment: "Experiment",
  factor: "Factor",
  fv: "FV",
  tag: "Tag",
  assignment: "Assignment",
  statement: "Statement",
};

/** Short action-flavored label for a finding's outer header, used
 *  when the new per-element editor renders below (the editor's
 *  title row already carries the entity identity, so the outer
 *  header just needs to say what kind of action is being proposed).
 *  Examples:
 *    - calibration_factor_extra        → "Proposed factor"
 *    - calibration_factor_gold_only_miss → "Proposed factor removal"
 *    - calibration_factor_match_near   → "Factor near-match"
 *    - calibration_agent_extra         → "Proposed tag"
 *    - calibration_gold_only_miss      → "Proposed tag removal"
 *    - generic factor / tag findings   → "Factor" / "Tag" */
function findingActionLabel(finding: AuditFinding): string {
  // Declarative verbs ("Add tag" / "Remove factor" / etc.)
  // instead of the older "Proposed ..." nouns. Per Paul
  // 2026-05-21: the agent's recommendation reads more cleanly
  // when the action is stated directly. The leading glyph
  // (rendered by the caller) carries the +/− / Δ semantics.
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
    // distinct factors — the older verbs ("Split factor into
    // two" / "Combine two factors") implied the latter and were
    // misleading. The mapping table below the header carries the
    // direction signal. Per Paul 2026-05-21.
    return "Modify factor values";
  }
  if (code === "calibration_match") return "Tag match";
  return TARGET_KIND_LABEL[finding.target_kind] || finding.target_kind;
}

/** Leading glyph for the finding's action label. Visually keys
 *  the row to the kind of change being proposed without needing
 *  to read the verb:
 *    + add (factor / tag)
 *    − remove (factor / tag)
 *    Δ modify partition (split / combine)
 *    no glyph for matches (the OK / NEAR badge carries status). */
function findingActionGlyph(finding: AuditFinding): string | null {
  const code = finding.issue_code;
  if (code === "calibration_factor_extra") return "+";
  if (code === "calibration_agent_extra") return "+";
  if (code === "calibration_factor_gold_only_miss") return "−";
  if (code === "calibration_gold_only_miss") return "−";
  if (code === "calibration_factor_partition_mismatch") return "Δ";
  return null;
}

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
 *  - First backticked token in the rationale: the agent's
 *    convention for naming the load-bearing factor / tag.
 *
 *  For factor-extras the agent's proposed FVs are appended as a
 *  short fingerprint so multi-factor-same-category designs
 *  (e.g. two `genotype` factors) read as visually distinct
 *  even when collapsed. */
function findingSubjectLabel(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): string | null {
  if (finding.partition_mismatch) {
    // Header subject is just the category label — no FV umbrella
    // suffix. Per Paul 2026-05-21: the per-FV labels showing up
    // as the header subject ("disease: ICU-acquired weakness")
    // were misread as the ontology term's canonical label, and
    // for partition_mismatch the curator's question is "which
    // factor", not "which level". The mapping table below carries
    // the per-level detail.
    const pm = finding.partition_mismatch;
    const category =
      pm.gold.category.label || pm.agent.category.label || "";
    return category || null;
  }
  const code = finding.issue_code;
  const backtick = firstBacktick(finding.rationale);

  // Build the non-baseline label list from any factor's FVs.
  // Baselines (FactorValue.is_baseline) are excluded per Paul:
  // "reference substance role" and its peers don't describe the
  // factor, they describe the baseline of the factor. The
  // formatLevels caller decides how to render the +/- shorthand.
  const nonBaselineLabels = (
    factor: {
      factor_values?: Array<{ free_text_label?: string; is_baseline?: boolean }>;
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
    // Match-side findings already pair an agent factor; same
    // shape so multi-factor-same-category designs read as
    // distinct without bouncing tabs.
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
 *  - 2+ non-baseline → `<category>: <a> / <b>[ / …]` with an
 *    optional `+/-` suffix when there's also a baseline.
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

const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
};

/** Re-arrange findings so each absorbed `_gold_only_miss`
 *  (carrying ``consequent_of`` pointing at an upstream
 *  ``_partition_mismatch``) is slotted immediately after its
 *  upstream parent in the list. Preserves the input order for
 *  every other finding. Findings whose linked half isn't in the
 *  passed list stay where the input put them — the cross-link
 *  badges still surface the relationship, just without
 *  spatial pairing.
 *
 *  Per Paul 2026-05-20: cards that read as one curator decision
 *  ("agent's split absorbs gold's timepoint factor") should sit
 *  next to each other, not separated by unrelated findings. */
function reorderConsequentPairs(items: AuditFinding[]): AuditFinding[] {
  if (items.length < 2) return items;
  // Map each upstream finding's target_id → list of absorbed
  // children present in this group. One upstream can absorb
  // multiple downstreams (rare today, but the schema allows it).
  const childrenByUpstream = new Map<string, AuditFinding[]>();
  const absorbedIds = new Set<string>();
  for (const f of items) {
    if (!f.consequent_of) continue;
    if (!items.some((p) => p.target_id === f.consequent_of)) continue;
    const list = childrenByUpstream.get(f.consequent_of) ?? [];
    list.push(f);
    childrenByUpstream.set(f.consequent_of, list);
    absorbedIds.add(f.target_id);
  }
  if (absorbedIds.size === 0) return items;
  const out: AuditFinding[] = [];
  for (const f of items) {
    if (absorbedIds.has(f.target_id)) continue;
    out.push(f);
    const children = childrenByUpstream.get(f.target_id);
    if (children) out.push(...children);
  }
  return out;
}

/** Compact one-line summary of a closed audit's findings. Default
 *  collapsed; click to expand into the full FindingList (read-only,
 *  since FindingActionRow already detects isFinalized).
 *
 *  Counts are derived from the report; "actionable" excludes ok
 *  findings to match the same definition the SidebarHeader uses
 *  for the pre-close pending warning. */
function ClosedFindingsSummary({
  findings,
}: {
  findings: AuditFinding[];
}) {
  const [open, setOpen] = useState(false);
  let nBlocker = 0;
  let nMajor = 0;
  let nMinor = 0;
  let nOk = 0;
  for (const f of findings) {
    if (f.severity === "blocker") nBlocker++;
    else if (f.severity === "major") nMajor++;
    else if (f.severity === "minor") nMinor++;
    else if (f.severity === "ok") nOk++;
  }
  const actionable = nBlocker + nMajor + nMinor;
  return (
    <div className="card text-[11px] text-slate-600">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-center gap-2"
        title={open ? "collapse" : "expand to review individual findings"}
      >
        <span
          aria-hidden
          className="text-slate-400 text-base leading-none"
        >
          {open ? "▾" : "▸"}
        </span>
        <span className="flex-1">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {actionable > 0 ? (
            <>
              {" "}— {nBlocker > 0 ? `${nBlocker} blocker, ` : ""}
              {nMajor > 0 ? `${nMajor} major, ` : ""}
              {nMinor > 0 ? `${nMinor} minor, ` : ""}
              <span className="text-emerald-700">{nOk} ok</span>
            </>
          ) : (
            <> · all <span className="text-emerald-700">ok</span></>
          )}
        </span>
        <span className="text-[10px] text-slate-400 italic">
          {open ? "hide" : "review"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 p-2">
          <FindingList findings={findings} />
        </div>
      ) : null}
    </div>
  );
}

/** Returns the FV-kind children of `parentFinding` (same factor
 *  slug) that the suppression rule treats as subsumed (no more
 *  severe than the parent). Mirrors FindingList's
 *  isSubsumedByParentFactor predicate so visual hide and the
 *  disposition cascade stay in lockstep. Returns [] for non-factor
 *  parents and for findings whose target_id doesn't parse. */
function subsumedFvChildren(
  parentFinding: AuditFinding,
  allFindings: AuditFinding[],
): AuditFinding[] {
  if (parentFinding.target_kind !== "factor") return [];
  const p = parseTargetId(parentFinding.target_id);
  if (p?.kind !== "factor") return [];
  const parentRank = SEVERITY_RANK[parentFinding.severity];
  const out: AuditFinding[] = [];
  for (const f of allFindings) {
    if (f.target_kind !== "fv") continue;
    const c = parseTargetId(f.target_id);
    if (c?.kind !== "fv") continue;
    if (c.factorSlug !== p.factorSlug) continue;
    if (SEVERITY_RANK[f.severity] < parentRank) continue;
    out.push(f);
  }
  return out;
}


function FindingList({ findings }: { findings: AuditFinding[] }) {
  // Single flat list, sorted by severity then target_kind. The full
  // report view groups by target_kind (it has the room); in the
  // narrow sidebar a single severity-sorted list scans faster — most
  // urgent first, regardless of what they're about. Curator's
  // attention should land on blockers immediately.
  const sorted = useMemo(() => {
    const arr = [...findings];
    arr.sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return (
        TARGET_KIND_ORDER.indexOf(a.target_kind) -
        TARGET_KIND_ORDER.indexOf(b.target_kind)
      );
    });
    return arr;
  }, [findings]);

  // FV-finding suppression. When the audit reports a non-ok finding
  // at the parent factor (forbidden_efc, vague_fv_labels, conflated,
  // wrong_fv_partition, etc.) the per-FV findings under that factor
  // typically just elaborate the same problem and clutter the
  // sidebar. Hide them by default and surface a single
  // "show N FV-level findings under flagged factors" toggle so a
  // curator who wants the per-FV detail can opt in.
  //
  // **Severity-aware:** an FV finding more severe than its parent
  // factor's worst finding still surfaces — a blocker on an FV
  // shouldn't disappear because the factor only has a minor flag.
  // The lower-level concern is graver and the curator needs to act
  // on it independently.
  //
  // We key on the factor slug — both factor and fv target_ids carry
  // it (factor:<slug>, fv:<slug>/<fv-slug>) and the slug rule mirrors
  // the agent side exactly via parseTargetId, so this stays in sync
  // with whatever flagged-factor / FV pair the judge emits.
  const suppression = useMemo(() => {
    // factorSlug → minRank (lower number = more severe; from
    // SEVERITY_RANK). Tracks the WORST severity among non-ok
    // findings on each factor.
    const factorWorstRank = new Map<string, number>();
    for (const f of sorted) {
      if (f.target_kind !== "factor" || f.severity === "ok") continue;
      const p = parseTargetId(f.target_id);
      if (p?.kind !== "factor") continue;
      const cur = factorWorstRank.get(p.factorSlug);
      const r = SEVERITY_RANK[f.severity];
      if (cur === undefined || r < cur) factorWorstRank.set(p.factorSlug, r);
    }
    return {
      factorWorstRank,
      /** True iff `f` is an FV finding under a flagged factor AND
       *  no more severe than that factor's worst finding (so the
       *  parent legitimately subsumes it). */
      isSubsumedByParentFactor(f: AuditFinding): boolean {
        if (f.target_kind !== "fv") return false;
        const p = parseTargetId(f.target_id);
        if (p?.kind !== "fv") return false;
        const parentRank = factorWorstRank.get(p.factorSlug);
        if (parentRank === undefined) return false;
        return SEVERITY_RANK[f.severity] >= parentRank;
      },
    };
  }, [sorted]);

  // `severity=ok` doesn't always mean "no curator action" — a
  // calibration_gold_only_miss whose value is BM-covered (already
  // ontologized in a constant BM column) ships as `ok` but is still
  // a real "is this redundant tag still needed?" question. Anything
  // with a mutating apply_action gets promoted to the actionable
  // bucket regardless of severity.
  const isActionable = (f: AuditFinding): boolean => {
    if (isMatchFinding(f)) return false;
    if (isRenameMatch(f)) return false;
    if (f.severity !== "ok") return true;
    const a = resolveApplyAction(f);
    return !!a && a.mutates;
  };
  const actionable = sorted.filter(isActionable);
  // Rename matches render as a diff card in their own section above
  // the other actionable findings — the arbiter judged them as same-
  // factor-different-label, so the curator's job is one focused
  // decision per pair ("which label is right?"), not a scan of two
  // unrelated cards.
  const renames = sorted.filter(isRenameMatch);
  // Match findings (currently calibration_match for tags; factor-side
  // codes coming) render as compact green-check rows, visible by
  // default — same affordance as exact-match factors in the
  // DesignComparisonPanel. Curator can still expand to disagree.
  const matches = sorted.filter(isMatchFinding);
  const okOnes = sorted.filter(
    (f) =>
      f.severity === "ok" && !isMatchFinding(f) && !isActionable(f),
  );
  const visibleActionable = actionable.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const suppressedActionable = actionable.filter((f) =>
    suppression.isSubsumedByParentFactor(f),
  );
  const visibleOk = okOnes.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const suppressedOk = okOnes.filter((f) =>
    suppression.isSubsumedByParentFactor(f),
  );
  const visibleMatches = matches.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );
  const suppressedTotal = suppressedActionable.length + suppressedOk.length;
  const [showOk, setShowOk] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);

  if (findings.length === 0) {
    return null;
  }

  // Group actionable findings by target_kind for visual clustering —
  // factor decisions read as one beat, tag decisions as another. The
  // groups preserve the severity sort within them. Empty groups don't
  // render their header.
  const groupedActionable = new Map<AuditTargetKind, AuditFinding[]>();
  for (const f of visibleActionable) {
    const arr = groupedActionable.get(f.target_kind) ?? [];
    arr.push(f);
    groupedActionable.set(f.target_kind, arr);
  }
  // Within each group, slot each absorbed `_gold_only_miss`
  // immediately after its upstream `_partition_mismatch` so the
  // "implies removal of X" link and the "← absorbed by Y split"
  // link read as one beat instead of two scattered cards.
  // Findings whose linked half isn't in the same group stay where
  // the original sort put them.
  for (const [kind, items] of groupedActionable) {
    groupedActionable.set(kind, reorderConsequentPairs(items));
  }
  // One source of truth for both render order and section headers —
  // adding a new AuditTargetKind only touches this list.
  const GROUPS: { kind: AuditTargetKind; header: string }[] = [
    { kind: "factor",     header: "Design — factors" },
    { kind: "fv",         header: "Design — factor values" },
    { kind: "tag",        header: "Tags" },
    { kind: "assignment", header: "Sample assignments" },
    { kind: "statement",  header: "Statements" },
    { kind: "experiment", header: "Experiment" },
  ];

  const visibleRenames = renames.filter(
    (f) => !suppression.isSubsumedByParentFactor(f),
  );

  return (
    <div className="space-y-3">
      {visibleRenames.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
            Alternate factor — proposed a different categorization
          </div>
          {visibleRenames.map((f) => (
            <CompactFindingCard
              key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
              finding={f}
            />
          ))}
        </div>
      ) : null}
      {GROUPS.map(({ kind, header }) => {
        const items = groupedActionable.get(kind) ?? [];
        const matchesForKind = visibleMatches.filter(
          (m) => m.target_kind === kind,
        );
        if (items.length === 0 && matchesForKind.length === 0) return null;
        return (
          <div key={kind} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
              {header}
            </div>
            {items.map((f) => (
              <CompactFindingCard
                key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                finding={f}
              />
            ))}
            {/* Match findings for this target_kind render INSIDE
                the kind's group (tail position), so tag matches
                live under TAGS, factor matches under DESIGN —
                FACTORS, etc. Same CompactFindingCard template as
                actionable findings — the badge picker handles
                ≈/✓ visual difference. Per Paul 2026-05-21. */}
            {matchesForKind.map((f) => (
              <CompactFindingCard
                key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                finding={f}
              />
            ))}
          </div>
        );
      })}
      {/* Any match findings whose target_kind isn't in GROUPS fall
          through to a residual list — defensive guard for future
          kinds we don't have a section for yet. */}
      {(() => {
        const knownKinds = new Set(GROUPS.map((g) => g.kind));
        const orphan = visibleMatches.filter(
          (m) => !knownKinds.has(m.target_kind),
        );
        if (orphan.length === 0) return null;
        return (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 px-1">
              Confirmed matches
            </div>
            {orphan.map((f) => (
              <CompactFindingCard
                key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                finding={f}
              />
            ))}
          </div>
        );
      })()}
      {suppressedTotal > 0 ? (
        <>
          <button
            type="button"
            className="w-full text-left text-[11px] px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => setShowSuppressed((v) => !v)}
            title="hidden because the parent factor already has a non-ok finding — those typically subsume per-FV concerns"
          >
            {showSuppressed
              ? `▾ hide ${suppressedTotal} FV-level finding${suppressedTotal === 1 ? "" : "s"} under flagged factors`
              : `▸ show ${suppressedTotal} FV-level finding${suppressedTotal === 1 ? "" : "s"} under flagged factors`}
          </button>
          {showSuppressed
            ? suppressedActionable.map((f) => (
                <CompactFindingCard
                  key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                  finding={f}
                />
              ))
            : null}
        </>
      ) : null}
      {visibleOk.length > 0 ? (
        <button
          type="button"
          className="w-full text-left text-[11px] px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded"
          onClick={() => setShowOk((v) => !v)}
        >
          {showOk
            ? `▾ hide ${visibleOk.length} ok check${visibleOk.length === 1 ? "" : "s"}`
            : `▸ show ${visibleOk.length} ok check${visibleOk.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {showOk
        ? visibleOk.map((f) => (
            <CompactFindingCard
              key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
              finding={f}
            />
          ))
        : null}
      {showSuppressed && suppressedOk.length > 0
        ? suppressedOk.map((f) => (
            <CompactFindingCard
              key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
              finding={f}
            />
          ))
        : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact finding card — collapsed by default
// ---------------------------------------------------------------------------

/** Match findings (curator agrees with the agent, no action needed)
 *  render as a different shape from the standard finding card —
 *  compact green-check rows, same look as the exact-match factor
 *  rows in DesignComparisonPanel.
 *
 *  Sibling predicate: `tagsForPanel` in `AuditReportView.tsx`
 *  (DesignComparisonPanel) suppresses tag panel entries that
 *  duplicate a tag finding. That one keys on the `<category>:
 *  <value>` backticked pair extracted from the rationale (covers
 *  all calibration target_id shapes); this one keys on the
 *  `issue_code` suffix. Both are downstream of "is this a
 *  curator-agrees-with-agent match" but evaluate against
 *  different signals — if my brother ever emits a match-shaped
 *  finding without the canonical issue_code suffix, the two will
 *  disagree. Extract a shared `isMatchFinding` + `findingTagKey`
 *  pair if that becomes real. */
function isMatchFinding(f: AuditFinding): boolean {
  // Tag-side: ``calibration_match`` (severity ok). Factor-side: the
  // 2026-05-18 split (agents-repo ``f313770``) emits
  // ``calibration_factor_match_exact`` (ok) and
  // ``calibration_factor_match_close`` (minor). Older builds emit a
  // single ``calibration_factor_match`` at severity ok for both
  // cases. We treat ALL of these as match findings — the
  // green-check row renders the curator-skippable cases (exact / ok
  // legacy) and surfaces close matches with a minor-severity chip so
  // the curator gets the "peek to confirm" cue without losing the
  // compact match-row affordance.
  if (f.issue_code === "calibration_match") return f.severity === "ok";
  const v = factorMatchVariant(f.issue_code);
  if (v === "exact") return true;
  if (v === "near") return true;
  if (v === "legacy") {
    // Legacy ``calibration_factor_match``: severity=ok is a match;
    // severity!=ok is a category rename and goes through
    // ``RenameFindingCard`` instead — see ``isRenameMatch``.
    return f.severity === "ok";
  }
  // Forward-compat: any other severity=ok issue whose code ends in
  // ``_match`` is a match too.
  if (f.severity !== "ok") return false;
  return /(^|_)match$/.test(f.issue_code);
}

/** A factor-match finding with non-ok severity is the arbiter's way of
 *  flagging a **category rename** — same factor, different label
 *  (the only path to a non-ok ``calibration_factor_match`` per the v4
 *  arbiter wire, HANDOFF_2026-05-16_DEFENDER_ARBITER.md). Pulled out
 *  of the actionable bucket and rendered as a diff card instead of a
 *  generic finding card so the curator sees agent ≈ Gemma at a glance
 *  rather than having to read the rationale prose.
 *
 *  Only matches the legacy ``calibration_factor_match`` code: the
 *  post-2026-05-18 split moved close matches to their own ``_close``
 *  code (which goes through the match-row path with a minor chip)
 *  and gave renames their own dedicated ``calibration_factor_rename``
 *  code — that one isn't classified here because it doesn't share
 *  the ``factor_match`` family. */
function isRenameMatch(f: AuditFinding): boolean {
  return (
    f.issue_code === "calibration_factor_match" && f.severity !== "ok"
  );
}

/** Pulls the agent + Gemma category labels out of the rename
 *  rationale. The arbiter emits a stable prose template:
 *
 *    "Category rename: agent proposes `<agent>` where Gemma has
 *     `<gold>` (matched via …). Which label is right? …"
 *
 *  Returns ``null`` if the rationale doesn't match — the caller
 *  falls back to the standard finding card so we never render a
 *  half-built diff. */
function parseRenameLabels(
  rationale: string,
): { agent: string; gold: string } | null {
  const m = rationale.match(
    /agent proposes `([^`]+)`\s+where Gemma has `([^`]+)`/i,
  );
  if (!m) return null;
  return { agent: m[1], gold: m[2] };
}

/** Tiny inline status glyph for the per-FV correspondence indicators
 *  rendered next to each agent FV inside RenameFactorEmbed (near
 *  matches only). Four states:
 *    - ✓ emerald — labels match (or proposer flagged match_type=exact)
 *    - ≈ amber   — paired by URI / synonym, labels drifted
 *    - + amber   — agent FV with no Gemma counterpart
 *    - − amber   — Gemma FV the agent didn't propose
 *  Width fixed at 1ch so the labels left-align across rows. */
function FvStatusGlyph({
  status,
}: {
  status: "exact" | "near" | "agent_only" | "gold_only";
}) {
  const cfg = {
    exact: {
      glyph: "✓",
      cls: "text-emerald-600 dark:text-emerald-400",
      title: "labels match",
    },
    near: {
      glyph: "≈",
      cls: "text-amber-600 dark:text-amber-400",
      title: "paired by URI / synonym — labels differ",
    },
    agent_only: {
      glyph: "+",
      cls: "text-amber-600 dark:text-amber-400",
      title: "agent FV with no Gemma counterpart",
    },
    gold_only: {
      glyph: "−",
      cls: "text-amber-600 dark:text-amber-400",
      title: "Gemma FV the agent didn't propose",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-block w-[1ch] text-center text-xs font-bold leading-none shrink-0",
        cfg.cls,
      )}
      title={cfg.title}
      aria-label={cfg.title}
    >
      {cfg.glyph}
    </span>
  );
}
/** Embedded agent-factor detail for an alternate-factor finding.
 *
 *  Looks up the agent's `FactorProposal` from
 *  `report.evidence.comparison_proposal.factors` by matching the
 *  rename payload's `agent.category.label`, and renders the same
 *  per-FV view the bottom-of-panel DesignComparisonPanel shows for
 *  this factor: each FV's label, sample count, statement glyph, and
 *  the structured statement detail with URIs. This puts the "what is
 *  the agent actually proposing" answer inside the audit card so
 *  curators don't have to scroll to the bottom of the panel to see it.
 *
 *  Falls back to the FV-pair table (label-only) when no
 *  comparison_proposal is available — older audits or experiments
 *  where the agent didn't ship a structured proposal alongside the
 *  rename. */
function RenameFactorEmbed({ finding }: { finding: AuditFinding }) {
  const { report, experimentId } = useAudit();
  const { data: serverDesign } = useDesign(experimentId);
  // Three label-source paths (most specific first):
  //   1. Structured `finding.rename` payload (calibration package v11+).
  //   2. Parsed rename rationale ("agent proposes `X` where Gemma has
  //      `Y`") for v10 alternate-factor findings.
  //   3. First backticked token in the rationale — works for plain
  //      confirmed-match rationales ("Is factor `treatment` correctly
  //      captured?") so this same embed renders the agent's FV /
  //      statement detail inside MatchFindingRow expansions, not just
  //      inside alternate-factor cards.
  const rename = finding.rename ?? null;
  const parsed = parseRenameLabels(finding.rationale || "");
  const firstBacktickLabel = firstBacktick(finding.rationale) ?? undefined;
  const agentLabel = (
    rename?.agent.category.label ??
    parsed?.agent ??
    firstBacktickLabel ??
    ""
  )
    .toLowerCase()
    .trim();
  // For confirmed matches the agent and gold share a label, so the
  // "Gemma calls this:" footer is suppressed (its only job is showing
  // the divergent gold label on alternate-factor cards).
  const goldLabelRaw = rename?.gold.category.label ?? parsed?.gold ?? "";
  const goldLabel =
    goldLabelRaw && goldLabelRaw.toLowerCase().trim() !== agentLabel
      ? goldLabelRaw
      : "";

  const cp = report?.evidence?.comparison_proposal ?? null;
  // Prefer the builder's committed agent → gold pairing
  // (``agent_target_index``, calibration package v12+, agents-repo
  // ``f313770``) so multi-factor-same-category designs don't end up
  // rendering the same agent factor on two cards. Fall back to the
  // label lookup for older audits that pre-date the field — see
  // ``resolveAgentFactor``. Also gives up early when there's neither
  // an index nor a label, which preserves the "render nothing" shape
  // the rest of this function expects.
  const agentFactor =
    finding.agent_target_index != null || agentLabel
      ? resolveAgentFactor(finding, cp, agentLabel)
      : null;
  if (!agentFactor && !agentLabel) return null;

  // No structured factor available — fall back to the bare FV-pair
  // table from the rename payload when present (labels only, no
  // statements). When neither factor proposal nor pair table is
  // available there's nothing structured to render.
  if (!agentFactor) {
    return rename && rename.fv_pairs?.length > 0 ? (
      <FactorRenameFvPairs pairs={rename.fv_pairs} />
    ) : null;
  }

  const fvs = agentFactor.factor_values ?? [];

  // Per-FV correspondence — render whenever we have a factor-kind
  // finding with a resolvable agent factor. Originally gated to
  // match findings only, but with the 2026-05-18 stricter near-match
  // gate (concept-mismatch demotes match → extra + gold_only_miss),
  // curators need the same per-FV ✓ / ≈ / + / − visual on extra and
  // calibration-factor-rename findings too so they can see *what's
  // wrong / right / near* without bouncing tabs.
  //
  // The downstream gold-factor lookup tries biomaterial overlap
  // across every gold factor (not just same-slug candidates) so an
  // agent ``extra`` for a partition-equal-but-URI-divergent factor
  // still surfaces "↔ Gemma <other-label>" if the biomaterials line
  // up.
  const showCorrespondence = finding.target_kind === "factor";
  // Resolve the paired gold factor. Index-first (post-3868a09 wire);
  // slug + biomaterial-overlap fallback for older audits. With
  // ``gold_target_index`` shipping, multi-factor-same-category gold
  // lookups (GSE93824's two ``genotype`` factors) are deterministic
  // from the wire — no UI guessing.
  const goldSlug = (
    rename?.gold.category.label ??
    parsed?.gold ??
    firstBacktickLabel ??
    ""
  )
    .toLowerCase()
    .trim();
  let goldFactor: import("@/features/experiment/types").Factor | undefined;
  const indexed = resolveGoldFactor(finding, serverDesign?.factors, goldSlug);
  if (indexed) {
    goldFactor = indexed;
  } else {
    const goldCandidates =
      serverDesign?.factors.filter(
        (f) => f.category.label.toLowerCase().trim() === goldSlug,
      ) ?? [];
    goldFactor = pickGoldFactor(agentFactor, goldCandidates);
  }
  // Pair each agent FV to a Gemma FV. Three lookup paths, in order:
  //
  //   1. ``gemma_ref`` on the proposal (proposer pre-computed at
  //      proposal time — most precise when it fires).
  //   2. Biomaterial-overlap against ``goldFactor.factor_values``
  //      (partition-equal pairing; works even when the proposer
  //      didn't ship a gemma_ref, e.g. older proposals or cases the
  //      proposer judged "new" but where Gemma actually has a
  //      same-biomaterial FV under a different label).
  //   3. Genuinely unpaired → "agent_only" (rare on factor matches
  //      with a resolved gold factor; common on alternate-factor).
  //
  // The biomaterial-overlap path is the same principle as the
  // NEAR_MATCH_FV_PAIRING handoff for the builder side: if the
  // partition is the same, the pairing is bijective by biomaterial
  // set. Surfacing "total RNA" ↔ "pre-immunoprecipitation input"
  // here (paired by biomaterials despite the label drift) is the
  // canonical case.
  const pairedGoldIds = new Set<number>();
  type FvPairing = {
    status: "exact" | "near" | "agent_only";
    /** Gemma label of the paired FV, when paired. Empty for agent-only. */
    gemmaLabel: string;
  };
  function fvStatus(fv: FactorValueProposal): FvPairing {
    let refLabel = fv.gemma_ref?.label?.trim() || "";
    const refUri = fv.gemma_ref?.uri?.trim() || "";
    let pairedId: number | null = null;
    // Path 1: gemma_ref. Resolve the gold FV id from refLabel/refUri
    // (so pairedGoldIds catches it for the gold-only sweep).
    if ((refLabel || refUri) && goldFactor) {
      const matchByUri = refUri
        ? goldFactor.factor_values.find((gfv) =>
            gfv.statements.some(
              (s) =>
                s.subject?.uri === refUri || s.object?.uri === refUri,
            ),
          )
        : undefined;
      const matchByLabel = !matchByUri && refLabel
        ? goldFactor.factor_values.find(
            (gfv) =>
              (gfv.free_text_label || "").toLowerCase().trim() ===
              refLabel.toLowerCase(),
          )
        : undefined;
      const hit = matchByUri ?? matchByLabel;
      if (hit) pairedId = hit.id;
    }
    // Path 2: biomaterial-overlap fallback when proposal didn't ship
    // a gemma_ref. Pick the gold FV whose biomaterial set overlaps
    // the agent FV's most. Skip gold FVs already claimed by an
    // earlier agent FV (one-to-one pairing).
    if (!refLabel && !refUri && goldFactor) {
      const agentBms = new Set(fv.biomaterial_short_names);
      let bestOverlap = 0;
      let bestGfv: typeof goldFactor.factor_values[number] | null = null;
      for (const gfv of goldFactor.factor_values) {
        if (pairedGoldIds.has(gfv.id)) continue;
        let n = 0;
        for (const bm of gfv.biomaterial_short_names) {
          if (agentBms.has(bm)) n++;
        }
        if (n > bestOverlap) {
          bestOverlap = n;
          bestGfv = gfv;
        }
      }
      if (bestGfv) {
        refLabel = bestGfv.free_text_label || "";
        pairedId = bestGfv.id;
      }
    }
    if (pairedId != null) pairedGoldIds.add(pairedId);
    if (!refLabel && !refUri) {
      return { status: "agent_only", gemmaLabel: "" };
    }
    if (
      fv.match_type === "exact" ||
      (fv.free_text_label || "").toLowerCase().trim() ===
        refLabel.toLowerCase()
    ) {
      return { status: "exact", gemmaLabel: refLabel };
    }
    return { status: "near", gemmaLabel: refLabel };
  }
  // Pre-compute so we can also derive gold-only after the agent loop
  // has populated pairedGoldIds.
  const fvPairings: FvPairing[] = showCorrespondence
    ? fvs.map(fvStatus)
    : [];
  const goldOnly =
    showCorrespondence && goldFactor
      ? goldFactor.factor_values.filter((gfv) => !pairedGoldIds.has(gfv.id))
      : [];

  // Surface the paired gold factor's distinguishing info in the
  // header. ``Factor.name`` is the curator-given name, which often
  // disambiguates multi-factor-same-category cases (e.g.
  // ``wild-type vs KO`` vs ``genotype background``) where the
  // category label alone is identical. Falls back to FV-count when
  // ``name`` is empty or equals the category label.
  const goldDistinguisher = goldFactor
    ? goldFactor.name &&
      goldFactor.name.toLowerCase().trim() !==
        goldFactor.category.label.toLowerCase().trim()
      ? goldFactor.name
      : `${goldFactor.factor_values.length} value${
          goldFactor.factor_values.length === 1 ? "" : "s"
        }`
    : null;

  return (
    <div className="px-2 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex-wrap">
        <span>Agent factor</span>
        <span className="font-mono text-slate-700 dark:text-slate-200 normal-case tracking-normal">
          {agentFactor.category.label}
        </span>
        {agentFactor.factor_type ? (
          <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal">
            · {agentFactor.factor_type}
          </span>
        ) : null}
        {/* Matched-against indicator. Critical for multi-factor-same-
            category cases (two ``genotype`` factors in gold) — without
            it both finding cards read identically. */}
        {goldFactor ? (
          <span
            className="text-slate-400 dark:text-slate-500 normal-case tracking-normal inline-flex items-baseline gap-1"
            title={`paired with Gemma factor (id=${goldFactor.id})${
              finding.gold_target_index != null
                ? " — agent-emitted gold_target_index"
                : " — UI-side disambiguation via biomaterial overlap"
            }`}
          >
            <span>↔</span>
            <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wide text-[9px]">
              Gemma
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-200">
              {goldFactor.category.label}
            </span>
            {goldDistinguisher ? (
              <span className="text-slate-400 dark:text-slate-500 italic">
                ({goldDistinguisher})
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="text-slate-400 dark:text-slate-500 ml-auto normal-case tracking-normal">
          {fvs.length} {fvs.length === 1 ? "value" : "values"}
        </span>
      </div>
      <div className="space-y-1 pl-1">
        {fvs.map((fv, i) => {
          const pairing = showCorrespondence ? fvPairings[i] : null;
          const status = pairing?.status ?? null;
          const gemmaLabel = pairing?.gemmaLabel ?? "";
          return (
            <FvDisplayRow
              key={i}
              fv={fv}
              termRenderer={curationTermRenderer}
              indexLabel={i + 1}
              leading={
                status ? <FvStatusGlyph status={status} /> : null
              }
              trailing={
                <>
                  {status === "near" && gemmaLabel ? (
                    <span
                      className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                      title="Gemma's label for the paired FV"
                    >
                      ↔ Gemma:{" "}
                      <span className="font-mono not-italic">
                        {gemmaLabel}
                      </span>
                    </span>
                  ) : null}
                  {status === "agent_only" ? (
                    <span
                      className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                      title="no Gemma counterpart — neither by proposer alignment nor biomaterial overlap"
                    >
                      not in Gemma
                    </span>
                  ) : null}
                </>
              }
            />
          );
        })}
        {/* Gemma-only FVs — the agent didn't propose these. Renders
            below the agent rows as muted italic lines so the curator
            sees what's missing without it competing visually with
            agent content. Only fires on near matches. */}
        {goldOnly.map((gfv, i) => (
          <div
            key={`g${i}`}
            className="text-[11px] flex items-center gap-1 flex-wrap opacity-70"
            title="Gemma FV the agent didn't propose"
          >
            <FvStatusGlyph status="gold_only" />
            <span className="font-mono text-slate-500 dark:text-slate-400 italic truncate">
              {gfv.free_text_label || "(unnamed)"}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              ({gfv.biomaterial_short_names.length})
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              Gemma only
            </span>
          </div>
        ))}
      </div>
      {/* Gold-side reference: small footer line so the curator has
          the comparison without leaving the card. Label comes from
          either the structured rename payload or the parsed rationale,
          whichever is available. */}
      {goldLabel ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-700/70 pt-1">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            Gemma calls this:
          </span>{" "}
          <span className="font-mono text-slate-700 dark:text-slate-200">
            {goldLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// `StatementChip` was the prior inline term chip for the S · P · O
// subrow. Replaced by the shared `<FvDisplayRow>`'s per-statement
// renderer (driven by curationTermRenderer = the rich Term chip).

/** Gold-side factor embed for ``calibration_factor_gold_only_miss``
 *  findings — the agent didn't propose this factor, so the gold side
 *  is primary. Mirrors ``RenameFactorEmbed``'s shape so the visual
 *  rhythm stays consistent across (match, extra, miss) cards.
 *
 *  Looks up the gold factor via target_id slug (with biomaterial-
 *  overlap disambiguation for multi-factor-same-category) and tries
 *  to surface a paired agent factor pointer when biomaterial overlap
 *  hints at one — same heuristic the extra side uses, so a demoted
 *  near-match pair's two cards can be visually correlated by curators
 *  scanning the column. */
function GoldFactorMissEmbed({ finding }: { finding: AuditFinding }) {
  const { report, experimentId } = useAudit();
  const { data: serverDesign } = useDesign(experimentId);
  const cp = report?.evidence?.comparison_proposal ?? null;

  // Pull the gold factor's label from the rationale's first
  // backticked token (same trick the headline uses).
  const goldSlug = (firstBacktick(finding.rationale) ?? "").toLowerCase().trim();
  // Index-first via ``gold_target_index`` (post-3868a09 wire); slug +
  // biomaterial-overlap fallback for older audits without the index.
  const indexed = resolveGoldFactor(finding, serverDesign?.factors, goldSlug);
  let goldFactor: typeof serverDesign extends infer T
    ? T extends { factors: infer F }
      ? F extends Array<infer Item>
        ? Item
        : never
      : never
    : never;
  let pairedAgentFactor: FactorProposal | null = null;
  if (indexed) {
    goldFactor = indexed;
    // Even with gold side resolved, we still need to pair an agent
    // factor by biomaterial overlap for the "↔ agent <label>"
    // header hint (the cross-card correlation pointer). No wire
    // field for agent ↔ gold-only-miss pairing today.
    if (cp?.factors?.length) {
      const gBms = new Set(
        indexed.factor_values.flatMap((fv) => fv.biomaterial_short_names),
      );
      let bestOverlap = 0;
      for (const a of cp.factors) {
        const aBms = new Set(
          a.factor_values.flatMap((fv) => fv.biomaterial_short_names),
        );
        let overlap = 0;
        for (const bm of aBms) if (gBms.has(bm)) overlap++;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          pairedAgentFactor = a;
        }
      }
    }
  } else {
    const goldCandidates =
      serverDesign?.factors.filter(
        (f) => f.category.label.toLowerCase().trim() === goldSlug,
      ) ?? [];
    goldFactor = goldCandidates[0];
    if (goldCandidates.length > 0 && cp?.factors?.length) {
      let bestOverlap = -1;
      for (const g of goldCandidates) {
        const gBms = new Set(
          g.factor_values.flatMap((fv) => fv.biomaterial_short_names),
        );
        for (const a of cp.factors) {
          const aBms = new Set(
            a.factor_values.flatMap((fv) => fv.biomaterial_short_names),
          );
          let overlap = 0;
          for (const bm of aBms) if (gBms.has(bm)) overlap++;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            goldFactor = g;
            pairedAgentFactor = bestOverlap > 0 ? a : null;
          }
        }
      }
    }
  }
  if (!goldFactor) return null;

  // Agent FV label lookup for the inline "↔ agent: <label>" hint per
  // gold FV. Built from the paired agent factor's biomaterial sets.
  const agentFvByBiomaterial = new Map<string, string>();
  if (pairedAgentFactor) {
    for (const afv of pairedAgentFactor.factor_values) {
      for (const bm of afv.biomaterial_short_names) {
        agentFvByBiomaterial.set(bm, afv.free_text_label || "");
      }
    }
  }
  function agentLabelForGoldFv(
    gfv: typeof goldFactor.factor_values[number],
  ): string {
    if (!pairedAgentFactor) return "";
    // Pick the most-common agent label across this gold FV's
    // biomaterials. If they all agree, we get a clean pairing.
    const counts = new Map<string, number>();
    for (const bm of gfv.biomaterial_short_names) {
      const lab = agentFvByBiomaterial.get(bm);
      if (!lab) continue;
      counts.set(lab, (counts.get(lab) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [lab, n] of counts) {
      if (n > bestN) {
        best = lab;
        bestN = n;
      }
    }
    return best;
  }

  return (
    <div className="px-2 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex-wrap">
        <span>Gemma factor</span>
        <span className="font-mono text-slate-700 dark:text-slate-200 normal-case tracking-normal">
          {goldFactor.category.label}
        </span>
        {goldFactor.name &&
        goldFactor.name.toLowerCase().trim() !==
          goldFactor.category.label.toLowerCase().trim() ? (
          <span className="text-slate-400 dark:text-slate-500 italic normal-case tracking-normal">
            ({goldFactor.name})
          </span>
        ) : null}
        {pairedAgentFactor ? (
          <span
            className="text-slate-400 dark:text-slate-500 normal-case tracking-normal inline-flex items-baseline gap-1"
            title="biomaterial overlap suggests the agent proposed this same partition under a different category"
          >
            <span>↔</span>
            <span className="text-slate-500 dark:text-slate-400 uppercase tracking-wide text-[9px]">
              agent
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-200">
              {pairedAgentFactor.category.label}
            </span>
          </span>
        ) : null}
        <span className="text-slate-400 dark:text-slate-500 ml-auto normal-case tracking-normal">
          {goldFactor.factor_values.length}{" "}
          {goldFactor.factor_values.length === 1 ? "value" : "values"}
        </span>
      </div>
      <div className="space-y-1 pl-1">
        {goldFactor.factor_values.map((gfv) => {
          const agentLab = agentLabelForGoldFv(gfv);
          const sameLabel =
            agentLab &&
            agentLab.toLowerCase().trim() ===
              (gfv.free_text_label || "").toLowerCase().trim();
          const status: "exact" | "near" | "gold_only" = !agentLab
            ? "gold_only"
            : sameLabel
              ? "exact"
              : "near";
          return (
            <div
              key={gfv.id}
              className="text-[11px] flex items-center gap-1 flex-wrap"
            >
              <FvStatusGlyph status={status} />
              <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
                {gfv.free_text_label || "(unnamed)"}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                ({gfv.biomaterial_short_names.length})
              </span>
              {status === "near" ? (
                <span
                  className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                  title="agent put these biomaterials under a different label"
                >
                  ↔ agent: <span className="font-mono not-italic">{agentLab}</span>
                </span>
              ) : null}
              {status === "gold_only" ? (
                <span
                  className="text-[10px] text-amber-700 dark:text-amber-300 italic"
                  title="agent didn't claim this partition under any factor"
                >
                  not in agent proposal
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact FV-pairs table for an alternate-factor finding without a
 *  structured comparison_proposal. Fallback view; the richer
 *  `RenameFactorEmbed` is preferred when the agent's factor proposal
 *  is available. Renders one row per (agent FV, gold FV) pair from
 *  the arbiter's `FactorRenamePayload`. */
function FactorRenameFvPairs({ pairs }: { pairs: import("@/api/auditTypes").FvPair[] }) {
  if (!pairs || pairs.length === 0) return null;
  return (
    <div className="px-1 py-1.5 rounded bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 space-y-0.5">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">
        <span>agent FVs</span>
        <span>&nbsp;</span>
        <span>Gemma FVs</span>
      </div>
      {pairs.map((p, i) => {
        const marker =
          p.equivalence === "exact"
            ? { ch: "=", title: "exact: same URI or identical label" }
            : p.equivalence === "synonym"
              ? { ch: "~", title: "synonym: different label, arbiter judged equivalent" }
              : { ch: "?", title: "judgment: same partition position only (no semantic match)" };
        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center text-[11px] px-1"
          >
            <span
              className="font-mono text-slate-900 dark:text-slate-100 truncate"
              title={p.agent.label || p.agent.uri || ""}
            >
              {p.agent.label || <em className="text-slate-400">(none)</em>}
            </span>
            <span
              className="text-slate-400 dark:text-slate-500 text-center select-none"
              title={marker.title}
              aria-label={p.equivalence}
            >
              {marker.ch}
            </span>
            <span
              className="font-mono text-slate-900 dark:text-slate-100 truncate"
              title={p.gold.label || p.gold.uri || ""}
            >
              {p.gold.label || <em className="text-slate-400">(none)</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** When a calibration_factor_gold_only_miss surfaces ("remove Gemma's
 *  factor X"), the curator's real decision is "remove X *and* take the
 *  agent's replacement Y." Today the agent's replacement lives in the
 *  DesignComparisonPanel at the bottom of the sidebar, far from the
 *  finding card. Until the agent emits paired `calibration_factor_extra`
 *  findings (filed in FACTOR_CALIBRATION_FINDINGS_HANDOFF.md), surface
 *  the agent-side proposal inline as a one-line companion line so the
 *  pair reads together. Removes itself once paired findings ship —
 *  those will sort adjacently in the finding list and this hint becomes
 *  redundant (the helper renders nothing when no non-exact proposed
 *  factors exist). */
function FactorReplacementHint({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}) {
  if (finding.issue_code !== "calibration_factor_gold_only_miss") return null;
  // When my brother's `calibration_factor_extra` findings are in the
  // report, those *are* the canonical "agent proposes adding X" view —
  // the paired finding sits directly adjacent in the list. Adding a
  // hint here just duplicates it. Suppress.
  //
  // Known limitation: this is a report-wide check, not per-pair. An
  // audit with multiple gold_only_miss findings for unrelated factors
  // where only one has a paired _extra would still suppress the hint
  // on every miss in the report. In practice calibration audits are
  // narrowly scoped (one factor change per audit), so this isn't
  // hitting today. Revisit if multi-factor calibration audits become
  // a regular thing.
  const hasExtra = (report?.findings ?? []).some(
    (f) => f.issue_code === "calibration_factor_extra",
  );
  if (hasExtra) return null;
  const proposed = (report?.evidence?.comparison_proposal?.factors ?? []).filter(
    (f) => f.match_type !== "exact",
  );
  if (proposed.length === 0) return null;
  return (
    <span className="block mt-0.5 text-[11px] text-blue-700 dark:text-blue-400">
      ↪ Proposed adding:{" "}
      {proposed.map((f, i) => (
        <span key={i}>
          {i > 0 ? ", " : ""}
          <span className="font-mono">{f.category.label}</span>
          {f.factor_values?.length
            ? ` (${f.factor_values.length} value${f.factor_values.length === 1 ? "" : "s"})`
            : ""}
        </span>
      ))}
    </span>
  );
}

/** Panel-level expansion baseline for the finding cards. One control
 *  at the top of the sidebar drives every card's body/judgements
 *  visibility at once — cleaner for proposal review (large list,
 *  curator triages by reading bodies linearly) than per-card
 *  chevrons that have to be clicked individually.
 *
 *  Cards still hold their own ``cardOpen`` / ``open`` state so the
 *  legacy per-card chevron + the dot-focus "expand THIS finding"
 *  behaviour still work; an effect re-seeds the card state whenever
 *  the panel-level baseline changes. */
type PanelExpansion = "collapsed" | "expanded" | "fully";
const PanelExpansionContext = createContext<PanelExpansion>("collapsed");

/** Big, obvious 3-way cycle. Glyph reflects the current state;
 *  tooltip names the next state so a click is predictable. Sized
 *  generously — Paul has called out tiny carets twice; the icons
 *  here are deliberately ``text-2xl`` so they stay readable in the
 *  sidebar's busy header strip. */
function PanelExpansionCycleButton({
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

function CompactFindingCard({ finding }: { finding: AuditFinding }) {
  // Disposition state comes from context (server-authoritative for
  // live reports; in-memory for dev override). The card reads to
  // tint dismissed findings; the action row inside it does the
  // writes.
  const {
    activeFindingKey,
    setActiveFindingKey,
    dispositionByTarget,
    report,
  } = useAudit();
  const { draft } = useDesignDraft();
  const disposition = dispositionByTarget.get(finding.target_id);
  const currentDisposition = disposition?.status ?? "pending";

  // Two boolean axes encode the 3-state card expansion:
  //   collapsed → cardOpen=false, open=false (title row only)
  //   expanded  → cardOpen=true,  open=false (body shown, judgements hidden)
  //   fully     → cardOpen=true,  open=true  (body + judgements)
  //
  // Seeded from the panel-level baseline (top-of-sidebar "expand
  // all" button) and re-seeded whenever the curator cycles that
  // control. Cards still hold their own state so the legacy fat
  // chevron + the dot-focus "expand THIS finding" pathway still
  // work for fine-grained overrides on top of the baseline.
  const panelExpansion = useContext(PanelExpansionContext);
  const [cardOpen, setCardOpen] = useState(panelExpansion !== "collapsed");
  const [open, setOpen] = useState(panelExpansion === "fully");
  useEffect(() => {
    setCardOpen(panelExpansion !== "collapsed");
    setOpen(panelExpansion === "fully");
  }, [panelExpansion]);

  // The auditor's identity ("Agent" / "Gemma" / "amanda" / "cyan")
  // — used to label the agent-details pill so it reads as
  // "amanda details" / "cyan details" / "Gemma details" instead
  // of the generic "agent details". Per Paul 2026-05-21: the word
  // "agent" should be the name of whoever played the auditor
  // role; use "auditor" only when fully generic.
  const auditorName =
    extractAuditIdentities(report?.model).proposer;

  // Toggle helper that scroll-into-views the card on expand.
  // Without this, expanding a collapsed card at the bottom of the
  // viewport leaves its body off-screen and the curator has to
  // scroll manually. raf defers the scroll one frame so the
  // expanded action row + agent details have reflowed and the
  // card's final height is known.
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
  // The finding is "closed" once the curator has acted on it and
  // there's nothing left to resolve — dismissed counts (already a
  // terminal verdict), and accepted+resolved counts (the curator
  // agreed AND took the structural action). Parked-accepted is
  // intentionally NOT closed since the curator still owes a
  // follow-up. The card greys out when closed so the eye skips
  // past finished work; undo still lives in the action row so
  // mistakes are reversible.
  // 2026-05-17: switched from a single ``isClosed`` boolean to
  // ``hasDisposition`` (any non-pending status) — see below where it's
  // defined alongside ``dispositionTint``. Any disposition now mutes
  // the headline content and swaps the SeverityBadge for a
  // DispositionBadge, so MAJOR/BLK fade out as soon as the curator
  // acts.

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
  const hasCitation = nonEmpty(finding.citation) || nonEmpty(finding.citation_url);
  const proposerDefense = trimRationaleBoilerplate(
    finding.proposer_defense ?? "",
  );
  const supportingEvidence = (finding.supporting_evidence ?? []).filter(
    (e) => nonEmpty(e.quote) || nonEmpty(e.context),
  );
  const hasDefenderContent =
    !!finding.defender_verdict &&
    (nonEmpty(finding.defender_verdict.rationale) ||
      nonEmpty(finding.defender_verdict.citation) ||
      nonEmpty(finding.defender_verdict.verdict));
  // `suggested_fix` on calibration triplet codes restates the
  // headline action ("Remove tag X.") and AgentSuggestionPanel
  // intentionally drops it. So it doesn't count toward "expandable".
  // Mirror the panel's `isCalibrationCode` check so the chevron
  // hide-rule and the panel's render-rule agree.
  const isCalibrationCode =
    finding.issue_code === "calibration_gold_only_miss" ||
    finding.issue_code === "calibration_match" ||
    finding.issue_code === "calibration_agent_extra";
  const suggestedFixCounts =
    nonEmpty(finding.suggested_fix) && !isCalibrationCode;
  // The agent-details panel renders the JUSTIFICATION only —
  // proposer_term + proposer_statements are dropped (they duplicate
  // the editor's comparator chips). So a finding with ONLY a
  // proposer_term and no defense / evidence / fix has nothing to
  // render in the panel; don't count it toward expandable
  // content. Legacy text-only proposer_suggestion still counts as
  // a last-resort signal, but only when nothing else is set.
  //
  // 2026-05-21: AgentSuggestionPanel now ALWAYS renders the Judge
  // row (with the ``[agent emitted no details]`` sentinel when
  // defender + proposer_defense are both empty). So even findings
  // with no structured content carry the sentinel — keep the
  // chevron available so the curator can see that signal explicitly.
  // Per Paul: "we can't tell from this view whether the agent
  // emitted no details OR whether the renderer dropped them."
  // Always true now — the Judge row + sentinel render in every
  // case. Reference variables kept (silenced by ``void``) for
  // documentation: any of these branches firing meant the panel
  // had non-sentinel content under the previous rule. The bare
  // ``true`` codifies the new always-expandable rule.
  void proposerDefense;
  void supportingEvidence;
  void suggestedFixCounts;
  void hasDefenderContent;
  const hasAgentSuggestion = true;
  const hasExpandableContent =
    hasCitation || hasAgentSuggestion || nonEmpty(trail);

  // Once dispositioned, the finding fades — it's no longer load-bearing
  // for the curator's attention. No coloured "verdict" badge competes
  // for the eye; the whole card just recedes (kept legible enough to
  // re-read, but unmistakably "done"). A tiny ✓ / × / ⋯ glyph replaces
  // the severity badge as a quiet marker of what was decided.
  const hasDisposition = currentDisposition !== "pending";
  // Entity-identity tint — sky for factor findings, emerald for
  // tag findings. Subtle (low-alpha background + matching border)
  // so the colour axis stays available for entity identity without
  // fighting the severity badge's stronger amber/rose accents.
  // Per Paul 2026-05-21: blue tint to differentiate factors from
  // tags; same rule applies to match/extra/miss/rename — kind
  // identity reads the same everywhere.
  // Match the design editor's FV palette + Overview FactorChip
  // exactly so the same factor identity reads identically across
  // the audit sidebar, overview, and design editor. Paul
  // 2026-05-21 caught the audit cards using a faded variant
  // (sky-50/40 + sky-300/70) that was visibly weaker than the
  // design editor's full-opacity sky chrome — they're the same
  // entity, they should look the same. Tags mirror in emerald.
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
        // Inline rounded/border instead of using the ``card`` class —
        // ``html.dark .card`` in index.css overrides ``dark:bg-*``
        // utilities and was clobbering the kind-tint in dark mode.
        // Per Paul 2026-05-21 dark-mode sweep.
        "rounded-lg border p-2 text-xs space-y-1.5",
        kindTint,
        severityRowCls(finding.severity),
        hasDisposition && "opacity-40 hover:opacity-90 transition-opacity",
        activeFindingKey === myKey && "ring-2 ring-blue-400",
      )}
    >
      {/* Use a div with role=button instead of a real <button>, because
          the card body contains the inline ReasoningTrailButton — a
          <button> nested inside another <button> is invalid HTML and
          browsers swallow the inner click, which is why "REASONING ▸"
          appeared unclickable. */}
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
            the outer header's expand-agent-details handler — the
            row's onClick uses the `open` axis; this one uses
            `cardOpen`. */}
        <button
          type="button"
          aria-label={cardOpen ? "collapse card" : "expand card"}
          onClick={(e) => {
            e.stopPropagation();
            toggleCardOpen();
          }}
          // Standard chevron convention: ">" right-pointing when
          // closed (click to expand), "v" down-pointing when open
          // (click to collapse). The earlier ⌃⌄ pair was reading
          // backwards. Per Paul 2026-05-21.
          className="text-2xl leading-none text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 px-1 -mt-1 font-bold"
          title={cardOpen ? "collapse" : "expand"}
        >
          {cardOpen ? "⌄" : "›"}
        </button>
        {hasDisposition ? (
          <DispositionDot
            status={
              currentDisposition as "accepted" | "dismissed" | "needs_more_info"
            }
            resolved={!!disposition?.resolved_at}
            severity={finding.severity}
          />
        ) : isMatchFinding(finding) ? (
          // Match-code findings get the ≈ / ✓ badge instead of the
          // severity-with-action-glyph one — the same left-edge
          // status slot, just with the match-status semantic.
          <MatchBadge finding={finding} />
        ) : (
          <SeverityBadge
            severity={displaySeverity(finding)}
            glyph={findingActionGlyph(finding)}
          />
        )}
        <span className="flex-1 min-w-0">
          {editorWillRender ? (
            // The editor's title row below carries the entity
            // identity ("FACTOR treatment · 3 disagreements"); the
            // outer header just needs an action flavor. Drop the
            // issue_code chip and the rationale text — they
            // duplicated info the editor surfaces with more
            // precision.
            <>
              {/* Action glyph (+/−/Δ) lives INSIDE the
                  SeverityBadge above — one colored square does
                  both severity colour AND action symbol. No
                  separate inline glyph here. */}
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mr-1">
                {findingActionLabel(finding)}
              </span>
              <JudgeStrengthGlyph finding={finding} />

              {(() => {
                // Disagreement count badge — yellow circle with
                // the number of row-level disagreements, promoted
                // to the outer header so it's visible when the
                // card is collapsed AND the inner editor's title
                // duplication can be dropped.
                const n = countFindingDisagreements(
                  finding,
                  report,
                  draft ?? null,
                );
                if (n == null || n <= 0) return null;
                // Tooltip reframes on near-match findings (Paul
                // 2026-05-21 redesign). For those the count is
                // explicitly "judge corrections at the FV /
                // statement level — expand FV details", since the
                // factor-level proposal itself is fine and the
                // disagreement is finer-grained. Other finding
                // shapes keep the plain row-level wording.
                const nearMatchTip =
                  `Judge: ${n} correction${n === 1 ? "" : "s"} ` +
                  `suggested at the FV / statement level ` +
                  `— expand FV details`;
                const plainTip = `${n} row-level disagreement${n === 1 ? "" : "s"}`;
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
                // MatchFindingRow) — bedrock rule: ontology terms
                // always render via the Term component with URI
                // annotation, no plain-text fallback. For factor
                // findings, the existing text-based summary (with
                // FV fingerprint + +/- shorthand) still reads
                // best.
                if (finding.target_kind === "tag") {
                  const tok = firstBacktick(finding.rationale);
                  if (!tok) return null;
                  const colon = tok.indexOf(":");
                  if (colon === -1) {
                    return (
                      <span className="text-[11px] text-slate-600 dark:text-slate-300 mr-1 truncate">
                        — <span className="font-mono">{tok}</span>
                      </span>
                    );
                  }
                  const catLabel = tok.slice(0, colon).trim();
                  const valLabel = tok.slice(colon + 1).trim();
                  const matched = draft?.tags?.find(
                    (t) =>
                      (t.category?.label || "").toLowerCase().trim() ===
                        catLabel.toLowerCase() &&
                      (t.value?.label || "").toLowerCase().trim() ===
                        valLabel.toLowerCase(),
                  );
                  const catUri = matched?.category?.uri ?? null;
                  const valUri =
                    matched?.value?.uri ?? finding.proposer_term?.uri ?? null;
                  // Value-first ordering (harmonized with ProposalReview-
                  // Card's TagReviewCard, 2026-05-24): the resolved term
                  // is the load-bearing identity; the category is
                  // qualifying context. Render value chip first, then
                  // "in", then the category in italic-muted.
                  return (
                    <span className="inline-flex items-baseline gap-x-1 mr-1 min-w-0">
                      <span className="text-slate-500 dark:text-slate-400">
                        —
                      </span>
                      <Term
                        uri={valUri}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {valLabel}
                      </Term>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        in
                      </span>
                      <Term
                        uri={catUri}
                        asLink={false}
                        className="italic opacity-80 !whitespace-normal break-words"
                      >
                        {catLabel}
                      </Term>
                    </span>
                  );
                }
                const subj = findingSubjectLabel(finding, report, draft ?? null);
                if (!subj) return null;
                return (
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 mr-1 truncate">
                    — <span className="font-mono">{subj}</span>
                  </span>
                );
              })()}
              <PairedFindingBadge finding={finding} />
              <ConsequentsBadges finding={finding} />
              <ProposerFlagsChips flags={finding.proposer_flags} />
              <DebateBadgeChip
                badge={finding.debate_badge}
                defenderVerdict={finding.defender_verdict}
              />
            </>
          ) : (
            <>
              <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 mr-1">
                {TARGET_KIND_LABEL[finding.target_kind]}
              </span>
              <IssueCodeBadge issueCode={finding.issue_code} />
              <DebateBadgeChip
                badge={finding.debate_badge}
                defenderVerdict={finding.defender_verdict}
              />
              <span
                className={cn(
                  "block text-[11px] text-slate-700 dark:text-slate-200",
                  open ? "" : "line-clamp-2",
                )}
              >
                {rewriteCalibrationRationale(
                  finding.issue_code,
                  splitRationaleTrail(
                    trimRationaleBoilerplate(finding.rationale),
                  ).summary,
                )}
                <ReasoningTrailButton rationale={finding.rationale} />
              </span>
              <FactorReplacementHint finding={finding} report={report} />
            </>
          )}
        </span>
        {/* Outer header is now badge + label + subject + chips
            only — the agent-details toggle moved INSIDE the card
            body so the header stays clean and the curator sees
            the editor first, then the justification underneath.
            Per Paul 2026-05-21: "the agent details should just be
            the justification under the proposal". */}
      </div>

      {/* Action row first — the editor + verdict buttons (the
          curator's primary surface). Collapses with the card. */}
      {cardOpen ? <FindingActionRow finding={finding} /> : null}

      {/* In-body agent-details toggle. Sits below the editor as a
          subtle text affordance — clicking expands the
          justification panel underneath. Disabled (reads "no
          details") when the finding has nothing to expand. */}
      {cardOpen ? (
        <div className="pl-1">
          <button
            type="button"
            onClick={() => {
              if (!hasExpandableContent) return;
              setOpen((v) => !v);
            }}
            disabled={!hasExpandableContent}
            aria-label={
              !hasExpandableContent
                ? `no further details from ${auditorName}`
                : open
                  ? `hide ${auditorName} details`
                  : `show ${auditorName} details`
            }
            title={
              !hasExpandableContent
                ? `${auditorName} emitted no further details`
                : open
                  ? `collapse ${auditorName}'s details`
                  : `show ${auditorName}'s reasoning + supporting evidence`
            }
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide font-semibold whitespace-nowrap",
              hasExpandableContent
                ? "text-sky-700 hover:underline dark:text-sky-300"
                : "text-slate-400 cursor-not-allowed dark:text-slate-500",
            )}
          >
            {!hasExpandableContent
              ? `no details from ${auditorName}`
              : open
                ? `hide ${auditorName} details`
                : `${auditorName} details`}
            {hasExpandableContent ? (
              <span className="text-xs leading-none">{open ? "▾" : "▸"}</span>
            ) : null}
          </button>
        </div>
      ) : null}

      {/* Agent-details panel — citation + agent suggestion + subtask
          reasoning. The "justification under the proposal" Paul
          asked for: renders below the editor, behind the in-body
          toggle. */}
      {cardOpen && open ? (
        <div className="space-y-1.5 pl-1 border-l-2 border-slate-200 dark:border-slate-700">
          {/* Raw target_id slug — debug-only DOM key for the
              inline-dot resolver, not curator-actionable. Hidden
              by default; toggle via a localStorage flag for the
              eval / debug case. */}
          <div className="hidden text-[10px] text-slate-500 dark:text-slate-400 font-mono pl-1.5">
            {finding.target_id}
          </div>

          {finding.citation || finding.citation_url ? (
            <div className="text-[10px] text-slate-500 pl-1.5">
              §{" "}
              {finding.citation_url ? (
                <a
                  href={normalizeWikiUrl(finding.citation_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline"
                  title={finding.citation || finding.citation_url}
                >
                  {finding.citation || finding.citation_url}
                </a>
              ) : (
                <span>{finding.citation}</span>
              )}
            </div>
          ) : null}

          {/* For factor-kind extra/miss findings, render the same
              FV-correspondence detail the match cards use so the
              visual shape stays consistent across (match, extra,
              miss) — curators see exactly the same agent FVs +
              ↔ Gemma pairing + ✓ / ≈ / + / − glyphs whether the
              finding lived through the stricter near-match gate or
              got demoted out of it. For miss findings the gold side
              is primary; we use GoldFactorMissEmbed instead. */}
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

          <AgentSuggestionPanel finding={finding} />

          {/* Inline subtask analysis for factor-scoped findings. */}
          <InlineSubtaskReasoning finding={finding} report={report} />
        </div>
      ) : null}
    </div>
  );
}

/** Primary "Apply & focus" / "Focus" button + secondary disposition
 *  controls (dismiss-with-chip dialog, needs-more-info, undo).
 *
 *  Action lifecycle:
 *    1. Resolve an `ApplyAction` for the finding via
 *       `resolveApplyAction()`. Phase 1 = focus-only across the
 *       board; mutating handlers will plug in here once my brother
 *       ships the structured-fix schema.
 *    2. Click → if mutating, run the draft mutation; either way,
 *       request the audit-focus event so the Shell switches tab and
 *       scrolls the relevant element into view.
 *    3. Stamp the disposition as `accepted` (with `applied_fix`
 *       populated when a real fix was applied + `first_seen_at`
 *       on the first PATCH for this target — see firstSeen.ts).
 *
 *  Dismiss flow opens `DismissDialog` (chip-picker for the
 *  dismiss_reason enum from AUDIT_DISPOSITIONS.md ask #2). */

// Ordered by curator-usage frequency, not enum order, so the modal
// answer is the first chip the eye lands on. Cross-curator data
// (CALIBRATION_CHIP_GAP_HANDOFF.md, 2026-05-14) showed `weak_evidence`
// is the right chip for the bulk of dismisses curators were routing
// through `other` — leading with it cuts the `other` rate.
const DISMISS_CHIPS: DialogChip[] = [
  { key: "weak_evidence",       label: "Weak evidence",      help: "agent's evidence doesn't support the finding" },
  { key: "redundant",           label: "Redundant",          help: "finding duplicates an issue already noted elsewhere" },
  { key: "out_of_scope",        label: "Out of scope",       help: "valid finding but outside this curation pass" },
  { key: "accepted_elsewhere",  label: "Accepted elsewhere", help: "the change was already made via a different finding" },
  { key: "wont_fix",            label: "Won't fix",          help: "acknowledged but intentionally not acted on" },
  { key: "other",               label: "Other",              help: "doesn't fit the above — add a note" },
];

const ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced", label: "Well evidenced", help: "strong evidence in the paper or data" },
  { key: "fills_gap",      label: "Fills gap",      help: "adds information absent from current curation" },
  { key: "more_specific",  label: "More specific",  help: "more precise than the existing entry" },
  { key: "other",          label: "Other",          help: "doesn't fit the above — add a note" },
];

const NOT_SURE_CHIPS: DialogChip[] = [
  { key: "need_more_data",    label: "Need more data",    help: "not enough information to decide" },
  { key: "need_expert",       label: "Need expert",       help: "requires domain expertise to evaluate" },
  { key: "pending_update",    label: "Pending update",    help: "waiting on an upstream change before acting" },
  { key: "other",             label: "Other",             help: "doesn't fit the above — add a note" },
];

// Calibration-specific chip sets. In Mode C (evaluation), dispositions
// judge the agent's accuracy relative to gold — not curation-urgency.
// Chips are framed from the agent's perspective: FN/FP/TN/TP.
//
//   calibration_gold_only_miss: gold has X, agent didn't propose X.
//     Disagree → agent FN (should have proposed it)
//     Accept   → agent TN (correctly omitted; gold was wrong)
//
//   calibration_agent_extra: agent proposed X, gold doesn't have X.
//     Disagree → agent FP (should not have proposed it)
//     Accept   → agent TP (correctly proposed; gold was missing it)
// For calibration_*_gold_only_miss: "Disagree" means curator thinks gold is right
// (agent made a FN). Chips explain WHY — the verdict is already implied.
//
// `agent_real_miss` leads the list because it's the largest single
// chip-gap by case-count across curators (~50 cases pre-landing;
// see CALIBRATION_CHIP_GAP_HANDOFF.md). Used for both tag and
// factor gold-miss findings (server gate accepts both).
const CAL_MISS_DISMISS_CHIPS: DialogChip[] = [
  { key: "agent_real_miss", label: "Agent missed it",  help: "the curator's gold tag is well-supported; agent's omission was an error" },
  { key: "missed_evidence", label: "Missed evidence",  help: "agent overlooked supporting evidence in the paper/data" },
  { key: "borderline",      label: "Borderline",       help: "close call — could reasonably go either way" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_*_gold_only_miss: "Accept (remove)" means curator thinks gold is wrong
// (agent TN). Chips explain WHY.
const CAL_MISS_ACCEPT_CHIPS: DialogChip[] = [
  { key: "gold_was_wrong",  label: "Gold wrong",       help: "Gemma's existing tag is incorrect or outdated" },
  { key: "borderline",      label: "Borderline",       help: "close call — acceptable to remove" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_agent_extra (tag-side): "Disagree" means curator thinks the agent
// over-proposed (agent FP). Chips explain WHY.
//
// `not_sample_applicable` leads — amanda's 8 v18 cases + cross-curator
// confirmation. `redundant_with_bm_source` is tag-only per the server
// gate (factor extras don't show this shape).
const CAL_EXTRA_TAG_DISMISS_CHIPS: DialogChip[] = [
  { key: "not_sample_applicable",  label: "Subset only",                help: "applies to only a subset of profiled samples (e.g., case half of a case/control study)" },
  { key: "no_evidence",            label: "No evidence",                help: "no supporting evidence in the paper/data" },
  // Server wire key stays `redundant_with_bm_source` (validator
  // contract), but the curator-facing label is now category-neutral.
  // The same reason fires for: a BM characteristic carrying the term
  // (cell line, organism part, sample source, etc.), a factor value
  // with full sample coverage (every sample has the term — making
  // the tag a constant), or any other curation surface that already
  // captures what the agent proposed.
  { key: "redundant_with_bm_source", label: "Redundant",                help: "the term is already captured elsewhere — by a biomaterial characteristic, a fully-covering factor value, or another tag" },
  { key: "out_of_scope",           label: "Out of scope",               help: "outside the scope of this tag category" },
  { key: "borderline",             label: "Borderline",                 help: "close call — could reasonably go either way" },
  { key: "other",                  label: "Other",                      help: "add a note" },
];
// For calibration_factor_extra: subset of the tag-side chips. The
// new `not_sample_applicable` / `redundant_with_bm_source` chips
// don't apply — factor values define their sample groupings
// explicitly, and BM-source redundancy is a tag concept.
const CAL_EXTRA_FACTOR_DISMISS_CHIPS: DialogChip[] = [
  { key: "no_evidence",     label: "No evidence",      help: "no supporting evidence in the paper/data" },
  { key: "out_of_scope",    label: "Out of scope",     help: "outside the scope of this factor category" },
  { key: "borderline",      label: "Borderline",       help: "close call — could reasonably go either way" },
  { key: "other",           label: "Other",            help: "add a note" },
];
// For calibration_agent_extra: "Accept (add)" means curator agrees with agent
// (agent TP). Chips explain WHY.
const CAL_EXTRA_ACCEPT_CHIPS: DialogChip[] = [
  { key: "well_evidenced",  label: "Well evidenced",   help: "strong evidence in the paper or data" },
  { key: "fills_gap",       label: "Fills gap",        help: "adds information absent from current gold" },
  { key: "borderline",      label: "Borderline",       help: "close call — acceptable to add" },
  { key: "other",           label: "Other",            help: "add a note" },
];

// Factor variants share the calibration chip sets with their tag
// counterparts — same TP/FP/FN/TN framing, same curator rationales
// in practice. Without this routing the factor codes fall through
// to the generic DISMISS_CHIPS / ACCEPT_CHIPS, which is how amanda
// ended up routing 19/20 v7b factor-gold-miss dismisses through
// `weak_evidence` (the closest-feeling chip in the wrong vocab) —
// see CALIBRATION_CHIP_GAP_HANDOFF.md, "Discoverability ask".
function dismissChipsFor(issueCode: string): DialogChip[] {
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  )
    return CAL_MISS_DISMISS_CHIPS;
  if (issueCode === "calibration_agent_extra")
    return CAL_EXTRA_TAG_DISMISS_CHIPS;
  if (issueCode === "calibration_factor_extra")
    return CAL_EXTRA_FACTOR_DISMISS_CHIPS;
  return DISMISS_CHIPS;
}
function acceptChipsFor(issueCode: string): DialogChip[] {
  if (
    issueCode === "calibration_gold_only_miss" ||
    issueCode === "calibration_factor_gold_only_miss"
  )
    return CAL_MISS_ACCEPT_CHIPS;
  if (
    issueCode === "calibration_agent_extra" ||
    issueCode === "calibration_factor_extra"
  )
    return CAL_EXTRA_ACCEPT_CHIPS;
  return ACCEPT_CHIPS;
}

// Calibration chips (`missed_evidence`, `no_evidence`, `gold_was_wrong`,
// `borderline`) are first-class canonical DismissReason / AcceptReason
// values on the agent side as of 2026-05-13 — the v0.6.4 squash-and-
// prefix workaround was retired in v0.6.5 once old eval packages
// were declared retired. Chip keys now map straight through to the
// structured field; the `[tag]` prefix workaround only persists as a
// legacy-read path in `parsePrefixedNote` for rows already in the DB.

function FindingActionRow({ finding }: { finding: AuditFinding }) {
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
  // notes/tag and a "Save" confirm. Server-side this is the same
  // PATCH path — append-only log, latest-per-target_id wins.
  const [dismissEditing, setDismissEditing] = useState(false);
  const [acceptEditing, setAcceptEditing] = useState(false);
  const [notSureEditing, setNotSureEditing] = useState(false);
  // Draft snapshot taken just before a mutating apply action runs.
  // Restored by the undo button so "undo" reverts BOTH the server
  // disposition and the draft mutation together.
  const [preApplyDraftSnapshot, setPreApplyDraftSnapshot] = useState<Design | null>(null);
  // The DismissDialog portals out of the sidebar's overflow context
  // and positions itself relative to these refs' bounding rects —
  // one ref per dialog-trigger button.
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);
  const acceptBtnRef = useRef<HTMLButtonElement | null>(null);
  const notSureBtnRef = useRef<HTMLButtonElement | null>(null);
  // Pass the report + draft so factor-level calibration apply
  // handlers (extra → add factor, gold_only_miss → remove factor)
  // can resolve the agent factor and guard against double-applies.
  const action = resolveApplyAction(finding, { report, design: draft });
  const disposition = dispositionByTarget.get(finding.target_id);
  const current = disposition?.status ?? "pending";
  // Judge says weak → reframe the action row so Dismiss is the
  // primary blue button and the structural-apply demotes to a
  // small "override" link. Without this the curator gets mixed
  // signals (Suggested Fix says "keep" while the primary button
  // still pushes the contradicting structural action). See
  // AUDIT_DEFENDER_VERDICT_HANDOFF.md § "what shipped".
  const dv = finding.defender_verdict ?? null;
  const judgeWeak =
    (dv?.strength ?? verdictStrength(dv?.verdict)) === "weak";
  // Subsumed FV children of this finding (only non-empty when this
  // is a factor finding; the helper short-circuits otherwise).
  // Cached so we can show "+ N FVs cascaded" in the action tooltip
  // and toast without re-deriving on every click.
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
  // calibration_match (both sides have the tag, agreeing means
  // "yes confirmed") or a calibration_gold_only_miss (the gold
  // already has X; agreeing means "yes the agent missed it; the
  // existing curation is right"). The two-step park → Mark
  // resolved flow assumes there's a structural fix the curator
  // walks off to apply, so we collapse it to a single Confirm
  // step for these cases. Severity-ok stays here for backwards
  // compat with any other ok-emitting judges. Future: when
  // ``apply_action`` becomes more populated and signals
  // explicitly whether work is required, derive from that.
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
      // 409 means the audit was finalized between the curator's
      // click and the PATCH landing. Surface a clear "reopen first"
      // affordance in the toast rather than the generic message;
      // every other failure (network, 500) keeps the generic path.
      const apiErr = err as { status?: number; message?: string };
      if (apiErr.status === 409) {
        toast.show(
          "Audit is closed — reopen it to keep editing dispositions.",
          "danger",
          6000,
        );
        return;
      }
      toast.show(
        `Disposition save failed: ${(err as Error).message}`,
        "danger",
        6000,
      );
      return;
    }

    // Cascade: when the curator dispositions a factor finding, flow
    // the same disposition to the FV children the suppression rule
    // treats as subsumed. Skip on undo (status=pending) — a
    // mis-click on the parent shouldn't ripple through and undo
    // explicit per-FV calls. Skip any child whose disposition has
    // already been touched explicitly so a curator's manual call on
    // an individual FV always wins. `inherited_from` is set to the
    // parent's target_id so the dispositions report can weight
    // cascaded vs direct curator calls differently.
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
        `Cascaded to ${cascaded} subsumed FV finding${cascaded === 1 ? "" : "s"}.${
          cascadeFailed > 0
            ? ` (${cascadeFailed} failed — review the suppressed list.)`
            : ""
        }`,
        cascadeFailed > 0 ? "danger" : "success",
        cascadeFailed > 0 ? 6000 : 3000,
      );
    } else if (cascadeFailed > 0) {
      toast.show(
        `Cascade failed for ${cascadeFailed} subsumed FV finding${cascadeFailed === 1 ? "" : "s"} — review the suppressed list.`,
        "danger",
        6000,
      );
    }
  }

  // Read-only when finalized. Surface a one-line "closed — reopen
  // to edit" with an inline reopen button so the curator can flip
  // the audit back open without leaving the finding card. Skip the
  // action / dismiss / ? buttons entirely; their disabled-state
  // tooltips would just hide the actual cause.
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
  //    the same as accepting the finding. The separate "Accept"
  //    button below covers that explicitly.
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
      setPreApplyDraftSnapshot(draft);
      applyDraft(action.mutate);
      requestAuditFocus(experimentId, finding.target_id);
      if (action.successMessage) {
        toast.show(action.successMessage, "success");
      }
      // Most mutating applies imply accepted+resolved (Ask #6) — the
      // curator just took the structural action the finding asked
      // for, so there's nothing left to "park" until later. The
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
      // left to do once the curator agrees — auto-stamp resolved_at
      // so they don't sit in the parked queue. Findings with follow-up
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
  // affordance changes. See HANDOFF_2026-05-19_INTER_CURATOR_AUDIT_FOLLOWUPS
  // §2 + §3 for the wire-shape design.
  const useStructuredEditor =
    !isFinalized &&
    findingHasStructuredContent(finding, report, draft);

  return (
    <div className="pl-1.5 pt-2 space-y-1.5 relative">
      {useStructuredEditor ? (
        <FindingDetailsEditor
          finding={finding}
          report={report}
          design={draft}
          currentDisposition={current}
          onSave={async (appliedFix, structureOk, detailsOk) => {
            // Conventional mapping lives in ``dispositionSave.ts``
            // (unit-tested in ``dispositionSave.test.ts``). Editor
            // computes structure_ok / details_ok per
            // ``verdictToStructureDetails(verdict, issue_code)``;
            // here we derive the headline status + a default
            // dismiss_reason for the "keep gold" one-click path
            // (the chip dialog still routes through the legacy
            // Dismiss… button when the curator wants to pick a
            // reason explicitly).
            const status = deriveStatus(structureOk, detailsOk);
            const resolvedAt =
              status === "accepted" ? new Date().toISOString() : undefined;
            const derivedDismissReason = deriveDismissReason(
              status,
              finding.issue_code,
            );
            const derivedAcceptReason = deriveAcceptReason(
              status,
              finding.issue_code,
            );
            // Dual-write: apply the curator's per-row edits to the
            // design draft BEFORE patching the disposition. The
            // draft mutation shows up immediately in the Design tab
            // and rides to commit via CommitBar; the disposition
            // PATCH records the same edits on the audit (for the
            // scorer + audit trail). Mirrors the legacy
            // ``Apply & Focus`` dual-write, just driven by the
            // structured per-row payload.
            if (
              typeof appliedFix !== "string" &&
              appliedFix.kind === "details_edit" &&
              appliedFix.edits &&
              appliedFix.edits.length > 0
            ) {
              // Pass a function rather than the computed Design so
              // the mutation runs against the latest draft state.
              applyDraft((current) =>
                applyDetailsEditsToDesign(current, finding, report, appliedFix),
              );
            }
            await patch(status, {
              appliedFix,
              structureOk,
              detailsOk,
              resolvedAt,
              dismissReason: derivedDismissReason,
              acceptReason: derivedAcceptReason,
            });
          }}
          onDismiss={() => setDismissOpen(true)}
          onPark={() => setNotSureOpen(true)}
          onUndo={() => {
            // Mirror the legacy action-row undo: restore the
            // pre-apply draft snapshot (if one was taken when the
            // curator clicked Apply) and PATCH back to pending so
            // the server disposition reverts in lockstep.
            if (preApplyDraftSnapshot) {
              const snap = preApplyDraftSnapshot;
              setPreApplyDraftSnapshot(null);
              applyDraft(() => snap);
            }
            patch("pending");
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
            // make it idempotent, but the curator's mental model
            // is "I've done this", so grey it out. Undo via the
            // explicit disposition buttons (Agree → undo, Disagree
            // → undo) re-enables the apply for re-runs.
            const applyAlreadyDone =
              action.mutates && current !== "pending";
            // Use the action-level label when set (calibration paths
            // emit "Agree (add) →" / "Agree (remove) →"); fall back
            // to the legacy default for handlers that don't.
            const label =
              action.label ||
              (action.mutates ? "Apply & focus →" : "Focus →");
            // Done state — strip the verb prefix and arrow, leaving
            // a "✓ done (action)" pill that signals the apply has
            // landed.
            const labelDone = label
              .replace(/^(Agree|Apply)\b/, "✓ Done")
              .replace(/\s*→\s*$/, "");
            // Agent-extra accept now requires an explanation
            // (2026-05-10): adding new curation deserves a "why".
            // Click opens the accept-reason dialog instead of
            // running the mutation immediately. Other mutating
            // applies (e.g. calibration_gold_only_miss = remove
            // tag) skip the dialog — those are already a "no" and
            // covered by the dismiss-reason flow inside handleApply.
            const isAgentExtra =
              finding.issue_code === "calibration_agent_extra";
            const onPrimaryClick = () => {
              if (isAgentExtra && action.mutates && !applyAlreadyDone) {
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
                  title={`override the judge — ${action.tooltip ?? label}`}
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
                      ? "bg-blue-200 text-blue-700 cursor-progress"
                      : applyAlreadyDone
                        ? // Greyed-out post-apply state. Indicates
                          // the structural change has landed; undo
                          // through the disposition buttons.
                          "bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700"
                        : current === "accepted"
                          ? "bg-blue-700 text-white hover:bg-blue-800"
                          : "bg-blue-600 text-white hover:bg-blue-700"
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
            above IS the agree affordance for those cases (clicking
            it both runs the structural fix and dispositions
            accepted+resolved). For focus-only / non-mutating
            findings, this button is the only way to agree. Also
            hidden when the judge says weak — agreeing without acting
            is just clutter when the judge is telling you to dismiss. */}
        {action?.mutates || judgeWeak ? null : (
        <button
          ref={acceptBtnRef}
          type="button"
          onClick={() => {
            // Undo path stays single-click — re-Agreeing on something
            // already accepted means "back to pending".
            if (current === "accepted") {
              patch("pending");
              return;
            }
            // Fresh agree → open the accept dialog so the curator can
            // pick a reason chip and add a note. Previously this was a
            // direct patch with no dialog, so notes were impossible to
            // attach when agreeing on factor / match findings.
            setAcceptOpen(true);
          }}
          disabled={dispositionSaving}
          title={
            isResolved
              ? "undo — back to pending (clears resolved_at)"
              : isParked
                ? "undo — back to pending"
                : noFollowUp
                  ? "agree (click again to undo)"
                  : "agree (resolve once you've fixed the data)"
          }
          className={cn(
            "text-[11px] px-2 py-0.5 rounded font-medium disabled:opacity-50",
            isResolved
              ? "bg-emerald-700 text-white hover:bg-emerald-800"
              : isParked
                ? noFollowUp
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-white border border-blue-600 text-blue-700 hover:bg-blue-50 dark:bg-slate-900 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-slate-800",
          )}
        >
          {isResolved
            ? "✓✓ resolved"
            : isParked
              ? noFollowUp
                ? "✓ agreed"
                : "✓ parked"
              : "Agree"}
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
              ? "judge says close (pick a reason)"
              : "disagree (pick a reason)"
          }
          className={cn(
            "rounded font-medium disabled:opacity-50",
            judgeWeak
              ? // Promoted to primary blue when the judge advises
                // against the apply — dismiss is the natural action.
                "text-[11px] px-2 py-0.5 " +
                  (current === "dismissed"
                    ? "bg-blue-700 text-white hover:bg-blue-800"
                    : "bg-blue-600 text-white hover:bg-blue-700")
              : "text-[10px] px-1.5 py-0.5 " +
                  (current === "dismissed"
                    ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"),
          )}
        >
          {current === "dismissed"
            ? judgeWeak
              ? "✓ dismissed"
              : "✓ disagreed"
            : judgeWeak
              ? "Dismiss…"
              : "Disagree…"}
        </button>
        <button
          ref={notSureBtnRef}
          type="button"
          onClick={() => {
            // Toggle off when already set; opening the dialog only
            // makes sense when the curator is committing to a new
            // park decision. The structured reason is required —
            // dialog handles that gating.
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
        {current !== "pending" ? (
          <button
            type="button"
            onClick={() => {
              if (preApplyDraftSnapshot) {
                const snap = preApplyDraftSnapshot;
                setPreApplyDraftSnapshot(null);
                applyDraft(() => snap);
              }
              patch("pending");
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
          // The trigger button refs are reused — the popover anchors
          // on the same Disagree / Park / accept button it would for
          // a "new" disposition, so positioning stays consistent.
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
            // Prefill order: structured field (post-2026-05-13
            // canonical chip) → legacy `[tag]` prefix in notes
            // (pre-2026-05-13 rows). Handled by resolveEditInitial.
            const prefill =
              dismissEditing && disposition
                ? resolveEditInitial(disposition, "dismiss")
                : { tag: null, plain: "" };
            return (
              <DismissDialog
                mode="dismiss"
                chips={dismissChipsFor(finding.issue_code)}
                finding={finding}
                targetId={finding.target_id}
                anchor={dismissBtnRef.current}
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

/** Inline display of a disposition's stored note, with an "edit"
 *  affordance that re-opens the matching dialog in edit mode. When
 *  the audit is finalized, the affordance turns into a "reopen to
 *  edit" hint — the server's PATCH gate rejects writes against a
 *  finalized audit (409), so we surface the path back. */
function DispositionNoteRow({
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
  // no note yet — so the curator can retro-add one. Empty-note
  // case renders just the "✎ edit" link with no quote text.
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
// Severity helpers (duplicated from AuditReportView for now — extract to a
// shared module once we have a third caller).
// ---------------------------------------------------------------------------

/** "Proposer suggestion" panel: structured render of what the silent
 *  comparison proposer would have done with this target.
 *
 *  Newer reports (post-2026-05-08) carry ``proposer_term``,
 *  ``proposer_defense``, and ``supporting_evidence[]`` per
 *  AUDIT_PROPOSER_SUGGESTION_HANDOFF.md. Older reports only have the
 *  legacy one-line ``proposer_suggestion`` string. The panel:
 *
 *    - Renders ``proposer_term`` as a green linkified ``Term`` chip
 *      when URI present (italic grey when free-text). Falls back to
 *      the raw string label when ``proposer_term`` is null but the
 *      legacy string is set.
 *    - Renders ``proposer_defense`` as a slate paragraph below the
 *      term — the agent's positive case for its alternate, distinct
 *      from the finding's ``rationale`` (which is "why the gold
 *      curation is wrong").
 *    - Renders each ``supporting_evidence`` as a blockquote with a
 *      small source-label chip (paper / preboarding / sample names /
 *      …). Full sentences come from the agent side.
 *
 *  Hidden entirely when there's nothing to show (no structured
 *  fields AND no legacy string). */
/** Calibration-judge rationales come with two fixed boilerplate
 *  patterns that add nothing to the curator's decision — the
 *  disposition buttons already say what the verdict is, and the
 *  proposer-suggestion panel already shows the supporting
 *  evidence. Strip both so the rationale stays focused on the
 *  actual claim.
 *
 *  Conservative regexes — only strip when the suffix is
 *  recognisable, otherwise return input untouched. Brother knows
 *  about both and is going to tighten the rationale templates
 *  agent-side; these regexes are the bridge until that lands. */
/** Rewrite the two calibration question-form rationales into direct
 *  curator-facing statements. The agent emits "Should X be removed?"
 *  / "Should we add X?" — we replace those with actionable copy that
 *  spells out who is proposing what. Falls back to the original text
 *  when the pattern doesn't match (future agent wording changes,
 *  non-calibration codes, etc.). */
function rewriteCalibrationRationale(
  issueCode: string,
  rationale: string,
): string {
  const tok = firstBacktick(rationale);
  if (tok) {
    if (issueCode === "calibration_gold_only_miss") {
      return `Proposed removing \`${tok}\` (not in the proposal).`;
    }
    if (issueCode === "calibration_agent_extra") {
      return `Proposed adding \`${tok}\`. Do you agree?`;
    }
    if (issueCode === "calibration_match") {
      return `Proposal and existing curation both have \`${tok}\`. Is this correct?`;
    }
  }
  return rationale;
}

/** Inline "Reasoning ▸" link that pops the agent's full reasoning
 *  trail. Renders nothing when the rationale carries no trail
 *  marker. Popover aligns right + sized small so it sits next to
 *  the trigger instead of swallowing the suggestion block beneath. */
function ReasoningTrailButton({ rationale }: { rationale: string }) {
  const { trail } = splitRationaleTrail(trimRationaleBoilerplate(rationale));
  if (!trail) return null;
  return (
    <span className="ml-1 inline-block align-middle">
      <HelpPopup
        title="Agent reasoning trail"
        size="md"
        align="right"
        trigger={
          <span className="inline-flex items-baseline gap-1">
            Reasoning <span className="text-xs leading-none">▸</span>
          </span>
        }
        triggerClassName="ml-1 text-[11px] uppercase tracking-wide text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 hover:underline align-middle"
      >
        <div className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
          {trail}
        </div>
      </HelpPopup>
    </span>
  );
}

/** Pull the factor label out of a `calibration_factor_*` finding's
 *  rationale. The agent emits the label as the first backticked token
 *  in the question form (e.g. "Remove factor `treatment`?", "Is factor
 *  `genotype` correctly captured?"). Returns the label in lowercase
 *  (matching the subtask_decision target_id casing) or null when the
 *  pattern doesn't match. */
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
 *  already shown on the header term chip — that's pure restatement
 *  (Paul 2026-05-21). Other subtask types (S2j, S7_coverage, S2i,
 *  …) are kept as-is. */
function InlineSubtaskReasoning({
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
  const filtered = decisions.filter((d) => !s10MatchesHeaderUri(d, headerUri));
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

/** Splits a calibration finding's rationale into the curator-facing
 *  summary and the agent's full reasoning trail. The trail (subtask
 *  decisions, debate transcripts, S2h/S8 evidence chains) is the
 *  same content that lives in the SUBTASK ANALYSIS section — so
 *  inlining the whole thing here means the curator sees it three
 *  times. The UI hides it behind a "reasoning ▸" disclosure.
 *
 *  Markers (set by ``build_calibration_batch.py`` /
 *  ``rationale_with_trail``):
 *    - ``" — Agent reasoning trail — "``
 *    - ``" — Full agent reasoning trail — "``
 *
 *  Returns ``{summary, trail}`` where ``trail`` is ``null`` when no
 *  marker is present (the whole string is summary). */
/** Combined "suggested fix + proposer suggestion" panel. Shows both
 *  in a single box so the curator sees one coherent "what the agent
 *  thinks you should do" block instead of two differently-coloured
 *  nested boxes.
 *
 *  Render contract (Paul 2026-05-21, two screenshots flagged):
 *   - Hide ``suggested_fix`` when it's just an action one-liner
 *     ("Add factor X.", "Remove factor X.", "Swap …", "Rename …",
 *     "Keep …") — the header chip already shows the action. Same
 *     when it duplicates ``rationale`` verbatim modulo punctuation.
 *   - Hide the legacy ``proposer_suggestion`` text when its
 *     parsed category + values are already rendered by the FV
 *     chips above (RenameFactorEmbed / GoldFactorMissEmbed /
 *     comparator chips). When at least one suggestion value is
 *     novel, render it — the curator shouldn't lose that signal.
 *   - ALWAYS render the "Judge:" row: prefer
 *     ``defender_verdict.rationale``, fall back to
 *     ``proposer_defense``, and when both are empty render the
 *     ``"[agent emitted no details]"`` sentinel in muted slate
 *     italic. The sentinel distinguishes "agent ran but had nothing
 *     to add" from "renderer dropped the field". */
function AgentSuggestionPanel({ finding }: { finding: AuditFinding }) {
  const verdictFix = shortFixForVerdict(finding.defender_verdict);
  // For calibration triplet codes the collapsed header already states the
  // action ("does not propose X", "proposes adding X", "both have X").
  // Showing suggested_fix in the expanded body just repeats it verbatim.
  // Keep it only when a defender verdict override changed the recommended
  // action — that's genuinely new information.
  const isCalibrationCode =
    finding.issue_code === "calibration_gold_only_miss" ||
    finding.issue_code === "calibration_match" ||
    finding.issue_code === "calibration_agent_extra";
  const rawFixText =
    verdictFix ?? (isCalibrationCode ? null : finding.suggested_fix);

  // Suppress fixText when it just restates the header action or the
  // rationale. ``verdictFix`` (curator-facing override copy for weak
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

  // Legacy one-line ``proposer_suggestion`` — keep only when it
  // adds info beyond the FV chips already on screen. The visible
  // FV labels come from proposer_statements (subject slot); for
  // older audits without structured statements the comparison falls
  // through to "no visible FVs → render as fallback".
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
  // Lean direction (pro_agent / pro_gold / neutral) drives the
  // header label TEXT — the SUGGESTION header used to say "STRONG
  // SUGGESTION" even when the judge had concluded the agent was
  // wrong (e.g. GSE93824 Arctic-APP concept_gold_right case,
  // Paul 2026-05-21). The lean-aware label flips to "NOT SUGGESTED"
  // in that case so the curator isn't nudged toward the wrong
  // answer. Single-axis framing (Paul 2026-05-21): the label always
  // describes the *strength of the suggestion to change* — see
  // ./defenderLean.ts for the full mapping table.
  const lean = findingLean(finding);
  const headerLabel = leanSuggestionLabel(lean, strength);

  // Near-match findings (calibration_factor_match_near OR any rename
  // payload — the GSE93824 genotype gene-URI case) get a different
  // treatment than whole-factor extra / gold-only-miss findings.
  // Their factor-level proposal is a good call (the green disc
  // header chip carries that signal); the disagreement is at the
  // FV / statement level (the yellow N badge counts it). On these
  // findings:
  //   - drop the single-axis strength label here — it collapses
  //     factor-level OK + lower-level concept-diff into one
  //     "STRONG / WEAK / NOT SUGGESTED" axis and reads as
  //     "the whole factor proposal is bad" even when it's mostly
  //     right (per Paul 2026-05-21).
  //   - move the Judge rationale into the FV expansion block in
  //     ``FindingDetailsEditor`` so the WHY binds to the exact FV
  //     being corrected, not the whole factor card.
  // Extra / gold-only-miss findings keep both — those are full-
  // factor decisions where the strength label is the right framing.
  const isNearMatch = isNearMatchFinding(finding);

  // Judge row — always rendered for non-near-match findings (Paul
  // 2026-05-21: the curator needs the WHY even when the agent
  // emitted nothing). Sentinel branch renders muted italic so the
  // absence reads as "no details" not "missing UI". For near-match
  // findings the row moves to the FV-level DisagreementBlock — see
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
          corrected. Per Paul 2026-05-21. */}
      {!isNearMatch ? (
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
      {evidence.length > 0 ? (
        <div className="space-y-1">
          {evidence.map((ev, i) => (
            <FindingEvidenceBlock key={i} evidence={ev} />
          ))}
        </div>
      ) : null}
      {/* Legacy text-only proposals (older audits with no structured
          term / statements / defense / evidence) still surface as a
          last-resort signal so the curator doesn't lose that data.
          Suppressed when the FV chips above already render it (see
          ``isProposerSuggestionRedundant``) and when no other slot
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

/** Strength fallback for v9-and-older calibration packages whose
 *  ``AttachedDefenderVerdict`` predates the producer-side
 *  ``strength`` field (added in v10, commit 5b1f811). Mirrors the
 *  producer's mapping exactly; v10+ packages carry ``strength`` on
 *  the wire and skip this helper. ``null`` for unknown verdict
 *  strings — caller hides the strength label rather than guess.
 *  See AUDIT_DEFENDER_VERDICT_HANDOFF.md § "Mapping". */
function verdictStrength(
  v: string | undefined,
): "weak" | "moderate" | "strong" | null {
  switch (v) {
    // Tag side (original six, AUDIT_DEFENDER_VERDICT_HANDOFF.md).
    case "extra_genuine_new":
    case "agent_correct_inherited":
    case "agent_correct_overzealous_gold":
      return "strong";
    case "agent_miss_genuine":
    case "extra_inherited_redundant":
    case "extra_unsupported":
      return "weak";
    // Factor side (FACTOR_DEFENDER_VERDICT_HANDOFF.md, 2026-05-14).
    // extra_genuine_new + extra_unsupported are shared with the tag
    // enum (same string, same strength) and handled above.
    case "miss_inherited_from_design":
    case "miss_overzealous_gold":
      return "strong";
    case "extra_confounded":
    case "miss_genuine":
      return "weak";
    case "extra_borderline":
    case "miss_borderline":
      return "moderate";
    default:
      return null;
  }
}

/** Short human-readable replacement for ``finding.suggested_fix``
 *  when the judge says the curator should *not* take the proposed
 *  action. Only fires when ``strength`` resolves to ``"weak"``
 *  (producer-side from v10+ packages, or via ``verdictStrength()``
 *  fallback for v9 and older); ``moderate`` and ``strong`` keep the
 *  agent's verbose ``suggested_fix`` because the curator still
 *  needs the structured detail. Returns ``null`` when no override
 *  applies. */
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

/** One evidence quote — blockquote rendering with a small source chip
 *  on the right. Source vocab matches the agent-side
 *  ``FindingEvidence.source`` literal: paper / preboarding /
 *  sample_names / geo_metadata / characteristic.
 *
 *  Three layers per AUDIT_EVIDENCE_CONTEXT_HANDOFF.md:
 *    1. ``quote`` — the anchor sentence (always rendered as the
 *       collapsed-state blockquote).
 *    2. ``context`` — paragraphs / sample-names neighbourhood / full
 *       characteristic block. Hidden behind a "Show more" expander
 *       when set + non-empty + different from ``quote``. Rendered in
 *       a sibling pre-formatted block with ``highlights`` ranges
 *       wrapped in a soft yellow span so the eye lands on the anchor
 *       inside the wider text.
 *    3. ``source_url`` — optional deep-link to the GEO record /
 *       PubMed / Gemma sample page; rendered as a small "open ↗"
 *       in the source-label header strip. */
function FindingEvidenceBlock({
  evidence,
}: {
  evidence: NonNullable<AuditFinding["supporting_evidence"]>[number];
}) {
  const [expanded, setExpanded] = useState(false);
  // Display labels for the evidence-source discriminated union.
  // The wire-format literal is still ``"preboarding"`` (mirrors the
  // Python schema) but the curator-facing string is "preboarding"
  // per Paul 2026-05-21. When brother renames the wire literal,
  // update the KEY here too in lockstep.
  const sourceLabel: Record<typeof evidence.source, string> = {
    paper: "paper",
    preboarding: "preboarding",
    sample_names: "sample names",
    geo_metadata: "GEO",
    characteristic: "characteristic",
  };
  const { context, highlights } = stripContextHeader(
    (evidence.context || "").trim(),
    evidence.highlights ?? [],
  );
  const quote = (evidence.quote || "").trim();
  // Only show the expander when context adds value beyond the
  // anchor sentence — empty contexts and contexts that just are
  // the quote don't warrant the affordance.
  const hasMore = !!context && context !== quote;
  return (
    <blockquote
      className="border-l-2 border-violet-300 bg-white/60 pl-2 pr-1 py-1 text-slate-700 italic relative dark:border-violet-600 dark:bg-slate-800/40 dark:text-slate-200"
      title={evidence.location || sourceLabel[evidence.source]}
    >
      <div className="not-italic text-[9px] uppercase tracking-wide text-violet-700/80 mb-0.5 flex items-center justify-between gap-2 dark:text-violet-300/90">
        <span className="inline-flex items-baseline gap-1.5">
          <span>{sourceLabel[evidence.source]}</span>
          {evidence.source_url ? (
            <a
              href={evidence.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-violet-700/90 hover:text-violet-900 hover:underline dark:text-violet-300 dark:hover:text-violet-200"
              title={`open source: ${evidence.source_url}`}
            >
              open ↗
            </a>
          ) : null}
        </span>
        {evidence.location ? (
          <span className="text-slate-500 not-italic font-mono text-[9px] truncate dark:text-slate-400">
            {evidence.location}
          </span>
        ) : null}
      </div>
      <span className="leading-snug">"{quote}"</span>
      {hasMore ? (
        <>
          {expanded ? (
            <pre className="not-italic mt-1.5 px-1.5 py-1 rounded bg-violet-50/70 dark:bg-violet-900/30 text-[11px] leading-snug whitespace-pre-wrap break-words font-sans text-slate-800 dark:text-slate-200 max-h-72 overflow-y-auto">
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
            className="not-italic mt-1 ml-1 text-[10px] text-violet-700 hover:underline dark:text-violet-300"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      ) : null}
    </blockquote>
  );
}

/** Strip the leading ``=== ... ===`` separator line GEO-metadata
 *  excerpts ship with — the source-label chip already says "GEO",
 *  so the duplicate header is just noise. Shifts ``highlights``
 *  offsets to match the trimmed string. */
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

/** Render ``context`` with ``highlights`` ranges wrapped in a soft
 *  yellow span. Half-open ``[start, end)`` byte offsets per
 *  agent-side contract. Out-of-range / overlapping / unsorted
 *  ranges all clamp + sort + merge defensively so a malformed
 *  highlight set never breaks the render. */
function renderHighlightedContext(
  context: string,
  highlights: [number, number][],
): ReactNode {
  if (!highlights || highlights.length === 0) return context;
  // Clamp into [0, len], drop empties, sort by start, merge
  // overlaps. Done once per render — the lists are small.
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

/** Glyph + short label for a finding's ``issue_code``. The raw
 *  ``calibration_agent_extra`` / ``forbidden_efc`` / etc. strings
 *  are stable handles for tests + eval but read poorly on screen.
 *  Map known codes to a glyph that signals shape (``+`` = agent
 *  proposed something extra, ``−`` = agent missed something gold
 *  has, ``=`` = match, ``Δ`` = needs change, ``✓`` = ok pass)
 *  with a short word; fall back to the raw code for codes we
 *  haven't mapped yet so new judges don't render blank. The raw
 *  code stays in the hover title for the eval / debug case where
 *  you actually need it. */
function IssueCodeBadge({ issueCode }: { issueCode: string }) {
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

/** Render mapping for known ``issue_code`` values. The glyph is the
 *  scannable cue; the label is a one-word shape hint. Tones: green
 *  for "extra" (positive — something to consider adding), slate for
 *  "missing"/"match" (neutral readout), amber for "needs change",
 *  emerald-faint for "ok". When my brother adds new codes, they
 *  render as raw ``font-mono`` text via the fallback above until
 *  this map gets entries. */
const ISSUE_CODE_RENDER: Record<
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
};

/** Debate-pipeline badge — signals how the agent's internal
 *  propose/challenge/defend/arbitrate loop ended. Labels avoid
 *  the medal-quality metaphor that misled curators ("★ gold" reads
 *  as endorsement) and frame the badges as consensus signals.
 *
 *  Suppressed entirely when the defender verdict downgraded to
 *  "weak" — the defender is the rigorous second-opinion judge and
 *  showing both a "debate said it's fine" badge next to a "WEAK
 *  SUGGESTION" panel reads as the surface contradicting itself
 *  (it isn't — they evaluate different things — but the visual
 *  whiplash isn't worth the signal). */
/** Small "↔ paired" pill rendered on findings carrying a
 *  ``paired_finding_id``. Both halves of a demoted same-category
 *  factor match (calibration_factor_extra + _factor_gold_only_miss
 *  emitted by the partition-mismatch demotion path) share the
 *  same UUID, so clicking the badge jumps to the sibling — same
 *  scroll-and-expand path the inline-dot resolver uses. Renders
 *  nothing when the finding isn't part of a demotion pair, or
 *  when the report has no sibling carrying the same UUID (e.g. a
 *  partial round-trip where one half got filtered out). */
function PairedFindingBadge({ finding }: { finding: AuditFinding }) {
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
 *  Renders:
 *  - On a finding carrying `consequent_of`: one "← absorbed by …"
 *    chip jumping to the upstream partition_mismatch.
 *  - On a finding carrying `consequents`: one "implies removal of
 *    …" chip per entry, each jumping to the downstream miss.
 *
 *  Silently skips entries whose target_id can't be resolved in the
 *  current report (defensive against partial round-trips). */
function ConsequentsBadges({ finding }: { finding: AuditFinding }) {
  const { report, setActiveFindingKey } = useAudit();
  const findings = report?.findings ?? [];
  const chips: Array<{ key: string; label: string; title: string; onClick: () => void }> = [];

  if (finding.consequent_of) {
    const upstream = findings.find((f) => f.target_id === finding.consequent_of);
    if (upstream) {
      const label = (firstBacktick(upstream.rationale) ?? upstream.target_id);
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
    const label = (firstBacktick(downstream.rationale) ?? downstream.target_id);
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
          // Action-style chip — solid violet fill + chevron icon
          // so the curator reads it as clickable navigation, not
          // a passive label. Distinct from the outlined-only
          // notification chips (ProposerFlagsChips,
          // PairedFindingBadge, severity badges) that don't
          // dispatch any action on click.
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

/** Small "pipeline flagged" chip rendered when the proposer-side
 *  deterministic detectors (S2j / S2m) fired on this finding's
 *  factor. Lets the curator know upfront that a structural pattern
 *  was already detected without having to dig through the subtask
 *  trail. Renders nothing when ``flags`` is empty or absent (older
 *  builders or factors the detectors didn't flag). Unknown slugs
 *  are silently skipped so new agent-side detectors can ship
 *  without lockstep UI changes. */
function ProposerFlagsChips({ flags }: { flags?: string[] }) {
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

function DebateBadgeChip({
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
  const configs: Record<string, { label: string; title: string; cls: string }> = {
    platinum: {
      label: "✓ verified",
      title: "debate: human-verified outcome",
      cls: "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    },
    gold: {
      label: "✓ unchallenged",
      title: "debate: no challenger raised an objection — not an evidence-quality signal",
      cls: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    },
    silver: {
      label: "✓ settled",
      title: "debate: settled after one contested round",
      cls: "bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-600/50 dark:border-slate-500 dark:text-slate-200",
    },
    bronze: {
      label: "★ contested",
      title: "debate: settled after multiple contested rounds",
      cls: "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300",
    },
    stuck: {
      label: "!! needs call",
      title: "debate: no consensus — needs human call",
      cls: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
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

/** Quiet status dot replacing the SeverityBadge once the curator has
 *  dispositioned a finding. Once acted on, the finding is no longer
 *  MAJOR / BLOCKER — it's just done. So the whole card fades and the
 *  big severity stamp drops out; a small ✓ / × keeps a visual marker
 *  of what verdict was given (full info in the tooltip). */
function DispositionDot({
  status,
  resolved,
  severity,
}: {
  status: "accepted" | "dismissed" | "needs_more_info";
  resolved: boolean;
  severity: Severity;
}) {
  const cfg =
    status === "accepted"
      ? {
          glyph: "✓",
          title: `${resolved ? "resolved" : "agreed (follow-up owed)"} — was ${severity}`,
        }
      : status === "dismissed"
        ? { glyph: "×", title: `dismissed — was ${severity}` }
        : { glyph: "⋯", title: `parked — was ${severity}` };
  return (
    <span
      className="inline-block text-[11px] leading-none text-slate-500 dark:text-slate-400 mt-0.5 shrink-0"
      title={cfg.title}
      aria-label={cfg.title}
    >
      {cfg.glyph}
    </span>
  );
}

/** UI-side severity override. The agent sometimes ranks
 *  intrinsically-structural changes (removing or adding a whole
 *  factor, partition mismatch) as `minor`; the curator's mental
 *  model treats those as major. Bump them up here so the badge
 *  reads correctly even when the wire severity drifts. */
function displaySeverity(finding: AuditFinding): Severity {
  const code = finding.issue_code;
  const structural =
    code === "calibration_factor_gold_only_miss" ||
    code === "calibration_factor_extra" ||
    code === "calibration_factor_partition_mismatch";
  if (structural && finding.severity === "minor") return "major";
  return finding.severity;
}

function SeverityBadge({
  severity,
  glyph,
}: {
  severity: Severity;
  /** When supplied, the badge renders THIS glyph (e.g. +/−/Δ for
   *  add / remove / modify actions) instead of the default
   *  severity icon. The color still encodes severity; the glyph
   *  encodes the action. Per Paul 2026-05-21: "the orange square
   *  should have the +/−/Δ". */
  glyph?: string | null;
}) {
  const config = {
    blocker: {
      icon: "⛔",
      cls: "bg-rose-600 text-white border border-rose-700",
      label: "blocker",
    },
    major: {
      icon: "⚠",
      cls: "bg-amber-500 text-amber-950 border border-amber-600",
      label: "major",
    },
    minor: {
      icon: "·",
      cls: "bg-transparent text-slate-500 border border-slate-300 dark:text-slate-400 dark:border-slate-600",
      label: "minor",
    },
    ok: {
      icon: "✓",
      cls: "bg-emerald-600 text-white border border-emerald-700",
      label: "ok",
    },
  }[severity];
  return (
    <StatusBadge
      glyph={glyph || config.icon}
      cls={config.cls}
      label={`severity: ${config.label}`}
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
 *                 legacy ``calibration_factor_match`` at ok severity
 *                 and the tag-side ``calibration_match``)
 *
 *  Returns null when the finding isn't a match code — the caller
 *  falls back to ``SeverityBadge`` for non-match findings. */
function MatchBadge({ finding }: { finding: AuditFinding }) {
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
 *  for screen-readers and accessibility. Per Paul 2026-05-21.
 *
 *  Strength source mirrors AgentSuggestionPanel: prefer the
 *  explicit ``defender_verdict.strength`` when present (newer
 *  payloads); fall back to deriving from ``verdict`` via
 *  ``verdictStrength()`` for backward compat. */
function JudgeStrengthGlyph({ finding }: { finding: AuditFinding }) {
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
        className={cn("inline-block mr-1 text-[12px] leading-none", config.cls)}
        aria-label={config.label}
      >
        {config.glyph}
      </span>
    </Tooltip>
  );
}

function severityTextCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "text-rose-700";
    case "major":
      return "text-amber-700";
    case "minor":
      return "text-slate-600";
    case "ok":
      return "text-emerald-700";
  }
}

function severityRowCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "border-rose-200";
    case "major":
      return "border-amber-200";
    case "minor":
      return "";
    case "ok":
      return "border-emerald-200";
  }
}

// agent palette extracted to ``@/lib/agentPalette`` so the proposal
// panel renders the same model with the same tint as the audit panel.

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Build a synthetic AuditReport whose target_ids slug-match real
 *  elements in the loaded design. Picks a few plausible (or
 *  intentionally wrong) findings so the inline severity dots have
 *  something to attach to during development.
 *
 *  Picks (in order, falls through if missing):
 *  - Experiment-wide blocker (always)
 *  - First factor → forbidden_efc major
 *  - First FV of first factor → missing_baseline major
 *  - Second FV (if any) → ok
 *  - First tag → ungrounded_term minor
 *  - First biomaterial → low_confidence_assignment major
 *
 *  Produces a report with a coherent summary roll-up. Removed once
 *  the live `useAuditForExperiment` hook lands. */
function synthesizeFromDraft(draft: Design): AuditReport {
  const findings: AuditFinding[] = [];
  const now = new Date().toISOString();

  findings.push({
    target_kind: "experiment",
    target_id: experimentTarget(draft.experiment_id),
    severity: "blocker",
    issue_code: "synth_demo_only",
    rationale:
      "Demo finding — wired to the experiment shell. Real audits won't emit this issue_code.",
    citation: "(synthetic)",
    citation_url: "",
    suggested_fix: "n/a — this is a UI demo",
    proposer_suggestion: "",
  });

  const f0 = draft.factors[0];
  if (f0) {
    // Mirror the dot anchor expressions exactly — see FactorList +
    // FactorValueCard. Both sides slug `category.label || ""`; if
    // they drift, target_ids stop matching and dots silently miss.
    const factorCatLabel = f0.category?.label || "";
    findings.push({
      target_kind: "factor",
      target_id: factorTarget(factorCatLabel),
      severity: "major",
      issue_code: "forbidden_efc",
      rationale: `Demo: factor "${f0.name || f0.category?.label}" flagged as a forbidden EFC category.`,
      citation: "Curation-Rules §Forbidden EFC categories",
      citation_url: "",
      suggested_fix:
        "Replace with a 'treatment' factor whose FV statements carry the dose as a 'has_dose' predicate.",
      proposer_suggestion: "",
    });

    const fv0 = f0.factor_values[0];
    if (fv0) {
      findings.push({
        target_kind: "fv",
        target_id: fvTarget(factorCatLabel, fv0.free_text_label || ""),
        severity: "major",
        issue_code: "missing_baseline",
        rationale: `Demo: factor "${f0.name || f0.category?.label}" has no FV marked as baseline.`,
        citation: "Curation-Rules §Baseline picks",
        citation_url: "",
        suggested_fix: `Mark "${fv0.free_text_label || "this FV"}" as baseline.`,
        proposer_suggestion: "",
      });
    }

    const fv1 = f0.factor_values[1];
    if (fv1) {
      findings.push({
        target_kind: "fv",
        target_id: fvTarget(factorCatLabel, fv1.free_text_label || ""),
        severity: "ok",
        issue_code: "ok",
        rationale: `Demo: FV "${fv1.free_text_label || ""}" looks correctly grounded.`,
        citation: "",
        citation_url: "",
        suggested_fix: "",
        proposer_suggestion: "",
      });
    }
  }

  const t0 = draft.tags?.[0];
  if (t0) {
    findings.push({
      target_kind: "tag",
      target_id: tagTarget(t0.category.label, t0.value.label),
      severity: "minor",
      issue_code: "ungrounded_term",
      rationale: `Demo: tag "${t0.category.label}: ${t0.value.label}" is missing an ontology URI on the value side.`,
      citation: "Curation-Rules §Ontology grounding",
      citation_url: "",
      suggested_fix: "Resolve to an ontology term.",
      proposer_suggestion: "",
    });
  }

  const bm0 = draft.biomaterials[0];
  if (bm0) {
    findings.push({
      target_kind: "assignment",
      target_id: assignmentTarget(bm0.short_name),
      severity: "major",
      issue_code: "low_confidence_assignment",
      rationale: `Demo: sample ${bm0.short_name} flagged as a low-confidence assignment.`,
      citation: "Curation-Rules §Sample assignment provenance",
      citation_url: "",
      suggested_fix: "Reconsider this sample's FV assignment.",
      proposer_suggestion: "",
    });
  }

  const counts = countSeverities(findings);
  return {
    audit_id: `synth-${draft.experiment_id}`,
    experiment_id: draft.experiment_id,
    experiment_short_name: draft.experiment_short_name || `experiment ${draft.experiment_id}`,
    audited_at: now,
    model: "(synthetic)",
    scope: { include: ["factors", "fvs", "tags", "assignments"] },
    findings,
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      comparison_proposal: null,
    },
    summary: {
      ...counts,
      overall_verdict: deriveVerdict(counts),
    },
    dispositions: [],
  };
}

function countSeverities(findings: AuditFinding[]) {
  let n_blocker = 0;
  let n_major = 0;
  let n_minor = 0;
  let n_ok = 0;
  for (const f of findings) {
    if (f.severity === "blocker") n_blocker++;
    else if (f.severity === "major") n_major++;
    else if (f.severity === "minor") n_minor++;
    else if (f.severity === "ok") n_ok++;
  }
  return { n_blocker, n_major, n_minor, n_ok };
}

function deriveVerdict(c: {
  n_blocker: number;
  n_major: number;
  n_minor: number;
}): AuditReport["summary"]["overall_verdict"] {
  if (c.n_blocker > 0) return "blockers";
  if (c.n_major > 0) return "major_issues";
  if (c.n_minor > 0) return "minor_issues";
  return "clean";
}

/** Adapt the bundled fixture (which targets a specific experiment id
 *  and pre-Step-3 numeric `target_id`s) to whatever experiment the
 *  curator is currently looking at. Lets the dev "Load fixture
 *  audit" button work on any open experiment without pretending the
 *  audit was actually run against it.
 *
 *  Normalises: experiment_id, dispositions=[]. Does NOT rewrite
 *  target_ids — the inline dots won't resolve against the fixture's
 *  hardcoded ids; that's expected for fixture mode. The brother's
 *  next regen will use the slug format and dots will light up
 *  automatically. */
function adaptFixture(experimentId: number | string): AuditReport {
  const raw = sampleReport as unknown as AuditReport;
  return {
    ...raw,
    experiment_id: experimentId,
    dispositions: raw.dispositions ?? [],
  };
}
