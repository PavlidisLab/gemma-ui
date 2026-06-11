/**
 * Shared presentation vocabulary for audit-side surfaces.
 *
 * Centralises the lookup tables, sort orders, and palette helpers
 * that the audit sidebar, the full audit-report view, and the audit
 * context all need. Before this module each consumer carried its
 * own copy of `TARGET_KIND_LABEL` / `SEVERITY_RANK` /
 * `severityTextCls` — three copies of the same enum-keyed table,
 * three drift opportunities. Owning them here means the chrome stays
 * coherent across surfaces and a palette tweak is a one-file change.
 *
 * No JSX in this file — pure data + functions only. The badge /
 * dot / pill *components* that consume these helpers live in
 * `findingBadges.tsx`.
 */

import type {
  AuditFinding,
  AuditTargetKind,
  Severity,
} from "@/api/auditTypes";

// ---------------------------------------------------------------------------
// Target kinds — ordering and human-facing labels
// ---------------------------------------------------------------------------

/** Canonical target-kind sort order. Findings group by this in the
 *  audit report view and (when severity ties) in the sidebar list,
 *  so a section labelled "Factor" always sits where the curator
 *  expects relative to "FV" / "Tag" / "Assignment". */
export const TARGET_KIND_ORDER: AuditTargetKind[] = [
  "experiment",
  "factor",
  "fv",
  "tag",
  "characteristic",
  "assignment",
  "statement",
];

/** Title-cased human label for a target kind. The wire enum is
 *  lowercase + snake-y; UI surfaces want presentation form. */
export const TARGET_KIND_LABEL: Record<AuditTargetKind, string> = {
  experiment: "Experiment",
  factor: "Factor",
  fv: "FV",
  tag: "Tag",
  characteristic: "Characteristic",
  assignment: "Assignment",
  statement: "Statement",
};

// ---------------------------------------------------------------------------
// Severity — sort rank and palette helpers
// ---------------------------------------------------------------------------

/** Severity sort rank. Lower number = more urgent, so a plain
 *  ascending sort on this puts blockers at the top. */
export const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
};

/** UI-side severity override. The agent sometimes ranks
 *  intrinsically-structural changes (removing or adding a whole
 *  factor, partition mismatch) as `minor`; the curator's mental
 *  model treats those as major. Bump them up here so the badge
 *  reads correctly even when the wire severity drifts. */
export function displaySeverity(finding: AuditFinding): Severity {
  const code = finding.issue_code;
  const structural =
    code === "calibration_factor_gold_only_miss" ||
    code === "calibration_factor_extra" ||
    code === "calibration_factor_partition_mismatch";
  if (structural && finding.severity === "minor") return "major";
  return finding.severity;
}

/** Text-colour utility class for a severity. Used by inline labels
 *  and stat readouts that don't need the full badge chrome. */
export function severityTextCls(s: Severity): string {
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

/** Border-colour utility class for a severity — used by the sidebar
 *  card frame, where the row is severity-tinted via its border (the
 *  card body keeps a kind-tint background). */
export function severityBorderCls(s: Severity): string {
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

/** Row-background utility class for a severity — used by the full
 *  audit-report view's per-finding table rows, where severity reads
 *  as a faint row tint instead of a border. */
export function severityRowBgCls(s: Severity): string {
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

// ---------------------------------------------------------------------------
// Verdict strength — fallback when defender_verdict.strength is absent
// ---------------------------------------------------------------------------

/** Map a defender verdict string to its strength bucket. Mirrors the
 *  producer's mapping exactly; v10+ packages carry `strength` on
 *  the wire and skip this helper. `null` for unknown verdict
 *  strings — caller hides the strength label rather than guess.
 *  See AUDIT_DEFENDER_VERDICT_HANDOFF.md § "Mapping". */
export function verdictStrength(
  v: string | undefined,
): "weak" | "moderate" | "strong" | null {
  switch (v) {
    // Tag side (original six, AUDIT_DEFENDER_VERDICT_HANDOFF.md).
    case "extra_genuine_new":
    case "agent_correct_inherited":
    case "agent_correct_overzealous_gold":
      return "strong";
    case "agent_miss_genuine":
    case "extra_inherited_redundant":
    case "extra_unsupported":
      return "weak";
    // Factor side (FACTOR_DEFENDER_VERDICT_HANDOFF.md, 2026-05-14).
    // extra_genuine_new + extra_unsupported are shared with the tag
    // enum (same string, same strength) and handled above.
    case "miss_inherited_from_design":
    case "miss_overzealous_gold":
      return "strong";
    case "extra_confounded":
    case "miss_genuine":
      return "weak";
    case "extra_borderline":
    case "miss_borderline":
      return "moderate";
    default:
      return null;
  }
}
