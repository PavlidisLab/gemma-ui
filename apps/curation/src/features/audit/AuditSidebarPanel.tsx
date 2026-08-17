import {
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { agentPalette, isProseModel } from "@/lib/agentPalette";
import { useToast } from "@/components/ui/Toast";
import { JsonViewer } from "@/components/ui/JsonViewer";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  ProposerDetailsDialog,
  hasProposerDetails,
} from "./ProposerDetailsDialog";

import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  ProposeProgressPanel,
  type ProgressPanelState,
} from "@/features/proposal/ProposeProgressPanel";
import { useAudit } from "./AuditContext";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { useStickyState } from "@/lib/useStickyState";
import { resolveApplyAction, type ApplyAction } from "./applyHandlers";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import {
  usePatchTicketTarget,
  usePatchTicket,
  useTicket,
  isSingleTargetTicket,
  ticketIsClosed,
} from "@/api/tickets";
import { parseRoute } from "@/routes";
import { ticketTargetPatchForFinalize } from "./finalizeTicketSync";
import { materializedRecoveryToasts } from "./materializedToast";
import { registerAppliedBatch } from "./appliedBatches";
import {
  BULK_ACCEPT_NOTE,
  IMPLICIT_REJECT_NOTE,
  partitionFvShapedTagFindings,
  severityTextCls,
} from "./auditPresentation";
import { isAgentExtraIssue } from "@/api/auditTypes";
import {
  PanelExpansionContext,
  PanelExpansionCycleButton,
  type PanelExpansion,
} from "./findingCard";
import { FindingList } from "./findingList";
import type {
  AuditFinding,
  AuditReport,
  CurationReviewKind,
  Severity,
} from "@/api/auditTypes";

/** Per-kind framing copy. Centralised here so every user-facing
 *  string the sidebar emits flows through one switch — adding a
 *  third kind (e.g. ``"evaluation"``) is one entry, not a
 *  panel-wide grep. ``noun`` is the bare singular ("audit"),
 *  ``Noun`` the capitalised form for sentence starts, ``verbed``
 *  the past-tense verb the close-toast uses. */

/** Outcome of a {@link SidebarHeader}'s ``handleClose`` attempt —
 *  lets ``CloseAuditConfirm`` distinguish "actually finalized" from
 *  "blocked" so it only clears the curator's typed note on the
 *  former. */
export type CloseOutcome = "closed" | "dirty-draft" | "blocked";

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
    // Relabelled per design review 2026-06-11:
    // "Close audit" read as "close the panel" — curators didn't
    // realise it was the terminal "I'm done reviewing this GSE"
    // milestone. "Finalize review" matches the curator's mental
    // model and pairs with Reopen.
    closeButtonLabel: "Finalize review",
    closeConfirmHeader: "Finalize this review?",
    closedToast: "Review finalized.",
    reopenedToast: "Review reopened — dispositions editable again.",
    idleStreamLabel: "no audit running",
  },
  proposal: {
    noun: "proposal",
    Noun: "Proposal",
    nounPlural: "proposals",
    headerLabel: "Proposal",
    emptyBody: "No proposals on this experiment yet.",
    // Matches the audit-kind "Finalize review" lifecycle pair (design
    // review 2026-06-11). The button is the milestone "I'm
    // done with this proposal as a curation aid"; the agent reads
    // the dispositions from local_api when it next runs, so there's
    // nothing being "submitted to" anyone at click time.
    closeButtonLabel: "Finalize review",
    closeConfirmHeader: "Finalize this review?",
    closedToast: "Review finalized.",
    reopenedToast: "Review reopened — dispositions editable again.",
    idleStreamLabel: "no proposal review running",
  },
};
import { DesignComparisonPanel } from "./AuditReportView";

