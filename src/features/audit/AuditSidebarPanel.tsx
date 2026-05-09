import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useAuditStream } from "@/api/auditStream";
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
import { DismissDialog } from "./DismissDialog";
import { markFirstSeen, consumeFirstSeen } from "./firstSeen";
import type { DismissReason } from "@/api/auditTypes";
import { AuditTriggerDialog } from "./AuditTriggerDialog";
import type {
  AuditFinding,
  AuditReport,
  AuditRequest,
  AuditTargetKind,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

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
}: {
  experimentId: number;
}) {
  const { report, setOverrideReport, hasOverride, loading, error } =
    useAudit();
  const { draft } = useDesignDraft();
  const stream = useAuditStream(experimentId);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Auto-close the dialog once the SSE stream takes over — the
  // progress panel below replaces it as the in-flight surface.
  useEffect(() => {
    if (stream.status === "running") setDialogOpen(false);
  }, [stream.status]);

  // Pick the accession the agent service expects. Numeric experiment_id
  // works (the resolver accepts numeric id, GSE accession, or shortName
  // interchangeably — same as /propose).
  const accession = draft?.experiment_short_name || String(experimentId);

  function runAudit(req: AuditRequest) {
    stream.start(accession, req);
  }

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
    <div className="space-y-2">
      <SidebarTopBar
        accession={accession}
        loading={loading}
        running={stream.status === "running"}
        onRunAudit={() => setDialogOpen(true)}
      />
      {showProgress ? (
        <ProposeProgressPanel
          state={stream}
          idleLabel="no audit running"
          onDismiss={stream.reset}
        />
      ) : null}
      {!blockBodyForProgress ? (
        loading && !report ? (
          <div className="card p-3 text-xs text-slate-500 italic">
            loading audits…
          </div>
        ) : error && !report ? (
          <div className="card p-3 text-xs text-rose-700">
            couldn't load audits: {error}
          </div>
        ) : !report ? (
          <EmptyState
            onLoadFixture={() => setOverrideReport(adaptFixture(experimentId))}
            onSynthesize={
              draft
                ? () => setOverrideReport(synthesizeFromDraft(draft))
                : undefined
            }
          />
        ) : (
          <>
            <SidebarHeader
              report={report}
              hasOverride={hasOverride}
              onClearOverride={
                hasOverride ? () => setOverrideReport(null) : undefined
              }
            />
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
          </>
        )
      ) : null}
      <AuditTriggerDialog
        experimentShortName={accession}
        open={dialogOpen}
        busy={stream.status === "running"}
        onCancel={() => setDialogOpen(false)}
        onSubmit={(req) => runAudit(req)}
      />
    </div>
  );
}

/** Tiny header card that sits above the audit content and exposes
 *  the "Run audit" trigger. Always visible (independent of whether
 *  there's a report loaded) so the curator can re-audit anytime. */
