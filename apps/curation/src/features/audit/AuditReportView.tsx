import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import { normalizeWikiUrl } from "@/lib/guidelines";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  AuditTargetKind,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";
import type { SubtaskDecision, TagProposal } from "@/api/types";
import type { Tag } from "@/features/experiment/types";

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
  gemmaTags,
}: {
  report: AuditReport;
  /** Existing Gemma EE tags — used to annotate proposed tags as
   *  matched vs new. Falls back to "unknown" when absent. */
  gemmaTags?: Tag[];
}) {
  const cp = report.evidence.comparison_proposal;
  const [jsonOpen, setJsonOpen] = useState(false);
  // Retained for the subtask-decisions section below, which filters
  // out factor-scoped decisions already rendered inline with finding
  // cards. The full EXPERIMENTAL DESIGN factor section retired
  // 2026-05-18 — factor proposals now render inline with their
  // corresponding finding cards. `gemmaFactors`, `draftFactorLabels`,
  // `onAddFactor`, `onUndoApply` props + alignment helpers +
  // AgentFactorRow all moved out with the section.
  const agentFactors = cp?.factors ?? [];

  // Gemma tag lookup by value URI (primary) or value label (fallback).
  const gemmaTagsByValueUri = new Map(
    (gemmaTags ?? []).filter((t) => t.value.uri).map((t) => [t.value.uri!, t]),
  );
  const gemmaTagsByValueLabel = new Map(
    (gemmaTags ?? []).map((t) => [t.value.label.toLowerCase(), t]),
  );
  function isTagInGemma(t: TagProposal): boolean {
    // Prefer the agent's pre-computed alignment when present.
    if (t.match_type) return t.match_type === "exact" || t.match_type === "close";
    if (t.value.uri && gemmaTagsByValueUri.has(t.value.uri)) return true;
    return gemmaTagsByValueLabel.has(t.value.label.toLowerCase());
  }

  // Drop tag proposals that already appear as findings — the finding
  // card above is the canonical, actionable place for them. Without
  // this filter, calibration audits show the same "agent proposes X"
  // line twice (once per-finding, once in the panel).
  //
  // Calibration findings use target_ids like
  // `calibration:extra:<category>/<value>` and `tag:<numeric_id>`, not
  // the `tag:<category-slug>/<value-slug>` shape `tagTarget()` builds.
  // Match instead by the `<category>: <value>` backticked pair present
  // in every calibration-tag finding's rationale, plus the
  // calibration:* target_id suffix when present. Both lookups go into
  // a single set keyed by `<category>|<value>` (lowercased).
  const findingTagKeys = new Set<string>();
  for (const f of report.findings ?? []) {
    if (f.target_kind !== "tag") continue;
    const calM = f.target_id.match(
      /^calibration:(?:extra|miss|match):(.+?)\/(.+)$/,
    );
    if (calM) {
      findingTagKeys.add(`${calM[1].toLowerCase()}|${calM[2].toLowerCase()}`);
    }
    const ratM = (f.rationale || "").match(/`([^:`]+):\s*([^`]+)`/);
    if (ratM) {
      findingTagKeys.add(
        `${ratM[1].trim().toLowerCase()}|${ratM[2].trim().toLowerCase()}`,
      );
    }
  }
  const tagsForPanel = (cp?.tags ?? []).filter((t) => {
    const key = `${t.category.label.toLowerCase()}|${t.value.label.toLowerCase()}`;
    return !findingTagKeys.has(key);
  });

  return (
    <div className="card">
      {/* Utility row — JSON viewer toggle. The "undo all added
          factors" branch retired alongside the EXPERIMENTAL DESIGN
          section; adding agent factors to the draft now happens
          inline with the relevant finding card. */}
      {cp ? (
        <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-700/60 flex items-center gap-2 justify-end">
          <button
            type="button"
            className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
            onClick={() => setJsonOpen((v) => !v)}
          >
            {jsonOpen ? "hide JSON" : "JSON ↓"}
          </button>
        </div>
      ) : null}

      {/* EXPERIMENTAL DESIGN factor section — retired 2026-05-18.
       *
       *  Factor proposals now render inline with their corresponding
       *  finding cards (via ``RenameFactorEmbed`` inside ``MatchFindingRow``
       *  for matches, alternate-factor cards for differing factors,
       *  and proposer-suggestion blocks on extra / gold-only-miss
       *  findings). Surfacing them again here as an unanchored "what
       *  the agent proposed" list duplicated information already
       *  reachable from the per-finding cards above + the Proposals
       *  tab — Paul: "the factor proposals should be in-line with
       *  the factor findings, not in a separate section at the
       *  bottom of the card."
       *
       *  The previous ``AgentFactorRow`` rendering + ``onAddFactor``
       *  / ``onUndoApply`` plumbing is now dead from the audit view.
       *  ``DesignComparisonPanel`` keeps the same callback signature
       *  for source-compat with ``AuditSidebarPanel.tsx`` (which still
       *  passes them in); they're just unused here. If a future audit
       *  surface wants an "accept this agent factor" affordance,
       *  wire it inline with the relevant finding card instead. */}

      {/* EE tag proposals — only show tags that aren't already covered
          by a per-finding card above. When every proposed tag has a
          matching finding (typical for calibration audits) the section
          collapses entirely to avoid duplicating the finding list. */}
      {cp && tagsForPanel.length > 0 ? (
        <div className="border-b border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">
            Tag proposals
          </div>
          {tagsForPanel.map((t, i) => (
            <ProposedTagRow key={i} tag={t} inGemma={gemmaTags ? isTagInGemma(t) : undefined} />
          ))}
        </div>
      ) : null}

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
        return (
          <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">
              Subtask analysis
            </div>
            {dedupeSubtaskDecisions(globalDecisions).map((d, i) => (
              <SubtaskDecisionRow key={i} decision={d} />
            ))}
          </div>
        );
      })() : null}

      {jsonOpen && cp ? (
        <pre className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 max-h-96 overflow-auto font-mono whitespace-pre-wrap">
          {JSON.stringify(cp, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** Collapse entries that share both `subtask` and `verdict` — they are
 *  identical copies produced once per factor (e.g. S7 coverage pass).
 *  Keeps the first occurrence; discards exact duplicates silently.
 *
 *  Also collapses near-identical S2i_confounding_check "skip rule
 *  does NOT apply" entries — one per factor pair — into a single
 *  summary row. With 3+ factors the per-pair prose was identical
 *  modulo factor names + tiny crosstab numbers, blowing out the
 *  panel with N(N-1)/2 paragraphs that say "nothing's wrong." */
export function dedupeSubtaskDecisions(decisions: SubtaskDecision[]): SubtaskDecision[] {
  const seen = new Set<string>();
  const dedupedExact = decisions.filter((d) => {
    const key = `${d.subtask}||${d.verdict}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cleanS2i = dedupedExact.filter(
    (d) =>
      d.subtask === "S2i_confounding_check" &&
      /skip rule does not apply/i.test(d.verdict),
  );
  if (cleanS2i.length < 2) return dedupedExact;
  // Replace all clean S2i entries with a single summary line.
  const summary: SubtaskDecision = {
    ...cleanS2i[0],
    verdict: `${cleanS2i.length} factor-pair confounding checks all clean — every pair is fully crossed; the S2i skip rule does not apply for any.`,
  };
  return dedupedExact
    .filter(
      (d) =>
        !(
          d.subtask === "S2i_confounding_check" &&
          /skip rule does not apply/i.test(d.verdict)
        ),
    )
    .concat([summary]);
}

function ProposedTagRow({ tag, inGemma }: { tag: TagProposal; inGemma?: boolean }) {
  return (
    <div className="flex items-start gap-1.5 flex-wrap text-[11px]">
      <span className="text-slate-500 dark:text-slate-400">{tag.category.label}:</span>
      <Term uri={tag.value.uri ?? null}>{tag.value.label}</Term>
      {inGemma === true ? (
        <span className="text-[10px] text-slate-400 dark:text-slate-500">= Gemma</span>
      ) : inGemma === false ? (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">new</span>
      ) : null}
      {tag.confidence ? (
        <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">{tag.confidence}</span>
      ) : null}
      {tag.evidence_quote ? (
        <span className="w-full text-[10px] text-slate-500 dark:text-slate-400 italic pl-1 border-l border-slate-200 dark:border-slate-600 leading-snug">
          "{tag.evidence_quote}"
        </span>
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