/**
 * Per-experiment audit findings, rendered into the proposals sidebar
 * slot (surface B of the audit feature's UI integration).
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
   *  This panel just renders the progress / state. Accepts either the
   *  audit or the propose stream (both satisfy ``ProgressPanelState``);
   *  the proposal view is fed the propose stream so its run shows a live
   *  "waiting" state. */
  stream: ProgressPanelState & { reset: () => void };
}) {
  const { kind, report, setOverrideReport, hasOverride, loading, error } =
    useAudit();
  const copy = KIND_COPY[kind];
  const { draft } = useDesignDraft();
  // Panel-level card-expansion baseline. Default = "collapsed"
  // (one-line headers; curator opts into bodies). Persisted per
  // (kind, experimentId) via localStorage so a curator working
  // through 100 GSEs gets their last setting back when they reopen
  // an experiment they've already visited. Design review 2026-06-11: "default
  // to this view (collapsed) — but remember user's last setting for
  // the experiment."
  const [panelExpansion, setPanelExpansion] = useStickyState<PanelExpansion>(
    `audit.panelExpansion.${kind}.${experimentId}`,
    "collapsed",
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
          as one entity-identity color (blue = factor/audit). Per design review
          2026-05-21. */}
      {/* Avoid the ``card`` class here — the global
          ``html.dark .card`` rule in index.css has higher CSS
          specificity than Tailwind's ``dark:bg-…`` utility and
          was forcing slate-800 over the sky tint in dark mode.
          Inline the rounded/border equivalents so the dark
          override doesn't hit. Per design review 2026-05-21. */}
      <div className={cn(
        "px-2 py-1.5 space-y-1.5 rounded-lg border",
        "border-sky-300 bg-sky-50",
        "dark:border-sky-700 dark:bg-sky-900/40",
      )}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <SidebarTopBar
              accession={accession}
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
          <EmptyState kind={kind} />
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
                — there's no curator side, so the panel is omitted. */}
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
  kind,
}: {
  accession: string;
  kind: CurationReviewKind;
}) {
  const copy = KIND_COPY[kind];
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 truncate">
        {copy.headerLabel}{" "}
        <span className="font-mono text-slate-700">{accession}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ kind }: { kind: CurationReviewKind }) {
  // Audit-kind empty state is effectively unreachable now (the sidebar
  // starts on the proposal side for un-curated experiments), so the copy
  // speaks to the common case: nothing proposed yet, run the proposer.
  const isAudit = kind === "audit";
  return (
    <div className="card p-3 text-xs text-slate-500 space-y-1.5">
      <p>
        Nothing proposed yet. Run{" "}
        <span className="font-medium text-slate-700 dark:text-slate-300">
          Propose…
        </span>{" "}
        and the agent will suggest factors and tags for this experiment —
        they&rsquo;ll appear here for you to review.
      </p>
      {isAudit ? (
        <p className="italic">No audit has been run on this experiment.</p>
      ) : null}
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
    experimentId,
    isFinalized,
    finalizedAt,
    finalizedBy,
    finalize,
    reopen,
    resetAllDispositions,
    resetAllDispositionsSaving,
    finalizeSaving,
    reopenSaving,
    setDisposition,
    dispositionByTarget,
    auditList,
    activeAuditIndex,
    setActiveAuditIndex,
  } = useAudit();
  // Review-mode lock — suppresses Apply All (per-finding row actions
  // are gated inside ``ActionRow`` itself; same FlowContext source).
  const readOnly = useIsReadOnly();
  const copy = KIND_COPY[kind];
  const toast = useToast();
  const [confirmClose, setConfirmClose] = useState(false);
  const [applyAllRunning, setApplyAllRunning] = useState(false);
  // "View raw JSON" affordance (design review 2026-06-14) — opens an inline
  // syntax-coloured + searchable tree of the current report's
  // structured payload. Placed in the proposal/audit header strip
  // next to the agent identity pill so it's discoverable without
  // leaving the curation surface.
  const [rawViewerOpen, setRawViewerOpen] = useState(false);
  // "Proposer details" popup (design review 2026-06-30) — surfaces the run
  // provenance baked into the proposal (models / switches / git /
  // invocation) next to the "{ } raw" affordance. Only offered when the
  // proposal actually carries a provenance block.
  const [proposerDetailsOpen, setProposerDetailsOpen] = useState(false);
  const {
    apply: applyDraft,
    draft,
    diff: draftDiff,
    commit: commitDraft,
  } = useDesignDraft();
  // "Commit & close" offer (2026-07) — surfaced when Close is blocked
  // by uncommitted draft edits, replacing the old dead-end toast. The
  // curator's typed close note lives in ``offerCommitAndClose`` so it
  // survives the round trip: closed inline confirm → commit → retry
  // close, instead of being wiped by CloseAuditConfirm's post-confirm
  // cleanup (which now only fires on an actual finalize — see
  // ``handleClose``'s return value).
  const [offerCommitAndClose, setOfferCommitAndClose] = useState<{
    notes: string;
    pendingResolution: "accept" | "reject";
  } | null>(null);
  const [commitAndCloseRunning, setCommitAndCloseRunning] = useState(false);
  // Ticket-target status sync on Finalize — when the curator closes
  // the review for an experiment that lives on a ticket, flip that
  // ticket-target's status to DONE so the popover + dashboard reflect
  // the finished work. Design review 2026-06-11: "this isn't updating … we used
  // to have little circles" — the ticket-member popover was still
  // showing the target as not-yet-started on a finalized experiment.
  // Resolve the ticket-patch decision purely off (experimentId, route)
  // via the ``ticketTargetPatchForFinalize`` helper so the call site
  // can't accidentally lose ``experimentId`` from scope. The helper
  // returns ``null`` when no patch should fire; we still need a
  // numeric ``ticketIdForPatch`` to register ``usePatchTicketTarget``
  // (the hook can't be conditional). Pass 0 when no ticket — the
  // helper guards against that ever turning into a real patch call.
  const parsedRoute = parseRoute();
  const routeTicket =
    parsedRoute.kind === "experiment" ? parsedRoute.ticketContext : undefined;
  const finalizeTicketPatch = ticketTargetPatchForFinalize({
    experimentId,
    ticketContext: routeTicket,
  });
  const patchTicketTarget = usePatchTicketTarget(
    finalizeTicketPatch?.ticketId ?? 0,
  );
  // Single-experiment-ticket convenience: when the curator finalizes
  // the review of an experiment that is the *only* target of its
  // ticket, finishing this review finishes the ticket's whole job.
  // There's no convenient way to resolve such a ticket otherwise (the
  // curator would have to open the ticket detail page), so after a
  // successful finalize we offer to resolve the ticket too. Gated on
  // the ticket being single-target + still open — see handleClose.
  const ticketIdForResolve = finalizeTicketPatch?.ticketId ?? null;
  const resolveTicketQuery = useTicket(ticketIdForResolve);
  const patchTicketState = usePatchTicket(ticketIdForResolve ?? 0);
  const [offerResolveTicket, setOfferResolveTicket] = useState(false);

  // Pending findings warning gating: not a hard gate. Curators may
  // close even with pending non-ok findings, but we surface the
  // count so they can pause if the close was accidental. Server
  // accepts either way. Uses ``dispositionByTarget`` (the
  // newest-wins lookup) rather than ``report.dispositions.find``
  // so multiple-rows-per-target append-only logs read correctly.
  const pendingActionable = report.findings.filter((f) => {
    if (f.severity === "ok") return false;
    const d = dispositionByTarget.get(f.target_id);
    return !d || d.status === "pending";
  }).length;

  // Apply-All set (proposal kind only). Every pending non-ok
  // finding shows up — the button surfaces whenever there's
  // anything to bulk-accept. Two flavors in the handler below:
  //   • finding has a mutating ``ApplyAction`` → chain the
  //     mutator into the shared draft transition
  //   • no clean mutator (most proposal-side codes route through
  //     per-row editor edits) → PATCH the disposition to accepted
  //     but leave the draft alone; the curator can mutate from
  //     the per-row card if needed
  // Either way the disposition log records the bulk-accept.
  const applyAllItems =
    kind === "proposal"
      ? report.findings.filter((f) => {
          if (f.severity === "ok") return false;
          const d = dispositionByTarget.get(f.target_id);
          return !d || d.status === "pending";
        })
      : [];
  const pendingApplyableCount = applyAllItems.length;

  /** Bulk-Agree on every pending finding.
   *
   *  Two paths per finding:
   *    • mutating ``ApplyAction`` available (calibration codes that
   *      resolve to a clean add/remove mutator) → chain the mutator
   *      into one shared applyDraft call and register it in the
   *      appliedBatches tracker so per-finding undo can replay-
   *      others and surgically revert one row;
   *    • no clean mutator (most proposal-side codes route the
   *      curator's "Agree" through per-row editor edits the bulk
   *      path can't faithfully replicate without the editor's
   *      state machine) → PATCH the disposition to accepted but
   *      leave the draft alone.
   *
   *  Disposition PATCH runs for every finding either way — the
   *  disposition log records the bulk-accept across the whole
   *  batch. The curator can fix up non-mutated rows individually
   *  from each card if they want the design to reflect them too. */
  async function handleApplyAll() {
    if (applyAllItems.length === 0) return;
    setApplyAllRunning(true);
    try {
      const annotated = applyAllItems.map((f) => ({
        finding: f,
        action: resolveApplyAction(f, { report, design: draft ?? null }),
      }));
      const mutating = annotated.filter(
        (x): x is { finding: AuditFinding; action: ApplyAction } =>
          !!x.action && x.action.mutates && !!x.action.mutate,
      );
      // If any rows have a clean mutator and the draft is loaded,
      // chain those mutations into one draft transition and
      // register the batch for surgical per-finding undo.
      if (mutating.length > 0 && draft) {
        const snapshot = draft;
        const mutations = mutating.map(({ finding, action }) => ({
          targetId: finding.target_id,
          mutate: action.mutate!,
        }));
        registerAppliedBatch(experimentId, snapshot, mutations);
        applyDraft((d) => {
          let acc = d;
          for (const m of mutations) acc = m.mutate(acc);
          return acc;
        });
        // Focus the first mutating finding's added element so the
        // curator sees what changed. Prefer the action's
        // ``focusTargetId`` (factor-add applies set this to the new
        // factor's target so the design tab opens on its FVs);
        // falls back to the finding's own target_id.
        const head = mutating[0];
        requestAuditFocus(
          experimentId,
          head.action.focusTargetId ?? head.finding.target_id,
        );
      }
      const resolvedAt = new Date().toISOString();
      let mutated = 0;
      let accepted = 0;
      let failed = 0;
      for (const { finding, action } of annotated) {
        const isMutating =
          !!action && action.mutates && !!action.mutate && !!draft;
        // Server requires accept_reason on agent-extra accepts
        // (calibration_agent_extra, agent_extra_*) — see
        // agents-repo schemas.py:_is_agent_extra_issue. Default to
        // ``well_evidenced`` on the bulk path: Apply All says
        // "I trust the agent's batch", and well_evidenced is the
        // canonical "agent's evidence holds up" reason. The
        // per-finding accept dialog stays available for curators
        // who want to record a different reason after the fact
        // (Park → re-Agree with the chip dialog).
        const acceptReason = isAgentExtraIssue(finding.issue_code)
          ? ("well_evidenced" as const)
          : undefined;
        try {
          await setDisposition(finding.target_id, "accepted", {
            appliedFix: action?.appliedFix,
            resolvedAt,
            acceptReason,
          });
          if (isMutating) mutated++;
          else accepted++;
        } catch {
          failed++;
        }
      }
      const parts: string[] = [];
      if (mutated > 0) parts.push(`${mutated} applied`);
      if (accepted > 0) parts.push(`${accepted} accepted`);
      if (failed > 0) parts.push(`${failed} failed`);
      const tone = failed > 0 ? "warn" : "success";
      toast.show(`Apply All — ${parts.join(", ")}.`, tone, 5000);
    } finally {
      setApplyAllRunning(false);
    }
  }

  // Gate lifecycle buttons on a real ``audit_id`` regardless of
  // override state. Two override flavours exist:
  //   - Synth / fixture overrides (``adaptFixture`` /
  //     ``synthesizeFromDraft`` / chip-diff structural synthesis):
  //     ``audit_id`` is null → buttons stay hidden.
  //   - Calibration-audit overrides (chip-strip ``polished vs
  //     agent_proposal`` mounts the REAL ``curation_review`` row via
  //     ``useCalibrationAuditReport``): ``audit_id`` is set → buttons
  //     should work. Per design review 2026-06-11: he couldn't find the
  //     Finalize button on a polished-vs-agent comparison surface
  //     where the override IS the live audit.
  const lifecycleAvailable = !!report.audit_id;

  async function handleClose(
    notes: string,
    pendingResolution: "accept" | "reject" = "reject",
  ): Promise<CloseOutcome> {
    // 409 guard: if the audit is already finalized (refetch lag,
    // double-click, or a stale tab), skip the whole sweep + close
    // and surface a friendly toast instead of letting the sweep
    // PATCHes 409 against the finalized state. Design review 2026-05-25:
    // observed a 409 cascade on a re-close attempt.
    if (report.finalized_at) {
      toast.show(
        `${copy.Noun} is already closed — reopen it to keep editing.`,
        "info",
        4000,
      );
      setConfirmClose(false);
      return "blocked";
    }
    // Dirty-draft guard (continuity sweep 2026-06-13): refuse to
    // finalize when the design draft has uncommitted edits. Apply
    // & focus and similar disposition paths queue draft mutations
    // — if the curator closes the audit without committing, the
    // mutations are stranded (machine restart, tab close, or
    // cross-device handoff loses them). Rather than dead-end on a
    // toast, offer to commit the draft and retry the close in one
    // step — the curator's typed note travels with the offer so it
    // isn't lost (2026-07-27: previously CloseAuditConfirm wiped the
    // note on ANY ``onConfirm`` return, including this blocked path).
    if (draftDiff?.isDirty) {
      setConfirmClose(false);
      setOfferCommitAndClose({ notes, pendingResolution });
      return "dirty-draft";
    }
    return finalizeClose(notes, pendingResolution);
  }

  /** The actual finalize sweep, past both guards above. Split out
   *  so ``handleCommitAndClose`` can call it directly once the
   *  commit it just ran has succeeded — calling back through
   *  ``handleClose`` re-evaluates ``draftDiff.isDirty`` from this
   *  render's closure, which is still the PRE-commit value (the
   *  commit's ``onSettled`` fires before React re-renders this
   *  component with the post-commit draft), so the dirty-draft
   *  guard fired again on every "Commit & close" click — the retry
   *  never converged, and a curator bailing out via "Never mind"
   *  read as the close note vanishing (2026-07-29 bug report). */
  async function finalizeClose(
    notes: string,
    pendingResolution: "accept" | "reject" = "reject",
  ): Promise<CloseOutcome> {
    // Dispositions that never persisted. Every sweep below keeps
    // going on failure — one bad PATCH must not strand a close — but
    // discarding the error made a store outage look exactly like a
    // decision the curator never made. These rows are what
    // ``apply_ticket_disposition_to_gold.py`` reads, so a silently
    // failed disposition becomes a gold edit that silently doesn't
    // happen, and the next scoring run blames the agent for the
    // difference (handoff
    // ``CAB_TO_UI_2026_08_10_IMPLICIT_ACCEPT_WORDING_AND_SWALLOWED_ERRORS``).
    //
    // 409 stays quiet: it means a parallel finalize landed first, the
    // row is settled, and there is nothing for the curator to do.
    const failedDispositions: { targetId: string; error: unknown }[] = [];
    const noteFailure = (targetId: string, error: unknown) => {
      if ((error as { status?: number })?.status === 409) return;
      failedDispositions.push({ targetId, error });
    };
    try {
      // Sweep pending severity=ok findings to "accepted" before
      // finalize. The agent's storage layer dropped the
      // `all_dispositioned` clause from the audit_status rule on
      // 2026-05-13, so on current agent services this sweep is just
      // defensive hygiene; older services still require it. Harmless either
      // way (a few accepted rows on match findings, which IS the
      // right disposition — curator silence on a "no action needed"
      // row is implicit agreement).
      const pendingOk = report.findings.filter((f) => {
        if (f.severity !== "ok") return false;
        const d = dispositionByTarget.get(f.target_id);
        return (d?.status ?? "pending") === "pending";
      });
      for (const f of pendingOk) {
        try {
          await setDisposition(f.target_id, "accepted");
        } catch (e) {
          // Best-effort — don't block close on a single sweep
          // failure. Counted, not discarded.
          noteFailure(f.target_id, e);
        }
      }
      // Proposal-kind only: resolve the pending NON-OK findings
      // per the curator's pick before finalize. ``pendingResolution``
      // is set in the confirm dialog:
      //   - "reject" (default) → dismiss with wont_fix; the
      //     agent reads the silence as "curator declined to act"
      //   - "accept" → apply mutations for the ones with a clean
      //     mutator + PATCH disposition=accepted; for the rest,
      //     PATCH disposition=accepted alone (no draft mutation,
      //     consistent with Apply All's non-mutating branch)
      if (kind === "proposal") {
        const pendingActionableNow = report.findings.filter((f) => {
          if (f.severity === "ok") return false;
          const d = dispositionByTarget.get(f.target_id);
          return (d?.status ?? "pending") === "pending";
        });
        if (pendingResolution === "accept" && pendingActionableNow.length > 0) {
          // Mirror the Apply All path: chain mutating actions into
          // one draft transition + PATCH dispositions to accepted.
          const annotated = pendingActionableNow.map((f) => ({
            finding: f,
            action: resolveApplyAction(f, { report, design: draft ?? null }),
          }));
          const mutating = annotated.filter(
            (x): x is { finding: AuditFinding; action: ApplyAction } =>
              !!x.action && x.action.mutates && !!x.action.mutate,
          );
          if (mutating.length > 0 && draft) {
            const snapshot = draft;
            const mutations = mutating.map(({ finding, action }) => ({
              targetId: finding.target_id,
              mutate: action.mutate!,
            }));
            registerAppliedBatch(experimentId, snapshot, mutations);
            applyDraft((d) => {
              let acc = d;
              for (const m of mutations) acc = m.mutate(acc);
              return acc;
            });
          }
          const resolvedAt = new Date().toISOString();
          for (const { finding, action } of annotated) {
            const acceptReason = isAgentExtraIssue(finding.issue_code)
              ? ("well_evidenced" as const)
              : undefined;
            try {
              await setDisposition(finding.target_id, "accepted", {
                appliedFix: action?.appliedFix,
                resolvedAt,
                acceptReason,
                notes: BULK_ACCEPT_NOTE,
              });
            } catch (e) {
              noteFailure(finding.target_id, e);
            }
          }
        } else {
          for (const f of pendingActionableNow) {
            try {
              await setDisposition(f.target_id, "dismissed", {
                dismissReason: "wont_fix",
                notes: IMPLICIT_REJECT_NOTE,
              });
            } catch (e) {
              noteFailure(f.target_id, e);
            }
          }
        }
      }
      // Log before finalize, so the detail survives even if the
      // finalize itself throws and takes the toast path below.
      if (failedDispositions.length > 0) {
        console.warn(
          "[audit] disposition sweep failures",
          failedDispositions,
        );
      }
      const finalizeResult = await finalize(notes || undefined);
      // Flip the ticket-target status to DONE so the ticket member
      // popover + dashboard reflect this experiment as finished.
      // Best-effort and isolated — the audit itself is already
      // finalized; a failed PATCH here shouldn't undo that, block the
      // success toast, OR surface an error message. The outer
      // try/catch belongs to the finalize call, not this follow-up.
      // ``finalizeTicketPatch`` was resolved at the top of the
      // component via the pure helper, so this site can't accidentally
      // lose ``experimentId`` from scope (the 2026-06-11 regression).
      try {
        if (finalizeTicketPatch) {
          await patchTicketTarget.mutateAsync({
            target_type: finalizeTicketPatch.target_type,
            target_id: finalizeTicketPatch.target_id,
            patch: { status: finalizeTicketPatch.status },
          });
        }
      } catch {
        // Swallowed.
      }
      toast.show(copy.closedToast, "success");
      // A closed review reads as "the record is complete". Say so when
      // it isn't. Separate WARN toast rather than a softened success
      // line, same reasoning as the recovery toasts below: the curator
      // has to know which rows to go back for.
      if (failedDispositions.length > 0) {
        toast.show(
          `${failedDispositions.length} disposition${failedDispositions.length === 1 ? "" : "s"} ` +
            `did not save — reopen the ${copy.noun} to retry.`,
          "warn",
          8000,
        );
      }
      // Surface any accepts the backend safety net had to
      // re-materialize onto the polished design because the UI dropped
      // the apply_action (ordering / reload race). Distinct WARN toast,
      // not folded into the success line — a caught drop means the UI
      // failed to persist something the curator explicitly accepted, and
      // the curator should know it was recovered server-side rather than
      // assume the click always worked. Empty on the healthy path (the
      // field is only populated when the net genuinely caught a drop).
      for (const t of materializedRecoveryToasts(
        finalizeResult?.materialized ?? [],
      )) {
        toast.show(t.message, t.tone, t.durationMs);
      }
      setConfirmClose(false);
      // If this experiment is the sole target of its ticket, finishing
      // this review finishes the ticket — offer to resolve it too so
      // the curator doesn't have to detour to the ticket detail page.
      const tk = resolveTicketQuery.data;
      if (
        ticketIdForResolve &&
        tk &&
        isSingleTargetTicket(tk) &&
        !ticketIsClosed(tk)
      ) {
        setOfferResolveTicket(true);
      }
      return "closed";
    } catch (err) {
      // 409 here means a parallel finalize landed first — same
      // friendly path as the pre-flight guard above.
      const apiErr = err as { status?: number };
      if (apiErr && apiErr.status === 409) {
        toast.show(
          `${copy.Noun} is already closed — reopen it to keep editing.`,
          "info",
          4000,
        );
        setConfirmClose(false);
        return "blocked";
      }
      toast.show(
        `Couldn't close ${copy.noun}: ${(err as Error).message}`,
        "danger",
        6000,
      );
      return "blocked";
    }
  }

  /** Trigger for the "commit & close" offer surfaced when Close hits
   *  the dirty-draft guard above. Commits the draft, then — only on
   *  a clean commit — finalizes with the note the curator already
   *  typed. Calls ``finalizeClose`` directly rather than looping
   *  back through ``handleClose`` — the commit we just ran is proof
   *  the draft is now clean, and re-deriving that from the stale
   *  pre-commit closure is exactly what caused the retry to loop
   *  forever (see ``finalizeClose`` doc comment). */
  function handleCommitAndClose() {
    const pending = offerCommitAndClose;
    if (!pending) return;
    setCommitAndCloseRunning(true);
    commitDraft((result) => {
      setCommitAndCloseRunning(false);
      setOfferCommitAndClose(null);
      if (!result.ok) {
        toast.show(
          `Couldn't commit your design edits: ${result.error} — ${copy.noun} not closed.`,
          "danger",
          7000,
        );
        return;
      }
      void finalizeClose(pending.notes, pending.pendingResolution).then(
        (outcome) => {
          // This path bypasses CloseAuditConfirm's own onConfirm
          // handler, so its post-finalize sticky-note cleanup never
          // runs — do the same cleanup here on an actual close so a
          // stale note doesn't pre-fill the textarea next time.
          if (outcome !== "closed") return;
          try {
            const stickyKey = `closeNote:${kind}:${report.audit_id ?? "noaudit"}`;
            localStorage.removeItem(`${stickyKey}:notes`);
            localStorage.removeItem(`${stickyKey}:resolution`);
          } catch {
            // localStorage unavailable — nothing to clean up.
          }
        },
      );
    });
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
  // For ``kind="proposal"`` the severity axis collapses entirely:
  // proposals aren't broken-ness flags so "6 minor" reads wrong, and
  // the per-finding badges already use the confidence framing
  // (see SeverityBadge's ``confidenceLabel``). Skip the inline counts
  // there; the pending-count chip on the right still carries the
  // load-bearing "how much work is left" signal.
  const nonZeroCounts: { label: string; count: number; severity: Severity }[] =
    kind === "proposal"
      ? []
      : [
          { label: "blocker", count: summary.n_blocker, severity: "blocker" as Severity },
          { label: "major",   count: summary.n_major,   severity: "major"   as Severity },
          { label: "minor",   count: summary.n_minor,   severity: "minor"   as Severity },
          { label: "ok",      count: summary.n_ok,      severity: "ok"      as Severity },
        ].filter((x) => x.count > 0);

  // Scope text. For audits, the report's ``scope.include`` is the
  // curator's deliberate subset (tags-only audit, design-only, etc.)
  // and is the authoritative thing to show. For proposals the wire
  // field can read narrow ("tags") even when the proposer touched
  // factors / FVs / tags / assignments — the proposer always works
  // across the whole surface, the field just isn't load-bearing.
  // Derive from the actual finding ``target_kind`` set so the header
  // tells the truth about what the proposal actually changes.
  const scopeText = (() => {
    if (kind === "proposal") {
      const present = new Set<string>();
      for (const f of report.findings) {
        switch (f.target_kind) {
          case "factor": present.add("factors"); break;
          case "fv": present.add("fvs"); break;
          case "tag": present.add("tags"); break;
          case "assignment": present.add("assignments"); break;
          case "statement": present.add("statements"); break;
          case "experiment": break;
        }
      }
      const ordered = ["factors", "fvs", "tags", "assignments", "statements"]
        .filter((k) => present.has(k));
      return ordered.length ? ordered.join(" / ") : "all";
    }
    return scope.include.join(" / ") || "all";
  })();

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
         *  hybrid-vs-oneshot review, or inter-curator-audit packages
         *  where the same experiment
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
         *  - prose context (``"inter-curator audit · Curator B's curation
         *    applied · Curator A reviews"``) — sans, full-width,
         *    tag-label "review". The agents-side builder writes prose
         *    here for inter-curator audits since "model" stops being
         *    the load-bearing identity for that surface. */}
        {report.model || report.run_provenance?.agent_identity ? (() => {
          const palette = agentPalette(report.model);
          const isProse = isProseModel(report.model);
          // The agent is not the model: name it by its BUILD identity
          // (run_provenance.agent_identity) and demote the LLM to the
          // tooltip. Prose-context rows (inter-curator audits) keep the
          // model-as-context render. Old rows with no build identity
          // fall back to the model, labelled "model" so it doesn't
          // masquerade as the agent.
          const buildId = report.run_provenance?.agent_identity?.trim() || "";
          const prefix = isProse ? "review" : buildId ? "agent" : "model";
          const value = isProse ? report.model : buildId || report.model;
          const when = report.audited_at
            ? ` · ${formatShort(report.audited_at)}`
            : "";
          const title = isProse
            ? `${copy.noun} context: ${report.model}${when}`
            : buildId
              ? `Agent build ${buildId} · ran on ${report.model}${when}`
              : `AI model: ${report.model}${when}`;
          return (
            <span
              className={cn(
                "inline-flex items-baseline gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border",
                isProse ? null : "font-mono",
                palette,
              )}
              title={title}
            >
              <span className="text-[9px] uppercase tracking-wide opacity-70">
                {prefix}
              </span>
              <span className={isProse ? "" : "truncate max-w-[14rem]"}>
                {value}
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
            title={`${copy.Noun} ${activeAuditIndex + 1} of ${auditList.length} on this experiment — ◂ / ▸ to switch between them`}
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
            {/* NAME what is being paged. A bare "2/3" between two
                arrows says a count and nothing else — "it's not clear
                what the navigation does" (Paul, 2026-08-16). The noun
                is the whole answer: these are the proposals / audits
                loaded for this experiment, not pages of the one on
                screen, and only the word distinguishes those. */}
            <span className="tabular-nums text-slate-500 dark:text-slate-400 px-0.5">
              {copy.noun} {activeAuditIndex + 1}/{auditList.length}
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
        {/* Groups are separated by a rule rather than by the "·" that
            used to be glued onto the front of some labels. Everything
            in this row was one flat, evenly-gapped run of ten chips —
            identity, tools, navigation, scope and severity all reading
            as equal siblings, which is why the bare arrows had nothing
            to anchor to. Now: WHO made it and when · WHAT it covers ·
            the provenance tools · the actions. */}
        <GroupRule />

        {/* Scope */}
        <span className="text-slate-400 dark:text-slate-500">
          scope: <span className="font-mono text-slate-500 dark:text-slate-400">{scopeText}</span>
        </span>

        {/* ── Provenance tools ────────────────────────────────────────
            The two "where did this come from" affordances, kept
            together and kept QUIET. They used to sit immediately after
            the agent pill, which put two bordered debug buttons in the
            middle of the identity run — so the row read as an
            undifferentiated string of chips and the eye had nothing to
            group on ("it's not clear what the navigation does", Paul,
            2026-08-16). Identity and coverage read first; the tools
            follow. */}
        <ProvenanceTools
          onRaw={() => setRawViewerOpen(true)}
          onDetails={
            hasProposerDetails(report.run_provenance)
              ? () => setProposerDetailsOpen(true)
              : null
          }
          noun={copy.noun}
        />
        <GroupRule />
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
          {/* Apply All — proposal-only bulk affordance. Chains every
              pending mutating apply into one draft transition and
              stamps each finding's disposition as accepted+resolved.
              Findings without a clean mutator (wrong_fv_partition
              etc.) are skipped — the curator still triages those
              from the per-finding rows. Suppressed in review mode —
              same lock as the per-finding action rows. */}
          {kind === "proposal" && !isFinalized && lifecycleAvailable
            && pendingApplyableCount > 0 && !readOnly ? (
            <button
              type="button"
              onClick={handleApplyAll}
              disabled={applyAllRunning}
              title={`agree on the ${pendingApplyableCount} pending finding${pendingApplyableCount === 1 ? "" : "s"} with a clean fix — chained into one draft change you can review + commit`}
              className={cn(
                "text-[11px] px-2 py-0.5 rounded font-medium border",
                applyAllRunning
                  ? "bg-violet-100 text-violet-600 border-violet-200 cursor-progress dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800"
                  : "bg-violet-600 text-white border-violet-700 hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600 dark:border-violet-800",
              )}
            >
              {applyAllRunning
                ? "Applying…"
                : `Apply All (${pendingApplyableCount})`}
            </button>
          ) : null}
          {isFinalized && finalizedBy ? (
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              by <span className="font-mono">{finalizedBy}</span>
            </span>
          ) : null}
          {lifecycleAvailable ? (
            <button
              type="button"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Reset every disposition on this " +
                      copy.noun +
                      "? Findings stay; status goes back to pending so you can re-disposition. Design draft is NOT reset — discard the draft separately if needed.",
                  )
                ) {
                  return;
                }
                await resetAllDispositions();
                toast.show(
                  "Dispositions cleared. Findings are pending again.",
                  "info",
                );
              }}
              disabled={resetAllDispositionsSaving}
              title={
                "Bulk-clear every disposition on this " +
                copy.noun +
                ". Use when iterating on a calibration/augmentation package."
              }
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                resetAllDispositionsSaving
                  ? "bg-slate-200 text-slate-500 cursor-progress"
                  : "bg-amber-200 text-amber-900 hover:bg-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60",
              )}
            >
              {resetAllDispositionsSaving ? "resetting…" : "Reset all"}
            </button>
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
            // Stable key for sticky persistence — survives navigate-
            // away + tab close. Per-audit so two different audits
            // don't share a draft note; per-kind so audit vs proposal
            // close panes on the same audit_id stay separate. The reviewer
            // 2026-06-14: "if I type here it shouldn't disappear if
            // I navigate away :(". Cleared on successful finalize. */
            stickyKey={`closeNote:${kind}:${report.audit_id ?? "noaudit"}`}
            pendingActionable={pendingActionable}
            pendingFindings={report.findings.filter((f) => {
              if (f.severity === "ok") return false;
              const d = dispositionByTarget.get(f.target_id);
              return !d || d.status === "pending";
            })}
            saving={finalizeSaving}
            initialNotes={report.finalized_notes ?? ""}
            onCancel={() => setConfirmClose(false)}
            onConfirm={handleClose}
          />
        </div>
      ) : null}
      <JsonViewer
        open={rawViewerOpen}
        onClose={() => setRawViewerOpen(false)}
        title={`Raw ${copy.noun.toLowerCase()} payload`}
        subtitle={
          report.model
            ? `${report.model}${report.audited_at ? ` · ${formatShort(report.audited_at)}` : ""}`
            : undefined
        }
        data={report}
      />
      <ProposerDetailsDialog
        open={proposerDetailsOpen}
        onClose={() => setProposerDetailsOpen(false)}
        provenance={report.run_provenance}
      />
      <ConfirmModal
        open={offerResolveTicket}
        destructive={false}
        title={
          ticketIdForResolve
            ? `Close ticket #${ticketIdForResolve}?`
            : "Close ticket?"
        }
        body={
          "Closing this review is the only task on the ticket. Close the ticket as well?"
        }
        confirmLabel="Close ticket"
        cancelLabel="Leave open"
        onCancel={() => setOfferResolveTicket(false)}
        onConfirm={async () => {
          try {
            await patchTicketState.mutateAsync({ state: "RESOLVED" });
            toast.show(`Ticket #${ticketIdForResolve} closed.`, "success");
          } catch (err) {
            toast.show(
              `Couldn't close ticket: ${(err as Error).message}`,
              "danger",
              6000,
            );
          } finally {
            setOfferResolveTicket(false);
          }
        }}
      />
      <ConfirmModal
        open={!!offerCommitAndClose}
        destructive={false}
        title="Uncommitted design changes"
        body={`Your design edits haven't been committed yet — closing this ${copy.noun} now would strand them. Commit your changes and close?`}
        confirmLabel={commitAndCloseRunning ? "committing…" : "Commit & close"}
        cancelLabel="Never mind"
        onCancel={() => {
          // Return to the close-note panel instead of hiding it —
          // the dirty-draft guard that surfaced this offer already
          // set confirmClose=false, so without this the curator's
          // note (still in localStorage, but no longer on screen)
          // read as wiped.
          setOfferCommitAndClose(null);
          setConfirmClose(true);
        }}
        onConfirm={handleCommitAndClose}
      />
    </div>
  );
}

