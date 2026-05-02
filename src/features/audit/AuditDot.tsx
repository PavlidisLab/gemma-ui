import { cn } from "@/lib/cn";
import { useAuditOptional, useFocusFinding } from "./AuditContext";
import type {
  AuditFinding,
  DispositionStatus,
  Severity,
} from "@/api/auditTypes";

/**
 * Small circular indicator that flags a UI element as having one or
 * more `AuditFinding`s against it. Picks the highest-severity
 * finding's color; surfaces all findings in the tooltip and routes
 * a click to `useFocusFinding(targetId)` (sidebar opens + scrolls
 * the matching card into view).
 *
 * Returns `null` when no audit is loaded or the target has no
 * findings — drop-in safe to wrap around any element without
 * conditional render logic at the call site.
 *
 * The disposition overlay (× for dismissed, ✓ for accepted, ?
 * for needs-more-info) lets curators see at a glance which findings
 * they've already triaged without leaving the inline view. Pending
 * findings render as a plain dot.
 */
export function AuditDot({
  targetId,
  className,
  size = "sm",
  issueCodes,
}: {
  targetId: string;
  className?: string;
  /** ``sm`` (8px) for inline-with-text contexts; ``md`` (12px) for
   *  card-title or row-gutter contexts where the dot needs to stay
   *  visible against a busier background. */
  size?: "sm" | "md";
  /** Optional filter on `AuditFinding.issue_code`. Anchors with the
   *  same `target_id` (e.g. `experiment:1234`) can carry multiple
   *  unrelated findings; the dot beside an affordance like the
   *  "+ tag" button should only light up for that affordance's
   *  concern (e.g. `["missing_tag"]`). When omitted, every finding
   *  on the target counts — the original behaviour. */
  issueCodes?: string[];
}) {
  const ctx = useAuditOptional();
  const focusFinding = useFocusFinding();
  if (!ctx) return null;
  const all = ctx.findingsByTarget.get(targetId);
  if (!all || all.length === 0) return null;
  const findings = issueCodes
    ? all.filter((f) => issueCodes.includes(f.issue_code))
    : all;
  if (findings.length === 0) return null;
  const primary = findings[0];
  const disposition = ctx.dispositionByTarget.get(targetId);
  const dimmed =
    disposition?.status === "dismissed" || disposition?.status === "accepted";

  const sizeCls = size === "md" ? "w-3 h-3 text-[8px]" : "w-2 h-2 text-[7px]";
  const colorCls = severityDotCls(primary.severity);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        focusFinding(targetId);
      }}
      title={dotTooltip(findings, disposition?.status)}
      className={cn(
        "inline-flex items-center justify-center rounded-full border align-middle shrink-0 leading-none cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition-shadow",
        sizeCls,
        colorCls,
        dimmed && "opacity-50",
        className,
      )}
      aria-label={`audit: ${findings.length} finding${findings.length === 1 ? "" : "s"} (${primary.severity})`}
    >
      <DispositionGlyph status={disposition?.status} />
    </button>
  );
}

function DispositionGlyph({ status }: { status?: DispositionStatus }) {
  if (!status || status === "pending") return null;
  if (status === "dismissed") return <span aria-hidden>×</span>;
  if (status === "accepted") return <span aria-hidden>✓</span>;
  if (status === "needs_more_info") return <span aria-hidden>?</span>;
  return null;
}

function severityDotCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "bg-rose-500 border-rose-700 text-white";
    case "major":
      return "bg-amber-400 border-amber-600 text-amber-950";
    case "minor":
      return "bg-slate-400 border-slate-600 text-white";
    case "ok":
      return "bg-emerald-400 border-emerald-600 text-white";
  }
}

function dotTooltip(
  findings: AuditFinding[],
  dispositionStatus?: DispositionStatus,
): string {
  const head =
    findings.length === 1
      ? `Audit: 1 finding`
      : `Audit: ${findings.length} findings`;
  const lines = findings.map((f) => {
    const sev = f.severity.toUpperCase();
    return `${sev} · ${f.issue_code} — ${truncate(f.rationale, 90)}`;
  });
  const dispLine = dispositionStatus && dispositionStatus !== "pending"
    ? `\n— curator: ${dispositionLabel(dispositionStatus)}`
    : "";
  return `${head}${dispLine}\n${lines.join("\n")}\n(click to open in sidebar)`;
}

function dispositionLabel(s: DispositionStatus): string {
  switch (s) {
    case "accepted":
      return "accepted";
    case "dismissed":
      return "dismissed";
    case "needs_more_info":
      return "needs more info";
    default:
      return s;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