function SidebarTopBar({
  accession,
  loading,
  running,
  onRunAudit,
}: {
  accession: string;
  loading: boolean;
  running: boolean;
  onRunAudit: () => void;
}) {
  return (
    <div className="card px-2 py-1.5 flex items-center gap-2 text-xs">
      <span className="text-slate-500 truncate">
        Audit{" "}
        <span className="font-mono text-slate-700">{accession}</span>
      </span>
      <button
        type="button"
        onClick={onRunAudit}
        disabled={running || loading}
        title={
          running
            ? "an audit is already running — watch the progress panel below"
            : "configure scope + tier and run an audit against the existing curation"
        }
        className={cn(
          "ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium",
          running || loading
            ? "bg-slate-200 text-slate-500 cursor-progress"
            : "bg-blue-700 text-white hover:bg-blue-800",
        )}
      >
        {running ? "running…" : "+ audit"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onLoadFixture,
  onSynthesize,
}: {
  onLoadFixture: () => void;
  /** Optional — only available when a design draft is loaded.
   *  Builds a synthetic report whose target_ids slug-match real
   *  factors / FVs / tags / biomaterials in the current design,
   *  so the inline severity dots actually appear. The static
   *  fixture's hardcoded numeric ids don't resolve. */
  onSynthesize?: () => void;
}) {
  return (
    <div className="card p-3 text-xs text-slate-500 space-y-2">
      <p className="italic">
        No audits on this experiment yet. The mock-API GET / PATCH
        endpoints are live; the in-UI trigger button (which would
        POST to the agent's <code>/audit/{"{accession}"}</code>)
        lands once that service ships.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLoadFixture}
          className="px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] font-medium"
          title="Load the bundled sample audit so the sidebar layout is testable in-context. Inline dots won't appear — the fixture's target_ids don't match this experiment."
        >
          Load fixture audit (dev)
        </button>
        {onSynthesize ? (
          <button
            type="button"
            onClick={onSynthesize}
            className="px-2 py-1 rounded bg-violet-100 text-violet-800 hover:bg-violet-200 text-[11px] font-medium"
            title="Build a synthetic audit whose target_ids match this experiment's actual factors / FVs / tags / first sample, so inline severity dots appear in the design + samples views."
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
    isFinalized,
    finalizedAt,
    finalizedBy,
    finalize,
    reopen,
    finalizeSaving,
    reopenSaving,
  } = useAudit();
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
      await finalize(notes || undefined);
      toast.show("Audit closed.", "success");
      setConfirmClose(false);
    } catch (err) {
      toast.show(
        `Couldn't close audit: ${(err as Error).message}`,
        "danger",
        6000,
      );
    }
  }

  async function handleReopen() {
    try {
      await reopen();
      toast.show("Audit reopened — dispositions editable again.", "success");
    } catch (err) {
      toast.show(
        `Couldn't reopen audit: ${(err as Error).message}`,
        "danger",
        6000,
      );
    }
  }

  return (
    <div
      className={cn(
        "card p-2 text-xs space-y-1.5",
        isFinalized && "border-slate-300 bg-slate-50",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <VerdictPill verdict={summary.overall_verdict} />
        {hasOverride ? (
          <span
            className="inline-block text-[9px] uppercase tracking-wide font-bold px-1 py-0 rounded bg-violet-200 text-violet-900"
            title="this report is a dev override (synthesized or fixture-loaded), not the live audit"
          >
            dev
          </span>
        ) : null}
        {isFinalized ? (
          <span
            className="inline-block text-[9px] uppercase tracking-wide font-bold px-1 py-0 rounded bg-slate-700 text-white"
            title={`closed${finalizedBy ? ` by ${finalizedBy}` : ""}${
              finalizedAt ? ` at ${finalizedAt}` : ""
            } — disposition controls are read-only until reopened`}
          >
            closed
          </span>
        ) : null}
        <span className="text-[10px] text-slate-500">
          {report.audited_at ? formatShort(report.audited_at) : "—"}
        </span>
        {report.model ? (
          <span
            className="text-[10px] text-slate-700 font-mono px-1 py-0 rounded bg-slate-100 border border-slate-200 truncate max-w-[10rem]"
            title={`audit ran with model: ${report.model}`}
          >
            {report.model}
          </span>
        ) : null}
        {onClearOverride ? (
          <button
            type="button"
            onClick={onClearOverride}
            title="drop the dev override and fall back to the live audit (if any)"
            className="ml-auto text-[10px] text-slate-400 hover:text-rose-700 underline-offset-2 hover:underline"
          >
            drop override
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityCount label="blocker" count={summary.n_blocker} severity="blocker" />
        <SeverityCount label="major" count={summary.n_major} severity="major" />
        <SeverityCount label="minor" count={summary.n_minor} severity="minor" />
        <SeverityCount label="ok" count={summary.n_ok} severity="ok" />
      </div>
      <div className="text-[10px] text-slate-500">
        scope:{" "}
        <span className="font-mono">
          {scope.include.join(" / ") || "—"}
        </span>
      </div>
      {isFinalized ? (
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-200">
          <span className="text-[10px] text-slate-600">
            Closed{finalizedBy ? <> by <span className="font-mono">{finalizedBy}</span></> : null}
            {finalizedAt ? <> · {formatShort(finalizedAt)}</> : null}
          </span>
          {lifecycleAvailable ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={reopenSaving}
              title="reopen this audit so dispositions can be edited again"
              className={cn(
                "ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium",
                reopenSaving
                  ? "bg-slate-200 text-slate-500 cursor-progress"
                  : "bg-slate-200 text-slate-800 hover:bg-slate-300",
              )}
            >
              {reopenSaving ? "reopening…" : "Reopen"}
            </button>
          ) : null}
        </div>
      ) : lifecycleAvailable ? (
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
          {pendingActionable > 0 ? (
            <span
              className="text-[10px] text-amber-700"
              title="closing now records every still-pending finding as undecided in the dispositions log; consider dispositioning them first"
            >
              {pendingActionable} pending
            </span>
          ) : (
            <span className="text-[10px] text-emerald-700">all triaged</span>
          )}
          <button
            type="button"
            onClick={() => setConfirmClose(true)}
            disabled={finalizeSaving}
            title={
              pendingActionable > 0
                ? "close audit (you'll confirm — pending findings stay pending in the log)"
                : "close audit; the agent side aggregates only closed audits"
            }
            className={cn(
              "ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium",
              finalizeSaving
                ? "bg-blue-200 text-blue-700 cursor-progress"
                : "bg-blue-700 text-white hover:bg-blue-800",
            )}
          >
            {finalizeSaving ? "closing…" : "Close audit"}
          </button>
        </div>
      ) : null}
      {confirmClose ? (
        <CloseAuditConfirm
          pendingActionable={pendingActionable}
          saving={finalizeSaving}
          onCancel={() => setConfirmClose(false)}
          onConfirm={handleClose}
        />
      ) : null}
    </div>
  );
}

/** Inline confirm popover for "Close audit". Optional notes go to
 *  the audit_events row server-side. Keeps the affordance compact —
 *  the audit lifecycle isn't destructive (Reopen restores it), so a
 *  full ConfirmModal would over-weight the action. */
function CloseAuditConfirm({
  pendingActionable,
  saving,
  onCancel,
  onConfirm,
}: {
  pendingActionable: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
}) {
  const [notes, setNotes] = useState("");
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
        Close this audit?{" "}
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
          {saving ? "closing…" : "Close audit"}
        </button>
      </div>
    </div>
  );
}

function VerdictPill({
  verdict,
}: {
  verdict: AuditReport["summary"]["overall_verdict"];
}) {
  const cls = {
    clean: "bg-emerald-100 text-emerald-900 border-emerald-300",
    minor_issues: "bg-slate-100 text-slate-700 border-slate-300",
    major_issues: "bg-amber-100 text-amber-900 border-amber-300",
    blockers: "bg-rose-100 text-rose-900 border-rose-300",
  }[verdict];
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
      title={`overall verdict: ${verdict}`}
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

const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
};

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
        <span aria-hidden className="text-slate-400">
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

  const actionable = sorted.filter((f) => f.severity !== "ok");
  const okOnes = sorted.filter((f) => f.severity === "ok");
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
  const suppressedTotal = suppressedActionable.length + suppressedOk.length;
  const [showOk, setShowOk] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);

  if (findings.length === 0) {
    return (
      <div className="card p-2 text-[11px] text-slate-500 italic">
        No findings — nothing to flag against this scope.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {visibleActionable.map((f) => (
        <CompactFindingCard
          key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
          finding={f}
        />
      ))}
      {suppressedTotal > 0 ? (
        <>
          <button
            type="button"
            className="w-full text-left text-[11px] px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded"
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

function CompactFindingCard({ finding }: { finding: AuditFinding }) {
  const [open, setOpen] = useState(false);

  // Disposition state comes from context (server-authoritative for
  // live reports; in-memory for dev override). The card reads to
  // tint dismissed findings; the action row inside it does the
  // writes.
  const {
    activeFindingKey,
    setActiveFindingKey,
    dispositionByTarget,
  } = useAudit();
  const currentDisposition =
    dispositionByTarget.get(finding.target_id)?.status ?? "pending";

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

  return (
    <div
      ref={cardRef}
      className={cn(
        "card p-2 text-xs space-y-1.5",
        severityRowCls(finding.severity),
        currentDisposition === "dismissed" && "opacity-60",
        activeFindingKey === myKey && "ring-2 ring-blue-400",
      )}
    >
      <button
        type="button"
        className="w-full text-left flex items-start gap-1.5"
        onClick={() => setOpen((v) => !v)}
        title={open ? "collapse" : "expand"}
      >
        <SeverityBadge severity={finding.severity} />
        <span className="flex-1 min-w-0">
          <span className="font-mono text-[10px] text-slate-600 mr-1">
            {TARGET_KIND_LABEL[finding.target_kind]}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {finding.issue_code}
          </span>
          <span
            className={cn(
              "block text-[11px] text-slate-700",
              open ? "" : "line-clamp-2",
            )}
          >
            {trimRationaleBoilerplate(finding.rationale)}
          </span>
        </span>
        <span
          aria-hidden
          className="text-slate-400 text-[10px] mt-0.5"
        >
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="space-y-1.5 pl-1 border-l-2 border-slate-200">
          <div className="text-[10px] text-slate-500 font-mono pl-1.5">
            {finding.target_id}
          </div>

          {finding.citation || finding.citation_url ? (
            <div className="text-[10px] text-slate-500 pl-1.5">
              §{" "}
              {finding.citation_url ? (
                <a
                  href={finding.citation_url}
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

          {finding.suggested_fix ? (
            <div className="rounded border border-blue-200 bg-blue-50/60 px-1.5 py-1 text-[11px] mx-1.5">
              <span className="text-[9px] uppercase tracking-wide font-semibold text-blue-900 block mb-0.5">
                suggested fix
              </span>
              <span className="text-blue-900">{finding.suggested_fix}</span>
            </div>
          ) : null}

          <ProposerSuggestionPanel finding={finding} />

          <FindingActionRow finding={finding} />
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
  // The DismissDialog portals out of the sidebar's overflow context
  // and positions itself relative to this ref's bounding rect.
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);
  const action = resolveApplyAction(finding);
  const disposition = dispositionByTarget.get(finding.target_id);
  const current = disposition?.status ?? "pending";
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

  async function patch(
    status: DispositionStatus,
    extras: {
      notes?: string;
      dismissReason?: DismissReason;
      appliedFix?: string;
      resolvedAt?: string;
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
  async function handleApply() {
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
      applyDraft(action.mutate);
      requestAuditFocus(experimentId, finding.target_id);
      if (action.successMessage) {
        toast.show(action.successMessage, "success");
      }
      // Mutating apply implies accepted+resolved (Ask #6) — the
      // curator just took the structural action the finding asked
      // for, so there's nothing left to "park" until later.
      await patch("accepted", {
        appliedFix: action.appliedFix,
        resolvedAt: new Date().toISOString(),
      });
      return;
    }
    // Focus-only path — no PATCH.
    requestAuditFocus(experimentId, finding.target_id);
  }

  async function handleDismiss(reason: DismissReason, notes: string) {
    await patch("dismissed", { dismissReason: reason, notes });
    setDismissOpen(false);
  }

  return (
    <div className="pl-1.5 space-y-1.5 relative">
      <div className="flex items-center gap-1 flex-wrap">
        {action ? (
          <button
            type="button"
            onClick={handleApply}
            disabled={dispositionSaving}
            title={action.tooltip}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded font-medium",
              action.mutates
                ? // Mutating action also accepts the finding —
                  // keep it visually loud (white-on-blue) so the
                  // curator can see at a glance which findings have
                  // structured fixes vs focus-only navigation.
                  dispositionSaving
                  ? "bg-blue-200 text-blue-700 cursor-progress"
                  : current === "accepted"
                    ? "bg-blue-700 text-white hover:bg-blue-800"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                : // Focus-only action is just navigation; tone it
                  // down so it doesn't compete with the explicit
                  // Accept verb next to it.
                  "bg-slate-100 text-slate-800 hover:bg-slate-200",
            )}
          >
            {action.mutates ? "Apply & focus →" : "Focus →"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            patch(current === "accepted" ? "pending" : "accepted")
          }
          disabled={dispositionSaving}
          title={
            isResolved
              ? "click to undo — flips all the way back to pending (clears resolved_at too)"
              : isParked
                ? finding.severity === "ok"
                  ? "click to undo — flips back to pending"
                  : "click to undo — flips back to pending"
                : finding.severity === "ok"
                  ? "confirm this match (no follow-up needed; click again to undo)"
                  : "agree with this finding (parks it; click 'Mark resolved' later once you've actually addressed it)"
          }
          className={cn(
            "text-[11px] px-2 py-0.5 rounded font-medium disabled:opacity-50",
            isResolved
              ? "bg-emerald-700 text-white hover:bg-emerald-800"
              : isParked
                ? finding.severity === "ok"
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-white border border-blue-600 text-blue-700 hover:bg-blue-50",
          )}
        >
          {isResolved
            ? "✓✓ resolved"
            : isParked
              ? finding.severity === "ok"
                ? "✓ confirmed"
                : "✓ accepted (parked)"
              : finding.severity === "ok"
                ? "Confirm"
                : "Accept"}
        </button>
        {isParked && finding.severity !== "ok" ? (
          <button
            type="button"
            onClick={() =>
              patch("accepted", {
                resolvedAt: new Date().toISOString(),
              })
            }
            disabled={dispositionSaving}
            title="mark this accepted finding resolved — for when you went and fixed the underlying data manually after agreeing with the finding"
            className="text-[11px] px-2 py-0.5 rounded font-medium border border-emerald-700 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50"
          >
            Mark resolved →
          </button>
        ) : null}
        <button
          ref={dismissBtnRef}
          type="button"
          onClick={() => setDismissOpen(true)}
          disabled={dispositionSaving}
          title="dismiss this finding (you'll pick a reason)"
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium disabled:opacity-50",
            current === "dismissed"
              ? "bg-slate-700 text-white"
              : "text-slate-700 hover:bg-slate-100",
          )}
        >
          {current === "dismissed" ? "✓ dismissed" : "Dismiss…"}
        </button>
        <button
          type="button"
          onClick={() =>
            patch(current === "needs_more_info" ? "pending" : "needs_more_info")
          }
          disabled={dispositionSaving}
          title="needs more info — flag for follow-up without taking action"
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium disabled:opacity-50",
            current === "needs_more_info"
              ? "bg-amber-600 text-white"
              : "text-slate-700 hover:bg-slate-100",
          )}
        >
          ?
        </button>
        {current !== "pending" ? (
          <button
            type="button"
            onClick={() => patch("pending")}
            disabled={dispositionSaving}
            className="text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline ml-auto"
            title="reset disposition to pending — useful when you want to revert a dismiss without re-opening the reason picker"
          >
            undo
          </button>
        ) : null}
        {dispositionSaving ? (
          <span className="text-[10px] text-slate-400 italic ml-1">
            saving…
          </span>
        ) : null}
      </div>
      {dismissOpen ? (
        <DismissDialog
          finding={finding}
          anchor={dismissBtnRef.current}
          onCancel={() => setDismissOpen(false)}
          onConfirm={handleDismiss}
        />
      ) : null}
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
 *      small source-label chip (paper / skeleton / sample names /
 *      …). Full sentences come from the agent side.
 *
 *  Hidden entirely when there's nothing to show (no structured
 *  fields AND no legacy string). */
/** Calibration-judge rationales today end with a fixed boilerplate
 *  suffix — "Accept if this is real curation work the agent caught,
 *  dismiss if the agent was wrong." — that adds nothing to the
 *  curator's decision (the disposition buttons already say "Accept"
 *  and "Dismiss…"). Strip it client-side so the rationale stays
 *  focused on the actual claim. Brother knows about this and is
 *  going to tighten the rationales agent-side; this trim is the
 *  bridge until that lands. Conservative match — only strips
 *  when the suffix is recognisable, otherwise returns input
 *  untouched. */
function trimRationaleBoilerplate(s: string): string {
  if (!s) return s;
  // Common variants: starts with " Accept" or "Accept", optional
  // articles, ending in "wrong." or "wrong". Anchor on the
  // "Accept if" / "accept this" pattern + the trailing
  // "dismiss if" so we don't accidentally chop legitimate
  // rationales that contain "accept" mid-sentence.
  const re =
    /\s*(?:^|\.\s+)Accept\s+(?:if|this)\b[^.]*?\bdismiss\s+if\b[^.]*?\.?\s*$/i;
  return s.replace(re, "").trim();
}

function ProposerSuggestionPanel({ finding }: { finding: AuditFinding }) {
  const term = finding.proposer_term;
  const defense = finding.proposer_defense ?? "";
  const evidence = finding.supporting_evidence ?? [];
  const legacyText = finding.proposer_suggestion;
  const hasStructured = !!term || !!defense || evidence.length > 0;
  if (!hasStructured && !legacyText) return null;

  return (
    <div className="rounded border border-violet-200 bg-violet-50/60 px-1.5 py-1.5 text-[11px] mx-1.5 space-y-1.5">
      <div
        className="text-[9px] uppercase tracking-wide font-semibold text-violet-900"
        title="how the silent comparison proposer handled the same target"
      >
        proposer suggestion
      </div>
      {term ? (
        <div>
          <Term uri={term.uri ?? null}>{term.label}</Term>
        </div>
      ) : !hasStructured && legacyText ? (
        // Legacy fallback — no structured term came through, but the
        // older report had a one-line string. Render plain.
        <div className="text-violet-900">{legacyText}</div>
      ) : null}
      {defense ? (
        <div className="text-slate-700 leading-snug">{defense}</div>
      ) : null}
      {evidence.length > 0 ? (
        <div className="space-y-1">
          {evidence.map((ev, i) => (
            <FindingEvidenceBlock key={i} evidence={ev} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One evidence quote — blockquote rendering with a small source chip
 *  on the right. Source vocab matches the agent-side
 *  ``FindingEvidence.source`` literal: paper / skeleton /
 *  sample_names / geo_metadata / characteristic. */
function FindingEvidenceBlock({
  evidence,
}: {
  evidence: NonNullable<AuditFinding["supporting_evidence"]>[number];
}) {
  const sourceLabel: Record<typeof evidence.source, string> = {
    paper: "paper",
    skeleton: "skeleton",
    sample_names: "sample names",
    geo_metadata: "GEO",
    characteristic: "characteristic",
  };
  return (
    <blockquote
      className="border-l-2 border-violet-300 bg-white/60 pl-2 pr-1 py-1 text-slate-700 italic relative"
      title={evidence.location || sourceLabel[evidence.source]}
    >
      <div className="not-italic text-[9px] uppercase tracking-wide text-violet-700/80 mb-0.5 flex items-center justify-between gap-2">
        <span>{sourceLabel[evidence.source]}</span>
        {evidence.location ? (
          <span className="text-slate-500 not-italic font-mono text-[9px] truncate">
            {evidence.location}
          </span>
        ) : null}
      </div>
      <span className="leading-snug">"{evidence.quote}"</span>
    </blockquote>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const cls = {
    blocker: "bg-rose-200 text-rose-900",
    major: "bg-amber-200 text-amber-900",
    minor: "bg-slate-200 text-slate-700",
    ok: "bg-emerald-200 text-emerald-900",
  }[severity];
  return (
    <span
      className={cn(
        "inline-block text-[9px] uppercase tracking-wide font-bold px-1 py-0 rounded mt-0.5 shrink-0",
        cls,
      )}
    >
      {severity[0]}
    </span>
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
      skeleton_excerpt: "",
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
function adaptFixture(experimentId: number): AuditReport {
  const raw = sampleReport as unknown as AuditReport;
  return {
    ...raw,
    experiment_id: experimentId,
    dispositions: raw.dispositions ?? [],
  };
}
