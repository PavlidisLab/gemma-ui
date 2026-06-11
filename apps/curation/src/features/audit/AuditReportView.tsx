import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { normalizeWikiUrl } from "@/lib/guidelines";
import { isProseModel } from "@/lib/agentPalette";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  AuditTargetKind,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";
import type { SubtaskDecision } from "@/api/types";
import { dedupeSubtaskDecisions } from "./subtaskDecisions";
import {
  SEVERITY_RANK,
  TARGET_KIND_ORDER,
  severityRowBgCls,
  severityTextCls,
} from "./auditPresentation";

/**
 * Pure-presentation view of an `AuditReport`. Takes a fully-loaded
 * report and renders the header (experiment, scope, summary), then
 * findings grouped by `target_kind` and ordered within by severity.
 *
 * `ok` findings default-collapsed — they're emitted as green checks
 * for the curator's information, not action items.
 *
 * Disposition controls (Accept fix / Dismiss / Needs more info)
 * call `onDispositionChange` when provided — typically wired to
 * `usePatchDisposition`. When omitted (e.g. the `#/audit-preview`
 * fixture page that has no live audit_id to PATCH against), the
 * controls toast a "not wired in this view" notice instead.
 *
 * Disposition state is read straight from `report.dispositions`;
 * after a PATCH the parent rehydrates the report and the buttons
 * reflect the new state. The view doesn't keep its own disposition
 * cache.
 */
