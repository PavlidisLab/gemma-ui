import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import { StatementGlyph } from "@/components/ui/StatementGlyph";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  AuditTargetKind,
  DebateRound,
  DesignDebateEntry,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";
import type { FactorProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

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
  gemmaFactors,
  onDispositionChange,
}: {
  report: AuditReport;
  /** Current Gemma design factors for side-by-side comparison.
   *  Optional — omitting it hides the Gemma column. */
  gemmaFactors?: Factor[];
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
      <DesignComparisonPanel report={report} gemmaFactors={gemmaFactors} />
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
        {report.model ? (
          <span
            className="text-[11px] text-slate-700 font-mono px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200"
            title={`audit ran with model: ${report.model}`}
          >
            {report.model}
          </span>
        ) : null}
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

const TARGET_KIND_ORDER: AuditTargetKind[] = [
  "experiment",
  "factor",
  "fv",
  "tag",
  "assignment",
  "statement",
];

const TARGET_KIND_LABEL: Record<AuditTargetKind, string> = {
  experiment: "Experiment-wide",
  factor: "Factor",
  fv: "Factor value",
  tag: "Tag",
  assignment: "Sample assignment",
  statement: "Statement",
};

const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
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
    return (
      <div className="card p-4 text-sm text-slate-500 italic">
        No findings — nothing to flag against this scope.
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
        severityRowCls(finding.severity),
        currentDisposition === "dismissed" && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <SeverityBadge severity={finding.severity} />
        <code className="text-[11px] font-mono text-slate-600 px-1 py-0.5 bg-slate-100 rounded">
          {finding.issue_code}
        </code>
        <span className="text-[11px] font-mono text-slate-500" title="target id">
          {finding.target_id}
        </span>
      </div>

      <p className="text-sm text-slate-800">{finding.rationale}</p>

      {finding.citation || finding.citation_url ? (
        <div className="text-[11px] text-slate-500">
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
  gemmaFactors,
  onApplyDesign,
  onUndoApply,
}: {
  report: AuditReport;
  gemmaFactors: Factor[] | undefined;
  /** Adds the agent's proposed factors alongside the existing Gemma
   *  factors in the design draft (does not remove anything). Only
   *  pass in contexts where a draft is available (the in-experiment
   *  sidebar). */
  onApplyDesign?: () => void;
  /** Restores the pre-apply draft state. Present only after
   *  `onApplyDesign` has been called once; clears after undo. */
  onUndoApply?: () => void;
}) {
  const cp = report.evidence.comparison_proposal;
  const transcripts = report.evidence.design_debate_transcripts ?? [];
  const [jsonOpen, setJsonOpen] = useState(false);

  const agentFactors = cp?.factors ?? [];
  // Block and Batch are curator-added DEA blocking variables, not
  // biological factors — exclude them from the comparison so the panel
  // focuses on what the agent actually evaluated.
  const gemma = (gemmaFactors ?? []).filter(
    (f) => !/^(block|batch)$/i.test(f.category.label.trim()),
  );

  // Build label sets for mismatch highlighting.
  const gemmaLabels = new Set(gemma.map((f) => f.category.label.toLowerCase()));
  const agentLabels = new Set(agentFactors.map((f) => f.category.label.toLowerCase()));

  const nTags = cp?.tags?.length ?? 0;

  return (
    <div className="card">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
        <span className="section-h">Design comparison</span>
        <span className="text-[11px] text-slate-500">
          Gemma: {gemma.length} factor{gemma.length === 1 ? "" : "s"}
          {" · "}
          Agent: {agentFactors.length} factor{agentFactors.length === 1 ? "" : "s"}
          {nTags > 0 ? ` · ${nTags} tag${nTags === 1 ? "" : "s"}` : null}
          {cp?.model ? ` · ${cp.model}` : null}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {onUndoApply ? (
            <>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                added to draft
              </span>
              <button
                type="button"
                className="text-[11px] text-slate-500 dark:text-slate-400 hover:underline"
                onClick={onUndoApply}
              >
                undo
              </button>
            </>
          ) : onApplyDesign && agentFactors.length > 0 ? (
            <button
              type="button"
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              title="Adds the agent's proposed factors to the design draft alongside Gemma's (open the Design tab to preview; Reset to undo)"
              onClick={onApplyDesign}
            >
              Add to draft →
            </button>
          ) : null}
          {cp ? (
            <button
              type="button"
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
              onClick={() => setJsonOpen((v) => !v)}
            >
              {jsonOpen ? "hide JSON" : "JSON ↓"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700 text-xs">
        {/* Left: Gemma */}
        <div className="p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-2">
            Gemma
          </div>
          {gemma.length === 0 ? (
            <div className="text-slate-400 italic text-[11px]">design not loaded</div>
          ) : (
            gemma.map((f, i) => {
              const matched = agentLabels.has(f.category.label.toLowerCase());
              return (
                <GemmaFactorRow key={i} factor={f} matched={matched} />
              );
            })
          )}
        </div>

        {/* Right: Agent */}
        <div className="p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-2">
            Agent proposal
          </div>
          {agentFactors.length === 0 ? (
            <div className="text-slate-400 italic text-[11px]">
              {cp ? "no factors proposed" : "no comparison proposal"}
            </div>
          ) : (
            agentFactors.map((f, i) => {
              const matched = gemmaLabels.has(f.category.label.toLowerCase());
              const entry = findDesignDebateEntry(f, transcripts);
              return (
                <AgentFactorRow key={i} factor={f} matched={matched} entry={entry} />
              );
            })
          )}
        </div>
      </div>

      {jsonOpen && cp ? (
        <pre className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 max-h-96 overflow-auto font-mono whitespace-pre-wrap">
          {JSON.stringify(cp, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function GemmaFactorRow({ factor, matched }: { factor: Factor; matched: boolean }) {
  return (
    <div
      className={cn(
        "rounded px-2 py-1.5",
        matched ? "bg-slate-100/60 dark:bg-slate-700/40" : "opacity-40",
      )}
      title={matched ? "matched by agent" : "Gemma-only — agent did not propose this"}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn(
          "font-medium",
          matched ? "text-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-400",
        )}>
          {factor.category.label}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{factor.type}</span>
      </div>
      <div className="mt-0.5 space-y-0.5 pl-1">
        {factor.factor_values.map((fv, i) => (
          <div key={i} className="flex items-center gap-1 flex-wrap">
            <Term uri={fv.statements?.[0]?.subject.uri ?? null}>
              {fv.free_text_label}
            </Term>
            {fv.is_baseline ? (
              <span className="pill baseline">★ ref</span>
            ) : null}
            {fv.statements.length > 0 ? (
              <StatementGlyph statements={fv.statements} />
            ) : null}
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              ({fv.biomaterial_short_names.length})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentFactorRow({
  factor,
  matched,
  entry,
}: {
  factor: FactorProposal;
  matched: boolean;
  entry: DesignDebateEntry | undefined;
}) {
  const [debateOpen, setDebateOpen] = useState(false);
  const hasRounds = (entry?.rounds.length ?? 0) > 0;

  return (
    <div
      className={cn(
        "rounded px-2 py-1.5",
        matched
          ? "bg-slate-100/60 dark:bg-slate-700/40"
          : "bg-amber-50 dark:bg-amber-900/25",
      )}
      title={matched ? "matches Gemma" : "agent-only — not in Gemma's current design"}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn(
          "font-medium",
          matched ? "text-slate-800 dark:text-slate-100" : "text-amber-800 dark:text-amber-300",
        )}>
          {factor.category.label}
        </span>
        {factor.factor_type ? (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{factor.factor_type}</span>
        ) : null}
        {entry ? <DesignDebatePill badge={entry.badge} /> : null}
        {hasRounds ? (
          <button
            type="button"
            className="text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:underline ml-auto"
            onClick={() => setDebateOpen((v) => !v)}
          >
            {debateOpen ? "▾ debate" : "▸ debate"}
          </button>
        ) : null}
      </div>
      <div className="mt-0.5 space-y-0.5 pl-1">
        {factor.factor_values.map((fv, i) => {
          const subject = fv.statements?.[0]?.subject;
          return (
            <div key={i} className="flex items-center gap-1 flex-wrap">
              <Term uri={subject?.uri ?? null}>
                {fv.free_text_label || subject?.label || "?"}
              </Term>
              {(fv.statements?.length ?? 0) > 0 ? (
                <StatementGlyph statements={fv.statements} />
              ) : null}
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                ({fv.biomaterial_short_names.length})
              </span>
            </div>
          );
        })}
      </div>
      {debateOpen && hasRounds ? (
        <DebateRoundsSection rounds={entry!.rounds} />
      ) : null}
    </div>
  );
}

function findDesignDebateEntry(
  factor: FactorProposal,
  transcripts: DesignDebateEntry[],
): DesignDebateEntry | undefined {
  return transcripts.find(
    (t) =>
      (t.factor_category_uri &&
        factor.category.uri &&
        t.factor_category_uri === factor.category.uri) ||
      t.factor_category.toLowerCase() === factor.category.label.toLowerCase(),
  );
}

function DesignDebatePill({ badge }: { badge: string }) {
  const configs: Record<string, { label: string; cls: string }> = {
    gold:    { label: "★ gold",      cls: "bg-amber-50 border-amber-200 text-amber-700" },
    silver:  { label: "★ silver",    cls: "bg-slate-50 border-slate-300 text-slate-600" },
    bronze:  { label: "★ contested", cls: "bg-orange-50 border-orange-200 text-orange-700" },
    dropped: { label: "✕ dropped",   cls: "bg-rose-50 border-rose-200 text-rose-700" },
    stuck:   { label: "!! stuck",    cls: "bg-rose-50 border-rose-200 text-rose-700" },
  };
  const cfg = configs[badge];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[10px] tracking-wide font-medium px-1 py-0 rounded border",
        cfg.cls,
      )}
      title={`design debate: ${badge}`}
    >
      {cfg.label}
    </span>
  );
}

function DebateRoundsSection({ rounds }: { rounds: DebateRound[] }) {
  return (
    <div className="mt-1.5 space-y-2 border-l-2 border-slate-200 dark:border-slate-600 pl-2">
      {rounds.map((r, i) => (
        <div key={i} className="space-y-0.5 text-[11px]">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            Round {i + 1}
          </div>
          <div>
            <span className="font-medium text-slate-700 dark:text-slate-300">Challenge</span>
            {r.challenge_citation ? (
              <span className="text-slate-400 dark:text-slate-500 ml-1">({r.challenge_citation})</span>
            ) : null}
            <span className="text-slate-600 dark:text-slate-400">: {r.challenge_reason}</span>
          </div>
          <div>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Defense{r.defense_concedes ? " (concedes)" : ""}
            </span>
            <span className="text-slate-600 dark:text-slate-400">: {r.defense_response}</span>
          </div>
          <div>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Verdict ({r.verdict_side})
            </span>
            <span className="text-slate-600 dark:text-slate-400">: {r.verdict_reason}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      return "bg-rose-50/40";
    case "major":
      return "bg-amber-50/40";
    case "minor":
      return "";
    case "ok":
      return "bg-emerald-50/30";
  }
}

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
