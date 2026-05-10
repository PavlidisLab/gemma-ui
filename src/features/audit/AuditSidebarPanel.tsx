import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import { StatementGlyph } from "@/components/ui/StatementGlyph";
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
  AttachedDefenderVerdict,
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
  const disposition = dispositionByTarget.get(finding.target_id);
  const currentDisposition = disposition?.status ?? "pending";
  // The finding is "closed" once the curator has acted on it and
  // there's nothing left to resolve — dismissed counts (already a
  // terminal verdict), and accepted+resolved counts (the curator
  // agreed AND took the structural action). Parked-accepted is
  // intentionally NOT closed since the curator still owes a
  // follow-up. The card greys out when closed so the eye skips
  // past finished work; undo still lives in the action row so
  // mistakes are reversible.
  // Closed = curator has decided. As of 2026-05-10, needs_more_info
  // counts too — the new "Park…" flow requires a structured reason
  // before setting that status, so it's no longer an open question.
  const isClosed =
    currentDisposition === "dismissed" ||
    currentDisposition === "needs_more_info" ||
    (currentDisposition === "accepted" && !!disposition?.resolved_at);

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
        isClosed && "opacity-60",
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
          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 mr-1">
            {TARGET_KIND_LABEL[finding.target_kind]}
          </span>
          <IssueCodeBadge issueCode={finding.issue_code} />
          <span
            className={cn(
              "block text-[11px] text-slate-700 dark:text-slate-200",
              open ? "" : "line-clamp-2",
            )}
          >
            {trimRationaleBoilerplate(finding.rationale)}
          </span>
        </span>
        <span
          aria-hidden
          className="text-slate-400 dark:text-slate-500 text-[10px] mt-0.5"
        >
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
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
            <div className="rounded border border-blue-200 bg-blue-50/60 px-1.5 py-1 text-[11px] mx-1.5 dark:border-blue-700/60 dark:bg-blue-900/20">
              <span className="text-[9px] uppercase tracking-wide font-semibold text-blue-900 dark:text-blue-300 block mb-0.5">
                suggested fix
              </span>
              <span className="text-blue-900 dark:text-blue-200">
                {shortFixForVerdict(finding.defender_verdict) ??
                  finding.suggested_fix}
              </span>
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
  // Two new dialogs for the unified reason flow (2026-05-10): accept
  // (curator agrees with an agent-extra suggestion) and not-sure
  // (curator parks the finding with a documented reason). Same
  // anchor-positioned popover as dismiss, different reason chips.
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [notSureOpen, setNotSureOpen] = useState(false);
  // The DismissDialog portals out of the sidebar's overflow context
  // and positions itself relative to these refs' bounding rects —
  // one ref per dialog-trigger button.
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);
  const acceptBtnRef = useRef<HTMLButtonElement | null>(null);
  const notSureBtnRef = useRef<HTMLButtonElement | null>(null);
  const action = resolveApplyAction(finding);
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
      acceptReason?: import("@/api/auditTypes").AcceptReason;
      notSureReason?: import("@/api/auditTypes").NotSureReason;
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
  async function handleApply(extras?: {
    acceptReason?: import("@/api/auditTypes").AcceptReason;
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

  async function handleDismissConfirm(reasonKey: string, notes: string) {
    // Wire enum landed 2026-05-10 (AUDIT_DISPOSITION_REASONS_HANDOFF
    // marked shipped); reasons go straight onto the typed
    // ``dismiss_reason`` field. Cast through ``DismissReason`` —
    // the dialog only ever picks keys that match.
    await patch("dismissed", {
      dismissReason: reasonKey as DismissReason,
      notes,
    });
    setDismissOpen(false);
  }

  async function handleAcceptConfirm(reasonKey: string, notes: string) {
    setAcceptOpen(false);
    await handleApply({
      acceptReason: reasonKey as import("@/api/auditTypes").AcceptReason,
      notes,
    });
  }

  async function handleNotSureConfirm(reasonKey: string, notes: string) {
    await patch("needs_more_info", {
      notSureReason: reasonKey as import("@/api/auditTypes").NotSureReason,
      notes,
    });
    setNotSureOpen(false);
  }

  return (
    <div className="pl-1.5 space-y-1.5 relative">
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
          type="button"
          onClick={() =>
            patch(current === "accepted" ? "pending" : "accepted")
          }
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
            onClick={() => patch("pending")}
            disabled={dispositionSaving}
            className="text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline ml-auto dark:text-slate-400 dark:hover:text-slate-100"
            title="reset disposition to pending — useful when you want to revert a dismiss without re-opening the reason picker"
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
      {dismissOpen ? (
        <DismissDialog
          mode="dismiss"
          finding={finding}
          anchor={dismissBtnRef.current}
          onCancel={() => setDismissOpen(false)}
          onConfirm={handleDismissConfirm}
        />
      ) : null}
      {acceptOpen ? (
        <DismissDialog
          mode="accept"
          finding={finding}
          anchor={acceptBtnRef.current}
          onCancel={() => setAcceptOpen(false)}
          onConfirm={handleAcceptConfirm}
        />
      ) : null}
      {notSureOpen ? (
        <DismissDialog
          mode="not_sure"
          finding={finding}
          anchor={notSureBtnRef.current}
          onCancel={() => setNotSureOpen(false)}
          onConfirm={handleNotSureConfirm}
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
function trimRationaleBoilerplate(s: string): string {
  if (!s) return s;
  let out = s;
  // 1) "Accept if … dismiss if …" tail. Anchor on "Accept if" /
  //    "Accept this" + a trailing "dismiss if" so we don't chop
  //    legitimate rationales that contain "accept" mid-sentence.
  out = out.replace(
    /\s*(?:^|\.\s+)Accept\s+(?:if|this)\b[^.]*?\bdismiss\s+if\b[^.]*?\.?\s*$/i,
    "",
  );
  // 2) "(see the supporting-evidence panel)" / "Agent emitted with
  //    the evidence quote on file (see the supporting-evidence
  //    panel)." — wasted verbiage that points at a panel the
  //    curator can already see. Match the parenthetical anywhere
  //    AND, if the whole sentence is just the "Agent emitted with
  //    the evidence quote on file" frame, drop the whole sentence.
  out = out.replace(
    /\s*\(\s*see\s+the\s+supporting[- ]evidence\s+panel\.?\s*\)\s*\.?/gi,
    "",
  );
  out = out.replace(
    /\s*(?:^|\.\s+)Agent\s+emitted\s+with\s+the\s+evidence\s+quote\s+on\s+file\.?/i,
    "",
  );
  return out.trim();
}

function ProposerSuggestionPanel({ finding }: { finding: AuditFinding }) {
  const term = finding.proposer_term;
  const statements = finding.proposer_statements ?? [];
  // Defense is the agent's positive case for its alternate, distinct
  // from the finding's rationale. Older calibration packages packed
  // it with "(see the supporting-evidence panel)" filler — strip
  // through ``trimRationaleBoilerplate`` so an empty-after-trim
  // string doesn't render an empty paragraph.
  const trimmedDefense = trimRationaleBoilerplate(
    finding.proposer_defense ?? "",
  );
  const evidence = finding.supporting_evidence ?? [];
  const legacyText = finding.proposer_suggestion;
  const hasStructured =
    !!term ||
    statements.length > 0 ||
    !!trimmedDefense ||
    evidence.length > 0;
  if (!hasStructured && !legacyText) return null;

  const dv = finding.defender_verdict ?? null;
  // Prefer the producer-side ``strength`` (calibration v10+); fall
  // back to the verdict-keyed helper for v9-and-older packages.
  // See AUDIT_DEFENDER_VERDICT_HANDOFF.md § "what I'd suggest
  // changing in the UI" — Option A.
  const strength = dv?.strength ?? verdictStrength(dv?.verdict);
  const headerLabel = strength
    ? `${strength} suggestion`
    : "proposer suggestion";

  return (
    <div className="rounded border border-violet-200 bg-violet-50/60 px-1.5 py-1.5 text-[11px] mx-1.5 space-y-1.5 dark:border-violet-700/60 dark:bg-violet-900/20">
      <div
        className="text-[9px] uppercase tracking-wide font-semibold text-violet-900 dark:text-violet-300"
        title={
          strength
            ? `judge graded the proposer's pick (${dv!.verdict})`
            : "how the silent comparison proposer handled the same target"
        }
      >
        {headerLabel}
      </div>
      {statements.length > 0 ? (
        // FV / factor-shape findings: render the same StatementGlyph
        // the proposal card uses. Disc colour names per-slot
        // grounding (green = URI, slate = free-text); ``×N`` count
        // surfaces multi-statement structure. Skips the single-Term
        // render below — the glyph carries the semantics.
        <div>
          <StatementGlyph statements={statements} />
        </div>
      ) : term ? (
        <div>
          <Term uri={term.uri ?? null}>{term.label}</Term>
        </div>
      ) : !hasStructured && legacyText ? (
        // Legacy fallback — no structured term came through, but the
        // older report had a one-line string. Render plain.
        <div className="text-violet-900 dark:text-violet-200">{legacyText}</div>
      ) : null}
      {trimmedDefense ? (
        <div className="text-slate-700 dark:text-slate-300 leading-snug">
          {trimmedDefense}
        </div>
      ) : null}
      {evidence.length > 0 ? (
        <div className="space-y-1">
          {/* Sub-header dropped 2026-05-08 — the rationale's
              "(see the supporting-evidence panel)" reference is
              now stripped at the source + by the UI's defensive
              regex, so the labelled anchor is redundant. The
              blockquotes themselves carry per-source chips. */}
          {evidence.map((ev, i) => (
            <FindingEvidenceBlock key={i} evidence={ev} />
          ))}
        </div>
      ) : null}
      {dv?.rationale ? (
        <div
          className="text-slate-600 dark:text-slate-400 italic text-[10px] leading-snug"
          title={dv.citation || undefined}
        >
          <span className="not-italic font-semibold text-slate-700 dark:text-slate-300">
            Judge:
          </span>{" "}
          {dv.rationale}
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
    case "extra_genuine_new":
    case "agent_correct_inherited":
    case "agent_correct_overzealous_gold":
      return "strong";
    case "agent_miss_genuine":
    case "extra_inherited_redundant":
    case "extra_unsupported":
      return "weak";
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
    case "extra_unsupported":
      return "Dismiss — judge: the agent's pick isn't well-evidenced.";
    case "extra_inherited_redundant":
      return "Dismiss — judge: already inherited from biomaterials.";
    case "agent_miss_genuine":
      return "Keep the existing tag — judge: it's well-supported.";
    default:
      // Weak strength on a verdict label we don't have specific copy
      // for (forward-compat: future investigator verdicts). Generic
      // fall-through reads better than the agent's verbose fix.
      return "Override the suggestion — judge: low confidence.";
  }
}

/** One evidence quote — blockquote rendering with a small source chip
 *  on the right. Source vocab matches the agent-side
 *  ``FindingEvidence.source`` literal: paper / skeleton /
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
  const sourceLabel: Record<typeof evidence.source, string> = {
    paper: "paper",
    skeleton: "skeleton",
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