export function AuditReportView({
  report,
  onDispositionChange,
}: {
  report: AuditReport;
  onDispositionChange?: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
}) {
  const dispositionByTarget = useMemo(() => {
    const m = new Map<string, AuditFindingDisposition>();
    for (const d of report.dispositions ?? []) m.set(d.target_id, d);
    return m;
  }, [report.dispositions]);

  return (
    <div className="space-y-4">
      <ReportHeader report={report} />
      <FindingsList
        report={report}
        dispositionByTarget={dispositionByTarget}
        onDispositionChange={onDispositionChange}
      />
      <DesignComparisonPanel report={report} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ReportHeader({ report }: { report: AuditReport }) {
  const { summary, scope } = report;
  return (
    <div className="card px-4 py-3 space-y-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
          audit
        </span>
        <h2 className="text-lg font-semibold text-slate-900">
          {report.experiment_short_name}
        </h2>
        <span className="text-xs text-slate-500">
          · audited {formatTimestamp(report.audited_at)}
        </span>
        {report.model ? (() => {
          const isProse = isProseModel(report.model);
          return (
            <span
              className={cn(
                "text-[11px] text-slate-700 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200",
                isProse ? null : "font-mono",
              )}
              title={`${isProse ? "audit context" : "audit ran with model"}: ${report.model}`}
            >
              {report.model}
            </span>
          );
        })() : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <VerdictPill verdict={summary.overall_verdict} />
        <SeverityCount label="blocker" count={summary.n_blocker} severity="blocker" />
        <SeverityCount label="major" count={summary.n_major} severity="major" />
        <SeverityCount label="minor" count={summary.n_minor} severity="minor" />
        <SeverityCount label="ok" count={summary.n_ok} severity="ok" />
        <span className="text-slate-300">·</span>
        <span className="text-slate-500">
          scope:{" "}
          {scope.include.length === 0 ? (
            <span className="italic">none</span>
          ) : (
            <span className="font-mono text-[11px]">
              {scope.include.join(" / ")}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: AuditReport["summary"]["overall_verdict"] }) {
  const cls = {
    clean: "bg-emerald-100 text-emerald-900 border-emerald-300",
    minor_issues: "bg-slate-100 text-slate-700 border-slate-300",
    major_issues: "bg-amber-100 text-amber-900 border-amber-300",
    blockers: "bg-rose-100 text-rose-900 border-rose-300",
  }[verdict];
  const label = {
    clean: "clean",
    minor_issues: "minor issues",
    major_issues: "major issues",
    blockers: "blockers",
  }[verdict];
  return (
    <span
      className={cn(
        "inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border",
        cls,
      )}
      title={`overall verdict: ${label}`}
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
    return (
      <span className="text-[11px] text-slate-400">
        0 {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 text-[11px]",
        severityTextCls(severity),
      )}
    >
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Findings — grouped by target_kind, sorted within by severity
// ---------------------------------------------------------------------------

// AuditReportView keeps its own TARGET_KIND_LABEL because the verbose
// surface uses long-form labels ("Experiment-wide" / "Factor value" /
// "Sample assignment") rather than the sidebar's compact ones. Sort
// order + rank tables come from the shared `auditPresentation` module.
const TARGET_KIND_LABEL: Record<AuditTargetKind, string> = {
  experiment: "Experiment-wide",
  factor: "Factor",
  fv: "Factor value",
  tag: "Tag",
  characteristic: "Characteristic",
  assignment: "Sample assignment",
  statement: "Statement",
};

function FindingsList({
  report,
  dispositionByTarget,
  onDispositionChange,
}: {
  report: AuditReport;
  dispositionByTarget: Map<string, AuditFindingDisposition>;
  onDispositionChange?: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
}) {
  const grouped = useMemo(() => groupByTargetKind(report.findings), [report.findings]);

  if (report.findings.length === 0) {
    const scopeItems = report.scope?.include ?? [];
    const scopeLabel = scopeItems.length > 0 ? scopeItems.join(", ") : "any";
    return (
      <div className="card p-4 text-sm text-slate-500 italic">
        No {scopeLabel} findings.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {TARGET_KIND_ORDER.map((kind) => {
        const findings = grouped.get(kind);
        if (!findings || findings.length === 0) return null;
        return (
          <FindingsGroup
            key={kind}
            kind={kind}
            findings={findings}
            dispositionByTarget={dispositionByTarget}
            onDispositionChange={onDispositionChange}
          />
        );
      })}
    </div>
  );
}

function groupByTargetKind(
  findings: AuditFinding[],
): Map<AuditTargetKind, AuditFinding[]> {
  const m = new Map<AuditTargetKind, AuditFinding[]>();
  for (const f of findings) {
    const list = m.get(f.target_kind) ?? [];
    list.push(f);
    m.set(f.target_kind, list);
  }
  for (const list of m.values()) {
    list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }
  return m;
}

function FindingsGroup({
  kind,
  findings,
  dispositionByTarget,
  onDispositionChange,
}: {
  kind: AuditTargetKind;
  findings: AuditFinding[];
  dispositionByTarget: Map<string, AuditFindingDisposition>;
  onDispositionChange?: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
}) {
  // ok findings live behind a "show N ok checks" toggle so they don't
  // crowd out actionable items. Default-collapsed.
  const actionable = findings.filter((f) => f.severity !== "ok");
  const okOnes = findings.filter((f) => f.severity === "ok");
  const [showOk, setShowOk] = useState(false);

  return (
    <div className="card">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3">
        <span className="section-h">{TARGET_KIND_LABEL[kind]}</span>
        <span className="text-[11px] text-slate-500">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {actionable.map((f) => (
          <FindingCard
            key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
            finding={f}
            currentDisposition={
              dispositionByTarget.get(f.target_id)?.status ?? "pending"
            }
            onDispositionChange={onDispositionChange}
          />
        ))}
        {okOnes.length > 0 ? (
          <div className="px-3 py-2 text-xs">
            <button
              type="button"
              className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
              onClick={() => setShowOk((v) => !v)}
            >
              {showOk
                ? `hide ${okOnes.length} ok check${okOnes.length === 1 ? "" : "s"}`
                : `show ${okOnes.length} ok check${okOnes.length === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
        {showOk
          ? okOnes.map((f) => (
              <FindingCard
                key={`${f.target_kind}:${f.target_id}:${f.issue_code}`}
                finding={f}
                currentDisposition={
                  dispositionByTarget.get(f.target_id)?.status ?? "pending"
                }
                onDispositionChange={onDispositionChange}
              />
            ))
          : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-finding card
// ---------------------------------------------------------------------------

function FindingCard({
  finding,
  currentDisposition,
  onDispositionChange,
}: {
  finding: AuditFinding;
  currentDisposition: DispositionStatus;
  onDispositionChange?: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
}) {
  return (
    <div
      className={cn(
        "px-3 py-2.5 space-y-2",
        severityRowBgCls(finding.severity),
        currentDisposition === "dismissed" && "opacity-60",
      )}
    >
      {/* issue_code + target_id were behind-the-scenes identifiers
          that leaked into the user-facing card — hidden 2026-05-25.
          The tooltip on the severity badge + the rationale text
          below carry the human signal. */}
      <div className="flex items-start gap-2 flex-wrap">
        <SeverityBadge severity={finding.severity} />
      </div>

      <p className="text-sm text-slate-800">{finding.rationale}</p>

      {finding.citation || finding.citation_url ? (
        <div className="text-[11px] text-slate-500">
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

      <FindingAgentSuggestion finding={finding} />

      <DispositionBar
        targetId={finding.target_id}
        current={currentDisposition}
        onChange={onDispositionChange}
      />
    </div>
  );
}

/** Merged "suggested fix + proposer suggestion" — one box instead of
 *  two separate coloured panels. */
function FindingAgentSuggestion({ finding }: { finding: AuditFinding }) {
  const fix = finding.suggested_fix;
  const legacy = finding.proposer_suggestion;
  if (!fix && !legacy) return null;
  return (
    <div className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-xs space-y-1">
      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 block">
        suggestion
      </span>
      {fix ? (
        <span className="text-slate-800 block">{fix}</span>
      ) : null}
      {legacy && legacy !== fix ? (
        <span className="text-slate-700 block">{legacy}</span>
      ) : null}
    </div>
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
        "inline-block text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded",
        cls,
      )}
    >
      {severity}
    </span>
  );
}

function DispositionBar({
  targetId,
  current,
  onChange,
}: {
  targetId: string;
  current: DispositionStatus;
  /** When omitted, buttons toast a "view-only" notice — used by the
   *  fixture preview page where there's no live audit_id to PATCH. */
  onChange?: (
    targetId: string,
    status: DispositionStatus,
    notes?: string,
  ) => Promise<void>;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function pick(next: DispositionStatus) {
    if (!onChange) {
      toast.show(
        "Disposition is view-only on this surface — open the experiment audit sidebar to disposition.",
        "info",
        4000,
      );
      return;
    }
    setSaving(true);
    try {
      // Toggling a status to itself flips back to ``pending`` so a
      // misclick can be undone without leaving the card.
      await onChange(targetId, next === current ? "pending" : next);
    } catch (err) {
      toast.show(
        `Disposition save failed: ${(err as Error).message}`,
        "danger",
        6000,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1 pt-1">
      <DispositionButton
        label="Accept fix"
        active={current === "accepted"}
        activeCls="bg-blue-700 text-white"
        disabled={saving}
        onClick={() => pick("accepted")}
      />
      <DispositionButton
        label="Dismiss"
        active={current === "dismissed"}
        activeCls="bg-slate-700 text-white"
        disabled={saving}
        onClick={() => pick("dismissed")}
      />
      <DispositionButton
        label="Needs more info"
        active={current === "needs_more_info"}
        activeCls="bg-amber-600 text-white"
        disabled={saving}
        onClick={() => pick("needs_more_info")}
      />
      {saving ? (
        <span className="text-[11px] text-slate-400 italic ml-1">
          saving…
        </span>
      ) : null}
    </div>
  );
}

function DispositionButton({
  label,
  active,
  activeCls,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  activeCls: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[11px] px-2 py-0.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed",
        active ? activeCls : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Design comparison panel — Gemma factors vs agent proposal, side-by-side
// ---------------------------------------------------------------------------

export function DesignComparisonPanel({
  report,
}: {
  report: AuditReport;
}) {
  const cp = report.evidence.comparison_proposal;
  // Used by the subtask-decisions section below to filter out
  // factor-scoped decisions already rendered inline with finding cards.
  const agentFactors = cp?.factors ?? [];

  return (
    <div className="card">
      {/* Tag proposals panel + JSON viewer retired 2026-05-20.
          Tag proposals were a deduplication-against-findings surface
          that consistently leaked the duplicate when the dedup
          missed (e.g. inferred tags that matched Gemma rendered
          there but were noise — the per-finding cards above are
          the canonical actionable surface). The raw JSON dump
          wasn't load-bearing for any curator workflow. Subtask
          analysis (below) stays — it's the only experiment-level
          signal that doesn't have a per-finding home. */}

      {/* Experiment-level subtask decisions (factor-scoped ones render inline) */}
      {cp && (cp.evidence?.subtask_decisions?.length ?? 0) > 0 ? (() => {
        const factorLabels = agentFactors.map((f) => f.category.label.toLowerCase());
        // Also drop factor labels that a sidebar finding card renders
        // inline via InlineSubtaskReasoning — gold_only_miss / rename
        // findings reference factors the agent never proposed, so the
        // agentFactors-based filter above misses them. Without this the
        // same subtask analysis renders twice (once inline, once here).
        const findingLabels = new Set<string>();
        for (const f of report.findings ?? []) {
          if (!f.issue_code.startsWith("calibration_factor_")) continue;
          if (f.target_kind !== "factor") continue;
          const m = (f.rationale || "").match(/`([^`:]+?)`/);
          if (m) findingLabels.add(m[1].trim().toLowerCase());
        }
        // Union of factor labels covered by either an agent factor row
        // or a finding card. Used as the "this factor is already
        // surfaced somewhere visible" set for both factor- and
        // factor_pair-scoped subtask filtering.
        const coveredFactors = new Set<string>([
          ...factorLabels,
          ...findingLabels,
        ]);
        const globalDecisions = cp.evidence!.subtask_decisions!.filter((d) => {
          if (d.confidence === "high") return false;
          const t = (d.target_id || "").toLowerCase();
          // Factor-pair subtasks (S2i_confounding_check etc.) target
          // two factors at once: `factor_pair:treatment|disease model`.
          // Hide the pair when BOTH factors are already covered by a
          // finding card or agent-factor row — the curator has the
          // detail above and the pair-level commentary is just noise.
          if (t.startsWith("factor_pair:")) {
            const rest = t.slice("factor_pair:".length);
            const [a, b] = rest.split("|").map((s) => s.trim());
            if (a && b && coveredFactors.has(a) && coveredFactors.has(b)) {
              return false;
            }
            return true;
          }
          if (!t.startsWith("factor:")) return true;
          // Mirror the inline filter (`target_id.startsWith("factor:<label>")`)
          // so anything claimed by an agent factor stays inline-only. The
          // agent emits target_ids in two shapes for factor-scoped subtasks:
          // `factor:<label>` (factor-level) and `factor:<label>:fv:<fv>`
          // (FV-level under a factor); both share the same prefix.
          for (const label of coveredFactors) {
            if (t === `factor:${label}`) return false;
            if (t.startsWith(`factor:${label}:`)) return false;
            if (t.startsWith(`factor:${label}/`)) return false;
          }
          return true;
        });
        if (globalDecisions.length === 0) return null;
        const deduped = dedupeSubtaskDecisions(globalDecisions);
        return (
          <div className="border-t border-slate-100 dark:border-slate-700">
            <CollapsibleSubtaskAnalysis decisions={deduped} />
          </div>
        );
      })() : null}

    </div>
  );
}

// ``dedupeSubtaskDecisions`` moved to ``./subtaskDecisions.ts`` so
// this module exports React components only — keeps Vite Fast
// Refresh able to hot-swap component edits without a full page
// reload. Re-imported above + below for the existing call sites.

/** Subtask analysis as a collapsed-by-default disclosure. The
 *  agent's introspection ("S1_design_verdict", "S3_factor_candidate",
 *  …) is interesting context but a wall of prose when laid out
 *  inline — Paul 2026-05-25 ("the block of text — help!"). Gate
 *  behind a small toggle so the curator opts in. */
function CollapsibleSubtaskAnalysis({
  decisions,
}: {
  decisions: SubtaskDecision[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2 space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 inline-flex items-center gap-1"
        title={
          open
            ? "hide the agent's per-subtask reasoning"
            : "show the agent's per-subtask reasoning (S1 / S3 / S11 / etc)"
        }
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span>
          Subtask analysis
          <span className="ml-1 normal-case font-normal text-slate-400">
            ({decisions.length} {decisions.length === 1 ? "row" : "rows"})
          </span>
        </span>
      </button>
      {open ? (
        <div className="space-y-1 pt-0.5">
          {decisions.map((d, i) => (
            <SubtaskDecisionRow key={i} decision={d} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SubtaskDecisionRow({ decision }: { decision: SubtaskDecision }) {
  const confidenceColor: Record<string, string> = {
    high:   "text-emerald-700 dark:text-emerald-400",
    medium: "text-amber-700 dark:text-amber-400",
    low:    "text-orange-700 dark:text-orange-400",
    zero:   "text-rose-700 dark:text-rose-400",
  };
  const cls = decision.confidence ? confidenceColor[decision.confidence] ?? "" : "";
  return (
    <div className="text-[11px] space-y-0.5">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
          {decision.subtask}
        </span>
        <span className="font-medium text-slate-600 dark:text-slate-300">{decision.label}</span>
        {decision.confidence ? (
          <span className={cn("text-[10px]", cls)}>{decision.confidence}</span>
        ) : null}
      </div>
      <div className="text-slate-600 dark:text-slate-400 leading-snug pl-1">
        {decision.verdict}
        {decision.citation_url ? (
          <a
            href={normalizeWikiUrl(decision.citation_url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-1.5 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline"
          >
            {decision.citation || "ref ↗"}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Pick the URI that grounds the FV chip's label.
 *
 *  The chip binds the FV's *label* to a URI. The label comes from the
 *  subject slot, so the URI must too — anything else mislabels the
 *  free-text subject as if the object's URI grounded it. Concretely
 *  GSE105453 had `nonperforming · has_role · reference_subject_role`
 *  rendering with `nonperforming` looking green + `OBI:0000220`
 *  attached, even though `nonperforming` is genuinely free-text and
 *  OBI:0000220 grounds the *role*, not the FV.
 *
 *  Earlier version scanned object → subject → predicate to catch
 *  genotype-shape statements (`gene · has_genotype · wild-type`)
 *  where the agent put the load-bearing URI on the object. That
 *  fallback was overreaching — wild-type-like FVs were ALSO mis-
 *  attributing the object URI to the free-text subject. Fix the data
 *  shape upstream (subject URI when the FV is itself an ontology
 *  term) rather than papering it over here.
 */
function formatTimestamp(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
