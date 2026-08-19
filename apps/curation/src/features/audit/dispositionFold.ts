/**
 * The ONE latest-disposition-per-target fold.
 *
 * The server stores dispositions append-only: multiple rows per
 * `target_id` can exist (accept → undo → re-accept), and the row that
 * counts is the newest by `reviewed_at`. Every consumer must fold the
 * same way — an iteration-order `set` produces wrong answers whenever
 * the server returns newest-first (caught 2026-05-25: Apply All PATCHed
 * 3 dispositions but the local map kept reading the older "pending"
 * rows, so the button never disabled). AuditContext carried the fix;
 * AuditReportView still had the buggy in-order fold until this helper
 * replaced both copies (2026-08-18).
 */
import type { AuditFindingDisposition } from "@/api/auditTypes";

/** Latest disposition per `target_id`: newest `reviewed_at` wins;
 *  rows with a null `reviewed_at` (the initial pending state) rank
 *  oldest. Robust to any server ordering. */
export function latestDispositionByTarget(
  dispositions: AuditFindingDisposition[] | null | undefined,
): Map<string, AuditFindingDisposition> {
  const m = new Map<string, AuditFindingDisposition>();
  const sorted = [...(dispositions ?? [])].sort((a, b) => {
    const ta = a.reviewed_at ? Date.parse(a.reviewed_at) : 0;
    const tb = b.reviewed_at ? Date.parse(b.reviewed_at) : 0;
    return tb - ta;
  });
  for (const d of sorted) {
    if (!m.has(d.target_id)) m.set(d.target_id, d);
  }
  return m;
}
