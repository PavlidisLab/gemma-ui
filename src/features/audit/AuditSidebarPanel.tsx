import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
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
import { requestSampleScroll } from "@/lib/scrollToSample";
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
            <FindingList findings={report.findings} />
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
  return (
    <div className="card p-2 text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <VerdictPill verdict={summary.overall_verdict} />
        {hasOverride ? (
          <span
            className="inline-block text-[9px] uppercase tracking-wide font-bold px-1 py-0 rounded bg-violet-200 text-violet-900"
            title="this report is a dev override (synthesized or fixture-loaded), not the live audit"
          >
            dev
          </span>
        ) : null}
        <span className="text-[10px] text-slate-500 truncate">
          {report.audited_at ? formatShort(report.audited_at) : "—"}
          {report.model ? <> · {report.model}</> : null}
        </span>
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

  const actionable = sorted.filter((f) => f.severity !== "ok");
  const okOnes = sorted.filter((f) => f.severity === "ok");
  const [showOk, setShowOk] = useState(false);

  if (findings.length === 0) {
    return (
      <div className="card p-2 text-[11px] text-slate-500 italic">
        No findings — nothing to flag against this scope.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {actionable.map((f) => (
        <CompactFindingCard
          key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
          finding={f}
        />
      ))}
      {okOnes.length > 0 ? (
        <button
          type="button"
          className="w-full text-left text-[11px] px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded"
          onClick={() => setShowOk((v) => !v)}
        >
          {showOk
            ? `▾ hide ${okOnes.length} ok check${okOnes.length === 1 ? "" : "s"}`
            : `▸ show ${okOnes.length} ok check${okOnes.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {showOk
        ? okOnes.map((f) => (
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
  const toast = useToast();

  // Disposition state comes from context (server-authoritative for
  // live reports; in-memory for dev override). The card just reads
  // and writes through.
  const {
    experimentId,
    activeFindingKey,
    setActiveFindingKey,
    dispositionByTarget,
    setDisposition,
    dispositionSaving,
  } = useAudit();

  // For assignment-kind findings, we can jump straight to the BM in
  // the samples table. parseTargetId hands back the raw short_name
  // for `assignment:<short_name>`. Other kinds don't have a stable
  // sample anchor.
  const parsed = parseTargetId(finding.target_id);
  const jumpShortName =
    parsed?.kind === "assignment" ? parsed.biomaterialShortName : null;
  const currentDisposition =
    dispositionByTarget.get(finding.target_id)?.status ?? "pending";

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
            {finding.rationale}
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
          <div className="text-[10px] text-slate-500 font-mono pl-1.5 flex items-center gap-2 flex-wrap">
            <span>{finding.target_id}</span>
            {jumpShortName ? (
              <button
                type="button"
                className="text-blue-700 hover:text-blue-900 underline underline-offset-2 normal-case"
                onClick={(e) => {
                  e.stopPropagation();
                  requestSampleScroll(experimentId, jumpShortName);
                }}
                title={`switch to the Samples tab and scroll to ${jumpShortName}`}
              >
                → in samples table
              </button>
            ) : null}
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

          {finding.proposer_suggestion ? (
            <div className="rounded border border-violet-200 bg-violet-50/60 px-1.5 py-1 text-[11px] mx-1.5">
              <span
                className="text-[9px] uppercase tracking-wide font-semibold text-violet-900 block mb-0.5"
                title="how the silent comparison proposer handled the same target"
              >
                proposer suggestion
              </span>
              <span className="text-violet-900">
                {finding.proposer_suggestion}
              </span>
            </div>
          ) : null}

          <DispositionRow
            current={currentDisposition}
            saving={dispositionSaving}
            onPick={async (next) => {
              try {
                await setDisposition(finding.target_id, next);
              } catch (err) {
                toast.show(
                  `Disposition save failed: ${(err as Error).message}`,
                  "danger",
                  6000,
                );
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function DispositionRow({
  current,
  saving,
  onPick,
}: {
  current: DispositionStatus;
  saving: boolean;
  /** Toggling the same status twice flips back to ``pending`` —
   *  curator can undo a misclick without leaving the card. */
  onPick: (next: DispositionStatus) => void;
}) {
  return (
    <div className="flex items-center gap-1 pl-1.5">
      <DispositionButton
        label="Accept"
        active={current === "accepted"}
        disabled={saving}
        activeCls="bg-blue-700 text-white"
        onClick={() => onPick(current === "accepted" ? "pending" : "accepted")}
      />
      <DispositionButton
        label="Dismiss"
        active={current === "dismissed"}
        disabled={saving}
        activeCls="bg-slate-700 text-white"
        onClick={() =>
          onPick(current === "dismissed" ? "pending" : "dismissed")
        }
      />
      <DispositionButton
        label="?"
        title="needs more info"
        active={current === "needs_more_info"}
        disabled={saving}
        activeCls="bg-amber-600 text-white"
        onClick={() =>
          onPick(
            current === "needs_more_info" ? "pending" : "needs_more_info",
          )
        }
      />
      {saving ? (
        <span className="text-[10px] text-slate-400 italic ml-1">
          saving…
        </span>
      ) : null}
    </div>
  );
}

function DispositionButton({
  label,
  active,
  disabled,
  activeCls,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  activeCls: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed",
        active ? activeCls : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Severity helpers (duplicated from AuditReportView for now — extract to a
// shared module once we have a third caller).
// ---------------------------------------------------------------------------

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