/** One-line label for a pending finding in the submit-confirm
 *  preview. Always prefers a structured ``category: value`` form so
 *  the curator sees "biological sex: male" instead of bare "male"
 *  (the proposer_term.label-only fallback was confusing — the reviewer
 *  2026-05-25). Source priority:
 *
 *    1. structured ``apply_action`` (kind=add_tag) — has both
 *       ``new_category`` and ``new_value`` cleanly separated
 *    2. ``suggested_fix`` backtick — "Add tag `cat: val`."
 *    3. ``proposer_suggestion`` — usually already "cat: val"
 *    4. ``proposer_term.label`` — bare value, last-resort
 *    5. opaque ``target_id`` — last resort
 */
function pendingFindingLabel(f: AuditFinding): string {
  const aa = f.apply_action;
  if (aa && aa.kind === "add_tag") {
    const cat = (aa as Extract<typeof aa, { kind: "add_tag" }>).new_category;
    const val = (aa as Extract<typeof aa, { kind: "add_tag" }>).new_value;
    if (cat && val) return `${cat}: ${val}`;
    if (val) return val;
  }
  if (f.suggested_fix) {
    // "Add tag `category: value`." → "category: value"
    const m = f.suggested_fix.match(/`([^`]+)`/u);
    if (m) return m[1];
  }
  if (f.proposer_suggestion) return f.proposer_suggestion;
  if (f.proposer_term?.label) return f.proposer_term.label;
  if (f.suggested_fix) return f.suggested_fix;
  return f.target_id;
}

/** Inline confirm popover for "Close audit". Optional notes go to
 *  the audit_events row server-side. Keeps the affordance compact —
 *  the audit lifecycle isn't destructive (Reopen restores it), so a
 *  full ConfirmModal would over-weight the action.
 *
 *  Exported (only) so a render test can drive it directly with a
 *  stubbed ``onConfirm`` — the parent ``SidebarHeader`` pulls in
 *  audit/design-draft/ticket contexts this component itself doesn't
 *  need. */
export function CloseAuditConfirm({
  kind,
  stickyKey,
  pendingActionable,
  pendingFindings,
  saving,
  initialNotes = "",
  onCancel,
  onConfirm,
}: {
  kind: CurationReviewKind;
  /** Stable per-audit-per-kind key for the sticky note + pending-
   *  resolution choice. Persists across navigate-away + reload so
   *  the curator's draft note doesn't evaporate the moment they
   *  click off to look something up. Cleared on successful
   *  finalize. */
  stickyKey: string;
  pendingActionable: number;
  /** Full findings list for the pending-actionable bucket — used to
   *  enumerate the "will be considered rejected" preview on
   *  proposal-kind submits. The audit path treats them as
   *  undecided + doesn't enumerate. */
  pendingFindings: AuditFinding[];
  saving: boolean;
  /** Pre-fill the textarea with the prior close note when the
   *  curator reopens an already-closed audit to re-close it.
   *  Empty for a brand-new close. */
  initialNotes?: string;
  onCancel: () => void;
  onConfirm: (
    notes: string,
    pendingResolution: "accept" | "reject",
  ) => Promise<CloseOutcome>;
}) {
  const copy = KIND_COPY[kind];
  const [notes, setNotes] = useStickyState<string>(
    `${stickyKey}:notes`,
    initialNotes,
  );
  // Default to "reject" — matches the prior auto-sweep behaviour
  // and is the safer assumption (silence isn't agreement; an
  // accidental accept costs more to undo than an accidental
  // reject). Only relevant for proposal kind with pending items.
  const [pendingResolution, setPendingResolution] = useStickyState<
    "accept" | "reject"
  >(`${stickyKey}:resolution`, "reject");
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
  const isProposal = kind === "proposal";
  return (
    <div
      ref={ref}
      className="border border-slate-300 rounded bg-white p-2 space-y-2 mt-1"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] text-slate-700 dark:text-slate-200">
        {copy.closeConfirmHeader}{" "}
        {pendingActionable > 0 ? (
          isProposal ? (
            <span className="text-amber-800 dark:text-amber-300">
              {pendingActionable} proposal
              {pendingActionable === 1 ? "" : "s"} still pending — pick
              what to do with them below.
            </span>
          ) : (
            <span className="text-amber-800 dark:text-amber-300">
              {pendingActionable} actionable finding
              {pendingActionable === 1 ? "" : "s"} still pending — they'll
              be recorded as undecided in the disposition log.
            </span>
          )
        ) : (
          <span className="text-slate-500 dark:text-slate-400">
            All actionable findings have a disposition.
          </span>
        )}
      </div>
      {isProposal && pendingFindings.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/15 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-100 space-y-1.5">
          <div className="font-semibold">
            What should happen to the {pendingFindings.length} remaining
            proposal{pendingFindings.length === 1 ? "" : "s"}?
          </div>
          <div className="space-y-1">
            <label className="flex items-start gap-1.5 cursor-pointer hover:text-amber-950 dark:hover:text-amber-50">
              <input
                type="radio"
                name="pending-resolution"
                value="reject"
                checked={pendingResolution === "reject"}
                onChange={() => setPendingResolution("reject")}
                disabled={saving}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">Reject</span> — record
                them as declined. Safer default; the agent reads silence
                as "curator didn't act."
              </span>
            </label>
            <label className="flex items-start gap-1.5 cursor-pointer hover:text-amber-950 dark:hover:text-amber-50">
              <input
                type="radio"
                name="pending-resolution"
                value="accept"
                checked={pendingResolution === "accept"}
                onChange={() => setPendingResolution("accept")}
                disabled={saving}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">Accept</span> — record
                them as agreed and apply any clean mutations to the
                draft (commit separately to save).
              </span>
            </label>
          </div>
          <div className="pt-1 border-t border-amber-200 dark:border-amber-700/40">
            <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
              The {pendingFindings.length} pending:
            </div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto list-disc list-inside">
              {pendingFindings.map((f) => (
                <li
                  key={f.target_id}
                  className="leading-snug truncate"
                  title={f.rationale || f.suggested_fix || ""}
                >
                  {pendingFindingLabel(f)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
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
          onClick={async () => {
            const trimmed = notes.trim();
            const outcome = await onConfirm(trimmed, pendingResolution);
            // Only clear the sticky draft on an ACTUAL finalize
            // (2026-07-27 fix). Blocked outcomes — already-finalized
            // 409, or the dirty-draft guard (which now hands off to
            // the commit-and-close offer instead) — used to hit this
            // same cleanup unconditionally, silently wiping the note
            // the curator just typed even though nothing closed. On
            // "closed" the next fresh review of this audit should
            // start with an empty textarea, not the just-submitted
            // note; on any blocked outcome (or cancel) we leave the
            // draft note alone so it's still there if they reopen.
            if (outcome !== "closed") return;
            try {
              localStorage.removeItem(`${stickyKey}:notes`);
              localStorage.removeItem(`${stickyKey}:resolution`);
            } catch {
              // localStorage unavailable — leave the sticky value
              // in place; setNotes("") below resets the in-memory
              // state for any subsequent reuse.
            }
            setNotes("");
            setPendingResolution("reject");
          }}
          disabled={saving}
          className={cn(
            "text-[11px] px-2 py-0.5 rounded font-medium",
            saving
              ? "bg-blue-200 text-blue-700 cursor-progress"
              : "bg-blue-700 text-white hover:bg-blue-800",
          )}
        >
          {saving
            ? "closing…"
            : isProposal && pendingFindings.length > 0
              ? pendingResolution === "accept"
                ? `Close + accept remaining ${pendingFindings.length}`
                : `Close + reject remaining ${pendingFindings.length}`
              : copy.closeButtonLabel}
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

/** Hairline between groups in the header strip. Carries the grouping
 *  that ten evenly-spaced chips could not. */
function GroupRule() {
  return (
    <span
      aria-hidden
      className="inline-block w-px h-3 bg-slate-200 dark:bg-slate-700 mx-0.5"
    />
  );
}

/**
 * The "where did this come from" pair: raw JSON, and the run details.
 *
 * 🛑 **The absence is stated, not hidden.** `proposer details` used to
 * render only when a provenance block existed and otherwise vanish
 * without trace, which reads as a feature that broke ("what happened to
 * the agent details?", Paul, 2026-08-16). It hadn't — the rows on
 * screen were `adhoc-decision-ticket` proposals, which are hand-filed
 * decision tickets rather than agent runs and never carried provenance
 * to begin with. A control that disappears cannot say that; a disabled
 * one can, so the slot stays and explains itself.
 */
function ProvenanceTools({
  onRaw,
  onDetails,
  noun,
}: {
  onRaw: () => void;
  /** ``null`` when this row carries no run provenance. */
  onDetails: (() => void) | null;
  noun: string;
}) {
  const base =
    "text-[10px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onRaw}
        className={`${base} font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}
        title={`View the raw JSON for this ${noun} — searchable, collapsible tree.`}
      >
        {"{ }"} raw
      </button>
      {onDetails ? (
        <button
          type="button"
          onClick={onDetails}
          className={`${base} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}
          title={`Run details — the models, switches, git sha, and full invocation that produced this ${noun}.`}
        >
          run details
        </button>
      ) : (
        <span
          className={`${base} text-slate-400 dark:text-slate-500 italic cursor-help`}
          title={`This ${noun} carries no run provenance — no models, switches or git sha were recorded against it. Hand-filed decision tickets and rows created before the agent stamped its identity look like this; it is not a missing feature.`}
        >
          no run details
        </span>
      )}
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
  const { kind } = useAudit();
  const { draft, saved } = useDesignDraft();
  const [open, setOpen] = useState(false);
  // Count what expanding actually shows. FindingList hides tag-shaped
  // findings whose (category, value) pair is a factor value in the
  // design, so counting the raw list promised a card that never
  // renders — "2 findings — 2 proposals" over a single visible one.
  const { visible: findingsShown } = partitionFvShapedTagFindings(
    findings,
    draft ?? saved,
  );
  let nBlocker = 0;
  let nMajor = 0;
  let nMinor = 0;
  let nOk = 0;
  for (const f of findingsShown) {
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
          {findingsShown.length} finding
          {findingsShown.length === 1 ? "" : "s"}
          {actionable > 0 ? (
            kind === "proposal" ? (
              <>
                {" "}— {actionable} proposal
                {actionable === 1 ? "" : "s"}
                {nOk > 0 ? (
                  <>
                    {", "}
                    <span className="text-emerald-700">{nOk} noted</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {" "}— {nBlocker > 0 ? `${nBlocker} blocker, ` : ""}
                {nMajor > 0 ? `${nMajor} major, ` : ""}
                {nMinor > 0 ? `${nMinor} minor, ` : ""}
                <span className="text-emerald-700">{nOk} ok</span>
              </>
            )
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
