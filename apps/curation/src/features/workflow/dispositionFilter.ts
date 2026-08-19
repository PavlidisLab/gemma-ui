/**
 * Finding-disposition filter model for the ticket queue.
 *
 * The auto-triage workflow (handoff 2026-07-23) pre-dispositions the
 * bulk of a ticket's findings with a reason chip and leaves the
 * genuinely-uncertain ones as `needs_more_info`; the curator's job is
 * the leftover pile — IF they can filter to it. This module is the
 * pure half: fold each experiment's latest audit into per-target
 * triage rows, then match them against a three-axis filter
 * (status · reason · reviewer). The queue UI counts and filters
 * experiment rows through these helpers; tests hit them directly.
 *
 * The triage unit is the TARGET, not the finding — dispositions are
 * per `target_id`, and a target with several findings is still one
 * curator decision. Targets whose findings are all severity `ok`
 * (informational green checks) are not part of the pile.
 */
import type {
  AuditFindingDisposition,
  AuditReport,
  DispositionStatus,
} from "@/api/auditTypes";
import { latestDispositionByTarget } from "@/features/audit/dispositionFold";

export interface TriageRow {
  experimentId: number;
  targetId: string;
  /** Latest disposition status; a target with no disposition row is
   *  `pending` (the pipeline emits findings as pending). */
  status: DispositionStatus;
  /** The structured reason on the latest disposition — whichever of
   *  dismiss/accept/not-sure is set (they're status-scoped, so at
   *  most one is). Null when pending or when the row pre-dates the
   *  structured-reason round-trip. */
  reason: string | null;
  /** Who made the latest disposition (`agent-triage` vs a curator).
   *  Null when pending. */
  reviewer: string | null;
}

function reasonOf(d: AuditFindingDisposition | undefined): string | null {
  return d?.dismiss_reason ?? d?.accept_reason ?? d?.not_sure_reason ?? null;
}

/** Per-target triage rows for ONE experiment's audit report (the
 *  most recent one — the same report the row's sidebar shows). */
export function triageRowsForReport(
  experimentId: number,
  report: AuditReport | undefined | null,
): TriageRow[] {
  if (!report) return [];
  const latest = latestDispositionByTarget(report.dispositions);
  // One row per target that has at least one non-`ok` finding.
  const actionable = new Set<string>();
  for (const f of report.findings ?? []) {
    if (f.severity !== "ok") actionable.add(f.target_id);
  }
  const rows: TriageRow[] = [];
  for (const targetId of actionable) {
    const d = latest.get(targetId);
    rows.push({
      experimentId,
      targetId,
      status: d?.status ?? "pending",
      reason: reasonOf(d),
      reviewer: d?.reviewer ?? null,
    });
  }
  return rows;
}

/** Union of one experiment's audit-kind and proposal-kind triage
 *  rows. A ticket's findings live as ``kind='proposal'`` rows for
 *  review tickets and ``kind='audit'`` rows for audit tickets, so
 *  the queue reads both; when the same target appears in both
 *  reports, the row carrying a decision beats a pending one. */
export function mergeTriageRows(
  a: TriageRow[],
  b: TriageRow[],
): TriageRow[] {
  const byTarget = new Map<string, TriageRow>();
  for (const r of [...a, ...b]) {
    const prev = byTarget.get(r.targetId);
    if (!prev) {
      byTarget.set(r.targetId, r);
    } else if (prev.status === "pending" && r.status !== "pending") {
      byTarget.set(r.targetId, r);
    }
  }
  return [...byTarget.values()];
}

/** Three independent axes; `"any"` disables an axis. Axes combine
 *  as AND — "dismissed with reason X by agent-triage" is a real
 *  question the auto-triage workflow asks. */
export interface DispositionFilterState {
  status: DispositionStatus | "any";
  reason: string;
  reviewer: string;
}

export const DISPOSITION_FILTER_ANY: DispositionFilterState = {
  status: "any",
  reason: "any",
  reviewer: "any",
};

export function isDispositionFilterActive(
  f: DispositionFilterState,
): boolean {
  return f.status !== "any" || f.reason !== "any" || f.reviewer !== "any";
}

export function triageRowMatches(
  row: TriageRow,
  f: DispositionFilterState,
): boolean {
  if (f.status !== "any" && row.status !== f.status) return false;
  if (f.reason !== "any" && row.reason !== f.reason) return false;
  if (f.reviewer !== "any" && row.reviewer !== f.reviewer) return false;
  return true;
}

/** Row-badge noun for "N <noun>" — status-specific when the status
 *  axis is set ("3 need info" beats "3 matching"), generic otherwise. */
export function dispositionBadgeNoun(f: DispositionFilterState): string {
  switch (f.status) {
    case "needs_more_info":
      return "need info";
    case "pending":
      return "pending";
    case "accepted":
      return "accepted";
    case "dismissed":
      return "dismissed";
    default:
      return "matching";
  }
}

/** Chip order matches the curator's workflow priority: the pile that
 *  needs them first. */
export const DISPOSITION_STATUS_CHIPS: {
  id: DispositionStatus | "any";
  label: string;
}[] = [
  { id: "any", label: "Any" },
  { id: "needs_more_info", label: "Needs info" },
  { id: "pending", label: "Pending" },
  { id: "accepted", label: "Accepted" },
  { id: "dismissed", label: "Dismissed" },
];
